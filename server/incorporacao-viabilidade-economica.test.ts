import { describe, it, expect } from "vitest";
import {
  vpl, tir, payback, pesosCurvaVendas, calcularUrbanistico, calcularLoteamento, calcularCenarios,
  type PremissasLoteamento,
} from "../shared/incorporacao/viabilidade-economica";

function premissasBase(): PremissasLoteamento {
  return {
    areaBrutaM2: 100_000,
    pctAreaPublica: 0.1,
    pctAreaVerde: 0.05,
    pctSistemaViario: 0.25,
    pctAPP: 0,
    pctFaixaServidao: 0,
    itensMix: [{ nome: "Lotes", quantidade: 100, areaUnidadeM2: 300, precoM2: 500 }],
    duracaoVendasMeses: 12,
    perfilVendas: "constante",
    entradaPct: 0.1,
    prazoParcelamentoMeses: 24,
    jurosClienteMensal: 0.005,
    indexacaoMensal: 0.004,
    vendasAVistaPct: 0.1,
    descontoAVistaPct: 0.1,
    inadimplenciaPct: 0.05,
    comissaoPctVgv: 0.05,
    despesasGeraisPctVgv: 0.03,
    impostosPctVgv: 0.0658,
    taxaIncorporacaoPctVgv: 0.01,
    inicioObraMes: 0,
    duracaoObraMeses: 12,
    inicioVendasMes: 6,
    custoInfraM2Lote: 200,
    projetosLicencas: 100_000,
    marketing: 100_000,
    registroPorUnidade: 400,
    contingenciaPctInfra: 0.1,
    bdiPct: 0.1,
    taxaAdministracaoObraPct: 0.1,
    manutencaoPctObra: 0.015,
    inccObraMensal: 0.003,
    permutaPctVgv: 0.2,
    taxaDescontoAnual: 0.12,
  };
}

describe("vpl/tir/payback", () => {
  it("vpl de fluxo constante positivo é positivo", () => {
    expect(vpl([100, 100, 100], 0.01)).toBeGreaterThan(0);
  });
  it("tir encontra raiz para fluxo -100, 60, 60", () => {
    const t = tir([-100, 60, 60]);
    expect(t).not.toBeNull();
    expect(vpl([-100, 60, 60], t as number)).toBeCloseTo(0, 3);
  });
  it("tir retorna null sem troca de sinal", () => {
    expect(tir([100, 100, 100])).toBeNull();
  });
  it("payback acha primeiro mês não-negativo", () => {
    expect(payback([-50, -10, 5, 20])).toBe(2);
    expect(payback([-50, -10])).toBeNull();
  });
});

describe("pesosCurvaVendas", () => {
  it("soma sempre 1 para qualquer perfil", () => {
    for (const perfil of ["lancamento_forte", "organico", "constante", "fechamento_forte"] as const) {
      const pesos = pesosCurvaVendas(12, perfil);
      expect(pesos.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
    }
  });
});

describe("calcularUrbanistico", () => {
  it("área vendável = bruta - doações", () => {
    const r = calcularUrbanistico({ areaBrutaM2: 100_000, pctAreaPublica: 0.1, pctAreaVerde: 0.05, pctSistemaViario: 0.25, pctAPP: 0, pctFaixaServidao: 0 });
    expect(r.areaVendavelM2).toBeCloseTo(60_000, 2);
    expect(r.taxaAproveitamento).toBeCloseTo(0.6, 4);
  });
});

describe("calcularLoteamento", () => {
  it("VGV bruto = soma(quantidade × área × preço/m²) do mix", () => {
    const r = calcularLoteamento(premissasBase());
    expect(r.vgvGross).toBeCloseTo(100 * 300 * 500, 2);
  });
  it("gera fluxo de caixa mensal com saldo acumulado consistente", () => {
    const r = calcularLoteamento(premissasBase());
    expect(r.fluxo.length).toBeGreaterThan(0);
    let acumulado = 0;
    for (const f of r.fluxo) {
      acumulado += f.saldoMes;
      expect(f.saldoAcumulado).toBeCloseTo(acumulado, 1);
    }
  });
  it("determinístico: mesma entrada produz mesma saída", () => {
    const a = calcularLoteamento(premissasBase());
    const b = calcularLoteamento(premissasBase());
    expect(a.vpl).toBe(b.vpl);
    expect(a.tirAnual).toBe(b.tirAnual);
    expect(a.exposicaoMaxima).toBe(b.exposicaoMaxima);
  });
  it("exposição máxima é o maior saldo negativo em módulo", () => {
    const r = calcularLoteamento(premissasBase());
    const menor = Math.min(0, ...r.fluxo.map((f) => f.saldoAcumulado));
    expect(r.exposicaoMaxima).toBeCloseTo(Math.abs(menor), 2);
  });
});

describe("calcularCenarios", () => {
  it("agressivo tem VGV maior que conservador (preço +10% vs -10%)", () => {
    const c = calcularCenarios(premissasBase());
    expect(c.agressivo.vgvGross).toBeGreaterThan(c.ideal.vgvGross);
    expect(c.ideal.vgvGross).toBeGreaterThan(c.conservador.vgvGross);
  });
  it("cenário ideal usa exatamente as premissas informadas", () => {
    const p = premissasBase();
    const c = calcularCenarios(p);
    const direto = calcularLoteamento(p);
    expect(c.ideal.vgvGross).toBe(direto.vgvGross);
    expect(c.ideal.vpl).toBe(direto.vpl);
  });
});
