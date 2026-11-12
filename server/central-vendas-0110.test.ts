// Central de Vendas — migração 0110 (aditiva e idempotente), em banco em memória (PGlite).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarBanco, sqlMigracao } from "./__fixtures__/central-vendas/banco.js";

let b: Awaited<ReturnType<typeof criarBanco>>;
beforeEach(async () => { b = await criarBanco(); });
afterEach(async () => { await b.pg.close(); });

describe("migração 0110_central_vendas", () => {
  it("aplica duas vezes sem erro e não altera tabelas existentes", async () => {
    await b.pg.exec("INSERT INTO leads (name, phone) VALUES ('Ana', '99999990000')");
    const antes = await b.linhas("SELECT column_name FROM information_schema.columns WHERE table_name = 'leads' ORDER BY 1");
    await b.pg.exec(sqlMigracao());
    const depois = await b.linhas("SELECT column_name FROM information_schema.columns WHERE table_name = 'leads' ORDER BY 1");
    expect(depois).toEqual(antes);
    expect(await b.linhas("SELECT name FROM leads")).toEqual([{ name: "Ana" }]);
    const tabelas = await b.linhas<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'central_vendas_%' ORDER BY 1");
    expect(tabelas.map(t => t.table_name)).toEqual([
      "central_vendas_campanhas", "central_vendas_checklists", "central_vendas_config", "central_vendas_contatos",
      "central_vendas_documentos", "central_vendas_eventos", "central_vendas_fila", "central_vendas_leads",
      "central_vendas_limites", "central_vendas_produtos", "central_vendas_sequencias", "central_vendas_tokens_mes",
    ]);
  });

  it("status com valores válidos, decisão só com humano e um registro por origem + ID externo", async () => {
    await b.pg.exec("INSERT INTO leads (name, phone) VALUES ('Ana', '1'), ('Bia', '2'); INSERT INTO users (\"openId\", role) VALUES ('x', 'admin')");
    await b.pg.exec("INSERT INTO central_vendas_leads (lead_id, origem, id_externo) VALUES (1, 'site', 'abc')");
    await expect(b.pg.exec("INSERT INTO central_vendas_leads (lead_id, origem, id_externo) VALUES (2, 'site', 'abc')")).rejects.toThrow();
    await expect(b.pg.exec("UPDATE central_vendas_leads SET status_analise = 'aprovado' WHERE lead_id = 1")).rejects.toThrow();
    await expect(b.pg.exec("UPDATE central_vendas_leads SET status_atendimento = 'inventado' WHERE lead_id = 1")).rejects.toThrow();
    await b.pg.exec("UPDATE central_vendas_leads SET status_analise = 'aprovado', decisao_por = 1 WHERE lead_id = 1");
    expect(await b.linhas("SELECT status_analise FROM central_vendas_leads")).toEqual([{ status_analise: "aprovado" }]);
    await expect(b.pg.exec("INSERT INTO central_vendas_config (id) VALUES (2)")).rejects.toThrow();
    // Apagar o lead apaga o registro da Central; a auditoria fica (lead_id nulo).
    await b.pg.exec("INSERT INTO central_vendas_eventos (tipo, lead_id) VALUES ('teste', 1); DELETE FROM leads WHERE id = 1");
    expect(await b.linhas("SELECT count(*)::int AS n FROM central_vendas_leads")).toEqual([{ n: 0 }]);
    expect(await b.linhas("SELECT lead_id FROM central_vendas_eventos")).toEqual([{ lead_id: null }]);
  });
});
