// EPIC-027 C7 (20/11/2026) — aviso de situação de entrega da YCloud: rota pública POST /api/ycloud/webhook.
// Conferido na documentação oficial (20/11/2026):
// https://docs.ycloud.com/en/api-reference/guides/api-fundamentals/implement-a-webhook-receiver.md e
// https://docs.ycloud.com/en/documentation/developer/webhooks :
// - cabeçalho `YCloud-Signature: t=<unix em segundos>,s=<hex>`; assinado = `${t}.` + corpo BRUTO (nada depois do corpo);
//   HMAC-SHA256 com o `secret` do endpoint; comparação em tempo constante; janela de 5 min é política nossa (anti-reenvio);
// - responder 2xx rápido (< 6 s); deduplicar por `id` do evento; falha ao gravar → não-2xx para a YCloud reenviar;
// - `whatsapp.message.updated` traz `whatsappMessage` { id, externalId, status, errorCode, errorMessage, sendTime, deliverTime,
//   readTime, totalPrice, currency } (https://docs.ycloud.com/en/api-reference/webhook-reference/whatsapp-message-updated.md).
// Requisição sem assinatura válida: 401, nada processado, corpo vazio (sem detalhe).
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, or } from "drizzle-orm";
import { whatsappMessages } from "../../drizzle/schema.js";
import { ycloudEnvios, ycloudEventos } from "../../drizzle/schema-ycloud.js";
import { situacaoConvergente, statusNaCentral } from "../../shared/whatsapp/ycloud.js";
import { getDb } from "../db.js";
import { registrarOptoutDoAviso } from "./campanhas.js";
import { auditarYcloud, depsYcloud, segredoWebhookYcloud } from "./config.js";

export const TOLERANCIA_ASSINATURA_S = 300;
/**
 * Reenvio da YCloud: a documentação diz que a janela de 5 min é "política da aplicação, não prazo de reenvio" e lista reenvios até
 * ~6 h depois (10 s, 30 s, 5 min, 30 min, 1 h, 2 h, 2 h), mas NÃO diz se o reenvio traz um `t` novo. Por isso, assinatura VÁLIDA com
 * `t` de até 8 h atrás também é aceita — e só é processada se o `id` do evento ainda não foi visto (a deduplicação por id barra o
 * replay de um aviso já recebido). `t` no futuro continua limitado a 5 min.
 */
export const TOLERANCIA_REENVIO_S = 8 * 60 * 60;

/** Confere a assinatura. Qualquer forma estranha → false. `passadoS`/`futuroS`: idade máxima aceita do `t`. */
export function verificarAssinaturaYcloud(corpo: Buffer, cabecalho: string | undefined, segredo: string | null, agoraMs: number,
  o: { passadoS?: number; futuroS?: number } = {}): boolean {
  if (!Buffer.isBuffer(corpo) || typeof cabecalho !== "string" || !segredo || cabecalho.length > 1000) return false;
  const campos = cabecalho.split(",").map(p => p.trim().split("="));
  const ts = campos.filter(([k]) => k === "t").map(([, v]) => v);
  const assinaturas = campos.filter(([k]) => k === "s").map(([, v]) => v);
  if (ts.length !== 1 || !/^\d{1,12}$/.test(ts[0] ?? "")) return false;
  const idade = Math.floor(agoraMs / 1000) - Number(ts[0]);
  if (idade > (o.passadoS ?? TOLERANCIA_ASSINATURA_S) || -idade > (o.futuroS ?? TOLERANCIA_ASSINATURA_S)) return false;
  const esperado = createHmac("sha256", segredo).update(`${ts[0]}.`).update(corpo).digest();
  return assinaturas.some(s => typeof s === "string" && /^[a-fA-F0-9]{64}$/.test(s) && timingSafeEqual(esperado, Buffer.from(s, "hex")));
}

const dataOu = (v: unknown, padrao: Date): Date => {
  if (typeof v === "string") { const d = new Date(v); if (!Number.isNaN(d.getTime())) return d; }
  return padrao;
};
/** Motivo da falha para a tela: sem sequências longas de dígitos (podem ser telefones), curto. */
const motivoSeguro = (v: unknown) => (typeof v === "string" && v.trim() ? v.replace(/\d{6,}/g, "…").slice(0, 300) : null);
const codigoSeguro = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).replace(/[^\w.-]/g, "").slice(0, 60) || null : null);

