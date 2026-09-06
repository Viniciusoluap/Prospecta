import { describe, it, expect } from "vitest";
import { resumoNegociacao, valorEstimadoProposta, negociacaoFechadaDoJson, type DadosNegociacao, type Proposta } from "../shared/incorporacao/negociacao";

function proposta(overrides: Partial<Proposta> = {}): Proposta {
  return {
    id: "1",
    data: "2026-01-01",
    autor: "grupo",
    tipo: "compra_avista",
    status: "enviada",
    ...overrides,
  };
}

describe("valorEstimadoProposta", () => {
  it("usa o valor total para compra à vista", () => {
    expect(valorEstimadoProposta(proposta({ tipo: "compra_avista", valorTotal: 500_000 }), 0)).toBe(500_000);
  });

  it("calcula a permuta financeira como percentual do VGV bruto", () => {
    const p = proposta({ tipo: "permuta_financeira", permutaPctVgv: 10 });
    expect(valorEstimadoProposta(p, 1_000_000)).toBe(100_000);
  });

  it("retorna zero para permuta financeira sem VGV bruto informado", () => {
    const p = proposta({ tipo: "permuta_financeira", permutaPctVgv: 10 });
    expect(valorEstimadoProposta(p, 0)).toBe(0);
  });
});

describe("resumoNegociacao", () => {
  it("retorna resumo vazio sem propostas", () => {
    const dados: DadosNegociacao = { proprietarioNome: "", proprietarioContato: "", vgvGrossManual: 0, propostas: [] };
    const r = resumoNegociacao(dados);
    expect(r.totalPropostas).toBe(0);
    expect(r.propostaAtual).toBeNull();
    expect(r.fechada).toBe(false);
  });

  it("identifica a proposta mais recente por data como a atual", () => {
    const dados: DadosNegociacao = {
      proprietarioNome: "", proprietarioContato: "", vgvGrossManual: 0,
      propostas: [proposta({ id: "a", data: "2026-01-01" }), proposta({ id: "b", data: "2026-03-01" })],
    };
    const r = resumoNegociacao(dados);
    expect(r.propostaAtual?.id).toBe("b");
  });

  it("marca a negociação como fechada quando há proposta aceita", () => {
    const dados: DadosNegociacao = {
      proprietarioNome: "", proprietarioContato: "", vgvGrossManual: 0,
      propostas: [proposta({ status: "aceita", valorTotal: 200_000 })],
    };
    const r = resumoNegociacao(dados);
    expect(r.fechada).toBe(true);
    expect(r.valorEstimadoAtual).toBe(200_000);
  });
});

describe("negociacaoFechadaDoJson", () => {
  it("retorna false para JSON nulo/vazio/inválido", () => {
    expect(negociacaoFechadaDoJson(null)).toBe(false);
    expect(negociacaoFechadaDoJson("")).toBe(false);
    expect(negociacaoFechadaDoJson("{invalid")).toBe(false);
  });
  it("retorna true quando alguma proposta está aceita", () => {
    const json = JSON.stringify({ propostas: [proposta({ status: "aceita" })] });
    expect(negociacaoFechadaDoJson(json)).toBe(true);
  });
  it("retorna false quando nenhuma proposta está aceita", () => {
    const json = JSON.stringify({ propostas: [proposta({ status: "enviada" })] });
    expect(negociacaoFechadaDoJson(json)).toBe(false);
  });
});
