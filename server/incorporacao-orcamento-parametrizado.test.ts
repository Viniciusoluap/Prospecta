import { describe, it, expect } from "vitest";
import { calcularOrcamentoParametrizado, type PremissasOrcamentoParametrizado } from "../shared/incorporacao/orcamento-parametrizado";

function premissas(overrides: Partial<PremissasOrcamentoParametrizado> = {}): PremissasOrcamentoParametrizado {
  return {
    itens: [{ pavimento: "Torre padrão", areaM2: 1000, coeficienteEquivalencia: 1 }],
    custoM2Equivalente: 2500,
    passivoAmbiental: 0,
    decoracaoEquipamentos: 0,
    projetos: 0,
    previsaoInfra: 0,
    outros: 0,
    ...overrides,
  };
}

describe("calcularOrcamentoParametrizado", () => {
  it("calcula a área equivalente aplicando o coeficiente por item", () => {
    const r = calcularOrcamentoParametrizado(premissas({
      itens: [
        { pavimento: "Torre", areaM2: 1000, coeficienteEquivalencia: 1 },
        { pavimento: "Garagem", areaM2: 400, coeficienteEquivalencia: 0.5 },
      ],
    }));
    expect(r.itens[0].areaEquivalenteM2).toBe(1000);
    expect(r.itens[1].areaEquivalenteM2).toBe(200);
    expect(r.areaTotalM2).toBe(1400);
    expect(r.areaEquivalenteTotalM2).toBe(1200);
  });

  it("calcula o custo de obra base a partir do custo/m² equivalente", () => {
    const r = calcularOrcamentoParametrizado(premissas());
    expect(r.custoObraBase).toBe(2500 * 1000);
  });

  it("soma todos os custos adicionais no custo total", () => {
    const r = calcularOrcamentoParametrizado(premissas({
      passivoAmbiental: 10_000, decoracaoEquipamentos: 20_000, projetos: 30_000, previsaoInfra: 40_000, outros: 5_000,
    }));
    expect(r.custoTotal).toBe(r.custoObraBase + 10_000 + 20_000 + 30_000 + 40_000 + 5_000);
  });

  it("calcula o custo/m² real sobre a área total (não equivalente)", () => {
    const r = calcularOrcamentoParametrizado(premissas());
    expect(r.custoM2Real).toBeCloseTo(r.custoTotal / r.areaTotalM2, 6);
  });

  it("retorna custo/m² real zero quando não há área", () => {
    const r = calcularOrcamentoParametrizado(premissas({ itens: [] }));
    expect(r.custoM2Real).toBe(0);
  });
});
