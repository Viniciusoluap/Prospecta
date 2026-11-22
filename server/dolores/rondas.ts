// EPIC-025 (Dolores, etapa 6) — rondas agendadas e relatório (prompt mestre, seções 3 e 4.7: "rondas agendadas (varredura de
// processos e relatório diário)"). Regras fixas deste arquivo:
// - A ronda é uma varredura POR CÓDIGO (sem IA, sem custo): reaproveita as leituras da etapa 1 (mesmos critérios das telas) e
//   conta o que espera a Dolores (fila, documentos dos grupos, notas de obra, banco). Cada seção roda numa transação SOMENTE
//   LEITURA própria, com SET LOCAL statement_timeout do tempo que resta (piso/teto): a seção que falha ou estoura o tempo
//   vira "falha" registrada na ronda, não derruba as outras e o relatório diz que faltou.
// - O resultado vai para dolores_rondas (só inserção) DEPOIS de montado, com INSERT ... ON CONFLICT (janela) DO NOTHING: a mesma
//   janela não roda duas vezes e a reentrega do cron não duplica (se a janela já existe, nem lê de novo).
// - O relatório é MODELO FIXO (shared/dolores/operacao.ts), montado só com a ronda; gravado em dolores_relatorios (só inserção,
//   janela única: o diário sai UMA vez por dia) e enviado SÓ ao número do dono pelo canal da Dolores, pelos mesmos filtros de
//   saída da conversa (links, dados pessoais conforme o interruptor, segredos e bancários sempre, tamanho). Sem número do dono,
//   sem conexão ou com a pausa geral ligada, nada é enviado.
// - Nada aqui grava em módulo do sistema, cria item na fila, chama a IA ou fala em grupo.
import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, like, ne, notInArray, sql } from "drizzle-orm";
import { bankTransactions, leadServices, leads, whatsappMessages } from "../../drizzle/schema.js";
import { doloresAcoes } from "../../drizzle/schema-dolores.js";
import { doloresAprovacoes, doloresAutoria } from "../../drizzle/schema-dolores-fila.js";
import { doloresGrupoMensagens, doloresGrupos } from "../../drizzle/schema-dolores-grupos.js";
import { sqlGrupoLeDocumentos } from "./grupos.js";
import { obraNotas } from "../../drizzle/schema-dolores-notas.js";
import { doloresEventos, doloresRelatorioReenvios, doloresRelatorios, doloresRondas, type DoloresRonda, type OrigemOperacao } from "../../drizzle/schema-dolores-operacao.js";
import {
  HORAS_AVISO_FILA, MAX_DESTAQUES, MAX_EVENTOS_PRAZO_POR_RONDA, MAX_RELATORIOS_SOB_DEMANDA_DIA, janelaDiaria, janelaReenvio, janelaReenvioDoCron, janelaRelatorioDiario, janelaRondaDoRelatorio, janelaSobDemanda,
  limparNomeDeTerceiro, montarRelatorio, prefixoSobDemandaDoDia, relatorioDiarioNaHora,
  type DestaquesRonda, type SecaoRonda, type TotaisRonda,
} from "../../shared/dolores/operacao.js";
import { LEAD_FINALIZED_STAGE } from "../../shared/lead-pipeline.js";
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { mesFortaleza } from "../../shared/dolores/whatsapp.js";
import { getDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { lerConfigWhatsapp, lerPartesDoGasto, usoDoMes } from "./consumo.js";
import { consumoDoMesDetalhado, lerPrecos } from "./custo.js";
import { FILTRO_DO_REGISTRO } from "./dados-pessoais.js";
import { erroParaLog } from "./erro-seguro.js";
import { listarAtrasos } from "./leitura/atrasos.js";
import { listarDocumentos } from "./leitura/documentos.js";
import { listarRecebiveisPendentes } from "./leitura/financeiro.js";
import { listarTarefas } from "./leitura/tarefas.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "./somente-leitura.js";
import { bloqueioDaOperacao, lerConfigOperacao, registrarEvento, type ConfigOperacao } from "./operacao.js";
import { idDaDoloresSemCriar } from "./perfil.js";
import { enviarAlertasPendentes } from "./operacao-gasto.js";
import { enviarAvisoAoDono, retomarTarefasDemoradas } from "./whatsapp.js";
import { DIAS_PARADO_PADRAO } from "../../shared/dolores/regras.js";

/** Prazo da rota do cron (a função da Vercel tem 60 s). */
export const PRAZO_CRON_MS = 45_000;
/** Seção nova só começa com pelo menos isto de folga. */
const MINIMO_POR_SECAO_MS = 3_000;
/** Teto do tempo de cada consulta de uma seção (SET LOCAL statement_timeout): uma seção lenta não come o prazo das outras. */
export const TETO_CONSULTA_SECAO_MS = 15_000;
/** Piso do statement_timeout (abaixo disso a seção nem começa: ver MINIMO_POR_SECAO_MS). */
export const PISO_CONSULTA_SECAO_MS = 1_000;
/** Folga guardada para gravar a ronda depois da última seção. */
const FOLGA_GRAVAR_MS = 1_000;
/** Tempo-limite da consulta de uma seção: o que resta do prazo (menos a folga), entre o piso e o teto. */
export const tempoLimiteDaSecao = (restanteMs: number) =>
  Math.min(TETO_CONSULTA_SECAO_MS, Math.max(PISO_CONSULTA_SECAO_MS, Math.floor(restanteMs - FOLGA_GRAVAR_MS)));
/** Para enviar o relatório depois da ronda. */
const MINIMO_PARA_RELATORIO_MS = 6_000;

const motivoDoBloqueio = (m: "pausada" | "indisponivel" | "usuaria_desativada") =>
  m === "pausada" ? "Dolores pausada (pausa geral)" : m === "usuaria_desativada" ? "usuária Dolores desativada em Usuários e acesso" : "configuração indisponível";
/** Nome de terceiro (cliente, responsável) guardado nos destaques: filtro do registro + limpeza de nome (sem formatação nem comando). */
const limpo = (s: string | null | undefined) => limparNomeDeTerceiro(sanitizarTexto(String(s ?? ""), FILTRO_DO_REGISTRO));
const contar = (v: unknown) => Number(v ?? 0) || 0;
const reais = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;

type Secao = { totais: Partial<TotaisRonda>; destaques?: Partial<DestaquesRonda>; prazosVencidos?: Array<{ modulo: string; id: number; prazo: string | null }> };
type Ctx = { agora: Date; tempoLimiteMs: number };

const lerSecao = (fn: (c: Ctx) => Promise<Secao>) => (c: Ctx) => emTransacaoSomenteLeitura(() => fn(c), { tempoLimiteMs: c.tempoLimiteMs });

/** As seções da ronda, na ordem do relatório. Cada uma é uma leitura só. */
const SECOES: Array<[SecaoRonda, (c: Ctx) => Promise<Secao>]> = [
  ["fila", lerSecao(async ({ agora }) => {
    const db = bancoDaLeitura();
    const limite = new Date(agora.getTime() + HORAS_AVISO_FILA * 3_600_000);
    const [r] = await db.select({
      aguardando: sql<number>`count(*)`.mapWith(Number),
      venceLogo: sql<number>`count(*) filter (where ${doloresAprovacoes.venceEm} <= ${limite})`.mapWith(Number),
    }).from(doloresAprovacoes).where(and(eq(doloresAprovacoes.situacao, "aguardando"), gt(doloresAprovacoes.venceEm, agora)));
    const itens = await db.select({ codigo: doloresAprovacoes.codigo, funcao: doloresAprovacoes.funcao, venceEm: doloresAprovacoes.venceEm }).from(doloresAprovacoes)
      .where(and(eq(doloresAprovacoes.situacao, "aguardando"), gt(doloresAprovacoes.venceEm, agora))).orderBy(doloresAprovacoes.venceEm).limit(MAX_DESTAQUES);
    return { totais: { fila: { aguardando: contar(r?.aguardando), venceLogo: contar(r?.venceLogo) } },
      destaques: { fila: itens.map(i => ({ codigo: i.codigo, funcao: i.funcao, venceEm: i.venceEm.toISOString() })) } };
  })],
  ["carteira", lerSecao(async () => {
    const db = bancoDaLeitura();
    const [c] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(leads).where(and(isNull(leads.deletedAt), ne(leads.stage, LEAD_FINALIZED_STAGE)));
    const [s] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(leadServices)
      .innerJoin(leads, and(eq(leads.id, leadServices.leadId), isNull(leads.deletedAt))).where(notInArray(leadServices.status, ["completed", "cancelled"]));
    return { totais: { carteira: { clientesAtivos: contar(c?.n), servicosEmAndamento: contar(s?.n) } } };
  })],
  ["atrasos", lerSecao(async ({ agora }) => {
    const r = await listarAtrasos({ modulo: "todos", diasParado: DIAS_PARADO_PADRAO, pagina: 1, limite: 50 }, { agora, canal: "ponte" });
    const dados = r.dados as { porModulo: Record<string, { atrasados: number; parados: number }>; itens: Array<{ modulo: string; id: number; cliente: string | null; atrasado: boolean; parado: boolean; diasDeAtraso: number | null; diasSemMovimentacao: number | null; prazo: string | null }>; total?: number };
    const porModulo = dados.porModulo ?? {};
    const atrasados = Object.values(porModulo).reduce((s, m) => s + m.atrasados, 0);
    const parados = Object.values(porModulo).reduce((s, m) => s + m.parados, 0);
    return {
      totais: { atrasos: { total: contar(r.resumo.encontrados), atrasados, parados, porModulo } },
      destaques: { atrasos: dados.itens.slice(0, MAX_DESTAQUES).map(i => ({ modulo: i.modulo, cliente: limpo(i.cliente) || null, diasDeAtraso: i.diasDeAtraso, diasSemMovimentacao: i.diasSemMovimentacao })) },
      prazosVencidos: dados.itens.filter(i => i.atrasado && i.prazo).slice(0, MAX_EVENTOS_PRAZO_POR_RONDA).map(i => ({ modulo: i.modulo, id: i.id, prazo: i.prazo })),
    };
  })],
  ["tarefas", lerSecao(async ({ agora }) => {
    const r = await listarTarefas({ situacao: "atrasadas", pagina: 1, limite: 1 }, { agora });
    const d = r.dados as { totais: { abertas: number; atrasadas: number; semPrazo: number }; porResponsavel: Array<{ responsavel: string; atrasadas: number }> };
    return { totais: { tarefas: d.totais }, destaques: { tarefas: d.porResponsavel.filter(p => p.atrasadas > 0).slice(0, MAX_DESTAQUES).map(p => ({ responsavel: limpo(p.responsavel), atrasadas: p.atrasadas })) } };
  })],
  ["documentos", lerSecao(async () => {
    const r = await listarDocumentos({ situacao: "pendentes", pagina: 1, limite: MAX_DESTAQUES });
    const d = r.dados as { totais: { pendentes: number }; itens: Array<{ cliente: string; quantidade: number }> };
    return { totais: { documentos: { pendentes: d.totais.pendentes, clientes: contar(r.resumo.clientes) } },
      destaques: { documentos: d.itens.map(i => ({ cliente: limpo(i.cliente), quantidade: i.quantidade })) } };
  })],
  ["recebiveis", lerSecao(async ({ agora }) => {
    const r = await listarRecebiveisPendentes({ situacao: "em_aberto", origem: "todas", pagina: 1, limite: 1 }, { agora, canal: "ponte" });
    const t = (r.dados as { totais: Record<string, unknown> }).totais;
    return { totais: { recebiveis: { cobrancas: contar(t.cobrancasBpo), emAberto: reais(t.emAbertoBpo), vencidas: contar(t.vencidasBpo), vencido: reais(t.vencidoBpo),
      regularizacoesComSaldo: contar(t.regularizacoesComSaldo), saldoRegularizacoes: reais(t.saldoRegularizacoes) } } };
  })],
  ["conversas", lerSecao(async () => {
    const [r] = await bancoDaLeitura().select({ n: sql<number>`count(distinct ${whatsappMessages.leadId})`.mapWith(Number) }).from(whatsappMessages)
      .innerJoin(leads, and(eq(leads.id, whatsappMessages.leadId), isNull(leads.deletedAt)))
      .where(and(eq(whatsappMessages.direcao, "entrada"), eq(whatsappMessages.lida, false)));
    return { totais: { conversas: { semLeitura: contar(r?.n) } } };
  })],
  ["grupos", lerSecao(async ({ agora }) => {
    const [r] = await bancoDaLeitura().select({
      aClassificar: sql<number>`count(*) filter (where ${doloresGrupoMensagens.situacao} in ('a_classificar', 'classificando'))`.mapWith(Number),
      aConferir: sql<number>`count(*) filter (where ${doloresGrupoMensagens.situacao} = 'confira')`.mapWith(Number),
      prontos: sql<number>`count(*) filter (where ${doloresGrupoMensagens.situacao} = 'classificado')`.mapWith(Number),
      erro: sql<number>`count(*) filter (where ${doloresGrupoMensagens.situacao} = 'erro')`.mapWith(Number),
    }).from(doloresGrupoMensagens).innerJoin(doloresGrupos, eq(doloresGrupos.id, doloresGrupoMensagens.grupoId))
      // Etapa 7: só documentos de grupo que lê documentos (cliente/pós com cliente ligado, ou obra)
      .where(and(inArray(doloresGrupoMensagens.situacao, ["a_classificar", "classificando", "confira", "classificado", "erro"]), sqlGrupoLeDocumentos()));
    // Etapa 7: grupos novos esperando a resposta do dono (nome que não bateu com nada: só observam)
    const [a] = await bancoDaLeitura().select({ n: sql<number>`count(*)`.mapWith(Number) }).from(doloresGrupos)
      .where(and(eq(doloresGrupos.ativo, true), eq(doloresGrupos.situacaoConfirmacao, "aguardando_dono")));
    // QA-SEG EPIC-027 (achado 1b): classificações pela tela cujo aviso ao dono não saiu (teto do dia) nas últimas 24 h
    const [p] = await bancoDaLeitura().select({ n: sql<number>`count(*)`.mapWith(Number) }).from(doloresGrupos)
      .where(gte(doloresGrupos.avisoClassificacaoPendenteEm, new Date(agora.getTime() - 24 * 3_600_000)));
    // QA-SEG EPIC-027 (R3-1): grupos de engenharia cuja obra foi excluída no CRM (calados até reclassificar)
    const [o] = await bancoDaLeitura().select({ n: sql<number>`count(*)`.mapWith(Number) }).from(doloresGrupos)
      .where(and(eq(doloresGrupos.ativo, true), isNotNull(doloresGrupos.obraExcluidaEm), eq(doloresGrupos.tipo, "indefinido")));
    return { totais: { grupos: { aClassificar: contar(r?.aClassificar), aConferir: contar(r?.aConferir), prontosParaSalvar: contar(r?.prontos), comErro: contar(r?.erro), aguardandoDono: contar(a?.n),
      classificadosSemAviso: contar(p?.n), obraExcluida: contar(o?.n) } } };
  })],
  ["notas", lerSecao(async () => {
    const [r] = await bancoDaLeitura().select({
      semConfirmacao: sql<number>`count(*) filter (where ${obraNotas.confirmacao} = 'pendente' and ${obraNotas.situacao} in ('rascunho', 'confira'))`.mapWith(Number),
      semConciliacao: sql<number>`count(*) filter (where ${obraNotas.confirmacao} = 'confirmada' and ${obraNotas.bpoLancamentoId} is null)`.mapWith(Number),
      correcao: sql<number>`count(*) filter (where ${obraNotas.confirmacao} = 'correcao')`.mapWith(Number),
      naoLidas: sql<number>`count(*) filter (where ${obraNotas.situacao} in ('nao_lida', 'ilegivel'))`.mapWith(Number),
    }).from(obraNotas).where(isNull(obraNotas.duplicadaDe));
    return { totais: { notas: { semConfirmacao: contar(r?.semConfirmacao), confirmadasSemConciliacao: contar(r?.semConciliacao), correcao: contar(r?.correcao), naoLidas: contar(r?.naoLidas) } } };
  })],
  ["banco", lerSecao(async ({ agora }) => {
    const desde = new Date(agora.getTime() - 24 * 3_600_000);
    const [r] = await bancoDaLeitura().select({
      sincronizadas: sql<number>`count(*) filter (where ${bankTransactions.createdAt} >= ${desde})`.mapWith(Number),
      aClassificar: sql<number>`count(*) filter (where ${bankTransactions.aClassificar})`.mapWith(Number),
    }).from(bankTransactions).where(ne(bankTransactions.origem, "manual"));
    return { totais: { banco: { sincronizadas24h: contar(r?.sincronizadas), aClassificar: contar(r?.aClassificar) } } };
  })],
  ["feitos24h", lerSecao(async ({ agora }) => {
    const db = bancoDaLeitura();
    const desde = new Date(agora.getTime() - 24 * 3_600_000);
    const fila = await db.select({ funcao: doloresAprovacoes.funcao, n: sql<number>`count(*)`.mapWith(Number) }).from(doloresAprovacoes)
      .where(and(eq(doloresAprovacoes.situacao, "executada"), gte(doloresAprovacoes.executadoEm, desde))).groupBy(doloresAprovacoes.funcao);
    const diretas = await db.select({ funcao: doloresAutoria.funcao, n: sql<number>`count(*)`.mapWith(Number) }).from(doloresAutoria)
      .where(and(gte(doloresAutoria.criadoEm, desde), isNull(doloresAutoria.aprovacaoId))).groupBy(doloresAutoria.funcao);
    const de = (xs: Array<{ funcao: string; n: number }>, f: string) => contar(xs.find(x => x.funcao === f)?.n);
    return { totais: { feitos24h: { cobrancas: de(fila, "preparar_cobranca"), documentos: de(fila, "gerar_documento"), tarefas: de(diretas, "criar_tarefa"), acompanhamentos: de(diretas, "registrar_acompanhamento") } } };
  })],
  ["eventos", lerSecao(async ({ agora }) => {
    const desde = new Date(agora.getTime() - 24 * 3_600_000);
    const [r] = await bancoDaLeitura().select({
      documentos: sql<number>`count(*) filter (where ${doloresEventos.tipo} = 'documento_grupo')`.mapWith(Number),
      notas: sql<number>`count(*) filter (where ${doloresEventos.tipo} = 'nota_lida')`.mapWith(Number),
    }).from(doloresEventos).where(gte(doloresEventos.criadoEm, desde));
    return { totais: { eventos: { prazosNovos: 0, documentosGrupo24h: contar(r?.documentos), notasLidas24h: contar(r?.notas) } } };
  })],
  // fora da transação de leitura: usa as funções de consumo (getDb), que não gravam
  ["consumo", (async ({ agora }: Ctx): Promise<Secao> => {
    const mes = mesFortaleza(agora);
    const cfg = await lerConfigWhatsapp();
    const uso = await usoDoMes(mes);
    // Etapa 8: o detalhe por modelo e função (4 tipos de token) para a estimativa por modelo do relatório
    const linhas = await consumoDoMesDetalhado(mes);
    // EPIC-027 C5-E5: a parte de cada função (o relatório mostra o gasto por função em uma linha)
    const { partes } = await lerPartesDoGasto();
    return { totais: { consumo: { mes, entrada: uso.entrada, saida: uso.saida, limiteEntrada: cfg?.limiteMensalTokensEntrada ?? 0, limiteSaida: cfg?.limiteMensalTokensSaida ?? 0, linhas, partes } } };
  })],
];

export type ResultadoRonda =
  | { ok: true; ronda: DoloresRonda; nova: boolean }
  | { ok: false; motivo: "pausada" | "indisponivel" | "usuaria_desativada" | "desligada" | "erro"; detalhe?: string | null };

/**
 * Uma ronda na janela dada. Já existe → devolve a existente (nova = false), sem ler de novo. Pausa geral ou configuração que
 * não se lê → não roda. Eventos "prazo vencido" e "pagamento do banco" só com os eventos ligados.
 */
export async function executarRonda(p: { janela: string; origem: OrigemOperacao; agora: Date; prazoFinal: number; relogio: () => number; config: ConfigOperacao }): Promise<ResultadoRonda> {
  const inicio = p.relogio();
  const autor = await idDaDoloresSemCriar().catch(() => null);
  const canal = p.origem === "cron" ? "cron" : p.origem;
  const bloqueio = await bloqueioDaOperacao();
  if (bloqueio) {
    await registrarAcao({ funcao: "ronda", resultado: "recusada", motivo: motivoDoBloqueio(bloqueio.motivo), autorUserId: autor, canal, pedidoId: p.janela });
    return { ok: false, ...bloqueio };
  }
  try {
    const [existente] = await getDb().select().from(doloresRondas).where(eq(doloresRondas.janela, p.janela)).limit(1);
    if (existente) return { ok: true, ronda: existente, nova: false };
  } catch (e) {
    console.error("[dolores/rondas] falha ao conferir a janela", erroParaLog(e));
    return { ok: false, motivo: "indisponivel" };
  }
  const totais: TotaisRonda = {};
  const destaques: DestaquesRonda = {};
  const falhas: string[] = [];
  let prazos: NonNullable<Secao["prazosVencidos"]> = [];
  for (const [nome, ler] of SECOES) {
    if (p.prazoFinal - p.relogio() < MINIMO_POR_SECAO_MS) { falhas.push(nome); continue; }
    try {
      const r = await ler({ agora: p.agora, tempoLimiteMs: tempoLimiteDaSecao(p.prazoFinal - p.relogio()) });
      Object.assign(totais, r.totais);
      Object.assign(destaques, r.destaques ?? {});
      if (r.prazosVencidos) prazos = r.prazosVencidos;
    } catch (e) {
      console.error("[dolores/rondas] seção falhou", nome, erroParaLog(e));
      falhas.push(nome);
    }
  }
  // Eventos (só registro): prazos que venceram e movimentações do banco. Contam como "novos" só os que entraram agora.
  if (p.config.eventosLigados) {
    let novos = 0;
    for (const x of prazos) {
      if (p.prazoFinal - p.relogio() < MINIMO_POR_SECAO_MS) break;
      if (await registrarEvento({ tipo: "prazo_vencido", chave: `prazo:${x.modulo}:${x.id}:${x.prazo}`, origemTabela: x.modulo, origemId: x.id }, { config: p.config, jaConferiuPausa: true })) novos++;
    }
    if (totais.eventos) totais.eventos.prazosNovos = novos;
    if (totais.banco && totais.banco.sincronizadas24h > 0) {
      await registrarEvento({ tipo: "pagamento_banco", chave: `banco:${p.janela}`, origemTabela: "bank_transactions", resumo: { sincronizadas24h: totais.banco.sincronizadas24h } },
        { config: p.config, jaConferiuPausa: true });
    }
  }
  try {
    const [linha] = await getDb().insert(doloresRondas).values({ janela: p.janela, origem: p.origem, duracaoMs: Math.max(0, Math.round(p.relogio() - inicio)), totais, destaques, falhas })
      .onConflictDoNothing().returning();
    const ronda = linha ?? (await getDb().select().from(doloresRondas).where(eq(doloresRondas.janela, p.janela)).limit(1))[0];
    if (!ronda) return { ok: false, motivo: "erro" };
    if (linha) {
      await registrarAcao({ funcao: "ronda", resultado: falhas.length ? "erro" : "ok", motivo: falhas.length ? `seções sem leitura: ${falhas.join(", ")}` : null, autorUserId: autor, canal,
        pedidoId: p.janela, duracaoMs: linha.duracaoMs, resumo: { rondaId: linha.id, secoes: SECOES.length - falhas.length, falhas: falhas.length } });
    }
    return { ok: true, ronda, nova: Boolean(linha) };
  } catch (e) {
    console.error("[dolores/rondas] falha ao gravar a ronda", erroParaLog(e));
    return { ok: false, motivo: "erro" };
  }
}

export type ResultadoRelatorio = { ok: boolean; situacao: "enviado" | "ja_enviado" | "nao_enviado" | "bloqueado"; motivo: string | null; relatorioId: number | null };

/**
 * Relatório: grava (janela única) e envia ao dono. A janela do diário já usada → "ja_enviado" (não manda de novo). O texto
 * gravado passa pelo filtro do REGISTRO; o enviado, pelos filtros de saída do canal (enviarAvisoAoDono).
 */
export async function enviarRelatorio(p: {
  tipo: "diario" | "sob_demanda"; janela: string; origem: OrigemOperacao; ronda: DoloresRonda; agora: Date; prazoFinal: number; config: ConfigOperacao; pedidoPorUserId?: number | null;
}): Promise<ResultadoRelatorio> {
  const autor = await idDaDoloresSemCriar().catch(() => null);
  const bloqueio = await bloqueioDaOperacao();
  if (bloqueio) return { ok: false, situacao: "bloqueado", motivo: motivoDoBloqueio(bloqueio.motivo), relatorioId: null };
  const precosPorModelo = await lerPrecos();
  const texto = montarRelatorio({ tipo: p.tipo, geradoEm: p.agora, totais: p.ronda.totais as TotaisRonda, destaques: p.ronda.destaques as DestaquesRonda,
    falhas: p.ronda.falhas ?? [], precos: { entradaMilhao: p.config.precoEntradaMilhao, saidaMilhao: p.config.precoSaidaMilhao }, precosPorModelo });
  const registro = sanitizarTexto(texto, FILTRO_DO_REGISTRO).slice(0, 4000);
  let relatorioId: number | null = null;
  try {
    const [linha] = await getDb().insert(doloresRelatorios).values({ janela: p.janela, tipo: p.tipo, origem: p.origem, rondaId: p.ronda.id, texto: registro, caracteres: texto.length,
      pedidoPorUserId: p.pedidoPorUserId ?? null }).onConflictDoNothing().returning({ id: doloresRelatorios.id });
    if (!linha) return { ok: false, situacao: "ja_enviado", motivo: "o relatório desta janela já foi montado (não é enviado de novo)", relatorioId: null };
    relatorioId = linha.id;
  } catch (e) {
    console.error("[dolores/rondas] falha ao gravar o relatório", erroParaLog(e));
    return { ok: false, situacao: "nao_enviado", motivo: "não consegui gravar o relatório; nada foi enviado", relatorioId: null };
  }
  const envio = await enviarAvisoAoDono(texto, { funcao: "relatorio_envio", pedidoId: `relatorio:${relatorioId}`, autor, prazoFinal: p.prazoFinal,
    canal: p.origem === "cron" ? "cron" : p.origem, resumo: { relatorioId, rondaId: p.ronda.id, tipo: p.tipo } });
  return { ok: envio.ok, situacao: envio.ok ? "enviado" : "nao_enviado", motivo: envio.motivo, relatorioId };
}

/** Frase fixa quando o teto diário de relatórios sob demanda já foi usado. */
export const TETO_SOB_DEMANDA_ATINGIDO = `já saíram ${MAX_RELATORIOS_SOB_DEMANDA_DIA} relatórios sob demanda hoje (o limite do dia); amanhã libera de novo`;

/**
 * Ronda + relatório sob demanda (tela ou comando do dono): uma janela por minuto e no máximo
 * {@link MAX_RELATORIOS_SOB_DEMANDA_DIA} por dia. Exige o relatório ligado.
 */
export async function relatorioSobDemanda(p: { origem: "tela" | "whatsapp"; agora: Date; prazoFinal: number; relogio: () => number; pedidoPorUserId?: number | null }): Promise<ResultadoRelatorio> {
  const config = await lerConfigOperacao();
  if (!config) return { ok: false, situacao: "bloqueado", motivo: "configuração da operação ausente (migração 0131)", relatorioId: null };
  if (!config.relatorioLigado) return { ok: false, situacao: "bloqueado", motivo: "o relatório está desligado (Integrações › Dolores — operação contínua)", relatorioId: null };
  const janela = janelaSobDemanda(p.agora);
  // teto diário (tela + WhatsApp): passou dele, frase fixa — nem ronda nem relatório
  try {
    const [c] = await getDb().select({ n: sql<number>`count(*)`.mapWith(Number) }).from(doloresRelatorios)
      .where(and(eq(doloresRelatorios.tipo, "sob_demanda"), like(doloresRelatorios.janela, `${prefixoSobDemandaDoDia(p.agora)}%`)));
    if (contar(c?.n) >= MAX_RELATORIOS_SOB_DEMANDA_DIA) return { ok: false, situacao: "bloqueado", motivo: TETO_SOB_DEMANDA_ATINGIDO, relatorioId: null };
  } catch (e) {
    console.error("[dolores/rondas] falha ao contar os relatórios do dia", erroParaLog(e));
    return { ok: false, situacao: "bloqueado", motivo: "não consegui conferir o limite diário de relatórios", relatorioId: null };
  }
  const r = await executarRonda({ janela, origem: p.origem, agora: p.agora, prazoFinal: p.prazoFinal, relogio: p.relogio, config });
  if (!r.ok) return { ok: false, situacao: "bloqueado", motivo: r.motivo === "pausada" ? "Dolores pausada (pausa geral)" : "não consegui fazer a ronda agora", relatorioId: null };
  if (p.prazoFinal - p.relogio() < MINIMO_PARA_RELATORIO_MS) return { ok: false, situacao: "nao_enviado", motivo: "sem tempo para enviar dentro do prazo", relatorioId: null };
  return enviarRelatorio({ tipo: "sob_demanda", janela, origem: p.origem, ronda: r.ronda, agora: p.agora, prazoFinal: p.prazoFinal, config, pedidoPorUserId: p.pedidoPorUserId });
}

/** Último resultado do envio de um relatório (auditoria "relatorio_envio", pedido "relatorio:<id>"; o reenvio grava no mesmo pedido). */
async function ultimoEnvio(relatorioId: number) {
  const [envio] = await getDb().select({ resultado: doloresAcoes.resultado, motivo: doloresAcoes.motivo, criadoEm: doloresAcoes.criadoEm }).from(doloresAcoes)
    .where(and(eq(doloresAcoes.funcao, "relatorio_envio"), eq(doloresAcoes.pedidoId, `relatorio:${relatorioId}`))).orderBy(desc(doloresAcoes.id)).limit(1);
  return envio ?? null;
}

/**
 * Envio do MESMO texto gravado do relatório diário (reenvio da tela ou a nova tentativa do cron): não faz ronda nem monta
 * outro relatório. Mesmo pedido da auditoria ("relatorio:<id>"), mesmo canal da Dolores (só o número do dono, pausa geral,
 * filtros de saída — enviarAvisoAoDono).
 */
async function enviarTextoGravado(p: { relatorioId: number; texto: string; canal: "tela" | "cron"; autor: number | null; prazoFinal: number; resumo: Record<string, unknown> }): Promise<ResultadoRelatorio> {
  const envio = await enviarAvisoAoDono(p.texto, { funcao: "relatorio_envio", pedidoId: `relatorio:${p.relatorioId}`, autor: p.autor, prazoFinal: p.prazoFinal, canal: p.canal,
    resumo: { relatorioId: p.relatorioId, tipo: "diario", reenvio: true, ...p.resumo } });
  return { ok: envio.ok, situacao: envio.ok ? "enviado" : "nao_enviado", motivo: envio.motivo, relatorioId: p.relatorioId };
}

/**
 * Reenvio pela tela do relatório DIÁRIO de hoje cujo envio falhou (achado 3 do QA de segurança): manda o MESMO texto
 * gravado (não faz ronda nem monta outro relatório; o diário continua um só). Janela própria por minuto
 * (dolores_relatorio_reenvios, janela única): clique duplo não manda duas vezes. Já enviado com sucesso → recusa (não
 * duplica no WhatsApp do dono). Mesmas portas do envio: relatório ligado, pausa geral, só o número do dono, filtros de saída.
 */
export async function reenviarRelatorioDoDia(p: { agora: Date; prazoFinal: number; pedidoPorUserId?: number | null }): Promise<ResultadoRelatorio> {
  const config = await lerConfigOperacao();
  if (!config) return { ok: false, situacao: "bloqueado", motivo: "configuração da operação ausente (migração 0131)", relatorioId: null };
  if (!config.relatorioLigado) return { ok: false, situacao: "bloqueado", motivo: "o relatório está desligado (Integrações › Dolores — operação contínua)", relatorioId: null };
  const bloqueio = await bloqueioDaOperacao();
  if (bloqueio) return { ok: false, situacao: "bloqueado", motivo: motivoDoBloqueio(bloqueio.motivo), relatorioId: null };
  const autor = await idDaDoloresSemCriar().catch(() => null);
  let relatorioId: number;
  let texto: string;
  try {
    const [rel] = await getDb().select({ id: doloresRelatorios.id, texto: doloresRelatorios.texto }).from(doloresRelatorios)
      .where(eq(doloresRelatorios.janela, janelaRelatorioDiario(p.agora))).limit(1);
    if (!rel) return { ok: false, situacao: "nao_enviado", motivo: "ainda não há relatório diário de hoje para reenviar", relatorioId: null };
    const envio = await ultimoEnvio(rel.id);
    if (envio?.resultado === "ok") return { ok: false, situacao: "ja_enviado", motivo: "o relatório de hoje já foi enviado ao dono (não é enviado de novo)", relatorioId: rel.id };
    const [reenvio] = await getDb().insert(doloresRelatorioReenvios).values({ relatorioId: rel.id, janela: janelaReenvio(p.agora), pedidoPorUserId: p.pedidoPorUserId ?? null })
      .onConflictDoNothing().returning({ id: doloresRelatorioReenvios.id });
    if (!reenvio) return { ok: false, situacao: "ja_enviado", motivo: "já houve um reenvio neste minuto; aguarde o resultado", relatorioId: rel.id };
    relatorioId = rel.id;
    texto = rel.texto;
  } catch (e) {
    console.error("[dolores/rondas] falha ao preparar o reenvio do relatório", erroParaLog(e));
    return { ok: false, situacao: "nao_enviado", motivo: "não consegui ler o relatório de hoje; nada foi enviado", relatorioId: null };
  }
  return enviarTextoGravado({ relatorioId, texto, canal: "tela", autor, prazoFinal: p.prazoFinal, resumo: { porUserId: p.pedidoPorUserId ?? null } });
}

// ── Cron (/api/cron/dolores) ──────────────────────────────────────────────────────────────────────────────────────

const resumoSha = (s: string) => createHash("sha256").update(s).digest();
/** Segredo do cron da Vercel (CRON_SECRET), em tempo constante. Sem segredo configurado → recusa sempre. */
export function cronAutorizado(cabecalho: unknown, segredo = process.env.CRON_SECRET): boolean {
  if (!segredo || typeof cabecalho !== "string" || !cabecalho) return false;
  return timingSafeEqual(resumoSha(cabecalho), resumoSha(`Bearer ${segredo}`));
}

type Relogio = { agora: () => Date; ms: () => number };
let relogio: Relogio = { agora: () => new Date(), ms: () => Date.now() };
/** Só para testes: o relógio do cron (sem argumento, volta ao real). */
export function definirRelogioCron(r?: Partial<Relogio>) { relogio = r ? { ...relogio, ...r } : { agora: () => new Date(), ms: () => Date.now() }; }

/**
 * O relatório diário de hoje já foi montado? Devolve a linha (id e texto gravado) e o último resultado do envio na auditoria
 * ("relatorio_envio"; null se não há registro ou a auditoria não se leu). Falha ao ler a linha → null: o insert com janela
 * única segura a duplicação.
 */
async function diarioDeHoje(agora: Date): Promise<{ id: number; texto: string; ultimo: Awaited<ReturnType<typeof ultimoEnvio>> | null } | null> {
  let rel: { id: number; texto: string } | undefined;
  try {
    [rel] = await getDb().select({ id: doloresRelatorios.id, texto: doloresRelatorios.texto }).from(doloresRelatorios)
      .where(eq(doloresRelatorios.janela, janelaRelatorioDiario(agora))).limit(1);
  } catch {
    return null;
  }
  if (!rel) return null;
  try {
    return { ...rel, ultimo: await ultimoEnvio(rel.id) };
  } catch {
    return { ...rel, ultimo: null } // auditoria ilegível: sem resultado, sem nova tentativa;
  }
}

/**
 * EPIC-026 C4 — o diário de hoje já foi montado por uma chamada anterior do cron. Último envio "ok" → "ja_enviado". Senão,
 * UMA nova tentativa por dia pelo cron com o MESMO texto gravado (janela única "cron:<dia>" em dolores_relatorio_reenvios,
 * canal "cron"); já tentada, sem resultado registrado (envio ainda em andamento ou auditoria ilegível — não arrisca
 * duplicar) ou sem tempo → "nao_enviado_antes" / "sem-tempo", e fica o botão da tela.
 */
async function novaTentativaDoCron(d: NonNullable<Awaited<ReturnType<typeof diarioDeHoje>>>, agora: Date, prazoFinal: number): Promise<string> {
  if (d.ultimo?.resultado === "ok") return "ja_enviado";
  if (!d.ultimo) return "nao_enviado_antes";
  if (prazoFinal - relogio.ms() < MINIMO_PARA_RELATORIO_MS) return "sem-tempo";
  try {
    const [linha] = await getDb().insert(doloresRelatorioReenvios).values({ relatorioId: d.id, janela: janelaReenvioDoCron(agora), pedidoPorUserId: null })
      .onConflictDoNothing().returning({ id: doloresRelatorioReenvios.id });
    if (!linha) return "nao_enviado_antes";
  } catch (e) {
    console.error("[dolores/rondas] falha ao registrar a nova tentativa do cron", erroParaLog(e));
    return "nao_enviado_antes";
  }
  const autor = await idDaDoloresSemCriar().catch(() => null);
  return (await enviarTextoGravado({ relatorioId: d.id, texto: d.texto, canal: "cron", autor, prazoFinal, resumo: { novaTentativaDoCron: true } })).situacao;
}

/** EPIC-026 C4: a ronda do dia criada há menos disto serve ao relatório (chamadas concorrentes não refazem a ronda). */
const RONDA_RECENTE_MS = 5 * 60_000;

/**
 * Execução do cron, chamada de hora em hora das 07h às 14h de Brasília (EPIC-026 C4: uma entrada diária por hora no
 * vercel.json, todas nesta função). Ignora query, corpo e o fim do caminho (nada do chamador muda o alvo, a janela ou o
 * destino). Ordem: segredo → configuração → pausa → ronda do dia (se ligada; a primeira chamada faz, as outras não repetem)
 * → relatório do dia (se ligado e a hora de Brasília já chegou na escolhida). O diário é montado UMA vez por dia; se o
 * ENVIO falhar, a chamada seguinte do mesmo dia reenvia o MESMO texto gravado, no máximo UMA vez por dia pelo cron (janela
 * "cron:<dia>"): um envio que na verdade saiu chega ao dono no máximo duas vezes; passou disso, fica o botão da tela.
 * "ja_enviado" só quando o último envio registrado foi "ok"; senão "nao_enviado_antes". Quando a ronda do dia é de uma
 * chamada anterior (criada há 5 min ou mais), o relatório usa uma ronda refeita na hora (janela "relatorio:<dia>").
 */
export async function tratarCronDolores(req: Pick<Request, "headers">): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!cronAutorizado(req.headers.authorization)) return { status: 401, body: { error: "Não autorizado" } };
  const inicio = relogio.ms();
  const prazoFinal = inicio + PRAZO_CRON_MS;
  const agora = relogio.agora();
  const r = await rondaDoCron(prazoFinal, agora);
  // QA C5 (B1/B2): alertas de gasto que ficaram pendentes (proposta aberta, sem tempo no aviso, envio que não saiu) saem aqui, no
  // tempo que sobrar — depois da ronda e do relatório. A pausa geral e a conexão são conferidas no envio (enviarAvisoAoDono).
  await enviarAlertasPendentes({ prazoFinal, canal: "cron", agora, relogio: relogio.ms });
  // EPIC-027 C5 (tarefa demorada): rede de segurança do aviso da Evolution — vence/avisa as paradas e, com tempo de sobra, retoma
  // no máximo UMA tarefa do dono (as mesmas travas: pausa, limite, só leitura, só ao número do dono). Nunca lança nem muda a resposta.
  await retomarTarefasDemoradas({ prazoFinal, canal: "cron" }).catch(() => undefined);
  return r;
}

