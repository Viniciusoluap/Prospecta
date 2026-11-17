// EPIC-025 (Dolores, etapa 6) — rotas `dolores.operacao.*`: a tela "Dolores — operação contínua" (pausa geral, gasto do mês,
// interruptores, últimas rondas e último relatório). SÓ o administrador (PAPEL), conferido em cada procedimento (o
// adminProcedure só confere o MÓDULO). Nada aqui devolve chave, segredo ou número completo; nada aqui fala em grupo, cria item
// na fila ou chama a IA. A ronda pela tela é só leitura; o relatório vai SÓ ao número do dono, pela mesma porta do cron.
import { TRPCError } from "@trpc/server";
import { eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { doloresConfig } from "../../drizzle/schema-dolores.js";
import { doloresEventos, doloresOperacaoConfig } from "../../drizzle/schema-dolores-operacao.js";
import { TETO_DONO_REAIS, estimarReais, janelaSobDemanda, relogioBrasilia } from "../../shared/dolores/operacao.js";
import { bloqueioDoLimite, mascararNumero, mesFortaleza } from "../../shared/dolores/whatsapp.js";
import { existeChaveAnthropicPainel } from "../_core/anthropic-painel.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { lerConfigWhatsapp, lerPausa, usoDoMes } from "./consumo.js";
import { lerConfigGrupos } from "./grupos.js";
import { lerConfigNotas } from "./notas-obra.js";
import { lerConfigOperacao } from "./operacao.js";
import { executarRonda, historicoParaTela, relatorioSobDemanda } from "./rondas.js";

/** adminProcedure confere o módulo; aqui vale o PAPEL: só admin. */
const soAdmin = adminProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador vê e controla a operação da Dolores." });
  return next();
});

const SEM_MIGRACAO = "Operação contínua indisponível: a migração 0131 ainda não foi aplicada.";
/** Prazo das ações da tela (a função da Vercel tem 60 s). */
const PRAZO_TELA_MS = 40_000;

async function exigirConfig() {
  const c = await lerConfigOperacao();
  if (!c) throw new TRPCError({ code: "PRECONDITION_FAILED", message: SEM_MIGRACAO });
  return c;
}

async function situacao() {
  const config = await exigirConfig();
  const agora = new Date();
  const mes = mesFortaleza(agora);
  const [pausa, wa, uso, chave, grupos, notas, historico] = await Promise.all([
    lerPausa().catch(() => null), lerConfigWhatsapp().catch(() => null), usoDoMes(mes).catch(() => ({ entrada: 0, saida: 0 })),
    existeChaveAnthropicPainel().catch(() => null), lerConfigGrupos().catch(() => null), lerConfigNotas(), historicoParaTela(5).catch(() => ({ rondas: [], ultimoRelatorio: null })),
  ]);
  const desde = new Date(agora.getTime() - 24 * 3_600_000);
  const eventos = await getDb().select({ tipo: doloresEventos.tipo, n: sql<number>`count(*)`.mapWith(Number) }).from(doloresEventos)
    .where(gte(doloresEventos.criadoEm, desde)).groupBy(doloresEventos.tipo).catch(() => []);
  const limites = { entrada: wa?.limiteMensalTokensEntrada ?? 0, saida: wa?.limiteMensalTokensSaida ?? 0 };
  const precos = { entradaMilhao: config.precoEntradaMilhao, saidaMilhao: config.precoSaidaMilhao };
  return {
    pausa: pausa ? { pausada: pausa.pausada, motivo: pausa.motivo } : null,
    gasto: {
      mes, uso, limites, bloqueio: bloqueioDoLimite(uso, limites), tetoDonoReais: TETO_DONO_REAIS,
      reaisEstimados: estimarReais(uso, precos), limiteEmReais: estimarReais(limites, precos), precos,
    },
    config: { rondasLigadas: config.rondasLigadas, relatorioLigado: config.relatorioLigado, relatorioHora: config.relatorioHora, eventosLigados: config.eventosLigados },
    interruptores: {
      iaLigada: wa?.iaLigada ?? false, conexao: wa?.statusConexao ?? "desconectado", numeroDono: mascararNumero(wa?.numeroDono ?? null),
      chaveAnthropic: Boolean(chave?.existe), classificacaoLigada: grupos?.classificacaoLigada ?? false, leituraNotasLigada: notas.leituraLigada,
      rondasLigadas: config.rondasLigadas, relatorioLigado: config.relatorioLigado, eventosLigados: config.eventosLigados,
    },
    agendamento: { cron: "/api/cron/dolores", horarioUtc: "10:00", horarioBrasilia: "07:00", agoraBrasilia: relogioBrasilia(agora).hhmm },
    eventos24h: Object.fromEntries(eventos.map(e => [e.tipo, e.n])),
    rondas: historico.rondas.map(r => ({ ...r, criadoEm: r.criadoEm.toISOString() })),
    ultimoRelatorio: historico.ultimoRelatorio ? {
      id: historico.ultimoRelatorio.id, janela: historico.ultimoRelatorio.janela, tipo: historico.ultimoRelatorio.tipo, origem: historico.ultimoRelatorio.origem,
      criadoEm: historico.ultimoRelatorio.criadoEm.toISOString(), texto: historico.ultimoRelatorio.texto,
      envio: historico.ultimoRelatorio.envio ? { resultado: historico.ultimoRelatorio.envio.resultado, motivo: historico.ultimoRelatorio.envio.motivo } : null,
    } : null,
  };
}

