// EPIC-024 S-08 — arquivo do terreno (KML ou KMZ) enviado em partes de 1 MiB por `documentChunks.part`,
// porque a Vercel recusa corpo acima de ~4,5 MB. O texto KML direto (`kmlContent`) continua aceito.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { clearUpload, readUpload } from "./document-upload-chunks.js";
import { lerArquivoTerreno, type ArquivoTerrenoLido } from "./_core/geo/kmz.js";

export const escopoArquivoTerreno = (estudoId: number) => `incorporacao-terreno:${estudoId}`;

export const entradaArquivoTerreno = {
  kmlContent: z.string().min(1).optional(),
  uploadId: z.string().regex(/^[a-zA-Z0-9-]{20,64}$/).optional(),
  fileName: z.string().min(1).max(255).optional(),
};

type Entrada = { id: number; kmlContent?: string; uploadId?: string; fileName?: string };
type Leitor = (uploadId: string, userId: number, scope: string, fileName: string) => Promise<Uint8Array>;

/** Devolve o KML do envio; lança BAD_REQUEST com mensagem clara. Não grava nada. */
export async function kmlDoEnvio(input: Entrada, userId: number, ler: Leitor = readUpload): Promise<ArquivoTerrenoLido> {
  if (input.kmlContent) return { kml: input.kmlContent, formato: "kml", kmlInterno: null, kmlsNoKmz: 0 };
  if (!input.uploadId || !input.fileName) throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione um arquivo KML ou KMZ." });
  const bytes = await ler(input.uploadId, userId, escopoArquivoTerreno(input.id), input.fileName);
  try {
    return lerArquivoTerreno(bytes, input.fileName);
  } catch (e) {
    throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Arquivo do terreno inválido." });
  } finally {
    if (ler === readUpload) await clearUpload(input.uploadId, userId).catch(() => undefined);
  }
}

/** Aviso para a tela quando o KMZ tinha mais de um KML. */
export function avisoDoKmz(lido: ArquivoTerrenoLido): string | null {
  if (lido.formato !== "kmz" || lido.kmlsNoKmz <= 1) return null;
  return `O KMZ tinha ${lido.kmlsNoKmz} arquivos KML; foi usado "${lido.kmlInterno}".`;
}
