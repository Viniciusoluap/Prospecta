// EPIC-025 (Dolores, etapa 2) — comando e resposta pelo WhatsApp da Dolores.
//   POST /api/dolores/whatsapp  ← avisos da Evolution SÓ da instância da Dolores (prospecta-dolores)
// Autenticação: cabeçalho `x-webhook-token` = HMAC do segredo do servidor com rótulo próprio (diferente do webhook da
// Central), comparado em tempo constante. Depois: só a instância da Dolores; status e as mensagens dela mesma são
// ignorados; grupo só é REGISTRADO se estiver ativo (etapa 4, grupos.ts; etapa 7: grupo novo entra sozinho) — nunca vira comando; mensagem antiga (reentrega) não vira comando; a mesma mensagem (instância + id) só é tratada uma vez
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
import { urlDoSistemaParaLinks } from "./acoes/comum.js";
import {
  FRASE_ENCAMINHADA, FRASE_ERRO, FRASE_OUTRO_PEDIDO, FRASE_SO_TEXTO, MAX_PARTES_RESPOSTA, MAX_TEXTO_COMANDO, fraseSemTempo, bloqueioDoLimite, cortarResposta, ehNumeroDoDono, fraseDeBloqueio,
  lerMensagemEvolution, mascararNumero, mensagemAntiga, mesFortaleza, partesDaResposta, type MotivoBloqueio,
} from "../../shared/dolores/whatsapp.js";
import { configuracaoAnthropicPainel } from "../_core/anthropic-painel.js";
import { ENV } from "../_core/env.js";
import { modeloDaFuncao } from "../_core/modelo-por-funcao.js";
import { enviarTextoEvolution } from "../_core/evolution.js";
import { getDb } from "../db.js";
import { registrarAcao } from "./auditoria.js";
import { erroParaLog } from "./erro-seguro.js";
import { FOLGA_DO_LACO_MS, FOLGA_FINAL_MS, FOLGA_POR_PARTE_MS, MINIMO_PARA_CHAMAR_MS, executarComando } from "./cerebro.js";
import { lerConfigWhatsapp, lerPausa, marcarAvisoDoMes, usoDoMes } from "./consumo.js";
import { DoloresDesativada, idDaDoloresSemCriar, usuarioDolores } from "./perfil.js";
import { MAX_CARACTERES_WHATSAPP } from "../../shared/dolores/whatsapp.js";
import { lerDecisaoDoDono, quadroDePendencias, quadroDoQueFoiFeito } from "../../shared/dolores/fila.js";
import { ehComandoRelatorio } from "../../shared/dolores/operacao.js";
import { obraNotas } from "../../drizzle/schema-dolores-notas.js";
import { registrarEvento } from "./operacao.js";
import { decidir, feitosDoPedido, itensAguardandoDoPedido } from "./aprovacoes.js";
import { tratarMensagemDeGrupo } from "./grupos.js";
import { entrarNoGrupo, tratarEventoDeGrupo } from "./grupos-entrada.js";
import { decidirGrupo } from "./grupos-decisao.js";
import { lerDecisaoDeGrupo } from "../../shared/dolores/grupos-tipo.js";
import { MINIMO_PARA_CLASSIFICAR_MS } from "./classificacao.js";
import { identidadeDaDolores, lerConfigMarcacoes, tratarMarcacao, type CredencialGrupo } from "./marcacao.js";
import { reconhecerRespostaDoEmpreiteiro, tratarDocumentoDoGrupo } from "./notas-obra.js";
import { decidirRota, ehSoAudio, lerParaRoteamento, type ItemRoteado } from "../../shared/dolores/roteamento.js";
import { conexaoDaEmpresa, type ConexaoDaEmpresa } from "../whatsapp-conexao-empresa.js";
import {
  enviarAviso, enviarSaudacao, gravarEntradaNaCentral, identificarRemetente, lerConfigAtendimento, lerLigacao, reivindicarRoteamento, textoDaEntrada, tratarPropria,
  type Remetente,
} from "./roteamento.js";
import { tratarAtendimento } from "./atendimento.js";
import { transcreverAudio } from "./transcricao.js";

/** O item do aviso é de grupo (remoteJid termina em @g.us)? */
const ehDeGrupo = (item: unknown) => String((item as { key?: { remoteJid?: unknown } } | null)?.key?.remoteJid ?? "").endsWith("@g.us");

/** Prazo do laço + envio, com folga para os 60 s da função da Vercel. */
export const PRAZO_TOTAL_MS = 45_000;
/** Prazo máximo de um envio pela Evolution (sempre cortado pelo que resta do prazo total do aviso). */
const PRAZO_ENVIO_MS = 8_000;
/** Com menos que isto até o fim do prazo do aviso, não se tenta enviar (o envio não caberia). */
export const MINIMO_PARA_ENVIAR_MS = 1_500;
/**
 * QA E8 A1: tempo reservado por mensagem da resposta. O laço (cerebro.ts, FOLGA_DO_LACO_MS) guarda uma folga a mais por parte
 * extra; no envio, o número de partes é o que cabe no tempo que resta (o texto livre é cortado, os quadros nunca).
 */
