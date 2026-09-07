import { describe, it, expect } from "vitest";
import { resumoOrcamentoObra, orcamentoObraPreenchidoDoJson, type ItemOrcamentoObra } from "../shared/incorporacao/orcamento-obra";

function item(overrides: Partial<ItemOrcamentoObra> = {}): ItemOrcamentoObra {
  return { id: "1", categoria: "Estrutura", valorOrcado: 0, valorRealizado: 0, ...overrides };
}

describe("resumoOrcamentoObra", () => {
  it("soma orçado e realizado de todos os itens", () => {
    const r = resumoOrcamentoObra([item({ valorOrcado: 1000, valorRealizado: 500 }), item({ valorOrcado: 2000, valorRealizado: 1000 })]);
    expect(r.totalOrcado).toBe(3000);
    expect(r.totalRealizado).toBe(1500);
  });

  it("calcula o percentual executado", () => {
    const r = resumoOrcamentoObra([item({ valorOrcado: 1000, valorRealizado: 500 })]);
    expect(r.pctExecutado).toBe(50);
  });

  it("retorna zero executado sem itens orçados", () => {
    expect(resumoOrcamentoObra([]).pctExecutado).toBe(0);
  });

  it("calcula a variação vs. referência preliminar", () => {
    const r = resumoOrcamentoObra([item({ valorOrcado: 1100 })], 1000);
    expect(r.variacaoVsPreliminarPct).toBeCloseTo(10, 6);
  });
});

describe("orcamentoObraPreenchidoDoJson", () => {
  it("retorna false para JSON nulo/inválido/sem itens realizados", () => {
    expect(orcamentoObraPreenchidoDoJson(null)).toBe(false);
    expect(orcamentoObraPreenchidoDoJson("{invalid")).toBe(false);
    expect(orcamentoObraPreenchidoDoJson(JSON.stringify({ itens: [item({ valorRealizado: 0 })] }))).toBe(false);
  });
  it("retorna true quando algum item tem valor realizado", () => {
    expect(orcamentoObraPreenchidoDoJson(JSON.stringify({ itens: [item({ valorRealizado: 500 })] }))).toBe(true);
  });
});
