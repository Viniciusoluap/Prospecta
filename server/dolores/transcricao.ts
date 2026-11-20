// EPIC-025 (Dolores, etapa 9) — transcrição de áudio pela Cloudflare Workers AI (Whisper), regra do dono de 20/11/2026, item 6.
// - Credenciais (Account ID + API Token) cadastradas pelo dono em Integrações › Cloudflare: o token fica em dashboard_settings
//   cifrado (secret-vault), como os outros segredos do painel; a tela só vê os 4 últimos caracteres. Nunca vai para log, erro,
//   auditoria ou tela (as mensagens de erro passam por `semSegredos`).
// - Modelo `@cf/openai/whisper-large-v3-turbo`, REST `POST https://api.cloudflare.com/client/v4/accounts/{conta}/ai/run/{modelo}`,
//   corpo JSON `{ audio: <base64>, task: "transcribe", language: "pt" }`, resposta `{ success, result: { text, transcription_info } }`.
//   (Formato conferido pela documentação conhecida do modelo; o host da Cloudflare não está liberado na rede deste ambiente — os
//   testes usam cliente simulado. Conferir na doc oficial ao ligar: docs/dolores/como-ligar.md, Etapa 9.)
// - Interruptor DESLIGADO por padrão; duração máxima (padrão 120 s, pelo que o WhatsApp declara — nem baixa acima disso); teto por
//   número/dia e global/dia; download do áudio pela Evolution com teto de tamanho e sem seguir redirecionamento; prazo dentro dos 60 s.
// - O texto transcrito é texto de TERCEIRO: passa pelos mesmos filtros e nunca vira comando (nem do dono: áudio do dono não é
//   transcrito nesta etapa).
import { decryptSecret, encryptSecret, segredoEmTextoPuro } from "../_core/secret-vault.js";
import { baixarMidiaEvolution } from "../_core/evolution.js";
import * as db from "../db.js";
import { diaDeImperatriz } from "../../shared/dolores/grupos.js";
import type { AudioDeclarado } from "../../shared/dolores/roteamento.js";
import { agoraDoRoteamento, chaveDoNumero, vagaNoContador, type CONFIG_ATENDIMENTO_PADRAO } from "./roteamento.js";
import { erroParaLog } from "./erro-seguro.js";

export const MODELO_WHISPER = "@cf/openai/whisper-large-v3-turbo";
export const CHAVE_CONTA_CLOUDFLARE = "cloudflare_workers_ai_conta";
export const CHAVE_SEGREDO_CLOUDFLARE = "segredo.cloudflare_workers_ai_token";
/** Áudio maior que isto nem é baixado (2 min de voz do WhatsApp ficam bem abaixo). */
export const MAX_BYTES_AUDIO = 4 * 1024 * 1024;
/** Prazo da chamada à Cloudflare (cortado pelo que resta do aviso). */
const PRAZO_TRANSCRICAO_MS = 20_000;
/** Para tentar (download + transcrição) é preciso ao menos isto até o fim do prazo do aviso. */
export const MINIMO_PARA_TRANSCREVER_MS = 15_000;
/** O texto transcrito guardado/usado (o laço da cliente e a Central). */
export const MAX_TEXTO_TRANSCRITO = 1_500;

// ── Credenciais (só o servidor lê o token) ──

export type CredencialCloudflare = { conta: string; token: string };
type Banco = { ler: (k: string) => Promise<string | undefined>; gravar: (k: string, v: string) => Promise<void> };
const bancoPadrao: Banco = { ler: k => db.getDashboardSetting(k), gravar: (k, v) => db.saveDashboardSetting(k, v) };

/** Tira de um texto qualquer coisa com cara de token/conta (mensagem de erro, log). */
export function semSegredos(texto: string, cred?: Partial<CredencialCloudflare> | null): string {
  let t = String(texto ?? "");
  for (const v of [cred?.token, cred?.conta]) if (v && v.length >= 6) t = t.split(v).join("…");
  return t.replace(/Bearer\s+\S+/gi, "Bearer …").replace(/\b[A-Za-z0-9_-]{32,}\b/g, "…").slice(0, 200);
}
const CONTA_VALIDA = /^[0-9a-f]{32}$/i;
const TOKEN_VALIDO = /^[A-Za-z0-9_-]{20,200}$/;
export const mascararFinal = (v: string | null | undefined) => (v ? `…${v.slice(-4)}` : null);

