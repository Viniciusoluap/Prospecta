import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  financiamentoChecklistItems,
  financiamentos,
  imoveis,
  leads,
  users,
} from "../drizzle/schema.js";
import {
  FINANCIAMENTO_CHECKLIST_PADRAO,
  FINANCIAMENTO_STATUS,
  financiamentoFromLeadSchema,
  financiamentoUpdateSchema,
} from "../shared/financiamento.js";
import { leadContact } from "../shared/lead-snapshot.js";
import { getDb } from "./db.js";
import { adminProcedure, router } from "./_core/trpc.js";
import { linkRecordToLead } from "./lead-services-router.js";
import { readPrivateDocument } from "./drive-documents.js";
import { readPrivateDbFile } from "./private-document-files.js";
import { TRPCError } from "@trpc/server";
import { excluirDefinitivo } from "./exclusao-definitiva.js";

async function clientFieldsFromLead(leadId: number) {
  const [lead] = await getDb().select().from(leads).where(eq(leads.id, leadId)).limit(1);
  if (!lead) return null;
  const contact = leadContact(lead);
  return {
    clienteNome: contact.name,
    clienteCpf: contact.cpf,
    clienteTel: contact.phone,
    clienteEmail: contact.email,
  };
}

export const financiamentoRouter = router({
  options: adminProcedure.query(async () => {
    const database = getDb();
    const [leadOptions, propertyOptions, brokerOptions] = await Promise.all([
      database
        .select({
          id: leads.id,
          name: leads.name,
          email: leads.email,
          phone: leads.phone,
          cpf: leads.cpf,
        })
        .from(leads)
        .where(isNull(leads.deletedAt))
        .orderBy(leads.name),
      database
        .select({ id: imoveis.id, title: imoveis.titulo, city: imoveis.cidade })
        .from(imoveis)
        .orderBy(imoveis.titulo),
      database
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.role, "corretor"))
        .orderBy(users.name),
    ]);
    return {
      leads: leadOptions,
      properties: propertyOptions,
      brokers: brokerOptions,
    };
  }),

  list: adminProcedure
    .input(
      z.object({ status: z.enum(FINANCIAMENTO_STATUS).optional() }).optional()
    )
    .query(async ({ input }) => {
      const database = getDb();
      const where = input?.status
        ? eq(financiamentos.status, input.status)
        : undefined;
      return database
        .select({
          financiamento: financiamentos,
          checklistTotal: sql<number>`count(${financiamentoChecklistItems.id})::int`,
          checklistConcluido: sql<number>`count(${financiamentoChecklistItems.id}) filter (where ${financiamentoChecklistItems.concluido} = true)::int`,
        })
        .from(financiamentos)
        .leftJoin(
          financiamentoChecklistItems,
          eq(financiamentoChecklistItems.financiamentoId, financiamentos.id)
        )
        .where(where)
        .groupBy(financiamentos.id)
        .orderBy(desc(financiamentos.updatedAt));
    }),

  getById: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const database = getDb();
      const [financiamento] = await database
        .select()
        .from(financiamentos)
        .where(eq(financiamentos.id, input.id))
        .limit(1);
      if (!financiamento) return null;
      const checklist = await database
        .select()
        .from(financiamentoChecklistItems)
        .where(eq(financiamentoChecklistItems.financiamentoId, input.id))
        .orderBy(
          asc(financiamentoChecklistItems.grupo),
          asc(financiamentoChecklistItems.id)
        );
      return { financiamento, checklist };
    }),

  /**
   * Criação avulsa foi removida da UI (EPIC Lote 3 — Financiamentos originados
   * no CRM). Este endpoint segue existindo apenas como salvaguarda server-side:
   * todo financiamento tem que nascer amarrado a um lead real do CRM — o
   * registro inicial é criado automaticamente ao vincular o serviço no lead
   * (ver `ensureFinanciamentoRecord` em lead-services-router.ts).
   */
  create: adminProcedure
    .input(financiamentoFromLeadSchema)
    .mutation(async ({ input }) => {
      const database = getDb();
      const client = await clientFieldsFromLead(input.leadId);
      if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado no CRM" });
      const [financiamento] = await database
        .insert(financiamentos)
        .values({
          ...input,
          ...client,
          valorImovel: input.valorImovel.toFixed(2),
          valorFinanciado: input.valorFinanciado.toFixed(2),
          entrada: input.entrada.toFixed(2),
          taxa: input.taxa.toFixed(4),
          parcela: input.parcela == null ? null : input.parcela.toFixed(2),
        })
        .returning();
      await database
        .insert(financiamentoChecklistItems)
        .values(
          FINANCIAMENTO_CHECKLIST_PADRAO.map(item => ({
            financiamentoId: financiamento.id,
            ...item,
          }))
        );
      await linkRecordToLead("financiamentos", financiamento.leadId, financiamento.id);
      return financiamento;
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        data: financiamentoUpdateSchema,
      })
    )
    .mutation(async ({ input }) => {
      const data = input.data;
      // Com lead vinculado, o cliente segue o cadastro do CRM (fonte única).
      const [current] = await getDb()
        .select({ leadId: financiamentos.leadId })
        .from(financiamentos)
        .where(eq(financiamentos.id, input.id))
        .limit(1);
      const leadId = data.leadId ?? current?.leadId ?? null;
      const client = leadId ? await clientFieldsFromLead(leadId) : null;
      const [updated] = await getDb()
        .update(financiamentos)
        .set({
          ...data,
          clienteEmail: data.clienteEmail || null,
          ...(client ?? {}),
          valorImovel:
            data.valorImovel == null ? undefined : data.valorImovel.toFixed(2),
          valorFinanciado:
            data.valorFinanciado == null
              ? undefined
              : data.valorFinanciado.toFixed(2),
          entrada: data.entrada == null ? undefined : data.entrada.toFixed(2),
          taxa: data.taxa == null ? undefined : data.taxa.toFixed(4),
          parcela:
            data.parcela === undefined
              ? undefined
              : data.parcela == null
                ? null
                : data.parcela.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(financiamentos.id, input.id))
        .returning();
      return updated;
    }),

  updateStatus: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(FINANCIAMENTO_STATUS),
      })
    )
    .mutation(async ({ input }) => {
      const [updated] = await getDb()
        .update(financiamentos)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(financiamentos.id, input.id))
        .returning();
      return updated;
    }),

  /**
   * Pedido 14/10/2026: valor total (imóvel) e valor financiado editados direto
   * na lista. Só mexe no financiamento — a etapa do lead no CRM é outra coisa.
   */
  atualizarValores: adminProcedure
    .input(
      z
        .object({
          id: z.number().int().positive(),
          valorImovel: z.number().nonnegative().max(1e12),
          valorFinanciado: z.number().nonnegative().max(1e12),
        })
        .refine((v) => v.valorFinanciado <= v.valorImovel, {
          message: "O valor financiado não pode superar o valor total",
          path: ["valorFinanciado"],
        })
    )
    .mutation(async ({ input }) => {
      const [updated] = await getDb()
        .update(financiamentos)
        .set({
          valorImovel: input.valorImovel.toFixed(2),
          valorFinanciado: input.valorFinanciado.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(financiamentos.id, input.id))
        .returning({ id: financiamentos.id });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Financiamento não encontrado" });
      return updated;
    }),

  updateChecklist: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        financiamentoId: z.number().int().positive(),
        concluido: z.boolean(),
        notas: z.string().max(1000).optional(),
        visivelCliente: z.boolean().optional(),
        solicitarDocumento: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const [updated] = await getDb()
        .update(financiamentoChecklistItems)
        .set({
          concluido: input.concluido,
          concluidoEm: input.concluido ? new Date() : null,
          notas: input.notas,
          visivelCliente: input.visivelCliente,
          solicitarDocumento: input.solicitarDocumento,
        })
        .where(
          and(
            eq(financiamentoChecklistItems.id, input.id),
            eq(
              financiamentoChecklistItems.financiamentoId,
              input.financiamentoId
            )
          )
        )
        .returning();
      return updated;
    }),

  /** Item 03: exclusão definitiva (remove checklist e o serviço do CRM ligado). */
  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await excluirDefinitivo("financiamento", input.id, ctx.user);
      return { success: true } as const;
    }),

  checklistDocumentContent: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [item] = await getDb().select().from(financiamentoChecklistItems).where(eq(financiamentoChecklistItems.id, input.id)).limit(1);
      if (!item?.documentoNome || item.documentoUrl) throw new TRPCError({ code: "NOT_FOUND" });
      const data = item.documentoDriveFileId
        ? await readPrivateDocument(item.documentoDriveFileId)
        : await readPrivateDbFile("checklist", item.id);
      if (!data) throw new TRPCError({ code: "NOT_FOUND" });
      return { fileName: item.documentoNome ?? "documento", base64: data.toString("base64") };
    }),
});
