export const LEAD_SERVICE_TYPES = [
  "obra_cliente",
  "projeto_tecnico",
  "regularizacao",
  "financiamento_habitacional",
  "consorcio",
  "despachante",
  "vistoria_medicao",
  "avaliacao",
  "juridico",
  "bpo_financeiro",
  "reembolso",
  "operacional_interno",
  "outro",
] as const;

export type LeadServiceType = (typeof LEAD_SERVICE_TYPES)[number];

export const LEAD_SERVICE_LABELS: Record<LeadServiceType, string> = {
  obra_cliente: "Obra / reforma do cliente",
  projeto_tecnico: "Projeto técnico",
  regularizacao: "Regularização imobiliária",
  financiamento_habitacional: "Financiamento habitacional",
  consorcio: "Consórcio",
  despachante: "Serviço de despachante",
  vistoria_medicao: "Vistoria e medição",
  avaliacao: "Avaliação imobiliária",
  juridico: "Jurídico",
  bpo_financeiro: "BPO financeiro",
  reembolso: "Reembolso",
  operacional_interno: "Operação interna",
  outro: "Outro serviço",
};

export const LEAD_SERVICE_MODULE: Record<LeadServiceType, string> = {
  obra_cliente: "obras",
  projeto_tecnico: "projetos",
  regularizacao: "regularizacoes",
  financiamento_habitacional: "financiamentos",
  consorcio: "financiamentos",
  despachante: "regularizacoes",
  vistoria_medicao: "obras",
  avaliacao: "avaliacoes",
  juridico: "juridico",
  bpo_financeiro: "bpo_financeiro",
  reembolso: "bpo_financeiro",
  operacional_interno: "tarefas",
  outro: "",
};

export function serviceTypeFromTrelloText(value: string): LeadServiceType {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (normalized.includes("planejamento semanal de obras")) return "obra_cliente";
  if (normalized.includes("vistoria") || normalized.includes("medicao")) return "vistoria_medicao";
  if (normalized.includes("projetos")) return "projeto_tecnico";
  if (normalized.includes("despachante")) return "despachante";
  if (normalized.includes("habitacional") || normalized.includes("contratos do mes")) return "financiamento_habitacional";
  if (normalized.includes("consorcio")) return "consorcio";
  if (normalized.includes("juridico")) return "juridico";
  if (normalized.includes("contas a pagar")) return "bpo_financeiro";
  if (normalized.includes("reembolso")) return "reembolso";
  if (normalized.includes("funcao") || normalized.includes("padronizar") || normalized.includes("meta mensal") || normalized.includes("codigo novo")) return "operacional_interno";
  return "outro";
}