export const TEMPO_POR_PARTE_MS = FOLGA_POR_PARTE_MS;
/** Para tratar um comando (laço + envio) é preciso ao menos isto; com menos, só a frase fixa de "mande de novo". */
export const MINIMO_PARA_COMANDO_MS = MINIMO_PARA_CHAMAR_MS + FOLGA_DO_LACO_MS + 1_000;
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
  // QA E4 r2 N4: a chave da Evolution nunca segue redirecionamento para outro host
  return Boolean(await enviarTextoEvolution({ ...c, semRedirecionamento: true }, instancia, numero, texto, comPrazo, { linkPreview: false }));
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
async function responderAoDono(cfg: DoloresWhatsappConfig, numero: string, texto: string, ctx: { mensagemId: number; autor: number | null; resumo: Record<string, unknown>; prazoFinal: number; quadros?: string | null }) {
  if (!ehNumeroDoDono(numero, cfg.numeroDono) || !cfg.instancia) {
    await registrarAcao({ funcao: "whatsapp_resposta", resultado: "recusada", motivo: "destino não é o número do dono", autorUserId: ctx.autor, canal: "whatsapp", pedidoId: `wa:${ctx.mensagemId}` });
    return false;
  }
  // QA r7 A2: link fora da lista permitida (o domínio do sistema, PUBLIC_SITE_URL, e trello.com) vira "[link removido]";
  // os permitidos vão sem consulta nem fragmento. Depois, o filtro: dados pessoais seguem o interruptor (opção B do
  // dono); senhas, chaves e dados bancários saem sempre.
  // Etapa 8: até 3 mensagens seguidas (partesDaResposta), TODAS pelos mesmos filtros (o texto inteiro e, de novo, cada parte) e
  // para o MESMO destino conferido acima; os quadros do sistema nunca são cortados. Uma falha de envio para as seguintes.
  // QA E8 A1: os quadros do sistema vão na PRIMEIRA mensagem; o número de partes é o que cabe no tempo que resta
  // (TEMPO_POR_PARTE_MS cada) — o que não cabe é texto livre do modelo, cortado; os quadros nunca.
  const filtrar = (t: string) => sanitizarTexto(tratarLinksDaResposta(t, urlDoSistemaParaLinks()), filtroDaSaida("whatsapp"));
  const cabem = Math.max(1, Math.min(MAX_PARTES_RESPOSTA, Math.floor((ctx.prazoFinal - deps.ms()) / TEMPO_POR_PARTE_MS)));
  const partes = partesDaResposta(filtrar(texto), ctx.quadros ? filtrar(ctx.quadros) : null, MAX_CARACTERES_WHATSAPP, cabem).map(t => cortarResposta(filtrar(t)));
  const destino = numero.replace(/\D/g, "");
  const enviadas: number[] = [];
  let avisou = false;
  const auditar = (resultado: "ok" | "erro", motivo: string | null, resumo: Record<string, unknown>, duracaoMs?: number) =>
    registrarAcao({ funcao: "whatsapp_resposta", resultado, motivo, autorUserId: ctx.autor, canal: "whatsapp", pedidoId: `wa:${ctx.mensagemId}`, resumo, duracaoMs });
  const enviarUma = async (t: string, restante: number, resumo: Record<string, unknown>) => {
    const inicio = deps.ms();
    let ok = false;
    let motivo: string | null = null;
    try { ok = await deps.enviar({ instancia: cfg.instancia!, numero: destino, texto: t, prazoMs: Math.min(PRAZO_ENVIO_MS, restante) }); if (!ok) motivo = "a Evolution não aceitou a mensagem (ou o servidor não está configurado)"; }
    catch (e) { motivo = `falha no envio: ${erroCurto(e)}`; }
    await auditar(ok ? "ok" : "erro", motivo, resumo, deps.ms() - inicio);
    return ok;
  };
  let completa = true;
  for (let i = 0; i < partes.length; i++) {
    let final = partes[i];
    // QA achado 5: o envio cabe no prazo ÚNICO do aviso (nunca 8 s fixos por item além dele).
    const restante = ctx.prazoFinal - deps.ms();
    const base = { destino: mascararNumero(numero), ...(partes.length > 1 ? { parte: `${i + 1}/${partes.length}` } : {}), ...ctx.resumo };
    if (restante < MINIMO_PARA_ENVIAR_MS) {
      await auditar("erro", "sem tempo para enviar dentro do prazo do aviso", { caracteres: final.length, ...base });
      completa = false;
      break;
    }
    // QA E8 A1: se esta parte cabe no tempo mas as seguintes não, ela vira a última e já leva o aviso de que faltou parte
    const depois = partes.length - i - 1;
    const ultimaPossivel = depois > 0 && restante < (depois + 1) * TEMPO_POR_PARTE_MS;
    if (ultimaPossivel) { final = comAvisoDeFalta(final); avisou = true; }
    const ok = await enviarUma(final, restante, { caracteres: final.length, ...base });
    if (!ok) {
      completa = false;
      avisou = false;
      // uma parte depois da 1ª não saiu: se ainda couber, uma mensagem curta avisa o dono que faltou parte
      const resta = ctx.prazoFinal - deps.ms();
      if (i > 0 && resta >= MINIMO_PARA_ENVIAR_MS) {
        if (await enviarUma(AVISO_FALTOU_PARTE, resta, { caracteres: AVISO_FALTOU_PARTE.length, destino: mascararNumero(numero), aviso: "faltou_parte", ...ctx.resumo })) avisou = true;
      }
      break;
    }
    enviadas.push(i + 1);
    if (ultimaPossivel) { completa = false; break; }
  }
  // QA E8 A1: quais partes saíram fica na auditoria (sem texto nem número)
  if (!completa && partes.length > 1) {
    await auditar("erro", "resposta incompleta: faltou parte", { partesPrevistas: partes.length, partesEnviadas: enviadas, avisoDeFalta: avisou, ...ctx.resumo });
  }
  return completa;
}

