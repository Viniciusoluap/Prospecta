// Jurídico — textos do resultado da conferência automática da assinatura (22/11/2026). Puro, testado em server/.
export type ResultadoValidacao = { estado: "valida" | "pendente" | "invalida"; motivo: string; transitoria: boolean } | null | undefined;

/** Texto do aviso depois de salvar: reflete o resultado REAL da conferência feita no servidor. */
export function avisoDaConferencia(v: ResultadoValidacao): { tipo: "success" | "warning" | "error"; texto: string } {
  if (!v) return { tipo: "warning", texto: "PDF assinado e salvo. A conferência automática não pôde ser registrada agora; confira o documento antes de enviar." };
  if (v.estado === "valida") return { tipo: "success", texto: "PDF assinado e salvo. Conferência automática do sistema: assinatura íntegra, cadeia ICP-Brasil e LCR conferidas." };
  if (v.estado === "pendente") return { tipo: "warning", texto: `PDF assinado e salvo. A conferência automática ficou pendente${v.transitoria ? " e será repetida" : ""}: ${v.motivo}` };
  return { tipo: "error", texto: `PDF salvo, mas a assinatura NÃO passou na conferência automática: ${v.motivo}` };
}