export async function lerCredencialCloudflare(b: Banco = bancoPadrao): Promise<CredencialCloudflare | null> {
  const [conta, cifrado] = await Promise.all([b.ler(CHAVE_CONTA_CLOUDFLARE), b.ler(CHAVE_SEGREDO_CLOUDFLARE)]);
  if (!conta || !cifrado) return null;
  let token: string;
  try { token = decryptSecret(cifrado); } catch { return null; }
  if (segredoEmTextoPuro(cifrado)) await b.gravar(CHAVE_SEGREDO_CLOUDFLARE, encryptSecret(token)).catch(() => undefined);
  return token ? { conta, token } : null;
}

/** O que a tela pode saber: se há credencial e os 4 últimos de cada uma. Nunca o token. */
export async function statusCloudflare(b: Banco = bancoPadrao): Promise<{ configurado: boolean; conta: string | null; token: string | null; modelo: string }> {
  const c = await lerCredencialCloudflare(b).catch(() => null);
  return { configurado: !!c, conta: mascararFinal(c?.conta), token: mascararFinal(c?.token), modelo: MODELO_WHISPER };
}

export async function salvarCredencialCloudflare(conta: string, token: string, b: Banco = bancoPadrao): Promise<void> {
  const c = conta.trim(), t = token.trim();
  if (!CONTA_VALIDA.test(c)) throw new Error("Account ID inválido: são 32 caracteres (0-9, a-f), no painel da Cloudflare › Workers AI.");
  if (!TOKEN_VALIDO.test(t)) throw new Error("API Token inválido: confira se foi copiado inteiro, sem espaços.");
  await b.gravar(CHAVE_CONTA_CLOUDFLARE, c);
  await b.gravar(CHAVE_SEGREDO_CLOUDFLARE, encryptSecret(t));
}

export async function removerCredencialCloudflare(b: Banco = bancoPadrao): Promise<void> {
  await b.gravar(CHAVE_SEGREDO_CLOUDFLARE, "");
  await b.gravar(CHAVE_CONTA_CLOUDFLARE, "");
}

// ── Dependências substituíveis nos testes (download e cliente da Cloudflare) ──

export type BaixarAudio = (p: { instancia: string; externalId: string; prazoMs: number }) => Promise<{ base64: string; mime: string | null } | null>;
export type ClienteWhisper = (p: { cred: CredencialCloudflare; base64: string; prazoMs: number }) => Promise<string>;

const baixarPadrao: BaixarAudio = async ({ instancia, externalId, prazoMs }) => {
  const { configEvolution } = await import("../whatsapp-router.js");
  const c = await configEvolution();
  if (!c) return null;
  const comPrazo: typeof fetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(prazoMs) });
  const r = await baixarMidiaEvolution({ ...c, semRedirecionamento: true }, instancia, externalId, comPrazo);
  return r ? { base64: r.base64, mime: r.mime } : null;
};

/** O pedido à Cloudflare. Sem redirecionamento (o token não vai a outro host). Erro sem o token. */
export const clienteWhisperPadrao: ClienteWhisper = async ({ cred, base64, prazoMs }) => {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cred.conta)}/ai/run/${MODELO_WHISPER}`;
  const res = await fetch(url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(prazoMs),
    headers: { Authorization: `Bearer ${cred.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ audio: base64, task: "transcribe", language: "pt" }),
  });
  type Corpo = { success?: boolean; result?: { text?: unknown } };
  let corpo: Corpo | null = null;
  try { corpo = (await res.json()) as Corpo; } catch { corpo = null; }
  if (!res.ok || !corpo?.success) throw new Error(`a Cloudflare recusou a transcrição (HTTP ${res.status})`);
  return typeof corpo.result?.text === "string" ? corpo.result.text : "";
};

