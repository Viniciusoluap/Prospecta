// Estudo de Viabilidade Econômica (EVE) — motor determinístico de VGV, fluxo de
// caixa mensal por fases (indexado, com correção INCC da obra), VPL, TIR, ROI,
// margem, payback, exposição máxima de caixa, break-even e distribuição de
// recebíveis entre incorporador e terreneiro (permuta). Três cenários
// (conservador/ideal/agressivo) fazem o papel da análise de sensibilidade.
//
// Portado linha a linha do Grupo Santa Fé (`lib/finance/eve.ts` — vpl/tir/payback
// genéricos — e `lib/finance/loteamento.ts` — motor de viabilidade que os
// reutiliza), sem alteração de lógica. `calcularMix`/`ItemMixProduto`/`ResultadoMix`
// já foram portados na S-10 (`mix-produtos.ts`) e são reaproveitados aqui em vez
// de duplicados.

import { calcularMix, type ItemMixProduto, type ResultadoMix } from "./mix-produtos";

export type { ItemMixProduto, ResultadoMix };

// ─── vpl/tir/payback (portados de eve.ts) ────────────────────────────────────

/** Valor Presente Líquido de uma série de fluxos (fluxo[0] = mês 0). */
export function vpl(fluxos: number[], taxaMensal: number): number {
  return fluxos.reduce((acc, f, t) => acc + f / Math.pow(1 + taxaMensal, t), 0);
}

/**
 * Taxa Interna de Retorno mensal via bisseção no intervalo [-0,99; 1].
 * Retorna null se não houver troca de sinal (sem raiz no intervalo).
 */
