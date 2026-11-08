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

import { calcularMix, type ItemMixProduto, type ResultadoMix } from "./mix-produtos.js";

export type { ItemMixProduto, ResultadoMix };
export { calcularMix };

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

  // ── Correções 09–11 (opcionais; ausentes = comportamento anterior) ──────────
  /** Infraestrutura TOTAL vinda do Orçamento (antes do BDI). Quando definida, substitui custoInfraM2Lote × área. */
  custoInfraBaseTotal?: number;
  /** Obras residenciais (construção das casas) vindas do Orçamento — rubrica separada da infraestrutura. */
  custoObrasResidenciais?: number;
  /** Aquisição do terreno: desembolsos programados (mês, valor). Soma = custo do terreno. */
  desembolsosTerreno?: DesembolsoProgramado[];
  /** Permuta física: unidades entregues ao proprietário — construídas, mas NÃO vendáveis. */
  permutaFisicaUnidades?: number;
  /** Captação com investidores: entrada de capital e resgate (principal + remuneração). */
  captacoes?: CaptacaoProgramada[];
}

export interface DesembolsoProgramado { mes: number; valor: number }

export interface CaptacaoProgramada {
  nome: string;
  capital: number;
  mesAporte: number;
  mesResgate: number;
  /** Principal + remuneração pagos no resgate. */
  valorResgate: number;
}

export interface FluxoMesLote {
  mes: number;
  /** Comercialização (contratos assinados no mês) — não é caixa. */
  vendasUnidades: number;
  vendasVgv: number;
  receitaBruta: number;
  receitaVoce: number;
  receitaTerreneiro: number;
  custoPreVenda: number;
  custoDuranteVenda: number;
  /** Aquisição do terreno paga no mês. */
  custoTerreno: number;
  /** Entrada de capital de investidores (não é receita). */
  aporteCaptacao: number;
  /** Devolução do principal captado (não é despesa). */
  resgatePrincipal: number;
  /** Remuneração paga ao investidor no resgate (custo financeiro). */
  resgateRemuneracao: number;
  /** Fluxo do PROJETO (sem captação): receitas do incorporador − custos − terreno. */
  saldoProjeto: number;
  saldoProjetoAcumulado: number;
  /** Fluxo do INCORPORADOR (com captação): projeto + aportes − resgates. */
  saldoMes: number;
  saldoAcumulado: number;
}

export type StatusPayback = "recuperado" | "sem_exposicao" | "nao_recupera";