/** Aplica um `whatsapp.message.updated` ao envio da campanha (por id da YCloud ou pelo nosso externalId). */
export async function aplicarSituacaoYcloud(m: any, criadoEm: Date): Promise<"atualizado" | "desconhecido"> {
  if (!m || typeof m !== "object") return "desconhecido";
  const id = typeof m.id === "string" ? m.id.slice(0, 80) : null;
  const ext = typeof m.externalId === "string" && /^prospecta-c\d+-\d+$/.test(m.externalId) ? m.externalId : null;
  if (!id && !ext) return "desconhecido";
  const db = getDb();
  const [e] = await db.select().from(ycloudEnvios)
    .where(or(...[id ? eq(ycloudEnvios.ycloudId, id) : undefined, ext ? eq(ycloudEnvios.externalId, ext) : undefined].filter(Boolean) as never[])).limit(1);
  if (!e) return "desconhecido";
  const status = String(m.status ?? "");
  const h = { aceitoEm: e.aceitoEm ?? criadoEm, enviadoEm: e.enviadoEm, entregueEm: e.entregueEm, lidoEm: e.lidoEm, falhouEm: e.falhouEm };
  if (status === "sent") h.enviadoEm ??= dataOu(m.sendTime, criadoEm);
  if (status === "delivered") { h.entregueEm ??= dataOu(m.deliverTime, criadoEm); h.enviadoEm ??= dataOu(m.sendTime, h.entregueEm); }
  if (status === "read") { h.lidoEm ??= dataOu(m.readTime, criadoEm); }
  if (status === "failed") h.falhouEm ??= criadoEm;
  const nova = situacaoConvergente(h);
  const precoChegou = typeof m.totalPrice === "number" && Number.isFinite(m.totalPrice);
  const final = status === "delivered" || status === "read";
  const atualizarPreco = precoChegou && (final || !e.precoFinal);
  await db.update(ycloudEnvios).set({
    status: nova, ...h,
    ...(e.ycloudId ? {} : id ? { ycloudId: id } : {}),
    ...(typeof m.wamid === "string" && !e.wamid ? { wamid: m.wamid.slice(0, 255) } : {}),
    ...(status === "failed" ? { motivo: motivoSeguro(m.errorMessage) ?? "Falha informada pela Meta.", erroCodigo: codigoSeguro(m.errorCode) } : {}),
    ...(atualizarPreco ? { preco: String(m.totalPrice), moeda: typeof m.currency === "string" ? m.currency.slice(0, 3) : e.moeda, precoFinal: final || e.precoFinal } : {}),
    atualizadoEm: depsYcloud().agora(),
  }).where(eq(ycloudEnvios.id, e.id));
  if (e.mensagemCentralId) {
    await db.update(whatsappMessages).set({ status: statusNaCentral(nova), ...(nova === "falhou" ? { erroMsg: "Campanha (API oficial): falha na entrega." } : {}), updatedAt: depsYcloud().agora() })
      .where(and(eq(whatsappMessages.id, e.mensagemCentralId), eq(whatsappMessages.automatica, true)));
  }
  return "atualizado";
}

export async function processarEventoYcloud(ev: any): Promise<void> {
  const criadoEm = dataOu(ev?.createTime, depsYcloud().agora());
  switch (ev?.type) {
    case "whatsapp.message.updated":
      await aplicarSituacaoYcloud(ev.whatsappMessage, criadoEm);
      return;
    case "whatsapp.template.reviewed": {
      const t = ev.whatsappTemplate;
      const nome = typeof t?.name === "string" ? t.name.slice(0, 200) : "?";
      await auditarYcloud({ acao: "modelo_revisado", usuarioId: null, modelo: `${nome} (${typeof t?.language === "string" ? t.language.slice(0, 20) : "?"})`, detalhe: typeof t?.status === "string" ? `status_ycloud=${t.status.replace(/[^A-Za-z0-9_]/g, "").slice(0, 30)}` : null });
      // C7.1: o status vem da YCloud (fora do nosso controle). Prefixado e limpo, nunca é lido como "papel=…" por separarPapel.
      return;
    }
    // não assinados por padrão; tratados se o dono os ligar no painel da YCloud (opt-out de marketing)
    case "whatsapp.user.preferences": {
      const p = ev.whatsappUserPreference;
      if (p && String(p.value ?? "").toLowerCase() === "stop") await registrarOptoutDoAviso(p.contactPhoneNumber, "whatsapp_preferencia");
      return;
    }
    case "contact.unsubscribe.created":
      await registrarOptoutDoAviso(ev.unsubscriberChanged?.phoneNumber, "ycloud_descadastro");
      return;
    default:
      return; // tipo desconhecido: aceita sem fazer nada
  }
}

export async function tratarWebhookYcloud(req: Request, res: Response): Promise<void> {
  const corpo = req.body;
  let segredo: string | null = null;
  try { segredo = await segredoWebhookYcloud(); } catch { segredo = null; }
  const agoraMs = depsYcloud().agora().getTime();
  const cab = req.get("YCloud-Signature");
  // assinatura válida dentro de 5 min, ou de até 8 h atrás (reenvio); o id repetido é barrado logo abaixo, sem processar
  if (!Buffer.isBuffer(corpo) || !verificarAssinaturaYcloud(corpo, cab, segredo, agoraMs, { passadoS: TOLERANCIA_REENVIO_S })) {
    res.status(401).end();
    return;
  }
  let ev: any;
  try { ev = JSON.parse(corpo.toString("utf8")); } catch { res.status(400).end(); return; }
  if (!ev || typeof ev.id !== "string" || ev.id.length < 6 || ev.id.length > 128 || typeof ev.type !== "string" || ev.type.length > 80) {
    res.status(400).end();
    return;
  }
  const db = getDb();
  let novo: unknown[];
  try {
    novo = await db.insert(ycloudEventos).values({ id: ev.id, tipo: ev.type, recebidoEm: depsYcloud().agora() }).onConflictDoNothing().returning({ id: ycloudEventos.id });
  } catch { res.status(503).end(); return; }
  if (!novo.length) { res.status(204).end(); return; } // repetido: já processado
  try {
    await processarEventoYcloud(ev);
  } catch {
    // não processou: apaga a marca para a YCloud reenviar (e não registra conteúdo em log)
    await db.delete(ycloudEventos).where(eq(ycloudEventos.id, ev.id)).catch(() => undefined);
    console.error("[ycloud/webhook] falha ao processar um aviso; a YCloud vai reenviar.");
    res.status(503).end();
    return;
  }
  res.status(204).end();
}
