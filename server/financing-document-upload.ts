import { eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { financiamentoChecklistItems } from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { uploadPrivateDocument } from "./drive-documents.js";

export const FINANCING_DOCUMENT_MIMES = ["application/pdf", "image/jpeg", "image/png", "application/vnd.ms-excel"] as const;
export function validFinancingDocument(bytes: Buffer, mime: string) {
  if (!bytes.length || bytes.length > 3 * 1024 * 1024) return false;
  if (mime === "application/pdf") return bytes.subarray(0, 4).toString() === "%PDF";
  if (mime === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "application/vnd.ms-excel") return bytes.subarray(0,8).equals(Buffer.from([208,207,17,224,161,177,26,225]));
  return false;
}
export async function saveFinancingDocument(input: { itemId: number; financingId: number; leadId: number; label: string; fileName: string; mimeType: string; base64: string }) {
  const data = Buffer.from(input.base64, "base64");
  if (!validFinancingDocument(data, input.mimeType)) throw new TRPCError({ code: "BAD_REQUEST", message: "Envie PDF, JPG, PNG ou XLS válido de até 3 MiB" });
  const safeName = input.fileName.replace(/[\\/\x00-\x1f]/g, "_").slice(0,255);
  let driveFileId: string;
  try {
    driveFileId = await uploadPrivateDocument({ leadId: input.leadId, serviceId: null, categoria: `financiamento_checklist:${input.financingId}:${input.itemId}`, rotulo: input.label, nomeOriginal: safeName, mimeType: input.mimeType, data });
  } catch {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Google Drive indisponível. O documento não foi marcado como enviado; tente novamente." });
  }
  const db = getDb();
  await db.batch([
    db.update(financiamentoChecklistItems).set({ documentoDriveFileId: driveFileId, documentoUrl: null, documentoNome: safeName, documentoMime: input.mimeType, enviadoEm: new Date(), concluido: true, concluidoEm: new Date(), solicitarDocumento: false }).where(eq(financiamentoChecklistItems.id, input.itemId)),
    db.execute(sql`DELETE FROM financiamento_checklist_file_data WHERE checklist_item_id = ${input.itemId}`),
  ]);
  return { storage: "drive" as const };
}
