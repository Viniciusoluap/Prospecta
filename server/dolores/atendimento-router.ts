// EPIC-025 (Dolores, etapa 9) — configuração do atendimento pelo número da empresa (tRPC `dolores.atendimento.*`), SÓ do
// administrador por PAPEL (adminProcedure confere só o módulo). Campanhas de saudação (só admin cria/ativa; UMA ativa, garantido no
// banco), interruptores e tetos (tudo nasce desligado), textos dos avisos de ligação/áudio e as credenciais da Cloudflare (o token
// nunca volta: só os 4 últimos caracteres). Nada aqui devolve número completo, chave ou token.
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { whatsappAtendimentoConfig, whatsappCampanhas, whatsappSaudacoes } from "../../drizzle/schema-whatsapp-atendimento.js";
import { textoFixoInvalido } from "../../shared/dolores/roteamento.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { desligamentoDoAtendimentoPorFalha, limparPausaDoAtendimento } from "./atendimento.js";
import { registrarAcao } from "./auditoria.js";
import { lerConfigAtendimento } from "./roteamento.js";
import { removerCredencialCloudflare, salvarCredencialCloudflare, semSegredos, statusCloudflare } from "./transcricao.js";

const soAdmin = adminProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador configura o atendimento do WhatsApp da empresa." });
  return next();
});

const textoDaCampanha = z.string().trim().min(2).max(1000);
const textoDoAviso = z.string().trim().min(2).max(500);
function exigirTextoFixo(t: string, max: number) {
  const motivo = textoFixoInvalido(t, max);
  if (motivo) throw new TRPCError({ code: "BAD_REQUEST", message: `Texto recusado: ${motivo}.` });
}

async function situacao() {
  const db = getDb();
  const [config, campanhas, cloudflare, falha] = await Promise.all([
    lerConfigAtendimento(),
    db.select({
      id: whatsappCampanhas.id, nome: whatsappCampanhas.nome, empreendimento: whatsappCampanhas.empreendimento, texto: whatsappCampanhas.texto,
      ativa: whatsappCampanhas.ativa, atualizadoEm: whatsappCampanhas.atualizadoEm,
      saudacoes: sql<number>`(SELECT count(*) FROM ${whatsappSaudacoes} WHERE ${whatsappSaudacoes.campanhaId} = ${whatsappCampanhas.id} AND ${whatsappSaudacoes.situacao} = 'enviada')`.mapWith(Number),
    }).from(whatsappCampanhas).orderBy(desc(whatsappCampanhas.ativa), desc(whatsappCampanhas.id)).limit(100).catch(() => []),
    statusCloudflare().catch(() => ({ configurado: false, conta: null, token: null, modelo: "" })),
    desligamentoDoAtendimentoPorFalha().catch(() => null),
  ]);
  const { id: _id, ...resto } = config;
  return { config: resto, campanhas, cloudflare, desligadoPorFalha: falha };
}

