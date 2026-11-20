// EPIC-024 S-06 — proposta formal de aquisição do terreno (PDF e e-mail). O PDF vem sempre do servidor, do gerador
// único: o arquivo baixado e o anexo do e-mail são os mesmos bytes para a mesma data de emissão.
import { createTRPCClient } from "@trpc/client";
import { linksDoCliente } from "@/lib/trpc-links";
import type { AppRouter } from "../../../../../../server/routers";

const api = createTRPCClient<AppRouter>({ links: linksDoCliente() });
const rota = api.incorporacao.propostaTerreno;

export type PdfProposta = Awaited<ReturnType<typeof rota.pdf.mutate>>;
export type EnvioProposta = Awaited<ReturnType<typeof rota.envios.query>>[number];

export function pdfDaProposta(estudoId: string, propostaId: string, dataEmissao?: string) {
  return rota.pdf.mutate({ studyId: Number(estudoId), propostaId, dataEmissao });
}

/** `pdfSha256` = hash do PDF da prévia; o servidor recusa o envio se o PDF de agora for outro. */
export function enviarProposta(estudoId: string, propostaId: string, destinatario: string, dataEmissao: string, pdfSha256: string) {
  return rota.enviar.mutate({ studyId: Number(estudoId), propostaId, destinatario, dataEmissao, pdfSha256 });
}

/** Mesmo texto de `ERRO_PROPOSTA_MUDOU` (servidor): a prévia ficou velha e o botão passa a gerar outra. */
export const AVISO_PROPOSTA_MUDOU = "A proposta mudou desde a prévia; gere a prévia de novo.";

export function enviosDasPropostas(estudoId: string) {
  return rota.envios.query({ studyId: Number(estudoId) });
}

export function blobDoPdf(pdf: PdfProposta): Blob {
  return new Blob([Uint8Array.from(atob(pdf.base64), (c) => c.charCodeAt(0))], { type: "application/pdf" });
}

export function baixarPdf(pdf: PdfProposta) {
  const url = URL.createObjectURL(blobDoPdf(pdf));
  const a = document.createElement("a");
  a.href = url; a.download = pdf.nomeArquivo; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Mesma regra do servidor (zod `email()`), só para avisar na tela antes de enviar. */
export const emailValido = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
