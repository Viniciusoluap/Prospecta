import { describe, expect, it } from "vitest";
import { calcularMix, vgvItemMix, type ItemMixProduto } from "../shared/incorporacao/mix-produtos";
import { blocoApartamento, capacidadeTerrenoMix, conferirTerrenoMix } from "../shared/incorporacao/ocupacao-mix";
import { defaultsForm, montarViabilidadeDoEstudo, paraMotor } from "../shared/incorporacao/premissas-loteamento";
import { calcularCenarios, calcularLoteamento } from "../shared/incorporacao/viabilidade-economica";
import { paraEstudoData } from "../shared/incorporacao/estudo-data";
import { linhaEstudo2 } from "./fixtures/estudo-2-daniel-mota";
import { linhasMixRelatorio } from "../client/src/components/incorporacao/estudo/compat/pdf-loteamento";

const apt = (extra: Partial<ItemMixProduto> = {}): ItemMixProduto => ({ nome: "Apartamentos", quantidade: 216,
  apartamento: true, areaUnidadeM2: 1100, precoM2: 500, precoUnidade: 210_000,
  apartamentosPorAndar: 6, andares: 4, areaBlocoM2: 1000, vagasPorBloco: 24, ...extra });
const lotes = (qtd: number, areaM2 = 1100) => Array.from({ length: qtd }, () => ({ areaM2 }));

