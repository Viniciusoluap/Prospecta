import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import * as banco from "./db.js";
import * as email from "./_core/email-smtp.js";
import { constructionProgressHistory, constructionProjects } from "../drizzle/schema.js";
import { invalidarAnexosMedicao } from "./medicao-email-estado.js";
import { obraProgressoRouter } from "./obra-progresso-router.js";
vi.mock("./routes/obra-medicao-caixa.js", () => ({ gerarArquivoMedicao: vi.fn(async (_m, _obra, formato) => ({ ok: true, bytes: new Uint8Array([1,2]), nome: `PLS.${formato}`, mime: "application/pdf" })) }));

it("registra solicitação e aviso só para admin, impede duplicata e permite reenvio após falha SMTP", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE TABLE construction_progress_history (
      id integer primary key, project_id integer, progress_pct numeric, incidence_total_pct numeric,
      items jsonb, created_by integer, created_at timestamp default now(), requested_at timestamp,
      requested_by integer, received_at timestamp, received_by integer, updated_at timestamp,
      updated_by integer, measurement_type varchar default 'pls', caixa_data jsonb, pci_version_id integer);
      INSERT INTO construction_progress_history(id,project_id,progress_pct,incidence_total_pct,items) VALUES(1,10,22.6,100,'[]');
      CREATE TABLE users(id integer primary key, role text, active boolean);
      INSERT INTO users VALUES(1,'admin',true),(2,'colaborador',true),(3,'admin',false);
      CREATE TABLE user_notifications(id serial primary key, user_id integer, title text, message text, type text, related_id integer, action_url text, is_read boolean DEFAULT false, read_at timestamp);`);
    await pg.exec(readFileSync(new URL("../drizzle/0060_medicao_email.sql", import.meta.url), "utf8"));
    const real = drizzle(pg);
    const fake = {
      select: () => ({ from: (table: unknown) => table === constructionProjects
        ? { where: () => ({ limit: async () => [{ id: 10, title: "Obra Teste" }] }) }
        : real.select().from(table as never) }),
      update: real.update.bind(real), execute: real.execute.bind(real),
      batch: async (ops: { execute(): Promise<unknown> }[]) => {
        await pg.exec("BEGIN");
        try { const resultados = []; for (const op of ops) resultados.push(await op.execute()); await pg.exec("COMMIT"); return resultados; }
        catch (e) { await pg.exec("ROLLBACK"); throw e; }
      },
    };
    vi.spyOn(banco, "getDb").mockReturnValue(fake as never);
    const send = vi.spyOn(email, "sendEmail").mockResolvedValue(false);
    const caller = obraProgressoRouter.createCaller({ user: { id: 1, role: "admin", active: true, name: "Admin" }, req: {}, res: {} } as never);
    expect(await caller.solicitarMedicao({ medicaoId: 1 })).toMatchObject({ success: true, aviso: expect.stringContaining("não foi enviado") });
    const [primeira] = await real.select().from(constructionProgressHistory).where(eq(constructionProgressHistory.id, 1));
    expect(primeira.requestEmailStatus).toBe("failed");
    expect((await pg.query("SELECT user_id, action_url FROM user_notifications")).rows).toEqual([{ user_id: 1, action_url: "/admin/obras/editar/10" }]);
    send.mockResolvedValue(true);
    expect(await caller.solicitarMedicao({ medicaoId: 1 })).toMatchObject({ success: true, aviso: undefined });
    const [segunda] = await real.select().from(constructionProgressHistory).where(eq(constructionProgressHistory.id, 1));
    expect(segunda.requestEmailStatus).toBe("sent");
    expect(segunda.requestedAt).toEqual(primeira.requestedAt);
    expect((await pg.query("SELECT count(*)::int AS n FROM user_notifications")).rows).toEqual([{ n: 1 }]);
    await expect(caller.solicitarMedicao({ medicaoId: 1 })).rejects.toThrow("já foi enviada");
    expect(send).toHaveBeenCalledTimes(2);
    await pg.exec("UPDATE user_notifications SET is_read = true");
    await invalidarAnexosMedicao(1);
    expect((await real.select().from(constructionProgressHistory))[0].requestEmailStatus).toBe("pending");
    expect(await caller.solicitarMedicao({ medicaoId: 1 })).toMatchObject({ success: true });
    expect(send).toHaveBeenCalledTimes(3);
    expect((await pg.query("SELECT user_id, is_read FROM user_notifications")).rows).toEqual([{ user_id: 1, is_read: false }]);
    expect((await real.select().from(constructionProgressHistory))[0].requestedAt).toEqual(primeira.requestedAt);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ to: "atendimento@prospectaconstrucoes.com", attachments: [expect.objectContaining({ filename: "PLS.pdf", contentType: "application/pdf" })] }));
  } finally { vi.restoreAllMocks(); await pg.close(); }
}, 30_000);
