import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, ne } from "drizzle-orm";
import { z } from "zod";
import {
  imoveis,
  constructionProjects,
  leadActivities,
  leads,
  portalChatMessages,
  portalContractDocuments,
  portalContracts,
  portalVisits,
  users,
} from "../drizzle/schema.js";
import { hashPassword } from "./_core/auth-utils.js";
import { requireRole, STAFF_ROLES } from "./_core/rbac.js";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";
import { storagePut } from "./storage.js";

const visitStatus = z.enum(["agendada", "realizada", "cancelada", "reagendada"]);
const signatureStatus = z.enum(["pendente", "solicitado", "assinado", "rejeitado"]);
const documentType = z.enum(["contrato_gerado", "assinado", "anexo"]);

export function clientLeadId(ctx: { user: { role: string; leadId: number | null } }): number {
  requireRole(ctx, ["cliente"]);
  if (!ctx.user.leadId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Perfil não vinculado a um cliente" });
  }
  return ctx.user.leadId;
}

export function isValidSignedPdf(buffer: Buffer): boolean {
  return buffer.length > 0 && buffer.length <= 10 * 1024 * 1024 && buffer.subarray(0, 4).toString() === "%PDF";
}

export function assertProvisionable(existing: { role: string; leadId: number | null } | undefined, leadId: number): void {
  if (existing && (existing.role !== "cliente" || (existing.leadId && existing.leadId !== leadId))) {
    throw new TRPCError({ code: "CONFLICT", message: "E-mail já pertence a outra conta" });
  }
}

