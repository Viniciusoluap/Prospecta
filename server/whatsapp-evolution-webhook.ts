// Pedido de 25/10 (Conversas): avisos da Evolution — mensagens recebidas/enviadas pelo celular, status de
// entrega/leitura e estado da conexão. Só aceita com o cabeçalho secreto registrado pelo próprio sistema.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { and, eq, inArray, sql, type AnyColumn } from "drizzle-orm";
import { leads, userNotifications, users, whatsappConnections, whatsappConversationLinks, whatsappMessages } from "../drizzle/schema.js";
import { chaveTelefone, idSemNumero } from "../shared/whatsapp/conversas.js";
import { ENV } from "./_core/env.js";
import { LIMITE_MIDIA, mesmoTelefone, midiaDaMensagem, textoDaMensagem } from "./_core/evolution.js";
import { normalizarStatusWebhook } from "./_core/whatsapp-business.js";
import { getDb } from "./db.js";
import { baixarEGuardarMidia } from "./whatsapp-midia.js";
import { INSTANCIA_DOLORES } from "../shared/dolores/whatsapp.js";
import { usaConexaoDaEmpresa } from "./whatsapp-conexao-empresa.js";

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

/**
 * QA-SEG E9 achado 4: os 8 dígitos finais do telefone guardado na coluna (só dígitos) — a MESMA expressão dos índices da migração
 * 0135. Filtra no banco os candidatos de um número (sem carregar a tabela inteira e sem limite que corte candidatos); a conferência
 * fina (estrita ou pela chave da Central) continua em memória, sobre esses poucos.
 */
export const finalDoTelefone = (coluna: AnyColumn) => sql`right(regexp_replace(coalesce(${coluna}, ''), '\\D', '', 'g'), 8)`;
export type LeadCandidato = { id: number; nome: string | null; phone: string | null };

/** Leads (inclusive excluídos, como antes) cujo telefone termina nos mesmos 8 dígitos do número. Número curto → nenhum. */
export async function leadsComOsMesmosFinais(numero: string): Promise<LeadCandidato[]> {
  const final = numero.replace(/\D/g, "").slice(-8);
  if (final.length < 8) return [];
  return getDb().select({ id: leads.id, nome: leads.name, phone: leads.phone }).from(leads).where(sql`${finalDoTelefone(leads.phone)} = ${final}`);
}

/** O usuário é administrador ativo (por papel)? Falha ao ler → não. */
async function ehAdministrador(userId: number): Promise<boolean> {
  try {
    const [u] = await getDb().select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
    return u?.role === "admin";
  } catch { return false; }
}

export type ResultadoGravacao = { id: number | null; nova: boolean; deMim: boolean; leadId: number | null; existente: { id: number; automatica: boolean } | null };

/**
 * Pedido de 25/10 (Conversas) — UMA mensagem de conversa direta (recebida ou enviada pelo celular) gravada na conversa da conexão.
 * Grupos, status e listas não entram. A mesma mensagem (conexão + id) não é gravada duas vezes. EPIC-025 E9: também usada pelo
 * roteamento do número da EMPRESA (server/dolores/roteamento.ts), que decide antes o que pode entrar (nunca a conversa do dono nem
 * grupo) — e lá a Central de Vendas e o download da mídia na hora ficam de fora (`centralVendas`/`baixarMidia` falsos).
 */
