import { cenarioPrincipalDe } from "./estudos-massa.js";
// Conversão "formulário salvo (loteamentoJson) → premissas completas do motor
// de viabilidade" — extraída da aba Viabilidade para ser reaproveitada também
// pelo Relatório Executivo de Incorporação (Lote 6), sem duplicar a lógica de
// conversão de formulário → motor nem acoplar o relatório a um componente
// "use client".
//
// Funções puras (sem I/O, sem React) — testáveis isoladamente.

import {
  type PremissasLoteamento,
  type ItemMixProduto,
  type PerfilVendas,
} from "./viabilidade-economica.js";
import {
  calcularPrecificacaoPorComparaveis,
  type AtributoComparavel,
  type Comparavel,
} from "./precificacao.js";
import {
  calcularOrcamentoParametrizado,
  type PremissasOrcamentoParametrizado,
} from "./orcamento-parametrizado.js";
import type { EstudoData } from "./estudo-data.js";
import { calcularMix } from "./mix-produtos.js";
import {
  aplicarFontes, infraDoOrcamento, marketingDoSistema, resolverFontes, terrenoDaNegociacao,
  type ConfigFontes, type FontesResolvidas, type ModoFonte,
} from "./composicao-custos.js";

// Percentuais são representados em % (ex.: 10) neste formulário e convertidos
// para fração (0..1) só na conversão para o motor (paraMotor).
export interface PremissasForm {
  /** Correção 09: só "manual" ou "sistema". "fornecedores"/"publicidade" são valores legados (= sistema). */
  marketingFonte?: ModoFonte | "fornecedores" | "publicidade";
  /** Legado (antes da Correção 09). Hoje vale `custoInfraFonte`. */
  custoInfraModo?: "orcamento" | "manual";
  custoInfraFonte?: ModoFonte;
  /** Correção 10: custo do terreno pela Negociação ("sistema") ou digitado ("manual"). */
  terrenoFonte?: ModoFonte;
  custoTerrenoManual?: number;
  terrenoParcelasManual?: number;
  terrenoMesInicio?: number;
  permutaFisicaUnidadesManual?: number;
  /** Considera aportes/resgates do Business Plan no fluxo (padrão: sim). */
  considerarCaptacao?: boolean;
  mesAporteCaptacao?: number;
  mixModo?: "cenario" | "manual";
  urbanismoModo?: "cenario" | "manual";
  urbanismoFonte?: string | null;
  areaBrutaM2: number;
  pctAreaPublica: number;
  pctAreaVerde: number;
  pctSistemaViario: number;
  pctFaixaServidao: number;
  duracaoVendasMeses: number;
  perfilVendas: PerfilVendas;
  entradaPct: number;
  prazoParcelamentoMeses: number;
  jurosClienteMensal: number;
  prazoRecursosPropriosMeses: number;
  jurosRecursosPropriosMensal: number;
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

/**
 * Custo/m² real vindo do Orçamento Parametrizado (2.4), quando já preenchido —
 * substitui o valor genérico de custoInfraM2Lote enquanto o usuário não
 * definir um valor próprio na Viabilidade.
 */
export function custoInfraDoOrcamentoParametrizado(estudo: EstudoData): number {
  if (!estudo.orcamentoParametrizadoJson) return 0;
  try {
    const salvo = JSON.parse(estudo.orcamentoParametrizadoJson) as PremissasOrcamentoParametrizado;
    const r = calcularOrcamentoParametrizado(salvo);
    if (salvo.metodo === "infraestrutura" || salvo.metodo === "excel") return salvo.areaReferenciaM2 && salvo.areaReferenciaM2 > 0 ? r.custoTotal / salvo.areaReferenciaM2 : 0;
    return r.custoM2Real > 0 ? r.custoM2Real : 0;
  } catch {
    return 0;
  }
}

/** Fonte única das áreas: cenário principal espelhado, inclusive lotes sem KML. */
export function urbanismoDoCenario(estudo: EstudoData) {
  return cenarioPrincipalDe({ massaCenariosJson: estudo.massaCenariosJson, cenarioEscolhidoId: estudo.cenarioEscolhidoId,
    areaBrutaM2: estudo.areaM2, semKml: estudo.semKml ?? false, lotesAvulsosJson: estudo.lotesAvulsosJson ?? null });
}

/**
 * Configuração das fontes de custo (Correção 09/10), com migração dos dados antigos:
 * modo explícito > modo legado > "sistema" quando o módulo de origem tem dado > "manual".
 * Os valores MANUAIS (`custoInfraM2Lote`, `marketing`, `custoTerrenoManual`) nunca são sobrescritos.
 */
export function configFontes(estudo: EstudoData, form: PremissasForm): ConfigFontes {
  const custoInfraFonte: ModoFonte = form.custoInfraFonte
    ?? (form.custoInfraModo === "orcamento" || infraDoOrcamento(estudo).disponivel ? "sistema" : "manual");
  const mf = form.marketingFonte;
  const marketingFonte: ModoFonte = mf === "sistema" || mf === "fornecedores" || mf === "publicidade" ? "sistema"
    : mf === "manual" ? "manual" : marketingDoSistema(estudo).disponivel ? "sistema" : "manual";
  const terrenoMesInicio = Number.isFinite(form.terrenoMesInicio) && (form.terrenoMesInicio as number) >= 0 ? Math.round(form.terrenoMesInicio as number) : 1;
  const terrenoFonte: ModoFonte = form.terrenoFonte ?? (terrenoDaNegociacao(estudo, terrenoMesInicio).disponivel ? "sistema" : "manual");
  return {
    custoInfraFonte, marketingFonte, terrenoFonte,
    considerarCaptacao: form.considerarCaptacao !== false,
    terrenoMesInicio,
    custoTerrenoManual: Number.isFinite(form.custoTerrenoManual) ? Math.max(0, form.custoTerrenoManual as number) : 0,
    terrenoParcelasManual: Number.isFinite(form.terrenoParcelasManual) ? Math.max(1, Math.round(form.terrenoParcelasManual as number)) : 1,
    permutaFisicaUnidadesManual: Number.isFinite(form.permutaFisicaUnidadesManual) ? Math.max(0, Math.floor(form.permutaFisicaUnidadesManual as number)) : 0,
    mesAporteCaptacao: Number.isFinite(form.mesAporteCaptacao) && (form.mesAporteCaptacao as number) >= 0 ? Math.round(form.mesAporteCaptacao as number) : 1,
  };
}

/** Premissas do motor já integradas às fontes do sistema + as fontes usadas (para o demonstrativo). */
export function montarViabilidade(estudo: EstudoData, form: PremissasForm, itensMix: ItemMixProduto[], pctAPP: number): { premissas: PremissasLoteamento; fontes: FontesResolvidas } {
  const base = paraMotor(form, itensMix, pctAPP);
  if (form.urbanismoModo === "cenario") {
    base.areaVendavelCenarioM2 = urbanismoDoCenario(estudo)?.quadroAreas?.areaLiquidaVendavelM2;
  }
  const fontes = resolverFontes(estudo, configFontes(estudo, form), { custoInfraM2Lote: form.custoInfraM2Lote, marketing: form.marketing }, calcularMix(itensMix).areaVendidaM2);
  return { premissas: aplicarFontes(base, fontes), fontes };
}

export function sincronizarUrbanismo(estudo: EstudoData, form: PremissasForm): PremissasForm {
  if (form.urbanismoModo !== "cenario") return form;
  const origem = urbanismoDoCenario(estudo);
  const q = origem?.quadroAreas;
  if (!q || q.areaBrutaM2 <= 0) return form;
  const pct = (area: number) => area / q.areaBrutaM2 * 100;
  return { ...form, urbanismoFonte: origem!.cenarioId ?? "lotes_avulsos", areaBrutaM2: q.areaBrutaM2,
    // Área pública total JÁ inclui vias e verde: aqui entra só a institucional.
    pctAreaPublica: pct(q.areaInstitucionalM2), pctAreaVerde: pct(q.areaVerdeM2), pctSistemaViario: pct(q.sistemaViarioM2),
    pctFaixaServidao: pct(q.faixaServidaoM2 + q.faixaTransmissaoM2 + q.supressaoVegetalM2 + q.outrasNaoParcelaveisM2) };
}

export function appDaViabilidade(estudo: EstudoData, form: PremissasForm): number {
  return form.urbanismoModo === "cenario" ? urbanismoDoCenario(estudo)?.quadroAreas?.appM2 ?? estudo.appAreaM2 ?? 0 : estudo.appAreaM2 ?? 0;
}

export function defaultsForm(estudo: EstudoData): PremissasForm {
  const custoParametrizado = custoInfraDoOrcamentoParametrizado(estudo);
  return {
    custoInfraModo: estudo.loteamentoJson ? "manual" : "orcamento",
    mixModo: estudo.loteamentoJson ? "manual" : "cenario",
    urbanismoModo: estudo.loteamentoJson ? "manual" : "cenario",
    areaBrutaM2: Math.round(estudo.areaM2) || 100_000,
    pctAreaPublica: 10,
    pctAreaVerde: 5,
    pctSistemaViario: 25,
    pctFaixaServidao: 0,
    duracaoVendasMeses: 24,
    perfilVendas: "lancamento_forte",
    entradaPct: 10,
    prazoParcelamentoMeses: 180,
    jurosClienteMensal: 0.52,
    prazoRecursosPropriosMeses: 0,
    jurosRecursosPropriosMensal: 0,
    indexacaoMensal: 0.4,
    vendasAVistaPct: 5,
    descontoAVistaPct: 10,
    inadimplenciaPct: 5,
    comissaoPctVgv: 5,
    despesasGeraisPctVgv: 3,
    impostosPctVgv: 6.58,
    taxaIncorporacaoPctVgv: 1,
    inicioObraMes: 0,
    duracaoObraMeses: 24,
    inicioVendasMes: 12,
    custoInfraM2Lote: custoParametrizado || 245,
    projetosLicencas: 500_000,
    marketing: 500_000,
    registroPorUnidade: 400,
    contingenciaPctInfra: 10,
    bdiPct: 10,
    taxaAdministracaoObraPct: 10,
    manutencaoPctObra: 1.5,
    inccObraMensal: 0.3,
    permutaPctVgv: 40,
    taxaDescontoAnual: 12,
  };
}

function lerJson<T>(json: string | null | undefined): T | null {
  try { return json ? JSON.parse(json) as T : null; } catch { return null; }
}

function valorPositivo(valor: number | null | undefined): number {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? valor : 0;
}

export function referenciasDePreco(estudo: EstudoData) {
  const mercado = lerJson<{ precoM2Lote?: number; precoM2Casa?: number; precoM2Apartamento?: number }>(estudo.estudoMercadoJson);
  let comparavel = 0;
  if (estudo.precificacaoComparaveisJson) {
    try {
      const salvo = JSON.parse(estudo.precificacaoComparaveisJson) as {
        atributos: AtributoComparavel[]; notasNovo: number[]; comparaveis: Comparavel[];
      };
      comparavel = valorPositivo(calcularPrecificacaoPorComparaveis(salvo.atributos, salvo.notasNovo, salvo.comparaveis).precoSugeridoM2);
    } catch { /* A referência pode não estar disponível. */ }
  }
  const mixSalvo = lerJson<ItemMixProduto[]>(estudo.mixJson);
  const loteSalvo = Array.isArray(mixSalvo)
    ? mixSalvo.find(item => item && !item.casaPronta && !item.apartamento && valorPositivo(item.precoM2))
    : undefined;
  const cenario = urbanismoDoCenario(estudo);
  const quadro = cenario?.quadroAreas;
  const areaVendavel = valorPositivo(quadro?.areaLiquidaVendavelM2);
  const precoLegado = cenario?.precoM2Lote ?? (areaVendavel ? valorPositivo(quadro?.vgv) / areaVendavel : 0);
  return {
    lote: comparavel || valorPositivo(mercado?.precoM2Lote)
      || valorPositivo(loteSalvo?.precoM2)
      || valorPositivo(precoLegado),
    casa: valorPositivo(mercado?.precoM2Casa),
    apartamento: valorPositivo(mercado?.precoM2Apartamento),
  };
}

export function resolverPrecoProduto(item: ItemMixProduto, refs: ReturnType<typeof referenciasDePreco>): ItemMixProduto {
  if (item.casaPronta || item.apartamento) {
    const precoResidencial = (item.apartamento ? refs.apartamento : refs.casa) * valorPositivo(item.areaPrivativaM2);
    // Uma referência geral de terreno não é preço de venda de um apartamento.
    const precoM2Anterior = valorPositivo(item.precoM2) || (item.apartamento ? 0 : refs.lote);
    const valorEquivalente = precoM2Anterior * valorPositivo(item.areaUnidadeM2);
    const preco = valorPositivo(item.precoUnidade) || precoResidencial || valorEquivalente;
    return { ...item, precoUnidade: Math.round(preco * 100) / 100 };
  }
  const area = valorPositivo(item.areaUnidadeM2);
  const precoM2 = valorPositivo(item.precoM2) || (area ? valorPositivo(item.precoUnidade) / area : 0) || refs.lote;
  return { ...item, precoM2 };
}

export function defaultsMix(estudo: EstudoData): ItemMixProduto[] {
  const cenario = urbanismoDoCenario(estudo);
  const mix = lerJson<ItemMixProduto[]>(estudo.mixJson);
  if (cenario) {
    const quantidade = cenario.lotes.length;
    const area = cenario.lotes.reduce((total, lote) => total + lote.areaM2, 0);
    return [{ nome: "Lotes", quantidade, areaUnidadeM2: quantidade > 0 ? area / quantidade : 0,
      precoM2: referenciasDePreco(estudo).lote }];
  }
  if (Array.isArray(mix) && mix.length > 0) return mix;
  return [{ nome: "Lotes", quantidade: 0, areaUnidadeM2: 0, precoM2: referenciasDePreco(estudo).lote }];
}

export function paraMotor(f: PremissasForm, itensMix: ItemMixProduto[], pctAPP: number): PremissasLoteamento {
  const pct = (v: number) => v / 100;
  return {
    areaBrutaM2: f.areaBrutaM2,
    pctAreaPublica: pct(f.pctAreaPublica),
    pctAreaVerde: pct(f.pctAreaVerde),
    pctSistemaViario: pct(f.pctSistemaViario),
    pctAPP,
    pctFaixaServidao: pct(f.pctFaixaServidao),
    itensMix,
    duracaoVendasMeses: f.duracaoVendasMeses,
    perfilVendas: f.perfilVendas,
    entradaPct: pct(f.entradaPct),
    prazoParcelamentoMeses: f.prazoParcelamentoMeses,
    jurosClienteMensal: pct(f.jurosClienteMensal),
    prazoRecursosPropriosMeses: f.prazoRecursosPropriosMeses,
    jurosRecursosPropriosMensal: pct(f.jurosRecursosPropriosMensal ?? 0),
    indexacaoMensal: pct(f.indexacaoMensal),
    vendasAVistaPct: pct(f.vendasAVistaPct),
    descontoAVistaPct: pct(f.descontoAVistaPct),
    inadimplenciaPct: pct(f.inadimplenciaPct),
    comissaoPctVgv: pct(f.comissaoPctVgv),
    despesasGeraisPctVgv: pct(f.despesasGeraisPctVgv),
    impostosPctVgv: pct(f.impostosPctVgv),
    taxaIncorporacaoPctVgv: pct(f.taxaIncorporacaoPctVgv),
    inicioObraMes: f.inicioObraMes,
    duracaoObraMeses: f.duracaoObraMeses,
    inicioVendasMes: f.inicioVendasMes,
    custoInfraM2Lote: f.custoInfraM2Lote,
    projetosLicencas: f.projetosLicencas,
    marketing: f.marketing,
    registroPorUnidade: f.registroPorUnidade,
    contingenciaPctInfra: pct(f.contingenciaPctInfra),
    bdiPct: pct(f.bdiPct),
    taxaAdministracaoObraPct: pct(f.taxaAdministracaoObraPct),
    manutencaoPctObra: pct(f.manutencaoPctObra),
    inccObraMensal: pct(f.inccObraMensal),
    permutaPctVgv: pct(f.permutaPctVgv),
    taxaDescontoAnual: pct(f.taxaDescontoAnual),
  };
}

/**
 * Reconstrói as premissas completas do motor a partir do estudo salvo — usada
 * pela aba Viabilidade e pelo Relatório Executivo consolidado para gerar os
 * mesmos indicadores sem duplicar a lógica de conversão de formulário → motor.
 * Retorna null se o estudo ainda não tem premissas de viabilidade salvas.
 */
export function montarPremissasLoteamento(estudo: EstudoData): PremissasLoteamento | null {
  return montarViabilidadeDoEstudo(estudo)?.premissas ?? null;
}

/** Igual a `montarPremissasLoteamento`, devolvendo também o formulário e as fontes resolvidas. */
export function montarViabilidadeDoEstudo(estudo: EstudoData): { premissas: PremissasLoteamento; fontes: FontesResolvidas; form: PremissasForm; itensMix: ItemMixProduto[] } | null {
  if (!estudo.loteamentoJson) return null;
  let salvo: (Partial<PremissasForm> & { itensMix?: ItemMixProduto[] }) | null = null;
  try {
    salvo = JSON.parse(estudo.loteamentoJson);
  } catch {
    return null;
  }
  if (!salvo) return null;

  const form: PremissasForm = sincronizarUrbanismo(estudo, { ...defaultsForm(estudo), ...salvo });
  const itens = form.mixModo !== "cenario" && Array.isArray(salvo.itensMix) ? salvo.itensMix : defaultsMix(estudo);
  const refs = referenciasDePreco(estudo);
  const itensMix = itens.map(item => resolverPrecoProduto(item, refs));
  const appAreaM2 = appDaViabilidade(estudo, form);
  const pctAPP = form.areaBrutaM2 > 0 ? appAreaM2 / form.areaBrutaM2 : 0;
  return { ...montarViabilidade(estudo, form, itensMix, pctAPP), form, itensMix };
}
