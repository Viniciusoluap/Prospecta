import { describe, it, expect } from "vitest";
import { calcularPotencial, PARAMETROS_DEFAULT } from "../shared/incorporacao/urbanismo";

describe("calcularPotencial", () => {
  it("calcula área edificável e projeção máxima a partir da área do terreno", () => {
    const r = calcularPotencial(1000, PARAMETROS_DEFAULT);
    expect(r.areaEdificavelMaxM2).toBeCloseTo(1000 * PARAMETROS_DEFAULT.coefAproveitamento, 6);
    expect(r.projecaoMaxTerreoM2).toBeCloseTo(1000 * PARAMETROS_DEFAULT.taxaOcupacao, 6);
  });

  it("desconta institucional + área verde + viário da área loteável líquida", () => {
    const r = calcularPotencial(1000, PARAMETROS_DEFAULT);
    const fracaoDoacao = PARAMETROS_DEFAULT.percentInstitucional + PARAMETROS_DEFAULT.percentAreaVerde + PARAMETROS_DEFAULT.percentViario;
    expect(r.areaDoacaoM2).toBeCloseTo(1000 * fracaoDoacao, 6);
    expect(r.areaLoteavelLiquidaM2).toBeCloseTo(1000 - r.areaDoacaoM2, 6);
  });

  it("calcula lotes máximos por divisão inteira da área loteável pelo lote mínimo", () => {
    const r = calcularPotencial(10_000, { ...PARAMETROS_DEFAULT, loteMinimoM2: 300, percentInstitucional: 0, percentAreaVerde: 0, percentViario: 0 });
    expect(r.lotesMax).toBe(Math.floor(10_000 / 300));
  });

  it("retorna null para unidades/vagas quando a área média da unidade não é informada", () => {
    const r = calcularPotencial(1000, PARAMETROS_DEFAULT);
    expect(r.unidadesMaxVertical).toBeNull();
    expect(r.vagasExigidas).toBeNull();
  });

  it("calcula unidades máximas e vagas exigidas quando a área média é informada", () => {
    const r = calcularPotencial(1000, { ...PARAMETROS_DEFAULT, coefAproveitamento: 2, vagasPorUnidade: 1.5 }, 80);
    expect(r.unidadesMaxVertical).toBe(Math.floor((1000 * 2) / 80));
    expect(r.vagasExigidas).toBe(Math.ceil((r.unidadesMaxVertical as number) * 1.5));
  });

  it("nunca deixa a fração de doação passar de 100% da área", () => {
    const r = calcularPotencial(1000, { ...PARAMETROS_DEFAULT, percentInstitucional: 0.6, percentAreaVerde: 0.6, percentViario: 0.6 });
    expect(r.areaDoacaoM2).toBeLessThanOrEqual(1000);
    expect(r.areaLoteavelLiquidaM2).toBeGreaterThanOrEqual(0);
  });
});
