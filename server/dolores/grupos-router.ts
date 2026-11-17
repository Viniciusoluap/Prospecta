// EPIC-025 (Dolores, etapa 4) — rotas `dolores.grupos.*`: cadastro dos grupos de clientes, configuração da classificação e
// pendências de classificação. SÓ o administrador (PAPEL), conferido de novo em cada procedimento (o adminProcedure só confere
// o MÓDULO). Regras:
// - só grupos cadastrados e ATIVOS são lidos; nada é excluído (desativa-se); o id do grupo e a instância não mudam;
// - nada aqui envia, responde ou reage em grupo: da Evolution só se LÊ a lista de grupos e os participantes (para conferir o
//   @lid da Dolores). A única fala em grupo é a do webhook quando ela é marcada (marcacao.ts), com os interruptores daqui;
// - o nome do grupo no WhatsApp é texto de terceiro: aparece sanitizado, só para o administrador escolher;
// - classificar pela tela passa pelas MESMAS travas do webhook (interruptores, tetos, limite com folga do dono).
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { constructionProjects, leads } from "../../drizzle/schema.js";
import { doloresGrupos, doloresGruposConfig } from "../../drizzle/schema-dolores-grupos.js";
import { jidDeGrupoValido } from "../../shared/dolores/grupos.js";
import { textoDeDado, umaLinha } from "../../shared/dolores/fila.js";
import { INSTANCIA_DOLORES } from "../../shared/dolores/whatsapp.js";
import { listarGruposEvolution, participantesDoGrupoEvolution } from "../_core/evolution.js";
import { doloresMarcacoesConfig, doloresMarcacoesGrupo } from "../../drizzle/schema-dolores-marcacoes.js";
import { LIMITES_MARCACOES, lidValido } from "../../shared/dolores/marcacao.js";
import { ehNumeroDoDono } from "../../shared/dolores/whatsapp.js";
import { CONFIG_MARCACOES_PADRAO, lerConfigMarcacoes, marcacoesRecentes } from "./marcacao.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { classificarPendentes } from "./classificacao.js";
import { lerConfigWhatsapp } from "./consumo.js";
import { CONFIG_GRUPOS_PADRAO, lerConfigGrupos, listarGruposParaTela, pendenciasDeClassificacao } from "./grupos.js";
import { credencialDaClassificacao } from "./whatsapp.js";

/** adminProcedure confere o módulo; aqui vale o PAPEL: só admin. */
const soAdmin = adminProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador cadastra os grupos da Dolores." });
  return next();
});

const SEM_MIGRACAO = "Grupos da Dolores indisponíveis: a migração 0126 ainda não foi aplicada.";
const SEM_MIGRACAO_0129 = "Resposta quando marcada indisponível: a migração 0129 ainda não foi aplicada.";
const semMigracao0129 = (e: unknown): never => {
  if (e instanceof TRPCError) throw e;
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEM_MIGRACAO_0129 });
};
const limite = (k: keyof typeof LIMITES_MARCACOES) => z.number().int().min(LIMITES_MARCACOES[k].min).max(LIMITES_MARCACOES[k].max);

/**
 * Etapa 4b — confere o @lid da Dolores pela lista de participantes de um grupo cadastrado (Evolution, só leitura): o participante
 * cujo número é EXATAMENTE o número conectado e confirmado da Dolores. Grava o @lid junto com o número para o qual ele vale.
 * Sem número confirmado, sem @lid na lista ou sem o número dela: não grava nada (as menções por @lid continuam sem contar).
 */
async function conferirLid(grupoId: number, userId: number): Promise<{ conferido: boolean; motivo: string }> {
  const cfg = await lerConfigWhatsapp().catch(() => null);
  if (!cfg?.instancia || cfg.statusConexao !== "conectado" || !cfg.numeroDolores) return { conferido: false, motivo: "a conexão da Dolores ainda não foi confirmada" };
  const [g] = await getDb().select().from(doloresGrupos).where(eq(doloresGrupos.id, grupoId)).limit(1);
  if (!g || !g.ativo || g.instancia !== cfg.instancia) return { conferido: false, motivo: "grupo não cadastrado ou desativado" };
  const { configEvolution } = await import("../whatsapp-router.js");
  const evo = await configEvolution();
  if (!evo) return { conferido: false, motivo: "servidor do WhatsApp (Evolution) não configurado" };
  let lista: Awaited<ReturnType<typeof participantesDoGrupoEvolution>>;
  try { lista = await participantesDoGrupoEvolution(evo, cfg.instancia, g.grupoJid); }
  catch { return { conferido: false, motivo: "a Evolution não listou os participantes agora" }; }
  const dela = lista.filter(p => p.numero && ehNumeroDoDono(p.numero, cfg.numeroDolores));
  if (!dela.length) return { conferido: false, motivo: "o número da Dolores não apareceu na lista de participantes" };
  const lids = Array.from(new Set(dela.map(p => p.lid).filter(lidValido)));
  if (lids.length !== 1) return { conferido: false, motivo: lids.length ? "mais de um @lid para o número da Dolores (não gravado)" : "este grupo não usa @lid (as menções vêm pelo número)" };
  await getDb().update(doloresMarcacoesConfig).set({ lidDolores: lids[0], lidDoNumero: cfg.numeroDolores, lidConferidoEm: new Date(), atualizadoEm: new Date(), atualizadoPor: userId })
    .where(eq(doloresMarcacoesConfig.id, 1));
  return { conferido: true, motivo: "@lid da Dolores conferido" };
}
const semMigracao = (e: unknown): never => {
  if (e instanceof TRPCError) throw e;
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEM_MIGRACAO });
};

