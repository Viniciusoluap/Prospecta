import { DOCUMENT_LIMIT, readUpload, clearUpload } from "./document-upload-chunks.js";
import { FINANCING_DOCUMENT_MIMES, saveFinancingDocument } from "./financing-document-upload.js";
import { FINANCIAMENTO_CHECKLIST_PADRAO } from "../shared/financiamento.js";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, ne, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  imoveis,
  constructionProjects,
  constructionStages,
  constructionPhotos,
  financiamentos,
  financiamentoChecklistItems,
  leadActivities,
  leads,
  portalChatMessages,
  portalContractDocuments,
  portalContracts,
  portalVisits,
  users,
} from "../drizzle/schema.js";
import { hashPassword } from "./_core/auth-utils.js";
import { requireRole } from "./_core/rbac.js";
import { carregarProgresso } from "./obra-progresso-router.js";
import { etapasDoProgresso } from "../shared/financeiro/detalhe-obra.js";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc.js";
import { getAssignableUserById, getDb } from "./db.js";
import { agendarVisitaDoLead, opcoesDaVisitaDoLead } from "./operacional-router.js";
import { visitInput } from "../shared/operacional.js";
import { readPrivateDocument, tryDriveUpload, uploadPrivateDocument } from "./drive-documents.js";
import { readPrivateDbFile } from "./private-document-files.js";
import { isClientRole, requireClientContext } from "./profile-context.js";

const visitStatus = z.enum([
  "agendada",
  "realizada",
  "cancelada",
  "reagendada",
]);
const signatureStatus = z.enum([
  "pendente",
  "solicitado",
  "assinado",
  "rejeitado",
]);
const documentType = z.enum(["contrato_gerado", "assinado", "anexo"]);

export function clientLeadId(ctx: {
  user: { role: string; leadId: number | null };
}): number {
  if (!isClientRole(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
  }
  if (!ctx.user.leadId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Perfil não vinculado a um cliente",
    });
  }
  return ctx.user.leadId;
}

const allowedPortalDocumentMime = z.enum([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

export function isValidPortalDocument(
  buffer: Buffer,
  mimeType: z.infer<typeof allowedPortalDocumentMime>
): boolean {
  if (buffer.length === 0 || buffer.length > DOCUMENT_LIMIT) return false;
  if (mimeType === "application/pdf")
    return buffer.subarray(0, 4).toString() === "%PDF";
  if (mimeType === "image/png")
    return buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

export function isValidSignedPdf(buffer: Buffer): boolean {
  return (
    buffer.length > 0 &&
    buffer.length <= 10 * 1024 * 1024 &&
    buffer.subarray(0, 4).toString() === "%PDF"
  );
}

export function assertProvisionable(
  existing: { role: string; leadId: number | null } | undefined,
  leadId: number
): void {
  if (
    existing &&
    (!isClientRole(existing.role) ||
      (existing.leadId && existing.leadId !== leadId))
  ) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "E-mail já pertence a outra conta",
    });
  }
}

