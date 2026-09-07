import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  regularizacaoDocuments,
  regularizacoes,
} from "../drizzle/schema";
import { adminProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { storagePut } from "./storage";

const statusSchema = z.enum([
  "analysis",
  "documentation",
  "protocol",
  "registry",
  "completed",
  "cancelled",
]);

const regularizacaoFields = z.object({
  clientName: z.string().trim().min(2).max(255),
  clientPhone: z.string().trim().max(30).nullable().optional(),
  type: z.string().trim().min(2).max(120),
  status: statusSchema.optional(),
  address: z.string().trim().min(3),
  registration: z.string().trim().max(120).nullable().optional(),
  registryOffice: z.string().trim().max(255).nullable().optional(),
  responsible: z.string().trim().min(2).max(120),
  leadId: z.number().int().positive().nullable().optional(),
  serviceValue: z.number().min(0).optional(),
  paidValue: z.number().min(0).optional(),
  expectedEndAt: z.date().nullable().optional(),
  description: z.string().optional(),
  notes: z.string().nullable().optional(),
});

const documentStatusSchema = z.enum([
  "pending",
  "requested",
  "received",
  "approved",
  "rejected",
]);

async function assertRegularizacaoExists(id: number) {
  const [record] = await getDb()
    .select({ id: regularizacoes.id })
    .from(regularizacoes)
    .where(eq(regularizacoes.id, id))
    .limit(1);

  if (!record) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Regularização não encontrada" });
  }
}

export const regularizacaoRouter = router({
  list: adminProcedure
    .input(z.object({ status: statusSchema.optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const records = await db
        .select()
        .from(regularizacoes)
        .where(input?.status ? eq(regularizacoes.status, input.status) : undefined)
        .orderBy(desc(regularizacoes.updatedAt));
      const documents = await db.select().from(regularizacaoDocuments);

      return records.map(record => ({
        ...record,
        documents: documents.filter(document => document.regularizacaoId === record.id),
      }));
    }),

  get: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [record] = await getDb()
        .select()
        .from(regularizacoes)
        .where(eq(regularizacoes.id, input.id))
        .limit(1);
      if (!record) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Regularização não encontrada" });
      }
      const documents = await getDb()
        .select()
        .from(regularizacaoDocuments)
        .where(eq(regularizacaoDocuments.regularizacaoId, input.id))
        .orderBy(desc(regularizacaoDocuments.updatedAt));
      return { ...record, documents };
    }),

  create: adminProcedure
    .input(regularizacaoFields)
    .mutation(async ({ input }) => {
      const [created] = await getDb()
        .insert(regularizacoes)
        .values({
          ...input,
          serviceValue: input.serviceValue?.toString(),
          paidValue: input.paidValue?.toString(),
        })
        .returning();
      return created;
    }),

  update: adminProcedure
    .input(regularizacaoFields.partial().extend({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const { id, serviceValue, paidValue, ...fields } = input;
      const [updated] = await getDb()
        .update(regularizacoes)
        .set({
          ...fields,
          ...(serviceValue !== undefined ? { serviceValue: serviceValue.toString() } : {}),
          ...(paidValue !== undefined ? { paidValue: paidValue.toString() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(regularizacoes.id, id))
        .returning();
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Regularização não encontrada" });
      }
      return updated;
    }),

  remove: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await assertRegularizacaoExists(input.id);
      await getDb().delete(regularizacaoDocuments).where(eq(regularizacaoDocuments.regularizacaoId, input.id));
      await getDb().delete(regularizacoes).where(eq(regularizacoes.id, input.id));
      return { success: true };
    }),

  documents: router({
    create: adminProcedure
      .input(z.object({
        regularizacaoId: z.number().int().positive(),
        name: z.string().trim().min(2).max(255),
        status: documentStatusSchema.optional(),
        observation: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await assertRegularizacaoExists(input.regularizacaoId);
        const [created] = await getDb().insert(regularizacaoDocuments).values(input).returning();
        return created;
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        status: documentStatusSchema.optional(),
        observation: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...fields } = input;
        const [updated] = await getDb()
          .update(regularizacaoDocuments)
          .set({ ...fields, updatedAt: new Date() })
          .where(eq(regularizacaoDocuments.id, id))
          .returning();
        if (!updated) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
        }
        return updated;
      }),

    upload: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        fileName: z.string().trim().min(1).max(255),
        mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
        base64: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const [document] = await getDb()
          .select()
          .from(regularizacaoDocuments)
          .where(eq(regularizacaoDocuments.id, input.id))
          .limit(1);
        if (!document) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
        }

        const buffer = Buffer.from(input.base64, "base64");
        if (buffer.length > 10 * 1024 * 1024) {
          throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "O arquivo deve ter no máximo 10 MB" });
        }
        const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
        const { url } = await storagePut(
          `regularizacoes/${document.regularizacaoId}/${Date.now()}-${safeName}`,
          buffer,
          input.mimeType,
        );
        const [updated] = await getDb()
          .update(regularizacaoDocuments)
          .set({ fileUrl: url, status: "received", updatedAt: new Date() })
          .where(and(
            eq(regularizacaoDocuments.id, input.id),
            eq(regularizacaoDocuments.regularizacaoId, document.regularizacaoId),
          ))
          .returning();
        return updated;
      }),

    remove: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const deleted = await getDb()
          .delete(regularizacaoDocuments)
          .where(eq(regularizacaoDocuments.id, input.id))
          .returning({ id: regularizacaoDocuments.id });
        if (!deleted.length) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
        }
        return { success: true };
      }),
  }),
});
