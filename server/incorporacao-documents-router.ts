import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { incorporationRegistrationDocuments } from "../drizzle/schema.js";
import { DOCUMENTOS_PADRAO_REGISTRO, type DocumentoRegistro } from "../shared/incorporacao/registro-incorporacao.js";
import { protectedProcedure, router } from "./_core/trpc.js";
import { requireRole } from "./_core/rbac.js";
import { getDb, getIncorporationStudyById } from "./db.js";
import { documentHash, driveConfigured, readPrivateDocument, uploadPrivateIncorporationDocument } from "./drive-documents.js";
import { isValidPortalDocument } from "./portal-router.js";

const itemInput = z.object({ studyId: z.number().int().positive(), itemId: z.string().min(1).max(120) });
const mime = z.enum(["application/pdf", "image/jpeg", "image/png"]);

/** O ID deve pertencer ao checklist deste estudo, nunca apenas vir do cliente. */
export async function requireRegistrationItem(studyId: number, itemId: string) {
  const study = await getIncorporationStudyById(studyId);
  if (!study) throw new TRPCError({ code: "NOT_FOUND", message: "Estudo não encontrado" });
  let documents: DocumentoRegistro[] = DOCUMENTOS_PADRAO_REGISTRO.map((nome, i) => ({ id: `padrao-${i}`, nome, status: "pendente" }));
  if (study.incorporationRegistrationJson) {
    try {
      const parsed = JSON.parse(study.incorporationRegistrationJson) as { documentos?: DocumentoRegistro[] };
      if (Array.isArray(parsed.documentos) && parsed.documentos.length) documents = parsed.documentos;
    } catch { /* checklist antigo ilegível: manter os itens padrão */ }
  }
  if (!documents.some(doc => doc.id === itemId)) throw new TRPCError({ code: "NOT_FOUND", message: "Item do checklist não encontrado" });
}

type DocumentEvent = typeof incorporationRegistrationDocuments.$inferSelect;

/** O último evento define a referência atual; todos os anteriores permanecem no histórico. */
export function currentRegistrationDocuments(events: DocumentEvent[]) {
  const latest = new Map<string, DocumentEvent>();
  for (const event of events) if (!latest.has(event.itemId) || event.id > latest.get(event.itemId)!.id) latest.set(event.itemId, event);
  return Array.from(latest.values()).filter(event => event.action === "uploaded" && event.driveFileId).map(event => ({
    id: event.id, itemId: event.itemId, fileName: event.fileName, mimeType: event.mimeType,
    fileSize: event.fileSize, uploadedAt: event.createdAt, uploadedByUserId: event.performedByUserId,
  }));
}

async function latestEvent(studyId: number, itemId: string) {
  const [event] = await getDb().select().from(incorporationRegistrationDocuments)
    .where(and(eq(incorporationRegistrationDocuments.studyId, studyId), eq(incorporationRegistrationDocuments.itemId, itemId)))
    .orderBy(desc(incorporationRegistrationDocuments.id)).limit(1);
  return event;
}

export const incorporacaoDocumentsRouter = router({
  available: protectedProcedure.query(({ ctx }) => {
    requireRole(ctx, ["admin"]);
    return { configured: driveConfigured() };
  }),
  list: protectedProcedure.input(z.object({ studyId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    requireRole(ctx, ["admin"]);
    if (!await getIncorporationStudyById(input.studyId)) throw new TRPCError({ code: "NOT_FOUND" });
    const events = await getDb().select().from(incorporationRegistrationDocuments)
      .where(eq(incorporationRegistrationDocuments.studyId, input.studyId));
    return currentRegistrationDocuments(events);
  }),
  upload: protectedProcedure.input(itemInput.extend({
    fileName: z.string().min(1).max(255), mimeType: mime, base64: z.string().min(8).max(4_200_000),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx, ["admin"]);
    await requireRegistrationItem(input.studyId, input.itemId);
    if (!driveConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Google Drive não configurado" });
    const data = Buffer.from(input.base64, "base64");
    if (data.length > 3 * 1024 * 1024 || !isValidPortalDocument(data, input.mimeType))
      throw new TRPCError({ code: "BAD_REQUEST", message: "Envie PDF, JPG ou PNG válido de até 3 MiB" });
    const hash = documentHash(data);
    const previous = await latestEvent(input.studyId, input.itemId);
    if (previous?.action === "uploaded" && previous.sha256 === hash)
      return { id: previous.id, duplicate: true };
    const safeName = input.fileName.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 255);
    let driveFileId: string;
    try {
      driveFileId = await uploadPrivateIncorporationDocument(input.studyId, input.itemId, safeName, input.mimeType, data);
    } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível armazenar o documento no Google Drive" });
    }
    const [saved] = await getDb().insert(incorporationRegistrationDocuments).values({
      studyId: input.studyId, itemId: input.itemId, action: "uploaded", driveFileId,
      fileName: safeName, mimeType: input.mimeType, fileSize: data.length, sha256: hash,
      performedByUserId: ctx.user.id,
    }).returning({ id: incorporationRegistrationDocuments.id });
    return { id: saved.id, duplicate: false };
  }),
  content: protectedProcedure.input(itemInput).query(async ({ ctx, input }) => {
    requireRole(ctx, ["admin"]);
    await requireRegistrationItem(input.studyId, input.itemId);
    const current = await latestEvent(input.studyId, input.itemId);
    if (!current || current.action !== "uploaded" || !current.driveFileId || !current.mimeType)
      throw new TRPCError({ code: "NOT_FOUND" });
    if (current.fileSize && current.fileSize > 3 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST" });
    try {
      const data = await readPrivateDocument(current.driveFileId);
      if (data.length > 3 * 1024 * 1024) throw new Error("Arquivo excede o limite");
      return { fileName: current.fileName, mimeType: current.mimeType, base64: data.toString("base64") };
    } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível consultar o documento" });
    }
  }),
  unlink: protectedProcedure.input(itemInput).mutation(async ({ ctx, input }) => {
    requireRole(ctx, ["admin"]);
    await requireRegistrationItem(input.studyId, input.itemId);
    const current = await latestEvent(input.studyId, input.itemId);
    if (!current || current.action !== "uploaded") throw new TRPCError({ code: "NOT_FOUND" });
    await getDb().insert(incorporationRegistrationDocuments).values({
      studyId: input.studyId, itemId: input.itemId, action: "unlinked", performedByUserId: ctx.user.id,
    });
    return { success: true };
  }),
});