describe("Apartamento no mix: unidades vendidas e terreno por bloco", () => {
  it("216 apartamentos = 9 blocos, 9.000 m², 9 lotes e VGV de R$ 45.360.000", () => {
    const mix = calcularMix([apt()]);
    expect(blocoApartamento(apt())).toMatchObject({ unidadesPorBloco: 24, blocos: 9, areaTotalM2: 9000 });
    expect(mix).toMatchObject({ totalUnidades: 216, areaVendidaM2: 9000, vgv: 45_360_000 });
    expect(conferirTerrenoMix([apt()], 9895.97, lotes(9))).toMatchObject({ lotesNecessarios: 9,
      excedeLotes: false, excedeArea: false, lotesIncompativeis: false });
    expect(capacidadeTerrenoMix([apt()], 9895.97)).toBe(216);
  });

  it("reserva um bloco completo quando sobra um apartamento", () => {
    expect(blocoApartamento(apt({ quantidade: 217 }))).toMatchObject({ blocos: 10, areaTotalM2: 10000 });
    expect(conferirTerrenoMix([apt({ quantidade: 217 })], 9895.97, lotes(9))).toMatchObject({ excedeLotes: true, excedeArea: true });
    expect(blocoApartamento(apt({ quantidade: 1 }))).toMatchObject({ blocos: 1, areaTotalM2: 1000 });
  });

  it("não inventa fração de bloco na capacidade", () => {
    expect(capacidadeTerrenoMix([apt()], 999)).toBe(0);
    expect(capacidadeTerrenoMix([apt()], 1000)).toBe(24);
    expect(capacidadeTerrenoMix([apt()], 1999)).toBe(24);
    expect(capacidadeTerrenoMix([apt()], 2000)).toBe(48);
  });

  it("soma casas, lotes e blocos sem comparar apartamentos individuais com lotes", () => {
    const casa = { nome: "Casa", casaPronta: true, quantidade: 2, areaUnidadeM2: 200, precoM2: 0, precoUnidade: 300_000 };
    const terreno = { nome: "Lote", quantidade: 1, areaUnidadeM2: 200, precoM2: 500 };
    expect(conferirTerrenoMix([apt({ quantidade: 24 }), casa, terreno], 1600, [...lotes(1, 1000), ...lotes(3, 200)]))
      .toMatchObject({ areaTotalM2: 1600, lotesNecessarios: 4, excedeLotes: false, excedeArea: false, lotesIncompativeis: false });
  });

  it("avisa se um bloco não cabe no lote mesmo com área total suficiente", () => {
    expect(conferirTerrenoMix([apt({ quantidade: 24 })], 2000, lotes(4, 500)).lotesIncompativeis).toBe(true);
  });

  it("limita a capacidade às vagas e sinaliza estacionamento insuficiente", () => {
    const item = apt({ vagasPorBloco: 20 });
    expect(blocoApartamento(item)).toMatchObject({ estacionamentoSuficiente: false, capacidadePorBloco: 20 });
    expect(capacidadeTerrenoMix([item], 9000)).toBe(180);
    expect(item.quantidade).toBe(216); // jamais reduz a quantidade digitada em silêncio
  });

  it("não aceita vagas declaradas como prova de que cabem no terreno", () => {
    expect(blocoApartamento(apt({ areaBlocoM2: 10 }))).toMatchObject({ estacionamentoSuficiente: false, vagasFisicas: 0, capacidadePorBloco: 0 });
    expect(capacidadeTerrenoMix([apt({ areaBlocoM2: 10 })], 1000)).toBe(0);
    expect(blocoApartamento(apt({ areaProjecaoBlocoM2: 500 }))).toMatchObject({ vagasFisicas: 18, vagasUtilizaveis: 18, capacidadePorBloco: 18, estacionamentoSuficiente: false });
    expect(blocoApartamento(apt())).toMatchObject({ vagasFisicas: 26, vagasUtilizaveis: 24, estacionamentoSuficiente: true });
  });

  it("aloca blocos inteiros quando há mais de uma tipologia vertical", () => {
    const pequeno = apt({ quantidade: 12, apartamentosPorAndar: 3, andares: 4, areaBlocoM2: 500, vagasPorBloco: 12 });
    expect(capacidadeTerrenoMix([apt({ quantidade: 24 }), pequeno], 1499)).toBe(24);
    expect(capacidadeTerrenoMix([apt({ quantidade: 24 }), pequeno], 499)).toBe(0);
    expect(capacidadeTerrenoMix([apt({ quantidade: 24 }), pequeno], 1500)).toBe(36);
  });

  it("o PDF mostra preço por apartamento e terreno por bloco em vez dos campos legados", () => {
    const linha = linhasMixRelatorio(calcularMix([apt()]).itens)[0];
    expect(linha[0]).toContain("apartamento");
    expect(linha[1]).toBe("216");
    expect(linha[2]).toContain("9 blocos");
    expect(linha[2]).toContain("9.000,00");
    expect(linha[3]).toContain("210.000,00");
    expect(linha[3]).toContain("/unid.");
    expect(linha[4]).toContain("45.360.000,00");
    expect(linha.join(" ")).not.toContain("1.100,00");
    expect(linha.join(" ")).not.toContain("500,00");
  });

  it("não volta ao padrão quando o usuário zera ou invalida a configuração", () => {
    for (const extra of [{ apartamentosPorAndar: 0 }, { andares: 1.5 }, { areaBlocoM2: 0 }, { areaBlocoM2: Infinity }, { vagasPorBloco: -1 }, { areaProjecaoBlocoM2: 0 }, { areaProjecaoBlocoM2: 1001 }]) {
      expect(blocoApartamento(apt(extra)).valido).toBe(false);
      expect(capacidadeTerrenoMix([apt(extra)], 9000)).toBe(0);
    }
  });

  it("quantidade zero não reserva bloco", () => {
    expect(blocoApartamento(apt({ quantidade: 0 }))).toMatchObject({ blocos: 0, areaTotalM2: 0 });
  });

  it("preserva a conta anterior de casas e lotes e os valores ao alternar", () => {
    const item = apt({ apartamento: false, casaPronta: true });
    expect(calcularMix([item]).areaVendidaM2).toBe(216 * 1100);
    expect(vgvItemMix(item)).toBe(45_360_000);
    expect(vgvItemMix({ ...item, casaPronta: false })).toBe(216 * 1100 * 500);
  });

  it("o motor usa 9.000 m² na infraestrutura e mantém preço por unidade nos três cenários", () => {
    const estudo = paraEstudoData(linhaEstudo2() as never);
    const f = { ...defaultsForm(estudo), areaBrutaM2: 9895.97, pctAreaPublica: 0, pctAreaVerde: 0,
      pctSistemaViario: 0, pctFaixaServidao: 0, custoInfraM2Lote: 50, bdiPct: 0 };
    const p = paraMotor(f, [apt()], 0);
    const r = calcularLoteamento(p);
    expect(r.custoInfra).toBe(450_000);
    expect(r.urbanistico.capacidadeEstimadaUnidades).toBe(216);
    const c = calcularCenarios(p);
    expect(c.conservador.vgvGross).toBe(45_360_000 * 0.9);
    expect(c.agressivo.vgvGross).toBeCloseTo(45_360_000 * 1.1, 2);
  });

  it("salvar e reabrir JSON preserva todos os campos e reconstrói os mesmos resultados", () => {
    const item = apt({ apartamentosPorAndar: 3, andares: 8, vagasPorBloco: 30, areaBlocoM2: 1050 });
    const estudo = paraEstudoData(linhaEstudo2({ lottingJson: JSON.stringify({
      ...defaultsForm(paraEstudoData(linhaEstudo2() as never)), mixModo: "manual", itensMix: [item],
    }) }) as never);
    const salvo = montarViabilidadeDoEstudo(estudo)!;
    expect(salvo.itensMix).toEqual([item]);
    expect(calcularLoteamento(salvo.premissas).mix).toMatchObject({ totalUnidades: 216, areaVendidaM2: 9450, vgv: 45_360_000 });
  });
});
