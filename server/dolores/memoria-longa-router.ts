// EPIC-027 C5 (memória de longo prazo) — rotas `dolores.memoriaLonga.*`: a tela "Memória da Dolores" (ver, buscar, criar, corrigir,
// arquivar e restaurar as lembranças permanentes). SÓ o administrador (PAPEL), conferido em cada procedimento ANTES de qualquer consulta
// (o adminProcedure só confere o MÓDULO). O texto passa pela MESMA regra da conversa (memoria-longa.ts#textoDaMemoria): segredo, dado
// bancário e link são recusados; CPF, telefone e e-mail ficam mascarados. "Apagar" = arquivar (fica o registro, com quem e quando).
// Toda criação/edição/arquivamento vai para a auditoria (dolores_acoes "memoria_longa", só número e categoria — nunca o texto).
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { constructionProjects, leads } from "../../drizzle/schema.js";
import { CATEGORIAS_MEMORIA, MAX_MEMORIAS_ATIVAS, MAX_TEXTO_MEMORIA, type CategoriaMemoria } from "../../shared/dolores/memoria-longa.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { getDb } from "../db.js";
import {
  FRASE_MEMORIA_CHEIA, atualizarMemoria, auditarMemoria, contarAtivas, inserirMemoria, lerMemoria, listarParaTela, memoriaIgualAtiva, mudarSituacao, textoDaMemoria,
} from "./memoria-longa.js";

/** adminProcedure confere o módulo; aqui vale o PAPEL: só admin (antes de qualquer leitura). */
const soAdmin = adminProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador vê e corrige a memória da Dolores." });
  return next();
});

const SEM_MIGRACAO = "Memória da Dolores indisponível: a migração 0149 ainda não foi aplicada.";
const semTabela = (e: unknown) => {
  for (let x: unknown = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++) if ((x as { code?: unknown }).code === "42P01") return true;
  return false;
};
/** Erro de banco → mensagem curta (tabela ausente → a migração); nada do texto vai para o log. */
async function noBanco<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof TRPCError) throw e;
    if (semTabela(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEM_MIGRACAO });
    console.error("[dolores/memoria-longa] falha na tela", e instanceof Error ? e.name : "erro");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não consegui gravar agora; nada mudou. Tente de novo." });
  }
}

const id32 = z.number().int().positive().max(2_147_483_647);
const categoria = z.enum(CATEGORIAS_MEMORIA);
const texto = z.string().max(MAX_TEXTO_MEMORIA * 2);
const vinculo = { leadId: id32.nullable().optional(), obraId: id32.nullable().optional() };

function textoOuRecusa(bruto: string): { texto: string; mascarou: boolean } {
  const r = textoDaMemoria(bruto);
  if (!r.ok) throw new TRPCError({ code: "BAD_REQUEST", message: r.motivo });
  return r;
}

async function conferirVinculo(leadId: number | null, obraId: number | null) {
  if (leadId && obraId) throw new TRPCError({ code: "BAD_REQUEST", message: "Ligue a lembrança a um cliente OU a uma obra, não aos dois." });
  if (leadId) {
    const [l] = await getDb().select({ id: leads.id }).from(leads).where(and(eq(leads.id, leadId), isNull(leads.deletedAt))).limit(1);
    if (!l) throw new TRPCError({ code: "BAD_REQUEST", message: `Cliente ${leadId} não encontrado no CRM (ou excluído).` });
  }
  if (obraId) {
    const [o] = await getDb().select({ id: constructionProjects.id }).from(constructionProjects).where(eq(constructionProjects.id, obraId)).limit(1);
    if (!o) throw new TRPCError({ code: "BAD_REQUEST", message: `Obra ${obraId} não encontrada.` });
  }
}