export const portalRouter = router({
  navigation: protectedProcedure.query(async ({ ctx }) => {
    const { leadId, userId } = requireClientContext(ctx.user);
    const db = getDb();
    const [[works], [activeFinancing]] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(constructionProjects)
        .where(
          or(
            eq(constructionProjects.leadId, leadId),
            eq(constructionProjects.userId, userId)
          )
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(financiamentos)
        .where(
          and(
            eq(financiamentos.leadId, leadId),
            notInArray(financiamentos.status, ["liberado", "cancelado"])
          )
        ),
    ]);
    return {
      hasWorks: Number(works?.count ?? 0) > 0,
      hasActiveFinancing: Number(activeFinancing?.count ?? 0) > 0,
      hasProspectaEcosystem: true,
    };
  }),

  works: protectedProcedure.query(async ({ ctx }) => {
    const { leadId, userId } = requireClientContext(ctx.user);
    return getDb()
      .select({
        id: constructionProjects.id,
        title: constructionProjects.title,
        address: constructionProjects.address,
        city: constructionProjects.city,
        state: constructionProjects.state,
        projectType: constructionProjects.projectType,
        status: constructionProjects.status,
        progress: constructionProjects.progress,
        progressMeasuredPct: constructionProjects.progressMeasuredPct,
        startDate: constructionProjects.startDate,
        estimatedEndDate: constructionProjects.estimatedEndDate,
        actualEndDate: constructionProjects.actualEndDate,
        updatedAt: constructionProjects.updatedAt,
      })
      .from(constructionProjects)
      .where(
        or(
          eq(constructionProjects.leadId, leadId),
          eq(constructionProjects.userId, userId)
        )
      )
      .orderBy(desc(constructionProjects.updatedAt));
  }),

  work: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const { leadId, userId } = requireClientContext(ctx.user);
      const db = getDb();
      const [project] = await db
        .select({
          id: constructionProjects.id,
          title: constructionProjects.title,
          address: constructionProjects.address,
          city: constructionProjects.city,
          state: constructionProjects.state,
          projectType: constructionProjects.projectType,
          status: constructionProjects.status,
          progress: constructionProjects.progress,
          progressMeasuredPct: constructionProjects.progressMeasuredPct,
          startDate: constructionProjects.startDate,
          estimatedEndDate: constructionProjects.estimatedEndDate,
          actualEndDate: constructionProjects.actualEndDate,
          updatedAt: constructionProjects.updatedAt,
        })
        .from(constructionProjects)
        .where(
          and(
            eq(constructionProjects.id, input.projectId),
            or(
              eq(constructionProjects.leadId, leadId),
              eq(constructionProjects.userId, userId)
            )
          )
        )
        .limit(1);
      if (!project)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Obra não encontrada",
        });
      const [stages, photos] = await Promise.all([
        db
          .select({
            id: constructionStages.id,
            name: constructionStages.name,
            description: constructionStages.description,
            orderIndex: constructionStages.orderIndex,
            status: constructionStages.status,
            startDate: constructionStages.startDate,
            endDate: constructionStages.endDate,
          })
          .from(constructionStages)
          .where(eq(constructionStages.projectId, project.id))
          .orderBy(asc(constructionStages.orderIndex)),
        db
          .select({
            id: constructionPhotos.id,
            stageId: constructionPhotos.stageId,
            imageUrl: constructionPhotos.imageUrl,
            caption: constructionPhotos.caption,
            takenAt: constructionPhotos.takenAt,
          })
          .from(constructionPhotos)
          .where(eq(constructionPhotos.projectId, project.id))
          .orderBy(desc(constructionPhotos.takenAt)),
      ]);
      // Pedido de 18/10: o cliente acompanha (só leitura) as etapas por incidência
      // e as medições salvas — os mesmos números da tela da equipe, sem valores.
      const progresso = await carregarProgresso(project.id);
      const etapas = etapasDoProgresso(progresso.calculo);
      const medicoes = progresso.historico.map(({ id, progresso: pct, criadoEm }) => ({ id, progresso: pct, criadoEm }));
      return { project, stages, photos, etapas, medicoes };
    }),

  financings: protectedProcedure.query(async ({ ctx }) => {
    const { leadId, userId } = requireClientContext(ctx.user);
    return getDb()
      .select({
        id: financiamentos.id,
        imovel: financiamentos.imovel,
        tipo: financiamentos.tipo,
        banco: financiamentos.banco,
        bancoOutro: financiamentos.bancoOutro,
        status: financiamentos.status,
        protocolo: financiamentos.protocolo,
        valorImovel: financiamentos.valorImovel,
        valorFinanciado: financiamentos.valorFinanciado,
        entrada: financiamentos.entrada,
        taxa: financiamentos.taxa,
        prazo: financiamentos.prazo,
        parcela: financiamentos.parcela,
        updatedAt: financiamentos.updatedAt,
      })
      .from(financiamentos)
      .where(
        and(
          eq(financiamentos.leadId, leadId),
          notInArray(financiamentos.status, ["liberado", "cancelado"])
        )
      )
      .orderBy(desc(financiamentos.updatedAt));
  }),

  financing: protectedProcedure
    .input(z.object({ financingId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const { leadId } = requireClientContext(ctx.user);
      const db = getDb();
      const [financing] = await db
        .select({
          id: financiamentos.id,
          imovel: financiamentos.imovel,
          tipo: financiamentos.tipo,
          banco: financiamentos.banco,
          bancoOutro: financiamentos.bancoOutro,
          status: financiamentos.status,
          protocolo: financiamentos.protocolo,
          valorImovel: financiamentos.valorImovel,
          valorFinanciado: financiamentos.valorFinanciado,
          entrada: financiamentos.entrada,
          taxa: financiamentos.taxa,
          prazo: financiamentos.prazo,
          parcela: financiamentos.parcela,
          updatedAt: financiamentos.updatedAt,
        })
        .from(financiamentos)
        .where(
          and(
            eq(financiamentos.id, input.financingId),
            eq(financiamentos.leadId, leadId),
            notInArray(financiamentos.status, ["liberado", "cancelado"])
          )
        )
        .limit(1);
      if (!financing)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Financiamento ativo não encontrado",
        });
      const checklist = await db
        .select({
          id: financiamentoChecklistItems.id,
          grupo: financiamentoChecklistItems.grupo,
          item: financiamentoChecklistItems.item,
          concluido: financiamentoChecklistItems.concluido,
          concluidoEm: financiamentoChecklistItems.concluidoEm,
          solicitarDocumento: financiamentoChecklistItems.solicitarDocumento,
          documentoUrl: financiamentoChecklistItems.documentoUrl,
          documentoDriveFileId: financiamentoChecklistItems.documentoDriveFileId,
          documentoNome: financiamentoChecklistItems.documentoNome,
          documentoMime: financiamentoChecklistItems.documentoMime,
          enviadoEm: financiamentoChecklistItems.enviadoEm,
        })
        .from(financiamentoChecklistItems)
        .where(
          and(
            eq(financiamentoChecklistItems.financiamentoId, financing.id),
            eq(financiamentoChecklistItems.visivelCliente, true)
          )
        )
        .orderBy(
          asc(financiamentoChecklistItems.grupo),
          asc(financiamentoChecklistItems.id)
        );
      return { financing, checklist: FINANCIAMENTO_CHECKLIST_PADRAO.map(defaultItem => checklist.find(item => item.item === defaultItem.item)).filter((item): item is typeof checklist[number] => Boolean(item)) };
    }),

  uploadFinancingDocument: protectedProcedure
    .input(
      z.object({
        financingId: z.number().int().positive(),
        checklistItemId: z.number().int().positive(),
        fileName: z.string().trim().min(1).max(255),
        mimeType: z.enum(FINANCING_DOCUMENT_MIMES),
        base64: z.string().min(8).max(4_200_000).optional(), uploadId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { leadId } = requireClientContext(ctx.user);
      const db = getDb();
      const [request] = await db
        .select({
          item: financiamentoChecklistItems,
          financingId: financiamentos.id,
        })
        .from(financiamentoChecklistItems)
        .innerJoin(
          financiamentos,
          eq(financiamentoChecklistItems.financiamentoId, financiamentos.id)
        )
        .where(
          and(
            eq(financiamentoChecklistItems.id, input.checklistItemId),
            eq(financiamentoChecklistItems.financiamentoId, input.financingId),
            eq(financiamentoChecklistItems.visivelCliente, true),
            eq(financiamentoChecklistItems.solicitarDocumento, true),
            eq(financiamentos.leadId, leadId),
            notInArray(financiamentos.status, ["liberado", "cancelado"])
          )
        )
        .limit(1);
      if (!request)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Solicitação de documento não encontrada",
        });
      const data = input.uploadId ? await readUpload(input.uploadId, ctx.user.id, `finance:${input.financingId}:${input.checklistItemId}`, input.fileName) : Buffer.from(input.base64 ?? "", "base64");
      const result = await saveFinancingDocument({ itemId: request.item.id, financingId: input.financingId, leadId, label: request.item.item, fileName: input.fileName, mimeType: input.mimeType, data });
      if (input.uploadId) await clearUpload(input.uploadId, ctx.user.id);
      return result;
    }),

  checklistDocumentContent: protectedProcedure
    .input(z.object({ checklistItemId: z.number().int().positive(), offset: z.number().int().min(0).max(DOCUMENT_LIMIT).optional() }))
    .query(async ({ ctx, input }) => {
      const { leadId } = requireClientContext(ctx.user);
      const db = getDb();
      const [row] = await db.select({ item: financiamentoChecklistItems })
        .from(financiamentoChecklistItems)
        .innerJoin(financiamentos, eq(financiamentoChecklistItems.financiamentoId, financiamentos.id))
        .where(and(
          eq(financiamentoChecklistItems.id, input.checklistItemId),
          eq(financiamentos.leadId, leadId),
          eq(financiamentoChecklistItems.visivelCliente, true),
          notInArray(financiamentos.status, ["liberado", "cancelado"]),
        ))
        .limit(1);
      if (!row?.item.documentoNome || row.item.documentoUrl) throw new TRPCError({ code: "NOT_FOUND" });
      const data = row.item.documentoDriveFileId
        ? await readPrivateDocument(row.item.documentoDriveFileId)
        : await readPrivateDbFile("checklist", row.item.id);
      if (!data) throw new TRPCError({ code: "NOT_FOUND" });
      return { fileName: row.item.documentoNome ?? "documento", total: data.length, base64: data.subarray(input.offset ?? 0,(input.offset ?? 0) + 1024 * 1024).toString("base64") };
    }),

  dashboard: protectedProcedure.query(async ({ ctx }) => {
    const { leadId, userId } = requireClientContext(ctx.user);
    const db = getDb();
    const [lead] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, leadId))
      .limit(1);
    if (!lead)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Cliente não encontrado",
      });
    const [lastActivity] = await db
      .select()
      .from(leadActivities)
      .where(
        and(eq(leadActivities.leadId, leadId), ne(leadActivities.type, "note"))
      )
      .orderBy(desc(leadActivities.createdAt))
      .limit(1);
    const [project] = await db
      .select()
      .from(constructionProjects)
      .where(
        or(
          eq(constructionProjects.leadId, leadId),
          eq(constructionProjects.userId, userId)
        )
      )
      .orderBy(desc(constructionProjects.updatedAt))
      .limit(1);
    return {
      lead,
      project: project ?? null,
      lastActivity: lastActivity ?? null,
    };
  }),

  activities: protectedProcedure.query(async ({ ctx }) => {
    const leadId = clientLeadId(ctx);
    return getDb()
      .select()
      .from(leadActivities)
      .where(
        and(eq(leadActivities.leadId, leadId), ne(leadActivities.type, "note"))
      )
      .orderBy(desc(leadActivities.createdAt));
  }),

  visits: protectedProcedure.query(async ({ ctx }) => {
    const leadId = clientLeadId(ctx);
    return getDb()
      .select({ visit: portalVisits, property: imoveis })
      .from(portalVisits)
      .leftJoin(imoveis, eq(portalVisits.propertyId, imoveis.id))
      .where(eq(portalVisits.leadId, leadId))
      .orderBy(desc(portalVisits.scheduledAt));
  }),

  contracts: protectedProcedure.query(async ({ ctx }) => {
    const leadId = clientLeadId(ctx);
    const db = getDb();
    const contracts = await db
      .select()
      .from(portalContracts)
      .where(eq(portalContracts.leadId, leadId))
      .orderBy(desc(portalContracts.createdAt));
    const documents = contracts.length
      ? await db
          .select()
          .from(portalContractDocuments)
          .orderBy(desc(portalContractDocuments.createdAt))
      : [];
    return contracts.map(contract => ({
      ...contract,
      documents: documents.filter(
        document => document.contractId === contract.id
      ),
    }));
  }),

  uploadSignedContract: protectedProcedure
    .input(
      z.object({
        contractId: z.number().int().positive(),
        fileName: z.string().min(1).max(255),
        mimeType: z.literal("application/pdf"),
        base64: z.string().min(8),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const leadId = clientLeadId(ctx);
      const db = getDb();
      const [contract] = await db
        .select()
        .from(portalContracts)
        .where(
          and(
            eq(portalContracts.id, input.contractId),
            eq(portalContracts.leadId, leadId)
          )
        )
        .limit(1);
      if (!contract)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Contrato não encontrado",
        });
      const buffer = Buffer.from(input.base64, "base64");
      if (!isValidSignedPdf(buffer) || buffer.length > 3 * 1024 * 1024) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Envie um PDF válido de até 3 MiB",
        });
      }
      const safeNumber = contract.number.replace(/[^a-zA-Z0-9_-]/g, "-");
      const { driveFileId } = await tryDriveUpload(() => uploadPrivateDocument({ leadId, serviceId: null, categoria: "juridico", rotulo: `Contrato ${contract.number} assinado`, nomeOriginal: `${safeNumber}.pdf`, mimeType: input.mimeType, data: buffer }));
      if (driveFileId) {
        await db.batch([
          db.insert(portalContractDocuments).values({ contractId: contract.id, name: input.fileName, type: "assinado", driveFileId }),
          db.update(portalContracts).set({ signatureStatus: "assinado", signedDocumentUrl: null, updatedAt: new Date() })
            .where(eq(portalContracts.id, contract.id)),
        ]);
      } else {
        const reserved = await db.execute(sql`SELECT nextval(pg_get_serial_sequence('portal_contract_documents', 'id'))::int AS id`);
        const id = Number((reserved as unknown as { rows: { id: number }[] }).rows[0].id);
        await db.batch([
          db.insert(portalContractDocuments).values({ id, contractId: contract.id, name: input.fileName, type: "assinado" }),
          db.execute(sql`INSERT INTO portal_contract_file_data (document_id, mime, size_bytes, data)
            VALUES (${id}, 'application/pdf', ${buffer.length}, decode(${buffer.toString("base64")}, 'base64'))`),
          db.update(portalContracts).set({ signatureStatus: "assinado", signedDocumentUrl: null, updatedAt: new Date() })
            .where(eq(portalContracts.id, contract.id)),
        ]);
      }
      return { url: null };
    }),

  contractDocumentContent: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const leadId = clientLeadId(ctx);
      const db = getDb();
      const [row] = await db.select({ document: portalContractDocuments })
        .from(portalContractDocuments)
        .innerJoin(portalContracts, eq(portalContractDocuments.contractId, portalContracts.id))
        .where(and(eq(portalContractDocuments.id, input.id), eq(portalContracts.leadId, leadId)))
        .limit(1);
      if (!row || row.document.url) throw new TRPCError({ code: "NOT_FOUND" });
      // Cópia no banco (fallback) tem prioridade; o Drive pode ter só a cópia organizada (29/10).
      const data = (await readPrivateDbFile("contract", row.document.id)) ?? (row.document.driveFileId ? await readPrivateDocument(row.document.driveFileId) : null);
      if (!data) throw new TRPCError({ code: "NOT_FOUND" });
      return { fileName: row.document.name, base64: data.toString("base64") };
    }),

  messages: protectedProcedure
    .input(z.object({ after: z.date().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const leadId = clientLeadId(ctx);
      const where = input?.after
        ? and(
            eq(portalChatMessages.leadId, leadId),
            gt(portalChatMessages.createdAt, input.after)
          )
        : eq(portalChatMessages.leadId, leadId);
      return getDb()
        .select()
        .from(portalChatMessages)
        .where(where)
        .orderBy(asc(portalChatMessages.createdAt))
        .limit(100);
    }),

  sendMessage: protectedProcedure
    .input(z.object({ text: z.string().trim().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const leadId = clientLeadId(ctx);
      const [message] = await getDb()
        .insert(portalChatMessages)
        .values({ leadId, sender: "cliente", text: input.text })
        .returning();
      return message;
    }),

  admin: router({
    // Agendamento de visita pelo lead (item 10): autorizado pelo CRM, gravado na Agenda.
    visitOptions: adminProcedure.query(() => opcoesDaVisitaDoLead()),
    scheduleVisit: adminProcedure
      .input(visitInput.and(z.object({ leadId: z.number().int().positive() })))
      .mutation(({ input }) => agendarVisitaDoLead(input)),
    overview: adminProcedure
      .input(z.object({ leadId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const db = getDb();
        const [account] = await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(eq(users.leadId, input.leadId))
          .limit(1);
        const visits = await db
          .select()
          .from(portalVisits)
          .where(eq(portalVisits.leadId, input.leadId))
          .orderBy(desc(portalVisits.scheduledAt));
        const contracts = await db
          .select()
          .from(portalContracts)
          .where(eq(portalContracts.leadId, input.leadId))
          .orderBy(desc(portalContracts.createdAt));
        const messages = await db
          .select()
          .from(portalChatMessages)
          .where(eq(portalChatMessages.leadId, input.leadId))
          .orderBy(asc(portalChatMessages.createdAt))
          .limit(100);
        return { account: account ?? null, visits, contracts, messages };
      }),

    provisionAccess: adminProcedure
      .input(
        z.object({
          leadId: z.number().int().positive(),
          email: z.string().email(),
          password: z.string().min(8).max(128),
        })
      )
      .mutation(async ({ input }) => {
        const db = getDb();
        const email = input.email.toLowerCase().trim();
        const [lead] = await db
          .select()
          .from(leads)
          .where(eq(leads.id, input.leadId))
          .limit(1);
        if (!lead)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Lead não encontrado",
          });
        const [existing] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        assertProvisionable(existing, input.leadId);
        const passwordHash = hashPassword(input.password);
        if (existing) {
          // sessionVersion incrementado pelo mesmo motivo de configuracoes-router.ts
          // resetPassword: reprovisionar credenciais nao deveria deixar uma sessao
          // antiga (de quem tinha a senha anterior) continuar valida.
          await db
            .update(users)
            .set({
              leadId: input.leadId,
              passwordHash,
              // Item 12 (18/10): nome e telefone vêm do cadastro do cliente no CRM.
              name: lead.name,
              phone: lead.phone || existing.phone,
              sessionVersion: sql`${users.sessionVersion} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(users.id, existing.id));
          return { id: existing.id, email };
        }
        const [created] = await db
          .insert(users)
          .values({
            openId: `portal:${email}`,
            email,
            name: lead.name,
            phone: lead.phone || null,
            role: "cliente",
            leadId: input.leadId,
            passwordHash,
            loginMethod: "password",
          })
          .returning({ id: users.id });
        return { id: created.id, email };
      }),

    createVisit: adminProcedure
      .input(
        z.object({
          leadId: z.number().int().positive(),
          propertyId: z.number().int().positive().nullable().optional(),
          scheduledAt: z.date(),
          status: visitStatus.default("agendada"),
          // Seleção real: id de um administrador/colaborador ativo (ver
          // tasks.assignableUsers / agendaRouter.options). Nunca texto livre —
          // mesma regra aplicada no agendaRouter para esta mesma tabela.
          responsibleId: z.number().int().positive().optional(),
          notes: z.string().max(2000).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { responsibleId, ...rest } = input;
        let responsibleName: string | null = null;
        if (responsibleId !== undefined) {
          const responsible = await getAssignableUserById(responsibleId);
          if (!responsible) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Selecione um administrador ou colaborador ativo como responsável",
            });
          }
          responsibleName = responsible.name || `Usuário #${responsible.id}`;
        }
        const [visit] = await getDb()
          .insert(portalVisits)
          .values({ ...rest, responsibleName })
          .returning();
        return visit;
      }),

    createContract: adminProcedure
      .input(
        z.object({
          leadId: z.number().int().positive(),
          number: z.string().trim().min(1).max(80),
          type: z.string().trim().min(1).max(80),
          description: z.string().max(4000).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const [contract] = await getDb()
          .insert(portalContracts)
          .values(input)
          .returning();
        return contract;
      }),

    addDocument: adminProcedure
      .input(
        z.object({
          contractId: z.number().int().positive(),
          name: z.string().trim().min(1).max(255),
          url: z.string().url(),
          type: documentType.default("anexo"),
        })
      )
      .mutation(async ({ input }) => {
        const [document] = await getDb()
          .insert(portalContractDocuments)
          .values(input)
          .returning();
        return document;
      }),

    setSignatureStatus: adminProcedure
      .input(
        z.object({
          contractId: z.number().int().positive(),
          status: signatureStatus,
        })
      )
      .mutation(async ({ input }) => {
        await getDb()
          .update(portalContracts)
          .set({ signatureStatus: input.status, updatedAt: new Date() })
          .where(eq(portalContracts.id, input.contractId));
        return { success: true };
      }),

    sendMessage: adminProcedure
      .input(
        z.object({
          leadId: z.number().int().positive(),
          text: z.string().trim().min(1).max(2000),
        })
      )
      .mutation(async ({ input }) => {
        const [message] = await getDb()
          .insert(portalChatMessages)
          .values({
            leadId: input.leadId,
            sender: "corretor",
            text: input.text,
          })
          .returning();
        return message;
      }),
  }),
});