type Dependencias = { baixar: BaixarAudio; cliente: ClienteWhisper; credencial: () => Promise<CredencialCloudflare | null> };
const padrao: Dependencias = { baixar: baixarPadrao, cliente: clienteWhisperPadrao, credencial: () => lerCredencialCloudflare() };
let deps: Dependencias = { ...padrao };
export function definirDependenciasTranscricao(d?: Partial<Dependencias>) { deps = d ? { ...deps, ...d } : { ...padrao }; }

export type ResultadoTranscricao = { ok: true; texto: string; base64: string; mime: string | null } | { ok: false; motivo: "desligada" | "sem_credencial" | "longa" | "grande" | "teto_numero" | "teto_global" | "sem_tempo" | "download" | "falha" | "vazia" };

/**
 * Transcreve UM áudio de conversa direta (cliente ou desconhecido; nunca do dono, nunca de grupo — quem chama garante). Na ordem:
 * interruptor, credencial, duração e tamanho declarados (nem baixa acima do limite), tempo, tetos por número/dia e global/dia,
 * download pela Evolution e a chamada à Cloudflare. Falha → motivo (quem chama manda o aviso pedindo para escrever). Nunca lança.
 */
export async function transcreverAudio(p: { instancia: string; externalId: string; numero: string; audio: AudioDeclarado; prazoFinal: number; ms: () => number; config: typeof CONFIG_ATENDIMENTO_PADRAO }): Promise<ResultadoTranscricao> {
  if (!p.config.transcricaoLigada) return { ok: false, motivo: "desligada" };
  const cred = await deps.credencial().catch(() => null);
  if (!cred) return { ok: false, motivo: "sem_credencial" };
  if (p.audio.segundos === null || p.audio.segundos > p.config.transcricaoDuracaoMaxS) return { ok: false, motivo: "longa" };
  if (p.audio.tamanho !== null && p.audio.tamanho > MAX_BYTES_AUDIO) return { ok: false, motivo: "grande" };
  if (p.prazoFinal - p.ms() < MINIMO_PARA_TRANSCREVER_MS) return { ok: false, motivo: "sem_tempo" };
  const chave = chaveDoNumero(p.numero);
  const dia = diaDeImperatriz(agoraDoRoteamento());
  try {
    if (!chave || !(await vagaNoContador(`transcricao:${chave}:${dia}`, p.config.transcricaoTetoNumeroDia))) return { ok: false, motivo: "teto_numero" };
    if (!(await vagaNoContador(`transcricao-global:${dia}`, p.config.transcricaoTetoGlobalDia))) return { ok: false, motivo: "teto_global" };
  } catch { return { ok: false, motivo: "falha" }; }
  let arquivo: Awaited<ReturnType<BaixarAudio>>;
  try { arquivo = await deps.baixar({ instancia: p.instancia, externalId: p.externalId, prazoMs: Math.min(10_000, Math.max(1_000, p.prazoFinal - p.ms() - 12_000)) }); }
  catch (e) { console.error("[dolores/transcricao] falha ao baixar o áudio", erroParaLog(e)); return { ok: false, motivo: "download" }; }
  if (!arquivo?.base64) return { ok: false, motivo: "download" };
  if (Buffer.byteLength(arquivo.base64, "base64") > MAX_BYTES_AUDIO) return { ok: false, motivo: "grande" };
  const prazo = Math.min(PRAZO_TRANSCRICAO_MS, p.prazoFinal - p.ms() - 8_000);
  if (prazo < 2_000) return { ok: false, motivo: "sem_tempo" };
  try {
    const texto = (await deps.cliente({ cred, base64: arquivo.base64, prazoMs: prazo })).replace(/\s+/g, " ").trim().slice(0, MAX_TEXTO_TRANSCRITO);
    return texto ? { ok: true, texto, base64: arquivo.base64, mime: arquivo.mime } : { ok: false, motivo: "vazia" };
  } catch (e) {
    // a mensagem do erro pode trazer o pedido: sai só o nome/HTTP, sem token nem conta
    console.error("[dolores/transcricao] a transcrição falhou", semSegredos(e instanceof Error ? e.message : "erro", cred));
    return { ok: false, motivo: "falha" };
  }
}
