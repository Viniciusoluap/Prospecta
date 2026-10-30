// Pedido de 25/10 (Conversas): avisos da Evolution — mensagens recebidas/enviadas pelo celular, status de
// entrega/leitura e estado da conexão. Só aceita com o cabeçalho secreto registrado pelo próprio sistema.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { leads, userNotifications, whatsappConnections, whatsappConversationLinks, whatsappMessages } from "../drizzle/schema.js";
import { chaveTelefone } from "../shared/whatsapp/conversas.js";
import { ENV } from "./_core/env.js";
import { LIMITE_MIDIA, mesmoTelefone, midiaDaMensagem, textoDaMensagem } from "./_core/evolution.js";
import { normalizarStatusWebhook } from "./_core/whatsapp-business.js";
import { getDb } from "./db.js";
import { baixarEGuardarMidia } from "./whatsapp-midia.js";

const SITE = () => (process.env.PUBLIC_SITE_URL || "https://www.prospectaconstrucoes.com").replace(/\/+$/, "");
export const URL_WEBHOOK_EVOLUTION = () => `${SITE()}/api/whatsapp/evolution-webhook`;

export function segredoWebhookEvolution(): string {
  if (!ENV.cookieSecret) throw new Error("JWT_SECRET ausente.");
  return createHmac("sha256", ENV.cookieSecret).update("evolution-webhook").digest("hex");
}

function autorizado(recebido: unknown) {
  if (typeof recebido !== "string") return false;
  const a = Buffer.from(recebido), b = Buffer.from(segredoWebhookEvolution());
  return a.length === b.length && timingSafeEqual(a, b);
}

type Evento = { event?: string; instance?: string; data?: any };

export async function processarEventoEvolution(ev: Evento): Promise<string> {
  const db = getDb();
  const evento = (ev.event ?? "").toLowerCase().replace(/_/g, ".");
  if (!ev.instance) return "sem-instancia";
  const [conn] = await db.select().from(whatsappConnections).where(eq(whatsappConnections.instancia, ev.instance)).limit(1);
  if (!conn) return "conexao-desconhecida";

  if (evento === "connection.update") {
    const st = ev.data?.state;
    const status = st === "open" ? "conectado" : st === "connecting" ? "aguardando_qr" : "desconectado";
    await db.update(whatsappConnections).set({ status, updatedAt: new Date() }).where(eq(whatsappConnections.id, conn.id));
    return "conexao";
  }

  if (evento === "messages.update") {
    const itens = Array.isArray(ev.data) ? ev.data : [ev.data];
    for (const d of itens) {
      const id = d?.keyId ?? d?.key?.id;
      if (!id || !d?.status) continue;
      await db.update(whatsappMessages).set({ status: normalizarStatusWebhook(String(d.status)), updatedAt: new Date() })
        .where(and(eq(whatsappMessages.connectionId, conn.id), eq(whatsappMessages.externalId, id)));
    }
    return "status";
  }

  if (evento === "messages.upsert") {
    const itens = Array.isArray(ev.data) ? ev.data : [ev.data];
    let novas = 0;
    for (const d of itens) {
      const jid: string = d?.key?.remoteJid ?? "";
      if (!jid.endsWith("@s.whatsapp.net")) continue; // ignora grupos, status e listas
      const id: string | undefined = d?.key?.id;
      if (id) {
        const [ja] = await db.select({ id: whatsappMessages.id }).from(whatsappMessages)
          .where(and(eq(whatsappMessages.connectionId, conn.id), eq(whatsappMessages.externalId, id))).limit(1);
        if (ja) continue; // enviada pelo sistema (já gravada) ou repetida
      }
      const numero = jid.split("@")[0];
      const deMim = Boolean(d?.key?.fromMe);
      const todos = await db.select({ id: leads.id, nome: leads.name, phone: leads.phone }).from(leads);
      // Lote 03, correção 02: o vínculo manual da conversa vale mais que o telefone.
      const [vinculo] = await db.select({ leadId: whatsappConversationLinks.leadId }).from(whatsappConversationLinks)
        .where(and(eq(whatsappConversationLinks.connectionId, conn.id), eq(whatsappConversationLinks.phoneKey, chaveTelefone(numero)))).limit(1);
      const lead = (vinculo ? todos.find(l => l.id === vinculo.leadId) : undefined) ?? todos.find(l => mesmoTelefone(l.phone, numero));
      const midia = midiaDaMensagem(d?.message);
      const [gravada] = await db.insert(whatsappMessages).values({
        connectionId: conn.id, leadId: lead?.id ?? null, destinatario: numero,
        // `pushName` em eventos fromMe é o dono da sessão, não o destinatário.
        nomeDestinatario: lead?.nome ?? (!deMim ? d?.pushName : null) ?? null, mensagem: textoDaMensagem(d?.message).slice(0, 4000),
        externalId: id ?? null, status: deMim ? "enviada" : "recebida", direcao: deMim ? "saida" : "entrada", lida: deMim,
        ...(midia ? { midiaTipo: midia.tipo, midiaMime: midia.mime, midiaNome: midia.nome, midiaTamanho: midia.tamanho } : {}),
      }).returning({ id: whatsappMessages.id });
      // Pedido de 25/10 (noite): o arquivo (até 10 MB) é buscado na Evolution e guardado no banco.
      // Falha não derruba o aviso: a mensagem fica com o rótulo e a tela oferece "tentar baixar de novo".
      if (midia && id && gravada && conn.instancia && !(midia.tamanho && midia.tamanho > LIMITE_MIDIA)) {
        await baixarEGuardarMidia(gravada.id, conn.instancia, id, midia.tamanho);
      }
      if (!deMim) {
        novas++;
        await db.insert(userNotifications).values({
          userId: conn.userId, type: "system",
          title: `WhatsApp: nova mensagem de ${lead?.nome ?? d?.pushName ?? numero}`,
          message: textoDaMensagem(d?.message).slice(0, 300),
          actionUrl: `/admin/whatsapp?aba=conversas&numero=${numero}`,
        });
      }
    }
    return `mensagens:${novas}`;
  }
  return "ignorado";
}

export async function handleEvolutionWebhook(req: Request, res: Response) {
  if (!autorizado(req.headers["x-webhook-token"])) return res.status(401).json({ error: "Não autorizado" });
  try {
    return res.status(200).json({ ok: true, r: await processarEventoEvolution(req.body ?? {}) });
  } catch (e) {
    console.error("[Evolution Webhook]", e instanceof Error ? e.message : e);
    return res.status(200).json({ ok: false });
  }
}
