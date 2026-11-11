import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { incorporationRegistrationDocuments, incorporationStudies } from "../drizzle/schema.js";
import { DOCUMENTOS_PADRAO_REGISTRO, type DocumentoRegistro } from "../shared/incorporacao/registro-incorporacao.js";
import { lerDueDiligence } from "../shared/incorporacao/due-diligence.js";
import { protectedProcedure, router } from "./_core/trpc.js";
import { requireModule } from "./_core/rbac.js";
import { getDb, getIncorporationStudyById } from "./db.js";
import { documentHash, driveConfigured, readPrivateDocument, readPrivateDocumentRange, tryDriveUpload, uploadPrivateIncorporationDocument } from "./drive-documents.js";
import { LIMITE_ANEXO_BYTES, MIME_GENERICO, PARTE_ANEXO_BYTES, mimeAnexoValido, nomeAnexoSeguro, partesDoAnexo } from "../shared/incorporacao/anexos.js";
import { readPrivateDbFile } from "./private-document-files.js";
import { isValidPortalDocument } from "./portal-router.js";

/** Levantamento topográfico do estudo (Topografia 3D) — mesmo armazenamento privado dos documentos. */
export { ITEM_LEVANTAMENTO } from "./drive-pastas.js";
import { ITEM_LEVANTAMENTO } from "./drive-pastas.js";
const EXTENSOES_LEVANTAMENTO = [".csv", ".txt", ".xyz", ".dxf"];
const mimeLevantamento = z.enum(["text/csv", "text/plain", "application/dxf"]);
/** Levantamento: arquivo de texto (pontos CSV/TXT/XYZ ou DXF ASCII) com extensão aceita pelo Santa Fé. */
export function levantamentoValido(fileName: string, data: Buffer) {
  const nome = fileName.toLowerCase();
  return EXTENSOES_LEVANTAMENTO.some((ext) => nome.endsWith(ext)) && data.length > 0 && !data.includes(0);
}
const itemInput = z.object({ studyId: z.number().int().positive(), itemId: z.string().min(1).max(120) });
const mime = z.enum(["application/pdf", "image/jpeg", "image/png"]);
/** Qualquer tipo de arquivo (foto, DWG, Word...): só o formato do MIME é conferido. */
const mimeQualquer = z.string().min(3).max(120).refine(mimeAnexoValido, "Tipo de arquivo inválido");

/** Quem diz ser PDF/JPG/PNG precisa ter a assinatura; se não tiver, fica como arquivo genérico (nunca é aberto como tal). */
export function mimeConferido(mimeType: string, data: Buffer) {
  const tipo = mime.safeParse(mimeType);
  return tipo.success && !isValidPortalDocument(data, tipo.data) ? MIME_GENERICO : mimeType;
}

/** Grava o arquivo (Drive; recusando, banco) e o evento. `partes`: bytes já estão na área temporária. */
async function gravarDocumento(ctx: { user: { id: number } }, input: { studyId: number; itemId: string; fileName: string; mimeType: string },
  data: Buffer, uploadId?: string) {
  const levantamento = input.itemId === ITEM_LEVANTAMENTO;
  const hash = documentHash(data);
  const previous = await latestEvent(input.studyId, input.itemId);
  if (previous?.action === "uploaded" && previous.sha256 === hash)
    return { id: previous.id, duplicate: true, storage: previous.storage, storageNote: null };
  const safeName = nomeAnexoSeguro(input.fileName);
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
  // Envio em partes: os bytes são juntados no próprio banco (não voltam numa consulta gigante).
  const bytes = uploadId
    ? sql`(SELECT string_agg(p.data, ''::bytea ORDER BY p.part) FROM incorporation_upload_parts p WHERE p.upload_id = ${uploadId})`
    : sql`decode(${data.toString("base64")}, 'base64')`;
  const result = await getDb().execute(sql`WITH ev AS (
      INSERT INTO incorporation_registration_documents (study_id, item_id, action, file_name, mime_type, file_size, sha256, performed_by_user_id, storage, storage_note)
      VALUES (${input.studyId}, ${input.itemId}, 'uploaded', ${safeName}, ${input.mimeType}, ${data.length}, ${hash}, ${ctx.user.id}, 'banco', ${note})
      RETURNING id)
    INSERT INTO incorporation_registration_file_data (document_id, mime, size_bytes, data)
    SELECT id, ${input.mimeType}, ${data.length}, ${bytes} FROM ev
    RETURNING document_id AS id`);
  const id = Number((result as unknown as { rows: { id: number }[] }).rows[0].id);
  if (levantamento) await marcarLevantamento(input.studyId, true);
  return { id, duplicate: false, storage: "banco", storageNote: note };
}

const uploadIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

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
  available: protectedProcedure.query(async ({ ctx }) => {
    requireModule(ctx, "incorporacao");
    // Sem Drive (ou com o Drive recusando), o arquivo fica no banco: o envio sempre funciona.
    return { configured: true, drive: await driveConfigured() };
  }),
  list: protectedProcedure.input(z.object({ studyId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    if (!await getIncorporationStudyById(input.studyId)) throw new TRPCError({ code: "NOT_FOUND" });
    const events = await getDb().select().from(incorporationRegistrationDocuments)
      .where(eq(incorporationRegistrationDocuments.studyId, input.studyId));
    return currentRegistrationDocuments(events);
  }),
  upload: protectedProcedure.input(itemInput.extend({
    fileName: z.string().min(1).max(255), mimeType: mimeQualquer, base64: z.string().min(4).max(4_200_000),
  })).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    await requireRegistrationItem(input.studyId, input.itemId);
    const data = Buffer.from(input.base64, "base64");
    let mimeType = input.mimeType;
    if (input.itemId === ITEM_LEVANTAMENTO) {
      if (data.length > 3 * 1024 * 1024 || !mimeLevantamento.safeParse(input.mimeType).success || !levantamentoValido(input.fileName, data))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Envie o levantamento em CSV, TXT, XYZ ou DXF de até 3 MiB" });
    } else {
      if (data.length === 0 || data.length > 3 * 1024 * 1024)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Arquivo vazio ou acima de 3 MiB" });
      mimeType = mimeConferido(input.mimeType, data);
    }
    return gravarDocumento(ctx, { ...input, mimeType }, data);
  }),
  /** Envio em partes (qualquer tipo, até 50 MB): cada parte fica na área temporária até `uploadFinish`. */
  uploadPart: protectedProcedure.input(itemInput.extend({
    uploadId: uploadIdSchema, part: z.number().int().min(0).max(partesDoAnexo(LIMITE_ANEXO_BYTES) - 1), base64: z.string().min(4).max(2_900_000),
  })).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    if (input.itemId === ITEM_LEVANTAMENTO) throw new TRPCError({ code: "BAD_REQUEST", message: "Use o envio do levantamento" });
    await requireRegistrationItem(input.studyId, input.itemId);
    const data = Buffer.from(input.base64, "base64");
    if (data.length === 0 || data.length > PARTE_ANEXO_BYTES) throw new TRPCError({ code: "BAD_REQUEST", message: "Parte do arquivo inválida" });
    const db = getDb();
    // envios abandonados há mais de um dia são descartados
    await db.execute(sql`DELETE FROM incorporation_upload_parts WHERE created_at < now() - interval '1 day'`);
    const r = await db.execute(sql`INSERT INTO incorporation_upload_parts (upload_id, part, study_id, item_id, user_id, data)
      VALUES (${input.uploadId}, ${input.part}::int, ${input.studyId}::int, ${input.itemId}, ${ctx.user.id}::int, decode(${input.base64}, 'base64'))
      ON CONFLICT (upload_id, part) DO UPDATE SET data = EXCLUDED.data, created_at = now()
      WHERE incorporation_upload_parts.user_id = EXCLUDED.user_id AND incorporation_upload_parts.study_id = EXCLUDED.study_id AND incorporation_upload_parts.item_id = EXCLUDED.item_id
      RETURNING part`);
    if (!(r as unknown as { rows: unknown[] }).rows.length) throw new TRPCError({ code: "FORBIDDEN" });
    return { ok: true };
  }),
  uploadFinish: protectedProcedure.input(itemInput.extend({
    uploadId: uploadIdSchema, fileName: z.string().min(1).max(255), mimeType: mimeQualquer,
    size: z.number().int().positive().max(LIMITE_ANEXO_BYTES),
  })).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    if (input.itemId === ITEM_LEVANTAMENTO) throw new TRPCError({ code: "BAD_REQUEST", message: "Use o envio do levantamento" });
    await requireRegistrationItem(input.studyId, input.itemId);
    const db = getDb();
    const total = partesDoAnexo(input.size);
    const partes: Buffer[] = [];
    try {
      for (let part = 0; part < total; part++) {
        const r = await db.execute(sql`SELECT encode(data, 'base64') AS b64 FROM incorporation_upload_parts
          WHERE upload_id = ${input.uploadId} AND part = ${part} AND user_id = ${ctx.user.id} AND study_id = ${input.studyId} AND item_id = ${input.itemId}`);
        const row = (r as unknown as { rows: { b64: string }[] }).rows[0];
        if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: "Envio incompleto: tente novamente" });
        partes.push(Buffer.from(row.b64, "base64"));
      }
      const extras = await db.execute(sql`SELECT count(*)::int AS n FROM incorporation_upload_parts WHERE upload_id = ${input.uploadId}`);
      const data = Buffer.concat(partes);
      if (data.length !== input.size || Number((extras as unknown as { rows: { n: number }[] }).rows[0].n) !== total)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Envio incompleto: tente novamente" });
      return await gravarDocumento(ctx, { ...input, mimeType: mimeConferido(input.mimeType, data) }, data, input.uploadId);
    } finally {
      await db.execute(sql`DELETE FROM incorporation_upload_parts WHERE upload_id = ${input.uploadId} AND user_id = ${ctx.user.id}`);
    }
  }),
  /** Leitura em partes de 2 MiB (a resposta da Vercel também é limitada). */
  contentPart: protectedProcedure.input(itemInput.extend({ part: z.number().int().min(0).max(partesDoAnexo(LIMITE_ANEXO_BYTES) - 1) })).query(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    await requireRegistrationItem(input.studyId, input.itemId);
    const current = await latestEvent(input.studyId, input.itemId);
    if (!current || current.action !== "uploaded" || (!current.driveFileId && current.storage !== "banco") || !current.mimeType || !current.fileSize)
      throw new TRPCError({ code: "NOT_FOUND" });
    const parts = partesDoAnexo(current.fileSize);
    if (input.part >= parts) throw new TRPCError({ code: "BAD_REQUEST" });
    const inicio = input.part * PARTE_ANEXO_BYTES;
    const fim = Math.min(current.fileSize, inicio + PARTE_ANEXO_BYTES);
    try {
      let data: Buffer | null = null;
      if (current.storage === "banco") {
        const r = await getDb().execute(sql`SELECT encode(substring(data from ${inicio + 1}::int for ${fim - inicio}::int), 'base64') AS b64
          FROM incorporation_registration_file_data WHERE document_id = ${current.id}`);
        const row = (r as unknown as { rows: { b64: string }[] }).rows[0];
        data = row ? Buffer.from(row.b64, "base64") : null;
      }
      if (!data && current.driveFileId) data = await readPrivateDocumentRange(current.driveFileId, inicio, fim);
      if (!data || data.length !== fim - inicio) throw new Error("Arquivo não encontrado");
      return { fileName: current.fileName, mimeType: current.mimeType, size: current.fileSize, parts, base64: data.toString("base64") };
    } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível consultar o documento" });
    }
  }),
  content: protectedProcedure.input(itemInput).query(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    await requireRegistrationItem(input.studyId, input.itemId);
    const current = await latestEvent(input.studyId, input.itemId);
    if (!current || current.action !== "uploaded" || (!current.driveFileId && current.storage !== "banco") || !current.mimeType)
      throw new TRPCError({ code: "NOT_FOUND" });
    if (current.fileSize && current.fileSize > 3 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST" });
    try {
      // Guardado no banco (fallback) continua sendo lido do banco, mesmo depois da cópia no Drive (29/10).
      const data = current.storage === "banco"
        ? (await readPrivateDbFile("incorporacao", current.id)) ?? (current.driveFileId ? await readPrivateDocument(current.driveFileId) : null)
        : await readPrivateDocument(current.driveFileId!);
      if (!data) throw new Error("Arquivo não encontrado no banco");
      if (data.length > 3 * 1024 * 1024) throw new Error("Arquivo excede o limite");
      return { fileName: current.fileName, mimeType: current.mimeType, base64: data.toString("base64") };
    } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível consultar o documento" });
    }
  }),
  unlink: protectedProcedure.input(itemInput).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
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
