import { describe, expect, it } from "vitest";
import { paraEstudoData } from "../shared/incorporacao/estudo-data";
import { defaultsForm, defaultsMix, montarPremissasLoteamento } from "../shared/incorporacao/premissas-loteamento";
import { calcularLoteamento } from "../shared/incorporacao/viabilidade-economica";
import { resumoNegociacao } from "../shared/incorporacao/negociacao";
import { calcularBusinessPlan } from "../shared/incorporacao/captacao";

// Dados reais (sem contatos) do estudo 1 da Prospecta, "Morada do Bosque", em 14/10/2026.
const LOTEAMENTO = {"areaBrutaM2":7543,"pctAreaPublica":0,"pctAreaVerde":0,"pctSistemaViario":0,"pctFaixaServidao":0,"duracaoVendasMeses":24,"perfilVendas":"lancamento_forte","entradaPct":20,"prazoParcelamentoMeses":1,"jurosClienteMensal":0.52,"indexacaoMensal":0.4,"vendasAVistaPct":0,"descontoAVistaPct":0,"inadimplenciaPct":0,"comissaoPctVgv":5,"despesasGeraisPctVgv":3,"impostosPctVgv":6.58,"taxaIncorporacaoPctVgv":1,"inicioObraMes":12,"duracaoObraMeses":24,"inicioVendasMes":12,"custoInfraM2Lote":245,"projetosLicencas":500000,"marketing":500000,"registroPorUnidade":400,"contingenciaPctInfra":10,"bdiPct":10,"taxaAdministracaoObraPct":10,"manutencaoPctObra":1.5,"inccObraMensal":0.3,"permutaPctVgv":6,"taxaDescontoAnual":12,"itensMix":[{"nome":"Casas smart","quantidade":60,"areaUnidadeM2":47,"precoM2":4468}]};
const NEGOCIACAO = { proprietarioNome: "P", proprietarioContato: "", vgvGrossManual: 14_000_000,
  propostas: [{ id: "a", data: "2026-10-11", autor: "grupo" as const, tipo: "permuta_financeira" as const, status: "aceita" as const, permutaPctVgv: 6 }] };
const FONTES = [
  { id: "a", nome: "A", capitalAportado: 150_000, remuneracaoPct: 2, periodoRemuneracao: "mensal" as const, prazoResgateMeses: 24 },
  { id: "b", nome: "B", capitalAportado: 200_000, remuneracaoPct: 1, periodoRemuneracao: "mensal" as const, prazoResgateMeses: 24 },
  { id: "c", nome: "C", capitalAportado: 50_000, remuneracaoPct: 1, periodoRemuneracao: "mensal" as const, prazoResgateMeses: 24 },
];
const linha = (extra: Record<string, unknown> = {}) => ({ id: 1, name: "Morada do Bosque", city: "X", state: "PA", status: "in_progress",
  areaM2: "8373.00", appAreaM2: "0.00", perimeterM: "400.00", latitude: null, longitude: null, reportsJson: "[]",
  lottingJson: JSON.stringify(LOTEAMENTO), ...extra });

describe("Item 10 — premissas da Viabilidade iguais ao Santa Fé", () => {
  it("adaptador converte decimais do banco (texto) em número", () => {
    const e = paraEstudoData(linha());
    expect(e.id).toBe("1");
    expect(e.areaM2).toBe(8373);
    expect(e.appAreaM2).toBe(0);
    expect(e.loteamentoJson).toBe(JSON.stringify(LOTEAMENTO));
    expect(e.centroLat).toBeNull();
  });

  it("estudo 1: VGV e custo total saem da Viabilidade salva", () => {
    const r = calcularLoteamento(montarPremissasLoteamento(paraEstudoData(linha()))!);
    expect(r.vgvGross).toBeCloseTo(12_599_760, 2);
    expect(r.custoTotal).toBeCloseTo(3_903_521.46, 1);
  });

  it("estudo 1: Negociação usa o VGV da Viabilidade, não o digitado (antes: R$ 840.000)", () => {
    const r = calcularLoteamento(montarPremissasLoteamento(paraEstudoData(linha()))!);
    expect(resumoNegociacao(NEGOCIACAO, 14_000_000).valorEstimadoAtual).toBeCloseTo(840_000, 2);
    expect(resumoNegociacao(NEGOCIACAO, r.vgvGross).valorEstimadoAtual).toBeCloseTo(755_985.6, 2);
  });

  it("estudo 1: Business Plan compara com o custo total da Viabilidade (antes: 100% de R$ 400 mil digitados)", () => {
    const r = calcularLoteamento(montarPremissasLoteamento(paraEstudoData(linha()))!);
    expect(calcularBusinessPlan(FONTES, 400_000).pctDoInvestimentoTotal).toBe(100);
    const bp = calcularBusinessPlan(FONTES, r.custoTotal);
    expect(bp.pctDoInvestimentoTotal).toBeCloseTo(10.25, 2);
    expect(bp.capitalProprioNecessario).toBeCloseTo(3_503_521.46, 1);
  });

  it("sem Viabilidade salva não há premissas (as abas pedem para preencher a Viabilidade)", () => {
    expect(montarPremissasLoteamento(paraEstudoData(linha({ lottingJson: null })))).toBeNull();
  });

  it("custo de infraestrutura padrão vem do Orçamento Parametrizado quando preenchido", () => {
    expect(defaultsForm(paraEstudoData(linha())).custoInfraM2Lote).toBe(245);
    const orc = { itens: [{ pavimento: "Térreo", areaM2: 100, coeficienteEquivalencia: 1 }], custoM2Equivalente: 2000,
      passivoAmbiental: 0, decoracaoEquipamentos: 0, projetos: 0, previsaoInfra: 0, outros: 0 };
    expect(defaultsForm(paraEstudoData(linha({ parameterizedBudgetJson: JSON.stringify(orc) }))).custoInfraM2Lote).toBe(2000);
  });

  it("mantém o mix legado salvo e deixa o preço vazio sem referência", () => {
    const mix = [{ nome: "Lote 200m²", quantidade: 10, areaUnidadeM2: 200, precoM2: 700 }];
    expect(defaultsMix(paraEstudoData(linha({ productMixJson: JSON.stringify(mix) })))).toEqual(mix);
    expect(defaultsMix(paraEstudoData(linha()))[0].precoM2).toBe(0);
  });
});

