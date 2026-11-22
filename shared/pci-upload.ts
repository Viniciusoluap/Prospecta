/** Limites compartilhados pelo cliente e servidor: cada requisição cabe na Vercel. */
export const MIME_PCI = {
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xlsb: "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
} as const;
export type FormatoPci = keyof typeof MIME_PCI;
export const ACEITE_ARQUIVO_PCI = [".xls", ".xlsx", ".xlsm", ".xlsb", ...Object.values(MIME_PCI)].join(",");
export const MENSAGEM_FORMATO_PCI = "Envie a PCI em .xls, .xlsx, .xlsm ou .xlsb (planilha da CAIXA).";
export function formatoPciPeloNome(nome: string): FormatoPci | null {
  const extensao = /\.(xls|xlsx|xlsm|xlsb)$/i.exec(nome)?.[1];
  return extensao ? extensao.toLowerCase() as FormatoPci : null;
}
export const LIMITE_PCI_BYTES = 8 * 1024 * 1024;
export const PARTE_PCI_BYTES = 1024 * 1024;
export const MAX_PARTES_PCI = Math.ceil(LIMITE_PCI_BYTES / PARTE_PCI_BYTES);
export function validarPartePci(entrada: { uploadId?: unknown; chunkIndex?: unknown; totalChunks?: unknown; chunk?: unknown; nome?: unknown }) {
  const { uploadId, chunkIndex, totalChunks, chunk, nome } = entrada;
  if (typeof uploadId !== "string" || !/^[a-zA-Z0-9-]{20,64}$/.test(uploadId)) throw new Error("Identificador de envio inválido.");
  if (!Number.isInteger(totalChunks) || Number(totalChunks) < 1 || Number(totalChunks) > MAX_PARTES_PCI || !Number.isInteger(chunkIndex) || Number(chunkIndex) < 0 || Number(chunkIndex) >= Number(totalChunks)) throw new Error("Parte da PCI inválida.");
  if (typeof nome !== "string" || !formatoPciPeloNome(nome) || nome.length > 255) throw new Error(MENSAGEM_FORMATO_PCI);
  if (typeof chunk !== "string" || !chunk || chunk.length > Math.ceil(PARTE_PCI_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(chunk) || (chunk.length / 4) * 3 - (chunk.endsWith("==") ? 2 : chunk.endsWith("=") ? 1 : 0) > PARTE_PCI_BYTES) throw new Error("Parte da PCI ausente ou inválida.");
  return { uploadId, chunkIndex: Number(chunkIndex), totalChunks: Number(totalChunks), chunk, nome };
}
/** Remove ruído binário do Excel na fronteira de importação, na precisão do banco. */
export function incidenciaPciParaTexto(valor: number): string {
  if (!Number.isFinite(valor) || valor < 0 || valor > 100) throw new Error("Incidência da PCI inválida.");
  return valor.toFixed(15).replace(/0+$/, "").replace(/\.$/, "");
}
export function validarMontagemPci<T extends { chunk_index: number; total_chunks: number; file_name: string; b64: string }>(partes: T[]) {
  if (!partes.length || partes.length !== partes[0].total_chunks || partes.length > MAX_PARTES_PCI || partes.some((p, i) => p.chunk_index !== i || p.total_chunks !== partes.length || p.file_name !== partes[0].file_name)) throw new Error("Envio incompleto. Selecione novamente a PCI.");
  return partes[0].file_name;
}
