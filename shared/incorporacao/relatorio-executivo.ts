// Relatório Executivo de Incorporação — consolida, num único modelo testável,
// todos os temas pedidos (terreno/mapas/APP/restrições, dados
// cadastrais/urbanísticos, mercado/referências, estudo de massa/cenários,
// quadro de áreas, mix de produtos, custos/receitas/VGV,
// VPL/TIR/ROI/payback/fluxo de caixa, impostos/comissões/permutas,
// negociações/proposta aceita, documentos/licenças/pendências,
// cronograma/tarefas/responsáveis/riscos, premissas/fontes/data/versão).
//
// Função pura, sem I/O: recebe o registro de `incorporation_studies` (via
// `incorporacao.getById`, que já traz tudo numa única query) e devolve um
// modelo com uma entrada por seção. Cada seção nunca é omitida: ou carrega
// `dado` (com uma lista de `pendencias` pontuais quando algum subitem dentro
// dela ainda falta), ou é inteiramente `pendente` com uma mensagem explícita
// quando não há nenhum dado para aquele tema. A renderização em PDF
// (RelatorioExecutivo.tsx) só decide COMO desenhar — toda a regra de "o que
// está faltando" vive aqui, testável sem depender de jsPDF/DOM.

import {
  PARAMETROS_DEFAULT,
  calcularPotencial,
  type ParametrosUrbanisticos,
  type PotencialConstrutivo,
} from "./urbanismo.js";
import { calcularQuadroAreas, type ItemQuadroAreas, type ResultadoQuadroAreas } from "./quadro-areas.js";
import { calcularMix, type ItemMixProduto, type ResultadoMix } from "./mix-produtos.js";
import {
  calcularPrecificacaoPorComparaveis,
  type AtributoComparavel,
  type Comparavel,
  type ResultadoPrecificacao,
} from "./precificacao.js";
import {
  resumoPesquisaPrimaria,
  type Entrevistado,
  type ResumoPesquisaPrimaria,
} from "./pesquisa-primaria.js";
import {
  calcularLoteamento,
  type PremissasLoteamento,
  type ResultadoLoteamento,
  type PerfilVendas,
} from "./viabilidade-economica.js";
import {
  calcularOrcamentoParametrizado,
  type PremissasOrcamentoParametrizado,
  type ResultadoOrcamentoParametrizado,
} from "./orcamento-parametrizado.js";
import {
  resumoOrcamentoPreliminar,
  type ItemOrcamentoPreliminar,
  type ResumoOrcamentoPreliminar,
} from "./orcamento-preliminar.js";
import { resumoOrcamentoObra, type ItemOrcamentoObra, type ResumoOrcamentoObra } from "./orcamento-obra.js";
import {
  resumoNegociacao,
  type DadosNegociacao,
  type ResumoNegociacao,
  type Proposta,
} from "./negociacao.js";
import { resumoRegistro, type DocumentoRegistro, type ResumoRegistro } from "./registro-incorporacao.js";
import {
  resumoAprovacaoProjeto,
  type ProcessoAprovacao,
  type ResumoAprovacaoProjeto,
} from "./aprovacao-projeto.js";
import {
  resumoCronogramaObra,
  type MedicaoMensal,
  type RiscoExecucao,
  type ResumoCronogramaObra,
} from "./cronograma-obra.js";
import {
  resumoPlanejamentoLancamento,
  type MarcoLancamento,
  type ResumoPlanejamentoLancamento,
} from "./planejamento-lancamento.js";

// ─── Tipo genérico de seção ─────────────────────────────────────────────────
//
// Toda seção do relatório carrega OU um `dado` (com eventuais `pendencias`
// pontuais de subitens que faltam dentro dela) OU é inteiramente `pendente`
// com uma mensagem explícita — nunca é simplesmente omitida.

export type Secao<T> =
  | { status: "ok"; dado: T; pendencias: string[] }
  | { status: "pendente"; pendencia: string };

function ok<T>(dado: T, pendencias: string[] = []): Secao<T> {
  return { status: "ok", dado, pendencias };
}
function pendente<T>(pendencia: string): Secao<T> {
  return { status: "pendente", pendencia };
}

