import { describe, it, expect } from "vitest";
import { taxaMensalEquivalente, calcularFonteCaptacao, calcularBusinessPlan, businessPlanPreenchidoDoJson, type FonteCaptacao } from "../shared/incorporacao/captacao";

function fonte(overrides: Partial<FonteCaptacao> = {}): FonteCaptacao {
  return {
    id: "1",
    nome: "Fundo X",
    capitalAportado: 100_000,
    remuneracaoPct: 1,
    periodoRemuneracao: "mensal",
    prazoResgateMeses: 12,
    ...overrides,
  };
}

describe("taxaMensalEquivalente", () => {
  it("retorna a própria taxa quando o período já é mensal", () => {
    expect(taxaMensalEquivalente(2, "mensal")).toBeCloseTo(0.02, 6);
  });
  it("converte taxa anual para sua equivalente mensal composta", () => {
    const anual = 0.12;
    const mensal = taxaMensalEquivalente(12, "anual");
    expect(Math.pow(1 + mensal, 12)).toBeCloseTo(1 + anual, 6);
  });
});

describe("calcularFonteCaptacao", () => {
  it("calcula o valor de resgate com juros compostos", () => {
    const r = calcularFonteCaptacao(fonte({ capitalAportado: 100_000, remuneracaoPct: 1, periodoRemuneracao: "mensal", prazoResgateMeses: 12 }));
    expect(r.valorResgate).toBeCloseTo(100_000 * Math.pow(1.01, 12), 2);
    expect(r.custoTotal).toBeCloseTo(r.valorResgate - 100_000, 6);
  });

  it("não aumenta o valor de resgate para prazo zero", () => {
    const r = calcularFonteCaptacao(fonte({ prazoResgateMeses: 0 }));
    expect(r.valorResgate).toBe(fonte().capitalAportado);
  });
});

describe("calcularBusinessPlan", () => {
  it("soma o capital captado e o custo total de todas as fontes", () => {
    const r = calcularBusinessPlan([fonte({ id: "a", capitalAportado: 100_000 }), fonte({ id: "b", capitalAportado: 50_000 })]);
    expect(r.capitalTotalCaptado).toBe(150_000);
    expect(r.custoTotalCaptacao).toBeGreaterThan(0);
  });

  it("retorna percentuais nulos quando o investimento total não é informado", () => {
    const r = calcularBusinessPlan([fonte()], null);
    expect(r.pctDoInvestimentoTotal).toBeNull();
    expect(r.capitalProprioNecessario).toBeNull();
  });

  it("calcula o percentual captado e o capital próprio necessário quando há investimento total", () => {
    const r = calcularBusinessPlan([fonte({ capitalAportado: 200_000 })], 1_000_000);
    expect(r.pctDoInvestimentoTotal).toBeCloseTo(20, 6);
    expect(r.capitalProprioNecessario).toBeCloseTo(800_000, 6);
  });
});

describe("businessPlanPreenchidoDoJson", () => {
  it("retorna false para JSON nulo/inválido/sem fontes com capital", () => {
    expect(businessPlanPreenchidoDoJson(null)).toBe(false);
    expect(businessPlanPreenchidoDoJson("{invalid")).toBe(false);
    expect(businessPlanPreenchidoDoJson(JSON.stringify({ fontes: [fonte({ capitalAportado: 0 })] }))).toBe(false);
  });
  it("retorna true quando alguma fonte tem capital aportado", () => {
    expect(businessPlanPreenchidoDoJson(JSON.stringify({ fontes: [fonte({ capitalAportado: 1000 })] }))).toBe(true);
  });
});