export function tir(fluxos: number[]): number | null {
  const f = (taxa: number) => vpl(fluxos, taxa);
  let lo = -0.99;
  let hi = 1.0;
  let flo = f(lo);
  let fhi = f(hi);
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fmid = f(mid);
    if (Math.abs(fmid) < 1e-6) return mid;
    if (flo * fmid < 0) {
      hi = mid;
      fhi = fmid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  return (lo + hi) / 2;
}

/** Primeiro mês em que o saldo acumulado fica >= 0. null se nunca acontecer. */
export function payback(saldoAcumulado: number[]): number | null {
  for (let i = 0; i < saldoAcumulado.length; i++) {
    if (saldoAcumulado[i] >= 0) return i;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Motor de viabilidade (portado de loteamento.ts) ────────────────────────

export type PerfilVendas = "lancamento_forte" | "organico" | "constante" | "fechamento_forte";

export interface PremissasLoteamento {
  areaBrutaM2: number;
  pctAreaPublica: number;
  pctAreaVerde: number;
  pctSistemaViario: number;
  pctAPP: number;
  pctFaixaServidao: number;

  itensMix: ItemMixProduto[];

  duracaoVendasMeses: number;
  perfilVendas: PerfilVendas;
  entradaPct: number;
  prazoParcelamentoMeses: number;
  jurosClienteMensal: number;
  indexacaoMensal: number;
  vendasAVistaPct: number;
  descontoAVistaPct: number;
  inadimplenciaPct: number;
  comissaoPctVgv: number;
  despesasGeraisPctVgv: number;
  impostosPctVgv: number;
  taxaIncorporacaoPctVgv: number;

  inicioObraMes: number;
  duracaoObraMeses: number;
  inicioVendasMes: number;

  custoInfraM2Lote: number;
  projetosLicencas: number;
  marketing: number;
  registroPorUnidade: number;
  contingenciaPctInfra: number;
  bdiPct: number;
  taxaAdministracaoObraPct: number;
  manutencaoPctObra: number;
  inccObraMensal: number;

  permutaPctVgv: number;

  taxaDescontoAnual: number;
}

export interface FluxoMesLote {
  mes: number;
  receitaBruta: number;
  receitaVoce: number;
  receitaTerreneiro: number;
  custoPreVenda: number;
  custoDuranteVenda: number;
  saldoMes: number;
  saldoAcumulado: number;
}

export interface ResultadoLoteamento {
  urbanistico: {
    areaBrutaM2: number;
    areaPublicaM2: number;
    areaVerdeM2: number;
    areaViarioM2: number;
    areaAppM2: number;
    areaServidaoM2: number;
    areaVendavelM2: number;
    capacidadeEstimadaUnidades: number;
    taxaAproveitamento: number;
  };
  mix: ResultadoMix;
  vgvGross: number;
  vgvNet: number;
  custoInfra: number;
  custosPreVenda: number;
  custosDuranteVenda: number;
  custoTotal: number;
  custoObraNominalTotal: number;
  custoTotalNominal: number;
  custosDetalhados: {
    taxaAdministracaoObra: number;
    manutencao: number;
    taxaIncorporacao: number;
  };
  recebiveis: { voce: number; terreneiro: number; total: number };
  vpl: number;
  tirMensal: number | null;
  tirAnual: number | null;
  roi: number;
  margemLiquida: number;
  paybackMes: number | null;
  exposicaoMaxima: number;
  mesPico: number;
  breakEven: { unidadesNecessarias: number; receitaNecessaria: number; prazoMes: number | null };
  fluxo: FluxoMesLote[];
}

/** Pesos de venda por mês conforme o perfil da curva (somam 1). */
export function pesosCurvaVendas(meses: number, perfil: PerfilVendas): number[] {
  const n = Math.max(1, Math.round(meses));
  const w: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    let peso: number;
    switch (perfil) {
      case "lancamento_forte": peso = 1 - 0.8 * t; break;
      case "fechamento_forte": peso = 0.2 + 0.8 * t; break;
      case "organico": peso = Math.sin(Math.PI * (t * 0.9 + 0.05)); break;
      case "constante":
      default: peso = 1; break;
    }
    w.push(Math.max(0.0001, peso));
  }
  const soma = w.reduce((s, x) => s + x, 0);
  return w.map((x) => x / soma);
}

/** Distribuição de áreas a partir dos parâmetros urbanísticos (independe do produto). */
export function calcularUrbanistico(p: Pick<
  PremissasLoteamento,
  "areaBrutaM2" | "pctAreaPublica" | "pctAreaVerde" | "pctSistemaViario" | "pctAPP" | "pctFaixaServidao"
>) {
  const bruta = Math.max(0, p.areaBrutaM2);
  const areaPublicaM2 = bruta * p.pctAreaPublica;
  const areaVerdeM2 = bruta * p.pctAreaVerde;
  const areaViarioM2 = bruta * p.pctSistemaViario;
  const areaAppM2 = bruta * p.pctAPP;
  const areaServidaoM2 = bruta * p.pctFaixaServidao;
  const areaVendavelM2 = Math.max(
    0,
    bruta - areaPublicaM2 - areaVerdeM2 - areaViarioM2 - areaAppM2 - areaServidaoM2
  );
  const taxaAproveitamento = bruta > 0 ? areaVendavelM2 / bruta : 0;
  return {
    areaBrutaM2: bruta, areaPublicaM2, areaVerdeM2, areaViarioM2, areaAppM2,
    areaServidaoM2, areaVendavelM2, taxaAproveitamento,
  };
}

/** Roda o estudo completo de viabilidade. */
export function calcularLoteamento(p: PremissasLoteamento): ResultadoLoteamento {
  const urb = calcularUrbanistico(p);
  const mix = calcularMix(p.itensMix);
  const vgvGross = mix.vgv;
  const areaMediaPonderada = mix.totalUnidades > 0 ? mix.areaVendidaM2 / mix.totalUnidades : 0;
  const capacidadeEstimadaUnidades =
    areaMediaPonderada > 0 ? Math.floor(urb.areaVendavelM2 / areaMediaPonderada) : 0;

  const vgvNet = vgvGross * (1 - p.comissaoPctVgv - p.despesasGeraisPctVgv - p.impostosPctVgv);

  const custoInfraBase = p.custoInfraM2Lote * mix.areaVendidaM2;
  const custoInfra = custoInfraBase * (1 + p.bdiPct);
  const contingencia = custoInfraBase * p.contingenciaPctInfra;
  const registroTotal = p.registroPorUnidade * mix.totalUnidades;
  const taxaAdministracaoObra = custoInfra * p.taxaAdministracaoObraPct;
  const manutencao = custoInfra * p.manutencaoPctObra;
  const taxaIncorporacao = vgvGross * p.taxaIncorporacaoPctVgv;

  const custosPreVenda =
    custoInfra + contingencia + p.projetosLicencas + p.marketing + registroTotal +
    taxaAdministracaoObra + manutencao + taxaIncorporacao;

  const comissao = vgvGross * p.comissaoPctVgv;
  const despesas = vgvGross * p.despesasGeraisPctVgv;
  const impostos = vgvGross * p.impostosPctVgv;
  const custosDuranteVenda = comissao + despesas + impostos;
  const custoTotal = custosPreVenda + custosDuranteVenda;

  const pesos = pesosCurvaVendas(p.duracaoVendasMeses, p.perfilVendas);
  const horizonte =
    Math.max(
      p.inicioObraMes + p.duracaoObraMeses,
      p.inicioVendasMes + pesos.length + p.prazoParcelamentoMeses
    ) + 4;

  const recebimento = new Array(horizonte).fill(0);
  const fator = 1 - p.inadimplenciaPct;

  for (let i = 0; i < pesos.length; i++) {
    const mesVenda = p.inicioVendasMes + i;
    const vgvCohort = vgvGross * pesos[i];
    const vgvVista = vgvCohort * p.vendasAVistaPct;
    const vgvFinanciado = vgvCohort - vgvVista;

    if (mesVenda < horizonte) recebimento[mesVenda] += vgvVista * (1 - p.descontoAVistaPct);

    const entrada = vgvFinanciado * p.entradaPct;
    if (mesVenda < horizonte) recebimento[mesVenda] += entrada;
    const saldo = vgvFinanciado - entrada;
    const nParc = Math.max(1, p.prazoParcelamentoMeses);
    const parcela = saldo / nParc;
    for (let k = 1; k <= nParc; k++) {
      const mes = mesVenda + k;
      if (mes >= horizonte) break;
      const corrigida = parcela * Math.pow(1 + p.indexacaoMensal + p.jurosClienteMensal, k) * fator;
      recebimento[mes] += corrigida;
    }
  }

  const custoObraBaseMensal = p.duracaoObraMeses > 0 ? (custoInfra + contingencia) / p.duracaoObraMeses : 0;
  const taxaAdmMensal = p.duracaoObraMeses > 0 ? taxaAdministracaoObra / p.duracaoObraMeses : 0;
  const custosFixosMensal = p.duracaoObraMeses > 0
    ? (p.projetosLicencas + p.marketing + registroTotal) / p.duracaoObraMeses
    : 0;
  const taxaIncorpMeses = Math.min(12, horizonte);
  const taxaIncorpMensal = taxaIncorpMeses > 0 ? taxaIncorporacao / taxaIncorpMeses : 0;
  const mesManutencao = p.inicioObraMes + p.duracaoObraMeses + 3;

  const totalRecebido = recebimento.reduce((s, x) => s + x, 0);
  const fluxo: FluxoMesLote[] = [];
  let acumulado = 0;
  let obraNominalAcumulado = 0;

  for (let mes = 0; mes < horizonte; mes++) {
    const receitaBruta = recebimento[mes];
    const receitaTerreneiro = receitaBruta * p.permutaPctVgv;
    const receitaVoce = receitaBruta - receitaTerreneiro;

    let custoPreVenda = 0;
    if (mes >= p.inicioObraMes && mes < p.inicioObraMes + p.duracaoObraMeses) {
      const decorridos = mes - p.inicioObraMes;
      const obraMesNominal = custoObraBaseMensal * Math.pow(1 + p.inccObraMensal, decorridos);
      obraNominalAcumulado += obraMesNominal;
      custoPreVenda += obraMesNominal + taxaAdmMensal + custosFixosMensal;
    }
    if (mes < taxaIncorpMeses) custoPreVenda += taxaIncorpMensal;
    if (mes === mesManutencao) custoPreVenda += manutencao;

    const custoDuranteVenda = totalRecebido > 0 ? (receitaBruta / totalRecebido) * custosDuranteVenda : 0;

    const saldoMes = receitaVoce - custoPreVenda - custoDuranteVenda;
    acumulado += saldoMes;
    fluxo.push({
      mes,
      receitaBruta: round2(receitaBruta),
      receitaVoce: round2(receitaVoce),
      receitaTerreneiro: round2(receitaTerreneiro),
      custoPreVenda: round2(custoPreVenda),
      custoDuranteVenda: round2(custoDuranteVenda),
      saldoMes: round2(saldoMes),
      saldoAcumulado: round2(acumulado),
    });
  }

  const custoObraNominalTotal = obraNominalAcumulado;
  const custoTotalNominal = custoTotal + (custoObraNominalTotal - (custoInfra + contingencia));

  const saldos = fluxo.map((f) => f.saldoMes);
  const saldoAcum = fluxo.map((f) => f.saldoAcumulado);
  const taxaMensal = Math.pow(1 + p.taxaDescontoAnual, 1 / 12) - 1;
  const vplV = vpl(saldos, taxaMensal);
  const tirM = tir(saldos);
  const tirA = tirM != null ? Math.pow(1 + tirM, 12) - 1 : null;

  const menorAcum = Math.min(0, ...saldoAcum);
  const exposicaoMaxima = Math.abs(menorAcum);
  const mesPico = saldoAcum.indexOf(menorAcum);

  const recebiveisVoce = totalRecebido * (1 - p.permutaPctVgv);
  const recebiveisTerreneiro = totalRecebido * p.permutaPctVgv;
  const lucro = recebiveisVoce - custoTotal;
  const roi = custoTotal > 0 ? recebiveisVoce / custoTotal - 1 : 0;
  const margemLiquida = vgvGross > 0 ? lucro / vgvGross : 0;

  const unidadesNecessarias = mix.precoMedioUnidade > 0 ? Math.ceil(custoTotal / mix.precoMedioUnidade) : 0;
  const prazoBreakEven = payback(saldoAcum);

  return {
    urbanistico: {
      areaBrutaM2: round2(urb.areaBrutaM2),
      areaPublicaM2: round2(urb.areaPublicaM2),
      areaVerdeM2: round2(urb.areaVerdeM2),
      areaViarioM2: round2(urb.areaViarioM2),
      areaAppM2: round2(urb.areaAppM2),
      areaServidaoM2: round2(urb.areaServidaoM2),
      areaVendavelM2: round2(urb.areaVendavelM2),
      capacidadeEstimadaUnidades,
      taxaAproveitamento: urb.taxaAproveitamento,
    },
    mix: {
      itens: mix.itens.map((i) => ({ ...i, areaTotalM2: round2(i.areaTotalM2), vgv: round2(i.vgv) })),
      totalUnidades: mix.totalUnidades,
      areaVendidaM2: round2(mix.areaVendidaM2),
      vgv: round2(mix.vgv),
      precoMedioUnidade: round2(mix.precoMedioUnidade),
    },
    vgvGross: round2(vgvGross),
    vgvNet: round2(vgvNet),
    custoInfra: round2(custoInfra),
    custosPreVenda: round2(custosPreVenda),
    custosDuranteVenda: round2(custosDuranteVenda),
    custoTotal: round2(custoTotal),
    custoObraNominalTotal: round2(custoObraNominalTotal),
    custoTotalNominal: round2(custoTotalNominal),
    custosDetalhados: {
      taxaAdministracaoObra: round2(taxaAdministracaoObra),
      manutencao: round2(manutencao),
      taxaIncorporacao: round2(taxaIncorporacao),
    },
    recebiveis: {
      voce: round2(recebiveisVoce),
      terreneiro: round2(recebiveisTerreneiro),
      total: round2(totalRecebido),
    },
    vpl: round2(vplV),
    tirMensal: tirM,
    tirAnual: tirA,
    roi,
    margemLiquida,
    paybackMes: prazoBreakEven,
    exposicaoMaxima: round2(exposicaoMaxima),
    mesPico: mesPico < 0 ? 0 : mesPico,
    breakEven: {
      unidadesNecessarias,
      receitaNecessaria: round2(custoTotal),
      prazoMes: prazoBreakEven,
    },
    fluxo,
  };
}

export interface CenariosLoteamento {
  conservador: ResultadoLoteamento;
  ideal: ResultadoLoteamento;
  agressivo: ResultadoLoteamento;
}

/**
 * Três cenários variando o preço/m² de cada produto do mix (-10% / base / +10%)
 * e a velocidade de vendas (conservador vende mais devagar; agressivo mais rápido)
 * — faz o papel da análise de sensibilidade do EVE.
 */
export function calcularCenarios(p: PremissasLoteamento): CenariosLoteamento {
  const ajustarPreco = (fator: number): ItemMixProduto[] =>
    p.itensMix.map((it) => ({ ...it, precoM2: it.precoM2 * fator }));

  const conservador = calcularLoteamento({
    ...p,
    itensMix: ajustarPreco(0.9),
    duracaoVendasMeses: Math.round(p.duracaoVendasMeses * 1.4),
  });
  const ideal = calcularLoteamento(p);
  const agressivo = calcularLoteamento({
    ...p,
    itensMix: ajustarPreco(1.1),
    duracaoVendasMeses: Math.max(1, Math.round(p.duracaoVendasMeses * 0.7)),
  });
  return { conservador, ideal, agressivo };
}
