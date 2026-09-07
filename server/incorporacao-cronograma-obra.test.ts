import { describe, it, expect } from "vitest";
import { avancoFinanceiroProjetado, resumoCronogramaObra, obraConcluidaDoJson, type MedicaoMensal } from "../shared/incorporacao/cronograma-obra";

function medicao(overrides: Partial<MedicaoMensal> = {}): MedicaoMensal {
  return { id: "1", mes: 0, avancoFisicoAcumuladoPct: 0, ...overrides };
}

describe("avancoFinanceiroProjetado", () => {
  it("retorna null sem duração de obra", () => {
    expect(avancoFinanceiroProjetado(0, 0)).toBeNull();
    expect(avancoFinanceiroProjetado(0, -1)).toBeNull();
  });
  it("projeta o avanço linear ao longo da obra", () => {
    expect(avancoFinanceiroProjetado(0, 10)).toBeCloseTo(10, 6);
    expect(avancoFinanceiroProjetado(9, 10)).toBeCloseTo(100, 6);
  });
  it("nunca ultrapassa 100%", () => {
    expect(avancoFinanceiroProjetado(20, 10)).toBe(100);
  });
});

describe("resumoCronogramaObra", () => {
  it("ordena as medições por mês antes de calcular", () => {
    const r = resumoCronogramaObra([medicao({ mes: 2, avancoFisicoAcumuladoPct: 50 }), medicao({ mes: 0, avancoFisicoAcumuladoPct: 10 })], 10);
    expect(r.itens.map((i) => i.mes)).toEqual([0, 2]);
    expect(r.avancoFisicoAtualPct).toBe(50);
  });

  it("calcula o desvio entre físico e financeiro projetado", () => {
    const r = resumoCronogramaObra([medicao({ mes: 0, avancoFisicoAcumuladoPct: 20 })], 10);
    expect(r.itens[0].avancoFinanceiroProjetadoPct).toBeCloseTo(10, 6);
    expect(r.itens[0].desvioPct).toBeCloseTo(10, 6);
  });

  it("marca obra concluída quando o último avanço físico atinge 100%", () => {
    const r = resumoCronogramaObra([medicao({ mes: 0, avancoFisicoAcumuladoPct: 100 })], 5);
    expect(r.obraConcluida).toBe(true);
  });

  it("retorna nulos quando não há duração de obra informada", () => {
    const r = resumoCronogramaObra([medicao({ mes: 0, avancoFisicoAcumuladoPct: 20 })], null);
    expect(r.itens[0].avancoFinanceiroProjetadoPct).toBeNull();
    expect(r.itens[0].desvioPct).toBeNull();
  });
});

describe("obraConcluidaDoJson", () => {
  it("retorna false para JSON nulo/inválido/vazio", () => {
    expect(obraConcluidaDoJson(null)).toBe(false);
    expect(obraConcluidaDoJson("{invalid")).toBe(false);
    expect(obraConcluidaDoJson(JSON.stringify({ medicoes: [] }))).toBe(false);
  });
  it("retorna true quando a última medição indica 100% físico", () => {
    const json = JSON.stringify({ medicoes: [medicao({ mes: 0, avancoFisicoAcumuladoPct: 100 })] });
    expect(obraConcluidaDoJson(json)).toBe(true);
  });
});
