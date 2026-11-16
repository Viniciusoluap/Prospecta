// EPIC-024 S-10 (16/11): chave da Anthropic cadastrada em Admin › Integrações — SÓ cadastro.
// Fica em dashboard_settings["segredo.anthropic_painel_api_key"] (AES-256-GCM, secret-vault) e NUNCA é
// escrita em ENV: ENV.anthropicApiKey continua vindo só da variável ANTHROPIC_API_KEY. Assim, cadastrar a
// chave aqui não liga em silêncio a IA paga da avaliação, do mercado, da maquete ou da Central de Vendas.
// O teste de conexão e a lista de modelos usam client.models.list() (não consome tokens).
import { decryptSecret, encryptSecret, segredoEmTextoPuro } from "./secret-vault.js";
import * as db from "../db.js";
import { DESCRICAO_FUNCOES_ANTHROPIC, FUNCOES_ANTHROPIC, type FuncaoAnthropic } from "../../shared/funcoes-anthropic.js";
import {
  CHAVE_MODELO_PREFERENCIAL, chaveAnteriorSumiuDaFuncao, chaveAvisoDaFuncao, chaveModeloDaFuncao, modeloDaFuncao, modelosGravadosDasFuncoes, type LeitorModelos, type OrigemModelo,
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
export async function salvarChaveAnthropicPainel(
  bruto: unknown, deps: AnthropicPainelDeps = anthropicPainelDepsPadrao, anteriores: AnterioresDasFuncoes = {},
): Promise<{ mensagem: string; modelos: number; modeloLimpo: string | null }> {
  const chave = normalizarChave(bruto);
  const modelos = await listarModelosDaChave(chave, deps);
  await deps.gravarBanco(CHAVE_SEGREDO_ANTHROPIC_PAINEL, deps.encrypt(chave));
  const preferido = await lerModelo(deps);
  const modeloLimpo = preferido && !modelos.some(m => m.id === preferido) ? preferido : null;
  if (modeloLimpo) await deps.gravarBanco(CHAVE_MODELO_ANTHROPIC_PAINEL, "");
  const funcoesLimpas = await conferirModelosDasFuncoes(modelos, deps, anteriores);
  const avisoFuncoes = funcoesLimpas.map(f => f.anterior
    ? ` O modelo antigo do cartão da Dolores (${f.modelo}) não é oferecido para esta chave: ela passa a usar o preferencial. O valor antigo fica guardado até você salvar o modelo da Dolores em "Modelo por função".`
    : ` O modelo ${f.modelo} de "${DESCRICAO_FUNCOES_ANTHROPIC[f.funcao].rotulo}" não é oferecido para esta chave e foi limpo: a função passa a usar o preferencial.`).join("");
  return {
    mensagem: `Chave validada e salva — ${modelos.length} modelo(s) disponível(is).${modeloLimpo ? ` O modelo preferencial ${modeloLimpo} não é oferecido para esta chave e foi limpo: escolha outro.` : ""}${avisoFuncoes}`,
    modelos: modelos.length, modeloLimpo,
  };
}

/**
 * Remove a chave, a preferência de modelo, os modelos escolhidos por função e os avisos. O valor antigo do cartão da
 * Dolores NÃO é apagado (só por ação do admin no painel): sem chave ela não roda, e a próxima chave salva confere de novo
 * se a conta oferece esse modelo (QA S-11 achado 5).
 */
export async function removerAnthropicPainel(deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<void> {
  await deps.gravarBanco(CHAVE_SEGREDO_ANTHROPIC_PAINEL, "");
  await deps.gravarBanco(CHAVE_MODELO_ANTHROPIC_PAINEL, "");
  for (const f of FUNCOES_ANTHROPIC) {
    await deps.gravarBanco(chaveModeloDaFuncao(f), "");
    await deps.gravarBanco(chaveAvisoDaFuncao(f), "");
    await deps.gravarBanco(chaveAnteriorSumiuDaFuncao(f), "");
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

/** Modelo anterior de cada função, guardado fora do painel (Dolores: o campo antigo do cartão). Só nomes de modelo. */
export type AnterioresDasFuncoes = { anteriorDolores?: string | null };

/**
 * Modelo escolhido para uma função que não aparece mais na lista da conta: é limpo (a função cai para o preferencial)
 * e o id fica guardado como aviso para o painel mostrar até o admin escolher de novo.
 * QA S-11 achado 5: o modelo ANTERIOR da Dolores (campo antigo do cartão) também é conferido. Se a conta não o oferece,
 * ele deixa de valer como queda e o painel avisa, mas o valor NÃO é apagado aqui (só pela ação do admin no painel);
 * se a conta voltar a oferecê-lo, o aviso sai e ele volta a valer.
 */
export async function conferirModelosDasFuncoes(
  modelos: ModeloAnthropic[], deps: AnthropicPainelDeps = anthropicPainelDepsPadrao, anteriores: AnterioresDasFuncoes = {},
): Promise<Array<{ funcao: FuncaoAnthropic; modelo: string; anterior?: true }>> {
  const gravados = await modelosGravadosDasFuncoes(soLeitor(deps));
  const limpas: Array<{ funcao: FuncaoAnthropic; modelo: string; anterior?: true }> = [];
  const existe = (id: string) => modelos.some(m => m.id === id);
  for (const f of FUNCOES_ANTHROPIC) {
    const id = gravados[f].modelo;
    if (!id || existe(id)) continue;
    await deps.gravarBanco(chaveModeloDaFuncao(f), "");
    await deps.gravarBanco(chaveAvisoDaFuncao(f), id);
    limpas.push({ funcao: f, modelo: id });
  }
  const anterior = anteriores.anteriorDolores?.trim() || null;
  const marcado = gravados.dolores_whatsapp.anteriorSumiu;
  if (anterior && !existe(anterior)) {
    if (marcado !== anterior) await deps.gravarBanco(chaveAnteriorSumiuDaFuncao("dolores_whatsapp"), anterior);
    limpas.push({ funcao: "dolores_whatsapp", modelo: anterior, anterior: true });
  } else if (marcado) {
    await deps.gravarBanco(chaveAnteriorSumiuDaFuncao("dolores_whatsapp"), "");
  }
  return limpas;
}

/**
 * Confere o modelo de uma função SEM gravar nada: id vazio = "usar o preferencial" (null); senão, só um id que a chave
 * salva oferece agora. Não chama a IA para a função (listar modelos não consome tokens).
 */
export async function validarModeloDaFuncao(funcao: FuncaoAnthropic, id: string, deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<ModeloAnthropic | null> {
  if (!FUNCOES_ANTHROPIC.includes(funcao)) throw new Error("Função desconhecida.");
  const alvo = id.trim();
  if (!alvo) return null;
  const modelos = await modelosAnthropicPainel(deps);
  const modelo = modelos.find(m => m.id === alvo) ?? null;
  if (!modelo) throw new Error("Esse modelo não está disponível para a chave salva. Atualize a lista e escolha outro.");
  return modelo;
}

/**
 * Grava o modelo (já validado) de uma função e apaga o aviso de modelo sumido. Se a gravação do modelo falhar, o aviso
 * volta a ser o de antes (QA S-11 achado 6: nada fica salvo pela metade) e o erro sobe.
 */
export async function gravarModeloDaFuncao(funcao: FuncaoAnthropic, modelo: ModeloAnthropic | null, deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<void> {
  const avisos = [chaveAvisoDaFuncao(funcao), chaveAnteriorSumiuDaFuncao(funcao)];
  const antes = await Promise.all(avisos.map(async k => (await deps.lerBanco(k))?.trim() ?? ""));
  try {
    for (const k of avisos) await deps.gravarBanco(k, "");
    await deps.gravarBanco(chaveModeloDaFuncao(funcao), modelo?.id ?? "");
  } catch (e) {
    for (let i = 0; i < avisos.length; i++) if (antes[i]) await deps.gravarBanco(avisos[i], antes[i]).catch(() => undefined);
    throw e;
  }
}

/** Valida e grava o modelo de uma função (id vazio = "usar o preferencial"). Não liga nada. */
export async function salvarModeloDaFuncao(funcao: FuncaoAnthropic, id: string, deps: AnthropicPainelDeps = anthropicPainelDepsPadrao): Promise<ModeloAnthropic | null> {
  const modelo = await validarModeloDaFuncao(funcao, id, deps);
  await gravarModeloDaFuncao(funcao, modelo, deps);
  return modelo;
}

export const NOTA_FUNCAO_ANTHROPIC: Partial<Record<FuncaoAnthropic, string>> = {
  maquete_leitura: "Vale quando a leitura usa a chave deste painel. Sem ela, se houver a chave antiga configurada pela equipe técnica no servidor, vale o modelo das configurações da Maquete 3D.",
};

export const MENSAGEM_SEM_CHAVE_DA_FUNCAO = "Sem chave utilizável: a função não roda pela chave do painel.";

/**
 * Uma linha por função para o painel: escolhido, avisos de modelo sumido e o modelo que vale agora. Sem a chave.
 * QA S-11 achado 4: "valendo" reflete a execução real. Sem chave utilizável no painel (ausente ou ilegível), nenhuma
 * função roda por ele: não se mostra um modelo que não será usado. Só a Maquete ainda roda, se houver a chave antiga
 * configurada pela equipe técnica no servidor, e aí vale o modelo das configurações da Maquete 3D.
 */
export async function statusModelosPorFuncao(
  extras: AnterioresDasFuncoes & { padraoMaquete?: string | null; chaveServidorMaquete?: boolean } = {},
  deps: AnthropicPainelDeps = anthropicPainelDepsPadrao,
) {
  const [salva, preferencial, gravados] = await Promise.all([lerChaveSalva(deps), lerModelo(deps), modelosGravadosDasFuncoes(soLeitor(deps))]);
  const utilizavel = Boolean(salva && salva !== "ilegivel");
  const funcoes = await Promise.all(FUNCOES_ANTHROPIC.map(async f => {
    const padrao = f === "maquete_leitura" ? extras.padraoMaquete?.trim() || null : null;
    const servidor = f === "maquete_leitura" && !!extras.chaveServidorMaquete;
    const valendo: { modelo: string | null; origem: OrigemModelo | "servidor" | null } = utilizavel
      ? await modeloDaFuncao(f, {
        preferencial,
        anterior: f === "dolores_whatsapp" ? extras.anteriorDolores ?? null : null,
        padrao,
      }, soLeitor(deps))
      : servidor && padrao ? { modelo: padrao, origem: "servidor" } : { modelo: null, origem: null };
    return {
      ...DESCRICAO_FUNCOES_ANTHROPIC[f],
      modelo: gravados[f].modelo,
      sumiu: gravados[f].sumiu,
      /** Dolores: o modelo antigo do cartão que a conta não oferece (deixou de valer; sai quando o admin salva a escolha). */
      anteriorSumiu: f === "dolores_whatsapp" && extras.anteriorDolores?.trim() && gravados[f].anteriorSumiu === extras.anteriorDolores.trim() ? gravados[f].anteriorSumiu : null,
      nota: NOTA_FUNCAO_ANTHROPIC[f] ?? null,
      /** Sem chave utilizável no painel: a função não roda por ele (a tela diz isso em vez de mostrar um modelo). */
      semChave: utilizavel ? null : servidor
        ? `${MENSAGEM_SEM_CHAVE_DA_FUNCAO} Enquanto houver a chave antiga configurada pela equipe técnica no servidor, a leitura usa essa chave com o modelo das configurações da Maquete 3D${padrao ? ` (${padrao})` : ""}.`
        : MENSAGEM_SEM_CHAVE_DA_FUNCAO,
      valendo,
    };
  }));
  return { configurado: utilizavel, preferencial, funcoes };
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
