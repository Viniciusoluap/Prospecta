// EPIC-025 (Dolores, etapa 2) — comando e resposta pelo WhatsApp da Dolores.
//   POST /api/dolores/whatsapp  ← avisos da Evolution SÓ da instância da Dolores (prospecta-dolores)
// Autenticação: cabeçalho `x-webhook-token` = HMAC do segredo do servidor com rótulo próprio (diferente do webhook da
// Central), comparado em tempo constante. Depois: só a instância da Dolores; grupos, status e as mensagens dela mesma são
// ignorados; mensagem antiga (reentrega) não vira comando; a mesma mensagem (instância + id) só é tratada uma vez
// (dolores_mensagens, índice único). Comando só do número do dono (configuração, comparação normalizada); de outro
// número, nada responde e nada chama a IA — só a auditoria. A IA só roda com chave do painel + modelo + interruptor da
// Dolores + limite definido e não atingido + sem pausa + usuária ativa; senão, frase fixa (cerebro.ts nem é chamado).
// Como na Central de Vendas, tudo roda dentro do próprio aviso (a função da Vercel não continua depois da resposta),
// com prazo total abaixo dos 60 s; a Evolution reenviar o aviso não duplica nada.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { doloresMensagens, doloresRemetentesEstranhos, doloresWhatsappConfig, type DoloresWhatsappConfig, type SituacaoMensagem } from "../../drizzle/schema-dolores-whatsapp.js";
import { tratarLinksDaResposta } from "../../shared/dolores/links.js";
import { sanitizarTexto } from "../../shared/dolores/sanitizar.js";
import { FILTRO_DO_REGISTRO, filtroDaSaida } from "./dados-pessoais.js";
import {
  FRASE_ENCAMINHADA, FRASE_ERRO, FRASE_OUTRO_PEDIDO, FRASE_SO_TEXTO, MAX_TEXTO_COMANDO, fraseSemTempo, bloqueioDoLimite, cortarResposta, ehNumeroDoDono, fraseDeBloqueio,
  lerMensagemEvolution, mascararNumero, mensagemAntiga, mesFortaleza, type MotivoBloqueio,
} from "../../shared/dolores/whatsapp.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { enviarTextoEvolution } from "../_core/evolution.js";
import { getDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { erroParaLog } from "./erro-seguro.js";
import { FOLGA_FINAL_MS, MINIMO_PARA_CHAMAR_MS, executarComando } from "./cerebro.js";
import { lerConfigWhatsapp, lerPausa, marcarAvisoDoMes, usoDoMes } from "./consumo.js";
import { DoloresDesativada, idDaDoloresSemCriar, usuarioDolores } from "./perfil.js";
import { MAX_CARACTERES_WHATSAPP } from "../../shared/dolores/whatsapp.js";
import { lerDecisaoDoDono, quadroDePendencias, quadroDoQueFoiFeito } from "../../shared/dolores/fila.js";
import { decidir, feitosDoPedido, itensAguardandoDoPedido } from "./aprovacoes.js";

/** Prazo do laço + envio, com folga para os 60 s da função da Vercel. */
export const PRAZO_TOTAL_MS = 45_000;
/** Prazo máximo de um envio pela Evolution (sempre cortado pelo que resta do prazo total do aviso). */
const PRAZO_ENVIO_MS = 8_000;
/** Com menos que isto até o fim do prazo do aviso, não se tenta enviar (o envio não caberia). */
export const MINIMO_PARA_ENVIAR_MS = 1_500;
/** Para tratar um comando (laço + envio) é preciso ao menos isto; com menos, só a frase fixa de "mande de novo". */
export const MINIMO_PARA_COMANDO_MS = MINIMO_PARA_CHAMAR_MS + FOLGA_FINAL_MS + 1_000;
/** Para a frase fixa de "mande de novo" (registro + envio); com menos, a mensagem nem é reivindicada. */
export const MINIMO_PARA_RECUSAR_MS = 3_000;
/**
 * QA r2 N4: pedido do dono que chegou sem tempo nem para a frase fixa. Fica "processando" com este motivo e a recuperação
 * do próximo aviso (sem esperar os 3 min) diz ao dono que não deu para atender o pedido daquela hora.
 */
export const MOTIVO_SEM_TEMPO_NO_AVISO = "sem tempo no prazo do aviso; aguardando o aviso de mandar de novo";
/** Itens por aviso tratados (a Evolution manda um por vez; lote grande é histórico). */
const MAX_ITENS = 20;
const MAX_FALHAS_AUTH = 20;
/** Linha "processando" mais velha que isto = a função morreu no meio (a da Vercel é encerrada aos 60 s). */
export const PROCESSANDO_VENCIDO_MS = 3 * 60_000;

const SITE = () => (process.env.PUBLIC_SITE_URL || "https://www.prospectaconstrucoes.com").replace(/\/+$/, "");
/**
 * QA r7 A2: domínio do sistema para a lista permitida de links da resposta — SÓ a variável PUBLIC_SITE_URL (a mesma do
 * endereço do aviso). Sem ela, nenhum link do sistema passa (só trello.com).
 */
const urlDoSistemaParaLinks = () => process.env.PUBLIC_SITE_URL?.trim() || null;
export const URL_WEBHOOK_DOLORES = () => `${SITE()}/api/dolores/whatsapp`;

/** Segredo do aviso da Dolores: derivado do segredo do servidor com rótulo próprio (nunca vai para log nem para a tela). */
export function segredoWebhookDolores(): string {
  if (!ENV.cookieSecret) throw new Error("JWT_SECRET ausente.");
  return createHmac("sha256", ENV.cookieSecret).update("dolores-whatsapp-webhook").digest("hex");
}
const resumoSha = (s: string) => createHash("sha256").update(s).digest();
/** Tempo constante e sem vazar o tamanho (hash dos dois lados). */
export function segredoConfere(recebido: unknown): boolean {
  if (typeof recebido !== "string" || !recebido || !ENV.cookieSecret) return false;
  return timingSafeEqual(resumoSha(recebido), resumoSha(segredoWebhookDolores()));
}

// ── Dependências substituíveis nos testes (relógio, envio, Evolution) ──
export type EnvioWhatsapp = (p: { instancia: string; numero: string; texto: string; prazoMs: number }) => Promise<boolean>;
const envioPadrao: EnvioWhatsapp = async ({ instancia, numero, texto, prazoMs }) => {
  const { configEvolution } = await import("../whatsapp-router.js");
  const c = await configEvolution();
  if (!c) return false;
  const comPrazo: typeof fetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(prazoMs) });
  // QA r7 A2: sem prévia de link (a Evolution não busca a URL de ninguém)
  return Boolean(await enviarTextoEvolution(c, instancia, numero, texto, comPrazo, { linkPreview: false }));
};
/** `agora`: data (mês, idade da mensagem); `ms`: relógio do prazo de 60 s (um só para o aviso inteiro). */
type Dependencias = { agora: () => Date; enviar: EnvioWhatsapp; ms: () => number };
const padrao: Dependencias = { agora: () => new Date(), enviar: envioPadrao, ms: () => Date.now() };
let deps: Dependencias = { ...padrao };
export function definirDependenciasWhatsapp(d?: Partial<Dependencias>) { deps = d ? { ...deps, ...d } : { ...padrao }; esquecerEstranhasVistas(); }