/** QA E8 A1: aviso ao dono quando parte da resposta não saiu (por tempo ou falha de envio). */
export const AVISO_FALTOU_PARTE = "Dolores: faltou parte da resposta (não deu tempo de enviar tudo); peça de novo em partes.";
const comAvisoDeFalta = (t: string) => {
  const espaco = MAX_CARACTERES_WHATSAPP - AVISO_FALTOU_PARTE.length - 2;
  return `${t.length <= espaco ? t : cortarResposta(t, espaco)}\n\n${AVISO_FALTOU_PARTE}`;
};

/**
 * Etapa 6 — envio que NÃO responde a uma mensagem (relatório diário ou sob demanda). O destino é SEMPRE o número do dono da
 * configuração (nenhum texto, parâmetro ou chamador escolhe para quem vai). Sem número do dono, sem instância, Dolores
 * desconectada ou pausa geral → nada é enviado (auditado). Mesmos filtros de saída da resposta ao dono: links fora da lista
 * viram "[link removido]", dados pessoais seguem o interruptor do canal do dono, segredos e dados bancários saem sempre, e o
 * tamanho é cortado para o WhatsApp.
 */
export async function enviarAvisoAoDono(texto: string, ctx: { funcao: string; pedidoId: string; autor: number | null; prazoFinal: number; canal: "whatsapp" | "tela" | "cron"; resumo: Record<string, unknown> }): Promise<{ ok: boolean; motivo: string | null }> {
  const auditar = (resultado: "ok" | "recusada" | "erro", motivo: string | null, extra: Record<string, unknown> = {}, duracaoMs?: number) =>
    registrarAcao({ funcao: ctx.funcao, resultado, motivo, autorUserId: ctx.autor, canal: ctx.canal, pedidoId: ctx.pedidoId, resumo: { ...ctx.resumo, ...extra }, duracaoMs });
  let cfg: DoloresWhatsappConfig | null = null;
  try { cfg = await lerConfigWhatsapp(); } catch { cfg = null; }
  const pausa = await lerPausa().catch(() => null);
  const recusa = !cfg ? "configuração do WhatsApp da Dolores indisponível"
    : !pausa ? "não consegui ler a pausa geral" : pausa.pausada ? "Dolores pausada (pausa geral)"
    : !cfg.numeroDono ? "número do dono não cadastrado" : !cfg.instancia || cfg.statusConexao !== "conectado" ? "Dolores desconectada" : null;
  if (recusa || !cfg?.numeroDono || !cfg.instancia) { await auditar("recusada", `${recusa ?? "sem destino"}; nada foi enviado`); return { ok: false, motivo: recusa }; }
  const numero = cfg.numeroDono;
  if (!ehNumeroDoDono(numero, cfg.numeroDono)) { await auditar("recusada", "destino não é o número do dono; nada foi enviado"); return { ok: false, motivo: "destino inválido" }; }
  const final = cortarResposta(sanitizarTexto(tratarLinksDaResposta(texto, urlDoSistemaParaLinks()), filtroDaSaida("whatsapp")));
  const restante = ctx.prazoFinal - deps.ms();
  if (restante < MINIMO_PARA_ENVIAR_MS) { await auditar("erro", "sem tempo para enviar dentro do prazo", { caracteres: final.length }); return { ok: false, motivo: "sem tempo para enviar" }; }
  const inicio = deps.ms();
  let ok = false;
  let motivo: string | null = null;
  try { ok = await deps.enviar({ instancia: cfg.instancia, numero: numero.replace(/\D/g, ""), texto: final, prazoMs: Math.min(PRAZO_ENVIO_MS, restante) }); if (!ok) motivo = "a Evolution não aceitou a mensagem (ou o servidor não está configurado)"; }
  catch (e) { motivo = `falha no envio: ${erroCurto(e)}`; }
  await auditar(ok ? "ok" : "erro", motivo, { caracteres: final.length, destino: mascararNumero(numero) }, deps.ms() - inicio);
  return { ok, motivo };
}

/**
 * Por que a IA não pode rodar agora (ordem: pausa antes de tudo; nada aqui chama a Anthropic). É o ÚNICO ponto do sistema
 * que lê a chave da Anthropic do painel (o nome da função aparece só no import e na chamada abaixo), e só depois da pausa e do interruptor da IA.
 */
