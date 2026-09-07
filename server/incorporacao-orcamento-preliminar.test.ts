import { describe, it, expect } from "vitest";
import { resumoOrcamentoPreliminar, orcamentoPreliminarPreenchidoDoJson, type ItemOrcamentoPreliminar } from "../shared/incorporacao/orcamento-preliminar";

function item(overrides: Partial<ItemOrcamentoPreliminar> = {}): ItemOrcamentoPreliminar {
  return { id: "1", categoria: "Estrutura", valorOrcado: 0, ...overrides };
}

describe("resumoOrcamentoPreliminar", () => {
  it("soma o total orçado de todos os itens", () => {
    const r = resumoOrcamentoPreliminar([item({ valorOrcado: 1000 }), item({ valorOrcado: 500 })]);
    expect(r.totalOrcado).toBe(1500);
  });

  it("retorna referência e variação nulas quando não há referência", () => {
    const r = resumoOrcamentoPreliminar([item({ valorOrcado: 1000 })], null);
    expect(r.custoParametrizadoReferencia).toBeNull();
    expect(r.variacaoPct).toBeNull();
  });

  it("calcula a variação percentual em relação à referência", () => {
    const r = resumoOrcamentoPreliminar([item({ valorOrcado: 1100 })], 1000);
    expect(r.custoParametrizadoReferencia).toBe(1000);
    expect(r.variacaoPct).toBeCloseTo(10, 6);
  });

  it("calcula variação negativa quando o orçado é menor que a referência", () => {
    const r = resumoOrcamentoPreliminar([item({ valorOrcado: 800 })], 1000);
    expect(r.variacaoPct).toBeCloseTo(-20, 6);
  });
});

describe("orcamentoPreliminarPreenchidoDoJson", () => {
  it("retorna false para JSON nulo/inválido/sem itens com valor", () => {
    expect(orcamentoPreliminarPreenchidoDoJson(null)).toBe(false);
    expect(orcamentoPreliminarPreenchidoDoJson("{invalid")).toBe(false);
    expect(orcamentoPreliminarPreenchidoDoJson(JSON.stringify({ itens: [item({ valorOrcado: 0 })] }))).toBe(false);
  });
  it("retorna true quando algum item tem valor orçado", () => {
    expect(orcamentoPreliminarPreenchidoDoJson(JSON.stringify({ itens: [item({ valorOrcado: 500 })] }))).toBe(true);
  });
});