async function rondaDoCron(prazoFinal: number, agora: Date): Promise<{ status: number; body: Record<string, unknown> }> {
  const config = await lerConfigOperacao();
  if (!config) return { status: 200, body: { ok: true, r: "sem-configuracao" } };
  if (!config.rondasLigadas && !config.relatorioLigado) return { status: 200, body: { ok: true, r: "desligada" } };
  const bloqueio = await bloqueioDaOperacao();
  if (bloqueio) {
    await registrarAcao({ funcao: "ronda", resultado: "recusada", motivo: motivoDoBloqueio(bloqueio.motivo),
      autorUserId: await idDaDoloresSemCriar().catch(() => null), canal: "cron", pedidoId: janelaDiaria(agora) });
    return { status: 200, body: { ok: true, r: bloqueio.motivo } };
  }
  if (!config.rondasLigadas) return { status: 200, body: { ok: true, r: "rondas-desligadas" } };
  const ronda = await executarRonda({ janela: janelaDiaria(agora), origem: "cron", agora, prazoFinal, relogio: relogio.ms, config });
  if (!ronda.ok) return { status: 200, body: { ok: false, r: ronda.motivo } };
  let relatorio: string = "desligado";
  if (config.relatorioLigado) {
    if (!relatorioDiarioNaHora(agora, config.relatorioHora)) relatorio = "fora-da-hora";
    else {
      const montado = await diarioDeHoje(agora);
      if (montado) return { status: 200, body: { ok: true, ronda: ronda.nova ? "feita" : "ja-feita", relatorio: await novaTentativaDoCron(montado, agora, prazoFinal) } };
      // EPIC-026 C4: a ronda da manhã foi feita numa chamada anterior (hora escolhida depois dela, ou a chamada da hora falhou)
      // → refaz a ronda na hora do relatório, numa janela própria do dia (só inserção, uma por dia): dados frescos sem repetir.
      // Ronda criada há menos de 5 min (chamada concorrente que perdeu a corrida) → serve, não lê tudo de novo.
      let base = ronda.ronda;
      const idadeMs = relogio.ms() - new Date(ronda.ronda.criadoEm).getTime();
      if (!ronda.nova && idadeMs >= RONDA_RECENTE_MS) {
        if (prazoFinal - relogio.ms() < MINIMO_PARA_RELATORIO_MS) return { status: 200, body: { ok: true, ronda: "ja-feita", relatorio: "sem-tempo" } };
        const fresca = await executarRonda({ janela: janelaRondaDoRelatorio(agora), origem: "cron", agora, prazoFinal, relogio: relogio.ms, config });
        if (fresca.ok) base = fresca.ronda; // não deu: usa a da manhã (o relatório não deixa de sair)
      }
      if (prazoFinal - relogio.ms() < MINIMO_PARA_RELATORIO_MS) relatorio = "sem-tempo";
      else relatorio = (await enviarRelatorio({ tipo: "diario", janela: janelaRelatorioDiario(agora), origem: "cron", ronda: base, agora, prazoFinal, config })).situacao;
    }
  }
  return { status: 200, body: { ok: true, ronda: ronda.nova ? "feita" : "ja-feita", relatorio } };
}

