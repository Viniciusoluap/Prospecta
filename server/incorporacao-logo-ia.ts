// EPIC-027 C8 (21/11) — proposta de logotipo da Incorporação desenhada em SVG pela IA da chave cadastrada em
// Configurações › Integrações › Anthropic (função "Logotipo da incorporação", modelo próprio no painel).
// - A chave é lida num único ponto nomeado (`resolverCredencialLogotipo`), vigiado por server/integracoes-anthropic.test.ts,
//   e só quando a pessoa clica em "Gerar logotipo com IA". Escolher modelo no painel não liga nada.
// - A chave nunca vai para log, erro, resposta ou tela: o log guarda só o código HTTP e o tipo do erro.
// - Teto: TETO_LOGO_IA_POR_DIA propostas por empreendimento e por pessoa a cada dia (Imperatriz, UTC−3), contadas em
//   dashboard_settings (sem tabela nova). A reserva é feita ANTES de chamar a IA e conta mesmo se a chamada falhar — o
//   lado seguro do gasto, como na Maquete 3D.
// - O SVG devolvido é conteúdo não confiável: passa pela MESMA limpeza do SVG enviado (server/incorporacao-logo-svg.ts).
import { and, eq, ne, sql } from "drizzle-orm";
import { configuracaoAnthropicPainel, existeChaveAnthropicPainel } from "./_core/anthropic-painel.js";
import { modeloDaFuncao, type ModeloResolvido } from "./_core/modelo-por-funcao.js";
import { getDb } from "./db.js";
import { dashboardSettings } from "../drizzle/schema.js";
import { MODELO_PADRAO_DA_FUNCAO } from "../shared/funcoes-anthropic.js";
import { SISTEMA_LOGOTIPO, TETO_LOGO_IA_POR_DIA, dadosDoLogotipo, pedidoLogotipo, tipoDoLogo } from "../shared/incorporacao/logotipo.js";
import { LIMITE_SVG_IA_BYTES, SvgRecusado, sanitizarSvg } from "./incorporacao-logo-svg.js";

export const MENSAGEM_SEM_CHAVE_LOGO = "Cadastre a chave da IA em Configurações › Integrações › Anthropic para gerar o logotipo.";
/** Prazo da chamada: cabe folgado nos 60 s da função da Vercel. */
export const PRAZO_LOGO_IA_MS = 40_000;
/** Saída contida: o SVG pedido tem até ~8 KB (~3 mil tokens). */
export const MAX_TOKENS_LOGO_IA = 4_000;
const TRAVA_USO_LOGO_IA = 27_08;
const PREFIXO_USO = "incorporacao_logo_ia.uso.";

export type CredencialLogotipo = { apiKey: string; modelo: string };

/**
 * ÚNICO ponto que lê a chave do painel para o logotipo. Modelo: o da função → o preferencial do painel → o padrão da
 * função. Sem chave legível no painel: null (não há queda para variável de ambiente).
 */
export async function resolverCredencialLogotipo(
  painel: () => Promise<{ apiKey: string; modelo: string | null } | null> = () => configuracaoAnthropicPainel(),
  modeloFuncao: (preferencial: string | null) => Promise<ModeloResolvido> = preferencial =>
    modeloDaFuncao("incorporacao_logotipo", { preferencial, padrao: MODELO_PADRAO_DA_FUNCAO.incorporacao_logotipo }),
): Promise<CredencialLogotipo | null> {
  const p = await painel().catch(() => null);
  if (!p?.apiKey) return null;
  const m = await modeloFuncao(p.modelo || null).catch(() => null);
  return { apiKey: p.apiKey, modelo: m?.modelo || p.modelo || MODELO_PADRAO_DA_FUNCAO.incorporacao_logotipo! };
}

/** Só diz SE há chave utilizável — para a tela; nunca devolve a chave. */
export async function logotipoIaDisponivel(): Promise<boolean> {
  return (await existeChaveAnthropicPainel().catch(() => ({ existe: false }))).existe;
}

/** Dia civil de Imperatriz (UTC−3, o mesmo de America/Sao_Paulo). */
export const diaDoUso = (agora = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);

export type ReservaLogo = { ok: true; restantes: number } | { ok: false; motivo: string };

/**
 * Reserva uma proposta no teto do dia (empreendimento e pessoa), numa transação com trava: duas abas ao mesmo tempo
 * não passam do teto. Apaga os contadores de dias anteriores (só os deste recurso).
 */
