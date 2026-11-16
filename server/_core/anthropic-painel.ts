// EPIC-024 S-10 (16/11): chave da Anthropic cadastrada em Admin › Integrações — SÓ cadastro.
// Fica em dashboard_settings["segredo.anthropic_painel_api_key"] (AES-256-GCM, secret-vault) e NUNCA é
// escrita em ENV: ENV.anthropicApiKey continua vindo só da variável ANTHROPIC_API_KEY. Assim, cadastrar a
// chave aqui não liga em silêncio a IA paga da avaliação, do mercado, da maquete ou da Central de Vendas.
// O teste de conexão e a lista de modelos usam client.models.list() (não consome tokens).
import { decryptSecret, encryptSecret, segredoEmTextoPuro } from "./secret-vault.js";
import * as db from "../db.js";
import { DESCRICAO_FUNCOES_ANTHROPIC, FUNCOES_ANTHROPIC, type FuncaoAnthropic } from "../../shared/funcoes-anthropic.js";
import {
  CHAVE_MODELO_PREFERENCIAL, chaveAvisoDaFuncao, chaveModeloDaFuncao, modeloDaFuncao, modelosGravadosDasFuncoes, type LeitorModelos,
} from "./modelo-por-funcao.js";

export const CHAVE_SEGREDO_ANTHROPIC_PAINEL = "segredo.anthropic_painel_api_key";
export const CHAVE_MODELO_ANTHROPIC_PAINEL = CHAVE_MODELO_PREFERENCIAL;

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

export const MENSAGEM_CHAVE_ILEGIVEL = "Há uma chave salva que não pode ser lida (a chave do servidor mudou?) — cadastre de novo.";

/** Chave salva: "ilegivel" quando existe mas não decifra (ex.: JWT_SECRET trocado). "plain:" é recriptografada. */
async function lerChaveSalva(deps: AnthropicPainelDeps): Promise<string | "ilegivel" | null> {
  const gravado = await deps.lerBanco(CHAVE_SEGREDO_ANTHROPIC_PAINEL).catch(() => undefined);
  if (!gravado) return null;
  let chave: string;
  try { chave = deps.decrypt(gravado).trim(); } catch { return "ilegivel"; }
  if (!chave) return "ilegivel";
  if (segredoEmTextoPuro(gravado)) {
    try { await deps.gravarBanco(CHAVE_SEGREDO_ANTHROPIC_PAINEL, deps.encrypt(chave)); } catch { /* recriptografa no próximo uso */ }
  }
  return chave;
}

/** A chave pronta para usar; ilegível vira erro com a orientação. */
async function lerChave(deps: AnthropicPainelDeps): Promise<string | null> {
  const c = await lerChaveSalva(deps);
  if (c === "ilegivel") throw new Error(MENSAGEM_CHAVE_ILEGIVEL);
  return c;
}

async function lerModelo(deps: AnthropicPainelDeps): Promise<string | null> {
  return (await deps.lerBanco(CHAVE_MODELO_ANTHROPIC_PAINEL).catch(() => undefined))?.trim() || null;
}

const finalDe = (v: string) => (v.length >= 8 ? `…${v.slice(-4)}` : "…");

/** O que está salvo — sem a chave: só os 4 últimos caracteres e o id do modelo preferencial. */
export async function statusAnthropicPainel(deps: AnthropicPainelDeps = anthropicPainelDepsPadrao) {
  const [salva, modelo] = await Promise.all([lerChaveSalva(deps), lerModelo(deps)]);
  const chave = salva === "ilegivel" ? null : salva;
  return {
    configurado: Boolean(chave), final: chave ? finalDe(chave) : null, modeloPreferencial: modelo, ativa: false as const,
    /** Existe valor salvo que não decifra: a tela pede para cadastrar de novo (não diz "nenhuma chave"). */
    ilegivel: salva === "ilegivel", aviso: salva === "ilegivel" ? MENSAGEM_CHAVE_ILEGIVEL : null,
  };
}

