// EPIC-025 (Dolores, etapa 6) — rotas `dolores.operacao.*`: a tela "Dolores — operação contínua" (pausa geral, gasto do mês,
// interruptores, últimas rondas e último relatório). SÓ o administrador (PAPEL), conferido em cada procedimento (o
// adminProcedure só confere o MÓDULO). Nada aqui devolve chave, segredo ou número completo; nada aqui fala em grupo, cria item
// na fila ou chama a IA. A ronda pela tela é só leitura; o relatório vai SÓ ao número do dono, pela mesma porta do cron.
import { TRPCError } from "@trpc/server";
import { eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { doloresConfig } from "../../drizzle/schema-dolores.js";
import { doloresCotacao, doloresEventos, doloresOperacaoConfig, doloresPrecosModelo } from "../../drizzle/schema-dolores-operacao.js";
import {
  COTACAO_MAXIMA, COTACAO_MINIMA, FATOR_CACHE_ESCRITA, FATOR_CACHE_LEITURA, FUNCOES_DO_GASTO, MAX_PRECO_MILHAO_USD, PARTES_PADRAO, PARTE_MAXIMA, PARTE_MINIMA,
  ROTULO_FUNCAO_CONSUMO, erroDasPartes,
} from "../../shared/dolores/custo.js";
import { doloresGastoPartes } from "../../drizzle/schema-dolores-operacao.js";
import { alertasDoMes, gastoPorFuncaoDoMes } from "./operacao-gasto.js";
import { CHAVE_MODELO_PREFERENCIAL, leitorModelosPadrao, modelosGravadosDasFuncoes } from "../_core/modelo-por-funcao.js";
import { custoEstimadoDoMes, lerPrecos, previsaoDoLimiteAtual } from "./custo.js";
import { COTACAO_SUGERIDA, DATA_PRECOS_SUGERIDOS, FONTE_PRECOS_SUGERIDOS, precoSugerido, projecaoDoMes } from "../../shared/dolores/precos-padrao.js";
import { CRON_DOLORES_AGENDAS, HORAS_DO_RELATORIO, HORA_CRON_DOLORES_BRASILIA, HORA_CRON_DOLORES_UTC, TETO_DONO_REAIS, estimarReais, horaDoRelatorio, janelaSobDemanda, relogioBrasilia } from "../../shared/dolores/operacao.js";
import { bloqueioDoLimite, mascararNumero, mesFortaleza } from "../../shared/dolores/whatsapp.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { getDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { lerConfigWhatsapp, lerPausa, usoDoMes } from "./consumo.js";
import { lerConfigGrupos } from "./grupos.js";
import { lerConfigNotas } from "./notas-obra.js";
import { lerConfigMarcacoes } from "./marcacao.js";
import { lerConfigOperacao } from "./operacao.js";
import { executarRonda, historicoParaTela, reenviarRelatorioDoDia, relatorioSobDemanda } from "./rondas.js";

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
  const [pausa, wa, uso, grupos, notas, historico, marcacoes] = await Promise.all([
    lerPausa().catch(() => null), lerConfigWhatsapp().catch(() => null), usoDoMes(mes).catch(() => ({ entrada: 0, saida: 0 })),
    lerConfigGrupos().catch(() => null), lerConfigNotas(), historicoParaTela(5, agora).catch(() => ({ rondas: [], ultimoRelatorio: null, relatorioDeHoje: null })),
    lerConfigMarcacoes().catch(() => null), // sem a 0129: desligado
  ]);
  const desde = new Date(agora.getTime() - 24 * 3_600_000);
  const eventos = await getDb().select({ tipo: doloresEventos.tipo, n: sql<number>`count(*)`.mapWith(Number) }).from(doloresEventos)
    .where(gte(doloresEventos.criadoEm, desde)).groupBy(doloresEventos.tipo).catch(() => []);
  const limites = { entrada: wa?.limiteMensalTokensEntrada ?? 0, saida: wa?.limiteMensalTokensSaida ?? 0 };
  const precos = { entradaMilhao: config.precoEntradaMilhao, saidaMilhao: config.precoSaidaMilhao };
  // Etapa 8 — estimativa por modelo e por tipo de token (a mesma conta do relatório); os campos antigos viram reserva
  const tabela = await lerPrecos();
  const custo = await custoEstimadoDoMes(mes, precos, tabela).catch(e => { console.error("[dolores/operacao] falha ao estimar o custo", e instanceof Error ? e.name : "erro"); return null; });
  const modelos = await modelosParaPreco(custo?.porModelo.map(m => m.modelo) ?? [], wa?.modelo ?? null);
  // EPIC-026 C5 — previsão em reais: gasto do mês, projeção até o fim do mês pelo ritmo atual e o teto pelos limites
  const limiteEmReaisPorModelo = await previsaoDoLimiteAtual({ limites, reserva: precos, anteriorDaConversa: wa?.modelo ?? null, precos: tabela })
    .catch(e => { console.error("[dolores/operacao] falha ao prever o limite", e instanceof Error ? e.name : "erro"); return null; });
  const gastoReais = custo ? (custo.porModelo.length ? (custo.total.completo ? custo.total.reais : null) : 0) : null;
  // EPIC-027 C5-E5 — gasto por função contra a parte de cada uma, e os alertas de 80%/100% já enviados no mês
  const [porFuncao, alertas] = await Promise.all([
    gastoPorFuncaoDoMes(mes, { precos: tabela, limites }).catch(e => { console.error("[dolores/operacao] falha ao montar o gasto por função", e instanceof Error ? e.name : "erro"); return null; }),
    alertasDoMes(mes),
  ]);
  return {
    pausa: pausa ? { pausada: pausa.pausada, motivo: pausa.motivo } : null,
    gasto: {
      mes, uso, limites, bloqueio: bloqueioDoLimite(uso, limites), tetoDonoReais: TETO_DONO_REAIS,
      // R$ estimado do mês pela conta nova (por modelo e tipo de token); sem consumo, como antes (null sem preço de reserva)
      reaisEstimados: custo?.porModelo.length ? custo.total.reais : estimarReais({ entrada: 0, saida: 0 }, precos),
      // reserva (campos antigos, R$ por milhão): só para modelo sem preço cadastrado
      limiteEmReais: estimarReais(limites, precos), precos,
      custo, cotacao: tabela.cotacao, precosDisponiveis: tabela.disponivel,
      fatoresCache: { escrita: FATOR_CACHE_ESCRITA, leitura: FATOR_CACHE_LEITURA },
      // EPIC-026 C5: o preço sugerido (código, com fonte e data) só aparece para o admin gravar com um clique; não entra na conta
      precosPorModelo: modelos.map(m => ({ modelo: m, preco: tabela.tabela.get(m) ?? null, sugerido: precoSugerido(m) })),
      sugestao: { fonte: FONTE_PRECOS_SUGERIDOS, data: DATA_PRECOS_SUGERIDOS, cotacao: COTACAO_SUGERIDA },
      previsao: {
        gastoMesReais: gastoReais,
        projecaoFimDoMesReais: projecaoDoMes(gastoReais, mes, Number(relogioBrasilia(agora).dia.slice(8, 10))),
        limite: limiteEmReaisPorModelo ? { piorCaso: limiteEmReaisPorModelo.piorCaso, daConversa: limiteEmReaisPorModelo.daConversa, semPreco: limiteEmReaisPorModelo.semPreco,
          semCotacao: limiteEmReaisPorModelo.semCotacao, acimaDoTeto: limiteEmReaisPorModelo.acimaDoTeto, suspeita: limiteEmReaisPorModelo.suspeita } : null,
      },
    },
    gastoPorFuncao: porFuncao ? {
      partes: porFuncao.partes, partesDisponiveis: porFuncao.partesDisponiveis, padrao: { ...PARTES_PADRAO }, minimo: PARTE_MINIMA, maximo: PARTE_MAXIMA,
      funcoes: porFuncao.situacao.funcoes, total: porFuncao.situacao.total, alertas,
    } : null,
    config: { rondasLigadas: config.rondasLigadas, relatorioLigado: config.relatorioLigado, relatorioHora: horaDoRelatorio(config.relatorioHora), eventosLigados: config.eventosLigados },
    interruptores: {
      iaLigada: wa?.iaLigada ?? false, conexao: wa?.statusConexao ?? "desconectado", numeroDono: mascararNumero(wa?.numeroDono ?? null),
      classificacaoLigada: grupos?.classificacaoLigada ?? false, leituraNotasLigada: notas.leituraLigada,
      // Etapa 4b — interruptor GERAL da resposta nos grupos quando marcada (só leitura aqui; muda no cartão dos grupos)
      respostaGruposLigada: marcacoes?.responderLigado ?? false,
      rondasLigadas: config.rondasLigadas, relatorioLigado: config.relatorioLigado, eventosLigados: config.eventosLigados,
    },
    agendamento: { cron: "/api/cron/dolores", horarioUtc: `${String(HORA_CRON_DOLORES_UTC).padStart(2, "0")}:00`,
      horarioBrasilia: `${String(HORA_CRON_DOLORES_BRASILIA).padStart(2, "0")}:00`, horasDoRelatorio: [...HORAS_DO_RELATORIO], chamadasPorDia: CRON_DOLORES_AGENDAS.length,
      agoraBrasilia: relogioBrasilia(agora).hhmm },
    eventos24h: Object.fromEntries(eventos.map(e => [e.tipo, e.n])),
    rondas: historico.rondas.map(r => ({ ...r, criadoEm: r.criadoEm.toISOString() })),
    ultimoRelatorio: historico.ultimoRelatorio ? {
      id: historico.ultimoRelatorio.id, janela: historico.ultimoRelatorio.janela, tipo: historico.ultimoRelatorio.tipo, origem: historico.ultimoRelatorio.origem,
      criadoEm: historico.ultimoRelatorio.criadoEm.toISOString(), texto: historico.ultimoRelatorio.texto,
      envio: historico.ultimoRelatorio.envio ? { resultado: historico.ultimoRelatorio.envio.resultado, motivo: historico.ultimoRelatorio.envio.motivo } : null,
    } : null,
    // relatório DIÁRIO de hoje: gerado? enviado? falhou? (falhou → a tela oferece "Enviar agora", que reenvia o mesmo texto)
    relatorioDeHoje: historico.relatorioDeHoje ? {
      id: historico.relatorioDeHoje.id, criadoEm: historico.relatorioDeHoje.criadoEm.toISOString(), situacao: historico.relatorioDeHoje.situacao,
      motivo: historico.relatorioDeHoje.envio?.resultado === "ok" ? null : historico.relatorioDeHoje.envio?.motivo ?? null,
    } : null,
  };
}