export const memoriaLongaRouter = router({
  listar: soAdmin.input(z.object({
    busca: z.string().max(100).optional(), categoria: categoria.optional(),
    situacao: z.enum(["ativa", "arquivada", "todas"]).default("ativa"), limite: z.number().int().min(1).max(300).default(100),
  }).strict()).query(({ input }) => noBanco(() => listarParaTela(input))),

  criar: soAdmin.input(z.object({ texto, categoria, ...vinculo }).strict()).mutation(({ ctx, input }) => noBanco(async () => {
    const { texto: t, mascarou } = textoOuRecusa(input.texto);
    const leadId = input.leadId ?? null;
    const obraId = input.obraId ?? null;
    await conferirVinculo(leadId, obraId);
    if (await memoriaIgualAtiva(t)) throw new TRPCError({ code: "CONFLICT", message: "Já existe uma lembrança ativa com esse mesmo texto." });
    if ((await contarAtivas()) >= MAX_MEMORIAS_ATIVAS) throw new TRPCError({ code: "BAD_REQUEST", message: FRASE_MEMORIA_CHEIA });
    const m = await inserirMemoria({ texto: t, categoria: input.categoria as CategoriaMemoria, leadId, obraId, origem: "tela", autor: ctx.user.id, agora: new Date() });
    await auditarMemoria({ resultado: "ok", motivo: "criada pela tela", canal: "tela", autor: ctx.user.id, memoriaId: m.id, resumo: { operacao: "criar", origem: "tela", categoria: m.categoria } });
    return { id: m.id, texto: m.texto, mascarou };
  })),

  editar: soAdmin.input(z.object({ id: id32, texto, categoria, ...vinculo }).strict()).mutation(({ ctx, input }) => noBanco(async () => {
    const atual = await lerMemoria(input.id);
    if (!atual) throw new TRPCError({ code: "NOT_FOUND", message: "Lembrança não encontrada." });
    const { texto: t, mascarou } = textoOuRecusa(input.texto);
    const leadId = input.leadId === undefined ? atual.leadId : input.leadId;
    const obraId = input.obraId === undefined ? atual.obraId : input.obraId;
    await conferirVinculo(leadId, obraId);
    if (atual.situacao === "ativa" && (await memoriaIgualAtiva(t, getDb(), atual.id))) throw new TRPCError({ code: "CONFLICT", message: "Já existe outra lembrança ativa com esse mesmo texto." });
    const ok = await atualizarMemoria(atual.id, { texto: t, categoria: input.categoria as CategoriaMemoria, leadId, obraId, por: ctx.user.id, agora: new Date(), antes: atual.texto });
    if (!ok) throw new TRPCError({ code: "CONFLICT", message: "A lembrança mudou enquanto você editava; recarregue e tente de novo." });
    await auditarMemoria({ resultado: "ok", motivo: "editada pela tela", canal: "tela", autor: ctx.user.id, memoriaId: atual.id, resumo: { operacao: "editar", origem: "tela", categoria: input.categoria } });
    return { id: atual.id, texto: t, mascarou };
  })),

  arquivar: soAdmin.input(z.object({ id: id32 }).strict()).mutation(({ ctx, input }) => noBanco(async () => {
    const ok = await mudarSituacao(input.id, "arquivada", { por: ctx.user.id, agora: new Date() });
    if (!ok) throw new TRPCError({ code: "CONFLICT", message: "Essa lembrança não está ativa (ou não existe)." });
    await auditarMemoria({ resultado: "ok", motivo: "arquivada pela tela", canal: "tela", autor: ctx.user.id, memoriaId: input.id, resumo: { operacao: "arquivar", origem: "tela" } });
    return { id: input.id, situacao: "arquivada" as const };
  })),

  restaurar: soAdmin.input(z.object({ id: id32 }).strict()).mutation(({ ctx, input }) => noBanco(async () => {
    const m = await lerMemoria(input.id);
    if (!m || m.situacao !== "arquivada") throw new TRPCError({ code: "CONFLICT", message: "Essa lembrança não está arquivada (ou não existe)." });
    if (await memoriaIgualAtiva(m.texto)) throw new TRPCError({ code: "CONFLICT", message: "Já existe uma lembrança ativa com esse mesmo texto." });
    if ((await contarAtivas()) >= MAX_MEMORIAS_ATIVAS) throw new TRPCError({ code: "BAD_REQUEST", message: FRASE_MEMORIA_CHEIA });
    const ok = await mudarSituacao(input.id, "ativa", { por: ctx.user.id, agora: new Date() });
    if (!ok) throw new TRPCError({ code: "CONFLICT", message: "A lembrança mudou; recarregue e tente de novo." });
    await auditarMemoria({ resultado: "ok", motivo: "restaurada pela tela", canal: "tela", autor: ctx.user.id, memoriaId: input.id, resumo: { operacao: "restaurar", origem: "tela" } });
    return { id: input.id, situacao: "ativa" as const };
  })),
});
