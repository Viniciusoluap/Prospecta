// Pedido de 25/10: WhatsApp por QR code via Evolution API (Baileys) hospedada pelo dono (Railway),
// até a integração da Lógyca. Gêmeo de Grupo-Santa-Fe/web/src/lib/evolution.ts.
import { chaveTelefone } from "../../shared/whatsapp/conversas.js";
export type EvolutionConfig = { url: string; apiKey: string };
type Fetch = typeof fetch;

/** Pedido de 25/10: o Railway só aceita https (http redireciona e o POST vira GET → 404) e /manager é o painel. */
export function normalizarUrlEvolution(url: string): string {
  let u = url.trim().replace(/\/+$/, "").replace(/\/manager$/i, "");
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/^http:\/\//i, "https://");
}
const base = (c: EvolutionConfig) => normalizarUrlEvolution(c.url);

/** Motivo legível devolvido pela Evolution ({ response: { message: [...] } } ou { message }). */
function motivo(data: unknown): string {
  const d = data as { response?: { message?: unknown }; message?: unknown; error?: unknown } | null;
  const m = d?.response?.message ?? d?.message ?? d?.error;
  const t = Array.isArray(m) ? m.flat().join("; ") : typeof m === "string" ? m : "";
  return t ? `: ${t.slice(0, 200)}` : "";
}
const headers = (c: EvolutionConfig) => ({ "Content-Type": "application/json", apikey: c.apiKey.trim() });

async function chamar<T>(c: EvolutionConfig, caminho: string, init: RequestInit = {}, fetchImpl: Fetch = fetch): Promise<{ ok: boolean; status: number; data: T | null }> {
  const res = await fetchImpl(`${base(c)}${caminho}`, { ...init, headers: { ...headers(c), ...(init.headers ?? {}) } });
  let data: T | null = null;
  try { data = (await res.json()) as T; } catch { /* corpo vazio */ }
  return { ok: res.ok, status: res.status, data };
}

/** Confere se o servidor responde e aceita a chave (lista as instâncias). */
export async function testarEvolution(c: EvolutionConfig, fetchImpl: Fetch = fetch): Promise<void> {
  let r;
  try { r = await chamar(c, "/instance/fetchInstances", {}, fetchImpl); }
  catch { throw new Error("Não consegui falar com o servidor da Evolution. Confira o endereço."); }
  if (r.status === 401 || r.status === 403) throw new Error(`A Evolution recusou a chave (HTTP ${r.status})${motivo(r.data)}. Confira a AUTHENTICATION_API_KEY.`);
  if (!r.ok) throw new Error(`A Evolution respondeu com erro (HTTP ${r.status})${motivo(r.data)}.`);
  if (!Array.isArray(r.data)) throw new Error("Esse endereço não é a API da Evolution (use o endereço do serviço, sem /manager).");
}

export type EstadoConexao = "open" | "connecting" | "close";

export async function estadoInstancia(c: EvolutionConfig, instancia: string, fetchImpl: Fetch = fetch): Promise<EstadoConexao | "inexistente"> {
  const r = await chamar<{ instance?: { state?: string } }>(c, `/instance/connectionState/${encodeURIComponent(instancia)}`, {}, fetchImpl);
  if (r.status === 404) return "inexistente";
  if (!r.ok) throw new Error(`A Evolution não informou o estado da conexão (HTTP ${r.status})${motivo(r.data)}.`);
  const s = r.data?.instance?.state;
  return s === "open" ? "open" : s === "connecting" ? "connecting" : "close";
}

/** Cria a instância se não existir e devolve o QR code (imagem base64) para escanear. */
export async function gerarQrCode(c: EvolutionConfig, instancia: string, fetchImpl: Fetch = fetch): Promise<{ qrCode: string | null; estado: EstadoConexao }> {
  const estado = await estadoInstancia(c, instancia, fetchImpl);
  if (estado === "open") return { qrCode: null, estado };
  if (estado === "inexistente") {
    const r = await chamar<{ qrcode?: { base64?: string } }>(c, "/instance/create", {
      method: "POST",
      body: JSON.stringify({ instanceName: instancia, integration: "WHATSAPP-BAILEYS", qrcode: true }),
    }, fetchImpl);
    if (!r.ok) throw new Error(`A Evolution não criou a conexão (HTTP ${r.status})${motivo(r.data)}.`);
    if (r.data?.qrcode?.base64) return { qrCode: r.data.qrcode.base64, estado: "connecting" };
  }
  const r = await chamar<{ base64?: string }>(c, `/instance/connect/${encodeURIComponent(instancia)}`, {}, fetchImpl);
  if (!r.ok) throw new Error(`A Evolution não gerou o QR code (HTTP ${r.status})${motivo(r.data)}.`);
  return { qrCode: r.data?.base64 ?? null, estado: "connecting" };
}

