import { describe, it, expect } from "vitest";
import { resumoFornecedoresLancamento, fornecedoresTodosContratadosDoJson, type FornecedorLancamento } from "../shared/incorporacao/fornecedores-lancamento";

function fornecedor(overrides: Partial<FornecedorLancamento> = {}): FornecedorLancamento {
  return { id: "1", categoria: "Agência de Publicidade", nome: "Fornecedor", valorContratado: 0, status: "nao_contratado", ...overrides };
}

describe("resumoFornecedoresLancamento", () => {
  it("conta contratados incluindo entregues", () => {
    const r = resumoFornecedoresLancamento([fornecedor({ status: "contratado" }), fornecedor({ status: "entregue" }), fornecedor({ status: "orcamento" })]);
    expect(r.contratados).toBe(2);
  });

  it("soma o valor total contratado apenas dos contratados/entregues", () => {
    const r = resumoFornecedoresLancamento([
      fornecedor({ status: "contratado", valorContratado: 1000 }),
      fornecedor({ status: "entregue", valorContratado: 500 }),
      fornecedor({ status: "orcamento", valorContratado: 9999 }),
    ]);
    expect(r.valorTotalContratado).toBe(1500);
  });
});

describe("fornecedoresTodosContratadosDoJson", () => {
  it("retorna false para JSON nulo/inválido/vazio", () => {
    expect(fornecedoresTodosContratadosDoJson(null)).toBe(false);
    expect(fornecedoresTodosContratadosDoJson("{invalid")).toBe(false);
    expect(fornecedoresTodosContratadosDoJson(JSON.stringify({ fornecedores: [] }))).toBe(false);
  });
  it("retorna true somente quando todos estão contratados ou entregues", () => {
    const todos = JSON.stringify({ fornecedores: [fornecedor({ status: "contratado" }), fornecedor({ status: "entregue" })] });
    expect(fornecedoresTodosContratadosDoJson(todos)).toBe(true);
    const parcial = JSON.stringify({ fornecedores: [fornecedor({ status: "contratado" }), fornecedor({ status: "orcamento" })] });
    expect(fornecedoresTodosContratadosDoJson(parcial)).toBe(false);
  });
});