describe("Estudo de Massa e preços da Viabilidade", () => {
  const cenario = {
    id: "cenario-1",
    lotes: [
      { tipo: "vendavel", areaM2: 128 },
      { tipo: "vendavel", areaM2: 129.55 },
      { tipo: "area_publica", areaM2: 700 },
    ],
    quadroAreas: {
      areaBrutaM2: 1000,
      areaInstitucionalM2: 0,
      areaVerdeM2: 600,
      sistemaViarioM2: 142.45,
      appM2: 500,
      faixaServidaoM2: 0,
      faixaTransmissaoM2: 0,
      supressaoVegetalM2: 0,
      outrasNaoParcelaveisM2: 0,
      areaLiquidaVendavelM2: 257.55,
    },
  };
  const dadosCenario = { selectedScenarioId: "cenario-1", massScenariosJson: JSON.stringify([cenario]) };
  const mercado = { marketStudyJson: JSON.stringify({ precoM2Lote: 1400, precoM2Casa: 4000, precoM2Apartamento: 4500 }) };

  it("usa apenas os lotes vendáveis, a área exata e o preço de mercado quando o mix vem do cenário", () => {
    const estudo = paraEstudoData(linha({
      ...dadosCenario, ...mercado,
      lottingJson: JSON.stringify({ ...LOTEAMENTO, mixModo: "cenario", urbanismoModo: "cenario" }),
    }));
    const premissas = montarPremissasLoteamento(estudo)!;
    expect(premissas.itensMix).toEqual([{ nome: "Lotes", quantidade: 2, areaUnidadeM2: 128.775, precoM2: 1400 }]);
    const resultado = calcularLoteamento(premissas);
    expect(resultado.urbanistico.areaVendavelM2).toBe(257.55);
    expect(resultado.vgvGross).toBeCloseTo(360_570, 2);
  });

  it.each([
    { tipo: "casa", modo: { casaPronta: true }, area: 55, vgv: 440_000 },
    { tipo: "apartamento", modo: { apartamento: true }, area: 48, vgv: 432_000 },
  ])("calcula o VGV por unidade com a referência de $tipo e preserva o preço manual", ({ modo, area, vgv }) => {
    const produto = { nome: "Residencial", quantidade: 2, areaUnidadeM2: 129, precoM2: 1400, areaPrivativaM2: area, ...modo };
    const simular = (precoUnidade: number) => calcularLoteamento(montarPremissasLoteamento(paraEstudoData(linha({
      ...mercado,
      lottingJson: JSON.stringify({ ...LOTEAMENTO, itensMix: [{ ...produto, precoUnidade }] }),
    })))!);
    expect(simular(0).vgvGross).toBe(vgv);
    expect(simular(230_000).vgvGross).toBe(460_000);
  });

  it("exige preço unitário ou área privativa ao converter um lote precificado em apartamento", () => {
    const estudo = paraEstudoData(linha({
      ...mercado,
      lottingJson: JSON.stringify({ ...LOTEAMENTO, itensMix: [
        { nome: "Apartamento", quantidade: 2, apartamento: true, areaUnidadeM2: 128, precoM2: 1400 },
      ] }),
    }));
    expect(calcularLoteamento(montarPremissasLoteamento(estudo)!).vgvGross).toBe(0);
  });

  it("recupera a referência legada ao marcar casa pronta sem preço unitário", () => {
    const estudo = paraEstudoData(linha({
      ...dadosCenario,
      massScenariosJson: JSON.stringify({ params: { precoM2Lote: 1400 }, cenarios: [cenario] }),
      lottingJson: JSON.stringify({ ...LOTEAMENTO, itensMix: [
        { nome: "Casa", quantidade: 2, casaPronta: true, areaUnidadeM2: 128, precoM2: 0 },
      ] }),
    }));
    expect(calcularLoteamento(montarPremissasLoteamento(estudo)!).vgvGross).toBe(358_400);
  });
});