async function bloqueioAtual(cfg: DoloresWhatsappConfig, mes: string, funcao: "dolores_whatsapp" | "dolores_documentos" | "dolores_grupo" | "dolores_notas" | "dolores_cliente" = "dolores_whatsapp"): Promise<
  { motivo: MotivoBloqueio; detalhe?: string | null } | { motivo: null; apiKey: string; modelo: string; autor: number }> {
  const pausa = await lerPausa();
  if (!pausa) return { motivo: "indisponivel" };
  if (pausa.pausada) return { motivo: "pausada", detalhe: pausa.motivo };
  if (!cfg.iaLigada) return { motivo: "ia_desligada" };
  const painel = await configuracaoAnthropicPainel().catch(() => null);
  if (!painel) return { motivo: "sem_chave" };
  // EPIC-024 S-11: o modelo da função no painel ("dolores_whatsapp" ou, na etapa 4, "dolores_documentos"); sem escolha, o campo
  // antigo do cartão (só o da conversa); depois o preferencial.
  const { modelo } = await modeloDaFuncao(funcao, { anterior: funcao === "dolores_whatsapp" ? cfg.modelo : null, preferencial: painel.modelo });
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

/**
 * Etapa 4 — a classificação de documentos dos grupos usa a MESMA porta da chave (bloqueioAtual, na mesma ordem: pausa,
 * interruptor da IA, chave, modelo da função "dolores_documentos", limite mensal, usuária ativa). A chave só sai daqui como
 * `apiKey` do pedido ao modelo (server/dolores/classificacao.ts); nunca vai para log, auditoria ou tela.
 */
export async function credencialDaClassificacao(funcao: "dolores_documentos" | "dolores_notas" = "dolores_documentos"): Promise<
  { motivo: MotivoBloqueio | "indisponivel"; detalhe?: string | null } | { motivo: null; apiKey: string; modelo: string; autor: number; limites: { entrada: number; saida: number }; mes: string }> {
  let cfg: DoloresWhatsappConfig | null;
  try { cfg = await lerConfigWhatsapp(); } catch { return { motivo: "indisponivel" }; }
  if (!cfg) return { motivo: "indisponivel" };
  const mes = mesFortaleza(deps.agora());
  const estado = await bloqueioAtual(cfg, mes, funcao);
  if (estado.motivo !== null) return estado;
  return { ...estado, mes, limites: { entrada: cfg.limiteMensalTokensEntrada, saida: cfg.limiteMensalTokensSaida } };
}

/**
 * Etapa 4b — a resposta no grupo quando a Dolores é marcada usa a MESMA porta da chave (bloqueioAtual, na mesma ordem: pausa,
 * interruptor da IA, chave, modelo da função "dolores_grupo", limite mensal, usuária ativa). A chave só sai daqui como `apiKey`
 * do pedido ao modelo (server/dolores/marcacao.ts); nunca vai para log, auditoria ou tela.
 */
export async function credencialDaMarcacao(): Promise<CredencialGrupo> {
  let cfg: DoloresWhatsappConfig | null;
  try { cfg = await lerConfigWhatsapp(); } catch { return { motivo: "indisponivel" }; }
  if (!cfg) return { motivo: "indisponivel" };
  const mes = mesFortaleza(deps.agora());
  const estado = await bloqueioAtual(cfg, mes, "dolores_grupo");
  if (estado.motivo !== null) return estado;
  return { ...estado, mes, limites: { entrada: cfg.limiteMensalTokensEntrada, saida: cfg.limiteMensalTokensSaida } };
}

/**
 * Etapa 9 — a resposta a CLIENTE cadastrado na conversa direta usa a MESMA porta da chave (bloqueioAtual, na mesma ordem: pausa,
 * interruptor da IA, chave, modelo da função "dolores_cliente", limite mensal, usuária ativa). A chave só sai daqui como `apiKey`
 * do pedido ao modelo (o laço fechado de server/dolores/marcacao.ts, chamado por server/dolores/atendimento.ts).
 */
export async function credencialDoAtendimento(): Promise<CredencialGrupo> {
  let cfg: DoloresWhatsappConfig | null;
  try { cfg = await lerConfigWhatsapp(); } catch { return { motivo: "indisponivel" }; }
  if (!cfg) return { motivo: "indisponivel" };
  const mes = mesFortaleza(deps.agora());
  const estado = await bloqueioAtual(cfg, mes, "dolores_cliente");
  if (estado.motivo !== null) return estado;
  return { ...estado, mes, limites: { entrada: cfg.limiteMensalTokensEntrada, saida: cfg.limiteMensalTokensSaida } };
}

/**
 * Etapa 5 — leitura de notas de obra: a MESMA porta (bloqueioAtual: pausa, interruptor da IA, chave, modelo da função
 * "dolores_notas", limite mensal, usuária ativa). A chave só sai daqui para o pedido ao modelo (server/dolores/notas-obra.ts).
 */
export const credencialDaLeituraDeNota = () => credencialDaClassificacao("dolores_notas");

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
  // Etapa 7 — "grupo CÓDIGO tipo [nº]" (a mensagem inteira), reconhecido por CÓDIGO: o dono define/corrige o tipo e o vínculo de um
  // grupo da Dolores (configuração dela, não o CRM). Só chega aqui mensagem do número do dono, não encaminhada e sem mídia; nada
  // de grupo vira comando. Não chama a IA (nem gasta).
  const decisaoDeGrupo = msg.temMidia ? null : lerDecisaoDeGrupo(msg.texto);
  if (decisaoDeGrupo) {
    const { codigo, ...d } = decisaoDeGrupo;
    const r = await decidirGrupo({ codigo }, d, { via: "whatsapp", autor, mensagemId: msg.id })
      .catch(e => { console.error("[dolores/whatsapp] falha na decisão de grupo", erroCurto(e)); return { ok: false, texto: "Dolores: não consegui gravar a decisão agora; nada mudou.", grupoId: null }; });
    await responderAoDono(cfg, msg.numero, r.texto, { mensagemId: msg.id, autor, resumo: { decisaoDeGrupo: d.tipo, ok: r.ok }, prazoFinal });
    await atualizarMensagem(msg.id, { situacao: r.ok ? "respondida" : "bloqueada", motivo: `decisão de grupo: ${d.tipo}${r.ok ? "" : " (não aplicada)"}`, respondidaEm: deps.agora() });
    return `grupo-decisao:${r.ok ? "ok" : "recusada"}`;
  }
  // Etapa 6 — "relatório" (a mensagem inteira), reconhecido por CÓDIGO: ronda + relatório de modelo fixo, sem IA (nem gasto).
  // Mesma porta da pausa geral e do interruptor do relatório; o texto vai ao número do dono pelo envio do sistema.
  if (!msg.temMidia && ehComandoRelatorio(msg.texto)) {
    let r: { ok: boolean; situacao: string; motivo: string | null };
    try {
      const { relatorioSobDemanda } = await import("./rondas.js");
      r = await relatorioSobDemanda({ origem: "whatsapp", agora: deps.agora(), prazoFinal: prazoFinal - FOLGA_FINAL_MS, relogio: deps.ms });
    } catch (e) {
      console.error("[dolores/whatsapp] falha no relatório sob demanda", erroCurto(e));
      r = { ok: false, situacao: "nao_enviado", motivo: "falha ao montar o relatório" };
    }
    if (!r.ok) await responderAoDono(cfg, msg.numero, `Dolores: não enviei o relatório — ${r.motivo ?? "não foi possível agora"}. Nada foi alterado no sistema.`,
      { mensagemId: msg.id, autor, resumo: { relatorio: r.situacao }, prazoFinal });
    await atualizarMensagem(msg.id, { situacao: r.ok ? "respondida" : "bloqueada", motivo: `relatório sob demanda: ${r.situacao}`, respondidaEm: deps.agora() });
    return `relatorio:${r.situacao}`;
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
    const quadros = await montarQuadros(msg.id, r.codigosNaFila);
    const ok = await responderAoDono(cfg, msg.numero, texto, { mensagemId: msg.id, autor, resumo: { voltas: r.voltas, consultas: r.consultas.length, parou: r.parou, tokensEntrada: r.tokens.entrada, tokensSaida: r.tokens.saida }, prazoFinal, quadros });
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

/** Etapa 6 — registra o evento "nota lida" se a mensagem do grupo virou nota lida pela IA. Falha só vai para o log. */
async function eventoDeNotaLida(grupoMensagemId: number) {
  try {
    const [n] = await getDb().select({ id: obraNotas.id, lidaEm: obraNotas.lidaEm }).from(obraNotas).where(eq(obraNotas.mensagemId, grupoMensagemId)).limit(1);
    if (n?.lidaEm) await registrarEvento({ tipo: "nota_lida", chave: `nota:${n.id}`, origemTabela: "obra_notas", origemId: n.id });
  } catch (e) { console.error("[dolores/whatsapp] falha ao registrar o evento da nota", erroCurto(e)); }
}

/** "16/11 09:05" no horário de Imperatriz (UTC−3 fixo). */
const diaEHora = (d: Date) => {
  const s = new Date(d.getTime() - 3 * 60 * 60_000).toISOString();
  return `${s.slice(8, 10)}/${s.slice(5, 7)} ${s.slice(11, 16)}`;
};

/**
 * Etapa 3 — quadros DETERMINÍSTICOS no fim da resposta: o que a Dolores gravou direto por este comando e o que ficou na
 * fila, com o código de cada item (lidos do banco; o texto do modelo nunca escolhe código nem resumo). Os quadros têm
 * prioridade sobre o texto do modelo no limite de tamanho. Etapa 8: devolve só os quadros (ou null); quem os junta ao texto é
 * `partesDaResposta`, que nunca os corta (vão no fim da última mensagem ou numa própria).
 */
async function montarQuadros(mensagemId: number, codigosNaFila: readonly string[] = []): Promise<string | null> {
  const [pendentes, feitos] = await Promise.all([
    itensAguardandoDoPedido(mensagemId, codigosNaFila).catch(e => { console.error("[dolores/whatsapp] falha ao ler a fila", erroCurto(e)); return []; }),
    feitosDoPedido(mensagemId).catch(e => { console.error("[dolores/whatsapp] falha ao ler a autoria", erroCurto(e)); return []; }),
  ]);
  // QA R2 M5: nada é cortado no fim. A fila tem prioridade (itens inteiros enquanto couberem, depois "e mais N"), o quadro
  // do que foi feito usa o que sobra, e o texto do modelo fica com o resto (no mínimo 200 caracteres). Já sai pelo filtro
  // de dados pessoais aqui, para o tamanho medido ser o que vai (o filtro de novo, na saída, não muda nada).
  const MINIMO_TEXTO = 200;
  const FOLGA = 60;
  const fila = sanitizarTexto(quadroDePendencias(pendentes, diaEHora, MAX_CARACTERES_WHATSAPP - MINIMO_TEXTO - 300 - FOLGA), filtroDaSaida("whatsapp"));
  const feito = sanitizarTexto(quadroDoQueFoiFeito(feitos, MAX_CARACTERES_WHATSAPP - MINIMO_TEXTO - FOLGA - (fila ? fila.length + 2 : 0)), filtroDaSaida("whatsapp"));
  const quadros = [feito, fila].filter(Boolean).join("\n\n");
  return quadros || null;
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
    motivo: numero ? "remetente não é o número do dono: não é comando (etapa 9: vai para a Central pelo roteamento)" : "remetente sem número conferível; sem resposta",
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

// ── Etapa 9 — o roteamento do número da EMPRESA (Dolores e Central): um aviso só, repartido aqui por CÓDIGO ──

type Direta = Extract<ItemRoteado, { tipo: "direta" }>;
/** O que fica para DEPOIS dos itens do dono no mesmo aviso (chama IA ou serviço externo). */
type PendenteDoAviso = { tipo: "cliente" | "audio"; item: Direta; quem: Remetente; centralId: number | null; nome: string | null };

/**
 * Mensagem direta de quem NÃO é o dono. Nunca é comando. Reivindicada uma vez (reentrega não duplica nada); entra na Central pela
 * conexão da empresa (mesmo antiga — histórico; a Central não duplica); só mensagem NOVA recebe saudação (desconhecido) ou entra na fila
 * do aviso para a Dolores (cliente cadastrado) e para a transcrição (áudio de cliente ou desconhecido).
 */
async function tratarTerceiro(cfg: DoloresWhatsappConfig, bruto: unknown, d: Direta, ctx: { autor: number | null; prazoFinal: number; pendentes: PendenteDoAviso[] }): Promise<string[]> {
  if (!d.numero) { await auditarRemetenteEstranho(null, ctx.autor, d.texto.length); return ["sem-numero"]; }
  if (ehNumeroDoDono(d.numero, cfg.numeroDolores)) return ["propria-numero"];
  let nova = false;
  try { nova = await reivindicarRoteamento(cfg.instancia!, d.externalId); }
  catch (e) { console.error("[dolores/whatsapp] falha ao reivindicar a mensagem de terceiro", erroCurto(e)); return ["erro"]; }
  if (!nova) return ["repetida"];
  await auditarRemetenteEstranho(d.numero, ctx.autor, d.texto.length);
  // falha ao identificar → "varios": vai à Central e nada automático sai (falha fechada)
  const quem: Remetente = await identificarRemetente(d.numero).catch(e => { console.error("[dolores/whatsapp] falha ao identificar o remetente", erroCurto(e)); return { categoria: "varios" as const, leadId: null, cadastros: 0 }; });
  const rota = decidirRota(d, cfg.numeroDono, quem.categoria);
  if (rota.destino !== "central") return ["nao-autorizado"];
  const r: string[] = [`central-${rota.categoria}`];
  const conn = await conexaoDaEmpresa().catch(() => null);
  let centralId: number | null = null;
  const nome = typeof (bruto as { pushName?: unknown })?.pushName === "string" ? String((bruto as { pushName: string }).pushName).slice(0, 120) : null;
  if (conn) {
    try { centralId = (await gravarEntradaNaCentral(conn, bruto)).id; }
    catch (e) { console.error("[dolores/whatsapp] falha ao gravar a mensagem na Central", erroCurto(e)); r.push("central-erro"); }
  } else r.push("central-sem-conexao");
  if (mensagemAntiga(d.enviadaEm, deps.agora())) { r.push("antiga"); return r; }
  if (!conn) return r;
  const config = await lerConfigAtendimento();
  if (rota.saudacao) r.push(await enviarSaudacao({ cfg, conn, numero: d.numero, prazoFinal: ctx.prazoFinal, autor: ctx.autor, config })
    .catch(e => { console.error("[dolores/whatsapp] falha na saudação", erroCurto(e)); return "saudacao-erro"; }));
  if (ehSoAudio(d) && (rota.categoria === "cliente" || rota.categoria === "desconhecido")) ctx.pendentes.push({ tipo: "audio", item: d, quem, centralId, nome });
  else if (rota.dolores && d.texto && quem.leadId) ctx.pendentes.push({ tipo: "cliente", item: d, quem, centralId, nome });
  return r;
}

/** Depois dos itens do dono e das marcações: áudio (transcrição ou aviso) e a resposta ao cliente cadastrado. */
async function tratarPendente(cfg: DoloresWhatsappConfig, p: PendenteDoAviso, ctx: { autor: number | null; prazoFinal: number }): Promise<string[]> {
  const conn = await conexaoDaEmpresa().catch(() => null);
  if (!conn || !cfg.instancia || !p.item.numero) return ["pendente-sem-conexao"];
  const numero = p.item.numero;
  const config = await lerConfigAtendimento();
  const atender = (texto: string, origem: "texto" | "audio") => tratarAtendimento(cfg, conn, {
    externalId: p.item.externalId, numero, enviadaEm: p.item.enviadaEm, texto, origem, leadId: p.quem.leadId!, nome: p.nome,
  }, { autor: ctx.autor, prazoFinal: ctx.prazoFinal, ms: deps.ms, obterCredencial: credencialDoAtendimento });
  if (p.tipo === "cliente") return [await atender(p.item.texto, "texto")];
  const t = p.item.audio
    ? await transcreverAudio({ instancia: cfg.instancia, externalId: p.item.externalId, numero, audio: p.item.audio, prazoFinal: ctx.prazoFinal, ms: deps.ms, config })
      .catch(() => ({ ok: false as const, motivo: "falha" as const }))
    : { ok: false as const, motivo: "falha" as const };
  if (!t.ok) {
    const aviso = await enviarAviso({ tipo: "audio", cfg, conn, numero, prazoFinal: ctx.prazoFinal, autor: ctx.autor, config, leadId: p.quem.leadId })
      .catch(e => { console.error("[dolores/whatsapp] falha no aviso de áudio", erroCurto(e)); return "aviso-audio-erro"; });
    return [`transcricao-${t.motivo}`, aviso];
  }
  // o texto transcrito é de TERCEIRO: vai à conversa da Central e, de cliente, ao mesmo atendimento (nunca comando)
  if (p.centralId) await textoDaEntrada(p.centralId, `[áudio transcrito] ${t.texto}`);
  if (p.quem.categoria === "cliente" && p.quem.leadId) return ["transcrito", await atender(t.texto, "audio")];
  return ["transcrito"];
}

/** Etapa 9 — ligação para o número da empresa: não é atendida; aviso por texto (1 a cada N horas por número). Grupo e dono: nada. */
async function tratarLigacao(cfg: DoloresWhatsappConfig, data: unknown, ctx: { autor: number | null; prazoFinal: number }): Promise<string> {
  const l = lerLigacao(data);
  if (l.grupo) return "ligacao-grupo";
  if (!l.oferta) return "ligacao-ignorada";
  if (!l.numero) return "ligacao-sem-numero";
  if (ehNumeroDoDono(l.numero, cfg.numeroDono) || ehNumeroDoDono(l.numero, cfg.numeroDolores)) return "ligacao-do-dono";
  if (l.id && !(await reivindicarRoteamento(cfg.instancia!, `ligacao:${l.id}`).catch(() => false))) return "ligacao-repetida";
  const conn: ConexaoDaEmpresa | null = await conexaoDaEmpresa().catch(() => null);
  if (!conn) return "ligacao-sem-conexao";
  const config = await lerConfigAtendimento();
  return enviarAviso({ tipo: "ligacao", cfg, conn, numero: l.numero, prazoFinal: ctx.prazoFinal, autor: ctx.autor, config })
    .catch(e => { console.error("[dolores/whatsapp] falha no aviso de ligação", erroCurto(e)); return "aviso-ligacao-erro"; });
}

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
  // Etapa 7 — avisos de grupo (quem adicionou a Dolores; criação do grupo): só provam QUEM a colocou no grupo (regra do dono de
  // 19/11: só o número dele pode) e criam o grupo. Nada é lido, respondido ou executado a partir deles.
  const eventoDeGrupo = evento.replace(/-/g, ".");
  if (eventoDeGrupo === "group.participants.update" || eventoDeGrupo === "groups.upsert") {
    const autorDolores = await idDaDoloresSemCriar().catch(() => null);
    const conf = await lerConfigMarcacoes().catch(() => null);
    const r = await tratarEventoDeGrupo(cfg, eventoDeGrupo === "groups.upsert" ? "criacao" : "participantes", ev.data, {
      agora, autor: autorDolores, prazoFinal: inicio + PRAZO_TOTAL_MS, avisar: enviarAvisoAoDono, identidade: identidadeDaDolores(cfg, conf),
    }).catch(e => { console.error("[dolores/whatsapp] falha no aviso de grupo", erroCurto(e)); return "grupo-evento-erro"; });
    return { status: 200, body: { ok: true, r } };
  }
  // Etapa 9 — ligação (evento CALL da Evolution, assinado por "Reativar recebimento")
  if (evento === "call") {
    const autorDolores = await idDaDoloresSemCriar().catch(() => null);
    const r = await tratarLigacao(cfg, ev.data, { autor: autorDolores, prazoFinal: inicio + PRAZO_TOTAL_MS })
      .catch(e => { console.error("[dolores/whatsapp] falha na ligação", erroCurto(e)); return "ligacao-erro"; });
    return { status: 200, body: { ok: true, r } };
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
  let classificouNesteAviso = false;
  // QA-SEG E4b achado 4: as marcações ficam para DEPOIS dos itens do dono neste aviso (o comando do dono não fica "sem tempo"
  // por causa de marcação no grupo); cada uma confere o prazo que sobrar.
  const marcacoesDoAviso: unknown[] = [];
  // Etapa 9: o que fica para depois do dono (resposta a cliente, áudio)
  const pendentes: PendenteDoAviso[] = [];
  for (const item of itens) {
    // Etapa 4 — GRUPO: registrado (se cadastrado e ativo); nunca vira comando, aprovação nem ação — nem quando quem escreveu
    // no grupo é o dono. Etapa 7: grupo desconhecido entra sozinho (grupos-entrada.ts); desativado continua ignorado ("grupo").
    // Etapa 4b — a ÚNICA fala no grupo: quando a Dolores é MARCADA (menção real, por código), em grupo cadastrado e ativo e com
    // os interruptores ligados, ela responde só sobre aquele cliente (marcacao.ts) — depois dos itens do dono deste aviso.
    if (ehDeGrupo(item)) {
      // Etapa 7 — grupo desconhecido entra sozinho (tipo pelo nome da Evolution, teto diário, aviso ao dono); nunca fala nele
      const instancia = cfg.instancia;
      const g = await tratarMensagemDeGrupo(cfg, item, { agora: deps.agora(), autor,
        entrar: async jid => (await entrarNoGrupo({ instancia, grupoJid: jid, agora: deps.agora(), autor, prazoFinal, canal: "whatsapp", avisar: enviarAvisoAoDono, numeroDono: cfg.numeroDono })).grupo });
      contar(g.resultado);
      // acima do teto diário de mensagens do grupo (spam), nem a marcação é tratada (o registro de marcações não cresce sem limite)
      if (g.resultado !== "grupo" && g.resultado !== "grupo-teto") marcacoesDoAviso.push(item);
      // Etapa 6 — evento (só registro; nunca ação): documento recebido em grupo cadastrado. Desligado por padrão.
      if (g.aClassificar && g.mensagemId) await registrarEvento({ tipo: "documento_grupo", chave: `grupo-msg:${g.mensagemId}`, origemTabela: "dolores_grupo_mensagens", origemId: g.mensagemId });
      // no máximo UMA classificação por aviso, e só com tempo de sobra; o resto fica "a classificar" (a tela e o próximo
      // pedido do dono tratam). Quem decide se a IA pode rodar (interruptores, teto, limite) é a classificação.
      // Etapa 5: documento de grupo de OBRA vai para a leitura de nota (mesmas travas; no máximo UMA chamada de IA por aviso,
      // somando classificação e leitura); texto de grupo de obra pode ser a resposta do empreiteiro (código, sem IA).
      if (g.aClassificar && g.mensagemId && !classificouNesteAviso && prazoFinal - deps.ms() >= MINIMO_PARA_CLASSIFICAR_MS) {
        classificouNesteAviso = true;
        const r = await tratarDocumentoDoGrupo(g.mensagemId, { prazoFinal, relogio: deps.ms, obterCredencial: credencialDaClassificacao, credencialDaNota: credencialDaLeituraDeNota, canal: "whatsapp" })
          .catch(e => { console.error("[dolores/whatsapp] falha ao classificar documento do grupo", erroCurto(e)); return "classificacao-erro"; });
        contar(r);
        // Etapa 6 — evento: nota de obra lida (só registro). Confere no banco, não pelo texto do resultado.
        await eventoDeNotaLida(g.mensagemId);
      } else if (g.resultado === "grupo-registrada" && g.mensagemId && !g.aClassificar) {
        const r = await reconhecerRespostaDoEmpreiteiro(cfg, item, g.mensagemId, { agora: deps.agora(), autor })
          .catch(e => { console.error("[dolores/whatsapp] falha ao conferir resposta de empreiteiro", erroCurto(e)); return "resposta-erro"; });
        if (r !== "resposta-nada") contar(r);
      }
      continue;
    }
    // Etapa 9 — o que o número da EMPRESA enviou (fromMe): nunca é comando. Com o dono (ou sem número): nada, nunca vai à Central.
    // Com os demais: entra na conversa da Central (automática já gravada não duplica; a da equipe cala a Dolores ali por N horas).
    const roteado = lerParaRoteamento(item);
    if (roteado.tipo === "propria") {
      const rota = decidirRota(roteado, cfg.numeroDono, null);
      if (rota.destino !== "central_saida" || ehNumeroDoDono(roteado.numero, cfg.numeroDolores)) { contar("propria"); continue; }
      try {
        if (!(await reivindicarRoteamento(cfg.instancia, roteado.externalId))) { contar("repetida"); continue; }
        const conn = await conexaoDaEmpresa();
        if (!conn) { contar("central-sem-conexao"); continue; }
        const config = await lerConfigAtendimento();
        contar(await tratarPropria(conn, item, { numero: rota.numero, texto: roteado.texto, externalId: roteado.externalId, enviadaEm: roteado.enviadaEm, silencioHoras: config.silencioHoras }));
      } catch (e) { console.error("[dolores/whatsapp] falha ao tratar mensagem enviada pelo número da empresa", erroCurto(e)); contar("erro"); }
      continue;
    }
    const m = lerMensagemEvolution(item);
    if (m.tipo === "ignorar") { contar(m.motivo); continue; }
    const doDono = ehNumeroDoDono(m.numero, cfg.numeroDono);
    // Etapa 9 — direta de quem não é o dono: roteamento (Central, saudação, cliente cadastrado, áudio). Nunca comando.
    if (!doDono && roteado.tipo === "direta") {
      for (const k of await tratarTerceiro(cfg, item, roteado, { autor, prazoFinal, pendentes })) contar(k);
      continue;
    }
    if (mensagemAntiga(m.enviadaEm, deps.agora())) { contar("antiga"); continue; }
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
  // Etapa 4b — as marcações, depois do dono. Cada uma confere o próprio prazo (a IA só com tempo de sobra; a frase fixa, com o
  // mínimo do envio).
  for (const item of marcacoesDoAviso) {
    const r = await tratarMarcacao(cfg, item, { autor, prazoFinal, obterCredencial: credencialDaMarcacao })
      .catch(e => { console.error("[dolores/whatsapp] falha ao tratar a marcação no grupo", erroCurto(e)); return "marcacao-erro"; });
    if (r) contar(r);
  }
  // Etapa 9 — depois do dono e das marcações: áudio (transcrição ou aviso) e a resposta a cliente cadastrado; cada um confere o prazo
  for (const p of pendentes) {
    const r = await tratarPendente(cfg, p, { autor, prazoFinal })
      .catch(e => { console.error("[dolores/whatsapp] falha ao tratar a mensagem de cliente", erroCurto(e)); return ["cliente-erro"]; });
    for (const k of r) contar(k);
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
