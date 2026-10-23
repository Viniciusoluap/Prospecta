// Lote 23/10, etapa 3 — "Localização exata" da obra → imóvel vinculado → Mapa
// Operacional. Gêmeo em Grupo-Santa-Fe/web/src/lib/obras/localizacao.ts.
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { constructionProjects, imoveis } from "../drizzle/schema.js";
import { coordenadasSalvas, imovelDaObra, normalizarCoordenadas, type Coordenadas } from "../shared/obra-localizacao.js";
import { adminProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";

async function obraOuErro(projectId: number) {
  const [obra] = await getDb().select({ id: constructionProjects.id, title: constructionProjects.title, address: constructionProjects.address, city: constructionProjects.city, state: constructionProjects.state, imovelId: constructionProjects.imovelId })
    .from(constructionProjects).where(eq(constructionProjects.id, projectId)).limit(1);
  if (!obra) throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada" });
  return obra;
}

export async function obterLocalizacaoObra(projectId: number) {
  const obra = await obraOuErro(projectId);
  if (!obra.imovelId) return { imovelId: null, imovelTitulo: null, coords: null };
  const [im] = await getDb().select({ id: imoveis.id, titulo: imoveis.titulo, latitude: imoveis.latitude, longitude: imoveis.longitude }).from(imoveis).where(eq(imoveis.id, obra.imovelId)).limit(1);
  if (!im) return { imovelId: null, imovelTitulo: null, coords: null };
  return { imovelId: im.id, imovelTitulo: im.titulo, coords: coordenadasSalvas(im.latitude, im.longitude) };
}

/**
 * Grava o ponto da obra. Com imóvel já vinculado, só atualiza latitude/longitude
 * dele (endereço, preço, publicação e demais dados do imóvel ficam como estão).
 * Sem vínculo, cria um imóvel não publicado e o vincula — no máximo um por obra
 * (vínculo condicional + índice único; a corrida perdedora apaga o imóvel recém-criado).
 * `coords = null` remove o ponto do mapa, mas mantém o vínculo.
 */
export async function salvarLocalizacaoObra(projectId: number, entrada: Coordenadas | null, userId: number | null) {
  const coords = entrada ? normalizarCoordenadas(entrada) : null;
  const obra = await obraOuErro(projectId);
  const db = getDb();
  const ponto = { latitude: coords ? coords.lat.toFixed(7) : null, longitude: coords ? coords.lng.toFixed(7) : null, updatedAt: new Date() };
  if (obra.imovelId) {
    await db.update(imoveis).set(ponto).where(eq(imoveis.id, obra.imovelId));
    return { imovelId: obra.imovelId, criado: false, coords };
  }
  if (!coords) return { imovelId: null, criado: false, coords: null };
  const dados = imovelDaObra({ id: obra.id, titulo: obra.title, endereco: obra.address, cidade: obra.city, estado: obra.state });
  const [novo] = await db.insert(imoveis).values({
    ...dados,
    ...ponto,
    slug: `obra-${obra.id}-${randomBytes(4).toString("hex")}`,
    tipo: "casa",
    status: "reservado",
    preco: "0",
    destaque: false,
    publicadoSite: false,
    publicadoZap: false,
    publicadoOlx: false,
    publicadoViva: false,
    publicadoChavesNaMao: false,
    reviewStatus: "approved",
    createdByUserId: userId,
  }).returning({ id: imoveis.id });
  const vinculado = await db.update(constructionProjects).set({ imovelId: novo.id, updatedAt: new Date() })
    .where(and(eq(constructionProjects.id, projectId), isNull(constructionProjects.imovelId))).returning({ id: constructionProjects.id });
  if (vinculado.length) return { imovelId: novo.id, criado: true, coords };
  // Outra gravação vinculou um imóvel antes: descarta o recém-criado e atualiza o vencedor.
  await db.delete(imoveis).where(eq(imoveis.id, novo.id));
  return salvarLocalizacaoObra(projectId, coords, userId);
}

const coordsInput = z.object({ lat: z.number(), lng: z.number() }).nullable();

export const obraLocalizacaoRouter = router({
  obter: adminProcedure.input(z.object({ projectId: z.number().int().positive() })).query(({ input }) => obterLocalizacaoObra(input.projectId)),
  salvar: adminProcedure
    .input(z.object({ projectId: z.number().int().positive(), coords: coordsInput }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await salvarLocalizacaoObra(input.projectId, input.coords, ctx.user.id);
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message });
      }
    }),
});