/** Número conectado (ownerJid "5599...@s.whatsapp.net" → "5599..."). */
export async function numeroConectado(c: EvolutionConfig, instancia: string, fetchImpl: Fetch = fetch): Promise<string | null> {
  const r = await chamar<Array<{ ownerJid?: string; owner?: string; instance?: { owner?: string } }>>(
    c, `/instance/fetchInstances?instanceName=${encodeURIComponent(instancia)}`, {}, fetchImpl);
  const i = Array.isArray(r.data) ? r.data[0] : null;
  const jid = i?.ownerJid ?? i?.owner ?? i?.instance?.owner ?? "";
  return jid ? jid.split("@")[0] : null;
}

export async function removerInstancia(c: EvolutionConfig, instancia: string, fetchImpl: Fetch = fetch): Promise<void> {
  await chamar(c, `/instance/logout/${encodeURIComponent(instancia)}`, { method: "DELETE" }, fetchImpl).catch(() => undefined);
  await chamar(c, `/instance/delete/${encodeURIComponent(instancia)}`, { method: "DELETE" }, fetchImpl).catch(() => undefined);
}

/**
 * `opcoes.linkPreview`: só vai no pedido quando informado (a Central de Vendas não informa e fica com o padrão da
 * Evolution). A Dolores manda false: ninguém busca a URL para montar a prévia (EPIC-025, QA r7 A2).
 */
export async function enviarTextoEvolution(c: EvolutionConfig, instancia: string, numero: string, texto: string, fetchImpl: Fetch = fetch,
  opcoes: { linkPreview?: boolean } = {}): Promise<string | null> {
  const num = numero.replace(/\D/g, "");
  const r = await chamar<{ key?: { id?: string } }>(c, `/message/sendText/${encodeURIComponent(instancia)}`, {
    method: "POST",
    body: JSON.stringify({ number: num.startsWith("55") ? num : `55${num}`, text: texto,
      ...(opcoes.linkPreview === undefined ? {} : { linkPreview: opcoes.linkPreview }) }),
  }, fetchImpl);
  return r.ok ? (r.data?.key?.id ?? null) : null;
}

/**
 * Pedido de 25/10 (Conversas): a Evolution passa a avisar o sistema de mensagens recebidas, status de
 * entrega/leitura e da conexão. Cabeçalho secreto para o sistema aceitar só avisos legítimos.
 */
export async function registrarWebhookEvolution(c: EvolutionConfig, instancia: string, url: string, segredo: string, fetchImpl: Fetch = fetch): Promise<void> {
  const r = await chamar(c, `/webhook/set/${encodeURIComponent(instancia)}`, {
    method: "POST",
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url,
        headers: { "x-webhook-token": segredo },
        byEvents: false,
        base64: false,
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
      },
    }),
  }, fetchImpl);
  if (!r.ok) throw new Error(`A Evolution não aceitou o aviso de mensagens (HTTP ${r.status})${motivo(r.data)}.`);
}

/** Texto legível de uma mensagem recebida (texto, legenda ou tipo de mídia). */
export function textoDaMensagem(message: Record<string, any> | undefined | null): string {
  if (!message) return "";
  if (typeof message.conversation === "string") return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage) return message.imageMessage.caption ? `[imagem] ${message.imageMessage.caption}` : "[imagem]";
  if (message.videoMessage) return message.videoMessage.caption ? `[vídeo] ${message.videoMessage.caption}` : "[vídeo]";
  if (message.documentMessage) return `[documento] ${message.documentMessage.fileName ?? ""}`.trim();
  const docLegenda = message.documentWithCaptionMessage?.message?.documentMessage;
  if (docLegenda) return [`[documento] ${docLegenda.fileName ?? ""}`.trim(), docLegenda.caption].filter(Boolean).join(" ");
  if (message.audioMessage) return "[áudio]";
  if (message.stickerMessage) return "[figurinha]";
  if (message.locationMessage) return "[localização]";
  if (message.contactMessage) return "[contato]";
  return "[mensagem]";
}

