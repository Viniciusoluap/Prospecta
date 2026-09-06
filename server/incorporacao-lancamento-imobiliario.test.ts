import { describe, it, expect } from "vitest";
import { resumoLancamentoImobiliario, lancamentoImobiliarioComVendasDoJson, type VendaLancamento } from "../shared/incorporacao/lancamento-imobiliario";

function venda(overrides: Partial<VendaLancamento> = {}): VendaLancamento {
  return { id: "1", unidade: "Lote 1", valorVenda: 100_000, ...overrides };
}

describe("resumoLancamentoImobiliario", () => {
  it("conta unidades vendidas e soma o VGV vendido", () => {
    const r = resumoLancamentoImobiliario([venda({ valorVenda: 100_000 }), venda({ valorVenda: 200_000 })]);
    expect(r.unidadesVendidas).toBe(2);
    expect(r.vgvVendido).toBe(300_000);
  });

  it("retorna percentuais nulos sem projeção", () => {
    const r = resumoLancamentoImobiliario([venda()], null, null);
    expect(r.pctUnidadesVendidas).toBeNull();
    expect(r.pctVgvVendido).toBeNull();
  });

  it("calcula percentuais vendidos vs. projetado", () => {
    const r = resumoLancamentoImobiliario([venda(), venda()], 10, 1_000_000);
    expect(r.pctUnidadesVendidas).toBe(20);
    expect(r.pctVgvVendido).toBeCloseTo(20, 6);
  });
});

describe("lancamentoImobiliarioComVendasDoJson", () => {
  it("retorna false para JSON nulo/inválido/sem vendas", () => {
    expect(lancamentoImobiliarioComVendasDoJson(null)).toBe(false);
    expect(lancamentoImobiliarioComVendasDoJson("{invalid")).toBe(false);
    expect(lancamentoImobiliarioComVendasDoJson(JSON.stringify({ vendas: [] }))).toBe(false);
  });
  it("retorna true quando há ao menos uma venda", () => {
    expect(lancamentoImobiliarioComVendasDoJson(JSON.stringify({ vendas: [venda()] }))).toBe(true);
  });
});
