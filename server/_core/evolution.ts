// Pedido de 25/10: WhatsApp por QR code via Evolution API (Baileys) hospedada pelo dono (Railway),
// até a integração da Lógyca. Gêmeo de Grupo-Santa-Fe/web/src/lib/evolution.ts.
import { chaveTelefone, idSemNumero } from "../../shared/whatsapp/conversas.js";
/**
 * `semRedirecionamento` (EPIC-025, QA E4 r2 N4): recusa redirecionamento (`redirect: "error"`), para o `apikey` nunca ir a
 * outro host. Ligado só nas chamadas da Dolores; a Central de Vendas segue como antes (o padrão do fetch, "follow"), porque
 * a URL já é normalizada para https e não há prova de que nenhuma instalação dependa de um redirecionamento.
 */
export type EvolutionConfig = { url: string; apiKey: string; semRedirecionamento?: boolean };
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
  const res = await fetchImpl(`${base(c)}${caminho}`, { ...init, ...(c.semRedirecionamento ? { redirect: "error" as const } : {}), headers: { ...headers(c), ...(init.headers ?? {}) } });
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

/**
 * Como `removerInstancia`, mas diz se a Evolution CONFIRMOU a remoção (2xx; 404 = já não existe, conta como removida).
 * Falha de rede ou outro erro → false (quem chama não deve dar a instância por removida).
 */
export async function removerInstanciaConfirmada(c: EvolutionConfig, instancia: string, fetchImpl: Fetch = fetch): Promise<boolean> {
  await chamar(c, `/instance/logout/${encodeURIComponent(instancia)}`, { method: "DELETE" }, fetchImpl).catch(() => undefined);
  try {
    const r = await chamar(c, `/instance/delete/${encodeURIComponent(instancia)}`, { method: "DELETE" }, fetchImpl);
    return r.ok || r.status === 404;
  } catch { return false; }
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
  return (await enviarTextoEvolutionConfirmado(c, instancia, numero, texto, fetchImpl, opcoes)).externalId;
}

export async function enviarTextoEvolutionConfirmado(c: EvolutionConfig, instancia: string, numero: string, texto: string, fetchImpl: Fetch = fetch,
  opcoes: { linkPreview?: boolean } = {}): Promise<{ aceito: boolean; externalId: string | null }> {
  const num = numero.replace(/\D/g, "");
  const r = await chamar<{ key?: { id?: string }; status?: string; error?: unknown }>(c, `/message/sendText/${encodeURIComponent(instancia)}`, {
    method: "POST",
    body: JSON.stringify({ number: num.startsWith("55") ? num : `55${num}`, text: texto,
      ...(opcoes.linkPreview === undefined ? {} : { linkPreview: opcoes.linkPreview }) }),
  }, fetchImpl);
  const externalId = typeof r.data?.key?.id === "string" ? r.data.key.id || null : null;
  const status = String(r.data?.status ?? "").toUpperCase();
  const aceito = r.ok && !r.data?.error && !["ERROR", "FAILED"].includes(status)
    && (!!externalId || [201, 202, 204].includes(r.status) || ["PENDING", "SERVER_ACK", "DELIVERY_ACK", "READ"].includes(status));
  return { aceito, externalId: aceito ? externalId : null };
}

/**
 * EPIC-026 C3: imagem com legenda (uma mensagem só). O arquivo vai em base64 no próprio pedido — nunca por URL: a Evolution não
 * busca nada no sistema e nada do sistema fica exposto. Devolve o id da mensagem, ou null se não foi aceita.
 */
export async function enviarImagemEvolution(c: EvolutionConfig, instancia: string, numero: string,
  imagem: { base64: string; mime: string; nome: string; legenda: string }, fetchImpl: Fetch = fetch): Promise<string | null> {
  const num = numero.replace(/\D/g, "");
  const r = await chamar<{ key?: { id?: string } }>(c, `/message/sendMedia/${encodeURIComponent(instancia)}`, {
    method: "POST",
    body: JSON.stringify({ number: num.startsWith("55") ? num : `55${num}`, mediatype: "image", mimetype: imagem.mime,
      caption: imagem.legenda, media: imagem.base64, fileName: imagem.nome }),
  }, fetchImpl);
  return r.ok ? (r.data?.key?.id ?? null) : null;
}