const falhas = new Map<string, { janela: number; total: number }>();
function contarFalha(ip: string, agora: Date): boolean {
  const janela = Math.floor(agora.getTime() / 60_000);
  const f = falhas.get(ip);
  const total = f && f.janela === janela ? f.total + 1 : 1;
  falhas.set(ip, { janela, total });
  if (falhas.size > 5000) falhas.clear();
  return total > MAX_FALHAS_AUTH;
}

/** QA achado 7: só a causa, sem a consulta e os parâmetros do Drizzle (que podem trazer o comando do dono). */
const erroCurto = erroParaLog;

async function atualizarMensagem(id: number, dados: Partial<{ situacao: SituacaoMensagem; motivo: string | null; respondidaEm: Date; voltas: number; tokensEntrada: number; tokensSaida: number }>) {
  try { await getDb().update(doloresMensagens).set({ ...dados, motivo: dados.motivo?.slice(0, 300) ?? dados.motivo }).where(eq(doloresMensagens.id, id)); }
  catch (e) { console.error("[dolores/whatsapp] falha ao atualizar a mensagem", erroCurto(e)); }
}

/**
 * Resposta ao dono. O destino é o número que acabou de ser conferido como o do dono — e é conferido DE NOVO aqui:
 * nenhum texto (do modelo, de ferramenta ou de mensagem) escolhe para quem a Dolores escreve.
 */