function parseJson<T>(json: string | null | undefined): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
function numOrNull(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// ─── Entrada: o registro de incorporation_studies que o relatório precisa ──

export interface EstudoParaRelatorioExecutivo {
  versionNumber?: number | null;
  staff?: { id: number; name: string | null }[];
  name: string;
  city: string;
  state: string;
  areaM2: string;
  perimeterM: string;
  latitude: string | null;
  longitude: string | null;
  appAreaM2: string | null;
  appWidthM: string | null;
  appOrigin: string | null;

  urbanParametersJson: string | null;
  potentialJson: string | null;
  urbanisticOpinion: string | null;
  propertyRegistration?: string | null;
  carRegistration?: string | null;
  officialZoning?: string | null;
  zoningSource?: string | null;

  cityResearchJson: string | null;
  marketStudyJson: string | null;
  comparablePricingJson: string | null;
  primaryResearchJson: string | null;

  massScenariosJson: string | null;
  selectedScenarioId: string | null;

  areasBoardJson: string | null;

  productMixJson: string | null;

  parameterizedBudgetJson: string | null;
  preliminaryBudgetJson: string | null;
  workBudgetJson: string | null;

  lottingJson: string | null;

  landNegotiationJson: string | null;

  incorporationRegistrationJson: string | null;
  projectApprovalJson: string | null;

  physicalFinancialScheduleJson: string | null;
  launchPlanJson: string | null;
}

// ─── 1. Terreno, mapas, APP e restrições ───────────────────────────────────

export interface TerrenoDado {
  areaM2: number;
  perimetroM: number;
  centro: { lat: number; lng: number } | null;
  app: { areaM2: number; larguraM: number | null; origem: string | null } | null;
}

function montarTerreno(e: EstudoParaRelatorioExecutivo): Secao<TerrenoDado> {
  const areaM2 = numOrNull(e.areaM2) ?? 0;
  if (areaM2 <= 0) {
    return pendente("Pendência: terreno ainda não delimitado (KML/mapa) para este estudo.");
  }
  const lat = numOrNull(e.latitude);
  const lng = numOrNull(e.longitude);
  const appAreaM2 = numOrNull(e.appAreaM2);
  const pendencias: string[] = [];
  if (appAreaM2 == null) {
    pendencias.push("Pendência: área de APP (faixa de preservação permanente) ainda não calculada automaticamente para este terreno.");
  }
  return ok(
    {
      areaM2,
      perimetroM: numOrNull(e.perimeterM) ?? 0,
      centro: lat != null && lng != null ? { lat, lng } : null,
      app: appAreaM2 != null ? { areaM2: appAreaM2, larguraM: numOrNull(e.appWidthM), origem: e.appOrigin ?? null } : null,
    },
    pendencias
  );
}

// ─── 2. Dados cadastrais / urbanísticos ────────────────────────────────────

export interface DadosCadastraisDado {
  parametros: ParametrosUrbanisticos;
  potencial: PotencialConstrutivo;
  opiniao: string | null;
  areaMediaUnidadeM2: number | null;
  propertyRegistration: string | null;
  carRegistration: string | null;
  officialZoning: string | null;
  zoningSource: string | null;
}

function montarDadosCadastraisUrbanisticos(e: EstudoParaRelatorioExecutivo): Secao<DadosCadastraisDado> {
  const parametrosSalvos = parseJson<Partial<ParametrosUrbanisticos>>(e.urbanParametersJson);
  if (!parametrosSalvos) {
    return pendente("Pendência: parâmetros urbanísticos (Plano Diretor) ainda não cadastrados para este estudo.");
  }
  const parametros: ParametrosUrbanisticos = { ...PARAMETROS_DEFAULT, ...parametrosSalvos };
  const areaTerrenoM2 = numOrNull(e.areaM2) ?? 0;
  const potencialSalvo = parseJson<{ areaMediaUnidadeM2?: number }>(e.potentialJson);
  const areaMediaUnidadeM2 = potencialSalvo?.areaMediaUnidadeM2 ?? null;
  const potencial = calcularPotencial(areaTerrenoM2, parametros, areaMediaUnidadeM2 ?? undefined);

  const pendencias: string[] = [];
  if (areaMediaUnidadeM2 == null) {
    pendencias.push("Pendência: área média por unidade não informada — capacidade vertical e vagas exigidas não puderam ser estimadas.");
  }
  if (!e.propertyRegistration?.trim()) pendencias.push("Pendência: matrícula do imóvel não informada; consultar o cartório de registro.");
  if (!e.carRegistration?.trim()) pendencias.push("Pendência: CAR não informado; verificar aplicabilidade e consultar o órgão ambiental.");
  if (!e.officialZoning?.trim() || !e.zoningSource?.trim()) pendencias.push("Pendência: zoneamento oficial sem classificação e fonte verificável da prefeitura.");
  return ok({ parametros, potencial, opiniao: e.urbanisticOpinion ?? null, areaMediaUnidadeM2,
    propertyRegistration: e.propertyRegistration?.trim() || null,
    carRegistration: e.carRegistration?.trim() || null,
    officialZoning: e.officialZoning?.trim() || null,
    zoningSource: e.zoningSource?.trim() || null,
  }, pendencias);
}

// ─── 3. Mercado / referências ──────────────────────────────────────────────

interface CidadeResearch {
  populacao: number;
  crescimentoAnualPct: number;
  pibPerCapita: number;
  principaisAtividades: string[];
  rendaMediaMensal: number;
  deficitHabitacional: string;
  resumo: string;
}
interface MercadoStudy {
  precoM2Lote: number;
  precoM2Casa: number;
  precoM2Apartamento: number;
  velocidadeVendas: string;
  demandaPorProduto: { produto: string; demanda: string; publico: string }[];
  concorrentes: { nome: string; produto: string; faixaPreco: string }[];
  comparaveis: { descricao: string; preco: number; area: number; precoPorM2: number }[];
  oportunidades: string;
  riscos: string;
  /** Persistidos desde a correção do Lote 6 (antes eram descartados ao salvar). Podem faltar em estudos salvos antes da correção. */
  fontes?: string[];
  confiabilidade?: "alta" | "media" | "baixa";
}

export interface MercadoReferenciasDado {
  cidade: CidadeResearch | null;
  mercado: MercadoStudy | null;
  fontes: string[] | null;
  confiabilidade: "alta" | "media" | "baixa" | null;
  precificacao: ResultadoPrecificacao | null;
  pesquisaPrimaria: ResumoPesquisaPrimaria | null;
}

function montarMercadoReferencias(e: EstudoParaRelatorioExecutivo): Secao<MercadoReferenciasDado> {
  const cidade = parseJson<CidadeResearch>(e.cityResearchJson);
  const mercado = parseJson<MercadoStudy>(e.marketStudyJson);
  const dadosPrecificacao = parseJson<{ atributos?: AtributoComparavel[]; notasNovo?: number[]; comparaveis?: Comparavel[] }>(
    e.comparablePricingJson
  );
  const dadosPesquisaPrimaria = parseJson<{ entrevistados?: Entrevistado[] }>(e.primaryResearchJson);

  const temPrecificacao = !!dadosPrecificacao?.atributos?.length;
  const temPesquisaPrimaria = !!dadosPesquisaPrimaria?.entrevistados?.length;

  if (!cidade && !mercado && !temPrecificacao && !temPesquisaPrimaria) {
    return pendente(
      "Pendência: pesquisa de mercado (cidade + imobiliário), precificação por comparáveis e pesquisa primária com compradores ainda não realizadas para este estudo."
    );
  }

  const pendencias: string[] = [];
  if (!cidade && !mercado) {
    pendencias.push("Pendência: pesquisa da cidade e do mercado imobiliário (IA ou manual) ainda não realizada.");
  } else if (!mercado?.fontes || mercado.fontes.length === 0) {
    pendencias.push("Pendência: fontes da pesquisa de mercado não registradas para este estudo.");
  }
  if (!temPrecificacao) {
    pendencias.push("Pendência: precificação por comparáveis ponderados ainda não cadastrada.");
  }
  if (!temPesquisaPrimaria) {
    pendencias.push("Pendência: pesquisa primária com compradores ainda não realizada.");
  }

  const precificacao = temPrecificacao
    ? calcularPrecificacaoPorComparaveis(
        dadosPrecificacao!.atributos!,
        dadosPrecificacao!.notasNovo ?? dadosPrecificacao!.atributos!.map(() => 0),
        dadosPrecificacao!.comparaveis ?? []
      )
    : null;
  const pesquisaPrimaria = temPesquisaPrimaria ? resumoPesquisaPrimaria(dadosPesquisaPrimaria!.entrevistados!) : null;

  return ok(
    {
      cidade: cidade ?? null,
      mercado: mercado ?? null,
      fontes: mercado?.fontes ?? null,
      confiabilidade: mercado?.confiabilidade ?? null,
      precificacao,
      pesquisaPrimaria,
    },
    pendencias
  );
}

// ─── 4. Estudo de massa / cenários ──────────────────────────────────────────

interface CenarioMassaKpis {
  lotesVendaveis: number;
  lotesPublicos: number;
  areaVendavelM2: number;
  areaPublicaM2: number;
  aproveitamento: number;
  vgv: number;
}
interface CenarioMassaResumo {
  id: string;
  testadaLoteM: number;
  profundidadeLoteM: number;
  larguraViaM: number;
  kpis: CenarioMassaKpis;
}

export interface EstudoMassaDado {
  cenario: CenarioMassaResumo;
  totalCenarios: number;
  eraSelecaoExplicita: boolean;
}

function montarEstudoMassa(e: EstudoParaRelatorioExecutivo): Secao<EstudoMassaDado> {
  const massa = parseJson<{ cenarios?: CenarioMassaResumo[] }>(e.massScenariosJson);
  const cenarios = massa?.cenarios ?? [];
  if (cenarios.length === 0) {
    return pendente("Pendência: estudo de massa (parcelamento gerativo) ainda não gerado para este terreno.");
  }
  const selecionado = cenarios.find((c) => c.id === e.selectedScenarioId);
  const cenario = selecionado ?? cenarios[0];
  const pendencias: string[] = [];
  if (!selecionado) {
    pendencias.push("Observação: nenhum cenário foi marcado como selecionado — exibindo o primeiro gerado.");
  }
  return ok({ cenario, totalCenarios: cenarios.length, eraSelecaoExplicita: !!selecionado }, pendencias);
}

// ─── 5. Quadro de áreas ─────────────────────────────────────────────────────

export interface QuadroAreasDado {
  resultado: ResultadoQuadroAreas;
  itens: ItemQuadroAreas[];
}

function montarQuadroAreas(e: EstudoParaRelatorioExecutivo): Secao<QuadroAreasDado> {
  const salvo = parseJson<{ coeficienteAproveitamento?: number; itens?: ItemQuadroAreas[] }>(e.areasBoardJson);
  if (!salvo?.itens || salvo.itens.length === 0) {
    return pendente("Pendência: quadro de áreas (NBR 12721) ainda não preenchido.");
  }
  const areaTerrenoM2 = numOrNull(e.areaM2) ?? 0;
  const resultado = calcularQuadroAreas(salvo.itens, areaTerrenoM2, salvo.coeficienteAproveitamento ?? 1);
  return ok({ resultado, itens: salvo.itens });
}

// ─── 6. Mix de produtos ─────────────────────────────────────────────────────

export interface MixProdutosDado {
  resultado: ResultadoMix;
}

function montarMixProdutos(e: EstudoParaRelatorioExecutivo): Secao<MixProdutosDado> {
  const itens = parseJson<ItemMixProduto[]>(e.productMixJson);
  if (!itens || !Array.isArray(itens) || !itens.some((i) => i.quantidade > 0)) {
    return pendente("Pendência: mix de produtos (lotes/casas/apartamentos) ainda não cadastrado.");
  }
  return ok({ resultado: calcularMix(itens) });
}

// ─── Reconstrução das premissas de Viabilidade Econômica a partir do JSON ──
// `lottingJson` guarda o formulário tal como preenchido na UI (percentuais em
// 0-100, não em fração 0-1) — mesma conversão de `paraMotor` em
// ViabilidadeEconomica.tsx, duplicada aqui porque é lógica de apresentação
// de formulário, não pertence ao motor puro de viabilidade-economica.ts.

interface PremissasFormSalvas {
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

const DEFAULTS_FORM_EVE: PremissasFormSalvas = {
  areaBrutaM2: 100_000,
  pctAreaPublica: 10,
  pctAreaVerde: 5,
  pctSistemaViario: 25,
  pctFaixaServidao: 0,
  duracaoVendasMeses: 24,
  perfilVendas: "lancamento_forte",
  entradaPct: 10,
  prazoParcelamentoMeses: 180,
  jurosClienteMensal: 0.52,
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
  custoInfraM2Lote: 245,
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

function construirPremissasViabilidade(
  raw: Partial<PremissasFormSalvas> & { itensMix?: ItemMixProduto[] },
  areaTerrenoM2: number,
  appAreaM2: number
): PremissasLoteamento {
  const f: PremissasFormSalvas = { ...DEFAULTS_FORM_EVE, ...raw };
  const itensMix = raw.itensMix && raw.itensMix.length > 0 ? raw.itensMix : [];
  const pctAPP = f.areaBrutaM2 > 0 ? appAreaM2 / f.areaBrutaM2 : 0;
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

interface ViabilidadeComputada {
  premissas: PremissasLoteamento;
  resultado: ResultadoLoteamento;
}

function viabilidadeComputada(e: EstudoParaRelatorioExecutivo): ViabilidadeComputada | null {
  const raw = parseJson<Partial<PremissasFormSalvas> & { itensMix?: ItemMixProduto[] }>(e.lottingJson);
  if (!raw || !raw.itensMix || raw.itensMix.length === 0) return null;
  const areaTerrenoM2 = numOrNull(e.areaM2) ?? 0;
  const appAreaM2 = numOrNull(e.appAreaM2) ?? 0;
  const premissas = construirPremissasViabilidade(raw, areaTerrenoM2, appAreaM2);
  return { premissas, resultado: calcularLoteamento(premissas) };
}

// ─── 7. Custos / receitas / VGV ─────────────────────────────────────────────

export interface CustosReceitasVgvDado {
  parametrizado: ResultadoOrcamentoParametrizado | null;
  preliminar: ResumoOrcamentoPreliminar | null;
  obra: ResumoOrcamentoObra | null;
  vgvBruto: number | null;
  vgvLiquido: number | null;
  origemVgv: "viabilidade_economica" | "mix_de_produtos" | null;
}

function montarCustosReceitasVgv(e: EstudoParaRelatorioExecutivo, eve: ViabilidadeComputada | null): Secao<CustosReceitasVgvDado> {
  const premissasParametrizado = parseJson<PremissasOrcamentoParametrizado>(e.parameterizedBudgetJson);
  const parametrizado =
    premissasParametrizado && premissasParametrizado.itens?.length > 0
      ? calcularOrcamentoParametrizado(premissasParametrizado)
      : null;

  const itensPreliminar = parseJson<{ itens?: ItemOrcamentoPreliminar[] }>(e.preliminaryBudgetJson)?.itens ?? null;
  const preliminar =
    itensPreliminar && itensPreliminar.length > 0
      ? resumoOrcamentoPreliminar(itensPreliminar, parametrizado?.custoTotal ?? null)
      : null;

  const itensObra = parseJson<{ itens?: ItemOrcamentoObra[] }>(e.workBudgetJson)?.itens ?? null;
  const obra =
    itensObra && itensObra.length > 0 ? resumoOrcamentoObra(itensObra, preliminar?.totalOrcado ?? null) : null;

  const mix = parseJson<ItemMixProduto[]>(e.productMixJson);
  const mixCalculado = mix && mix.some((i) => i.quantidade > 0) ? calcularMix(mix) : null;

  let vgvBruto: number | null = null;
  let vgvLiquido: number | null = null;
  let origemVgv: CustosReceitasVgvDado["origemVgv"] = null;
  if (eve) {
    vgvBruto = eve.resultado.vgvGross;
    vgvLiquido = eve.resultado.vgvNet;
    origemVgv = "viabilidade_economica";
  } else if (mixCalculado) {
    vgvBruto = mixCalculado.vgv;
    origemVgv = "mix_de_produtos";
  }

  if (!parametrizado && !preliminar && !obra && vgvBruto == null) {
    return pendente(
      "Pendência: nenhum orçamento (parametrizado, preliminar ou da obra) nem VGV disponível — cadastre o mix de produtos ou a viabilidade econômica, e os orçamentos de obra."
    );
  }

  const pendencias: string[] = [];
  if (!parametrizado) pendencias.push("Pendência: orçamento parametrizado ainda não cadastrado.");
  if (!preliminar) pendencias.push("Pendência: orçamento preliminar ainda não cadastrado.");
  if (!obra) pendencias.push("Pendência: orçamento executivo da obra (orçado x realizado) ainda não cadastrado.");
  if (vgvBruto == null) {
    pendencias.push("Pendência: VGV ainda não calculável — nem o mix de produtos nem a viabilidade econômica estão preenchidos.");
  } else if (vgvLiquido == null) {
    pendencias.push(
      "Pendência: VGV líquido depende das premissas de impostos/comissão/despesas da Viabilidade Econômica (EVE), ainda não calculada."
    );
  }

  return ok({ parametrizado, preliminar, obra, vgvBruto, vgvLiquido, origemVgv }, pendencias);
}

// ─── 8. VPL / TIR / ROI / payback / fluxo de caixa ─────────────────────────

export interface ViabilidadeEconomicaDado {
  resultado: ResultadoLoteamento;
}

function montarViabilidadeEconomica(eve: ViabilidadeComputada | null): Secao<ViabilidadeEconomicaDado> {
  if (!eve) {
    return pendente(
      "Pendência: viabilidade econômica (EVE) ainda não calculada — informe as premissas na aba \"Viabilidade Econômica\" para obter VPL, TIR, ROI, payback e fluxo de caixa."
    );
  }
  const pendencias: string[] = [];
  if (eve.resultado.tirMensal == null) {
    pendencias.push("Pendência: TIR não encontrada (fluxo de caixa sem troca de sinal no intervalo analisado).");
  }
  if (eve.resultado.paybackMes == null) {
    pendencias.push("Pendência: payback não atingido dentro do horizonte de fluxo de caixa projetado.");
  }
  return ok({ resultado: eve.resultado }, pendencias);
}

// ─── 9. Impostos / comissões / permutas ────────────────────────────────────

export interface ImpostosComissoesPermutasDado {
  rotulo: string;
  percentuais: {
    impostosPctVgv: number;
    comissaoPctVgv: number;
    permutaPctVgv: number;
    despesasGeraisPctVgv: number;
    taxaIncorporacaoPctVgv: number;
  };
  valores: {
    impostos: number;
    comissao: number;
    despesasGerais: number;
    taxaIncorporacao: number;
    permuta: number;
  };
  vgvGross: number;
}

function montarImpostosComissoesPermutas(eve: ViabilidadeComputada | null): Secao<ImpostosComissoesPermutasDado> {
  if (!eve) {
    return pendente(
      "Pendência: percentuais de impostos, comissão e permuta ainda não definidos — dependem das premissas da Viabilidade Econômica (EVE), ainda não calculada."
    );
  }
  const { premissas, resultado } = eve;
  const vgv = resultado.vgvGross;
  return ok({
    rotulo: "estimativa baseada nas premissas de viabilidade",
    percentuais: {
      impostosPctVgv: premissas.impostosPctVgv,
      comissaoPctVgv: premissas.comissaoPctVgv,
      permutaPctVgv: premissas.permutaPctVgv,
      despesasGeraisPctVgv: premissas.despesasGeraisPctVgv,
      taxaIncorporacaoPctVgv: premissas.taxaIncorporacaoPctVgv,
    },
    valores: {
      // impostos/comissão/despesas: valor = vgvGross × percentual, mesma
      // fórmula aplicada dentro de calcularLoteamento() em
      // viabilidade-economica.ts (ver `comissao`/`despesas`/`impostos`
      // locais naquela função) — recalculada aqui porque o motor devolve
      // apenas o agregado `custosDuranteVenda`, não os três valores
      // separados.
      impostos: vgv * premissas.impostosPctVgv,
      comissao: vgv * premissas.comissaoPctVgv,
      despesasGerais: vgv * premissas.despesasGeraisPctVgv,
      taxaIncorporacao: resultado.custosDetalhados.taxaIncorporacao,
      // permuta: recebiveis.terreneiro já é o valor efetivamente calculado
      // pelo motor (soma mês a mês de receitaBruta × permutaPctVgv sobre o
      // total recebido, líquido de inadimplência) — valor real, não
      // reconstruído.
      permuta: resultado.recebiveis.terreneiro,
    },
    vgvGross: vgv,
  });
}

// ─── 10. Negociações / proposta aceita ──────────────────────────────────────

export interface NegociacoesDado {
  proprietarioNome: string;
  proprietarioContato: string;
  resumo: ResumoNegociacao;
  propostas: Proposta[];
}

function montarNegociacoes(e: EstudoParaRelatorioExecutivo, eve: ViabilidadeComputada | null): Secao<NegociacoesDado> {
  const dados = parseJson<DadosNegociacao>(e.landNegotiationJson);
  if (!dados || !dados.propostas || dados.propostas.length === 0) {
    return pendente("Pendência: nenhuma negociação de terreno registrada para este estudo.");
  }
  const vgvGross = eve?.resultado.vgvGross ?? dados.vgvGrossManual ?? 0;
  const resumo = resumoNegociacao(dados, vgvGross);
  const pendencias: string[] = [];
  if (!resumo.fechada) {
    pendencias.push(
      `Pendência: nenhuma proposta foi aceita até o momento — status atual: ${resumo.propostaAtual?.status ?? "sem proposta"}.`
    );
  }
  return ok(
    { proprietarioNome: dados.proprietarioNome ?? "", proprietarioContato: dados.proprietarioContato ?? "", resumo, propostas: dados.propostas },
    pendencias
  );
}

// ─── 11. Documentos / licenças / pendências ────────────────────────────────

export interface DocumentosLicencasDado {
  registro: ResumoRegistro | null;
  aprovacao: ResumoAprovacaoProjeto | null;
}

function montarDocumentosLicencas(e: EstudoParaRelatorioExecutivo): Secao<DocumentosLicencasDado> {
  const documentos = parseJson<{ documentos?: DocumentoRegistro[] }>(e.incorporationRegistrationJson)?.documentos ?? null;
  const processos = parseJson<{ processos?: ProcessoAprovacao[] }>(e.projectApprovalJson)?.processos ?? null;

  if ((!documentos || documentos.length === 0) && (!processos || processos.length === 0)) {
    return pendente(
      "Pendência: nenhum documento do registro de incorporação (art. 32 da Lei 4.591/64) nem processo de aprovação de projeto cadastrado."
    );
  }
  const pendencias: string[] = [];
  if (!documentos || documentos.length === 0) pendencias.push("Pendência: checklist de documentos para registro da incorporação ainda não cadastrado.");
  if (!processos || processos.length === 0) pendencias.push("Pendência: processos de aprovação de projeto junto aos órgãos competentes ainda não cadastrados.");

  return ok(
    {
      registro: documentos && documentos.length > 0 ? resumoRegistro(documentos) : null,
      aprovacao: processos && processos.length > 0 ? resumoAprovacaoProjeto(processos) : null,
    },
    pendencias
  );
}

// ─── 12. Cronograma / tarefas / responsáveis / riscos ──────────────────────

export interface CronogramaDado {
  obra: ResumoCronogramaObra | null;
  lancamento: ResumoPlanejamentoLancamento | null;
  responsaveisPorTarefa: { tarefa: string; responsavel: string }[];
  riscosExecucao: { descricao: string; impacto: string; mitigacao: string; responsavel: string; status: string }[];
}

function montarCronograma(e: EstudoParaRelatorioExecutivo, eve: ViabilidadeComputada | null): Secao<CronogramaDado> {
  const schedule = parseJson<{ medicoes?: MedicaoMensal[]; duracaoObraMeses?: number; riscos?: RiscoExecucao[] }>(e.physicalFinancialScheduleJson);
  const medicoes = schedule?.medicoes ?? null;
  const marcos = parseJson<{ marcos?: MarcoLancamento[] }>(e.launchPlanJson)?.marcos ?? null;
  const equipe = new Map((e.staff ?? []).map((u) => [u.id, u.name ?? `Usuário ${u.id}`]));
  const tarefas = [...(medicoes ?? []).map((m) => ({ tarefa: `Medição do mês ${m.mes + 1}`, id: m.responsavelId })),
    ...(marcos ?? []).map((m) => ({ tarefa: m.nome, id: m.responsavelId }))];
  const responsaveisPorTarefa = tarefas.filter((t) => t.id && equipe.has(t.id))
    .map((t) => ({ tarefa: t.tarefa, responsavel: equipe.get(t.id!)! }));
  const riscosExecucao = (schedule?.riscos ?? []).map((r) => ({ descricao: r.descricao, impacto: r.impacto,
    mitigacao: r.mitigacao, responsavel: equipe.get(r.responsavelId ?? -1) ?? "Não atribuído", status: r.status }));

  if ((!medicoes || medicoes.length === 0) && (!marcos || marcos.length === 0)) {
    return pendente("Pendência: cronograma físico-financeiro de obra e marcos do planejamento de lançamento ainda não cadastrados.");
  }

  // Duração informada manualmente no próprio cronograma tem prioridade; na
  // ausência, cai para a duração de obra usada nas premissas da Viabilidade
  // Econômica (quando ela existir).
  const duracaoObraMeses = schedule?.duracaoObraMeses || eve?.premissas.duracaoObraMeses || null;
  const pendencias: string[] = [];
  if (!medicoes || medicoes.length === 0) pendencias.push("Pendência: cronograma físico-financeiro de obra (curva S) ainda não cadastrado.");
  if (!marcos || marcos.length === 0) pendencias.push("Pendência: marcos do planejamento de lançamento ainda não cadastrados.");
  if (responsaveisPorTarefa.length < tarefas.length) pendencias.push("Pendência: marcos ou medições sem responsável individual atribuído.");
  if (!riscosExecucao.length) pendencias.push("Pendência: riscos de execução ainda não registrados no cronograma.");

  return ok(
    {
      obra: medicoes && medicoes.length > 0 ? resumoCronogramaObra(medicoes, duracaoObraMeses) : null,
      lancamento: marcos && marcos.length > 0 ? resumoPlanejamentoLancamento(marcos) : null,
      responsaveisPorTarefa, riscosExecucao,
    },
    pendencias
  );
}

// ─── 13. Premissas, fontes, data e versão ──────────────────────────────────

export interface PremissasFontesDataVersaoDado {
  geradoEm: string; // ISO — timestamp real do momento da geração do PDF
  versao: number | null;
  premissasViabilidade: {
    impostosPctVgv: number;
    comissaoPctVgv: number;
    permutaPctVgv: number;
    despesasGeraisPctVgv: number;
    taxaIncorporacaoPctVgv: number;
    taxaDescontoAnual: number;
  } | null;
  parametrosUrbanisticosRelevantes: { zona: string; taxaOcupacao: number; coefAproveitamento: number; loteMinimoM2: number } | null;
  fontesPesquisaMercado: string[] | null;
}

function montarPremissasFontesDataVersao(
  e: EstudoParaRelatorioExecutivo,
  geradoEm: Date,
  raw: (Partial<PremissasFormSalvas> & { itensMix?: ItemMixProduto[] }) | null,
  mercado: MercadoStudy | null
): Secao<PremissasFontesDataVersaoDado> {
  const parametrosSalvos = parseJson<Partial<ParametrosUrbanisticos>>(e.urbanParametersJson);
  const pendencias: string[] = [];

  let premissasViabilidade: PremissasFontesDataVersaoDado["premissasViabilidade"] = null;
  if (raw) {
    const f: PremissasFormSalvas = { ...DEFAULTS_FORM_EVE, ...raw };
    premissasViabilidade = {
      impostosPctVgv: f.impostosPctVgv,
      comissaoPctVgv: f.comissaoPctVgv,
      permutaPctVgv: f.permutaPctVgv,
      despesasGeraisPctVgv: f.despesasGeraisPctVgv,
      taxaIncorporacaoPctVgv: f.taxaIncorporacaoPctVgv,
      taxaDescontoAnual: f.taxaDescontoAnual,
    };
  } else {
    pendencias.push("Pendência: premissas de viabilidade econômica (impostos/comissão/permuta) ainda não preenchidas.");
  }

  let parametrosUrbanisticosRelevantes: PremissasFontesDataVersaoDado["parametrosUrbanisticosRelevantes"] = null;
  if (parametrosSalvos) {
    const p = { ...PARAMETROS_DEFAULT, ...parametrosSalvos };
    parametrosUrbanisticosRelevantes = {
      zona: p.zona,
      taxaOcupacao: p.taxaOcupacao,
      coefAproveitamento: p.coefAproveitamento,
      loteMinimoM2: p.loteMinimoM2,
    };
  } else {
    pendencias.push("Pendência: parâmetros urbanísticos ainda não cadastrados.");
  }

  const fontesPesquisaMercado = mercado?.fontes && mercado.fontes.length > 0 ? mercado.fontes : null;
  if (!fontesPesquisaMercado) {
    pendencias.push("Pendência: fontes da pesquisa de mercado não registradas.");
  }

  if (!e.versionNumber) pendencias.push("Pendência: histórico de versões indisponível para este estudo.");

  return ok(
    {
      geradoEm: geradoEm.toISOString(),
      versao: e.versionNumber ?? null,
      premissasViabilidade,
      parametrosUrbanisticosRelevantes,
      fontesPesquisaMercado,
    },
    pendencias
  );
}

// ─── Modelo final ───────────────────────────────────────────────────────────

export interface RelatorioExecutivoModel {
  terreno: Secao<TerrenoDado>;
  dadosCadastraisUrbanisticos: Secao<DadosCadastraisDado>;
  mercadoReferencias: Secao<MercadoReferenciasDado>;
  estudoMassa: Secao<EstudoMassaDado>;
  quadroAreas: Secao<QuadroAreasDado>;
  mixProdutos: Secao<MixProdutosDado>;
  custosReceitasVgv: Secao<CustosReceitasVgvDado>;
  viabilidadeEconomica: Secao<ViabilidadeEconomicaDado>;
  impostosComissoesPermutas: Secao<ImpostosComissoesPermutasDado>;
  negociacoes: Secao<NegociacoesDado>;
  documentosLicencas: Secao<DocumentosLicencasDado>;
  cronograma: Secao<CronogramaDado>;
  premissasFontesDataVersao: Secao<PremissasFontesDataVersaoDado>;
}

/**
 * Monta o modelo completo do Relatório Executivo a partir do registro de
 * `incorporation_studies`. Função pura (exceto o relógio, que pode ser
 * injetado via `geradoEm` para tornar os testes determinísticos — a UI que
 * gera o PDF não precisa passar nada, o padrão é `new Date()` no instante da
 * chamada).
 */
export function montarRelatorioExecutivo(
  e: EstudoParaRelatorioExecutivo,
  geradoEm: Date = new Date()
): RelatorioExecutivoModel {
  const eve = viabilidadeComputada(e);
  const rawViabilidade = parseJson<Partial<PremissasFormSalvas> & { itensMix?: ItemMixProduto[] }>(e.lottingJson);
  const mercado = parseJson<MercadoStudy>(e.marketStudyJson);

  return {
    terreno: montarTerreno(e),
    dadosCadastraisUrbanisticos: montarDadosCadastraisUrbanisticos(e),
    mercadoReferencias: montarMercadoReferencias(e),
    estudoMassa: montarEstudoMassa(e),
    quadroAreas: montarQuadroAreas(e),
    mixProdutos: montarMixProdutos(e),
    custosReceitasVgv: montarCustosReceitasVgv(e, eve),
    viabilidadeEconomica: montarViabilidadeEconomica(eve),
    impostosComissoesPermutas: montarImpostosComissoesPermutas(eve),
    negociacoes: montarNegociacoes(e, eve),
    documentosLicencas: montarDocumentosLicencas(e),
    cronograma: montarCronograma(e, eve),
    premissasFontesDataVersao: montarPremissasFontesDataVersao(e, geradoEm, rawViabilidade, mercado),
  };
}
