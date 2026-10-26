// Lote 23/10, etapa 3 — "Localização exata" da obra → imóvel vinculado → Mapa
// Operacional. Gêmeo em Grupo-Santa-Fe/web/src/lib/obras/localizacao.ts.
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, isNotNull, isNull, like } from "drizzle-orm";
import { z } from "zod";
import { constructionPci, constructionProjects, imoveis, leads } from "../drizzle/schema.js";
import { coordenadasDaPci, coordenadasSalvas, imovelDaObra, normalizarCoordenadas, vgvDaObra, type Coordenadas } from "../shared/obra-localizacao.js";
import { adminProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";

async function obraOuErro(projectId: number) {
  const [obra] = await getDb().select({ id: constructionProjects.id, title: constructionProjects.title, address: constructionProjects.address, city: constructionProjects.city, state: constructionProjects.state, imovelId: constructionProjects.imovelId, vgv: constructionProjects.vgv, leadId: constructionProjects.leadId })
    .from(constructionProjects).where(eq(constructionProjects.id, projectId)).limit(1);
  if (!obra) throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada" });
  return obra;
}

/** Pedido de 25/10 (noite): preço do imóvel gerado = VGV da obra (mesma fonte do Mapa Operacional); sem VGV, "0". */
async function precoDoImovelGerado(obra: { leadId?: number | null; vgv?: string | null }): Promise<string> {
  let simulationValue: string | null = null;
  if (obra.leadId != null) {
    const [l] = await getDb().select({ v: leads.simulationValue }).from(leads).where(eq(leads.id, obra.leadId)).limit(1);
    simulationValue = l?.v ?? null;
  }
  const v = vgvDaObra({ leadId: obra.leadId, simulationValue, vgv: obra.vgv });
  return v && Number(v) > 0 ? String(v) : "0";
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
    preco: await precoDoImovelGerado(obra),
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
 * status comercial, fotos e qualquer título posteriormente editado pela equipe.
 * Pedido de 25/10 (noite): preço ainda zerado passa a ser o VGV da obra. */
export async function sincronizarImovelGeradoDaObra(projectId: number, tituloAnterior: string) {
  const obra = await obraOuErro(projectId);
  if (!obra.imovelId) return;
  const [imovel] = await getDb().select({
    id: imoveis.id, slug: imoveis.slug, titulo: imoveis.titulo, preco: imoveis.preco,
  }).from(imoveis).where(eq(imoveis.id, obra.imovelId)).limit(1);
  if (!imovel?.slug.startsWith(`obra-${projectId}-`)) return;
  const dados = imovelDaObra({ id: obra.id, titulo: obra.title, endereco: obra.address, cidade: obra.city, estado: obra.state });
  const preco = Number(imovel.preco ?? 0) > 0 ? null : await precoDoImovelGerado(obra);
  await getDb().update(imoveis).set({
    endereco: dados.endereco,
    cidade: dados.cidade,
    estado: dados.estado,
    ...(preco && preco !== "0" ? { preco } : {}),
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
    tipo: "casa", status: "reservado", preco: await precoDoImovelGerado(obra),
    destaque: false, publicadoSite: false, reviewStatus: "approved",
    createdByUserId: userId,
  }).returning({ id: imoveis.id });
  const vinculado = await db.update(constructionProjects).set({ imovelId: novo.id, updatedAt: new Date() })
    .where(and(eq(constructionProjects.id, projectId), isNull(constructionProjects.imovelId))).returning({ id: constructionProjects.id });
  if (!vinculado.length) await db.delete(imoveis).where(eq(imoveis.id, novo.id));
}

/**
 * Pedido de 25/10 (noite): imóveis já gerados de obra (slug `obra-<id>-`) sem endereço, cidade, UF
 * ou preço passam a ter os da obra (preço = VGV). Nunca toca anúncio manual nem valor já preenchido.
 * `previaReconciliacao` só lista; `reconciliarImoveisGeradosDeObras` grava (idempotente).
 */
export async function previaReconciliacao() {
  const db = getDb();
  const [obras, gerados] = await Promise.all([
    db.select({
      id: constructionProjects.id, title: constructionProjects.title, address: constructionProjects.address, city: constructionProjects.city,
      state: constructionProjects.state, vgv: constructionProjects.vgv, leadId: constructionProjects.leadId, imovelId: constructionProjects.imovelId,
      simulationValue: leads.simulationValue,
    }).from(constructionProjects).leftJoin(leads, eq(leads.id, constructionProjects.leadId)).where(isNotNull(constructionProjects.imovelId)),
    db.select({ id: imoveis.id, slug: imoveis.slug, titulo: imoveis.titulo, endereco: imoveis.endereco, cidade: imoveis.cidade, estado: imoveis.estado, preco: imoveis.preco })
      .from(imoveis).where(like(imoveis.slug, "obra-%")),
  ]);
  const porId = new Map(gerados.map(i => [i.id, i]));
  const mudancas: { imovelId: number; obraId: number; titulo: string; antes: Record<string, string | null>; depois: Record<string, string> }[] = [];
  for (const o of obras) {
    const im = o.imovelId ? porId.get(o.imovelId) : undefined;
    if (!im || !im.slug.startsWith(`obra-${o.id}-`)) continue;
    const dados = imovelDaObra({ id: o.id, titulo: o.title, endereco: o.address, cidade: o.city, estado: o.state });
    const vgv = vgvDaObra(o);
    const depois: Record<string, string> = {};
    if (!im.endereco?.trim() && dados.endereco) depois.endereco = dados.endereco;
    if ((!im.cidade?.trim() || im.cidade.trim() === "Não informada") && dados.cidade !== "Não informada") depois.cidade = dados.cidade;
    if (!im.estado?.trim() && dados.estado) depois.estado = dados.estado;
    if (!(Number(im.preco ?? 0) > 0) && vgv && Number(vgv) > 0) depois.preco = String(vgv);
    if (!Object.keys(depois).length) continue;
    const antes = Object.fromEntries(Object.keys(depois).map(k => [k, (im as Record<string, unknown>)[k] as string | null]));
    mudancas.push({ imovelId: im.id, obraId: o.id, titulo: im.titulo, antes, depois });
  }
  return mudancas;
}

export async function reconciliarImoveisGeradosDeObras() {
  const mudancas = await previaReconciliacao();
  for (const m of mudancas) {
    // Condição repetida no UPDATE: só grava se o imóvel ainda for o gerado desta obra.
    await getDb().update(imoveis).set({ ...m.depois, updatedAt: new Date() })
      .where(and(eq(imoveis.id, m.imovelId), like(imoveis.slug, `obra-${m.obraId}-%`)));
  }
  return { atualizados: mudancas.length, mudancas };
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