/** Teste disparado pelo admin: lista os modelos com a chave salva (sem consumir tokens). */
export async function testarAnthropicPainel(deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<{ ok: boolean; mensagem: string }> {
  const chave = await lerChaveSalva(deps);
  if (chave === "ilegivel") return { ok: false, mensagem: MENSAGEM_CHAVE_ILEGIVEL };
  if (!chave) return { ok: false, mensagem: "Nenhuma chave da Anthropic salva." };
  try {
    const modelos = await listarModelosDaChave(chave, deps);
    return { ok: true, mensagem: `Anthropic conectada — ${modelos.length} modelo(s) disponível(is) para esta chave.` };
  } catch (e) {
    return { ok: false, mensagem: mascararChaveAnthropic(e instanceof Error ? e.message : String(e)) };
  }
}

/**
 * Valida a chave na Anthropic ANTES de salvar (criptografada). Troca a chave anterior, se houver; o modelo
 * preferencial que a chave nova não oferece é limpo, com aviso.
 */
export async function salvarChaveAnthropicPainel(bruto: unknown, deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<{ mensagem: string; modelos: number; modeloLimpo: string | null }> {
  const chave = normalizarChave(bruto);
  const modelos = await listarModelosDaChave(chave, deps);
  await deps.gravarBanco(CHAVE_SEGREDO_ANTHROPIC_PAINEL, deps.encrypt(chave));
  const preferido = await lerModelo(deps);
  const modeloLimpo = preferido && !modelos.some(m => m.id === preferido) ? preferido : null;
  if (modeloLimpo) await deps.gravarBanco(CHAVE_MODELO_ANTHROPIC_PAINEL, "");
  const funcoesLimpas = await conferirModelosDasFuncoes(modelos, deps);
  const avisoFuncoes = funcoesLimpas.map(f => ` O modelo ${f.modelo} de "${DESCRICAO_FUNCOES_ANTHROPIC[f.funcao].rotulo}" não é oferecido para esta chave e foi limpo: a função passa a usar o preferencial.`).join("");
  return {
    mensagem: `Chave validada e salva — ${modelos.length} modelo(s) disponível(is).${modeloLimpo ? ` O modelo preferencial ${modeloLimpo} não é oferecido para esta chave e foi limpo: escolha outro.` : ""}${avisoFuncoes}`,
    modelos: modelos.length, modeloLimpo,
  };
}

/** Remove a chave, a preferência de modelo e os modelos escolhidos por função. */
export async function removerAnthropicPainel(deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<void> {
  await deps.gravarBanco(CHAVE_SEGREDO_ANTHROPIC_PAINEL, "");
  await deps.gravarBanco(CHAVE_MODELO_ANTHROPIC_PAINEL, "");
  for (const f of FUNCOES_ANTHROPIC) {
    await deps.gravarBanco(chaveModeloDaFuncao(f), "");
    await deps.gravarBanco(chaveAvisoDaFuncao(f), "");
  }
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

// ── EPIC-024 S-11: modelo por função (só nomes de modelo; a resolução fica em ./modelo-por-funcao.ts) ──

/**
 * QA S-11 achado 2: o módulo de modelos recebe SÓ o leitor do banco — nunca `decrypt`, `criarCliente` nem `encrypt`.
 * Assim ele não tem com que decifrar a chave, mesmo que alguém tente.
 */
const soLeitor = (deps: AnthropicPainelDeps): LeitorModelos => ({ lerBanco: k => deps.lerBanco(k) });

/**
 * Modelo escolhido para uma função que não aparece mais na lista da conta: é limpo (a função cai para o preferencial)
 * e o id fica guardado como aviso para o painel mostrar até o admin escolher de novo.
 */
export async function conferirModelosDasFuncoes(modelos: ModeloAnthropic[], deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<Array<{ funcao: FuncaoAnthropic; modelo: string }>> {
  const gravados = await modelosGravadosDasFuncoes(soLeitor(deps));
  const limpas: Array<{ funcao: FuncaoAnthropic; modelo: string }> = [];
  for (const f of FUNCOES_ANTHROPIC) {
    const id = gravados[f].modelo;
    if (!id || modelos.some(m => m.id === id)) continue;
    await deps.gravarBanco(chaveModeloDaFuncao(f), "");
    await deps.gravarBanco(chaveAvisoDaFuncao(f), id);
    limpas.push({ funcao: f, modelo: id });
  }
  return limpas;
}

/**
 * Grava o modelo de uma função: id vazio = "usar o preferencial"; senão, só um id que a chave salva oferece agora.
 * Não chama a IA para a função (listar modelos não consome tokens) e não liga nada.
 */
export async function salvarModeloDaFuncao(funcao: FuncaoAnthropic, id: string, deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<ModeloAnthropic | null> {
  if (!FUNCOES_ANTHROPIC.includes(funcao)) throw new Error("Função desconhecida.");
  const alvo = id.trim();
  let modelo: ModeloAnthropic | null = null;
  if (alvo) {
    const modelos = await modelosAnthropicPainel(deps);
    modelo = modelos.find(m => m.id === alvo) ?? null;
    if (!modelo) throw new Error("Esse modelo não está disponível para a chave salva. Atualize a lista e escolha outro.");
  }
  await deps.gravarBanco(chaveModeloDaFuncao(funcao), modelo?.id ?? "");
  await deps.gravarBanco(chaveAvisoDaFuncao(funcao), "");
  return modelo;
}

export const NOTA_FUNCAO_ANTHROPIC: Partial<Record<FuncaoAnthropic, string>> = {
  maquete_leitura: "Vale quando a leitura usa a chave deste painel. Sem ela, se houver a chave antiga configurada pela equipe técnica no servidor, vale o modelo das configurações da Maquete 3D.",
};

/** Uma linha por função para o painel: escolhido, aviso de modelo sumido e o modelo que vale agora. Sem a chave. */
export async function statusModelosPorFuncao(
  extras: { anteriorDolores?: string | null; padraoMaquete?: string | null } = {},
  deps: AnthropicPainelDeps = anthropicPainelDepsPadrao,
) {
  const [salva, preferencial, gravados] = await Promise.all([lerChaveSalva(deps), lerModelo(deps), modelosGravadosDasFuncoes(soLeitor(deps))]);
  const funcoes = await Promise.all(FUNCOES_ANTHROPIC.map(async f => ({
    ...DESCRICAO_FUNCOES_ANTHROPIC[f],
    modelo: gravados[f].modelo,
    sumiu: gravados[f].sumiu,
    nota: NOTA_FUNCAO_ANTHROPIC[f] ?? null,
    valendo: await modeloDaFuncao(f, {
      preferencial,
      anterior: f === "dolores_whatsapp" ? extras.anteriorDolores ?? null : null,
      padrao: f === "maquete_leitura" ? extras.padraoMaquete ?? null : null,
    }, soLeitor(deps)),
  })));
  return { configurado: Boolean(salva && salva !== "ilegivel"), preferencial, funcoes };
}

/**
 * Só diz SE há chave legível salva e qual o modelo preferencial — nunca devolve a chave. É o que telas e conferências
 * usam (ex.: a situação da Dolores em server/dolores/router.ts); quem precisa da chave em si é só o ponto único abaixo.
 */
export async function existeChaveAnthropicPainel(deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<{ existe: boolean; modelo: string | null }> {
  const [salva, modelo] = await Promise.all([lerChaveSalva(deps), lerModelo(deps)]);
  return { existe: Boolean(salva && salva !== "ilegivel"), modelo };
}

/**
 * Chave e modelo preferencial cadastrados no painel, para uma função que opte por usá-los explicitamente.
 * Usada em DOIS pontos, e só neles (a guarda em server/integracoes-anthropic.test.ts falha com qualquer outro uso):
 * - EPIC-024 S-03: `resolverCredencialIA` em server/maquete-3d/base.ts — leitura por IA das pranchas da Maquete 3D,
 *   com confirmação do custo por execução e teto por maquete;
 * - EPIC-025 E2: `bloqueioAtual` em server/dolores/whatsapp.ts, depois da pausa e do interruptor da IA da Dolores
 *   (desligado por padrão).
 * Não substitui ENV.anthropicApiKey nem os modelos da Central de Vendas ou de INCORPORACAO_IA_MODELO.
 */
export async function configuracaoAnthropicPainel(deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<{ apiKey: string; modelo: string | null } | null> {
  const [apiKey, modelo] = await Promise.all([lerChaveSalva(deps), lerModelo(deps)]);
  return apiKey && apiKey !== "ilegivel" ? { apiKey, modelo } : null;
}