async function responderAoDono(cfg: DoloresWhatsappConfig, numero: string, texto: string, ctx: { mensagemId: number; autor: number | null; resumo: Record<string, unknown>; prazoFinal: number }) {
  if (!ehNumeroDoDono(numero, cfg.numeroDono) || !cfg.instancia) {
    await registrarAcao({ funcao: "whatsapp_resposta", resultado: "recusada", motivo: "destino não é o número do dono", autorUserId: ctx.autor, canal: "whatsapp", pedidoId: `wa:${ctx.mensagemId}` });
    return false;
  }
  // QA r7 A2: link fora da lista permitida (o domínio do sistema, PUBLIC_SITE_URL, e trello.com) vira "[link removido]";
  // os permitidos vão sem consulta nem fragmento. Depois, o filtro: dados pessoais seguem o interruptor (opção B do
  // dono); senhas, chaves e dados bancários saem sempre.
  const final = cortarResposta(sanitizarTexto(tratarLinksDaResposta(texto, urlDoSistemaParaLinks()), filtroDaSaida("whatsapp")));
  const resumo = { caracteres: final.length, destino: mascararNumero(numero), ...ctx.resumo };
  // QA achado 5: o envio cabe no prazo ÚNICO do aviso (nunca 8 s fixos por item além dele).
  const restante = ctx.prazoFinal - deps.ms();
  if (restante < MINIMO_PARA_ENVIAR_MS) {
    await registrarAcao({ funcao: "whatsapp_resposta", resultado: "erro", motivo: "sem tempo para enviar dentro do prazo do aviso", autorUserId: ctx.autor, canal: "whatsapp", pedidoId: `wa:${ctx.mensagemId}`, resumo });
    return false;
  }
  const inicio = deps.ms();
  let ok = false;
  let motivo: string | null = null;
  try { ok = await deps.enviar({ instancia: cfg.instancia, numero: numero.replace(/\D/g, ""), texto: final, prazoMs: Math.min(PRAZO_ENVIO_MS, restante) }); if (!ok) motivo = "a Evolution não aceitou a mensagem (ou o servidor não está configurado)"; }
  catch (e) { motivo = `falha no envio: ${erroCurto(e)}`; }
  await registrarAcao({ funcao: "whatsapp_resposta", resultado: ok ? "ok" : "erro", motivo, autorUserId: ctx.autor, canal: "whatsapp", pedidoId: `wa:${ctx.mensagemId}`,
    duracaoMs: deps.ms() - inicio, resumo });
  return ok;
}

/**
 * Por que a IA não pode rodar agora (ordem: pausa antes de tudo; nada aqui chama a Anthropic). É o ÚNICO ponto do sistema
 * que lê a chave da Anthropic do painel (o nome da função aparece só no import e na chamada abaixo), e só depois da pausa e do interruptor da IA.
 */
async function bloqueioAtual(cfg: DoloresWhatsappConfig, mes: string): Promise<
  { motivo: MotivoBloqueio; detalhe?: string | null } | { motivo: null; apiKey: string; modelo: string; autor: number }> {
  const pausa = await lerPausa();
  if (!pausa) return { motivo: "indisponivel" };
  if (pausa.pausada) return { motivo: "pausada", detalhe: pausa.motivo };
  if (!cfg.iaLigada) return { motivo: "ia_desligada" };
  const painel = await configuracaoAnthropicPainel().catch(() => null);
  if (!painel) return { motivo: "sem_chave" };
  const modelo = cfg.modelo?.trim() || painel.modelo?.trim() || null;
  if (!modelo) return { motivo: "sem_modelo" };
  const limite = bloqueioDoLimite(await usoDoMes(mes), { entrada: cfg.limiteMensalTokensEntrada, saida: cfg.limiteMensalTokensSaida });
  if (limite) return { motivo: limite };
  try {
    const autor = await usuarioDolores();
    return { motivo: null, apiKey: painel.apiKey, modelo, autor };
  } catch (e) {
    return { motivo: e instanceof DoloresDesativada ? "usuaria_desativada" : "indisponivel" };
  }
}

