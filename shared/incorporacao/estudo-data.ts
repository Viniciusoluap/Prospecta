// Estudo de Incorporação no formato do Grupo Santa Fé (referência do item 10).
// As abas do estudo foram portadas do Santa Fé sem alteração de lógica; este
// adaptador só traduz os nomes de coluna do Prospecta (inglês, Drizzle) para os
// nomes usados lá (português, Prisma). Decimais chegam do banco como texto.

export interface EstudoData {
  id: string;
  nome: string;
  municipio: string;
  estado: string;
  status: string;
  tipoIncorporacao?: string | null;
  dueDiligenceJson?: string | null;
  responsavel: string | null;
  versaoNumero?: number | null;
  colaboradores?: { id: string; nome: string }[];
  matriculaImovel?: string | null;
  carRegistro?: string | null;
  zoneamentoOficial?: string | null;
  zoneamentoFonte?: string | null;
  kmlUrl: string | null;
  geojson: string | null;
  areaM2: number;
  perimetroM: number;
  centroLat: number | null;
  centroLng: number | null;
  appAreaM2: number | null;
  appLarguraM: number | null;
  appOrigem: string | null;
  elevacaoJson: string | null;
  levantamentoUrl: string | null;
  parametrosJson: string | null;
  potencialJson: string | null;
  urbanismoParecer: string | null;
  pesquisaCidadeJson: string | null;
  estudoMercadoJson: string | null;
  precificacaoComparaveisJson: string | null;
  pesquisaPrimariaJson: string | null;
  quadroAreasJson: string | null;
  orcamentoParametrizadoJson: string | null;
  businessPlanJson: string | null;
  negociacaoTerrenoJson: string | null;
  projetistasJson: string | null;
  aprovacaoProjetoJson: string | null;
  registroIncorporacaoJson: string | null;
  orcamentoPreliminarJson: string | null;
  planejamentoLancamentoJson: string | null;
  fornecedoresLancamentoJson: string | null;
  materialPublicitarioJson: string | null;
  lancamentoImobiliarioJson: string | null;
  projetosExecutivosJson: string | null;
  orcamentoObraJson: string | null;
  cronogramaObraJson: string | null;
  atendimentoClientesJson: string | null;
  massaCenariosJson: string | null;
  cenarioEscolhidoId: string | null;
  mixJson: string | null;
  viabilidadeJson: string | null;
  parecerIa: string | null;
  loteamentoJson: string | null;
  relatorios: string;
}

/** Linha de `incorporation_studies` como o tRPC devolve (só os campos lidos aqui). */
export type LinhaEstudoProspecta = Record<string, unknown> & { id: number };

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function paraEstudoData(linha: LinhaEstudoProspecta): EstudoData {
  const r = linha as any;
  return {
    id: String(r.id),
    nome: r.name ?? "",
    municipio: r.city ?? "",
    estado: r.state ?? "",
    status: r.status,
    tipoIncorporacao: r.incorporationType,
    dueDiligenceJson: r.dueDiligenceJson,
    responsavel: r.responsible,
    matriculaImovel: r.propertyRegistration,
    carRegistro: r.carRegistration,
    zoneamentoOficial: r.officialZoning,
    zoneamentoFonte: r.zoningSource,
    kmlUrl: r.kmlUrl,
    geojson: r.geojson,
    areaM2: num(r.areaM2) ?? 0,
    perimetroM: num(r.perimeterM) ?? 0,
    centroLat: num(r.latitude),
    centroLng: num(r.longitude),
    appAreaM2: num(r.appAreaM2),
    appLarguraM: num(r.appWidthM),
    appOrigem: r.appOrigin,
    elevacaoJson: r.elevationJson,
    levantamentoUrl: r.surveyUrl,
    parametrosJson: r.urbanParametersJson,
    potencialJson: r.potentialJson,
    urbanismoParecer: r.urbanisticOpinion,
    pesquisaCidadeJson: r.cityResearchJson,
    estudoMercadoJson: r.marketStudyJson,
    precificacaoComparaveisJson: r.comparablePricingJson,
    pesquisaPrimariaJson: r.primaryResearchJson,
    quadroAreasJson: r.areasBoardJson,
    orcamentoParametrizadoJson: r.parameterizedBudgetJson,
    businessPlanJson: r.businessPlanJson,
    negociacaoTerrenoJson: r.landNegotiationJson,
    projetistasJson: r.designersJson,
    aprovacaoProjetoJson: r.projectApprovalJson,
    registroIncorporacaoJson: r.incorporationRegistrationJson,
    orcamentoPreliminarJson: r.preliminaryBudgetJson,
    planejamentoLancamentoJson: r.launchPlanJson,
    fornecedoresLancamentoJson: r.launchSuppliersJson,
    materialPublicitarioJson: r.marketingMaterialJson,
    lancamentoImobiliarioJson: r.realEstateLaunchJson,
    projetosExecutivosJson: r.executiveProjectsJson,
    orcamentoObraJson: r.workBudgetJson,
    cronogramaObraJson: r.physicalFinancialScheduleJson,
    atendimentoClientesJson: r.customerServiceJson,
    massaCenariosJson: r.massScenariosJson,
    cenarioEscolhidoId: r.selectedScenarioId,
    mixJson: r.productMixJson,
    viabilidadeJson: r.feasibilityJson,
    parecerIa: r.aiOpinion,
    loteamentoJson: r.lottingJson,
    relatorios: r.reportsJson ?? "[]",
  };
}
