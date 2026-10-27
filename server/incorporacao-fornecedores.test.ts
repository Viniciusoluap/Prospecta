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

  it("soma o valor total contratado apenas do status contratado", () => {
    const r = resumoFornecedoresLancamento([
      fornecedor({ status: "contratado", valorContratado: 1000 }),
      fornecedor({ status: "entregue", valorContratado: 500 }),
      fornecedor({ status: "orcamento", valorContratado: 9999 }),
    ]);
    expect(r.valorTotalContratado).toBe(1000);
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

// Lote 2: orçamento inclui todos os status; contrato considera apenas Contratado.
it("separa orçamento e contrato, preserva valor legado e acompanha edição/exclusão/status", () => {
  const lista = [
    fornecedor({ id: "1", status: "contratado", valorOrcado: 2000.25, valorContratado: 1800.50 }),
    fornecedor({ id: "2", status: "orcamento", valorOrcado: 500.10, valorContratado: 999 }),
    fornecedor({ id: "3", status: "entregue", valorContratado: 250.20 }),
  ];
  expect(resumoFornecedoresLancamento(lista)).toMatchObject({ valorTotalOrcado: 2750.55, valorTotalContratado: 1800.50 });
  expect(resumoFornecedoresLancamento(lista.slice(1))).toMatchObject({ valorTotalOrcado: 750.30, valorTotalContratado: 0 });
  lista[1].status = "contratado";
  lista[1].valorContratado = 450.25;
  expect(resumoFornecedoresLancamento(lista)).toMatchObject({ valorTotalOrcado: 2750.55, valorTotalContratado: 2250.75 });
  expect(resumoFornecedoresLancamento([fornecedor({ valorOrcado: Number.NaN, valorContratado: Infinity, status: "contratado" })])).toMatchObject({ valorTotalOrcado: 0, valorTotalContratado: 0 });
});