async function tratarComando(cfg: DoloresWhatsappConfig, msg: { id: number; numero: string; texto: string; temMidia: boolean; encaminhada: boolean }, prazoFinal: number, autorInicial: number | null) {
  const agora = deps.agora();
  const mes = mesFortaleza(agora);
  let autor = autorInicial;
  await registrarAcao({ funcao: "whatsapp_mensagem", resultado: "ok", motivo: "comando do dono", autorUserId: autor, canal: "whatsapp", pedidoId: `wa:${msg.id}`,
    resumo: { caracteres: msg.texto.length, midia: msg.temMidia, encaminhada: msg.encaminhada } });
  // QA achado 6: texto encaminhado é de terceiro — não vira ordem, nem quando vem do dono
  if (msg.encaminhada) {
    await responderAoDono(cfg, msg.numero, FRASE_ENCAMINHADA, { mensagemId: msg.id, autor, resumo: { bloqueio: "encaminhada" }, prazoFinal });
    await atualizarMensagem(msg.id, { situacao: "bloqueada", motivo: "mensagem encaminhada", respondidaEm: deps.agora() });
    return "encaminhada";
  }
  if (!msg.texto) {
    await responderAoDono(cfg, msg.numero, FRASE_SO_TEXTO, { mensagemId: msg.id, autor, resumo: { bloqueio: "so_texto" }, prazoFinal });
    await atualizarMensagem(msg.id, { situacao: "bloqueada", motivo: "sem texto", respondidaEm: deps.agora() });
    return "so-texto";
  }
  // Etapa 3 — decisão da fila: reconhecida por CÓDIGO (a mensagem inteira é "aprovar CÓDIGO"/"recusar CÓDIGO"), nunca
  // pelo modelo. Só chega aqui mensagem do número do dono, não encaminhada e sem mídia. Não chama a IA (nem gasta).
  const decisao = msg.temMidia ? null : lerDecisaoDoDono(msg.texto);
  if (decisao) {
    let texto: string;
    try {
      const r = await decidir(decisao.codigos, decisao.decisao, { via: "whatsapp", userId: null, agora: deps.agora(), prazoFinal: prazoFinal - FOLGA_FINAL_MS, relogio: deps.ms, mensagemId: msg.id });
      texto = `Dolores:\n${r.map(x => x.texto).join("\n")}`;
    } catch (e) {
      console.error("[dolores/whatsapp] falha ao decidir itens da fila", erroCurto(e));
      texto = "Dolores: não consegui registrar a decisão agora; nada foi executado. Tente de novo em instantes.";
    }
    await responderAoDono(cfg, msg.numero, texto, { mensagemId: msg.id, autor, resumo: { decisao: decisao.decisao, codigos: decisao.codigos.length }, prazoFinal });
    await atualizarMensagem(msg.id, { situacao: "respondida", motivo: `decisão da fila: ${decisao.decisao}`, respondidaEm: deps.agora() });
    return `decisao:${decisao.decisao}`;
  }
  let estado: Awaited<ReturnType<typeof bloqueioAtual>>;
  try { estado = await bloqueioAtual(cfg, mes); }
  catch (e) { console.error("[dolores/whatsapp] falha ao conferir a configuração", erroCurto(e)); estado = { motivo: "indisponivel" }; }
  if (estado.motivo !== null) {
    let frase = fraseDeBloqueio(estado.motivo, estado.motivo === "pausada" ? estado.detalhe : null);
    // Limite mensal: o aviso completo sai uma vez por mês; depois, só a frase curta a cada pedido.
    if (estado.motivo === "limite_mensal" && (await marcarAvisoDoMes(mes).catch(() => false))) {
      const uso = await usoDoMes(mes);
      frase += ` Uso do mês ${mes}: ${uso.entrada.toLocaleString("pt-BR")} tokens de entrada (limite ${cfg.limiteMensalTokensEntrada.toLocaleString("pt-BR")}) e ${uso.saida.toLocaleString("pt-BR")} de saída (limite ${cfg.limiteMensalTokensSaida.toLocaleString("pt-BR")}).`;
    }
    await responderAoDono(cfg, msg.numero, frase, { mensagemId: msg.id, autor, resumo: { bloqueio: estado.motivo }, prazoFinal });
    await atualizarMensagem(msg.id, { situacao: "bloqueada", motivo: estado.motivo, respondidaEm: deps.agora() });
    return `bloqueada:${estado.motivo}`;
  }
  autor = estado.autor;
  try {
    const r = await executarComando({
      comando: msg.texto, mensagemId: msg.id, apiKey: estado.apiKey, modelo: estado.modelo, mes, prazoFinal, relogio: deps.ms,
      limites: { entrada: cfg.limiteMensalTokensEntrada, saida: cfg.limiteMensalTokensSaida },
    });
    let texto = r.texto;
    // QA r2 N3: barrado só pela reserva de outro pedido em andamento — frase própria, sem gastar o aviso do mês.
    if (r.parou === "outro_pedido" && r.voltas === 0) texto = FRASE_OUTRO_PEDIDO;
    if (r.parou === "limite_mensal" && (await marcarAvisoDoMes(mes).catch(() => false))) texto += `\n\n${fraseDeBloqueio("limite_mensal")}`;
    texto = await anexarQuadros(msg.id, texto, r.codigosNaFila);
    const ok = await responderAoDono(cfg, msg.numero, texto, { mensagemId: msg.id, autor, resumo: { voltas: r.voltas, consultas: r.consultas.length, parou: r.parou, tokensEntrada: r.tokens.entrada, tokensSaida: r.tokens.saida }, prazoFinal });
    await atualizarMensagem(msg.id, { situacao: ok ? "respondida" : "erro", motivo: r.parou ?? (ok ? null : "envio falhou"), respondidaEm: deps.agora(), voltas: r.voltas, tokensEntrada: r.tokens.entrada, tokensSaida: r.tokens.saida });
    return ok ? "respondida" : "erro-envio";
  } catch (e) {
    console.error("[dolores/whatsapp] falha no laço", erroCurto(e));
    await registrarAcao({ funcao: "whatsapp_mensagem", resultado: "erro", motivo: erroCurto(e), autorUserId: autor, canal: "whatsapp", pedidoId: `wa:${msg.id}` });
    await responderAoDono(cfg, msg.numero, FRASE_ERRO, { mensagemId: msg.id, autor, resumo: { erro: true }, prazoFinal });
    await atualizarMensagem(msg.id, { situacao: "erro", motivo: erroCurto(e), respondidaEm: deps.agora() });
    return "erro";
  }
}