const preco = z.number().min(0).max(100_000).nullable();

export const operacaoRouter = router({
  situacao: soAdmin.query(() => situacao()),

  /** PAUSA GERAL: para tudo na hora (IA, ponte, fila, rondas, relatório, classificação, notas, resposta do empreiteiro). */
  pausar: soAdmin.input(z.object({ pausada: z.boolean(), motivo: z.string().trim().max(200).optional() }).strict()).mutation(async ({ ctx, input }) => {
    const r = await getDb().update(doloresConfig).set({ pausada: input.pausada, motivoPausa: input.pausada ? input.motivo || null : null, atualizadoEm: new Date(), atualizadoPor: ctx.user.id })
      .where(eq(doloresConfig.id, 1)).returning({ pausada: doloresConfig.pausada }).catch(() => []);
    if (!r.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configuração da Dolores ausente: a migração 0123 ainda não foi aplicada." });
    await registrarAcao({ funcao: "pausa_geral", resultado: "ok", motivo: input.pausada ? "pausa geral ligada pela tela" : "pausa geral desligada pela tela", autorUserId: null, canal: "tela",
      resumo: { pausada: input.pausada, porUserId: ctx.user.id } });
    return situacao();
  }),

  /** Interruptores da operação e preço por milhão de tokens (opcional, só para estimar em reais). */
  salvar: soAdmin.input(z.object({
    rondasLigadas: z.boolean().optional(), relatorioLigado: z.boolean().optional(), relatorioHora: z.number().int().min(0).max(23).optional(),
    eventosLigados: z.boolean().optional(), precoEntradaMilhao: preco.optional(), precoSaidaMilhao: preco.optional(),
  }).strict()).mutation(async ({ ctx, input }) => {
    const atual = await exigirConfig();
    const rondas = input.rondasLigadas ?? atual.rondasLigadas;
    const relatorio = input.relatorioLigado ?? atual.relatorioLigado;
    if (relatorio && !rondas) throw new TRPCError({ code: "BAD_REQUEST", message: "O relatório diário é montado a partir da ronda: ligue as rondas antes (ou junto)." });
    if (input.relatorioLigado === true) {
      const wa = await lerConfigWhatsapp().catch(() => null);
      if (!wa?.numeroDono) throw new TRPCError({ code: "BAD_REQUEST", message: "Cadastre o número do dono antes de ligar o relatório (ele só vai para esse número)." });
    }
    const dados: Partial<typeof doloresOperacaoConfig.$inferInsert> = {};
    if (input.rondasLigadas !== undefined) dados.rondasLigadas = input.rondasLigadas;
    if (input.relatorioLigado !== undefined) dados.relatorioLigado = input.relatorioLigado;
    if (input.relatorioHora !== undefined) dados.relatorioHora = input.relatorioHora;
    if (input.eventosLigados !== undefined) dados.eventosLigados = input.eventosLigados;
    if (input.precoEntradaMilhao !== undefined) dados.precoEntradaMilhao = input.precoEntradaMilhao == null ? null : input.precoEntradaMilhao.toFixed(2);
    if (input.precoSaidaMilhao !== undefined) dados.precoSaidaMilhao = input.precoSaidaMilhao == null ? null : input.precoSaidaMilhao.toFixed(2);
    if (Object.keys(dados).length) {
      await getDb().update(doloresOperacaoConfig).set({ ...dados, atualizadoEm: new Date(), atualizadoPor: ctx.user.id }).where(eq(doloresOperacaoConfig.id, 1));
      await registrarAcao({ funcao: "operacao_config", resultado: "ok", motivo: "configuração da operação alterada pela tela", autorUserId: null, canal: "tela",
        resumo: { ...Object.fromEntries(Object.keys(dados).map(k => [k, true])), porUserId: ctx.user.id } });
    }
    return situacao();
  }),

  /** Ronda agora (só leitura; uma por minuto). Pausa geral → recusa. */
  rodarRonda: soAdmin.mutation(async () => {
    const config = await exigirConfig();
    const inicio = Date.now();
    const agora = new Date();
    const r = await executarRonda({ janela: janelaSobDemanda(agora), origem: "tela", agora, prazoFinal: inicio + PRAZO_TELA_MS, relogio: Date.now, config });
    if (!r.ok) throw new TRPCError({ code: "PRECONDITION_FAILED", message: r.motivo === "pausada" ? "A Dolores está pausada (pausa geral): nada foi lido." : "Não consegui fazer a ronda agora." });
    return { rondaId: r.ronda.id, nova: r.nova, falhas: r.ronda.falhas };
  }),

  /** Relatório agora: ronda + relatório de modelo fixo, enviado SÓ ao número do dono. Exige o relatório ligado. */
  enviarRelatorio: soAdmin.mutation(async ({ ctx }) => {
    await exigirConfig();
    const inicio = Date.now();
    const r = await relatorioSobDemanda({ origem: "tela", agora: new Date(), prazoFinal: inicio + PRAZO_TELA_MS, relogio: Date.now, pedidoPorUserId: ctx.user.id });
    return { ok: r.ok, situacao: r.situacao, motivo: r.motivo };
  }),
});

