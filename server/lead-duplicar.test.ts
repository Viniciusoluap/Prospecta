import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { getDb } from "./db.js";
import { duplicarLead } from "./lead-duplicar.js";
import { MODELO_NOTA_LEAD_NOVO, preencherModelo, textoConfirmacaoDuplicar } from "../shared/lead-duplicar.js";

vi.mock("./db.js", () => ({ getDb: vi.fn() }));

function fakeDb(linhas: Array<Record<string, unknown>>) {
  const consultas: string[] = [];
  vi.mocked(getDb).mockReturnValue({
    execute: async (q: SQL) => { consultas.push(new PgDialect().sqlToQuery(q).sql); return { rows: linhas }; },
  } as never);
  return consultas;
}

describe("Duplicar lead (etapa 6)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("uma única instrução: lead novo + documentos ativos + arquivos do banco + notas, sem serviços", async () => {
    const consultas = fakeDb([{ id: 70, origem_nome: "Maria", documentos: 2, arquivos: 1 }]);
    expect(await duplicarLead(14, { id: 1, nome: "Ana" })).toEqual({ id: 70, documentos: 2 });
    expect(consultas).toHaveLength(1);
    const q = consultas[0];
    expect(q).toMatch(/INSERT INTO leads/);
    expect(q).toMatch(/'lead_new', false, id, now\(\)/);
    expect(q).toMatch(/INSERT INTO lead_documents[\s\S]*SELECT novo\.id, NULL, d\.type/);
    expect(q).toMatch(/d\.deleted_at IS NULL/);
    expect(q).toMatch(/INSERT INTO lead_document_file_data/);
    expect(q).toMatch(/copied_from_document_id/);
    for (const proibido of ["lead_services", "tasks", "financiamentos", "construction_projects", "regularizacoes", "operational_projects", "portal_contracts", "users SET", "DELETE"])
      expect(q).not.toContain(proibido);
  });

  it("lead inexistente ou excluído: erro claro e nada criado", async () => {
    fakeDb([]);
    await expect(duplicarLead(999, { id: 1, nome: "Ana" })).rejects.toThrow("Lead não encontrado ou excluído.");
  });

  it("textos", () => {
    expect(textoConfirmacaoDuplicar("Maria")).toMatch(/Não são copiados: serviços/);
    expect(preencherModelo(MODELO_NOTA_LEAD_NOVO, 14, "Maria", 2)).toBe("Lead criado por duplicação do lead nº 14 (Maria); 2 documento(s) copiado(s).");
  });
});
