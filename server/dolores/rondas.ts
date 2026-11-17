// EPIC-025 (Dolores, etapa 6) — rondas agendadas e relatório (prompt mestre, seções 3 e 4.7: "rondas agendadas (varredura de
// processos e relatório diário)"). Regras fixas deste arquivo:
// - A ronda é uma varredura POR CÓDIGO (sem IA, sem custo): reaproveita as leituras da etapa 1 (mesmos critérios das telas) e
//   conta o que espera a Dolores (fila, documentos dos grupos, notas de obra, banco). Cada seção roda numa transação SOMENTE
//   LEITURA própria (uma seção que falha não derruba as outras e o relatório diz que faltou).
// - O resultado vai para dolores_rondas (só inserção) DEPOIS de montado, com INSERT ... ON CONFLICT (janela) DO NOTHING: a mesma
//   janela não roda duas vezes e a reentrega do cron não duplica (se a janela já existe, nem lê de novo).
// - O relatório é MODELO FIXO (shared/dolores/operacao.ts), montado só com a ronda; gravado em dolores_relatorios (só inserção,
//   janela única: o diário sai UMA vez por dia) e enviado SÓ ao número do dono pelo canal da Dolores, pelos mesmos filtros de
//   saída da conversa (links, dados pessoais conforme o interruptor, segredos e bancários sempre, tamanho). Sem número do dono,
//   sem conexão ou com a pausa geral ligada, nada é enviado.
// - Nada aqui grava em módulo do sistema, cria item na fila, chama a IA ou fala em grupo.
import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { and, desc, eq, gt, gte, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { bankTransactions, leadServices, leads, whatsappMessages } from "../../drizzle/schema.js";
import { doloresAcoes } from "../../drizzle/schema-dolores.js";
import { doloresAprovacoes, doloresAutoria } from "../../drizzle/schema-dolores-fila.js";
import { doloresGrupoMensagens } from "../../drizzle/schema-dolores-grupos.js";
import { obraNotas } from "../../drizzle/schema-dolores-notas.js";
import { doloresEventos, doloresRelatorios, doloresRondas, type DoloresRonda, type OrigemOperacao } from "../../drizzle/schema-dolores-operacao.js";
import {
  HORAS_AVISO_FILA, MAX_DESTAQUES, MAX_EVENTOS_PRAZO_POR_RONDA, janelaDiaria, janelaRelatorioDiario, janelaSobDemanda, montarRelatorio, relatorioDiarioNaHora,
  type DestaquesRonda, type SecaoRonda, type TotaisRonda,
} from "../../shared/dolores/operacao.js";
import { LEAD_FINALIZED_STAGE } from "../../shared/lead-pipeline.js";
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { mesFortaleza } from "../../shared/dolores/whatsapp.js";
import { getDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { lerConfigWhatsapp, usoDoMes } from "./consumo.js";
import { FILTRO_DO_REGISTRO } from "./dados-pessoais.js";
import { erroParaLog } from "./erro-seguro.js";
import { listarAtrasos } from "./leitura/atrasos.js";
import { listarDocumentos } from "./leitura/documentos.js";
import { listarRecebiveisPendentes } from "./leitura/financeiro.js";
import { listarTarefas } from "./leitura/tarefas.js";
import { bancoDaLeitura, emTransacaoSomenteLeitura } from "./somente-leitura.js";
import { bloqueioDaOperacao, lerConfigOperacao, registrarEvento, type ConfigOperacao } from "./operacao.js";
import { idDaDoloresSemCriar } from "./perfil.js";
import { enviarAvisoAoDono } from "./whatsapp.js";
import { DIAS_PARADO_PADRAO } from "../../shared/dolores/regras.js";

/** Prazo da rota do cron (a função da Vercel tem 60 s). */
export const PRAZO_CRON_MS = 45_000;
/** Seção nova só começa com pelo menos isto de folga. */
const MINIMO_POR_SECAO_MS = 3_000;
/** Para enviar o relatório depois da ronda. */
const MINIMO_PARA_RELATORIO_MS = 6_000;

const motivoDoBloqueio = (m: "pausada" | "indisponivel" | "usuaria_desativada") =>
  m === "pausada" ? "Dolores pausada (pausa geral)" : m === "usuaria_desativada" ? "usuária Dolores desativada em Usuários e acesso" : "configuração indisponível";
const limpo = (s: string | null | undefined, max = 80) => {
  const t = sanitizarTexto(String(s ?? ""), FILTRO_DO_REGISTRO).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const contar = (v: unknown) => Number(v ?? 0) || 0;
const reais = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;

type Secao = { totais: Partial<TotaisRonda>; destaques?: Partial<DestaquesRonda>; prazosVencidos?: Array<{ modulo: string; id: number; prazo: string | null }> };
type Ctx = { agora: Date };

const lerSecao = (fn: (c: Ctx) => Promise<Secao>) => (c: Ctx) => emTransacaoSomenteLeitura(() => fn(c));

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
    return { totais: { tarefas: d.totais }, destaques: { tarefas: d.porResponsavel.filter(p => p.atrasadas > 0).slice(0, MAX_DESTAQUES).map(p => ({ responsavel: limpo(p.responsavel, 40), atrasadas: p.atrasadas })) } };
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
  ["grupos", lerSecao(async () => {
    const [r] = await bancoDaLeitura().select({
      aClassificar: sql<number>`count(*) filter (where ${doloresGrupoMensagens.situacao} in ('a_classificar', 'classificando'))`.mapWith(Number),
      aConferir: sql<number>`count(*) filter (where ${doloresGrupoMensagens.situacao} = 'confira')`.mapWith(Number),
      prontos: sql<number>`count(*) filter (where ${doloresGrupoMensagens.situacao} = 'classificado')`.mapWith(Number),
      erro: sql<number>`count(*) filter (where ${doloresGrupoMensagens.situacao} = 'erro')`.mapWith(Number),
    }).from(doloresGrupoMensagens).where(inArray(doloresGrupoMensagens.situacao, ["a_classificar", "classificando", "confira", "classificado", "erro"]));
    return { totais: { grupos: { aClassificar: contar(r?.aClassificar), aConferir: contar(r?.aConferir), prontosParaSalvar: contar(r?.prontos), comErro: contar(r?.erro) } } };
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
    return { totais: { consumo: { mes, entrada: uso.entrada, saida: uso.saida, limiteEntrada: cfg?.limiteMensalTokensEntrada ?? 0, limiteSaida: cfg?.limiteMensalTokensSaida ?? 0 } } };
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
      const r = await ler({ agora: p.agora });
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
  const texto = montarRelatorio({ tipo: p.tipo, geradoEm: p.agora, totais: p.ronda.totais as TotaisRonda, destaques: p.ronda.destaques as DestaquesRonda,
    falhas: p.ronda.falhas ?? [], precos: { entradaMilhao: p.config.precoEntradaMilhao, saidaMilhao: p.config.precoSaidaMilhao } });
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

/** Ronda + relatório sob demanda (tela ou comando do dono): uma janela por minuto. Exige o relatório ligado. */
export async function relatorioSobDemanda(p: { origem: "tela" | "whatsapp"; agora: Date; prazoFinal: number; relogio: () => number; pedidoPorUserId?: number | null }): Promise<ResultadoRelatorio> {
  const config = await lerConfigOperacao();
  if (!config) return { ok: false, situacao: "bloqueado", motivo: "configuração da operação ausente (migração 0131)", relatorioId: null };
  if (!config.relatorioLigado) return { ok: false, situacao: "bloqueado", motivo: "o relatório está desligado (Integrações › Dolores — operação contínua)", relatorioId: null };
  const janela = janelaSobDemanda(p.agora);
  const r = await executarRonda({ janela, origem: p.origem, agora: p.agora, prazoFinal: p.prazoFinal, relogio: p.relogio, config });
  if (!r.ok) return { ok: false, situacao: "bloqueado", motivo: r.motivo === "pausada" ? "Dolores pausada (pausa geral)" : "não consegui fazer a ronda agora", relatorioId: null };
  if (p.prazoFinal - p.relogio() < MINIMO_PARA_RELATORIO_MS) return { ok: false, situacao: "nao_enviado", motivo: "sem tempo para enviar dentro do prazo", relatorioId: null };
  return enviarRelatorio({ tipo: "sob_demanda", janela, origem: p.origem, ronda: r.ronda, agora: p.agora, prazoFinal: p.prazoFinal, config, pedidoPorUserId: p.pedidoPorUserId });
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
 * Execução diária. Ignora query e corpo (nada do chamador muda o alvo, a janela ou o destino). Ordem: segredo → configuração →
 * pausa → ronda do dia (se ligada) → relatório do dia (se ligado e já na hora; uma vez por dia).
 */
export async function tratarCronDolores(req: Pick<Request, "headers">): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!cronAutorizado(req.headers.authorization)) return { status: 401, body: { error: "Não autorizado" } };
  const inicio = relogio.ms();
  const prazoFinal = inicio + PRAZO_CRON_MS;
  const agora = relogio.agora();
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
    else if (prazoFinal - relogio.ms() < MINIMO_PARA_RELATORIO_MS) relatorio = "sem-tempo";
    else relatorio = (await enviarRelatorio({ tipo: "diario", janela: janelaRelatorioDiario(agora), origem: "cron", ronda: ronda.ronda, agora, prazoFinal, config })).situacao;
  }
  return { status: 200, body: { ok: true, ronda: ronda.nova ? "feita" : "ja-feita", relatorio } };
}

/** Últimas rondas e relatórios para a tela (só contagens e o texto já filtrado do registro). */
export async function historicoParaTela(limite = 5) {
  const db = getDb();
  const rondas = await db.select({ id: doloresRondas.id, janela: doloresRondas.janela, origem: doloresRondas.origem, criadoEm: doloresRondas.criadoEm,
    duracaoMs: doloresRondas.duracaoMs, totais: doloresRondas.totais, falhas: doloresRondas.falhas }).from(doloresRondas).orderBy(desc(doloresRondas.id)).limit(limite);
  const [relatorio] = await db.select().from(doloresRelatorios).orderBy(desc(doloresRelatorios.id)).limit(1);
  // resultado do envio: a auditoria (função relatorio_envio, pedido "relatorio:<id>")
  const [envio] = relatorio ? await db.select({ resultado: doloresAcoes.resultado, motivo: doloresAcoes.motivo, criadoEm: doloresAcoes.criadoEm }).from(doloresAcoes)
    .where(and(eq(doloresAcoes.funcao, "relatorio_envio"), eq(doloresAcoes.pedidoId, `relatorio:${relatorio.id}`))).orderBy(desc(doloresAcoes.id)).limit(1) : [];
  return { rondas, ultimoRelatorio: relatorio ? { ...relatorio, envio: envio ?? null } : null };
}

