import { describe, it, expect } from "vitest";
import { resumoRegistro, registroCompletoDoJson, DOCUMENTOS_PADRAO_REGISTRO, type DocumentoRegistro } from "../shared/incorporacao/registro-incorporacao";

function doc(overrides: Partial<DocumentoRegistro> = {}): DocumentoRegistro {
  return { id: "1", nome: "Documento", status: "pendente", ...overrides };
}

describe("DOCUMENTOS_PADRAO_REGISTRO", () => {
  it("tem os 13 documentos exigidos pelo art. 32 da Lei 4.591/64", () => {
    expect(DOCUMENTOS_PADRAO_REGISTRO).toHaveLength(13);
  });
});

describe("resumoRegistro", () => {
  it("conta obtidos, em providência e pendentes corretamente", () => {
    const r = resumoRegistro([doc({ status: "obtido" }), doc({ status: "em_providencia" }), doc({ status: "pendente" })]);
    expect(r.total).toBe(3);
    expect(r.obtidos).toBe(1);
    expect(r.emProvidencia).toBe(1);
    expect(r.pendentes).toHaveLength(1);
  });

  it("calcula o percentual obtido", () => {
    const r = resumoRegistro([doc({ status: "obtido" }), doc({ status: "obtido" }), doc({ status: "pendente" }), doc({ status: "pendente" })]);
    expect(r.pctObtido).toBe(50);
  });

  it("retorna zero para lista vazia", () => {
    const r = resumoRegistro([]);
    expect(r.pctObtido).toBe(0);
  });
});

describe("registroCompletoDoJson", () => {
  it("retorna false para JSON nulo/inválido/vazio", () => {
    expect(registroCompletoDoJson(null)).toBe(false);
    expect(registroCompletoDoJson("{invalid")).toBe(false);
    expect(registroCompletoDoJson(JSON.stringify({ documentos: [] }))).toBe(false);
  });
  it("retorna true somente quando todos os documentos estão obtidos", () => {
    const todos = JSON.stringify({ documentos: [doc({ status: "obtido" })] });
    expect(registroCompletoDoJson(todos)).toBe(true);
    const parcial = JSON.stringify({ documentos: [doc({ status: "obtido" }), doc({ status: "pendente" })] });
    expect(registroCompletoDoJson(parcial)).toBe(false);
  });
});
