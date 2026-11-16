// EPIC-025 (Dolores, etapa 2) — regras puras do WhatsApp da Dolores: quem é o dono (número normalizado), leitura do
// aviso da Evolution (grupo, própria, antiga, @lid), frases fixas de bloqueio (nunca resposta fingida de IA), limite
// mensal e corte da resposta. Sem banco nem rede.
import { chaveTelefone } from "../whatsapp/conversas.js";
import { mascararTelefone } from "./formato.js";

/** Nome da instância da Evolution só da Dolores (a da empresa é `prospecta-u<id>`). */
export const INSTANCIA_DOLORES = "prospecta-dolores";
/** Mensagem mais velha que isso é reentrega (histórico, reconexão): não vira comando. */
export const IDADE_MAXIMA_MS = 5 * 60_000;
/** Relógio do celular adiantado: até 2 min no futuro é tolerado. */
const FUTURO_TOLERADO_MS = 2 * 60_000;
/** O WhatsApp aceita mais, mas resposta longa no celular não se lê: corta com aviso. */
export const MAX_CARACTERES_WHATSAPP = 3800;
/** Comando do dono guardado (já filtrado). */
export const MAX_TEXTO_COMANDO = 2000;

/** Número do dono para guardar: só dígitos, com DDI 55. Inválido → null. */
export function normalizarNumeroDono(bruto: string | null | undefined): string | null {
  let d = String(bruto ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!/^55\d{10,11}$/.test(d)) return null;
  return d;
}

/** Mesmo número? DDD + 8 últimos dígitos (ignora DDI e o nono dígito). Sem número do dono, ninguém comanda. */
export function ehNumeroDoDono(numero: string | null | undefined, dono: string | null | undefined): boolean {
  const a = chaveTelefone(numero), b = chaveTelefone(dono);
  return a.length === 10 && b.length === 10 && a === b;
}

/** Número para log, auditoria e tela: "(99) *****-4567". */
export const mascararNumero = (n: string | null | undefined): string | null => mascararTelefone(n);

/** messageTimestamp chega em segundos: número, texto ou Long ({ low, high }) do Baileys. */
function segundos(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  const l = v as { low?: number; high?: number } | null;
  if (l && typeof l.low === "number") return (l.high ?? 0) * 2 ** 32 + (l.low >>> 0);
  return null;
}

const NUMERO_DO_JID = /^(\d{10,15})@s\.whatsapp\.net$/;

export type MensagemLida =
  | { tipo: "ignorar"; motivo: "grupo" | "status" | "propria" | "sem_id" | "outro_destino" }
  | { tipo: "direta"; externalId: string; numero: string | null; enviadaEm: Date | null; texto: string; temMidia: boolean };

/**
 * Um item de `messages.upsert`. Grupo (@g.us), status/listas e o que a própria Dolores enviou (fromMe) são ignorados.
 * Conversa direta pode chegar com o endereço novo do WhatsApp (@lid): o número real vem em `senderPn`/`remoteJidAlt`;
 * sem ele, `numero` fica null (não dá para conferir o dono → a mensagem não é comando).
 * O texto é só o que o próprio remetente escreveu (conversa ou texto estendido); mídia vira `temMidia`.
 */
export function lerMensagemEvolution(item: unknown): MensagemLida {
  const d = (item ?? {}) as { key?: Record<string, unknown>; message?: Record<string, any> | null; messageTimestamp?: unknown };
  const key = d.key ?? {};
  const jid = typeof key.remoteJid === "string" ? key.remoteJid : "";
  if (jid.endsWith("@g.us")) return { tipo: "ignorar", motivo: "grupo" };
  if (!jid || jid === "status@broadcast" || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) return { tipo: "ignorar", motivo: "status" };
  if (key.fromMe === true) return { tipo: "ignorar", motivo: "propria" };
  const id = typeof key.id === "string" ? key.id.trim().slice(0, 160) : "";
  if (!id) return { tipo: "ignorar", motivo: "sem_id" };
  let numero: string | null = null;
  if (NUMERO_DO_JID.test(jid)) numero = NUMERO_DO_JID.exec(jid)![1];
  else if (jid.endsWith("@lid")) {
    for (const alt of [key.senderPn, key.remoteJidAlt]) {
      if (typeof alt === "string" && NUMERO_DO_JID.test(alt)) { numero = NUMERO_DO_JID.exec(alt)![1]; break; }
    }
  } else return { tipo: "ignorar", motivo: "outro_destino" };
  const m = d.message ?? {};
  const texto = typeof m.conversation === "string" ? m.conversation
    : typeof m.extendedTextMessage?.text === "string" ? m.extendedTextMessage.text : "";
  const temMidia = Boolean(m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage || m.documentWithCaptionMessage || m.stickerMessage);
  const s = segundos(d.messageTimestamp);
  return { tipo: "direta", externalId: id, numero, enviadaEm: s === null ? null : new Date(s * 1000), texto: texto.trim(), temMidia };
}

