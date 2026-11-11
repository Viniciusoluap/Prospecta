import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers.js";
import * as db from "./db.js";
import { LEAD_PIPELINE_STAGES } from "../shared/lead-pipeline.js";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";

const caller = (role: "admin" | "cliente") =>
  appRouter.createCaller({ user: { id: role === "admin" ? 99 : 4, role, active: true }, req: {}, res: {} } as never);

afterEach(() => vi.restoreAllMocks());

describe("ciclo de vida do lead comercial", () => {
  it("mantém exatamente as sete etapas comerciais na ordem solicitada", () => {
    expect(LEAD_PIPELINE_STAGES.map(({ label }) => label)).toEqual([
      "Lead Novo", "Em Atendimento", "Aprovado e Follow up", "Projetos e Vistorias",
      "Contratos e Cartório", "Medições", "Finalizado",
    ]);
  });

  it("exige classificação administrativa para um estágio legado ambíguo", async () => {
    vi.spyOn(db, "getLeadById").mockResolvedValue({ id: 7, stage: "waiting_docs", stageClassificationPending: true, deletedAt: null } as never);
    vi.spyOn(db, "updateLead").mockResolvedValue(undefined);
    const stage = vi.spyOn(db, "updateLeadPipelineStage").mockResolvedValue(true);

    await expect(caller("admin").leads.update({ id: 7, stage: "contracts_registry" })).resolves.toEqual({ success: true });
    expect(stage).toHaveBeenCalledWith(7, "contracts_registry", 99);
    expect(db.updateLead).toHaveBeenCalledWith(7, expect.not.objectContaining({ stage: expect.anything() }));

    await expect(caller("admin").leads.update({ id: 7, stage: "waiting_docs" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("remove o vencimento ao finalizar e aceita uma nova data ao reabrir", async () => {
    const pg = new PGlite();
    const dialect = new PgDialect();
    try {
      await pg.exec(`
        CREATE TYPE lead_activity_type AS ENUM ('status_change');
        CREATE TABLE leads (id integer PRIMARY KEY, stage text, card_due_date date, deleted_at timestamp,
          stage_classification_pending boolean DEFAULT false, updated_at timestamp);
        CREATE TABLE lead_activities (id serial PRIMARY KEY, lead_id integer, type lead_activity_type,
          description text, performed_by text, metadata jsonb);
        INSERT INTO leads (id, stage, card_due_date) VALUES
          (1, 'measurements', '2026-11-11'), (2, 'finalized', '2026-11-04');
      `);
      const mudar = (id: number, etapa: string, vencimento?: string) => {
        const { sql, params } = dialect.sqlToQuery(db.leadPipelineStageStatement(id, etapa, 99, vencimento));
        return pg.query(sql, params);
      };
      const data = async (id: number) => (await pg.query<{ date: string | null }>(
        "SELECT card_due_date::text AS date FROM leads WHERE id = $1", [id]
      )).rows[0]?.date;

      await mudar(1, "contracts_registry");
      expect(await data(1)).toBe("2026-11-11");
      await mudar(1, "finalized", "2026-11-12");
      expect(await data(1)).toBeNull();
      await mudar(1, "measurements", "2026-11-13");
      expect(await data(1)).toBe("2026-11-13");
      await mudar(2, "measurements");
      expect(await data(2)).toBeNull();
    } finally {
      await pg.close();
    }
  });

  it("ignora vencimento enviado ao finalizar e encaminha a data nova ao reabrir", async () => {
    const get = vi.spyOn(db, "getLeadById").mockResolvedValue({ id: 7, stage: "measurements", deletedAt: null } as never);
    const editar = vi.spyOn(db, "updateLead").mockResolvedValue(undefined);
    const etapa = vi.spyOn(db, "updateLeadPipelineStage").mockResolvedValue(true);

    await caller("admin").leads.update({ id: 7, stage: "finalized", cardDueDate: "2026-11-12" });
    expect(etapa).toHaveBeenLastCalledWith(7, "finalized", 99);
    expect(editar.mock.lastCall?.[1].cardDueDate).toBeUndefined();
    get.mockResolvedValue({ id: 7, stage: "finalized", deletedAt: null } as never);
    await caller("admin").leads.update({ id: 7, stage: "measurements", cardDueDate: "2026-11-13" });
    expect(etapa).toHaveBeenLastCalledWith(7, "measurements", 99, "2026-11-13");
  });

  it("recusa exclusão a clientes, confere vínculos e permite recuperação administrativa", async () => {
    const deletion = vi.spyOn(db, "setLeadDeleted").mockResolvedValue(true);
    vi.spyOn(db, "getLeadById").mockResolvedValue({ id: 7 } as never);
    vi.spyOn(db, "getLeadDeletionContext").mockResolvedValue({ services: 2, accounts: 1, projects: 1 });

    await expect(caller("cliente").leads.softDelete({ id: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(deletion).not.toHaveBeenCalled();
    await expect(caller("admin").leads.deletionContext({ id: 7 })).resolves.toEqual({ services: 2, accounts: 1, projects: 1 });
    await caller("admin").leads.softDelete({ id: 7 });
    await caller("admin").leads.restore({ id: 7 });
    expect(deletion.mock.calls).toEqual([[7, 99, true], [7, 99, false]]);
  });

  it("registra a exclusão e recuperação na mesma instrução SQL que altera o lead", async () => {
    const dialect = new PgDialect();
    const archive = dialect.sqlToQuery(db.leadDeletionStatement(7, 99, true));
    const restore = dialect.sqlToQuery(db.leadDeletionStatement(7, 99, false));
    for (const statement of [archive, restore]) {
      expect(statement.sql).toContain("UPDATE leads");
      expect(statement.sql).toContain("INSERT INTO lead_activities");
      expect(statement.sql).toContain("FROM changed");
    }
    expect(archive.params).toContainEqual(expect.stringContaining("soft_delete"));
    expect(restore.params).toContainEqual(expect.stringContaining("restore"));
  });
});
