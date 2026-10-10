import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { imoveis, operationalCommissions } from "../drizzle/schema.js";
import { protectedProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";
import { requireBrokerContext } from "./profile-context.js";
import { storagePut } from "./storage.js";

const propertyInput = z.object({
  titulo: z.string().trim().min(2).max(255),
  descricao: z.string().trim().max(5000).optional(),
  tipo: z.string().trim().min(1).max(100),
  preco: z.number().nonnegative(),
  quartos: z.number().int().nonnegative().optional(),
  banheiros: z.number().int().nonnegative().optional(),
  vagas: z.number().int().nonnegative().optional(),
  areaM2: z.number().nonnegative().optional(),
  endereco: z.string().trim().max(1000).optional(),
  bairro: z.string().trim().max(100).optional(),
  cidade: z.string().trim().min(1).max(100),
  estado: z.string().trim().length(2).optional(),
  fotos: z.array(z.string().url()).max(20).default([]),
});

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
    return rows.map(row => ({
      ...row,
      createdByMe: row.createdByUserId === userId,
    }));
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
          fotos: JSON.stringify(input.fotos),
          destaque: false,
          publicadoSite: false,
          publicadoZap: false,
          publicadoOlx: false,
          publicadoViva: false,
          publicadoChavesNaMao: false,
          createdByUserId: userId,
          reviewStatus: "pending",
        })
        .returning();
      return property;
    }),

  uploadPropertyImage: protectedProcedure
    .input(
      z.object({
        fileName: z.string().trim().min(1).max(255),
        mimeType: imageMime,
        base64: z.string().min(8),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId } = requireBrokerContext(ctx.user);
      const buffer = Buffer.from(input.base64, "base64");
      if (!isValidPropertyImage(buffer, input.mimeType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Envie JPG, PNG ou WebP válido de até 8 MiB",
        });
      }
      const extension =
        input.mimeType === "image/png"
          ? "png"
          : input.mimeType === "image/webp"
            ? "webp"
            : "jpg";
      return storagePut(
        `corretores/imoveis/${userId}/${randomUUID()}.${extension}`,
        buffer,
        input.mimeType
      );
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
