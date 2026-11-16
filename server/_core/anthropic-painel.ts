// EPIC-024 S-10 (16/11): chave da Anthropic cadastrada em Admin › Integrações — SÓ cadastro.
// Fica em dashboard_settings["segredo.anthropic_painel_api_key"] (AES-256-GCM, secret-vault) e NUNCA é
// escrita em ENV: ENV.anthropicApiKey continua vindo só da variável ANTHROPIC_API_KEY. Assim, cadastrar a
// chave aqui não liga em silêncio a IA paga da avaliação, do mercado, da maquete ou da Central de Vendas.
// O teste de conexão e a lista de modelos usam client.models.list() (não consome tokens).
import { decryptSecret, encryptSecret } from "./secret-vault.js";
import * as db from "../db.js";

export const CHAVE_SEGREDO_ANTHROPIC_PAINEL = "segredo.anthropic_painel_api_key";
export const CHAVE_MODELO_ANTHROPIC_PAINEL = "segredo.anthropic_painel_modelo";

export type FamiliaModelo = "opus" | "sonnet" | "haiku" | "fable" | "outro";
export type ModeloAnthropic = { id: string; nome: string; familia: FamiliaModelo; lancadoEm: string | null };

type ModeloSdk = { id: string; display_name?: string | null; created_at?: string | null };
/** O mínimo do SDK que usamos: client.models.list() é iterável página a página (for await). */
export type ClienteModelos = { models: { list: (params?: { limit?: number }) => AsyncIterable<ModeloSdk> } };

export type AnthropicPainelDeps = {
  lerBanco: (chave: string) => Promise<string | undefined>;
  gravarBanco: (chave: string, valor: string) => Promise<void>;
  criarCliente: (apiKey: string) => Promise<ClienteModelos> | ClienteModelos;
  encrypt: (valor: string) => string;
  decrypt: (valor: string) => string;
};

export const anthropicPainelDepsPadrao: AnthropicPainelDeps = {
  lerBanco: k => db.getDashboardSetting(k),
  gravarBanco: (k, v) => db.saveDashboardSetting(k, v),
  criarCliente: async apiKey => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    return new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 }) as unknown as ClienteModelos;
  },
  encrypt: encryptSecret,
  decrypt: decryptSecret,
};

/** Esconde qualquer chave "sk-ant-…" que apareça num texto (mensagem de erro, log). */
export function mascararChaveAnthropic(texto: string): string {
  return texto.replace(/sk-ant-[A-Za-z0-9_-]*/g, "sk-ant-…");
}

export function familiaDoModelo(id: string, nome = ""): FamiliaModelo {
  const t = `${id} ${nome}`.toLowerCase();
  for (const f of ["opus", "sonnet", "haiku", "fable"] as const) if (t.includes(f)) return f;
  return "outro";
}

function normalizarChave(bruto: unknown): string {
  const chave = String(bruto ?? "").trim();
  if (!chave) throw new Error("Cole a chave de API da Anthropic.");
  if (/\s/.test(chave) || chave.length < 20) throw new Error("Chave inválida: confira se foi copiada inteira, sem espaços.");
  return chave;
}

function mensagemDeErro(e: unknown): string {
  const status = (e as { status?: number })?.status;
  if (status === 401) return "A Anthropic recusou a chave (HTTP 401): chave inválida ou revogada.";
  if (status === 403) return "A Anthropic recusou a chave (HTTP 403): a chave não tem permissão para listar modelos.";
  if (status === 429) return "A Anthropic limitou as consultas (HTTP 429). Tente de novo em instantes.";
  const msg = e instanceof Error && e.message ? e.message : "A Anthropic não respondeu.";
  return mascararChaveAnthropic(status ? `A Anthropic respondeu HTTP ${status}: ${msg}` : msg);
}

