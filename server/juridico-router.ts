import { TRPCError } from "@trpc/server";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { imoveis, leads, portalChatMessages, portalContractDocuments, portalContracts } from "../drizzle/schema.js";
import { ASSINATURA_STATUS, CONTRATO_STATUS, contratoInputSchema } from "../shared/juridico.js";
import { adminProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";
import { storagePut } from "./storage.js";

const documentType = z.enum(["contrato_gerado", "assinado", "anexo"]);

export function isValidContractPdf(buffer: Buffer): boolean {
  return buffer.length > 0 && buffer.length <= 10 * 1024 * 1024 && buffer.subarray(0, 4).toString() === "%PDF";
}

export const juridicoRouter = router({
  list: adminProcedure.input(z.object({ status: z.enum(CONTRATO_STATUS).optional() }).optional()).query(async ({ input }) => {
    const rows = await getDb().select({ contract: portalContracts, leadName: leads.name, propertyTitle: imoveis.titulo })
      .from(portalContracts)
      .leftJoin(leads, eq(portalContracts.leadId, leads.id))
      .leftJoin(imoveis, eq(portalContracts.propertyId, imoveis.id))
      .orderBy(desc(portalContracts.createdAt));
    return input?.status ? rows.filter(({ contract }) => contract.status === input.status) : rows;
  }),

  getById: adminProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ input }) => {
    const db = getDb();
    const [contract] = await db.select().from(portalContracts).where(eq(portalContracts.id, input.id)).limit(1);
    if (!contract) return null;
    const documents = await db.select().from(portalContractDocuments)
      .where(eq(portalContractDocuments.contractId, input.id)).orderBy(desc(portalContractDocuments.createdAt));
    return { contract, documents };
  }),

  options: adminProcedure.query(async () => {
    const db = getDb();
    const [leadOptions, propertyOptions] = await Promise.all([
      db.select({ id: leads.id, name: leads.name, email: leads.email }).from(leads).orderBy(leads.name),
      db.select({ id: imoveis.id, title: imoveis.titulo, city: imoveis.cidade }).from(imoveis).orderBy(imoveis.titulo),
    ]);
    return { leads: leadOptions, properties: propertyOptions };
  }),

  create: adminProcedure.input(contratoInputSchema).mutation(async ({ input }) => {
    const [created] = await getDb().insert(portalContracts).values({
      ...input,
      number: input.number || `PRO-${Date.now()}`,
      partyADocument: input.partyADocument || null,
      partyBDocument: input.partyBDocument || null,
      description: input.description || "",
      clauses: input.clauses || "",
      value: input.value.toFixed(2),
    }).returning();
    return created;
  }),

  update: adminProcedure.input(z.object({ id: z.number().int().positive(), data: contratoInputSchema }))
    .mutation(async ({ input }) => {
      const [updated] = await getDb().update(portalContracts).set({
        ...input.data,
        number: input.data.number || undefined,
        partyADocument: input.data.partyADocument || null,
        partyBDocument: input.data.partyBDocument || null,
        description: input.data.description || "",
        clauses: input.data.clauses || "",
        value: input.data.value.toFixed(2),
        updatedAt: new Date(),
      }).where(eq(portalContracts.id, input.id)).returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado" });
      return updated;
    }),

  setStatus: adminProcedure.input(z.object({
    id: z.number().int().positive(),
    status: z.enum(CONTRATO_STATUS).optional(),
    signatureStatus: z.enum(ASSINATURA_STATUS).optional(),
  })).mutation(async ({ input }) => {
    const [updated] = await getDb().update(portalContracts).set({
      status: input.status,
      signatureStatus: input.signatureStatus,
      updatedAt: new Date(),
    }).where(eq(portalContracts.id, input.id)).returning();
    if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado" });
    return updated;
  }),

  addDocument: adminProcedure.input(z.object({
    contractId: z.number().int().positive(),
    name: z.string().trim().min(1).max(255),
    url: z.string().url(),
    type: documentType.default("anexo"),
  })).mutation(async ({ input }) => {
    const [document] = await getDb().insert(portalContractDocuments).values(input).returning();
    return document;
  }),

  uploadDocument: adminProcedure.input(z.object({
    contractId: z.number().int().positive(),
    name: z.string().trim().min(1).max(255),
    type: documentType.default("anexo"),
    base64: z.string().min(8),
  })).mutation(async ({ input }) => {
    const db = getDb();
    const [contract] = await db.select().from(portalContracts).where(eq(portalContracts.id, input.contractId)).limit(1);
    if (!contract) throw new TRPCError({ code: "NOT_FOUND", message: "Contrato não encontrado" });
    const buffer = Buffer.from(input.base64, "base64");
    if (!isValidContractPdf(buffer)) throw new TRPCError({ code: "BAD_REQUEST", message: "Envie um PDF válido de até 10 MiB" });
    const safeNumber = contract.number.replace(/[^a-zA-Z0-9_-]/g, "-");
    const { url } = await storagePut(`juridico/${safeNumber}-${Date.now()}.pdf`, buffer, "application/pdf");
    const [document] = await db.insert(portalContractDocuments).values({ contractId: input.contractId, name: input.name, type: input.type, url }).returning();
    if (input.type === "assinado") {
      await db.update(portalContracts).set({ signatureStatus: "assinado", signedDocumentUrl: url, updatedAt: new Date() })
        .where(eq(portalContracts.id, input.contractId));
    }
    return document;
  }),

  deleteDocument: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    await getDb().delete(portalContractDocuments).where(eq(portalContractDocuments.id, input.id));
    return { success: true } as const;
  }),

  delete: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    await getDb().delete(portalContracts).where(eq(portalContracts.id, input.id));
    return { success: true } as const;
  }),

  chats: adminProcedure.query(async () => getDb().select({ message: portalChatMessages, leadName: leads.name })
    .from(portalChatMessages).innerJoin(leads, eq(portalChatMessages.leadId, leads.id))
    .orderBy(asc(portalChatMessages.createdAt)).limit(500)),

  sendMessage: adminProcedure.input(z.object({ leadId: z.number().int().positive(), text: z.string().trim().min(1).max(2000) }))
    .mutation(async ({ input }) => {
      const [message] = await getDb().insert(portalChatMessages).values({ leadId: input.leadId, sender: "corretor", text: input.text }).returning();
      return message;
    }),

  markChatRead: adminProcedure.input(z.object({ leadId: z.number().int().positive() })).mutation(async ({ input }) => {
    await getDb().update(portalChatMessages).set({ read: true }).where(eq(portalChatMessages.leadId, input.leadId));
    return { success: true } as const;
  }),
});
