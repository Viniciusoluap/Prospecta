// Chaves dos provedores de anúncios (Tavily e Google) — podem ficar no PRÓPRIO banco
// (automação primeiro: não depende do painel do Vercel). Ordem: variável de ambiente
// (TAVILY_API_KEY / GEMINI_API_KEY) > dashboard_settings["segredo.tavily_api_key" / "segredo.gemini_api_key"]. Valor gravado como
// "plain:<chave>" (pela equipe/agente, sem acesso à chave do servidor) é recriptografado
// (AES-256-GCM, secret-vault) no primeiro uso. Chaves "segredo.*" nunca vão para o navegador.
import { ENV } from "../env.js";
import { decryptSecret, encryptSecret, segredoEmTextoPuro } from "../secret-vault.js";

export const CHAVE_SEGREDO_GEMINI = "segredo.gemini_api_key";
export const CHAVE_SEGREDO_TAVILY = "segredo.tavily_api_key";
export const PREFIXO_SEGREDO = "segredo.";

type Banco = {
  getDashboardSetting(key: string): Promise<string | undefined>;
  saveDashboardSetting(key: string, value: string): Promise<void>;
};

const caches = new Map<string, { em: number; valor: string }>();
const CACHE_MS = 5 * 60 * 1000;

type CampoEnv = "geminiApiKey" | "tavilyApiKey";

/** Preenche ENV[campo] a partir da variável de ambiente ou do banco. Nunca lança: sem chave, o provedor informa a falta. */
async function carregarChave(banco: Banco, nomesEnv: string[], chaveBanco: string, campo: CampoEnv, agora: number): Promise<string> {
  if (nomesEnv.some((n) => process.env[n])) return ENV[campo];
  const c = caches.get(chaveBanco);
  if (c && agora - c.em < CACHE_MS) { ENV[campo] = c.valor; return c.valor; }
  try {
    const gravado = await banco.getDashboardSetting(chaveBanco);
    if (!gravado) { ENV[campo] = ""; return ""; }
    const valor = decryptSecret(gravado).trim();
    if (segredoEmTextoPuro(gravado)) {
      try { await banco.saveDashboardSetting(chaveBanco, encryptSecret(valor)); } catch { /* recriptografa no próximo uso */ }
    }
    caches.set(chaveBanco, { em: agora, valor });
    ENV[campo] = valor;
    return valor;
  } catch {
    ENV[campo] = "";
    return "";
  }
}

/** Garante ENV.geminiApiKey preenchida (variável de ambiente ou banco). */
export function carregarChaveGemini(banco: Banco, agora = Date.now()): Promise<string> {
  return carregarChave(banco, ["GEMINI_API_KEY", "GOOGLE_API_KEY"], CHAVE_SEGREDO_GEMINI, "geminiApiKey", agora);
}

/** Garante ENV.tavilyApiKey preenchida (TAVILY_API_KEY ou banco `segredo.tavily_api_key`). */
export function carregarChaveTavily(banco: Banco, agora = Date.now()): Promise<string> {
  return carregarChave(banco, ["TAVILY_API_KEY"], CHAVE_SEGREDO_TAVILY, "tavilyApiKey", agora);
}

export function _limparCacheChaveGemini() { caches.clear(); }
