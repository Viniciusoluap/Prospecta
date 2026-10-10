import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers.js";
import * as db from "./db.js";
import { LEAD_PIPELINE_STAGES } from "../shared/lead-pipeline.js";
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