export const portalRouter = router({
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    const leadId = clientLeadId(ctx);
    const db = getDb();
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente não encontrado" });
    const [lastActivity] = await db.select().from(leadActivities)
      .where(and(eq(leadActivities.leadId, leadId), ne(leadActivities.type, "note")))
      .orderBy(desc(leadActivities.createdAt)).limit(1);
    const [project] = await db.select().from(constructionProjects)
      .where(eq(constructionProjects.userId, ctx.user.id)).orderBy(desc(constructionProjects.updatedAt)).limit(1);
    return { lead, project: project ?? null, lastActivity: lastActivity ?? null };
  }),

  activities: protectedProcedure.query(async ({ ctx }) => {
    const leadId = clientLeadId(ctx);
    return getDb().select().from(leadActivities)
      .where(and(eq(leadActivities.leadId, leadId), ne(leadActivities.type, "note")))
      .orderBy(desc(leadActivities.createdAt));
  }),

  visits: protectedProcedure.query(async ({ ctx }) => {
    const leadId = clientLeadId(ctx);
    return getDb().select({ visit: portalVisits, property: imoveis })
      .from(portalVisits).leftJoin(imoveis, eq(portalVisits.propertyId, imoveis.id))
      .where(eq(portalVisits.leadId, leadId)).orderBy(desc(portalVisits.scheduledAt));
  }),

  contracts: protectedProcedure.query(async ({ ctx }) => {
    const leadId = clientLeadId(ctx);
    const db = getDb();
    const contracts = await db.select().from(portalContracts)
      .where(eq(portalContracts.leadId, leadId)).orderBy(desc(portalContracts.createdAt));
    const documents = contracts.length
      ? await db.select().from(portalContractDocuments).orderBy(desc(portalContractDocuments.createdAt))
      : [];
    return contracts.map(contract => ({
      ...contract,
      documents: documents.filter(document => document.contractId === contract.id),
    }));
  }),

  uploadSignedContract: protectedProcedure.input(z.object({
    contractId: z.number().int().positive(),
    fileName: z.string().min(1).max(255),
    mimeType: z.literal("application/pdf"),
    base64: z.string().min(8),
  })).mutation(async ({ ctx, input }) => {
    const leadId = clientLeadId(ctx);
    const db = getDb();
    const [contract] = await db.select().from(portalContracts)
      .where(and(eq(portalContracts.id, input.contractId), eq(portalContracts.leadId, leadId))).limit(1);
    if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado" });
    const buffer = Buffer.from(input.base64, "base64");
    if (!isValidSignedPdf(buffer)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Envie um PDF válido de até 10 MiB" });
    }
    const safeNumber = contract.number.replace(/[^a-zA-Z0-9_-]/g, "-");
    const { url } = await storagePut(`portal/contratos/${safeNumber}-${Date.now()}.pdf`, buffer, input.mimeType);
    await db.insert(portalContractDocuments).values({ contractId: contract.id, name: input.fileName, url, type: "assinado" });
    await db.update(portalContracts).set({ signatureStatus: "assinado", signedDocumentUrl: url, updatedAt: new Date() })
      .where(eq(portalContracts.id, contract.id));
    return { url };
  }),

  messages: protectedProcedure.input(z.object({ after: z.date().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const leadId = clientLeadId(ctx);
      const where = input?.after
        ? and(eq(portalChatMessages.leadId, leadId), gt(portalChatMessages.createdAt, input.after))
        : eq(portalChatMessages.leadId, leadId);
      return getDb().select().from(portalChatMessages).where(where).orderBy(asc(portalChatMessages.createdAt)).limit(100);
    }),

  sendMessage: protectedProcedure.input(z.object({ text: z.string().trim().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const leadId = clientLeadId(ctx);
      const [message] = await getDb().insert(portalChatMessages)
        .values({ leadId, sender: "cliente", text: input.text }).returning();
      return message;
    }),

  admin: router({
    overview: adminProcedure.input(z.object({ leadId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      requireRole(ctx, STAFF_ROLES);
      const db = getDb();
      const [account] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.leadId, input.leadId)).limit(1);
      const visits = await db.select().from(portalVisits).where(eq(portalVisits.leadId, input.leadId)).orderBy(desc(portalVisits.scheduledAt));
      const contracts = await db.select().from(portalContracts).where(eq(portalContracts.leadId, input.leadId)).orderBy(desc(portalContracts.createdAt));
      const messages = await db.select().from(portalChatMessages).where(eq(portalChatMessages.leadId, input.leadId)).orderBy(asc(portalChatMessages.createdAt)).limit(100);
      return { account: account ?? null, visits, contracts, messages };
    }),

    provisionAccess: adminProcedure.input(z.object({
      leadId: z.number().int().positive(), email: z.string().email(), password: z.string().min(8).max(128),
    })).mutation(async ({ ctx, input }) => {
      requireRole(ctx, STAFF_ROLES);
      const db = getDb();
      const email = input.email.toLowerCase().trim();
      const [lead] = await db.select().from(leads).where(eq(leads.id, input.leadId)).limit(1);
      if (!lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado" });
      const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      assertProvisionable(existing, input.leadId);
      const passwordHash = hashPassword(input.password);
      if (existing) {
        await db.update(users).set({ leadId: input.leadId, passwordHash, name: lead.name, updatedAt: new Date() }).where(eq(users.id, existing.id));
        return { id: existing.id, email };
      }
      const [created] = await db.insert(users).values({ openId: `portal:${email}`, email, name: lead.name, role: "cliente", leadId: input.leadId, passwordHash, loginMethod: "password" }).returning({ id: users.id });
      return { id: created.id, email };
    }),

    createVisit: adminProcedure.input(z.object({
      leadId: z.number().int().positive(), propertyId: z.number().int().positive().nullable().optional(), scheduledAt: z.date(),
      status: visitStatus.default("agendada"), responsibleName: z.string().max(255).optional(), notes: z.string().max(2000).optional(),
    })).mutation(async ({ ctx, input }) => {
      requireRole(ctx, STAFF_ROLES);
      const [visit] = await getDb().insert(portalVisits).values(input).returning();
      return visit;
    }),

    createContract: adminProcedure.input(z.object({
      leadId: z.number().int().positive(), number: z.string().trim().min(1).max(80), type: z.string().trim().min(1).max(80), description: z.string().max(4000).optional(),
    })).mutation(async ({ ctx, input }) => {
      requireRole(ctx, STAFF_ROLES);
      const [contract] = await getDb().insert(portalContracts).values(input).returning();
      return contract;
    }),

    addDocument: adminProcedure.input(z.object({
      contractId: z.number().int().positive(), name: z.string().trim().min(1).max(255), url: z.string().url(), type: documentType.default("anexo"),
    })).mutation(async ({ ctx, input }) => {
      requireRole(ctx, STAFF_ROLES);
      const [document] = await getDb().insert(portalContractDocuments).values(input).returning();
      return document;
    }),

    setSignatureStatus: adminProcedure.input(z.object({ contractId: z.number().int().positive(), status: signatureStatus }))
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx, STAFF_ROLES);
        await getDb().update(portalContracts).set({ signatureStatus: input.status, updatedAt: new Date() }).where(eq(portalContracts.id, input.contractId));
        return { success: true };
      }),

    sendMessage: adminProcedure.input(z.object({ leadId: z.number().int().positive(), text: z.string().trim().min(1).max(2000) }))
      .mutation(async ({ ctx, input }) => {
        requireRole(ctx, STAFF_ROLES);
        const [message] = await getDb().insert(portalChatMessages).values({ leadId: input.leadId, sender: "corretor", text: input.text }).returning();
        return message;
      }),
  }),
});
