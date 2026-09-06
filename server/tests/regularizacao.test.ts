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
    expect(procedures["documents.create"]).toBeDefined();
    expect(procedures["documents.upload"]).toBeDefined();
  });
});
