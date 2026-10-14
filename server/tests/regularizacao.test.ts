import { describe, expect, it } from "vitest";
import { regularizacaoDocuments, regularizacoes } from "../../drizzle/schema";
import { regularizacaoRouter } from "../regularizacao-router";

describe("EPIC-004 - Regularização", () => {
  it("exporta as tabelas existentes para o Drizzle", () => {
    expect(regularizacoes).toBeDefined();
    expect(regularizacaoDocuments).toBeDefined();
  });

  it("expõe o router administrativo do workflow", () => {
    const procedures = regularizacaoRouter._def.procedures;
    expect(procedures.list).toBeDefined();
    expect(procedures.get).toBeDefined();
    expect(procedures.create).toBeDefined();
    expect(procedures.update).toBeDefined();
    expect(procedures.remove).toBeDefined();
    // EPIC-020 Lote 6 (31): "Documentos" antigo removido; etapas e financeiro no lugar.
    expect(procedures["documents.create"]).toBeUndefined();
    expect(procedures["documents.upload"]).toBeUndefined();
    expect(procedures["etapas.criar"]).toBeDefined();
    expect(procedures["etapas.mover"]).toBeDefined();
    expect(procedures["financeiro.adicionarRecebimento"]).toBeDefined();
    expect(procedures["financeiro.excluirRecebimento"]).toBeDefined();
    expect(procedures["financeiro.cancelarRecebimento"]).toBeUndefined();
  });
});