/**
 * EPIC-029 S-3: documento (PDF) com legenda, pelo MESMO endereço da imagem (`/message/sendMedia`, `mediatype: "document"`). O arquivo vai
 * em base64 no próprio pedido — nunca por URL: a Evolution não busca nada no sistema e nenhum link público é criado. O nome do arquivo
 * não leva dado pessoal (quem chama monta). Devolve o id da mensagem, ou null se não foi aceita.
 */
export async function enviarDocumentoEvolution(c: EvolutionConfig, instancia: string, numero: string,
  doc: { base64: string; mime: string; nome: string; legenda: string }, fetchImpl: Fetch = fetch): Promise<string | null> {
  const num = numero.replace(/\D/g, "");
  const r = await chamar<{ key?: { id?: string } }>(c, `/message/sendMedia/${encodeURIComponent(instancia)}`, {
    method: "POST",
    body: JSON.stringify({ number: num.startsWith("55") ? num : `55${num}`, mediatype: "document", mimetype: doc.mime,
      caption: doc.legenda, media: doc.base64, fileName: doc.nome }),
  }, fetchImpl);
  return r.ok ? (r.data?.key?.id ?? null) : null;
}

/**
 * EPIC-026 C3: áudio como MENSAGEM DE VOZ (ptt). `encoding: true` pede à Evolution a conversão para OGG/Opus (aceita OGG, MP3 e
 * M4A). Base64 no pedido, nunca URL. Devolve o id da mensagem, ou null se não foi aceita.
 */
export async function enviarAudioEvolution(c: EvolutionConfig, instancia: string, numero: string, base64: string, fetchImpl: Fetch = fetch): Promise<string | null> {
  const num = numero.replace(/\D/g, "");
  const r = await chamar<{ key?: { id?: string } }>(c, `/message/sendWhatsAppAudio/${encodeURIComponent(instancia)}`, {
    method: "POST",
    body: JSON.stringify({ number: num.startsWith("55") ? num : `55${num}`, audio: base64, encoding: true }),
  }, fetchImpl);
  return r.ok ? (r.data?.key?.id ?? null) : null;
}

/**
 * Pedido de 25/10 (Conversas): a Evolution passa a avisar o sistema de mensagens recebidas, status de
 * entrega/leitura e da conexão. Cabeçalho secreto para o sistema aceitar só avisos legítimos.
 */
/**
 * EPIC-025 (etapa 7): a instância da Dolores assina também os avisos de grupo (quem a adicionou e a criação do grupo), para provar
 * que foi o DONO quem a colocou no grupo. A Central de Vendas continua com os três avisos de sempre.
 */