/** "16/11 09:05" no horário de Imperatriz (UTC−3 fixo). */
const diaEHora = (d: Date) => {
  const s = new Date(d.getTime() - 3 * 60 * 60_000).toISOString();
  return `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`;
};

/**
 * Etapa 3 — quadros DETERMINÍSTICOS no fim da resposta: o que a Dolores gravou direto por este comando e o que ficou na
 * fila, com o código de cada item (lidos do banco; o texto do modelo nunca escolhe código nem resumo). Os quadros têm
 * prioridade sobre o texto do modelo no limite de tamanho.
 */
async function anexarQuadros(mensagemId: number, texto: string, codigosNaFila: readonly string[] = []): Promise<string> {
  const [pendentes, feitos] = await Promise.all([
    itensAguardandoDoPedido(mensagemId, codigosNaFila).catch(e => { console.error("[dolores/whatsapp] falha ao ler a fila", erroCurto(e)); return []; }),
    feitosDoPedido(mensagemId).catch(e => { console.error("[dolores/whatsapp] falha ao ler a autoria", erroCurto(e)); return []; }),
  ]);
  // QA R2 M5: nada é cortado no fim. A fila tem prioridade (itens inteiros enquanto couberem, depois "e mais N"), o quadro
  // do que foi feito usa o que sobra, e o texto do modelo fica com o resto (no mínimo 200 caracteres). Já sai pelo filtro
  // de dados pessoais aqui, para o tamanho medido ser o que vai (o filtro de novo, na saída, não muda nada).
  const MINIMO_TEXTO = 200;
  const FOLGA = 60;
  const fila = sanitizarTexto(quadroDePendencias(pendentes, diaEHora, MAX_CARACTERES_WHATSAPP - MINIMO_TEXTO - 300 - FOLGA));
  const feito = sanitizarTexto(quadroDoQueFoiFeito(feitos, MAX_CARACTERES_WHATSAPP - MINIMO_TEXTO - FOLGA - (fila ? fila.length + 2 : 0)));
  const quadros = [feito, fila].filter(Boolean).join("\n\n");
  if (!quadros) return texto;
  const espaco = Math.max(MINIMO_TEXTO, MAX_CARACTERES_WHATSAPP - quadros.length - 4 - FOLGA);
  return `${cortarResposta(sanitizarTexto(texto), espaco)}\n\n${quadros}`;
}

/** "09:05" no horário de Imperatriz (UTC−3 fixo). */
const horaFortaleza = (d: Date) => new Date(d.getTime() - 3 * 60 * 60_000).toISOString().slice(11, 16);

