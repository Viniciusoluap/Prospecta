// Lote 23/10, etapa 3 — "Localização exata" da obra → imóvel vinculado → Mapa
// Operacional. Gêmeo em Grupo-Santa-Fe/web/src/lib/obras/localizacao.ts.
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { constructionPci, constructionProjects, imoveis } from "../drizzle/schema.js";
import { coordenadasDaPci, coordenadasSalvas, imovelDaObra, normalizarCoordenadas, type Coordenadas } from "../shared/obra-localizacao.js";
import { adminProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";

async function obraOuErro(projectId: number) {
  const [obra] = await getDb().select({ id: constructionProjects.id, title: constructionProjects.title, address: constructionProjects.address, city: constructionProjects.city, state: constructionProjects.state, imovelId: constructionProjects.imovelId })
    .from(constructionProjects).where(eq(constructionProjects.id, projectId)).limit(1);
  if (!obra) throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada" });
  return obra;
}

/** Ponto da identificação da PCI da CAIXA vinculada à obra (quando legível). */
async function pontoDaPci(projectId: number) {
  const [pci] = await getDb().select({ parsed: constructionPci.parsed }).from(constructionPci).where(eq(constructionPci.projectId, projectId)).limit(1);
  const id = (pci?.parsed as { identificacao?: { latitude?: unknown; longitude?: unknown } } | undefined)?.identificacao;
  return id ? coordenadasDaPci(id.latitude, id.longitude) : null;
}

/**
 * `coords` = ponto salvo no imóvel vinculado. Sem ele, `pontoPci` traz o ponto da
 * PCI (é o que o Mapa Operacional mostra) para a tela exibir como referência.
 */
export async function obterLocalizacaoObra(projectId: number) {
  const obra = await obraOuErro(projectId);
  const [im] = obra.imovelId
    ? await getDb().select({ id: imoveis.id, titulo: imoveis.titulo, latitude: imoveis.latitude, longitude: imoveis.longitude }).from(imoveis).where(eq(imoveis.id, obra.imovelId)).limit(1)
    : [];
  const coords = im ? coordenadasSalvas(im.latitude, im.longitude) : null;
  return { imovelId: im?.id ?? null, imovelTitulo: im?.titulo ?? null, coords, pontoPci: coords ? null : await pontoDaPci(projectId) };
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

/** Só espelha campos da obra em imóveis que esta rotina criou; preserva anúncios manuais,
 * status comercial, preço, fotos e qualquer título posteriormente editado pela equipe. */
export async function sincronizarImovelGeradoDaObra(projectId: number, tituloAnterior: string) {
  const obra = await obraOuErro(projectId);
  if (!obra.imovelId) return;
  const [imovel] = await getDb().select({
    id: imoveis.id, slug: imoveis.slug, titulo: imoveis.titulo,
  }).from(imoveis).where(eq(imoveis.id, obra.imovelId)).limit(1);
  if (!imovel?.slug.startsWith(`obra-${projectId}-`)) return;
  const dados = imovelDaObra({ id: obra.id, titulo: obra.title, endereco: obra.address, cidade: obra.city, estado: obra.state });
  await getDb().update(imoveis).set({
    endereco: dados.endereco,
    cidade: dados.cidade,
    estado: dados.estado,
    ...(imovel.titulo === `Obra — ${tituloAnterior}`.slice(0, 255) ? { titulo: dados.titulo } : {}),
    updatedAt: new Date(),
  }).where(eq(imoveis.id, imovel.id));
}

/** Novos cadastros/edições com endereço passam ao catálogo interno, sem publicação.
 * Obras antigas são mostradas pela vista de leitura até reconciliação aprovada. */
export async function garantirImovelCatalogoObra(projectId: number, userId: number | null) {
  const obra = await obraOuErro(projectId);
  if (!obra.address?.trim() || obra.imovelId) return;
  const dados = imovelDaObra({ id: obra.id, titulo: obra.title, endereco: obra.address, cidade: obra.city, estado: obra.state });
  const db = getDb();
  const [novo] = await db.insert(imoveis).values({
    ...dados,
    slug: `obra-${projectId}-${randomBytes(4).toString("hex")}`,
    tipo: "casa", status: "reservado", preco: "0",
    destaque: false, publicadoSite: false, reviewStatus: "approved",
    createdByUserId: userId,
  }).returning({ id: imoveis.id });
  const vinculado = await db.update(constructionProjects).set({ imovelId: novo.id, updatedAt: new Date() })
    .where(and(eq(constructionProjects.id, projectId), isNull(constructionProjects.imovelId))).returning({ id: constructionProjects.id });
  if (!vinculado.length) await db.delete(imoveis).where(eq(imoveis.id, novo.id));
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
