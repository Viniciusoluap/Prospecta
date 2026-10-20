import { notifyClientDocumentRequest } from "./document-request-notifications.js";
import { ROTULO_DOCUMENTO } from "../shared/drive-estrutura.js";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { leadActivities, leadDocuments, leads, leadServices, type User } from "../drizzle/schema.js";
import { protectedProcedure, router } from "./_core/trpc.js";
import { podeUsarModulo, requireModule, requireRole } from "./_core/rbac.js";
import { getDb } from "./db.js";
import { documentHash, driveConfigured, readPrivateDocument, tryDriveUpload, uploadPrivateDocument } from "./drive-documents.js";
import { readPrivateDbFile } from "./private-document-files.js";
import { requireClientContext } from "./profile-context.js";
import { isValidPortalDocument } from "./portal-router.js";

const category = z.enum(["rg", "cnh", "address_proof", "income_proof_formal", "income_proof_irpf", "fgts", "spouse_docs", "spouse_income_proof", "birth_marriage_certificate", "pis", "other"]);
const mime = z.enum(["application/pdf", "image/jpeg", "image/png"]);

export function authorizedLead(user: Pick<User, "id" | "role" | "active" | "leadId" | "permissions">, requested?: number): number {
  if (!user.active) throw new TRPCError({ code: "FORBIDDEN" });
  // Admin e colaborador com o CRM liberado escolhem o cliente; o cliente, só ele mesmo.
  if (podeUsarModulo(user, "crm")) {
    if (!requested) throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione o cliente" });
    return requested;
  }
  const client = requireClientContext(user);
  if (requested && requested !== client.leadId) throw new TRPCError({ code: "FORBIDDEN" });
  return client.leadId;
}