/** Sem data, velha demais ou no futuro: não é comando (reentrega da Evolution, histórico, relógio errado). */
export function mensagemAntiga(enviadaEm: Date | null, agora: Date, maxMs = IDADE_MAXIMA_MS): boolean {
  if (!enviadaEm || Number.isNaN(enviadaEm.getTime())) return true;
  const idade = agora.getTime() - enviadaEm.getTime();
  return idade > maxMs || idade < -FUTURO_TOLERADO_MS;
}

/** Mês civil de Imperatriz (UTC−3 fixo): "2026-11". */
export const mesFortaleza = (d: Date) => new Date(d.getTime() - 3 * 60 * 60_000).toISOString().slice(0, 7);

export type MotivoBloqueio =
  | "pausada" | "usuaria_desativada" | "ia_desligada" | "sem_chave" | "sem_modelo" | "sem_limite" | "limite_mensal" | "indisponivel";

/**
 * Frases FIXAS para o dono quando a IA não pode rodar. Nada aqui vem de modelo: quando a Dolores está desligada ela diz
 * isso, e nada foi consultado.
 */
export function fraseDeBloqueio(motivo: MotivoBloqueio, detalhe?: string | null): string {
  const fim = " Nada foi consultado.";
  switch (motivo) {
    case "pausada": return `Dolores: estou pausada${detalhe ? ` (${detalhe.slice(0, 120)})` : ""}.${fim}`;
    case "usuaria_desativada": return `Dolores: minha usuária está desativada em Usuários e acesso.${fim}`;
    case "ia_desligada": return `Dolores: estou desligada. Para me ligar, um administrador ativa o interruptor em Integrações › Dolores.${fim}`;
    case "sem_chave": return `Dolores: estou desligada — falta a chave da Anthropic em Integrações › Anthropic.${fim}`;
    case "sem_modelo": return `Dolores: estou desligada — falta escolher o modelo em Integrações › Anthropic (modelo preferencial).${fim}`;
    case "sem_limite": return `Dolores: estou desligada — falta definir o limite mensal de gasto em Integrações › Dolores.${fim}`;
    case "limite_mensal": return `Dolores: o limite mensal de gasto com a IA foi atingido; volto no mês que vem ou quando o limite for aumentado em Integrações › Dolores.${fim}`;
    case "indisponivel": return `Dolores: não consegui ler a minha configuração agora; tente de novo em instantes.${fim}`;
  }
}

export const FRASE_SO_TEXTO = "Dolores: nesta etapa eu só entendo mensagens de texto. Escreva o pedido, por favor. Nada foi consultado.";
export const FRASE_ERRO = "Dolores: tive uma falha ao montar a resposta e parei. Nada foi alterado no sistema; tente de novo em instantes.";

export type Uso = { entrada: number; saida: number };
export type Limites = { entrada: number; saida: number };

/** Limite mensal: 0 (não definido) bloqueia; atingido em entrada OU saída bloqueia. */
export function bloqueioDoLimite(uso: Uso, limites: Limites): "sem_limite" | "limite_mensal" | null {
  if (!(limites.entrada > 0) || !(limites.saida > 0)) return "sem_limite";
  if (uso.entrada >= limites.entrada || uso.saida >= limites.saida) return "limite_mensal";
  return null;
}

/** Resposta para o WhatsApp: corta no limite, de preferência numa quebra de linha, e avisa que cortou. */
export function cortarResposta(texto: string, max = MAX_CARACTERES_WHATSAPP): string {
  const t = texto.trim();
  if (t.length <= max) return t;
  const aviso = "\n\n(Resposta cortada por tamanho. Peça a parte que faltou.)";
  const limite = max - aviso.length;
  const corte = t.lastIndexOf("\n", limite);
  return `${t.slice(0, corte > limite * 0.6 ? corte : limite).trimEnd()}${aviso}`;
}