/** Mesmo telefone? Compara DDD + 8 últimos dígitos (o WhatsApp às vezes omite o 9º dígito). */
export function mesmoTelefone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = chaveTelefone(a), y = chaveTelefone(b);
  return Boolean(x) && x === y;
}

// ── Pedido de 25/10 (noite): imagem, áudio, vídeo e documentos nas conversas ──
export type TipoMidia = "imagem" | "audio" | "video" | "documento" | "figurinha";
/** Limite por arquivo guardado no banco; acima disso fica só o rótulo. */
export const LIMITE_MIDIA = 10 * 1024 * 1024;

/** fileLength chega como número, texto ou Long ({ low, high }) do Baileys. */
function tamanhoDeclarado(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  const l = v as { low?: number; high?: number } | null;
  if (l && typeof l.low === "number") return (l.high ?? 0) * 2 ** 32 + (l.low >>> 0);
  return null;
}

/** Dados da mídia anexada (sem o arquivo), ou null para texto/localização/contato. */
export function midiaDaMensagem(message: Record<string, any> | undefined | null): { tipo: TipoMidia; mime: string | null; nome: string | null; tamanho: number | null } | null {
  if (!message) return null;
  const pares: [string, TipoMidia, string][] = [
    ["imageMessage", "imagem", "image/jpeg"], ["audioMessage", "audio", "audio/ogg"], ["videoMessage", "video", "video/mp4"],
    ["documentMessage", "documento", "application/octet-stream"], ["stickerMessage", "figurinha", "image/webp"],
  ];
  // Documento com legenda vem embrulhado em documentWithCaptionMessage.message.documentMessage.
  const doc = message.documentWithCaptionMessage?.message?.documentMessage;
  for (const [chave, tipo, padrao] of pares) {
    const m = chave === "documentMessage" ? (message.documentMessage ?? doc) : message[chave];
    if (!m) continue;
    const mime = typeof m.mimetype === "string" ? m.mimetype.split(";")[0].trim().slice(0, 120) : padrao;
    const nome = typeof m.fileName === "string" ? m.fileName.slice(0, 255) : null;
    return { tipo, mime: mime || padrao, nome, tamanho: tamanhoDeclarado(m.fileLength) };
  }
  return null;
}

/**
 * Arquivo da mídia pela Evolution v2 (POST /chat/getBase64FromMediaMessage/{instância}),
 * porque o aviso (webhook) chega com base64:false. Devolve null se a Evolution não entregar.
 */
export async function baixarMidiaEvolution(c: EvolutionConfig, instancia: string, externalId: string, fetchImpl: Fetch = fetch): Promise<{ base64: string; mime: string | null; nome: string | null } | null> {
  const r = await chamar<{ base64?: string; mimetype?: string; fileName?: string }>(c, `/chat/getBase64FromMediaMessage/${encodeURIComponent(instancia)}`, {
    method: "POST",
    body: JSON.stringify({ message: { key: { id: externalId } }, convertToMp4: false }),
    signal: AbortSignal.timeout(20_000), // não segura o aviso da Evolution por muito tempo
  }, fetchImpl);
  if (!r.ok) throw new Error(`A Evolution não entregou o arquivo (HTTP ${r.status})${motivo(r.data)}.`);
  const bruto = typeof r.data?.base64 === "string" ? r.data.base64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "") : "";
  if (!bruto) return null;
  return {
    base64: bruto,
    mime: typeof r.data?.mimetype === "string" ? r.data.mimetype.split(";")[0].trim().slice(0, 120) || null : null,
    nome: typeof r.data?.fileName === "string" ? r.data.fileName.slice(0, 255) : null,
  };
}

/**
 * EPIC-025 (Dolores, etapa 4) — grupos em que o número da instância está (GET /group/fetchAllGroups/{instância}, sem
 * participantes). SÓ LEITURA: serve para o administrador escolher o grupo a cadastrar. O nome do grupo é texto de terceiro
 * (quem chama sanitiza). Devolve no máximo 300 grupos.
 */
