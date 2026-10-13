import { describe, expect, it } from "vitest";
import { mensagemValidacao } from "../shared/erro-validacao";
import { projectInput } from "../shared/operacional";

const base = { name: "Projeto Casa", types: ["projeto_arquitetonico"], status: "orcamento", clientName: "João Silva", clientPhone: "", engineerUserId: 7, value: 1000, paidValue: 0, deadline: null, leadId: null, description: "", checklist: [], files: [] };

describe("validação de Projetos sem JSON técnico (item 07)", () => {
  it("tipos vazios: frase clara, sem JSON", () => {
    const r = projectInput.safeParse({ ...base, types: [] });
    expect(r.success).toBe(false);
    const msg = mensagemValidacao((r as { error: { issues: never } }).error.issues);
    expect(msg).toBe('Selecione ao menos uma opção em "Tipos de projeto".');
    expect(msg).not.toMatch(/too_small|\[|\{/);
  });
  it("engenheiro por ID é aceito sem texto livre", () => {
    const r = projectInput.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.success && r.data.engineer).toBe("");
  });
  it("outros códigos viram frases com o nome do campo", () => {
    expect(mensagemValidacao([{ path: ["name"], code: "too_small", type: "string", minimum: 2 }])).toBe('"Nome" precisa ter ao menos 2 caracteres.');
    expect(mensagemValidacao([{ path: ["status"], code: "invalid_value" }])).toBe('Escolha uma opção válida em "Situação".');
    expect(mensagemValidacao([{ path: ["data", "value"], code: "invalid_type" }])).toBe('Preencha corretamente o campo "Valor".');
    expect(mensagemValidacao([{ path: ["paidValue"], code: "custom", message: "Valor pago não pode superar o valor do projeto" }])).toBe("Valor pago não pode superar o valor do projeto");
  });
});
