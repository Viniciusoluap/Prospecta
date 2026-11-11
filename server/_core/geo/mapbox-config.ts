// Token público do Mapbox (opcional) guardado no próprio banco, como as outras chaves
// de Admin › Integrações (dashboard_settings["segredo.mapbox_token"], AES-256-GCM).
// Ordem: variável MAPBOX_PUBLIC_TOKEN (se existir) > banco. Sem token → Esri (padrão).
// Gêmeo de Grupo-Santa-Fe/web/src/lib/geo/mapbox-config.ts.
import { decryptSecret, encryptSecret } from "../secret-vault.js";
import { normalizarTokenMapbox, verificarTokenMapbox } from "../../../shared/geo/mapbox-token.js";
import * as db from "../../db.js";

export const CHAVE_SEGREDO_MAPBOX = "segredo.mapbox_token";

export type MapboxDeps = {
  lerBanco: (chave: string) => Promise<string | undefined>;
  gravarBanco: (chave: string, valor: string) => Promise<void>;
  fetchImpl: typeof fetch;
  env: () => string | undefined;
};

export const mapboxDepsPadrao: MapboxDeps = {
  lerBanco: k => db.getDashboardSetting(k),
  gravarBanco: (k, v) => db.saveDashboardSetting(k, v),
  fetchImpl: (...a) => fetch(...a),
  env: () => process.env.MAPBOX_PUBLIC_TOKEN?.trim() || undefined,
};

let cache: { em: number; valor: { token: string; fonte: "env" | "banco" } | null } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export async function tokenMapbox(deps: MapboxDeps = mapboxDepsPadrao): Promise<{ token: string; fonte: "env" | "banco" } | null> {
  const env = deps.env();
  if (env) return { token: env, fonte: "env" };
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.valor;
  let valor: { token: string; fonte: "env" | "banco" } | null = null;
  try {
    const gravado = await deps.lerBanco(CHAVE_SEGREDO_MAPBOX);
    // O token é público (pk.): também aceitamos o valor gravado em texto puro, o que
    // permite configurar direto no banco, sem painel. Valor criptografado continua valendo.
    if (gravado) valor = { token: gravado.startsWith("pk.") ? gravado : decryptSecret(gravado), fonte: "banco" };
  } catch { valor = null; }
  cache = { em: Date.now(), valor };
  return valor;
}

/** Valida o formato e o token no Mapbox ANTES de salvar (criptografado). */
export async function salvarTokenMapbox(bruto: unknown, deps: MapboxDeps = mapboxDepsPadrao): Promise<{ mensagem: string }> {
  const token = normalizarTokenMapbox(bruto);
  const r = await verificarTokenMapbox(token, deps.fetchImpl);
  if (!r.ok) throw new Error(r.mensagem);
  await deps.gravarBanco(CHAVE_SEGREDO_MAPBOX, encryptSecret(token));
  cache = null;
  return { mensagem: r.mensagem };
}

export async function removerTokenMapbox(deps: MapboxDeps = mapboxDepsPadrao): Promise<void> {
  await deps.gravarBanco(CHAVE_SEGREDO_MAPBOX, "");
  cache = null;
}

export function limparCacheMapbox() { cache = null; }