export const leadDocumentsRouter = router({
  // O banco guarda o arquivo quando o Drive não está disponível: o envio sempre funciona.
  available: protectedProcedure.query(async () => ({ configured: true, drive: await driveConfigured() })),
  /** Teste real do Google Drive (só admin): mostra em que etapa e por que falha. */
  diagnoseDrive: protectedProcedure.mutation(async ({ ctx }) => {
    requireRole(ctx, ["admin"]);
    const { diagnosticarDriveComFotos } = await import("./imovel-fotos.js");
    return diagnosticarDriveComFotos();
  }),
  visibility: protectedProcedure
    .input(z.object({ leadId: z.number().int().positive().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const leadId = authorizedLead(ctx.user, input?.leadId);
      const result = await getDb().execute(sql`SELECT type, visible_to_client AS "visibleToClient" FROM lead_document_preferences WHERE lead_id = ${leadId}`);
      return (result as unknown as { rows: { type: string; visibleToClient: boolean }[] }).rows;
    }),
  setVisibility: protectedProcedure
    .input(z.object({ leadId: z.number().int().positive(), type: category, visibleToClient: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      requireModule(ctx, "crm");
      const leadId = authorizedLead(ctx.user, input.leadId);
      await getDb().execute(sql`INSERT INTO lead_document_preferences (lead_id, type, visible_to_client) VALUES (${leadId}, ${input.type}, ${input.visibleToClient}) ON CONFLICT (lead_id, type) DO UPDATE SET visible_to_client = EXCLUDED.visible_to_client`);
      return { success: true };
    }),
  request: protectedProcedure
    .input(z.object({ leadId: z.number().int().positive(), serviceId: z.number().int().positive().optional(), type: category }))
    .mutation(async ({ ctx, input }) => {
      requireModule(ctx, "crm");
      const db = getDb();
      const [lead] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, input.leadId)).limit(1);
      if (!lead) throw new TRPCError({ code: "NOT_FOUND" });
      if (input.serviceId) {
        const [service] = await db.select({ id: leadServices.id }).from(leadServices).where(and(eq(leadServices.id, input.serviceId), eq(leadServices.leadId, input.leadId))).limit(1);
        if (!service) throw new TRPCError({ code: "BAD_REQUEST", message: "Serviço não pertence ao cliente" });
      }
      const visibility = await db.execute(sql`SELECT visible_to_client FROM lead_document_preferences WHERE lead_id = ${input.leadId} AND type = ${input.type}`);
      if ((visibility as unknown as { rows: { visible_to_client: boolean }[] }).rows[0]?.visible_to_client === false) throw new TRPCError({ code: "BAD_REQUEST", message: "Deixe o item visível ao cliente antes de solicitar" });
      const [existing] = await db.select({ id: leadDocuments.id }).from(leadDocuments).where(and(eq(leadDocuments.leadId, input.leadId), input.serviceId ? eq(leadDocuments.serviceId, input.serviceId) : isNull(leadDocuments.serviceId), eq(leadDocuments.type, input.type), eq(leadDocuments.status, "pending"), isNull(leadDocuments.deletedAt))).limit(1);
      const saved = existing ?? (await db.insert(leadDocuments).values({ leadId: input.leadId, serviceId: input.serviceId, type: input.type, status: "pending" }).returning({ id: leadDocuments.id }))[0];
      if (!existing) await db.insert(leadActivities).values({ leadId: input.leadId, type: "document", description: `Documento ${ROTULO_DOCUMENTO[input.type] ?? input.type} solicitado`, performedBy: `user:${ctx.user.id}` });
      const notice = await notifyClientDocumentRequest(input.leadId, ROTULO_DOCUMENTO[input.type] ?? input.type);
      return { id: saved.id, ...notice };
    }),
  list: protectedProcedure
    .input(z.object({ leadId: z.number().int().positive().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const leadId = authorizedLead(ctx.user, input?.leadId);
      const rows = await getDb().select().from(leadDocuments).where(and(eq(leadDocuments.leadId, leadId), isNull(leadDocuments.deletedAt))).orderBy(desc(leadDocuments.createdAt));
      const prefs = await getDb().execute(sql`SELECT type FROM lead_document_preferences WHERE lead_id = ${leadId} AND visible_to_client = false`);
      const hidden = new Set((prefs as unknown as { rows: { type: string }[] }).rows.map(row => row.type));
      const visibleRows = podeUsarModulo(ctx.user, "crm") ? rows : rows.filter(row => !hidden.has(row.type));
      // Never hand a legacy arbitrary URL or Drive file ID to a browser.
      return visibleRows.map(({ driveFileId, fileUrl, sha256, ...row }) => ({ ...row, canOpen: Boolean(driveFileId) || row.storage === "banco" }));
    }),
  upload: protectedProcedure
    .input(z.object({ leadId: z.number().int().positive().optional(), serviceId: z.number().int().positive().optional(), type: category, fileName: z.string().min(1).max(255), mimeType: mime, base64: z.string().min(8).max(4_200_000) }))
    .mutation(async ({ ctx, input }) => {
      const leadId = authorizedLead(ctx.user, input.leadId);
      if (!podeUsarModulo(ctx.user, "crm")) {
        const prefs = await getDb().execute(sql`SELECT visible_to_client FROM lead_document_preferences WHERE lead_id = ${leadId} AND type = ${input.type}`);
        if ((prefs as unknown as { rows: { visible_to_client: boolean }[] }).rows[0]?.visible_to_client === false) throw new TRPCError({ code: "FORBIDDEN" });
      }
      const data = Buffer.from(input.base64, "base64");
      if (data.length > 3 * 1024 * 1024 || !isValidPortalDocument(data, input.mimeType)) throw new TRPCError({ code: "BAD_REQUEST", message: "Envie PDF, JPG ou PNG válido de até 3 MiB" });
      const db = getDb();
      const [lead] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).limit(1);
      if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
      if (input.serviceId) {
        const [service] = await db.select({ id: leadServices.id }).from(leadServices).where(and(eq(leadServices.id, input.serviceId), eq(leadServices.leadId, leadId))).limit(1);
        if (!service) throw new TRPCError({ code: "BAD_REQUEST", message: "Serviço não pertence ao cliente" });
      }
      const sha256 = documentHash(data);
      const existing = await db.select({ id: leadDocuments.id }).from(leadDocuments).where(and(eq(leadDocuments.leadId, leadId), input.serviceId ? eq(leadDocuments.serviceId, input.serviceId) : isNull(leadDocuments.serviceId), eq(leadDocuments.type, input.type), eq(leadDocuments.sha256, sha256), isNotNull(leadDocuments.driveFileId), isNull(leadDocuments.deletedAt))).limit(1);
      if (existing.length) {
        await db.update(leadDocuments).set({ status: "received", reviewedAt: new Date() }).where(and(
          eq(leadDocuments.leadId, leadId),
          input.serviceId ? eq(leadDocuments.serviceId, input.serviceId) : isNull(leadDocuments.serviceId),
          eq(leadDocuments.type, input.type), eq(leadDocuments.status, "pending"), isNull(leadDocuments.driveFileId), isNull(leadDocuments.deletedAt),
        ));
        return { id: existing[0].id, duplicate: true };
      }
      const safeName = input.fileName.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 255);
      const { driveFileId, note } = await tryDriveUpload(() => uploadPrivateDocument({ leadId, serviceId: input.serviceId ?? null, categoria: input.type, rotulo: ROTULO_DOCUMENTO[input.type] ?? "Documento", nomeOriginal: safeName, mimeType: input.mimeType, data }));
      if (!driveFileId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Google Drive indisponível. Arquivo não marcado como enviado. ${note ?? "Tente novamente."}` });
      const [saved] = await db.insert(leadDocuments).values({
        leadId, serviceId: input.serviceId, type: input.type, fileName: safeName, mimeType: input.mimeType,
        fileSize: data.length, sha256, driveFileId, uploadedByUserId: ctx.user.id,
        status: "received", uploadedAt: new Date(),
      }).returning({ id: leadDocuments.id });
      const savedId = saved.id;
      await db.update(leadDocuments).set({ status: "received", reviewedAt: new Date() }).where(and(
        eq(leadDocuments.leadId, leadId),
        input.serviceId ? eq(leadDocuments.serviceId, input.serviceId) : isNull(leadDocuments.serviceId),
        eq(leadDocuments.type, input.type), eq(leadDocuments.status, "pending"), isNull(leadDocuments.driveFileId), isNull(leadDocuments.deletedAt),
      ));
      await db.insert(leadActivities).values({ leadId, type: "document", description: `Documento ${input.type} recebido`, performedBy: `user:${ctx.user.id}` });
      return { id: savedId, duplicate: false, storage: driveFileId ? "drive" : "banco", storageNote: note };
    }),
  content: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [doc] = await db.select().from(leadDocuments).where(and(eq(leadDocuments.id, input.id), isNull(leadDocuments.deletedAt))).limit(1);
      if (!doc || (!doc.driveFileId && doc.storage !== "banco") || !doc.mimeType) throw new TRPCError({ code: "NOT_FOUND" });
      authorizedLead(ctx.user, doc.leadId);
      if (!podeUsarModulo(ctx.user, "crm")) {
        const prefs = await db.execute(sql`SELECT visible_to_client FROM lead_document_preferences WHERE lead_id = ${doc.leadId} AND type = ${doc.type}`);
        if ((prefs as unknown as { rows: { visible_to_client: boolean }[] }).rows[0]?.visible_to_client === false) throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (doc.fileSize && doc.fileSize > 3 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "Arquivo excede o limite de consulta" });
      try {
        const data = doc.driveFileId ? await readPrivateDocument(doc.driveFileId) : await readPrivateDbFile("lead", doc.id);
        if (!data) throw new Error("Arquivo não encontrado no banco");
        if (data.length > 3 * 1024 * 1024) throw new Error("Arquivo excede o limite de consulta");
        return { fileName: doc.fileName, mimeType: doc.mimeType, base64: data.toString("base64") };
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível consultar o documento" });
      }
    }),
  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      requireModule(ctx, "crm");
      const db = getDb();
      const [doc] = await db.select({ id: leadDocuments.id, leadId: leadDocuments.leadId, type: leadDocuments.type }).from(leadDocuments).where(and(eq(leadDocuments.id, input.id), isNull(leadDocuments.deletedAt))).limit(1);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      await db.update(leadDocuments).set({ deletedAt: new Date(), deletedByUserId: ctx.user.id }).where(eq(leadDocuments.id, doc.id));
      await db.insert(leadActivities).values({ leadId: doc.leadId, type: "document", description: `Documento ${doc.type} removido da consulta`, performedBy: `user:${ctx.user.id}` });
      return { success: true };
    }),
});
