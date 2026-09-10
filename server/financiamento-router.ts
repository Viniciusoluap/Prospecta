import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { financiamentoChecklistItems, financiamentos } from "../drizzle/schema.js";
import {
  FINANCIAMENTO_CHECKLIST_PADRAO,
  FINANCIAMENTO_STATUS,
  financiamentoInputSchema,
} from "../shared/financiamento.js";
import { getDb } from "./db.js";
import { adminProcedure, router } from "./_core/trpc.js";

export const financiamentoRouter = router({
  list: adminProcedure
    .input(z.object({ status: z.enum(FINANCIAMENTO_STATUS).optional() }).optional())
    .query(async ({ input }) => {
      const database = getDb();
      const where = input?.status ? eq(financiamentos.status, input.status) : undefined;
      return database
        .select({
          financiamento: financiamentos,
          checklistTotal: sql<number>`count(${financiamentoChecklistItems.id})::int`,
          checklistConcluido: sql<number>`count(${financiamentoChecklistItems.id}) filter (where ${financiamentoChecklistItems.concluido} = true)::int`,
        })
        .from(financiamentos)
        .leftJoin(financiamentoChecklistItems, eq(financiamentoChecklistItems.financiamentoId, financiamentos.id))
        .where(where)
        .groupBy(financiamentos.id)
        .orderBy(desc(financiamentos.updatedAt));
    }),

  getById: adminProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ input }) => {
    const database = getDb();
    const [financiamento] = await database.select().from(financiamentos).where(eq(financiamentos.id, input.id)).limit(1);
    if (!financiamento) return null;
    const checklist = await database
      .select()
      .from(financiamentoChecklistItems)
      .where(eq(financiamentoChecklistItems.financiamentoId, input.id))
      .orderBy(asc(financiamentoChecklistItems.grupo), asc(financiamentoChecklistItems.id));
    return { financiamento, checklist };
  }),

  create: adminProcedure.input(financiamentoInputSchema).mutation(async ({ input }) => {
    const database = getDb();
    const [financiamento] = await database.insert(financiamentos).values({
      ...input,
      clienteEmail: input.clienteEmail || null,
      valorImovel: input.valorImovel.toFixed(2),
      valorFinanciado: input.valorFinanciado.toFixed(2),
      entrada: input.entrada.toFixed(2),
      taxa: input.taxa.toFixed(4),
      parcela: input.parcela == null ? null : input.parcela.toFixed(2),
    }).returning();
    await database.insert(financiamentoChecklistItems).values(
      FINANCIAMENTO_CHECKLIST_PADRAO.map((item) => ({ financiamentoId: financiamento.id, ...item }))
    );
    return financiamento;
  }),

  update: adminProcedure
    .input(z.object({ id: z.number().int().positive(), data: financiamentoInputSchema.partial() }))
    .mutation(async ({ input }) => {
      const data = input.data;
      const [updated] = await getDb().update(financiamentos).set({
        ...data,
        clienteEmail: data.clienteEmail || null,
        valorImovel: data.valorImovel == null ? undefined : data.valorImovel.toFixed(2),
        valorFinanciado: data.valorFinanciado == null ? undefined : data.valorFinanciado.toFixed(2),
        entrada: data.entrada == null ? undefined : data.entrada.toFixed(2),
        taxa: data.taxa == null ? undefined : data.taxa.toFixed(4),
        parcela: data.parcela === undefined ? undefined : data.parcela == null ? null : data.parcela.toFixed(2),
        updatedAt: new Date(),
      }).where(eq(financiamentos.id, input.id)).returning();
      return updated;
    }),

  updateStatus: adminProcedure
    .input(z.object({ id: z.number().int().positive(), status: z.enum(FINANCIAMENTO_STATUS) }))
    .mutation(async ({ input }) => {
      const [updated] = await getDb().update(financiamentos).set({ status: input.status, updatedAt: new Date() })
        .where(eq(financiamentos.id, input.id)).returning();
      return updated;
    }),

  updateChecklist: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      financiamentoId: z.number().int().positive(),
      concluido: z.boolean(),
      notas: z.string().max(1000).optional(),
    }))
    .mutation(async ({ input }) => {
      const [updated] = await getDb().update(financiamentoChecklistItems).set({
        concluido: input.concluido,
        concluidoEm: input.concluido ? new Date() : null,
        notas: input.notas,
      }).where(and(
        eq(financiamentoChecklistItems.id, input.id),
        eq(financiamentoChecklistItems.financiamentoId, input.financiamentoId),
      )).returning();
      return updated;
    }),

  delete: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    await getDb().delete(financiamentos).where(eq(financiamentos.id, input.id));
    return { success: true } as const;
  }),
});
