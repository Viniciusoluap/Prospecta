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

// ─── Correção 08 (08/11/2026) ────────────────────────────────────────────────
import {
  calcularPermutaFinanceira, estimarProposta, excluirProposta, mesclarNegociacaoParaGravar, resolverVgvBruto, resumoNegociacaoV2,
  PENDENTE_SEM_VGV,
} from "../shared/incorporacao/negociacao";

describe("permuta financeira = VGV bruto × percentual ÷ 100", () => {
  it("exemplo demonstrativo: R$ 2.900.000 × 40% = R$ 1.160.000", () => {
    expect(calcularPermutaFinanceira(2_900_000, 40)).toBe(1_160_000);
  });
  it("precisão de centavos sem erro de ponto flutuante", () => {
    expect(calcularPermutaFinanceira(0.1 + 0.2, 100)).toBe(0.3);
    expect(calcularPermutaFinanceira(1_234_567.89, 33.3333)).toBe(411_522.22);
    expect(calcularPermutaFinanceira(999_999_999_999.99, 12.5)).toBe(125_000_000_000);
  });
  it("sem VGV: pendente (não R$ 0,00)", () => {
    const p = proposta({ tipo: "permuta_financeira", permutaPctVgv: 40 });
    expect(estimarProposta(p, null)).toEqual({ status: "pendente", motivo: PENDENTE_SEM_VGV });
    expect(PENDENTE_SEM_VGV).toBe("Cálculo pendente — VGV não disponível");
  });
  it("VGV: Viabilidade > cenário do Estudo de Massa > manual legado", () => {
    expect(resolverVgvBruto({ viabilidade: 3_000_000, cenarioMassa: 2_900_000 })).toEqual({ valor: 3_000_000, origem: "viabilidade" });
    expect(resolverVgvBruto({ viabilidade: 0, cenarioMassa: 2_900_000, manualLegado: 1 })).toEqual({ valor: 2_900_000, origem: "cenario_massa" });
    expect(resolverVgvBruto({ manualLegado: 500 })).toEqual({ valor: 500, origem: "manual_legado" });
    expect(resolverVgvBruto({})).toBeNull();
  });
  it("recalcula quando o VGV ou o percentual mudam", () => {
    const p = proposta({ tipo: "permuta_financeira", permutaPctVgv: 40 });
    expect(estimarProposta(p, { valor: 2_900_000, origem: "cenario_massa" })).toEqual({ status: "calculado", valor: 1_160_000 });
    expect(estimarProposta({ ...p, permutaPctVgv: 25 }, { valor: 2_000_000, origem: "viabilidade" })).toEqual({ status: "calculado", valor: 500_000 });
  });
});

describe("proposta de referência: selecionada > aceita > mais recente", () => {
  const base = { proprietarioNome: "", proprietarioContato: "" };
  const aceita = proposta({ id: "a", data: "2026-01-10", status: "aceita", tipo: "permuta_financeira", permutaPctVgv: 40 });
  const posterior = proposta({ id: "b", data: "2026-02-01", status: "enviada", valorTotal: 900_000 });
  const vgv = { valor: 2_900_000, origem: "viabilidade" as const };
  it("aceita não é invalidada por proposta enviada depois", () => {
    const r = resumoNegociacaoV2({ ...base, propostas: [aceita, posterior] }, vgv);
    expect(r.fechada).toBe(true);
    expect(r.propostaAceita?.id).toBe("a");
    expect(r.propostaMaisRecente?.id).toBe("b");
    expect(r.referencia?.id).toBe("a");
    expect(r.origemReferencia).toBe("aceita");
    expect(r.estimativa).toEqual({ status: "calculado", valor: 1_160_000 });
  });
  it("seleção manual tem prioridade", () => {
    const r = resumoNegociacaoV2({ ...base, propostas: [aceita, posterior], propostaSelecionadaId: "b" }, vgv);
    expect(r.referencia?.id).toBe("b");
    expect(r.estimativa).toEqual({ status: "calculado", valor: 900_000 });
  });
  it("sem aceita nem seleção: a mais recente", () => {
    const r = resumoNegociacaoV2({ ...base, propostas: [posterior, { ...aceita, status: "em_analise" }] }, null);
    expect(r.referencia?.id).toBe("b");
  });
});

describe("exclusão de proposta", () => {
  const base = { proprietarioNome: "X", proprietarioContato: "Y" };
  const a = proposta({ id: "a", data: "2026-01-01" });
  const b = proposta({ id: "b", data: "2026-01-02", status: "aceita", valorTotal: 1 });
  const c = proposta({ id: "c", data: "2026-01-03" });
  const autor = { id: 7, nome: "Ana" };
  it("remove só a selecionada, preserva as demais e registra auditoria", () => {
    const r = excluirProposta({ ...base, propostas: [a, b, c], propostaSelecionadaId: "a" }, "a", autor, "2026-11-08T12:00:00.000Z", false);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dados.propostas.map((p) => p.id)).toEqual(["b", "c"]);
    expect(r.dados.propostaSelecionadaId).toBeNull();
    expect(r.dados.historicoExclusoes).toEqual([{ proposta: a, excluidaEm: "2026-11-08T12:00:00.000Z", excluidaPorId: 7, excluidaPorNome: "Ana", eraAceita: false }]);
    expect(resumoNegociacaoV2(r.dados, null).totalPropostas).toBe(2);
  });
  it("aceita exige confirmação reforçada", () => {
    expect(excluirProposta({ ...base, propostas: [a, b] }, "b", autor, "t", false)).toMatchObject({ ok: false });
    const r = excluirProposta({ ...base, propostas: [a, b] }, "b", autor, "t", true);
    expect(r.ok && r.exclusao.eraAceita).toBe(true);
    if (r.ok) expect(resumoNegociacaoV2(r.dados, null).fechada).toBe(false);
  });
  it("proposta inexistente: erro sem alterar nada", () => {
    expect(excluirProposta({ ...base, propostas: [a] }, "zz", autor, "t", true)).toMatchObject({ ok: false });
  });
  it("salvar a partir de tela desatualizada não apaga auditoria nem ressuscita excluída", () => {
    const r = excluirProposta({ ...base, propostas: [a, c] }, "a", autor, "2026-11-08T12:00:00.000Z", false);
    if (!r.ok) throw new Error();
    const telaVelha = { ...base, propostas: [a, c, proposta({ id: "d", data: "2026-01-04" })] };
    const m = mesclarNegociacaoParaGravar(r.dados, telaVelha);
    expect(m.propostas.map((p) => p.id)).toEqual(["c", "d"]);
    expect(m.historicoExclusoes?.length).toBe(1);
  });
});
