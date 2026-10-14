// Fonte única das classificações de Obra (Lote 1 — itens 06 e 07).
// Antes, a tela oferecia 25 valores, o servidor aceitava 5 e o banco tinha
// outros 15: qualquer escolha fora da interseção gerava `invalid_value`.

// Pedido A1 (13/10/2026): o seletor da edição oferece exatamente as mesmas
// situações do filtro da lista de obras, na mesma ordem.
export const OBRA_STATUS_TODOS = [
  "planning",
  "aprovacao",
  "contrato_prospecta",
  "laudo_cef",
  "conformidade_cef",
  "alvara",
  "art",
  "assinatura_cef",
  "vistoria_cef",
  "laudo_ok",
  "cartorio",
  "in_progress",
  "casa_pronta",
  "disponivel",
  "reavaliar",
  "distrato",
  "paused",
  "completed",
  "cancelled",
] as const;

export const OBRA_STATUS_SELECIONAVEIS = OBRA_STATUS_TODOS;

export type ObraStatus = (typeof OBRA_STATUS_TODOS)[number];

export const OBRA_STATUS_LABELS: Record<ObraStatus, string> = {
  planning: "Planejamento",
  aprovacao: "Aprovação",
  contrato_prospecta: "Contrato Prospecta",
  laudo_cef: "Laudo CEF",
  conformidade_cef: "Conformidade CEF",
  alvara: "Alvará",
  art: "ART",
  assinatura_cef: "Assinatura CEF",
  vistoria_cef: "Vistoria CEF",
  laudo_ok: "Laudo OK",
  cartorio: "Cartório",
  in_progress: "Em Andamento",
  casa_pronta: "Casa Pronta",
  disponivel: "Disponível",
  reavaliar: "Reavaliar",
  distrato: "Distrato",
  paused: "Pausada",
  completed: "Concluída",
  cancelled: "Cancelada",
};

export function obraStatusLabel(status: string): string {
  return (OBRA_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

export function isObraStatusSelecionavel(status: string): boolean {
  return (OBRA_STATUS_SELECIONAVEIS as readonly string[]).includes(status);
}

/**
 * Mensagem de erro compreensível quando a mudança de classificação não é
 * permitida; `null` quando é válida. Manter o status legado atual é sempre
 * permitido para não bloquear a edição de outros campos de obras antigas.
 */
export function validarMudancaStatusObra(atual: string, novo: string): string | null {
  if (novo === atual || isObraStatusSelecionavel(novo)) return null;
  const opcoes = OBRA_STATUS_SELECIONAVEIS.map(obraStatusLabel).join(", ");
  return `A classificação "${obraStatusLabel(novo)}" não está disponível. Escolha uma destas: ${opcoes}.`;
}
