// Central de Vendas (12/11/2026) — infraestrutura comum: configuração, auditoria, templates, avisos e as
// dependências externas (envio de WhatsApp, IA, relógio), substituíveis nos testes. Nada aqui usa transação
// interativa (neon-http): atomicidade por ON CONFLICT e UPDATE ... WHERE estado RETURNING.
import { and, eq, inArray, sql } from "drizzle-orm";
import { leads, userNotifications, users, whatsappTemplates } from "../../drizzle/schema.js";
import { centralVendasConfig, centralVendasEventos, centralVendasLeads } from "../../drizzle/schema-central-vendas.js";
import { lerConfig, type ConfigCentral, type SegredoCentral } from "../../shared/central-vendas/config.js";
import { partesFortaleza } from "../../shared/central-vendas/regras.js";
import { templatePadrao } from "../../shared/central-vendas/templates.js";
import { decryptSecret, encryptSecret } from "../_core/secret-vault.js";
import { getDb } from "../db.js";

export const db = () => getDb();

// ── Dependências externas (injetáveis) ──

export type ResultadoEnvio = { ok: boolean; externalId: string | null; connectionId: number | null; erro?: string };
export type Enviador = (p: { numero: string; texto: string; connectionId: number | null; config: ConfigCentral }) => Promise<ResultadoEnvio>;
export type RespostaIA = { texto: string; entrada: number; saida: number };
export type ClienteIA = (p: { sistema: string; mensagens: { role: "user" | "assistant"; content: string }[]; maxTokens: number; config: ConfigCentral }) => Promise<RespostaIA>;

type Dependencias = { enviar: Enviador | null; ia: ClienteIA | null; agora: () => Date; aleatorio: () => number; dormir: (ms: number) => Promise<void> };
const padrao: Dependencias = { enviar: null, ia: null, agora: () => new Date(), aleatorio: Math.random, dormir: ms => new Promise(r => setTimeout(r, ms)) };
let deps: Dependencias = { ...padrao };

/** Só para testes: troca envio/IA/relógio. Sem argumento, volta ao padrão. */
export function definirDependencias(d?: Partial<Dependencias>) { deps = d ? { ...deps, ...d } : { ...padrao }; }
export const dependencias = () => deps;
export const agora = () => deps.agora();
/** Data de hoje em Fortaleza (AAAA-MM-DD). */
export const partesHoje = () => partesFortaleza(agora()).data;

// ── Configuração ──

export async function carregarConfig(): Promise<ConfigCentral> {
  const [r] = await db().select({ dados: centralVendasConfig.dados }).from(centralVendasConfig).where(eq(centralVendasConfig.id, 1)).limit(1);
  return lerConfig(r?.dados);
}

export async function salvarConfig(c: ConfigCentral, userId: number | null): Promise<void> {
  const dados = JSON.stringify(c);
  await db().insert(centralVendasConfig).values({ id: 1, dados, updatedBy: userId, updatedAt: agora() })
    .onConflictDoUpdate({ target: centralVendasConfig.id, set: { dados, updatedBy: userId, updatedAt: agora() } });
}

export const cifrar = (v: string) => encryptSecret(v);
export function segredo(c: ConfigCentral, nome: SegredoCentral): string | null {
  const v = c.segredos[nome];
  if (!v) return null;
  try { return decryptSecret(v); } catch { return null; }
}

// ── Auditoria (central_vendas_eventos): payload resumido, sem dados pessoais ──

export type Evento = { tipo: string; leadId?: number | null; origem?: string; payload?: Record<string, unknown>; resultado?: "ok" | "erro" | "bloqueado" | "ignorado"; erro?: string | null; chave?: string };

/** Grava o evento. Com `chave`, grava uma única vez e devolve false se já existia. */
export async function registrarEvento(e: Evento): Promise<boolean> {
  const valores = {
    tipo: e.tipo.slice(0, 60), leadId: e.leadId ?? null, origem: (e.origem ?? "sistema").slice(0, 30),
    payload: e.payload ? JSON.stringify(e.payload).slice(0, 2000) : null, resultado: e.resultado ?? "ok",
    erro: e.erro ? e.erro.slice(0, 500) : null, chave: e.chave?.slice(0, 200) ?? null, createdAt: agora(),
  };
  if (!e.chave) { await db().insert(centralVendasEventos).values(valores); return true; }
  const r = await db().insert(centralVendasEventos).values(valores).onConflictDoNothing().returning({ id: centralVendasEventos.id });
  return r.length > 0;
}

/** Mensagem de erro sem dados pessoais (corta números longos, e-mails e tamanho). */
export function erroSeguro(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? "falha");
  return m.replace(/\d{6,}/g, "[número]").replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[e-mail]").slice(0, 300);
}

// ── Templates (whatsapp_templates, com o texto padrão como reserva) ──

export async function textoTemplate(slug: string): Promise<string | null> {
  const [t] = await db().select({ conteudo: whatsappTemplates.conteudo }).from(whatsappTemplates)
    .where(and(eq(whatsappTemplates.slug, slug), eq(whatsappTemplates.ativo, true))).limit(1);
  return t?.conteudo ?? templatePadrao(slug)?.conteudo ?? null;
}

// ── Pessoas e avisos ──

export async function usuariosAtivos(ids: number[]) {
  if (!ids.length) return [];
  return db().select({ id: users.id, nome: users.name, role: users.role }).from(users)
    .where(and(inArray(users.id, ids), eq(users.active, true), inArray(users.role, ["admin", "colaborador"])));
}

export async function administradores() {
  return db().select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.active, true)));
}

export async function avisar(userIds: (number | null | undefined)[], titulo: string, mensagem: string, leadId?: number | null) {
  const ids = Array.from(new Set(userIds.filter((x): x is number => typeof x === "number")));
  if (!ids.length) return;
  await db().insert(userNotifications).values(ids.map(userId => ({
    userId, type: "system" as const, title: titulo.slice(0, 255), message: mensagem.slice(0, 2000),
    relatedId: leadId ?? null, actionUrl: leadId ? `/admin/crm/${leadId}` : "/admin/central-vendas",
  })));
}

export async function avisarAdmins(titulo: string, mensagem: string, leadId?: number | null) {
  await avisar((await administradores()).map(a => a.id), titulo, mensagem, leadId);
}

// ── Lead da Central ──

export async function registroCentral(leadId: number) {
  const [r] = await db().select().from(centralVendasLeads).where(eq(centralVendasLeads.leadId, leadId)).limit(1);
  return r ?? null;
}

export async function dadosDoLead(leadId: number) {
  const [l] = await db().select().from(leads).where(eq(leads.id, leadId)).limit(1);
  return l ?? null;
}

export async function atualizarCentral(leadId: number, set: Partial<typeof centralVendasLeads.$inferInsert>) {
  await db().update(centralVendasLeads).set({ ...set, updatedAt: agora() }).where(eq(centralVendasLeads.leadId, leadId));
}

export const primeiroNome = (nome: string | null | undefined) => {
  const n = (nome ?? "").trim();
  if (!n || /^whatsapp\s/i.test(n)) return "";
  return n.split(/\s+/)[0];
};

/** Executa SQL e devolve as linhas (neon-http e PGlite devolvem { rows }). */
export async function linhas<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  const r = await db().execute(q);
  return ((r as unknown as { rows?: T[] }).rows ?? []) as T[];
}