export interface IndicadoresFluxo {
  vpl: number;
  tirMensal: number | null;
  tirAnual: number | null;
  /** Por que a TIR não pôde ser calculada (null quando calculada). */
  tirMotivo: string | null;
  paybackMes: number | null;
  paybackStatus: StatusPayback;
  exposicaoMaxima: number;
  mesPico: number;
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
  /** Obras residenciais (construção das casas) — separada da infraestrutura. */
  custoObrasResidenciais: number;
  /** Aquisição do terreno (compra à vista/parcelada; zero em permuta pura). */
  custoTerreno: number;
  /** Custo financeiro da captação = remuneração paga aos investidores (o principal NÃO é despesa). */
  custoFinanceiroCaptacao: number;
  capitalCaptado: number;
  /** Custos operacionais nominais (c/ INCC) + terreno (base para comparar a captação, sem o custo financeiro). */
  investimentoTotal: number;
  /** Custos operacionais nominais + terreno + custo financeiro. Lucro = recebíveis do incorporador − este valor. */
  custoTotalProjeto: number;
  lucroLiquido: number;
  permutaFisica: { unidades: number; vgvEquivalente: number };
  /** VGV de todas as unidades (inclusive as da permuta física). */
  vgvTotalUnidades: number;
  /** Indicadores do fluxo do PROJETO, sem a captação. */
  projeto: IndicadoresFluxo;
  tirMotivo: string | null;
  paybackStatus: StatusPayback;
  horizonteMeses: number;
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

/** Payback: mês a partir do qual o saldo acumulado fica ≥ 0 até o fim, depois de ter ficado negativo. */
export function paybackDetalhado(saldoAcumulado: number[]): { mes: number | null; status: StatusPayback } {
  const eps = 0.005;
  if (!saldoAcumulado.some((v) => v < -eps)) return { mes: null, status: "sem_exposicao" };
  if (saldoAcumulado[saldoAcumulado.length - 1] < -eps) return { mes: null, status: "nao_recupera" };
  let mes = saldoAcumulado.length - 1;
  while (mes > 0 && saldoAcumulado[mes - 1] >= -eps) mes--;
  return { mes, status: "recuperado" };
}

/** Nº de trocas de sinal do fluxo (zeros ignorados). TIR só é única com exatamente uma. */
export function trocasDeSinal(fluxos: number[]): number {
  let n = 0, ultimo = 0;
  for (const f of fluxos) {
    if (Math.abs(f) <= 0.005) continue;
    const s = f > 0 ? 1 : -1;
    if (ultimo !== 0 && s !== ultimo) n++;
    ultimo = s;
  }
  return n;
}

function motivoTir(fluxos: number[]): string {
  const eps = 0.005;
  if (!fluxos.some((f) => f < -eps)) return "TIR não se aplica: o fluxo não tem nenhum mês com saída líquida de caixa (não há investimento a remunerar).";
  if (!fluxos.some((f) => f > eps)) return "TIR não se aplica: o fluxo não tem nenhum mês com entrada líquida de caixa.";
  const primeiro = fluxos.find((f) => Math.abs(f) > eps) ?? 0;
  if (primeiro > 0 && trocasDeSinal(fluxos) === 1) return "TIR não se aplica: o fluxo começa com entrada de caixa e termina com saída (padrão de financiamento, não de investimento). Use o VPL.";
  if (trocasDeSinal(fluxos) > 1) return "TIR não é única: o fluxo troca de sinal mais de uma vez (ex.: devolução da captação no fim). Use o VPL para decidir.";
  return "TIR não encontrada no intervalo de −99% a +100% ao mês.";
}

function indicadores(saldos: number[], taxaMensal: number): IndicadoresFluxo {
  const acum: number[] = [];
  let a = 0;
  for (const s of saldos) { a += s; acum.push(round2(a)); }
  // TIR só é retorno de investimento com UMA troca de sinal e o primeiro fluxo negativo (investe → recebe)
  const primeiroFluxo = saldos.find((f) => Math.abs(f) > 0.005) ?? 0;
  const tirM = trocasDeSinal(saldos) === 1 && primeiroFluxo < 0 ? tir(saldos) : null;
  const menor = Math.min(0, ...acum);
  const pb = paybackDetalhado(acum);
  return {
    vpl: round2(vpl(saldos, taxaMensal)),
    tirMensal: tirM,
    tirAnual: tirM != null ? Math.pow(1 + tirM, 12) - 1 : null,
    tirMotivo: tirM != null ? null : motivoTir(saldos),
    paybackMes: pb.mes,
    paybackStatus: pb.status,
    exposicaoMaxima: round2(Math.abs(menor)),
    mesPico: menor < 0 ? acum.indexOf(menor) : 0,
  };
}

/** Retira as unidades da permuta física do mix vendável (na ordem dos itens). */
function mixVendavel(itens: ItemMixProduto[], unidadesPermuta: number): ItemMixProduto[] {
  let restante = Math.max(0, Math.floor(unidadesPermuta || 0));
  return itens.map((it) => {
    if (restante <= 0) return it;
    const tira = Math.min(restante, Math.max(0, it.quantidade));
    restante -= tira;
    return { ...it, quantidade: it.quantidade - tira };
  });
}

/**
 * Roda o estudo completo de viabilidade.
 *
 * Convenção temporal (Correção 11): o vetor começa no M0 (data-base, antes do início);
 * M1 é o primeiro mês do empreendimento. Ano 1 = M0..M12, Ano 2 = M13..M24, etc.
 * O horizonte termina no último mês com algum evento de caixa — sem meses artificiais.
 */
export function calcularLoteamento(p: PremissasLoteamento): ResultadoLoteamento {
  const urb = calcularUrbanistico(p);
  const mixCompleto = calcularMix(p.itensMix);
  const unidadesPermuta = Math.min(Math.max(0, Math.floor(p.permutaFisicaUnidades ?? 0)), mixCompleto.totalUnidades);
  const mix = unidadesPermuta > 0 ? calcularMix(mixVendavel(p.itensMix, unidadesPermuta)) : mixCompleto;
  const vgvGross = mix.vgv;
  // custos de infraestrutura/obra incidem sobre TODAS as unidades (as da permuta física também são construídas)
  const areaMediaPonderada = mixCompleto.totalUnidades > 0 ? mixCompleto.areaVendidaM2 / mixCompleto.totalUnidades : 0;
  const capacidadeEstimadaUnidades =
    areaMediaPonderada > 0 ? Math.floor(urb.areaVendavelM2 / areaMediaPonderada) : 0;

  const vgvNet = vgvGross * (1 - p.comissaoPctVgv - p.despesasGeraisPctVgv - p.impostosPctVgv);

  const custoInfraBase = p.custoInfraBaseTotal !== undefined && Number.isFinite(p.custoInfraBaseTotal)
    ? Math.max(0, p.custoInfraBaseTotal) : p.custoInfraM2Lote * mixCompleto.areaVendidaM2;
  const custoInfra = custoInfraBase * (1 + p.bdiPct);
  const contingencia = custoInfraBase * p.contingenciaPctInfra;
  const custoObrasResidenciais = Math.max(0, p.custoObrasResidenciais ?? 0);
  const registroTotal = p.registroPorUnidade * mixCompleto.totalUnidades;
  const taxaAdministracaoObra = custoInfra * p.taxaAdministracaoObraPct;
  const manutencao = custoInfra * p.manutencaoPctObra;
  const taxaIncorporacao = vgvGross * p.taxaIncorporacaoPctVgv;

  const custosPreVenda =
    custoInfra + contingencia + custoObrasResidenciais + p.projetosLicencas + p.marketing + registroTotal +
    taxaAdministracaoObra + manutencao + taxaIncorporacao;

  const comissao = vgvGross * p.comissaoPctVgv;
  const despesas = vgvGross * p.despesasGeraisPctVgv;
  const impostos = vgvGross * p.impostosPctVgv;
  const custosDuranteVenda = comissao + despesas + impostos;
  const custoTotal = custosPreVenda + custosDuranteVenda;

  const terreno = (p.desembolsosTerreno ?? []).filter((d) => Number.isFinite(d.valor) && d.valor > 0)
    .map((d) => ({ mes: Math.max(0, Math.round(d.mes)), valor: d.valor }));
  const custoTerreno = terreno.reduce((s, d) => s + d.valor, 0);
  const captacoes = (p.captacoes ?? []).filter((c) => Number.isFinite(c.capital) && c.capital > 0)
    .map((c) => {
      const mesAporte = Math.max(0, Math.round(c.mesAporte));
      return { ...c, mesAporte, mesResgate: Math.max(mesAporte, Math.round(c.mesResgate)), valorResgate: Math.max(c.capital, c.valorResgate) };
    });
  const capitalCaptado = captacoes.reduce((s, c) => s + c.capital, 0);
  const custoFinanceiroCaptacao = captacoes.reduce((s, c) => s + (c.valorResgate - c.capital), 0);

  const pesos = pesosCurvaVendas(p.duracaoVendasMeses, p.perfilVendas);
  const prazo = Math.max(0, Math.round(p.prazoParcelamentoMeses));
  const temObra = p.duracaoObraMeses > 0;
  const mesInicioProjeto = Math.max(0, Math.min(p.inicioObraMes, p.inicioVendasMes));
  const mesManutencao = p.inicioObraMes + p.duracaoObraMeses + 3;
  const taxaIncorpMesesN = taxaIncorporacao > 0 ? 12 : 0;
  const ultimoMes = Math.max(
    temObra ? p.inicioObraMes + p.duracaoObraMeses - 1 : 0,
    p.inicioVendasMes + pesos.length - 1 + prazo,
    manutencao > 0 ? mesManutencao : 0,
    taxaIncorpMesesN > 0 ? mesInicioProjeto + taxaIncorpMesesN - 1 : 0,
    ...terreno.map((d) => d.mes),
    ...captacoes.map((c) => c.mesResgate),
  );
  const horizonte = Math.max(1, ultimoMes + 1);

  const recebimento = new Array(horizonte).fill(0);
  const vendasVgv = new Array(horizonte).fill(0);
  const fator = 1 - p.inadimplenciaPct;

  for (let i = 0; i < pesos.length; i++) {
    const mesVenda = p.inicioVendasMes + i;
    const vgvCohort = vgvGross * pesos[i];
    if (mesVenda < horizonte) vendasVgv[mesVenda] += vgvCohort;
    const vgvVista = vgvCohort * p.vendasAVistaPct;
    const vgvFinanciado = vgvCohort - vgvVista;

    if (mesVenda < horizonte) recebimento[mesVenda] += vgvVista * (1 - p.descontoAVistaPct);

    const entrada = vgvFinanciado * p.entradaPct;
    if (mesVenda < horizonte) recebimento[mesVenda] += entrada;
    const saldo = vgvFinanciado - entrada;
    if (prazo === 0) {
      // sem parcelamento: o saldo é recebido no próprio mês da venda (não empurra para o mês seguinte)
      if (mesVenda < horizonte) recebimento[mesVenda] += saldo * fator;
      continue;
    }
    const parcela = saldo / prazo;
    for (let k = 1; k <= prazo; k++) {
      const mes = mesVenda + k;
      if (mes >= horizonte) break;
      const corrigida = parcela * Math.pow(1 + p.indexacaoMensal + p.jurosClienteMensal, k) * fator;
      recebimento[mes] += corrigida;
    }
  }

  const custoObraBaseMensal = temObra ? (custoInfra + contingencia + custoObrasResidenciais) / p.duracaoObraMeses : 0;
  const taxaAdmMensal = temObra ? taxaAdministracaoObra / p.duracaoObraMeses : 0;
  const custosFixos = p.projetosLicencas + p.marketing + registroTotal;
  const custosFixosMensal = temObra ? custosFixos / p.duracaoObraMeses : 0;
  const taxaIncorpMensal = taxaIncorpMesesN > 0 ? taxaIncorporacao / taxaIncorpMesesN : 0;

  const totalRecebido = recebimento.reduce((s, x) => s + x, 0);
  const totalVendido = vendasVgv.reduce((s, x) => s + x, 0);
  const taxaMensal = Math.pow(1 + p.taxaDescontoAnual, 1 / 12) - 1;
  const fluxo: FluxoMesLote[] = [];
  let acumulado = 0;
  let acumuladoProjeto = 0;
  let obraNominalAcumulado = 0;

  for (let mes = 0; mes < horizonte; mes++) {
    const receitaBruta = recebimento[mes];
    const receitaTerreneiro = receitaBruta * p.permutaPctVgv;
    const receitaVoce = receitaBruta - receitaTerreneiro;

    let custoPreVenda = 0;
    if (temObra && mes >= p.inicioObraMes && mes < p.inicioObraMes + p.duracaoObraMeses) {
      const decorridos = mes - p.inicioObraMes;
      const obraMesNominal = custoObraBaseMensal * Math.pow(1 + p.inccObraMensal, decorridos);
      obraNominalAcumulado += obraMesNominal;
      custoPreVenda += obraMesNominal + taxaAdmMensal + custosFixosMensal;
    }
    // sem obra programada, os custos fixos e da obra não podem sumir do fluxo: entram no início do projeto
    if (!temObra && mes === mesInicioProjeto) {
      custoPreVenda += custoInfra + contingencia + custoObrasResidenciais + taxaAdministracaoObra + custosFixos;
      obraNominalAcumulado += custoInfra + contingencia + custoObrasResidenciais;
    }
    if (taxaIncorpMesesN > 0 && mes >= mesInicioProjeto && mes < mesInicioProjeto + taxaIncorpMesesN) custoPreVenda += taxaIncorpMensal;
    if (mes === mesManutencao) custoPreVenda += manutencao;

    const custoDuranteVenda = totalRecebido > 0 ? (receitaBruta / totalRecebido) * custosDuranteVenda : 0;
    const custoTerrenoMes = terreno.filter((d) => d.mes === mes).reduce((s, d) => s + d.valor, 0);
    const aporte = captacoes.filter((c) => c.mesAporte === mes).reduce((s, c) => s + c.capital, 0);
    const resgatando = captacoes.filter((c) => c.mesResgate === mes);
    const resgatePrincipal = resgatando.reduce((s, c) => s + c.capital, 0);
    const resgateRemuneracao = resgatando.reduce((s, c) => s + (c.valorResgate - c.capital), 0);

    const saldoProjeto = receitaVoce - custoPreVenda - custoDuranteVenda - custoTerrenoMes;
    const saldoMes = saldoProjeto + aporte - resgatePrincipal - resgateRemuneracao;
    acumulado += saldoMes;
    acumuladoProjeto += saldoProjeto;
    const vendaMes = vendasVgv[mes];
    fluxo.push({
      mes,
      vendasUnidades: totalVendido > 0 ? (vendaMes / totalVendido) * mix.totalUnidades : 0,
      vendasVgv: round2(vendaMes),
      receitaBruta: round2(receitaBruta),
      receitaVoce: round2(receitaVoce),
      receitaTerreneiro: round2(receitaTerreneiro),
      custoPreVenda: round2(custoPreVenda),
      custoDuranteVenda: round2(custoDuranteVenda),
      custoTerreno: round2(custoTerrenoMes),
      aporteCaptacao: round2(aporte),
      resgatePrincipal: round2(resgatePrincipal),
      resgateRemuneracao: round2(resgateRemuneracao),
      saldoProjeto: round2(saldoProjeto),
      saldoProjetoAcumulado: round2(acumuladoProjeto),
      saldoMes: round2(saldoMes),
      saldoAcumulado: round2(acumulado),
    });
  }

  const obraBase = custoInfra + contingencia + custoObrasResidenciais;
  const custoObraNominalTotal = obraNominalAcumulado;
  const custoTotalNominal = custoTotal + (custoObraNominalTotal - obraBase);

  const incorporador = indicadores(fluxo.map((f) => f.saldoMes), taxaMensal);
  const projeto = indicadores(fluxo.map((f) => f.saldoProjeto), taxaMensal);

  const recebiveisVoce = totalRecebido * (1 - p.permutaPctVgv);
  const recebiveisTerreneiro = totalRecebido * p.permutaPctVgv;
  // custos em valores NOMINAIS (com INCC), coerentes com as receitas corrigidas e com o fluxo de caixa
  const investimentoTotal = custoTotalNominal + custoTerreno;
  const custoTotalProjeto = investimentoTotal + custoFinanceiroCaptacao;
  // a captação NÃO é receita e o principal NÃO é despesa: só a remuneração reduz o lucro
  const lucro = recebiveisVoce - custoTotalProjeto;
  const roi = custoTotalProjeto > 0 ? lucro / custoTotalProjeto : 0;
  const margemLiquida = vgvGross > 0 ? lucro / vgvGross : 0;

  const unidadesNecessarias = mix.precoMedioUnidade > 0 ? Math.ceil(custoTotalProjeto / mix.precoMedioUnidade) : 0;

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
    custoObrasResidenciais: round2(custoObrasResidenciais),
    custoTerreno: round2(custoTerreno),
    custoFinanceiroCaptacao: round2(custoFinanceiroCaptacao),
    capitalCaptado: round2(capitalCaptado),
    investimentoTotal: round2(investimentoTotal),
    custoTotalProjeto: round2(custoTotalProjeto),
    lucroLiquido: round2(lucro),
    permutaFisica: { unidades: unidadesPermuta, vgvEquivalente: round2(mixCompleto.vgv - mix.vgv) },
    vgvTotalUnidades: round2(mixCompleto.vgv),
    projeto,
    tirMotivo: incorporador.tirMotivo,
    paybackStatus: incorporador.paybackStatus,
    horizonteMeses: horizonte,
    vpl: incorporador.vpl,
    tirMensal: incorporador.tirMensal,
    tirAnual: incorporador.tirAnual,
    roi,
    margemLiquida,
    paybackMes: incorporador.paybackMes,
    exposicaoMaxima: incorporador.exposicaoMaxima,
    mesPico: incorporador.mesPico,
    breakEven: {
      unidadesNecessarias,
      receitaNecessaria: round2(custoTotalProjeto),
      prazoMes: incorporador.paybackMes,
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
    p.itensMix.map((it) => ({
      ...it,
      precoM2: it.precoM2 * fator,
      ...(it.precoUnidade !== undefined ? { precoUnidade: it.precoUnidade * fator } : {}),
    }));

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
