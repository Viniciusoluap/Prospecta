import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { imoveis, imovelRecusadoAvisos, leads, operationalCommissions } from "../drizzle/schema.js";
import { BROKER_PROPERTY_TYPES, brokerLeadStage, isPropertyPhoto, isPropertyPhotoOrSaved, MAX_BROKER_PHOTOS, recusaAindaVisivel } from "../shared/broker-portal.js";
import { protectedProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";
import { listarComissoesDeObras } from "./operacional-router.js";
import { aplicarFotosImovel } from "./imovel-fotos.js";
import { requireBrokerContext } from "./profile-context.js";
import { excluirImovelDefinitivo } from "./imovel-exclusao.js";

const propertyInput = z.object({
  titulo: z.string().trim().min(2).max(255),
  descricao: z.string().trim().max(5000).optional(),
  // Portal do corretor (15/10): tipo só pelas opções da lista.
  tipo: z.enum(BROKER_PROPERTY_TYPES.map(t => t.value) as [string, ...string[]]),
  preco: z.number().positive(),
  quartos: z.number().int().nonnegative().optional(),
  banheiros: z.number().int().nonnegative().optional(),
  vagas: z.number().int().nonnegative().optional(),
  areaM2: z.number().nonnegative().optional(),
  endereco: z.string().trim().max(1000).optional(),
  bairro: z.string().trim().max(100).optional(),
  cidade: z.string().trim().min(1).max(100),
  estado: z.string().trim().length(2).optional(),
  // Fotos comprimidas no aparelho e gravadas no próprio imóvel (mesmo formato
  // do cadastro do admin). O storage externo antigo nunca foi configurado.
  fotos: z.array(z.string().refine(isPropertyPhoto, "Foto inválida")).max(MAX_BROKER_PHOTOS).default([]),
});

// Item 3 (18/10): na edição, a lista mistura fotos já gravadas e fotos novas.
const propertyUpdateInput = propertyInput.extend({
  id: z.number().int().positive(),
  fotos: z.array(z.string().refine(isPropertyPhotoOrSaved, "Foto inválida")).max(MAX_BROKER_PHOTOS).default([]),
});

/** Imóvel cadastrado por este corretor — edição e exclusão só do próprio registro. */
async function imovelDoCorretor(id: number, userId: number) {
  const [row] = await getDb()
    .select({ id: imoveis.id })
    .from(imoveis)
    .where(and(eq(imoveis.id, id), eq(imoveis.createdByUserId, userId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Imóvel não encontrado entre os seus cadastros" });
  return row;
}

const imageMime = z.enum(["image/jpeg", "image/png", "image/webp"]);

export function propertySlug(
  title: string,
  suffix = Date.now().toString(36)
): string {
  const base =
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "imovel";
  return `${base}-${suffix}`;
}

export function isValidPropertyImage(
  buffer: Buffer,
  mime: z.infer<typeof imageMime>
): boolean {
  if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) return false;
  if (mime === "image/png")
    return buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/webp")
    return (
      buffer.subarray(0, 4).toString() === "RIFF" &&
      buffer.subarray(8, 12).toString() === "WEBP"
    );
  return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

export const brokerPortalRouter = router({
  overview: protectedProcedure.query(async ({ ctx }) => {
    const { brokerId } = requireBrokerContext(ctx.user);
    const db = getDb();
    const [properties, commissions] = await Promise.all([
      db
        .select({ id: imoveis.id })
        .from(imoveis)
        .where(
          or(
            eq(imoveis.reviewStatus, "approved"),
            eq(imoveis.createdByUserId, brokerId)
          )
        )
        .orderBy(desc(imoveis.createdAt)),
      db
        .select({ id: operationalCommissions.id })
        .from(operationalCommissions)
        .where(eq(operationalCommissions.brokerId, brokerId)),
    ]);
    return { properties: properties.length, commissions: commissions.length };
  }),

  properties: protectedProcedure.query(async ({ ctx }) => {
    const { userId } = requireBrokerContext(ctx.user);
    const rows = await getDb()
      .select({
        id: imoveis.id,
        slug: imoveis.slug,
        titulo: imoveis.titulo,
        descricao: imoveis.descricao,
        tipo: imoveis.tipo,
        status: imoveis.status,
        preco: imoveis.preco,
        quartos: imoveis.quartos,
        banheiros: imoveis.banheiros,
        vagas: imoveis.vagas,
        areaM2: imoveis.areaM2,
        bairro: imoveis.bairro,
        cidade: imoveis.cidade,
        estado: imoveis.estado,
        fotos: imoveis.fotos,
        publicadoSite: imoveis.publicadoSite,
        reviewStatus: imoveis.reviewStatus,
        reviewedAt: imoveis.reviewedAt,
        updatedAt: imoveis.updatedAt,
        endereco: imoveis.endereco,
        createdByUserId: imoveis.createdByUserId,
        createdAt: imoveis.createdAt,
      })
      .from(imoveis)
      .where(
        or(
          eq(imoveis.reviewStatus, "approved"),
          eq(imoveis.createdByUserId, userId)
        )
      )
      .orderBy(desc(imoveis.createdAt));
    const agora = new Date();
    // Item 8 (18/10): recusado aparece por 3 dias ao corretor e depois some da lista dele.
    const visiveis = rows.filter(
      row => row.reviewStatus !== "rejected" || recusaAindaVisivel(row.reviewedAt ?? row.updatedAt, agora)
    );
    const avisos = (
      await getDb()
        .select()
        .from(imovelRecusadoAvisos)
        .where(eq(imovelRecusadoAvisos.brokerUserId, userId))
        .orderBy(desc(imovelRecusadoAvisos.recusadoEm))
    ).filter(aviso => recusaAindaVisivel(aviso.recusadoEm, agora));
    return [
      ...avisos.map(aviso => ({
        id: -aviso.id,
        slug: "",
        titulo: aviso.titulo,
        descricao: null,
        tipo: "",
        status: "disponivel" as const,
        preco: "0",
        quartos: null,
        banheiros: null,
        vagas: null,
        areaM2: null,
        bairro: null,
        cidade: "",
        estado: null,
        fotos: "[]",
        publicadoSite: false,
        reviewStatus: "rejected",
        reviewedAt: aviso.recusadoEm,
        updatedAt: aviso.recusadoEm,
        endereco: null,
        createdByUserId: userId,
        createdAt: aviso.createdAt,
        createdByMe: true,
        excluido: true,
      })),
      ...visiveis.map(row => ({
        ...row,
        createdByMe: row.createdByUserId === userId,
        excluido: false,
      })),
    ];
  }),

  createProperty: protectedProcedure
    .input(propertyInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = requireBrokerContext(ctx.user);
      const [property] = await getDb()
        .insert(imoveis)
        .values({
          slug: propertySlug(
            input.titulo,
            `${userId}-${randomUUID().slice(0, 8)}`
          ),
          titulo: input.titulo,
          descricao: input.descricao,
          tipo: input.tipo,
          preco: input.preco.toFixed(2),
          quartos: input.quartos,
          banheiros: input.banheiros,
          vagas: input.vagas,
          areaM2: input.areaM2 == null ? undefined : input.areaM2.toFixed(2),
          endereco: input.endereco,
          bairro: input.bairro,
          cidade: input.cidade,
          estado: input.estado?.toUpperCase(),
          fotos: "[]",
          destaque: false,
          publicadoSite: false,
          createdByUserId: userId,
          reviewStatus: "pending",
        })
        .returning();
      // Pedido de 15/10: fotos vão para o Google Drive (Imóveis/<Título (nº)>/01 - Fotos).
      const fotos = await aplicarFotosImovel(property.id, input.fotos, userId);
      return { ...property, fotos: JSON.stringify(fotos) };
    }),

  // Item 3 (18/10): o corretor edita só o próprio imóvel; a edição volta para a
  // revisão do admin (sai do site até ser aprovada de novo).
  updateProperty: protectedProcedure
    .input(propertyUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const { userId } = requireBrokerContext(ctx.user);
      await imovelDoCorretor(input.id, userId);
      await getDb()
        .update(imoveis)
        .set({
          titulo: input.titulo,
          descricao: input.descricao ?? null,
          tipo: input.tipo,
          preco: input.preco.toFixed(2),
          quartos: input.quartos ?? null,
          banheiros: input.banheiros ?? null,
          vagas: input.vagas ?? null,
          areaM2: input.areaM2 == null ? null : input.areaM2.toFixed(2),
          endereco: input.endereco ?? null,
          bairro: input.bairro ?? null,
          cidade: input.cidade,
          estado: input.estado?.toUpperCase() ?? null,
          reviewStatus: "pending",
          reviewedAt: null,
          publicadoSite: false,
          updatedAt: new Date(),
        })
        .where(and(eq(imoveis.id, input.id), eq(imoveis.createdByUserId, userId)));
      await aplicarFotosImovel(input.id, input.fotos, userId);
      return { success: true } as const;
    }),

  // Item 3 (18/10): exclusão definitiva, só do próprio cadastro.
  deleteProperty: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const { userId } = requireBrokerContext(ctx.user);
      await imovelDoCorretor(input.id, userId);
      return excluirImovelDefinitivo(input.id, { avisarCorretor: false });
    }),

  // Portal do corretor (15/10): acompanhamento das etapas do CRM, somente
  // leitura e só dos leads vinculados a este corretor.
  leads: protectedProcedure.query(async ({ ctx }) => {
    const { brokerId } = requireBrokerContext(ctx.user);
    const rows = await getDb()
      .select({ id: leads.id, name: leads.name, city: leads.city, stage: leads.stage, updatedAt: leads.updatedAt })
      .from(leads)
      .where(and(eq(leads.brokerId, brokerId), isNull(leads.deletedAt)))
      .orderBy(desc(leads.updatedAt));
    return rows.map(row => ({ ...row, ...brokerLeadStage(row.stage) }));
  }),

  // Pedido de 15/10: comissões calculadas das obras dos leads deste corretor
  // (VGV × %), as mesmas do painel do admin — antes o portal só lia as manuais.
  obraCommissions: protectedProcedure.query(async ({ ctx }) => {
    const { brokerId } = requireBrokerContext(ctx.user);
    const linhas = await listarComissoesDeObras(brokerId);
    return linhas.map(l => ({
      obraId: l.obraId,
      obra: l.obra,
      cliente: l.cliente,
      vgv: l.vgv,
      percentual: l.calculo.percentual,
      valorCentavos: l.calculo.valorCentavos,
      pagoCentavos: l.calculo.pagoCentavos,
      saldoCentavos: l.calculo.saldoCentavos,
      status: l.calculo.status,
    }));
  }),

  commissions: protectedProcedure.query(async ({ ctx }) => {
    const { brokerId } = requireBrokerContext(ctx.user);
    return getDb()
      .select({
        id: operationalCommissions.id,
        businessType: operationalCommissions.businessType,
        property: operationalCommissions.property,
        amount: operationalCommissions.amount,
        percent: operationalCommissions.percent,
        status: operationalCommissions.status,
        dueDate: operationalCommissions.dueDate,
        paidAt: operationalCommissions.paidAt,
        createdAt: operationalCommissions.createdAt,
      })
      .from(operationalCommissions)
      .where(
        and(
          eq(operationalCommissions.brokerId, brokerId),
          eq(operationalCommissions.beneficiary, "corretor")
        )
      )
      .orderBy(asc(operationalCommissions.dueDate));
  }),
});
