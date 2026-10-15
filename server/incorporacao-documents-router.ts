import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { incorporationRegistrationDocuments, incorporationStudies } from "../drizzle/schema.js";
import { DOCUMENTOS_PADRAO_REGISTRO, type DocumentoRegistro } from "../shared/incorporacao/registro-incorporacao.js";
import { lerDueDiligence } from "../shared/incorporacao/due-diligence.js";
import { protectedProcedure, router } from "./_core/trpc.js";
import { requireRole } from "./_core/rbac.js";
import { getDb, getIncorporationStudyById } from "./db.js";
import { documentHash, driveConfigured, readPrivateDocument, tryDriveUpload, uploadPrivateIncorporationDocument } from "./drive-documents.js";
import { readPrivateDbFile } from "./private-document-files.js";
import { isValidPortalDocument } from "./portal-router.js";

/** Levantamento topográfico do estudo (Topografia 3D) — mesmo armazenamento privado dos documentos. */
export const ITEM_LEVANTAMENTO = "levantamento_topografico";
const EXTENSOES_LEVANTAMENTO = [".csv", ".txt", ".xyz", ".dxf"];
const mimeLevantamento = z.enum(["text/csv", "text/plain", "application/dxf"]);
/** Levantamento: arquivo de texto (pontos CSV/TXT/XYZ ou DXF ASCII) com extensão aceita pelo Santa Fé. */
export function levantamentoValido(fileName: string, data: Buffer) {
  const nome = fileName.toLowerCase();
  return EXTENSOES_LEVANTAMENTO.some((ext) => nome.endsWith(ext)) && data.length > 0 && !data.includes(0);
}
const itemInput = z.object({ studyId: z.number().int().positive(), itemId: z.string().min(1).max(120) });
const mime = z.enum(["application/pdf", "image/jpeg", "image/png"]);

/** O ID deve pertencer ao checklist deste estudo, nunca apenas vir do cliente. */
export async function requireRegistrationItem(studyId: number, itemId: string) {
  const study = await getIncorporationStudyById(studyId);
  if (!study) throw new TRPCError({ code: "NOT_FOUND", message: "Estudo não encontrado" });
  if (itemId === ITEM_LEVANTAMENTO) return;
  if (itemId.startsWith("dd_")) {
    const [, stageId, documentId, extra] = itemId.split("_");
    if (extra || !stageId || !documentId ||
      !lerDueDiligence(study.dueDiligenceJson).etapas.some((stage) =>
        stage.id === stageId && stage.documentos.some((document) => document.id === documentId)))
      throw new TRPCError({ code: "NOT_FOUND", message: "Documento da Due Diligence não encontrado" });
    return;
  }
  let documents: DocumentoRegistro[] = DOCUMENTOS_PADRAO_REGISTRO.map((nome, i) => ({ id: `padrao-${i}`, nome, status: "pendente" }));
  if (study.incorporationRegistrationJson) {
    try {
      const parsed = JSON.parse(study.incorporationRegistrationJson) as { documentos?: DocumentoRegistro[] };
      if (Array.isArray(parsed.documentos) && parsed.documentos.length) documents = parsed.documentos;
    } catch { /* checklist antigo ilegível: manter os itens padrão */ }
  }
  if (!documents.some(doc => doc.id === itemId)) throw new TRPCError({ code: "NOT_FOUND", message: "Item do checklist não encontrado" });
}

/** `surveyUrl` aponta para o documento privado (não há URL pública): a tela abre pelo `content`. */
async function marcarLevantamento(studyId: number, enviado: boolean) {
  await getDb().update(incorporationStudies)
    .set({ surveyUrl: enviado ? `documento:${ITEM_LEVANTAMENTO}` : null, updatedAt: new Date() })
    .where(eq(incorporationStudies.id, studyId));
}

type DocumentEvent = typeof incorporationRegistrationDocuments.$inferSelect;