export async function listarGruposEvolution(c: EvolutionConfig, instancia: string, fetchImpl: Fetch = fetch): Promise<Array<{ id: string; nome: string | null; participantes: number | null }>> {
  const r = await chamar<unknown>(c, `/group/fetchAllGroups/${encodeURIComponent(instancia)}?getParticipants=false`, { signal: AbortSignal.timeout(15_000) }, fetchImpl);
  if (!r.ok) throw new Error(`A Evolution não listou os grupos (HTTP ${r.status})${motivo(r.data)}.`);
  const lista = Array.isArray(r.data) ? r.data : [];
  return lista.slice(0, 300).flatMap(g => {
    const x = g as { id?: unknown; subject?: unknown; size?: unknown };
    if (typeof x.id !== "string" || !x.id.endsWith("@g.us")) return [];
    return [{ id: x.id.slice(0, 80), nome: typeof x.subject === "string" ? x.subject.slice(0, 200) : null, participantes: typeof x.size === "number" ? x.size : null }];
  });
}

/**
 * EPIC-025 (Dolores, etapa 4b) — o ÚNICO envio a GRUPO do sistema (POST /message/sendText/{instância} com o id do grupo em
 * `number`): só quando a Dolores foi marcada num grupo cadastrado e ativo (server/dolores/marcacao.ts confere o destino duas
 * vezes antes). Sem prévia de link, sem menção a ninguém (`mentioned` vazio, `mentionsEveryOne` false) e citando a mensagem que
 * a marcou. Id de grupo fora da forma "<dígitos>[-<dígitos>]@g.us" é recusado aqui também (nada é enviado).
 */
export async function enviarTextoAoGrupoEvolution(c: EvolutionConfig, instancia: string, grupoJid: string, texto: string,
  citar: { id: string; participante: string | null; trecho: string }, fetchImpl: Fetch = fetch): Promise<string | null> {
  if (!/^[0-9]{5,40}(-[0-9]{1,20})?@g\.us$/.test(grupoJid)) return null;
  const r = await chamar<{ key?: { id?: string } }>(c, `/message/sendText/${encodeURIComponent(instancia)}`, {
    method: "POST",
    body: JSON.stringify({
      number: grupoJid, text: texto, linkPreview: false, mentionsEveryOne: false, mentioned: [],
      quoted: { key: { id: citar.id, remoteJid: grupoJid, fromMe: false, ...(citar.participante ? { participant: citar.participante } : {}) }, message: { conversation: citar.trecho } },
    }),
  }, fetchImpl);
  return r.ok ? (r.data?.key?.id ?? "enviada") : null;
}

/**
 * EPIC-025 (Dolores, etapa 4b) — SÓ LEITURA: participantes de um grupo (GET /group/participants/{instância}?groupJid=…), para
 * conferir o @lid do número da Dolores (grupos novos do WhatsApp mencionam por @lid). Devolve, por participante, o @lid e o
 * número quando a Evolution informa (campos variam por versão: id, jid, lid, phoneNumber, pn). No máximo 1.024.
 */
export async function participantesDoGrupoEvolution(c: EvolutionConfig, instancia: string, grupoJid: string, fetchImpl: Fetch = fetch): Promise<Array<{ lid: string | null; numero: string | null }>> {
  if (!/^[0-9]{5,40}(-[0-9]{1,20})?@g\.us$/.test(grupoJid)) return [];
  const r = await chamar<unknown>(c, `/group/participants/${encodeURIComponent(instancia)}?groupJid=${encodeURIComponent(grupoJid)}`, { signal: AbortSignal.timeout(15_000) }, fetchImpl);
  if (!r.ok) throw new Error(`A Evolution não listou os participantes (HTTP ${r.status})${motivo(r.data)}.`);
  const bruto = (r.data as { participants?: unknown } | null)?.participants ?? r.data;
  const lista = Array.isArray(bruto) ? bruto.slice(0, 1024) : [];
  return lista.map(p => {
    const x = (p ?? {}) as Record<string, unknown>;
    const campos = [x.id, x.jid, x.lid, x.phoneNumber, x.pn].filter((v): v is string => typeof v === "string");
    const lid = campos.find(v => /^\d{5,25}@lid$/.test(v)) ?? null;
    const n = campos.map(v => /^(\d{10,15})@s\.whatsapp\.net$/.exec(v)?.[1]).find(Boolean) ?? null;
    return { lid, numero: n };
  });
}
