import { describe, it, expect } from "vitest";
import { calcularMix, mixProdutosPreenchidoDoJson, type ItemMixProduto } from "../shared/incorporacao/mix-produtos";

function item(overrides: Partial<ItemMixProduto> = {}): ItemMixProduto {
  return { nome: "Lote", quantidade: 10, areaUnidadeM2: 300, precoM2: 500, ...overrides };
}

describe("calcularMix", () => {
  it("calcula área total e VGV por item", () => {
    const r = calcularMix([item()]);
    expect(r.itens[0].areaTotalM2).toBe(3000);
    expect(r.itens[0].vgv).toBe(1_500_000);
  });

  it("soma unidades, área vendida e VGV de todos os itens", () => {
    const r = calcularMix([item({ quantidade: 10 }), item({ nome: "Casa", quantidade: 5, areaUnidadeM2: 80, precoM2: 3000 })]);
    expect(r.totalUnidades).toBe(15);
    expect(r.areaVendidaM2).toBe(10 * 300 + 5 * 80);
    expect(r.vgv).toBe(10 * 300 * 500 + 5 * 80 * 3000);
  });

  it("calcula o preço médio por unidade", () => {
    const r = calcularMix([item({ quantidade: 10 })]);
    expect(r.precoMedioUnidade).toBeCloseTo(r.vgv / 10, 6);
  });

  it("retorna zero para lista vazia", () => {
    const r = calcularMix([]);
    expect(r.totalUnidades).toBe(0);
    expect(r.precoMedioUnidade).toBe(0);
  });
});

describe("mixProdutosPreenchidoDoJson", () => {
  it("retorna false para JSON nulo/inválido/sem itens com quantidade", () => {
    expect(mixProdutosPreenchidoDoJson(null)).toBe(false);
    expect(mixProdutosPreenchidoDoJson("{invalid")).toBe(false);
    expect(mixProdutosPreenchidoDoJson(JSON.stringify([item({ quantidade: 0 })]))).toBe(false);
  });
  it("retorna true quando algum item tem quantidade", () => {
    expect(mixProdutosPreenchidoDoJson(JSON.stringify([item({ quantidade: 5 })]))).toBe(true);
  });
});
