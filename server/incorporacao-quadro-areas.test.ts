import { describe, it, expect } from "vitest";
import { calcularQuadroAreas, type ItemQuadroAreas } from "../shared/incorporacao/quadro-areas";

function item(overrides: Partial<ItemQuadroAreas> = {}): ItemQuadroAreas {
  return {
    pavimento: "Torre A",
    areaConstCobertaM2: 100,
    areaConstDescobertaM2: 20,
    areaUrbanizadaM2: 10,
    areaDescontarM2: 5,
    areaComputavelM2: 90,
    areaPrivativaM2: 80,
    ...overrides,
  };
}

describe("calcularQuadroAreas", () => {
  it("soma os totais de cada coluna entre os pavimentos", () => {
    const r = calcularQuadroAreas([item(), item()], 1000, 1.2);
    expect(r.areaConstCobertaTotalM2).toBe(200);
    expect(r.areaConstDescobertaTotalM2).toBe(40);
    expect(r.areaConstTotalM2).toBe(240);
    expect(r.areaPrivativaTotalM2).toBe(160);
    expect(r.areaComputavelTotalM2).toBe(180);
  });

  it("calcula o índice de eficiência APV/ACC", () => {
    const r = calcularQuadroAreas([item({ areaConstCobertaM2: 100, areaPrivativaM2: 80 })], 1000, 1.2);
    expect(r.indiceApvAcc).toBeCloseTo(0.8, 6);
  });

  it("retorna zero de eficiência quando não há área construída coberta", () => {
    const r = calcularQuadroAreas([item({ areaConstCobertaM2: 0, areaPrivativaM2: 0 })], 1000, 1.2);
    expect(r.indiceApvAcc).toBe(0);
  });

  it("calcula a área computável máxima a partir do coeficiente de aproveitamento", () => {
    const r = calcularQuadroAreas([], 1000, 1.5);
    expect(r.areaComputavelMaximaM2).toBe(1500);
  });

  it("sinaliza excedeCoeficiente quando a área computável total ultrapassa a máxima", () => {
    const r = calcularQuadroAreas([item({ areaComputavelM2: 2000 })], 1000, 1.0);
    expect(r.excedeCoeficiente).toBe(true);
    expect(r.aproveitamentoPct).toBeGreaterThan(1);
  });

  it("não sinaliza excesso quando dentro do coeficiente", () => {
    const r = calcularQuadroAreas([item({ areaComputavelM2: 500 })], 1000, 1.0);
    expect(r.excedeCoeficiente).toBe(false);
  });
});
