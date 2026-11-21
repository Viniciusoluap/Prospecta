// EPIC-027 C7 (20/11/2026) — o que a conta da YCloud diz: o número (tem de ser o MESMO da conexão da empresa), a situação, a
// qualidade, o limite diário (tier) e os modelos com a análise do que esta tela consegue enviar.
import { ehNumeroDoDono, normalizarNumeroDono } from "../../shared/dolores/whatsapp.js";
import {
  ROTULO_QUALIDADE, ROTULO_STATUS_NUMERO, analisarModelo, limiteDoTier, telefoneMascarado, type AnaliseModelo,
} from "../../shared/whatsapp/ycloud.js";
import { listarModelosYcloud, listarNumerosYcloud, type ModeloYcloud, type NumeroYcloud } from "../_core/ycloud.js";
import { atualizarConfigYcloud, chaveYcloud, depsYcloud } from "./config.js";

export type ConferenciaNumero = {
  /** O número da API é o mesmo da conexão da empresa. Sem isso, nada de disparo. */
  numeroConfere: boolean;
  aviso: string | null;
  numero: string | null;            // E.164 (só no servidor; a tela recebe o mascarado)
  numeroMascarado: string | null;
  wabaId: string | null;
  nomeVerificado: string | null;
  status: string | null;
  statusRotulo: string | null;
  qualidade: string | null;
  qualidadeRotulo: string | null;
  tier: string;
  limiteDiario: number;             // destinatários únicos em 24 h móveis (Infinity = sem teto da Meta)
  outrosNumeros: number;
};

const digitos = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

/** Escolhe, entre os números da conta, o da empresa (comparação ESTRITA, a mesma da Dolores). */
export function escolherNumeroDaEmpresa(numeros: NumeroYcloud[], empresaBruto: string | null): ConferenciaNumero {
  const empresa = normalizarNumeroDono(empresaBruto);
  const daEmpresa = empresa ? numeros.find(n => ehNumeroDoDono(digitos(n.phoneNumber), empresa)) : undefined;
  const n = daEmpresa ?? numeros[0];
  const { tier, limite } = limiteDoTier(n ?? {});
  let aviso: string | null = null;
  if (!numeros.length) aviso = "A conta da YCloud não tem nenhum número de WhatsApp conectado.";
  else if (!empresa) aviso = "O número da empresa ainda não está cadastrado em Integrações › WhatsApp da empresa: sem ele, não dá para conferir se a API é o mesmo número. Disparos bloqueados.";
  else if (!daEmpresa) aviso = `ATENÇÃO: o número da API (${telefoneMascarado(n?.phoneNumber)}) NÃO é o número da empresa (${telefoneMascarado(`+${empresa}`)}). Disparos bloqueados até os dois serem o mesmo número.`;
  return {
    numeroConfere: Boolean(daEmpresa), aviso,
    numero: n?.phoneNumber ?? null, numeroMascarado: n?.phoneNumber ? telefoneMascarado(n.phoneNumber) : null,
    wabaId: n?.wabaId ?? null, nomeVerificado: n?.verifiedName ?? null,
    status: n?.status ?? null, statusRotulo: n?.status ? (ROTULO_STATUS_NUMERO[n.status] ?? n.status) : null,
    qualidade: n?.qualityRating ?? null, qualidadeRotulo: n?.qualityRating ? (ROTULO_QUALIDADE[n.qualityRating] ?? n.qualityRating) : null,
    tier, limiteDiario: limite, outrosNumeros: Math.max(0, numeros.length - 1),
  };
}

/** Consulta a YCloud agora e guarda a conferência (sem segredo). Lança ErroYcloud se a YCloud recusar. */
export async function conferirNumeroYcloud(apiKey?: string): Promise<ConferenciaNumero> {
  const d = depsYcloud();
  const chave = apiKey ?? await chaveYcloud();
  if (!chave) throw new Error("Nenhuma chave da YCloud salva.");
  const [numeros, empresa] = await Promise.all([listarNumerosYcloud({ apiKey: chave, fetchImpl: d.fetch }), d.numeroDaEmpresa().catch(() => null)]);
  const c = escolherNumeroDaEmpresa(numeros, empresa);
  await atualizarConfigYcloud({
    numeroApi: c.numero, wabaId: c.wabaId, nomeVerificado: c.nomeVerificado?.slice(0, 255) ?? null, statusNumero: c.status, qualidade: c.qualidade,
    limiteTier: c.tier, limiteDiario: Number.isFinite(c.limiteDiario) ? c.limiteDiario : null, numeroConfere: c.numeroConfere, conferidoEm: d.agora(),
  }, null).catch(() => undefined);
  return c;
}

export type ModeloNaTela = {
  nome: string; idioma: string; categoria: string | null; status: string | null; motivoRecusa: string | null; qualidade: string | null;
  analise: AnaliseModelo;
  /** C7.2: o modelo veio de um template da Central — posição (1..n) → variável da Central ({{nome}}, {{corretor}}…) */
  variaveisDoTemplate?: string[] | null;
};

export function modeloParaTela(m: ModeloYcloud): ModeloNaTela {
  return {
    nome: String(m.name ?? ""), idioma: String(m.language ?? ""), categoria: m.category ?? null, status: m.status ?? null,
    motivoRecusa: m.reason && m.reason !== "NONE" ? String(m.reason).slice(0, 300) : null, qualidade: m.qualityRating ?? null,
    analise: analisarModelo(m.components),
  };
}

export async function modelosDaConta(): Promise<ModeloNaTela[]> {
  const d = depsYcloud();
  const chave = await chaveYcloud();
  if (!chave) throw new Error("Nenhuma chave da YCloud salva.");
  const { lerConfigYcloud } = await import("./config.js");
  const cfg = await lerConfigYcloud();
  const lista = await listarModelosYcloud({ apiKey: chave, fetchImpl: d.fetch }, cfg.wabaId);
  // C7.2: listar também garante o modelo padrão (uma vez; se a conta não tem modelo de marketing em pt_BR). Nunca lança.
  const { garantirModeloPadrao, mapeamentosDoVinculo, vinculosDosTemplates } = await import("./modelos.js");
  const padrao = await garantirModeloPadrao({ origem: "listagem", lista });
  if (padrao.r === "criado" && padrao.modelo) lista.push(padrao.modelo);
  // QA-3: atual e versões anteriores (a v1 aprovada continua preenchendo sozinha enquanto a v2 está em análise)
  const porNome = new Map<string, string[]>();
  for (const v of Array.from((await vinculosDosTemplates().catch(() => new Map<number, never>())).values())) {
    for (const [n, vars] of mapeamentosDoVinculo(v)) if (!porNome.has(n)) porNome.set(n, vars);
  }
  return lista.filter(m => m.name && m.language).map(m => ({ ...modeloParaTela(m), variaveisDoTemplate: m.language === "pt_BR" ? porNome.get(String(m.name)) ?? null : null }))
    .sort((a, b) => Number(b.status === "APPROVED") - Number(a.status === "APPROVED") || a.nome.localeCompare(b.nome));
}