const preco = z.number().min(0).max(100_000).nullable();
const precoUsd = z.number().min(0).max(MAX_PRECO_MILHAO_USD).nullable();
/** Id de modelo como a Anthropic devolve: letras, números, ponto, hífen, sublinhado e dois-pontos. */
const idModelo = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/, "Modelo inválido.");

/**
 * Etapa 8 — modelos que a tela de preços lista: os que aparecem no consumo do mês e os escolhidos em Integrações › Anthropic
 * para as funções da Dolores (e o preferencial, e o campo antigo do cartão). Só NOMES de modelo (nunca a chave).
 */
async function modelosParaPreco(doConsumo: readonly string[], anteriorDaConversa: string | null): Promise<string[]> {
  const gravados = await modelosGravadosDasFuncoes().catch(() => null);
  const preferencial = await leitorModelosPadrao.lerBanco(CHAVE_MODELO_PREFERENCIAL).catch(() => undefined);
  const daDolores = gravados ? Object.entries(gravados).filter(([f]) => f.startsWith("dolores_")).map(([, v]) => v.modelo) : [];
  const precos = await getDb().select({ modelo: doloresPrecosModelo.modelo }).from(doloresPrecosModelo).catch(() => []);
  const todos = [...doConsumo, ...daDolores, preferencial, anteriorDaConversa, ...precos.map(p => p.modelo)]
    .map(m => (m ?? "").trim()).filter(m => m && /^[A-Za-z0-9._:-]{1,120}$/.test(m));
  return Array.from(new Set(todos)).sort();
}

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
    rondasLigadas: z.boolean().optional(), relatorioLigado: z.boolean().optional(),
    // EPIC-026 C4: só as horas que o cron alcança (07h a 14h de Brasília, a lista única de shared/dolores/operacao.ts)
    relatorioHora: z.number().int().refine(h => HORAS_DO_RELATORIO.includes(h), { message: "Escolha uma hora entre 07:00 e 14:00 (horário de Brasília)." }).optional(),
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

  /**
   * Etapa 8 — preço de UM modelo (US$ por milhão de tokens), informado pelo admin. Campo vazio (null) = não informado:
   * escrita/leitura de cache vazias valem 1,25× / 0,1× da entrada; entrada ou saída vazias = sem preço (usa a reserva).
   */
  salvarPrecoModelo: soAdmin.input(z.object({
    modelo: idModelo, entrada: precoUsd, saida: precoUsd, cacheEscrita: precoUsd, cacheLeitura: precoUsd,
  }).strict()).mutation(async ({ ctx, input }) => {
    await exigirConfig();
    const fixo = (v: number | null) => (v == null ? null : v.toFixed(4));
    const dados = { entradaMilhaoUsd: fixo(input.entrada), saidaMilhaoUsd: fixo(input.saida), cacheEscritaMilhaoUsd: fixo(input.cacheEscrita),
      cacheLeituraMilhaoUsd: fixo(input.cacheLeitura), atualizadoEm: new Date(), atualizadoPor: ctx.user.id };
    try {
      await getDb().insert(doloresPrecosModelo).values({ modelo: input.modelo, ...dados }).onConflictDoUpdate({ target: doloresPrecosModelo.modelo, set: dados });
    } catch {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Preços por modelo indisponíveis: a migração 0134 ainda não foi aplicada." });
    }
    await registrarAcao({ funcao: "operacao_config", resultado: "ok", motivo: "preço por modelo alterado pela tela", autorUserId: null, canal: "tela",
      resumo: { precoModelo: input.modelo.slice(0, 120), porUserId: ctx.user.id } });
    return situacao();
  }),

  /**
   * EPIC-026 C5 — "usar o sugerido": grava, num clique, o preço SUGERIDO do código para o modelo (tabela com fonte e data).
   * Modelo sem sugestão → recusa (o sistema não inventa preço). O valor vem do servidor, nunca do chamador.
   */
  usarPrecoSugerido: soAdmin.input(z.object({ modelo: idModelo }).strict()).mutation(async ({ ctx, input }) => {
    await exigirConfig();
    const p = precoSugerido(input.modelo);
    if (!p) throw new TRPCError({ code: "BAD_REQUEST", message: "Não há preço sugerido para este modelo: informe o preço da página da Anthropic." });
    const fixo = (v: number | null) => (v == null ? null : v.toFixed(4));
    const dados = { entradaMilhaoUsd: fixo(p.entrada), saidaMilhaoUsd: fixo(p.saida), cacheEscritaMilhaoUsd: fixo(p.cacheEscrita),
      cacheLeituraMilhaoUsd: fixo(p.cacheLeitura), atualizadoEm: new Date(), atualizadoPor: ctx.user.id };
    try {
      await getDb().insert(doloresPrecosModelo).values({ modelo: input.modelo, ...dados }).onConflictDoUpdate({ target: doloresPrecosModelo.modelo, set: dados });
    } catch {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Preços por modelo indisponíveis: a migração 0134 ainda não foi aplicada." });
    }
    await registrarAcao({ funcao: "operacao_config", resultado: "ok", motivo: "preço sugerido gravado pela tela", autorUserId: null, canal: "tela",
      resumo: { precoModelo: input.modelo.slice(0, 120), sugerido: true, porUserId: ctx.user.id } });
    return situacao();
  }),

  /** Etapa 8 — cotação do dólar (R$ por US$) para mostrar a estimativa em reais. Vazio = sem reais pela tabela. */
  salvarCotacao: soAdmin.input(z.object({ cotacao: z.number().min(COTACAO_MINIMA).max(COTACAO_MAXIMA).nullable() }).strict()).mutation(async ({ ctx, input }) => {
    await exigirConfig();
    const r = await getDb().update(doloresCotacao).set({ cotacaoDolar: input.cotacao == null ? null : input.cotacao.toFixed(4), atualizadoEm: new Date(), atualizadoPor: ctx.user.id })
      .where(eq(doloresCotacao.id, 1)).returning({ id: doloresCotacao.id }).catch(() => []);
    if (!r.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Cotação indisponível: a migração 0134 ainda não foi aplicada." });
    await registrarAcao({ funcao: "operacao_config", resultado: "ok", motivo: "cotação do dólar alterada pela tela", autorUserId: null, canal: "tela",
      resumo: { cotacao: true, porUserId: ctx.user.id } });
    return situacao();
  }),

  /**
   * EPIC-027 C5-E5 — divisão do limite mensal por função (% inteiros). SÓ o administrador (soAdmin). Validação no servidor: as 5
   * funções, cada uma de 1 a 96, soma exatamente 100 (o banco confere de novo, CHECK da 0148). Não muda dado de consumo.
   */
  salvarPartes: soAdmin.input(z.object(Object.fromEntries(FUNCOES_DO_GASTO.map(f => [f, z.number().int()
    .min(PARTE_MINIMA, { message: `Nenhuma função pode ficar com 0%: "${ROTULO_FUNCAO_CONSUMO[f]}" precisa de pelo menos ${PARTE_MINIMA}%.` })
    .max(PARTE_MAXIMA, { message: `"${ROTULO_FUNCAO_CONSUMO[f]}" pode ter no máximo ${PARTE_MAXIMA}%.` })])) as Record<(typeof FUNCOES_DO_GASTO)[number], z.ZodNumber>).strict()
    .superRefine((v, c) => { const e = erroDasPartes(v); if (e) c.addIssue({ code: z.ZodIssueCode.custom, message: e }); })).mutation(async ({ ctx, input }) => {
    await exigirConfig();
    const p = input as Record<(typeof FUNCOES_DO_GASTO)[number], number>;
    const r = await getDb().update(doloresGastoPartes).set({ conversaPct: p.conversa, documentosPct: p.documentos_e_notas, gruposPct: p.grupos, clientesPct: p.clientes,
      avisosPct: p.avisos, atualizadoEm: new Date(), atualizadoPor: ctx.user.id }).where(eq(doloresGastoPartes.id, 1)).returning({ id: doloresGastoPartes.id }).catch(() => []);
    if (!r.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Divisão do gasto indisponível: a migração 0148 ainda não foi aplicada (vale a divisão padrão)." });
    await registrarAcao({ funcao: "operacao_config", resultado: "ok", motivo: "divisão do gasto por função alterada pela tela", autorUserId: null, canal: "tela",
      resumo: { ...p, porUserId: ctx.user.id } });
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

  /**
   * Reenvia o MESMO texto gravado do relatório diário de hoje quando o envio falhou (não monta outro relatório). Uma vez
   * por minuto; já enviado com sucesso → recusa. Só ao número do dono.
   */
  reenviarRelatorioDoDia: soAdmin.mutation(async ({ ctx }) => {
    await exigirConfig();
    const inicio = Date.now();
    const r = await reenviarRelatorioDoDia({ agora: new Date(), prazoFinal: inicio + PRAZO_TELA_MS, pedidoPorUserId: ctx.user.id });
    return { ok: r.ok, situacao: r.situacao, motivo: r.motivo };
  }),

  /** Relatório agora: ronda + relatório de modelo fixo, enviado SÓ ao número do dono. Exige o relatório ligado. */
  enviarRelatorio: soAdmin.mutation(async ({ ctx }) => {
    await exigirConfig();
    const inicio = Date.now();
    const r = await relatorioSobDemanda({ origem: "tela", agora: new Date(), prazoFinal: inicio + PRAZO_TELA_MS, relogio: Date.now, pedidoPorUserId: ctx.user.id });
    return { ok: r.ok, situacao: r.situacao, motivo: r.motivo };
  }),
});