export const EVENTOS_WEBHOOK_PADRAO = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"] as const;
// Etapa 9: e as LIGAÇÕES (CALL), para o aviso "não atendo ligações, pode me escrever". Só vale depois de "Reativar recebimento".
export const EVENTOS_WEBHOOK_DOLORES = [...EVENTOS_WEBHOOK_PADRAO, "GROUP_PARTICIPANTS_UPDATE", "GROUPS_UPSERT", "CALL"] as const;
export async function registrarWebhookEvolution(c: EvolutionConfig, instancia: string, url: string, segredo: string, fetchImpl: Fetch = fetch, eventos: readonly string[] = EVENTOS_WEBHOOK_PADRAO): Promise<void> {
  const r = await chamar(c, `/webhook/set/${encodeURIComponent(instancia)}`, {
    method: "POST",
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url,
        headers: { "x-webhook-token": segredo },
        byEvents: false,
        base64: false,
        events: [...eventos],
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
  // EPIC-026 C2: conversa de número não identificado ("@lid") só é a mesma que o MESMO "@lid"; nunca casa com telefone
  const la = idSemNumero(a), lb = idSemNumero(b);
  if (la || lb) return la !== null && la === lb;
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
 * EPIC-025 (Dolores, etapa 7) — SÓ LEITURA: os dados de um grupo (GET /group/findGroupInfos/{instância}?groupJid=…): o NOME (para o
 * tipo), quem o criou (owner) e os participantes com o admin — para provar, por código, que foi o DONO quem colocou a Dolores
 * (regra do dono de 19/11/2026). Tudo é texto de terceiro (quem chama filtra). Id fora da forma → null.
 */
export async function metadadoDoGrupoEvolution(c: EvolutionConfig, instancia: string, grupoJid: string, fetchImpl: Fetch = fetch, prazoMs = 5_000): Promise<{ nome: string | null; criador: string[]; participantes: unknown[] } | null> {
  if (!/^[0-9]{5,40}(-[0-9]{1,20})?@g\.us$/.test(grupoJid)) return null;
  const r = await chamar<unknown>(c, `/group/findGroupInfos/${encodeURIComponent(instancia)}?groupJid=${encodeURIComponent(grupoJid)}`, { signal: AbortSignal.timeout(prazoMs) }, fetchImpl);
  if (!r.ok) throw new Error(`A Evolution não informou o grupo (HTTP ${r.status})${motivo(r.data)}.`);
  const d = (Array.isArray(r.data) ? r.data[0] : r.data) as Record<string, unknown> | null;
  if (!d || typeof d !== "object" || (typeof d.id === "string" && d.id !== grupoJid)) return null;
  const criador = [d.owner, d.ownerPn, d.ownerJid, d.ownerAlt].filter((v): v is string => typeof v === "string").map(v => v.slice(0, 80));
  return {
    nome: typeof d.subject === "string" && d.subject.trim() ? d.subject.slice(0, 200) : null,
    criador,
    participantes: Array.isArray(d.participants) ? d.participants.slice(0, 1024) : [],
  };
}

/**
 * EPIC-025 (Dolores, etapa 4b) — o ÚNICO envio da DOLORES a GRUPO (EPIC-027 C2: o da equipe pela Central é
 * `enviarTextoDaEquipeAoGrupoEvolution`, abaixo) (POST /message/sendText/{instância} com o id do grupo em
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
 * EPIC-027 C2 — o envio da EQUIPE a um grupo, pela Central WhatsApp (server/whatsapp-grupos-central.ts confere permissão, grupo e
 * tetos antes). Texto puro: sem citação, sem prévia de link e sem menção a ninguém (`mentioned` vazio, `mentionsEveryOne` false) —
 * nem à Dolores (o que a equipe escreve não a marca). Id de grupo fora da forma "<dígitos>[-<dígitos>]@g.us" é recusado aqui também.
 * Devolve se a Evolution aceitou e o id da mensagem (o eco chega com o mesmo id).
 */
export async function enviarTextoDaEquipeAoGrupoEvolution(c: EvolutionConfig, instancia: string, grupoJid: string, texto: string,
  fetchImpl: Fetch = fetch): Promise<{ ok: boolean; id: string | null }> {
  if (!/^[0-9]{5,40}(-[0-9]{1,20})?@g\.us$/.test(grupoJid)) return { ok: false, id: null };
  const r = await chamar<{ key?: { id?: string } }>(c, `/message/sendText/${encodeURIComponent(instancia)}`, {
    method: "POST",
    body: JSON.stringify({ number: grupoJid, text: texto, linkPreview: false, mentionsEveryOne: false, mentioned: [] }),
    signal: AbortSignal.timeout(20_000),
  }, fetchImpl);
  const id = typeof r.data?.key?.id === "string" ? r.data.key.id.slice(0, 160) : null;
  return { ok: r.ok, id: r.ok ? id : null };
}

/**
 * EPIC-025 (Dolores, etapa 4b) — SÓ LEITURA: participantes de um grupo (GET /group/participants/{instância}?groupJid=…), para
 * conferir o @lid do número da Dolores (grupos novos do WhatsApp mencionam por @lid). Devolve, por participante, o @lid e o
 * número quando a Evolution informa (campos variam por versão: id, jid, lid, phoneNumber, pn). No máximo 1.024.
 */
export async function participantesDoGrupoEvolution(c: EvolutionConfig, instancia: string, grupoJid: string, fetchImpl: Fetch = fetch, prazoMs = 15_000): Promise<Array<{ lid: string | null; numero: string | null }>> {
  if (!/^[0-9]{5,40}(-[0-9]{1,20})?@g\.us$/.test(grupoJid)) return [];
  const r = await chamar<unknown>(c, `/group/participants/${encodeURIComponent(instancia)}?groupJid=${encodeURIComponent(grupoJid)}`, { signal: AbortSignal.timeout(prazoMs) }, fetchImpl);
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

/**
 * EPIC-025 (etapa 9) — rejeitar ligações na instância (a Evolution não atende ligação; com `rejectCall` ela recusa na hora). Seguro:
 * LÊ as configurações atuais (GET /settings/find/{instância}) e grava as MESMAS, trocando só `rejectCall` para true e `msgCall` para
 * vazio (o aviso por texto é do sistema, com o limite de 1 a cada N horas por número). Se a leitura não vier no formato conhecido,
 * nada é gravado (devolve false). Nunca mexe na conexão.
 */
export async function rejeitarLigacoesEvolution(c: EvolutionConfig, instancia: string, fetchImpl: Fetch = fetch): Promise<boolean> {
  const atual = await chamar<Record<string, unknown>>(c, `/settings/find/${encodeURIComponent(instancia)}`, { signal: AbortSignal.timeout(8_000) }, fetchImpl);
  const d = atual.ok && atual.data && typeof atual.data === "object" ? atual.data : null;
  const campos = ["groupsIgnore", "alwaysOnline", "readMessages", "readStatus", "syncFullHistory"] as const;
  if (!d || !campos.every(k => typeof d[k] === "boolean")) return false;
  if (d.rejectCall === true && !d.msgCall) return true;
  const corpo: Record<string, unknown> = { rejectCall: true, msgCall: "" };
  for (const k of campos) corpo[k] = d[k];
  const r = await chamar(c, `/settings/set/${encodeURIComponent(instancia)}`, { method: "POST", body: JSON.stringify(corpo), signal: AbortSignal.timeout(8_000) }, fetchImpl);
  return r.ok;
}

/**
 * EPIC-026 C2 — SÓ LEITURA: tenta descobrir o número real de um endereço "@lid" de conversa direta nos contatos da instância
 * (POST /chat/findContacts/{instância} com `where.remoteJid`). Os campos variam por versão da Evolution; por isso a leitura é
 * ESTRITA: só vale um contato que cite o MESMO "@lid" (em id/remoteJid/lid/jid) e traga um número na forma "…@s.whatsapp.net"
 * (remoteJid, remoteJidAlt, phoneNumber, pn, senderPn ou jid). Se a Evolution ignorar o filtro e devolver outros contatos, eles não
 * citam o "@lid" e não contam; dois números diferentes para o mesmo "@lid" → null (nunca adivinha). Falha/sem resposta → null.
 */
export async function numeroDoLidEvolution(c: EvolutionConfig, instancia: string, lid: string, fetchImpl: Fetch = fetch, prazoMs = 3_000): Promise<string | null> {
  if (!/^\d{1,25}@lid$/.test(lid)) return null;
  let r;
  try {
    r = await chamar<unknown>(c, `/chat/findContacts/${encodeURIComponent(instancia)}`, {
      method: "POST", body: JSON.stringify({ where: { remoteJid: lid } }), signal: AbortSignal.timeout(prazoMs),
    }, fetchImpl);
  } catch { return null; }
  if (!r.ok) return null;
  const lista = Array.isArray(r.data) ? r.data.slice(0, 50) : r.data && typeof r.data === "object" ? [r.data] : [];
  const achados = new Set<string>();
  for (const x of lista) {
    const o = (x ?? {}) as Record<string, unknown>;
    const citaOLid = [o.id, o.remoteJid, o.lid, o.jid].some(v => typeof v === "string" && v.trim() === lid);
    if (!citaOLid) continue;
    for (const v of [o.remoteJid, o.remoteJidAlt, o.phoneNumber, o.pn, o.senderPn, o.jid]) {
      const n = typeof v === "string" ? /^(\d{10,15})(?::\d{1,3})?@s\.whatsapp\.net$/.exec(v.trim())?.[1] : undefined;
      if (n) achados.add(n);
    }
  }
  return achados.size === 1 ? Array.from(achados)[0] : null;
}