/** Rótulo do administrador: uma linha, sem invisíveis nem colchetes. */
const rotulo = z.string().trim().min(2).max(120).transform(s => textoDeDado(umaLinha(s, 120), 120))
  .refine(s => s.length >= 2, "Rótulo vazio depois de limpar caracteres inválidos.");
const id32 = z.number().int().positive().max(2_147_483_647);
const vinculo = { leadId: id32.nullable().optional(), obraId: id32.nullable().optional() };

async function conferirVinculo(leadId: number | null | undefined, obraId: number | null | undefined) {
  if (leadId && obraId) throw new TRPCError({ code: "BAD_REQUEST", message: "Ligue o grupo a um cliente OU a uma obra, não aos dois." });
  const db = getDb();
  if (leadId) {
    const [l] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, leadId), isNull(leads.deletedAt))).limit(1);
    if (!l) throw new TRPCError({ code: "BAD_REQUEST", message: `Cliente #${leadId} não encontrado no CRM.` });
  }
  if (obraId) {
    const [o] = await db.select({ id: constructionProjects.id }).from(constructionProjects).where(eq(constructionProjects.id, obraId)).limit(1);
    if (!o) throw new TRPCError({ code: "BAD_REQUEST", message: `Obra #${obraId} não encontrada.` });
  }
}

async function instanciaDaDolores(): Promise<string> {
  const c = await lerConfigWhatsapp().catch(() => null);
  return c?.instancia || INSTANCIA_DOLORES;
}

// QA E4 (achado 1, FKs): "dolores_acoes.autor_user_id" é RESTRICT (só a usuária Dolores é autora). Gravar ali o admin da tela
// impediria excluir esse usuário depois (Configurações › Usuários). O admin vai no resumo (sem FK); a autora fica vazia.
const auditar = (userId: number, funcao: string, grupoId: number | null, resumo: Record<string, unknown>) =>
  registrarAcao({ funcao, resultado: "ok", motivo: null, autorUserId: null, canal: "tela", pedidoId: `tela:grupos:${grupoId ?? "novo"}`, resumo: { grupoId, porUserId: userId, ...resumo } });