export async function reservarGeracaoLogo(studyId: number, userId: number, agora = new Date()): Promise<ReservaLogo> {
  const dia = diaDoUso(agora);
  const chaveEstudo = `${PREFIXO_USO}${dia}.e.${studyId}`;
  const chavePessoa = `${PREFIXO_USO}${dia}.u.${userId}`;
  return getDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${TRAVA_USO_LOGO_IA}, 0)`);
    const ler = async (k: string) =>
      Number((await tx.select({ v: dashboardSettings.value }).from(dashboardSettings).where(eq(dashboardSettings.key, k)).limit(1))[0]?.v ?? 0) || 0;
    const [doEstudo, daPessoa] = [await ler(chaveEstudo), await ler(chavePessoa)];
    if (doEstudo >= TETO_LOGO_IA_POR_DIA)
      return { ok: false as const, motivo: `Este empreendimento já recebeu ${TETO_LOGO_IA_POR_DIA} propostas de logotipo pela IA hoje. Tente amanhã ou envie o logotipo pelo botão "Enviar logotipo".` };
    if (daPessoa >= TETO_LOGO_IA_POR_DIA)
      return { ok: false as const, motivo: `Você já gerou ${TETO_LOGO_IA_POR_DIA} propostas de logotipo pela IA hoje. Tente amanhã.` };
    for (const [k, v] of [[chaveEstudo, doEstudo + 1], [chavePessoa, daPessoa + 1]] as const) {
      await tx.insert(dashboardSettings).values({ key: k, value: String(v), updatedAt: agora })
        .onConflictDoUpdate({ target: dashboardSettings.key, set: { value: String(v), updatedAt: agora } });
    }
    await tx.delete(dashboardSettings).where(and(
      sql`left(${dashboardSettings.key}, ${PREFIXO_USO.length}) = ${PREFIXO_USO}`,
      ne(sql`left(${dashboardSettings.key}, ${PREFIXO_USO.length + dia.length})`, `${PREFIXO_USO}${dia}`),
    ));
    return { ok: true as const, restantes: TETO_LOGO_IA_POR_DIA - Math.max(doEstudo, daPessoa) - 1 };
  });
}

/** O SVG da resposta: aceita só o documento SVG (no máximo cercado por um bloco de código); senão null. */
export function svgDaResposta(texto: string): string | null {
  const t = texto.trim().replace(/^```(?:svg|xml)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!/^(<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(t) || !/<\/svg>$/i.test(t)) return null;
  return t;
}

type RespostaSdk = { stop_reason?: string | null; content: Array<{ type: string; text?: string }> };
type ClienteMensagens = { messages: { create: (p: Record<string, unknown>, o?: { signal?: AbortSignal }) => Promise<RespostaSdk> } };

export type GeracaoLogo = { ok: true; svg: Buffer } | { ok: false; motivo: string };

/** Mensagem amigável pelo código do erro (nunca o texto do erro, que pode citar a chave). */
function motivoDoErro(e: unknown): string {
  const status = (e as { status?: number })?.status;
  const nome = (e as { name?: string })?.name ?? "";
  if (status === 401 || status === 403) return "A Anthropic recusou a chave cadastrada. Confira em Configurações › Integrações › Anthropic.";
  if (status === 429) return "A IA está com muitos pedidos agora. Tente de novo em alguns minutos.";
  if (status === 400 || status === 404) return "O modelo escolhido para o logotipo não está disponível para a chave. Escolha outro em Configurações › Integrações › Anthropic › Modelo por função.";
  if (/Abort|Timeout/i.test(nome)) return "A IA demorou demais para responder. Tente de novo.";
  return "A IA não respondeu. Tente de novo mais tarde.";
}

/** Chama a IA e devolve o SVG já limpo — ou o motivo, em português simples. */
export async function gerarSvgDoLogotipo(
  estudo: { name?: string | null; city?: string | null; state?: string | null; incorporationType?: string | null },
  credencial: CredencialLogotipo,
  criarCliente: (apiKey: string) => Promise<ClienteMensagens> = async apiKey => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    return new Anthropic({ apiKey, timeout: PRAZO_LOGO_IA_MS, maxRetries: 0 }) as unknown as ClienteMensagens;
  },
): Promise<GeracaoLogo> {
  const dados = dadosDoLogotipo(estudo);
  if (!dados.nome) return { ok: false, motivo: "Dê um nome ao empreendimento antes de gerar o logotipo." };
  let resposta: RespostaSdk;
  try {
    const cliente = await criarCliente(credencial.apiKey);
    resposta = await cliente.messages.create({
      model: credencial.modelo, max_tokens: MAX_TOKENS_LOGO_IA, system: SISTEMA_LOGOTIPO,
      messages: [{ role: "user", content: pedidoLogotipo(dados) }],
    }, { signal: AbortSignal.timeout(PRAZO_LOGO_IA_MS) });
  } catch (e) {
    console.error("[logotipo-ia] falha na chamada", { status: (e as { status?: number })?.status ?? null, tipo: (e as { name?: string })?.name ?? typeof e });
    return { ok: false, motivo: motivoDoErro(e) };
  }
  if (resposta.stop_reason === "refusal") return { ok: false, motivo: "A IA recusou o pedido. Envie o logotipo pelo botão \"Enviar logotipo\"." };
  if (resposta.stop_reason === "max_tokens") return { ok: false, motivo: "A proposta da IA veio incompleta. Tente gerar de novo." };
  const texto = resposta.content.map(b => (b.type === "text" ? b.text ?? "" : "")).join("");
  const bruto = svgDaResposta(texto);
  const invalido = { ok: false as const, motivo: "A IA não devolveu um logotipo válido. Tente gerar de novo." };
  if (!bruto) return invalido;
  let svg: Buffer;
  try {
    svg = sanitizarSvg(bruto, LIMITE_SVG_IA_BYTES);
  } catch (e) {
    if (e instanceof SvgRecusado) return invalido;
    throw e;
  }
  // depois da limpeza precisa continuar sendo SVG com algum desenho
  if (tipoDoLogo(svg) !== "image/svg+xml" || !/<(path|rect|circle|ellipse|polygon|polyline|line|text)[\s>/]/.test(svg.toString("utf8"))) return invalido;
  return { ok: true, svg };
}