/** Modelos que a CONTA/CHAVE tem disponíveis, como a API devolve (nome e id oficiais), mais recentes primeiro. */
export async function listarModelosDaChave(apiKey: string, deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<ModeloAnthropic[]> {
  try {
    const cliente = await deps.criarCliente(apiKey);
    const modelos: ModeloAnthropic[] = [];
    for await (const m of cliente.models.list({ limit: 100 })) {
      const nome = m.display_name?.trim() || m.id;
      modelos.push({ id: m.id, nome, familia: familiaDoModelo(m.id, nome), lancadoEm: m.created_at ?? null });
    }
    return modelos;
  } catch (e) {
    throw new Error(mensagemDeErro(e));
  }
}

async function lerChave(deps: AnthropicPainelDeps): Promise<string | null> {
  const gravado = await deps.lerBanco(CHAVE_SEGREDO_ANTHROPIC_PAINEL).catch(() => undefined);
  if (!gravado) return null;
  try { return deps.decrypt(gravado).trim() || null; } catch { return null; }
}

async function lerModelo(deps: AnthropicPainelDeps): Promise<string | null> {
  return (await deps.lerBanco(CHAVE_MODELO_ANTHROPIC_PAINEL).catch(() => undefined))?.trim() || null;
}

const finalDe = (v: string) => (v.length >= 8 ? `…${v.slice(-4)}` : "…");

/** O que está salvo — sem a chave: só os 4 últimos caracteres e o id do modelo preferencial. */
export async function statusAnthropicPainel(deps: AnthropicPainelDeps = anthropicPainelDepsPadrao) {
  const [chave, modelo] = await Promise.all([lerChave(deps), lerModelo(deps)]);
  return { configurado: Boolean(chave), final: chave ? finalDe(chave) : null, modeloPreferencial: modelo, ativa: false as const };
}

/** Teste disparado pelo admin: lista os modelos com a chave salva (sem consumir tokens). */
export async function testarAnthropicPainel(deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<{ ok: boolean; mensagem: string }> {
  const chave = await lerChave(deps);
  if (!chave) return { ok: false, mensagem: "Nenhuma chave da Anthropic salva." };
  try {
    const modelos = await listarModelosDaChave(chave, deps);
    return { ok: true, mensagem: `Anthropic conectada — ${modelos.length} modelo(s) disponível(is) para esta chave.` };
  } catch (e) {
    return { ok: false, mensagem: mascararChaveAnthropic(e instanceof Error ? e.message : String(e)) };
  }
}

/** Valida a chave na Anthropic ANTES de salvar (criptografada). Troca a chave anterior, se houver. */
export async function salvarChaveAnthropicPainel(bruto: unknown, deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<{ mensagem: string; modelos: number }> {
  const chave = normalizarChave(bruto);
  const modelos = await listarModelosDaChave(chave, deps);
  await deps.gravarBanco(CHAVE_SEGREDO_ANTHROPIC_PAINEL, deps.encrypt(chave));
  return { mensagem: `Chave validada e salva — ${modelos.length} modelo(s) disponível(is).`, modelos: modelos.length };
}

/** Remove a chave e a preferência de modelo. */
export async function removerAnthropicPainel(deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<void> {
  await deps.gravarBanco(CHAVE_SEGREDO_ANTHROPIC_PAINEL, "");
  await deps.gravarBanco(CHAVE_MODELO_ANTHROPIC_PAINEL, "");
}

/** Lista, na hora, os modelos da chave salva. */
export async function modelosAnthropicPainel(deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<ModeloAnthropic[]> {
  const chave = await lerChave(deps);
  if (!chave) throw new Error("Salve a chave da Anthropic antes de listar os modelos.");
  return listarModelosDaChave(chave, deps);
}

/** Grava o modelo preferencial — só se a chave salva tiver esse modelo disponível. */
export async function salvarModeloPreferencialAnthropic(id: string, deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<ModeloAnthropic> {
  const modelos = await modelosAnthropicPainel(deps);
  const modelo = modelos.find(m => m.id === id.trim());
  if (!modelo) throw new Error("Esse modelo não está disponível para a chave salva. Atualize a lista e escolha outro.");
  await deps.gravarBanco(CHAVE_MODELO_ANTHROPIC_PAINEL, modelo.id);
  return modelo;
}

/**
 * Chave e modelo preferencial cadastrados no painel, para uma função que FUTURAMENTE optar por usá-los
 * explicitamente (ex.: leitura por IA de PDF só imagem na maquete, EPIC-024 S-03).
 * AINDA NÃO É USADA POR NENHUMA FUNÇÃO. Não substitui ENV.anthropicApiKey nem os modelos da maquete,
 * da Central de Vendas ou de INCORPORACAO_IA_MODELO.
 */
export async function configuracaoAnthropicPainel(deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<{ apiKey: string; modelo: string | null } | null> {
  const [apiKey, modelo] = await Promise.all([lerChave(deps), lerModelo(deps)]);
  return apiKey ? { apiKey, modelo } : null;
}