/**
 * QA achado 4 — pedido do dono que ficou "processando" (a função morreu no meio): na próxima entrada (qualquer aviso de
 * mensagem, inclusive a reentrega dele), a linha vira "erro" numa só instrução condicional (só um aviso a reivindica) e o
 * dono recebe UMA mensagem fixa pedindo para mandar de novo. O pedido não é refeito (nada de gasto em dobro) e a reserva
 * do limite é solta.
 */
async function recuperarPedidosInterrompidos(cfg: DoloresWhatsappConfig, autor: number | null, prazoFinal: number): Promise<number> {
  if (!cfg.instancia || !cfg.numeroDono) return 0;
  let vencidas: Array<{ id: number; enviadaEm: Date | null; criadoEm: Date }>;
  try {
    vencidas = await getDb().update(doloresMensagens)
      .set({ situacao: "erro", motivo: "interrompido no meio (a função parou); o dono foi avisado para mandar de novo", respondidaEm: deps.agora(),
        reservaEntrada: 0, reservaSaida: 0, reservaAte: null })
      .where(and(eq(doloresMensagens.instancia, cfg.instancia), eq(doloresMensagens.doDono, true), eq(doloresMensagens.situacao, "processando"),
        or(lt(doloresMensagens.criadoEm, sql`now() - make_interval(secs => ${PROCESSANDO_VENCIDO_MS / 1000})`), eq(doloresMensagens.motivo, MOTIVO_SEM_TEMPO_NO_AVISO))))
      .returning({ id: doloresMensagens.id, enviadaEm: doloresMensagens.enviadaEm, criadoEm: doloresMensagens.criadoEm });
  } catch (e) {
    console.error("[dolores/whatsapp] falha ao conferir pedidos interrompidos", erroCurto(e));
    return 0;
  }
  if (!vencidas.length) return 0;
  const horas = Array.from(new Set(vencidas.map(v => horaFortaleza(v.enviadaEm ?? v.criadoEm)))).slice(0, 5);
  const texto = horas.length === 1
    ? `Dolores: não consegui terminar o pedido de ${horas[0]}. Nada foi alterado no sistema; mande de novo, por favor.`
    : `Dolores: não consegui terminar os pedidos de ${horas.join(", ")}. Nada foi alterado no sistema; mande de novo, por favor.`;
  await responderAoDono(cfg, cfg.numeroDono, texto, { mensagemId: vencidas[0].id, autor, resumo: { interrompidos: vencidas.length }, prazoFinal });
  return vencidas.length;
}

/**
 * Remetente que não é o dono: auditoria LIMITADA — a contagem por remetente e hora fica em dolores_remetentes_estranhos
 * (uma instrução atômica: INSERT … ON CONFLICT DO UPDATE) e dolores_acoes (que só aceita inserção) recebe UMA linha por
 * remetente por hora, a da primeira mensagem, apontando para a contagem. Spam não infla a auditoria. O remetente aparece
 * só mascarado; a chave é um resumo HMAC (segredo do servidor) do número, que não se reverte por tentativa.
 */
async function auditarRemetenteEstranho(numero: string | null, autor: number | null, caracteres: number) {
  const hora = deps.agora().toISOString().slice(0, 13); // janela de uma hora (UTC)
  const chave = createHmac("sha256", ENV.cookieSecret).update(`dolores-remetente:${numero ?? "(sem número)"}`).digest("hex").slice(0, 16);
  const remetente = numero ? mascararNumero(numero) : null;
  let mensagens: number;
  try {
    const [r] = await getDb().insert(doloresRemetentesEstranhos).values({ chave, hora, remetente })
      .onConflictDoUpdate({ target: [doloresRemetentesEstranhos.chave, doloresRemetentesEstranhos.hora],
        set: { mensagens: sql`${doloresRemetentesEstranhos.mensagens} + 1`, ultimaEm: sql`now()` } })
      .returning({ mensagens: doloresRemetentesEstranhos.mensagens });
    mensagens = Number(r?.mensagens ?? 1);
  } catch (e) {
    console.error("[dolores/whatsapp] falha ao contar o remetente não autorizado", erroCurto(e));
    mensagens = 1; // sem a contagem, audita (melhor uma linha a mais do que nenhuma)
  }
  if (mensagens !== 1) return;
  await registrarAcao({ funcao: "whatsapp_mensagem", resultado: "recusada",
    motivo: numero ? "remetente não autorizado (não é o número do dono); sem resposta" : "remetente sem número conferível; sem resposta",
    autorUserId: autor, canal: "whatsapp", pedidoId: `wa:estranho:${chave}:${hora}`,
    resumo: { remetente, janela: `${hora}h UTC`, caracteres, contagem: "dolores_remetentes_estranhos (uma linha por remetente por hora)" } });
}