/**
 * Últimas rondas e relatórios para a tela (só contagens e o texto já filtrado do registro) e a situação do relatório DIÁRIO
 * de hoje (gerado? enviado? falhou? — a tela oferece o reenvio do mesmo texto quando falhou).
 */
export async function historicoParaTela(limite = 5, agora = new Date()) {
  const db = getDb();
  const rondas = await db.select({ id: doloresRondas.id, janela: doloresRondas.janela, origem: doloresRondas.origem, criadoEm: doloresRondas.criadoEm,
    duracaoMs: doloresRondas.duracaoMs, totais: doloresRondas.totais, falhas: doloresRondas.falhas }).from(doloresRondas).orderBy(desc(doloresRondas.id)).limit(limite);
  const [relatorio] = await db.select().from(doloresRelatorios).orderBy(desc(doloresRelatorios.id)).limit(1);
  // resultado do envio: a auditoria (função relatorio_envio, pedido "relatorio:<id>")
  const envio = relatorio ? await ultimoEnvio(relatorio.id) : null;
  const [hoje] = await db.select({ id: doloresRelatorios.id, criadoEm: doloresRelatorios.criadoEm }).from(doloresRelatorios)
    .where(eq(doloresRelatorios.janela, janelaRelatorioDiario(agora))).limit(1);
  const envioHoje = hoje ? (hoje.id === relatorio?.id ? envio : await ultimoEnvio(hoje.id)) : null;
  return {
    rondas, ultimoRelatorio: relatorio ? { ...relatorio, envio } : null,
    relatorioDeHoje: hoje ? { id: hoje.id, criadoEm: hoje.criadoEm, envio: envioHoje,
      situacao: !envioHoje ? "sem_registro" as const : envioHoje.resultado === "ok" ? "enviado" as const : "falhou" as const } : null,
  };
}