export async function gravarItemNaCentral(conn: { id: number; userId: number; instancia: string | null }, d: any,
  o: { centralVendas?: boolean; baixarMidia?: boolean; mensagem?: string | null; notificar?: boolean; leadsCandidatos?: LeadCandidato[]; numero?: string | null; semNumero?: string | null } = {}): Promise<ResultadoGravacao> {
  const db = getDb();
  const vazio: ResultadoGravacao = { id: null, nova: false, deMim: Boolean(d?.key?.fromMe), leadId: null, existente: null };
  const jid: string = typeof d?.key?.remoteJid === "string" ? d.key.remoteJid.trim() : "";
  // EPIC-026 C2: endereço "@lid" entra com o número conferido pelo roteamento (`numero`) ou, sem ele, como conversa de número não
  // identificado (`semNumero` = o "@lid", que vira a chave da conversa — nunca um telefone inventado). Grupos, status e listas não.
  let numero: string;
  let semNumero = false;
  if (jid.endsWith("@s.whatsapp.net")) numero = jid.split("@")[0].split(":")[0];
  else if (jid.endsWith("@lid") && o.numero && /^\d{10,15}$/.test(o.numero)) numero = o.numero;
  else if (jid.endsWith("@lid") && o.semNumero && idSemNumero(o.semNumero)) { numero = idSemNumero(o.semNumero)!; semNumero = true; }
  else return vazio; // ignora grupos, status e listas
  const id: string | undefined = d?.key?.id;
  if (id) {
    const [ja] = await db.select({ id: whatsappMessages.id, automatica: whatsappMessages.automatica }).from(whatsappMessages)
      .where(and(eq(whatsappMessages.connectionId, conn.id), eq(whatsappMessages.externalId, id))).limit(1);
    if (ja) return { ...vazio, existente: ja }; // enviada pelo sistema (já gravada) ou repetida
  }
  const deMim = Boolean(d?.key?.fromMe);
  // QA-SEG E9 achado 4: só os leads com os mesmos 8 finais (do banco, ou os que o roteamento já trouxe), não a tabela inteira.
  // EPIC-026 C2: sem número, nenhum lead (nada casa com o "@lid") e nenhum vínculo.
  const todos = semNumero ? [] : o.leadsCandidatos ?? await leadsComOsMesmosFinais(numero);
  // Lote 03, correção 02: o vínculo manual da conversa vale mais que o telefone.
  const [vinculo] = semNumero ? [] : await db.select({ leadId: whatsappConversationLinks.leadId }).from(whatsappConversationLinks)
    .where(and(eq(whatsappConversationLinks.connectionId, conn.id), eq(whatsappConversationLinks.phoneKey, chaveTelefone(numero)))).limit(1);
  const manual = vinculo ? (todos.find(l => l.id === vinculo.leadId)
    ?? (await db.select({ id: leads.id, nome: leads.name, phone: leads.phone }).from(leads).where(inArray(leads.id, [vinculo.leadId])).limit(1))[0]) : undefined;
  const lead = manual ?? todos.find(l => mesmoTelefone(l.phone, numero));
  const midia = midiaDaMensagem(d?.message);
  const texto = (o.mensagem ?? textoDaMensagem(d?.message)).slice(0, 4000);
  const [gravada] = await db.insert(whatsappMessages).values({
    connectionId: conn.id, leadId: lead?.id ?? null, destinatario: numero,
    // `pushName` em eventos fromMe é o dono da sessão, não o destinatário.
    nomeDestinatario: lead?.nome ?? (!deMim ? d?.pushName : null) ?? null, mensagem: texto,
    externalId: id ?? null, status: deMim ? "enviada" : "recebida", direcao: deMim ? "saida" : "entrada", lida: deMim,
    ...(midia ? { midiaTipo: midia.tipo, midiaMime: midia.mime, midiaNome: midia.nome, midiaTamanho: midia.tamanho } : {}),
  }).returning({ id: whatsappMessages.id });
  // Pedido de 25/10 (noite): o arquivo (até 10 MB) é buscado na Evolution e guardado no banco.
  // Falha não derruba o aviso: a mensagem fica com o rótulo e a tela oferece "tentar baixar de novo".
  if (o.baixarMidia && midia && id && gravada && conn.instancia && !(midia.tamanho && midia.tamanho > LIMITE_MIDIA)) {
    await baixarEGuardarMidia(gravada.id, conn.instancia, id, midia.tamanho);
  }
  // Central de Vendas (12/11): mensagem recebida entra no serviço de entrada (desligado por padrão; nunca lança).
  if (o.centralVendas && !deMim && gravada) {
    const { aoReceberMensagemWhatsapp } = await import("./central-vendas/entrada.js");
    await aoReceberMensagemWhatsapp({ connectionId: conn.id, messageId: gravada.id, numero, nome: d?.pushName ?? null, texto: textoDaMensagem(d?.message), temMidia: Boolean(midia), leadIdDaMensagem: lead?.id ?? null });
  }
  // QA-SEG C2 achado 1: a de número não identificado pode ser do dono (comando) — o aviso não leva o texto nem o nome e só vai a
  // administrador (a conexão da empresa é a linha do primeiro admin; conferido aqui pelo papel, falha fechada).
  if (!deMim && gravada && o.notificar !== false && (!semNumero || await ehAdministrador(conn.userId))) {
    await db.insert(userNotifications).values({
      userId: conn.userId, type: "system",
      title: semNumero ? "WhatsApp: nova mensagem de número não identificado" : `WhatsApp: nova mensagem de ${lead?.nome ?? d?.pushName ?? numero}`,
      message: semNumero ? "O WhatsApp não informou o número. Veja a conversa na Central (só administrador)." : texto.slice(0, 300),
      actionUrl: `/admin/whatsapp?aba=conversas&numero=${encodeURIComponent(numero)}`,
    });
  }
  return { id: gravada?.id ?? null, nova: Boolean(gravada), deMim, leadId: lead?.id ?? null, existente: null };
}

export async function processarEventoEvolution(ev: Evento): Promise<string> {
  const db = getDb();
  const evento = (ev.event ?? "").toLowerCase().replace(/_/g, ".");
  if (!ev.instance) return "sem-instancia";
  // EPIC-025 E9: a instância da EMPRESA (Dolores e Central) tem UM aviso só — o da Dolores, com HMAC próprio e checagem da
  // instância, que reparte tudo (server/dolores/roteamento.ts). Aviso dela chegando aqui não grava nada.
  if (ev.instance === INSTANCIA_DOLORES) return "instancia-da-empresa";
  const [conn] = await db.select().from(whatsappConnections).where(eq(whatsappConnections.instancia, ev.instance)).limit(1);
  if (!conn) return "conexao-desconhecida";
  // QA-SEG E9 achado 2: só alimenta a Central a instância de quem conecta pela PRÓPRIA aba (corretor e demais papéis fora da conexão da
  // empresa). A instância que ficou gravada na linha de admin/colaborador (a Central de antes da conexão única) nunca grava nada — nem
  // mensagem, nem situação: a Central deles é a da empresa, que só o aviso da Dolores alimenta. Remoção: Integrações › WhatsApp da
  // empresa › "Remover a conexão antiga da Central" (só admin).
  const [dono] = await db.select({ role: users.role }).from(users).where(eq(users.id, conn.userId)).limit(1);
  if (!dono || usaConexaoDaEmpresa(dono.role)) return "instancia-antiga-da-empresa";

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
      const r = await gravarItemNaCentral(conn, d, { centralVendas: true, baixarMidia: true });
      if (r.nova && !r.deMim) novas++;
    }
    // Central de Vendas: rodada curta (SLA e fila), no máximo uma vez por minuto.
    await import("./central-vendas/rotina.js").then(m => m.rotinaSeNecessario()).catch(() => undefined);
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
