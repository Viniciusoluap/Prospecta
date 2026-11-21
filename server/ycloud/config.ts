// EPIC-027 C7 (20/11/2026) — configuração da integração com a YCloud: chave de API e segredo do aviso de entrega (cifrados em
// dashboard_settings com o mesmo cofre das outras chaves do painel — server/_core/secret-vault.ts), a linha única `ycloud_config`
// (interruptor geral desligado por padrão, tetos, última conferência do número) e as dependências trocáveis nos testes.
// Nada aqui devolve a chave ou o segredo: a tela só recebe "terminando em …".
import { eq } from "drizzle-orm";
import { ycloudAuditoria, ycloudConfig, type YcloudConfig } from "../../drizzle/schema-ycloud.js";
import { decryptSecret, encryptSecret, segredoEmTextoPuro } from "../_core/secret-vault.js";
import * as db from "../db.js";
import type { FetchLike } from "../_core/ycloud.js";

export const CHAVE_SEGREDO_YCLOUD = "segredo.ycloud_api_key";
export const CHAVE_SEGREDO_WEBHOOK_YCLOUD = "segredo.ycloud_webhook_secret";

/**
 * Situação de mensagem enviada, revisão de modelo e preferência de marketing (opt-out vindo da Meta entra no opt-out local) — NUNCA
 * mensagem recebida (duplicaria com a Evolution).
 */
export const EVENTOS_YCLOUD = ["whatsapp.message.updated", "whatsapp.template.reviewed", "whatsapp.user.preferences"] as const;

export type DependenciasYcloud = {
  agora: () => Date;
  fetch: FetchLike;
  esperar: (ms: number) => Promise<void>;
  /** Número da empresa (conexão única, Integrações › WhatsApp da empresa). */
  numeroDaEmpresa: () => Promise<string | null>;
  /** Número do dono (nunca recebe campanha pela API: a conversa dele é com a Dolores). */
  numeroDoDono: () => Promise<string | null>;
  /** id da linha da conexão da empresa em whatsapp_connections (para a mensagem aparecer na Central), ou null. */
  conexaoDaEmpresaId: () => Promise<number | null>;
  urlDoSite: () => string;
};

const padrao: DependenciasYcloud = {
  agora: () => new Date(),
  fetch: (...a) => fetch(...a),
  esperar: ms => new Promise(r => setTimeout(r, ms)),
  numeroDaEmpresa: async () => (await (await import("../dolores/consumo.js")).lerConfigWhatsapp())?.numeroDolores ?? null,
  numeroDoDono: async () => (await (await import("../dolores/consumo.js")).lerConfigWhatsapp())?.numeroDono ?? null,
  conexaoDaEmpresaId: async () => (await (await import("../whatsapp-conexao-empresa.js")).conexaoDaEmpresa())?.id ?? null,
  urlDoSite: () => (process.env.PUBLIC_SITE_URL || "https://www.prospectaconstrucoes.com").replace(/\/+$/, ""),
};
let deps: DependenciasYcloud = padrao;
export const depsYcloud = () => deps;
/** Só para testes. Sem argumento, volta ao padrão. */
export function definirDependenciasYcloud(d?: Partial<DependenciasYcloud>) { deps = d ? { ...padrao, ...d } : padrao; }

export const urlWebhookYcloud = () => `${deps.urlDoSite()}/api/ycloud/webhook`;

// ── Segredos ──

async function lerSegredo(chave: string): Promise<string | null> {
  const cifrado = await db.getDashboardSetting(chave);
  if (!cifrado) return null;
  let valor: string;
  try { valor = decryptSecret(cifrado); } catch { return null; }
  if (!valor) return null;
  if (segredoEmTextoPuro(cifrado)) await db.saveDashboardSetting(chave, encryptSecret(valor)).catch(() => undefined);
  return valor;
}

export const chaveYcloud = () => lerSegredo(CHAVE_SEGREDO_YCLOUD);
export const segredoWebhookYcloud = () => lerSegredo(CHAVE_SEGREDO_WEBHOOK_YCLOUD);
export async function gravarChaveYcloud(chave: string) { await db.saveDashboardSetting(CHAVE_SEGREDO_YCLOUD, encryptSecret(chave)); }
export async function gravarSegredoWebhookYcloud(segredo: string) { await db.saveDashboardSetting(CHAVE_SEGREDO_WEBHOOK_YCLOUD, encryptSecret(segredo)); }

/** Formato desconhecido na documentação: só conferimos o básico (sem espaços, tamanho razoável). */
export function normalizarChaveYcloud(bruto: unknown): string {
  const v = String(bruto ?? "").trim();
  if (!v) throw new Error("Cole a chave de API da YCloud.");
  if (/\s/.test(v) || v.length < 16 || v.length > 256) throw new Error("Chave inválida: confira se foi copiada inteira, sem espaços.");
  return v;
}
export function normalizarSegredoWebhook(bruto: unknown): string {
  const v = String(bruto ?? "").trim();
  if (!v) throw new Error("Cole o segredo do aviso (Signing secret).");
  if (/\s/.test(v) || v.length < 16 || v.length > 256) throw new Error("Segredo inválido: confira se foi copiado inteiro, sem espaços.");
  return v;
}

/** "…1234" — nunca devolve o valor. */
export function finalDoSegredo(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  return s.length >= 12 ? `…${s.slice(-4)}` : "…";
}

// ── Configuração (linha única) ──

export async function lerConfigYcloud(): Promise<YcloudConfig> {
  const d = db.getDb();
  let [c] = await d.select().from(ycloudConfig).where(eq(ycloudConfig.id, 1)).limit(1);
  if (!c) {
    await d.insert(ycloudConfig).values({ id: 1 }).onConflictDoNothing();
    [c] = await d.select().from(ycloudConfig).where(eq(ycloudConfig.id, 1)).limit(1);
  }
  if (!c) throw new Error("Configuração da YCloud indisponível (migração 0141 aplicada?).");
  return c;
}

export async function atualizarConfigYcloud(dados: Partial<Omit<YcloudConfig, "id">>, userId: number | null) {
  await lerConfigYcloud();
  await db.getDb().update(ycloudConfig).set({ ...dados, atualizadoEm: deps.agora(), ...(userId ? { atualizadoPor: userId } : {}) }).where(eq(ycloudConfig.id, 1));
}

/** Auditoria sem telefones nem segredos. Nunca lança (a ação principal já aconteceu ou vai acontecer). */
export async function auditarYcloud(a: { acao: string; usuarioId: number | null; campanhaId?: number | null; modelo?: string | null; quantidade?: number | null; detalhe?: string | null }) {
  try {
    await db.getDb().insert(ycloudAuditoria).values({
      acao: a.acao.slice(0, 60), usuarioId: a.usuarioId, campanhaId: a.campanhaId ?? null, modelo: a.modelo?.slice(0, 600) ?? null,
      quantidade: a.quantidade ?? null, detalhe: a.detalhe?.slice(0, 300) ?? null, criadoEm: deps.agora(),
    });
  } catch { /* a auditoria não derruba a operação */ }
}
