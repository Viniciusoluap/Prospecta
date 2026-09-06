import { describe, it, expect } from "vitest";
import { resumoPesquisaPrimaria, pesquisaPrimariaPreenchidaDoJson, type Entrevistado } from "../shared/incorporacao/pesquisa-primaria";

function entrevistado(overrides: Partial<Entrevistado> = {}): Entrevistado {
  return {
    id: Math.random().toString(36).slice(2),
    nome: "Fulano",
    faixaEtaria: "26-35",
    faixaRenda: "4_8sm",
    temImovelProprio: false,
    interesseComprar12Meses: true,
    tiposInteresse: ["apartamento"],
    notaApartamento: 4,
    notaCasaCondominio: 3,
    notaCasaRuaAberta: 2,
    tamanhoIdealM2: 70,
    quartosNecessarios: 2,
    itensImportancia: {},
    ...overrides,
  };
}

describe("resumoPesquisaPrimaria", () => {
  it("retorna resumo zerado para lista vazia", () => {
    const r = resumoPesquisaPrimaria([]);
    expect(r.totalEntrevistados).toBe(0);
    expect(r.pctInteresseComprar12Meses).toBe(0);
    expect(r.tamanhoIdealMedioM2).toBe(0);
  });

  it("calcula percentuais e médias corretamente", () => {
    const entrevistados = [
      entrevistado({ interesseComprar12Meses: true, tamanhoIdealM2: 60 }),
      entrevistado({ interesseComprar12Meses: false, tamanhoIdealM2: 80 }),
    ];
    const r = resumoPesquisaPrimaria(entrevistados);
    expect(r.totalEntrevistados).toBe(2);
    expect(r.pctInteresseComprar12Meses).toBe(50);
    expect(r.tamanhoIdealMedioM2).toBe(70);
  });

  it("calcula a moda de quartos necessários", () => {
    const entrevistados = [
      entrevistado({ quartosNecessarios: 2 }),
      entrevistado({ quartosNecessarios: 2 }),
      entrevistado({ quartosNecessarios: 3 }),
    ];
    const r = resumoPesquisaPrimaria(entrevistados);
    expect(r.quartosModaNecessarios).toBe(2);
  });

  it("ranqueia itens de condomínio por importância decrescente", () => {
    const entrevistados = [
      entrevistado({ itensImportancia: { Piscina: "importante_paga_mais" } }),
      entrevistado({ itensImportancia: { Piscina: "importante_paga_mais" } }),
      entrevistado({ itensImportancia: { Varanda: "importante_paga_mais" } }),
    ];
    const r = resumoPesquisaPrimaria(entrevistados);
    expect(r.rankingItens[0].item).toBe("Piscina");
    expect(r.rankingItens[0].pctImportantePagaMais).toBeCloseTo(66.7, 1);
  });
});

describe("pesquisaPrimariaPreenchidaDoJson", () => {
  it("retorna false para JSON nulo ou vazio", () => {
    expect(pesquisaPrimariaPreenchidaDoJson(null)).toBe(false);
    expect(pesquisaPrimariaPreenchidaDoJson("")).toBe(false);
  });
  it("retorna false para JSON inválido", () => {
    expect(pesquisaPrimariaPreenchidaDoJson("{not json")).toBe(false);
  });
  it("retorna false para lista vazia de entrevistados", () => {
    expect(pesquisaPrimariaPreenchidaDoJson(JSON.stringify({ entrevistados: [] }))).toBe(false);
  });
  it("retorna true quando há ao menos um entrevistado", () => {
    expect(pesquisaPrimariaPreenchidaDoJson(JSON.stringify({ entrevistados: [entrevistado()] }))).toBe(true);
  });
});
