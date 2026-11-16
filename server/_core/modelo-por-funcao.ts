// EPIC-024 S-11 (16/11): qual modelo da Anthropic cada função usa. Lê SÓ os nomes de modelo guardados em
// dashboard_settings (o da função e o preferencial do painel) — nunca a chave: este módulo não importa o acessor do
// painel nem o cofre de segredos (a guarda em server/integracoes-anthropic.test.ts confere).
// Resolução, sempre nesta ordem: modelo da função → modelo anterior da função (Dolores: o campo antigo do cartão dela)
// → modelo preferencial do painel → padrão próprio da função (Maquete: o das configurações da maquete).
import { eq } from "drizzle-orm";
import { dashboardSettings } from "../../drizzle/schema.js";
import { getDb } from "../db.js";
import { FUNCOES_ANTHROPIC, ehFuncaoAnthropic, type FuncaoAnthropic } from "../../shared/funcoes-anthropic.js";

/** Modelo preferencial do painel (S-10). A chave do banco é a mesma que o acessor do painel reexporta. */
export const CHAVE_MODELO_PREFERENCIAL = "segredo.anthropic_painel_modelo";
/** Modelo escolhido para a função (vazio = usar o preferencial). */
export const chaveModeloDaFuncao = (f: FuncaoAnthropic) => `${CHAVE_MODELO_PREFERENCIAL}.${f}`;
/** Id do modelo que foi limpo por ter sumido da conta (o painel avisa até o admin escolher de novo). */
export const chaveAvisoDaFuncao = (f: FuncaoAnthropic) => `${CHAVE_MODELO_PREFERENCIAL}_sumiu.${f}`;

export type OrigemModelo = "funcao" | "anterior" | "preferencial" | "padrao";
export type ModeloResolvido = { modelo: string | null; origem: OrigemModelo | null };
export type LeitorModelos = { lerBanco: (chave: string) => Promise<string | undefined> };
export const leitorModelosPadrao: LeitorModelos = {
  lerBanco: async k => (await getDb().select({ value: dashboardSettings.value }).from(dashboardSettings).where(eq(dashboardSettings.key, k)).limit(1))[0]?.value,
};

const limpo = (v: string | null | undefined) => (v ?? "").trim() || null;
/** Nunca lança: erro síncrono de `lerBanco` (antes de devolver a promessa) também vira "não escolhido". */
const ler = async (deps: LeitorModelos, chave: string) =>
  limpo(await Promise.resolve().then(() => deps.lerBanco(chave)).catch(() => undefined));

/**
 * Modelo que a função usa agora. Nunca lança: banco fora do ar = "não escolhido" (cai para o próximo da ordem).
 * `preferencial`: quem já leu o preferencial (ex.: junto com a chave, no ponto único) o passa; `undefined` = ler aqui.
 */
export async function modeloDaFuncao(
  funcao: FuncaoAnthropic,
  opcoes: { anterior?: string | null; preferencial?: string | null; padrao?: string | null } = {},
  deps: LeitorModelos = leitorModelosPadrao,
): Promise<ModeloResolvido> {
  if (!ehFuncaoAnthropic(funcao)) return { modelo: null, origem: null };
  const daFuncao = await ler(deps, chaveModeloDaFuncao(funcao));
  if (daFuncao) return { modelo: daFuncao, origem: "funcao" };
  const anterior = limpo(opcoes.anterior);
  if (anterior) return { modelo: anterior, origem: "anterior" };
  const preferencial = opcoes.preferencial !== undefined ? limpo(opcoes.preferencial) : await ler(deps, CHAVE_MODELO_PREFERENCIAL);
  if (preferencial) return { modelo: preferencial, origem: "preferencial" };
  const padrao = limpo(opcoes.padrao);
  return padrao ? { modelo: padrao, origem: "padrao" } : { modelo: null, origem: null };
}

/** O que está gravado para cada função (modelo escolhido e aviso de modelo sumido) — só nomes de modelo. */
export async function modelosGravadosDasFuncoes(deps: LeitorModelos = leitorModelosPadrao) {
  const r = {} as Record<FuncaoAnthropic, { modelo: string | null; sumiu: string | null }>;
  await Promise.all(FUNCOES_ANTHROPIC.map(async f => {
    const [modelo, sumiu] = await Promise.all([ler(deps, chaveModeloDaFuncao(f)), ler(deps, chaveAvisoDaFuncao(f))]);
    r[f] = { modelo, sumiu };
  }));
  return r;
}