/** Memória curta das mensagens de estranhos já contadas (instância + id), com tamanho fixo: não cresce com spam. */
const MAX_ESTRANHAS_LEMBRADAS = 2000;
const estranhasVistas = new Set<string>();
function jaVistaDeEstranho(instancia: string, externalId: string): boolean {
  const k = `${instancia}\u0000${externalId}`;
  if (estranhasVistas.has(k)) return true;
  estranhasVistas.add(k);
  if (estranhasVistas.size > MAX_ESTRANHAS_LEMBRADAS) estranhasVistas.delete(estranhasVistas.values().next().value as string);
  return false;
}
/** Só para testes: esquece a memória curta de mensagens de estranhos. */
export function esquecerEstranhasVistas() { estranhasVistas.clear(); }

export type RespostaWebhook = { status: number; body: Record<string, unknown> };
type Pedido = Pick<Request, "headers" | "body" | "ip">;

export async function tratarWebhookDolores(req: Pedido): Promise<RespostaWebhook> {
  const inicio = deps.ms();
  const agora = deps.agora();
  if (!ENV.cookieSecret) { console.warn("[dolores/whatsapp] aviso recusado: segredo do servidor ausente"); return { status: 503, body: { ok: false } }; }
  if (!segredoConfere(req.headers["x-webhook-token"])) {
    const ip = String(req.ip ?? "?");
    console.warn("[dolores/whatsapp] aviso sem segredo válido", ip);
    return contarFalha(ip, agora) ? { status: 429, body: { error: "Muitas tentativas" } } : { status: 401, body: { error: "Não autorizado" } };
  }
  const ev = (req.body ?? {}) as { event?: unknown; instance?: unknown; data?: any };
  const evento = String(ev.event ?? "").toLowerCase().replace(/_/g, ".");
  let cfg: DoloresWhatsappConfig | null;
  try { cfg = await lerConfigWhatsapp(); }
  catch (e) { console.error("[dolores/whatsapp] configuração indisponível", erroCurto(e)); return { status: 200, body: { ok: false, r: "configuracao-indisponivel" } }; }
  if (!cfg?.instancia || ev.instance !== cfg.instancia) return { status: 200, body: { ok: true, r: "instancia-desconhecida" } };

  if (evento === "connection.update") {
    const st = ev.data?.state;
    const status = st === "open" ? "conectado" : st === "connecting" ? "aguardando_qr" : "desconectado";
    await getDb().update(doloresWhatsappConfig).set({ statusConexao: status }).where(eq(doloresWhatsappConfig.id, 1)).catch(() => undefined);
    return { status: 200, body: { ok: true, r: "conexao" } };
  }
  if (evento !== "messages.upsert") return { status: 200, body: { ok: true, r: "ignorado" } };

  const itens = (Array.isArray(ev.data) ? ev.data : [ev.data]).slice(0, MAX_ITENS);
  const prazoFinal = inicio + PRAZO_TOTAL_MS;
  const contagem: Record<string, number> = {};
  const contar = (k: string) => { contagem[k] = (contagem[k] ?? 0) + 1; };
  let semTempoReivindicadas = 0;
  const autor = await idDaDoloresSemCriar().catch(() => null);
  const interrompidos = await recuperarPedidosInterrompidos(cfg, autor, prazoFinal);
  if (interrompidos) contagem.interrompida = interrompidos;
  for (const item of itens) {
    const m = lerMensagemEvolution(item);
    if (m.tipo === "ignorar") { contar(m.motivo); continue; }
    if (mensagemAntiga(m.enviadaEm, deps.agora())) { contar("antiga"); continue; }
    const doDono = ehNumeroDoDono(m.numero, cfg.numeroDono);
    // QA achado 5: um prazo só para o aviso inteiro. QA r2 N4: sem tempo nem para a frase fixa, a mensagem é ao menos
    // REIVINDICADA ("processando" com motivo próprio) — a recuperação do próximo aviso avisa o dono para mandar de novo.
    const semTempoNenhum = doDono && prazoFinal - deps.ms() < MINIMO_PARA_RECUSAR_MS;
    // QA r2 N8: remetente que não é o dono NÃO grava linha em dolores_mensagens (spam não cresce a tabela sem limite).
    // Só a contagem por remetente e hora (dolores_remetentes_estranhos) e uma linha de auditoria por remetente/hora. A
    // reentrega da mesma mensagem é descartada por uma memória curta (por instância do servidor; se escapar, só soma 1
    // na contagem — nada responde, nada chama a IA).
    if (!doDono) {
      if (jaVistaDeEstranho(cfg.instancia, m.externalId)) { contar("repetida"); continue; }
      await auditarRemetenteEstranho(m.numero, autor, m.texto.length);
      contar("nao-autorizado"); continue;
    }
    // Reivindica a mensagem: só quem gravar primeiro trata (reentrega e avisos paralelos não duplicam resposta nem gasto).
    let id: number | null = null;
    try {
      const [linha] = await getDb().insert(doloresMensagens).values({
        instancia: cfg.instancia, externalId: m.externalId, remetente: m.numero ? mascararNumero(m.numero) : "(sem número)", doDono: true,
        situacao: "processando", motivo: semTempoNenhum ? MOTIVO_SEM_TEMPO_NO_AVISO : null,
        // gravado no banco: sempre mascarado, qualquer que seja o interruptor
        texto: sanitizarTexto(m.texto, FILTRO_DO_REGISTRO).slice(0, MAX_TEXTO_COMANDO) || null, enviadaEm: m.enviadaEm,
      }).onConflictDoNothing().returning({ id: doloresMensagens.id });
      id = linha?.id ?? null;
    } catch (e) {
      console.error("[dolores/whatsapp] falha ao registrar a mensagem", erroCurto(e));
      contar("erro"); continue; // sem o registro (idempotência) não há resposta: falha fechada
    }
    if (!id) { contar("repetida"); continue; }
    if (semTempoNenhum) { contar("sem-tempo"); semTempoReivindicadas++; continue; }
    if (prazoFinal - deps.ms() < MINIMO_PARA_COMANDO_MS) {
      // vários comandos no mesmo aviso: este não cabe mais no prazo — frase fixa, sem IA
      const hora = horaFortaleza(m.enviadaEm ?? deps.agora());
      await responderAoDono(cfg, m.numero!, fraseSemTempo(hora), { mensagemId: id, autor, resumo: { bloqueio: "sem_tempo" }, prazoFinal });
      await atualizarMensagem(id, { situacao: "bloqueada", motivo: "sem tempo no prazo do aviso", respondidaEm: deps.agora() });
      contar("sem-tempo"); continue;
    }
    contar(await tratarComando(cfg, { id, numero: m.numero!, texto: m.texto, temMidia: m.temMidia, encaminhada: m.encaminhada }, prazoFinal, autor));
  }
  if (contagem.reacao || contagem.edicao || contagem.interacao) {
    await registrarAcao({ funcao: "whatsapp_mensagem", resultado: "recusada", motivo: "reação, edição, fixação, enquete ou botão: ignorada, sem resposta", autorUserId: autor, canal: "whatsapp",
      resumo: { reacoes: contagem.reacao ?? 0, edicoes: contagem.edicao ?? 0, interacoes: contagem.interacao ?? 0 } });
  }
  if (semTempoReivindicadas) {
    await registrarAcao({ funcao: "whatsapp_mensagem", resultado: "erro", motivo: "pedido do dono sem tempo no prazo do aviso: guardado para o aviso de 'mande de novo'", autorUserId: autor, canal: "whatsapp",
      resumo: { pedidos: semTempoReivindicadas } }).catch(() => undefined);
  }
  if (contagem.antiga) {
    await registrarAcao({ funcao: "whatsapp_mensagem", resultado: "recusada", motivo: "mensagem antiga (reentrega ou histórico): não vira comando", autorUserId: autor, canal: "whatsapp", resumo: { antigas: contagem.antiga } });
  }
  return { status: 200, body: { ok: true, r: contagem } };
}

const router = Router();
router.post("/dolores/whatsapp", async (req: Request, res: Response) => {
  let r: RespostaWebhook;
  try { r = await tratarWebhookDolores(req); }
  catch (e) { console.error("[dolores/whatsapp]", erroCurto(e)); r = { status: 200, body: { ok: false } }; }
  res.setHeader("Cache-Control", "no-store");
  res.status(r.status).json(r.body);
});
export default router;
