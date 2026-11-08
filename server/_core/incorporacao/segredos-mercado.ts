// Chave do Google (Gemini + Busca Google) para a pesquisa de anúncios — guardada no PRÓPRIO
// banco (automação primeiro: não depende do painel do Vercel). Ordem: variável de ambiente
// GEMINI_API_KEY > dashboard_settings["segredo.gemini_api_key"]. Valor gravado como
// "plain:<chave>" (pela equipe/agente, sem acesso à chave do servidor) é recriptografado
// (AES-256-GCM, secret-vault) no primeiro uso. Chaves "segredo.*" nunca vão para o navegador.
import { ENV } from "../env.js";
import { decryptSecret, encryptSecret, segredoEmTextoPuro } from "../secret-vault.js";

export const CHAVE_SEGREDO_GEMINI = "segredo.gemini_api_key";
export const PREFIXO_SEGREDO = "segredo.";

type Banco = {
  getDashboardSetting(key: string): Promise<string | undefined>;
  saveDashboardSetting(key: string, value: string): Promise<void>;
};

let cache: { em: number; valor: string } | null = null;
const CACHE_MS = 5 * 60 * 1000;

/** Garante ENV.geminiApiKey preenchida (variável de ambiente ou banco). Nunca lança: sem chave, o provedor informa a falta. */
export async function carregarChaveGemini(banco: Banco, agora = Date.now()): Promise<string> {
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return ENV.geminiApiKey;
  if (cache && agora - cache.em < CACHE_MS) { ENV.geminiApiKey = cache.valor; return cache.valor; }
  try {
    const gravado = await banco.getDashboardSetting(CHAVE_SEGREDO_GEMINI);
    if (!gravado) { ENV.geminiApiKey = ""; return ""; }
    const valor = decryptSecret(gravado).trim();
    if (segredoEmTextoPuro(gravado)) {
      try { await banco.saveDashboardSetting(CHAVE_SEGREDO_GEMINI, encryptSecret(valor)); } catch { /* recriptografa no próximo uso */ }
    }
    cache = { em: agora, valor };
    ENV.geminiApiKey = valor;
    return valor;
  } catch {
    ENV.geminiApiKey = "";
    return "";
  }
}

export function _limparCacheChaveGemini() { cache = null; }
