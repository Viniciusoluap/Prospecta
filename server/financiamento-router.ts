import { DOCUMENT_LIMIT, readUpload, clearUpload } from "./document-upload-chunks.js";
import { notifyClientDocumentRequest } from "./document-request-notifications.js";
import { FINANCING_DOCUMENT_MIMES, saveFinancingDocument } from "./financing-document-upload.js";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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
      const rows = await database
        .select({
          financiamento: financiamentos,
          checklistTotal: sql<number>`count(${financiamentoChecklistItems.id}) filter (where ${inArray(financiamentoChecklistItems.item, FINANCIAMENTO_CHECKLIST_PADRAO.map(item => item.item))})::int`,
          checklistConcluido: sql<number>`count(${financiamentoChecklistItems.id}) filter (where ${financiamentoChecklistItems.concluido} = true AND ${inArray(financiamentoChecklistItems.item, FINANCIAMENTO_CHECKLIST_PADRAO.map(item => item.item))})::int`,
        })
        .from(financiamentos)
        .leftJoin(
          financiamentoChecklistItems,
          eq(financiamentoChecklistItems.financiamentoId, financiamentos.id)
        )
        .where(where)
        .groupBy(financiamentos.id)
        .orderBy(desc(financiamentos.updatedAt));
      const leadIds = [...new Set(rows.map(row => row.financiamento.leadId).filter((id): id is number => id != null))];
      if (!leadIds.length) return rows;
      const values = await database.select({ id: leads.id, simulationValue: leads.simulationValue, approvedValue: leads.approvedValue })
        .from(leads).where(inArray(leads.id, leadIds));
      const byId = new Map(values.map(value => [value.id, value]));
      return rows.map(row => {
        const lead = row.financiamento.leadId && byId.get(row.financiamento.leadId);
        return { ...row, financiamento: { ...row.financiamento,
          valorImovel: lead ? lead.simulationValue ?? "0.00" : row.financiamento.valorImovel,
          valorFinanciado: lead ? lead.approvedValue ?? "0.00" : row.financiamento.valorFinanciado,
        } };
      });
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
      const contact = financiamento.leadId ? await clientFieldsFromLead(financiamento.leadId) : null;
      const [lead] = financiamento.leadId ? await database.select({ simulationValue: leads.simulationValue, approvedValue: leads.approvedValue })
        .from(leads).where(eq(leads.id, financiamento.leadId)).limit(1) : [];
      const current = FINANCIAMENTO_CHECKLIST_PADRAO.map(defaultItem => checklist.find(item => item.item === defaultItem.item)).filter((item): item is typeof checklist[number] => Boolean(item));
      return { financiamento: { ...financiamento, ...(contact ?? {}),
        valorImovel: lead ? lead.simulationValue ?? "0.00" : financiamento.valorImovel,
        valorFinanciado: lead ? lead.approvedValue ?? "0.00" : financiamento.valorFinanciado,
      }, checklist: current, legacyChecklist: checklist.filter(item => !FINANCIAMENTO_CHECKLIST_PADRAO.some(defaultItem => defaultItem.item === item.item)) };
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
      const [leadValues] = await database.select({ simulationValue: leads.simulationValue, approvedValue: leads.approvedValue })
        .from(leads).where(eq(leads.id, input.leadId)).limit(1);
      const [financiamento] = await database
        .insert(financiamentos)
        .values({
          ...input,
          ...client,
          valorImovel: leadValues?.simulationValue ?? "0.00",
          valorFinanciado: leadValues?.approvedValue ?? "0.00",
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
      const [updated] = await getDb().transaction(async tx => {
        if (leadId) await tx.execute(sql`SELECT id FROM leads WHERE id = ${leadId} FOR UPDATE`);
        const [record] = await tx.update(financiamentos).set({
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
        }).where(eq(financiamentos.id, input.id)).returning();
        if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Financiamento não encontrado" });
        if (leadId && (data.valorImovel !== undefined || data.valorFinanciado !== undefined)) {
          await tx.update(leads).set({
            ...(data.valorImovel !== undefined ? { simulationValue: data.valorImovel.toFixed(2) } : {}),
            ...(data.valorFinanciado !== undefined ? { approvedValue: data.valorFinanciado.toFixed(2) } : {}),
            updatedAt: new Date(),
          }).where(eq(leads.id, leadId));
          await tx.update(financiamentos).set({
            ...(data.valorImovel !== undefined ? { valorImovel: data.valorImovel.toFixed(2) } : {}),
            ...(data.valorFinanciado !== undefined ? { valorFinanciado: data.valorFinanciado.toFixed(2) } : {}),
            updatedAt: new Date(),
          }).where(eq(financiamentos.leadId, leadId));
        }
        return [record];
      });
      if (leadId && (data.valorImovel !== undefined || data.valorFinanciado !== undefined)) {
        const { sincronizarVgvDoLead } = await import("./obra-financeiro-router.js");
        await sincronizarVgvDoLead(leadId);
      }
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
   * Valores editados na lista atualizam o lead vinculado no mesmo commit.
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
      const [updated] = await getDb().transaction(async tx => {
        const [record] = await tx.select({ id: financiamentos.id, leadId: financiamentos.leadId })
          .from(financiamentos).where(eq(financiamentos.id, input.id)).limit(1);
        if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Financiamento não encontrado" });
        if (record.leadId) await tx.execute(sql`SELECT id FROM leads WHERE id = ${record.leadId} FOR UPDATE`);
        if (record.leadId) {
          await tx.update(leads).set({ simulationValue: input.valorImovel.toFixed(2), approvedValue: input.valorFinanciado.toFixed(2), updatedAt: new Date() })
            .where(eq(leads.id, record.leadId));
        }
        return tx.update(financiamentos).set({
          valorImovel: input.valorImovel.toFixed(2), valorFinanciado: input.valorFinanciado.toFixed(2), updatedAt: new Date(),
        }).where(record.leadId ? eq(financiamentos.leadId, record.leadId) : eq(financiamentos.id, input.id))
          .returning({ id: financiamentos.id });
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Financiamento não encontrado" });
      const [record] = await getDb().select({ leadId: financiamentos.leadId }).from(financiamentos).where(eq(financiamentos.id, input.id)).limit(1);
      if (record?.leadId) {
        const { sincronizarVgvDoLead } = await import("./obra-financeiro-router.js");
        await sincronizarVgvDoLead(record.leadId);
      }
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
      const database = getDb();
      const [previous] = await database.select({ item: financiamentoChecklistItems, leadId: financiamentos.leadId }).from(financiamentoChecklistItems).innerJoin(financiamentos, eq(financiamentoChecklistItems.financiamentoId, financiamentos.id)).where(and(eq(financiamentoChecklistItems.id, input.id), eq(financiamentoChecklistItems.financiamentoId, input.financiamentoId))).limit(1);
      if (!previous) throw new TRPCError({ code: "NOT_FOUND" });
      const visible = input.visivelCliente ?? previous.item.visivelCliente;
      const requested = input.solicitarDocumento ?? previous.item.solicitarDocumento;
      if (requested && !visible && !previous.item.solicitarDocumento) throw new TRPCError({ code: "BAD_REQUEST", message: "Deixe o documento visível antes de solicitar" });
      const [updated] = await database
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
      const shouldNotify = visible && requested && (!previous.item.solicitarDocumento || !previous.item.visivelCliente);
      const notice = shouldNotify && previous.leadId ? await notifyClientDocumentRequest(previous.leadId, previous.item.item, "/portal/financiamento") : null;
      return { ...updated, emailWarning: notice?.emailWarning ?? null };
    }),

  /** Item 03: exclusão definitiva (remove checklist e o serviço do CRM ligado). */
  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await excluirDefinitivo("financiamento", input.id, ctx.user);
      return { success: true } as const;
    }),

  requestChecklistDocument: adminProcedure
    .input(z.object({ financiamentoId: z.number().int().positive(), itemId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const [record] = await getDb().select({ item: financiamentoChecklistItems, leadId: financiamentos.leadId }).from(financiamentoChecklistItems).innerJoin(financiamentos, eq(financiamentoChecklistItems.financiamentoId, financiamentos.id)).where(and(eq(financiamentoChecklistItems.id, input.itemId), eq(financiamentos.id, input.financiamentoId))).limit(1);
      if (!record?.leadId || !record.item.visivelCliente) throw new TRPCError({ code: "BAD_REQUEST", message: "Cliente vinculado e documento visível são necessários" });
      await getDb().update(financiamentoChecklistItems).set({ solicitarDocumento: true }).where(eq(financiamentoChecklistItems.id, input.itemId));
      return notifyClientDocumentRequest(record.leadId, record.item.item, "/portal/financiamento");
    }),

  uploadChecklistDocument: adminProcedure
    .input(z.object({ financiamentoId: z.number().int().positive(), itemId: z.number().int().positive(), fileName: z.string().min(1).max(255), mimeType: z.enum(FINANCING_DOCUMENT_MIMES), base64: z.string().min(8).max(4_200_000).optional(), uploadId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [record] = await getDb().select({ item: financiamentoChecklistItems, leadId: financiamentos.leadId }).from(financiamentoChecklistItems).innerJoin(financiamentos, eq(financiamentoChecklistItems.financiamentoId, financiamentos.id)).where(and(eq(financiamentoChecklistItems.id, input.itemId), eq(financiamentos.id, input.financiamentoId))).limit(1);
      if (!record?.leadId) throw new TRPCError({ code: "NOT_FOUND", message: "Financiamento sem cliente vinculado" });
      const data = input.uploadId ? await readUpload(input.uploadId, ctx.user.id, `finance:${input.financiamentoId}:${input.itemId}`, input.fileName) : Buffer.from(input.base64 ?? "", "base64");
      const result = await saveFinancingDocument({ itemId: record.item.id, financingId: input.financiamentoId, leadId: record.leadId, label: record.item.item, fileName: input.fileName, mimeType: input.mimeType, data });
      if (input.uploadId) await clearUpload(input.uploadId, ctx.user.id);
      return result;
    }),

  checklistDocumentContent: adminProcedure
    .input(z.object({ id: z.number().int().positive(), offset: z.number().int().min(0).max(DOCUMENT_LIMIT).optional() }))
    .query(async ({ input }) => {
      const [item] = await getDb().select().from(financiamentoChecklistItems).where(eq(financiamentoChecklistItems.id, input.id)).limit(1);
      if (!item?.documentoNome || item.documentoUrl) throw new TRPCError({ code: "NOT_FOUND" });
      const data = item.documentoDriveFileId
        ? await readPrivateDocument(item.documentoDriveFileId)
        : await readPrivateDbFile("checklist", item.id);
      if (!data) throw new TRPCError({ code: "NOT_FOUND" });
      return { fileName: item.documentoNome ?? "documento", total: data.length, base64: data.subarray(input.offset ?? 0,(input.offset ?? 0) + 1024 * 1024).toString("base64") };
    }),
});