export const gruposRouter = router({
  /** Grupos cadastrados (com contagens), configuração e pendências de classificação. Sem texto de mensagem. */
  listar: soAdmin.query(async () => {
    try {
      const [grupos, config, pendencias] = await Promise.all([listarGruposParaTela(), lerConfigGrupos(), pendenciasDeClassificacao(50)]);
      return {
        grupos, pendencias: pendencias.map(p => ({ ...p, nome: p.nome ? textoDeDado(p.nome, 120) : null, confianca: p.confianca != null ? Number(p.confianca) : null })),
        config: { ...CONFIG_GRUPOS_PADRAO, ...config },
      };
    } catch (e) { return semMigracao(e); }
  }),

  /** Grupos em que o número da Dolores está, pela Evolution (só leitura), marcando os já cadastrados. */
  gruposDoWhatsapp: soAdmin.query(async () => {
    const { configEvolution } = await import("../whatsapp-router.js");
    const evo = await configEvolution();
    if (!evo) throw new TRPCError({ code: "BAD_REQUEST", message: "Servidor do WhatsApp (Evolution) não configurado: Integrações › WhatsApp." });
    const instancia = await instanciaDaDolores();
    let lista: Awaited<ReturnType<typeof listarGruposEvolution>>;
    try { lista = await listarGruposEvolution(evo, instancia); }
    catch { throw new TRPCError({ code: "BAD_REQUEST", message: "A Evolution não listou os grupos agora. Confira a conexão da Dolores ou digite o id do grupo." }); }
    const cadastrados = await getDb().select({ jid: doloresGrupos.grupoJid }).from(doloresGrupos).where(eq(doloresGrupos.instancia, instancia)).catch(() => []);
    const ja = new Set(cadastrados.map(c => c.jid));
    return lista.filter(g => jidDeGrupoValido(g.id)).map(g => ({
      grupoJid: g.id, nomeNoWhatsapp: g.nome ? textoDeDado(g.nome, 80) : null, participantes: g.participantes, cadastrado: ja.has(g.id),
    }));
  }),

  cadastrar: soAdmin.input(z.object({ grupoJid: z.string().trim().max(80), nome: rotulo, ...vinculo }).strict()).mutation(async ({ ctx, input }) => {
    if (!jidDeGrupoValido(input.grupoJid)) throw new TRPCError({ code: "BAD_REQUEST", message: "Id de grupo inválido: deve terminar em @g.us (ex.: 120363000000000000@g.us)." });
    await conferirVinculo(input.leadId, input.obraId);
    const instancia = await instanciaDaDolores();
    let linha: { id: number } | undefined;
    try {
      [linha] = await getDb().insert(doloresGrupos).values({
        instancia, grupoJid: input.grupoJid, nome: input.nome, leadId: input.leadId ?? null, obraId: input.obraId ?? null,
        criadoPorUserId: ctx.user.id, atualizadoPorUserId: ctx.user.id,
      }).onConflictDoNothing().returning({ id: doloresGrupos.id });
    } catch (e) { return semMigracao(e); }
    if (!linha) throw new TRPCError({ code: "CONFLICT", message: "Esse grupo já está cadastrado (reative-o na lista, se estiver desativado)." });
    await auditar(ctx.user.id, "cadastrar_grupo", linha.id, { leadId: input.leadId ?? null, obraId: input.obraId ?? null });
    return { id: linha.id };
  }),

  /** Rótulo, vínculo e ativo/inativo. Nunca exclui; o id do grupo e a instância não mudam (gatilho da 0126). */
  atualizar: soAdmin.input(z.object({ id: id32, nome: rotulo.optional(), ativo: z.boolean().optional(), ...vinculo }).strict()).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const [g] = await db.select().from(doloresGrupos).where(eq(doloresGrupos.id, input.id)).limit(1).catch(semMigracao);
    if (!g) throw new TRPCError({ code: "NOT_FOUND", message: `Grupo ${input.id} não cadastrado.` });
    const leadId = input.leadId !== undefined ? input.leadId : g.leadId;
    const obraId = input.obraId !== undefined ? input.obraId : g.obraId;
    if (input.leadId !== undefined || input.obraId !== undefined) await conferirVinculo(leadId, obraId);
    await db.update(doloresGrupos).set({
      ...(input.nome !== undefined ? { nome: input.nome } : {}), ...(input.ativo !== undefined ? { ativo: input.ativo } : {}),
      leadId, obraId, atualizadoEm: new Date(), atualizadoPorUserId: ctx.user.id,
    }).where(eq(doloresGrupos.id, g.id));
    await auditar(ctx.user.id, "atualizar_grupo", g.id, { ativo: input.ativo ?? g.ativo, leadId, obraId, rotuloMudou: input.nome !== undefined });
    return { ok: true };
  }),

  /** Configuração da classificação e dos tetos (a classificação nasce DESLIGADA). */
  salvarConfig: soAdmin.input(z.object({
    classificacaoLigada: z.boolean().optional(),
    tetoClassificacoesDia: z.number().int().min(0).max(1000).optional(),
    tetoClassificacoesGrupoDia: z.number().int().min(0).max(200).optional(),
    maxMensagensGrupoDia: z.number().int().min(1).max(5000).optional(),
    tamanhoMaximoMb: z.number().int().min(1).max(20).optional(),
    retencaoDias: z.number().int().min(1).max(365).optional(),
  }).strict()).mutation(async ({ ctx, input }) => {
    const { tamanhoMaximoMb, ...resto } = input;
    const dados = { ...resto, ...(tamanhoMaximoMb !== undefined ? { tamanhoMaximoBytes: tamanhoMaximoMb * 1_048_576 } : {}) };
    const r = await getDb().update(doloresGruposConfig).set({ ...dados, atualizadoEm: new Date(), atualizadoPor: ctx.user.id })
      .where(eq(doloresGruposConfig.id, 1)).returning({ id: doloresGruposConfig.id }).catch(semMigracao);
    if (!r.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEM_MIGRACAO });
    await auditar(ctx.user.id, "configurar_grupos", null, dados);
    return lerConfigGrupos();
  }),

  /**
   * Etapa 4b — responder quando marcada: configuração (interruptor geral, tetos, janela), o interruptor de cada grupo e as
   * últimas marcações (pergunta filtrada, resposta, fora de escopo). O que ela escreve no grupo é lido por todos os participantes.
   */
  marcacoes: soAdmin.input(z.object({ grupoId: id32.optional() }).strict().optional()).query(async ({ input }) => {
    try {
      const [config, porGrupo, lista] = await Promise.all([
        lerConfigMarcacoes(), getDb().select().from(doloresMarcacoesGrupo), marcacoesRecentes(input?.grupoId ?? null, 50),
      ]);
      const numero = (await lerConfigWhatsapp().catch(() => null))?.numeroDolores ?? null;
      return {
        config: {
          responderLigado: config.responderLigado, tetoGrupoDia: config.tetoGrupoDia, tetoRemetenteHora: config.tetoRemetenteHora,
          janelaFrescorSegundos: config.janelaFrescorSegundos,
          // o @lid não é telefone, mas só o fim aparece na tela
          lid: config.lidDolores && config.lidDoNumero === numero ? { final: config.lidDolores.replace(/@lid$/, "").slice(-4), conferidoEm: config.lidConferidoEm } : null,
        },
        grupos: porGrupo.map(g => ({ grupoId: g.grupoId, ligado: g.responderLigado })),
        marcacoes: lista.map(m => ({ ...m, grupo: textoDeDado(m.grupo, 120) })),
      };
    } catch (e) { return semMigracao0129(e); }
  }),

  /** Interruptor geral e tetos (o interruptor nasce DESLIGADO). */
  salvarMarcacoes: soAdmin.input(z.object({
    responderLigado: z.boolean().optional(), tetoGrupoDia: limite("tetoGrupoDia").optional(), tetoRemetenteHora: limite("tetoRemetenteHora").optional(),
    janelaFrescorSegundos: limite("janelaFrescorSegundos").optional(),
  }).strict()).mutation(async ({ ctx, input }) => {
    const r = await getDb().update(doloresMarcacoesConfig).set({ ...input, atualizadoEm: new Date(), atualizadoPor: ctx.user.id })
      .where(eq(doloresMarcacoesConfig.id, 1)).returning({ id: doloresMarcacoesConfig.id }).catch(semMigracao0129);
    if (!r.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEM_MIGRACAO_0129 });
    await auditar(ctx.user.id, "configurar_marcacoes", null, input);
    const c = await lerConfigMarcacoes();
    return { ...CONFIG_MARCACOES_PADRAO, ...c, lidDolores: undefined, lidDoNumero: undefined };
  }),

  /** Interruptor de UM grupo cadastrado. Ao ligar, tenta conferir o @lid da Dolores por esse grupo (só leitura na Evolution). */
  ligarMarcacaoGrupo: soAdmin.input(z.object({ grupoId: id32, ligado: z.boolean() }).strict()).mutation(async ({ ctx, input }) => {
    const [g] = await getDb().select({ id: doloresGrupos.id, ativo: doloresGrupos.ativo }).from(doloresGrupos).where(eq(doloresGrupos.id, input.grupoId)).limit(1).catch(semMigracao);
    if (!g) throw new TRPCError({ code: "NOT_FOUND", message: `Grupo ${input.grupoId} não cadastrado.` });
    if (input.ligado && !g.ativo) throw new TRPCError({ code: "BAD_REQUEST", message: "Reative o grupo antes de ligar a resposta quando marcada." });
    await getDb().insert(doloresMarcacoesGrupo).values({ grupoId: g.id, responderLigado: input.ligado, atualizadoPor: ctx.user.id })
      .onConflictDoUpdate({ target: doloresMarcacoesGrupo.grupoId, set: { responderLigado: input.ligado, atualizadoEm: new Date(), atualizadoPor: ctx.user.id } })
      .catch(semMigracao0129);
    await auditar(ctx.user.id, "ligar_marcacao_grupo", g.id, { ligado: input.ligado });
    const lid = input.ligado ? await conferirLid(g.id, ctx.user.id).catch(() => ({ conferido: false, motivo: "não consegui conferir o @lid agora" })) : null;
    return { ok: true, lid };
  }),

  /** Confere de novo o @lid da Dolores por um grupo cadastrado (só leitura na Evolution). */
  conferirLidDolores: soAdmin.input(z.object({ grupoId: id32 }).strict()).mutation(async ({ ctx, input }) => {
    const r = await conferirLid(input.grupoId, ctx.user.id).catch(semMigracao0129);
    await auditar(ctx.user.id, "conferir_lid_dolores", input.grupoId, { conferido: r.conferido });
    return r;
  }),

  /**
   * Classifica agora até 5 documentos pendentes, pelas MESMAS travas do webhook (classificação ligada, pausa, interruptor da
   * IA, chave, modelo da função, teto do dia, limite mensal com folga). Não envia nada a ninguém.
   */
  classificarPendentes: soAdmin.input(z.object({ maximo: z.number().int().min(1).max(5).default(3) }).strict().optional()).mutation(async ({ input }) => {
    const contagem = await classificarPendentes({ maximo: input?.maximo ?? 3, prazoFinal: Date.now() + 45_000, obterCredencial: credencialDaClassificacao, canal: "tela" })
      .catch(semMigracao);
    return { contagem };
  }),
});