const gravarConfig = async (dados: Partial<typeof whatsappAtendimentoConfig.$inferInsert>, userId: number) => {
  const r = await getDb().update(whatsappAtendimentoConfig).set({ ...dados, atualizadoEm: new Date(), atualizadoPor: userId })
    .where(eq(whatsappAtendimentoConfig.id, 1)).returning({ id: whatsappAtendimentoConfig.id }).catch(() => []);
  if (!r.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configuração ausente: a migração 0135 ainda não foi aplicada." });
};

export const atendimentoRouter = router({
  status: soAdmin.query(() => situacao()),

  salvarConfig: soAdmin.input(z.object({
    clienteLigado: z.boolean().optional(),
    clienteTetoDia: z.number().int().min(1).max(50).optional(),
    clienteTetoGlobalDia: z.number().int().min(1).max(2000).optional(),
    silencioHoras: z.number().int().min(1).max(72).optional(),
    saudacaoTetoDia: z.number().int().min(1).max(500).optional(),
    transcricaoLigada: z.boolean().optional(),
    transcricaoDuracaoMaxS: z.number().int().min(10).max(600).optional(),
    transcricaoTetoNumeroDia: z.number().int().min(1).max(100).optional(),
    transcricaoTetoGlobalDia: z.number().int().min(1).max(2000).optional(),
    avisoIntervaloHoras: z.number().int().min(1).max(48).optional(),
    avisoLigacao: textoDoAviso.optional(),
    avisoAudio: textoDoAviso.optional(),
  }).strict()).mutation(async ({ ctx, input }) => {
    if (input.avisoLigacao !== undefined) exigirTextoFixo(input.avisoLigacao, 500);
    if (input.avisoAudio !== undefined) exigirTextoFixo(input.avisoAudio, 500);
    if (input.transcricaoLigada === true && !(await statusCloudflare()).configurado)
      throw new TRPCError({ code: "BAD_REQUEST", message: "Antes de ligar a transcrição, cadastre o Account ID e o API Token da Cloudflare em Integrações." });
    if (!Object.keys(input).length) return situacao();
    await gravarConfig(input, ctx.user.id);
    if (input.clienteLigado === true) limparPausaDoAtendimento();
    // auditoria só com o que mudou de interruptor/teto (nunca texto)
    const resumo: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) if (typeof v !== "string") resumo[k] = v;
    await registrarAcao({ funcao: "configurar_atendimento", resultado: "ok", motivo: "configuração do atendimento pelo número da empresa", autorUserId: ctx.user.id, canal: "tela", resumo });
    return situacao();
  }),

  criarCampanha: soAdmin.input(z.object({ nome: z.string().trim().min(2).max(120), empreendimento: z.string().trim().max(160).optional(), texto: textoDaCampanha }).strict())
    .mutation(async ({ ctx, input }) => {
      exigirTextoFixo(input.texto, 1000);
      const [c] = await getDb().insert(whatsappCampanhas).values({ nome: input.nome, empreendimento: input.empreendimento || null, texto: input.texto, ativa: false, criadoPor: ctx.user.id, atualizadoPor: ctx.user.id })
        .returning({ id: whatsappCampanhas.id });
      await registrarAcao({ funcao: "campanha_saudacao", resultado: "ok", motivo: "campanha criada (inativa)", autorUserId: ctx.user.id, canal: "tela", resumo: { campanhaId: c.id } });
      return situacao();
    }),

  editarCampanha: soAdmin.input(z.object({ id: z.number().int().positive(), nome: z.string().trim().min(2).max(120), empreendimento: z.string().trim().max(160).optional(), texto: textoDaCampanha }).strict())
    .mutation(async ({ ctx, input }) => {
      exigirTextoFixo(input.texto, 1000);
      const r = await getDb().update(whatsappCampanhas).set({ nome: input.nome, empreendimento: input.empreendimento || null, texto: input.texto, atualizadoEm: new Date(), atualizadoPor: ctx.user.id })
        .where(eq(whatsappCampanhas.id, input.id)).returning({ id: whatsappCampanhas.id });
      if (!r.length) throw new TRPCError({ code: "NOT_FOUND", message: "Campanha não encontrada." });
      await registrarAcao({ funcao: "campanha_saudacao", resultado: "ok", motivo: "campanha editada", autorUserId: ctx.user.id, canal: "tela", resumo: { campanhaId: input.id } });
      return situacao();
    }),

  /** Ativa UMA campanha (as outras saem de ativa na mesma transação; o índice único do banco garante uma só). */
  ativarCampanha: soAdmin.input(z.object({ id: z.number().int().positive(), ativa: z.boolean() }).strict()).mutation(async ({ ctx, input }) => {
    const db = getDb();
    await db.transaction(async tx => {
      if (input.ativa) await tx.update(whatsappCampanhas).set({ ativa: false, atualizadoEm: new Date(), atualizadoPor: ctx.user.id }).where(and(eq(whatsappCampanhas.ativa, true), ne(whatsappCampanhas.id, input.id)));
      const r = await tx.update(whatsappCampanhas).set({ ativa: input.ativa, atualizadoEm: new Date(), atualizadoPor: ctx.user.id }).where(eq(whatsappCampanhas.id, input.id)).returning({ id: whatsappCampanhas.id });
      if (!r.length) throw new TRPCError({ code: "NOT_FOUND", message: "Campanha não encontrada." });
    });
    await registrarAcao({ funcao: "campanha_saudacao", resultado: "ok", motivo: input.ativa ? "campanha ativada (as outras ficaram inativas)" : "campanha desativada", autorUserId: ctx.user.id, canal: "tela", resumo: { campanhaId: input.id, ativa: input.ativa } });
    return situacao();
  }),

  salvarCloudflare: soAdmin.input(z.object({ conta: z.string().trim().min(1).max(64), token: z.string().trim().min(1).max(256) }).strict()).mutation(async ({ ctx, input }) => {
    try { await salvarCredencialCloudflare(input.conta, input.token); }
    catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: semSegredos(e instanceof Error ? e.message : "Credencial recusada.", input) }); }
    await registrarAcao({ funcao: "configurar_cloudflare", resultado: "ok", motivo: "credenciais da Cloudflare cadastradas", autorUserId: ctx.user.id, canal: "tela" });
    return statusCloudflare();
  }),

  removerCloudflare: soAdmin.mutation(async ({ ctx }) => {
    await removerCredencialCloudflare();
    await gravarConfig({ transcricaoLigada: false }, ctx.user.id).catch(() => undefined);
    await registrarAcao({ funcao: "configurar_cloudflare", resultado: "ok", motivo: "credenciais da Cloudflare removidas; transcrição desligada", autorUserId: ctx.user.id, canal: "tela" });
    return statusCloudflare();
  }),
});