/** O último evento define a referência atual; todos os anteriores permanecem no histórico. */
export function currentRegistrationDocuments(events: DocumentEvent[]) {
  const latest = new Map<string, DocumentEvent>();
  for (const event of events) if (!latest.has(event.itemId) || event.id > latest.get(event.itemId)!.id) latest.set(event.itemId, event);
  return Array.from(latest.values()).filter(event => event.action === "uploaded" && (event.driveFileId || event.storage === "banco")).map(event => ({
    id: event.id, itemId: event.itemId, fileName: event.fileName, mimeType: event.mimeType,
    fileSize: event.fileSize, uploadedAt: event.createdAt, uploadedByUserId: event.performedByUserId,
    storage: event.storage, storageNote: event.storageNote,
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
    // Sem Drive (ou com o Drive recusando), o arquivo fica no banco: o envio sempre funciona.
    return { configured: true, drive: driveConfigured() };
  }),
  list: protectedProcedure.input(z.object({ studyId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    requireRole(ctx, ["admin"]);
    if (!await getIncorporationStudyById(input.studyId)) throw new TRPCError({ code: "NOT_FOUND" });
    const events = await getDb().select().from(incorporationRegistrationDocuments)
      .where(eq(incorporationRegistrationDocuments.studyId, input.studyId));
    return currentRegistrationDocuments(events);
  }),
  upload: protectedProcedure.input(itemInput.extend({
    fileName: z.string().min(1).max(255), mimeType: z.union([mime, mimeLevantamento]), base64: z.string().min(8).max(4_200_000),
  })).mutation(async ({ ctx, input }) => {
    requireRole(ctx, ["admin"]);
    await requireRegistrationItem(input.studyId, input.itemId);
    const data = Buffer.from(input.base64, "base64");
    const levantamento = input.itemId === ITEM_LEVANTAMENTO;
    if (levantamento) {
      if (data.length > 3 * 1024 * 1024 || !mimeLevantamento.safeParse(input.mimeType).success || !levantamentoValido(input.fileName, data))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Envie o levantamento em CSV, TXT, XYZ ou DXF de até 3 MiB" });
    } else {
      const tipo = mime.safeParse(input.mimeType);
      if (!tipo.success || data.length > 3 * 1024 * 1024 || !isValidPortalDocument(data, tipo.data))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Envie PDF, JPG ou PNG válido de até 3 MiB" });
    }
    const hash = documentHash(data);
    const previous = await latestEvent(input.studyId, input.itemId);
    if (previous?.action === "uploaded" && previous.sha256 === hash)
      return { id: previous.id, duplicate: true };
    const safeName = input.fileName.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 255);
    const { driveFileId, note } = await tryDriveUpload(() => uploadPrivateIncorporationDocument(input.studyId, input.itemId, safeName, input.mimeType, data));
    if (driveFileId) {
      const [saved] = await getDb().insert(incorporationRegistrationDocuments).values({
        studyId: input.studyId, itemId: input.itemId, action: "uploaded", driveFileId,
        fileName: safeName, mimeType: input.mimeType, fileSize: data.length, sha256: hash,
        performedByUserId: ctx.user.id,
      }).returning({ id: incorporationRegistrationDocuments.id });
      if (levantamento) await marcarLevantamento(input.studyId, true);
      return { id: saved.id, duplicate: false, storage: "drive", storageNote: null };
    }
    // Evento e bytes na mesma instrução: nunca fica referência sem arquivo.
    const result = await getDb().execute(sql`WITH ev AS (
        INSERT INTO incorporation_registration_documents (study_id, item_id, action, file_name, mime_type, file_size, sha256, performed_by_user_id, storage, storage_note)
        VALUES (${input.studyId}, ${input.itemId}, 'uploaded', ${safeName}, ${input.mimeType}, ${data.length}, ${hash}, ${ctx.user.id}, 'banco', ${note})
        RETURNING id)
      INSERT INTO incorporation_registration_file_data (document_id, mime, size_bytes, data)
      SELECT id, ${input.mimeType}, ${data.length}, decode(${data.toString("base64")}, 'base64') FROM ev
      RETURNING document_id AS id`);
    const id = Number((result as unknown as { rows: { id: number }[] }).rows[0].id);
    if (levantamento) await marcarLevantamento(input.studyId, true);
    return { id, duplicate: false, storage: "banco", storageNote: note };
  }),
  content: protectedProcedure.input(itemInput).query(async ({ ctx, input }) => {
    requireRole(ctx, ["admin"]);
    await requireRegistrationItem(input.studyId, input.itemId);
    const current = await latestEvent(input.studyId, input.itemId);
    if (!current || current.action !== "uploaded" || (!current.driveFileId && current.storage !== "banco") || !current.mimeType)
      throw new TRPCError({ code: "NOT_FOUND" });
    if (current.fileSize && current.fileSize > 3 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST" });
    try {
      const data = current.driveFileId ? await readPrivateDocument(current.driveFileId) : await readPrivateDbFile("incorporacao", current.id);
      if (!data) throw new Error("Arquivo não encontrado no banco");
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
    if (input.itemId === ITEM_LEVANTAMENTO) await marcarLevantamento(input.studyId, false);
    return { success: true };
  }),
});
