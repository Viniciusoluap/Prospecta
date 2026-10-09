import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, ne, notInArray, sql } from "drizzle-orm";
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
import { adminProcedure, protectedProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";
import { storagePut } from "./storage.js";
import { requireClientContext } from "./profile-context.js";

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
  requireRole(ctx, ["cliente"]);
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
  if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) return false;
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
    (existing.role !== "cliente" ||
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
    const { leadId } = requireClientContext(ctx.user);
    const db = getDb();
    const [[works], [activeFinancing]] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(constructionProjects)
        .where(eq(constructionProjects.leadId, leadId)),
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
    const { leadId } = requireClientContext(ctx.user);
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
        startDate: constructionProjects.startDate,
        estimatedEndDate: constructionProjects.estimatedEndDate,
        actualEndDate: constructionProjects.actualEndDate,
        updatedAt: constructionProjects.updatedAt,
      })
      .from(constructionProjects)
      .where(eq(constructionProjects.leadId, leadId))
      .orderBy(desc(constructionProjects.updatedAt));
  }),

  work: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const { leadId } = requireClientContext(ctx.user);
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
          startDate: constructionProjects.startDate,
          estimatedEndDate: constructionProjects.estimatedEndDate,
          actualEndDate: constructionProjects.actualEndDate,
          updatedAt: constructionProjects.updatedAt,
        })
        .from(constructionProjects)
        .where(
          and(
            eq(constructionProjects.id, input.projectId),
            eq(constructionProjects.leadId, leadId)
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
      return { project, stages, photos };
    }),

  financings: protectedProcedure.query(async ({ ctx }) => {
    const { leadId } = requireClientContext(ctx.user);
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
          documentoNome: financiamentoChecklistItems.documentoNome,
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
      return { financing, checklist };
    }),

  uploadFinancingDocument: protectedProcedure
    .input(
      z.object({
        financingId: z.number().int().positive(),
        checklistItemId: z.number().int().positive(),
        fileName: z.string().trim().min(1).max(255),
        mimeType: allowedPortalDocumentMime,
        base64: z.string().min(8),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { leadId, userId } = requireClientContext(ctx.user);
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
      const buffer = Buffer.from(input.base64, "base64");
      if (!isValidPortalDocument(buffer, input.mimeType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Envie PDF, JPG ou PNG válido de até 10 MiB",
        });
      }
      const extension =
        input.mimeType === "application/pdf"
          ? "pdf"
          : input.mimeType === "image/png"
            ? "png"
            : "jpg";
      const { url } = await storagePut(
        `portal/financiamentos/${userId}/${randomUUID()}.${extension}`,
        buffer,
        input.mimeType
      );
      await db
        .update(financiamentoChecklistItems)
        .set({
          documentoUrl: url,
          documentoNome: input.fileName,
          documentoMime: input.mimeType,
          enviadoEm: new Date(),
        })
        .where(eq(financiamentoChecklistItems.id, request.item.id));
      return { url };
    }),

  dashboard: protectedProcedure.query(async ({ ctx }) => {
    const { leadId } = requireClientContext(ctx.user);
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
      .where(eq(constructionProjects.leadId, leadId))
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
      if (!isValidSignedPdf(buffer)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Envie um PDF válido de até 10 MiB",
        });
      }
      const safeNumber = contract.number.replace(/[^a-zA-Z0-9_-]/g, "-");
      const { url } = await storagePut(
        `portal/contratos/${safeNumber}-${Date.now()}.pdf`,
        buffer,
        input.mimeType
      );
      await db
        .insert(portalContractDocuments)
        .values({
          contractId: contract.id,
          name: input.fileName,
          url,
          type: "assinado",
        });
      await db
        .update(portalContracts)
        .set({
          signatureStatus: "assinado",
          signedDocumentUrl: url,
          updatedAt: new Date(),
        })
        .where(eq(portalContracts.id, contract.id));
      return { url };
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
              name: lead.name,
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
          responsibleName: z.string().max(255).optional(),
          notes: z.string().max(2000).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const [visit] = await getDb()
          .insert(portalVisits)
          .values(input)
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
