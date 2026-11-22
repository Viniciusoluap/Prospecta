// EPIC-029 S-2 (22/11/2026) — de onde nasce um rascunho de nota (DIAGNOSTICO.md §3) e a sugestão de motivo dos repasses.
import type { MotivoSemNota } from "./motivos.js";

export const ORIGENS_NOTA = [
  "bpo_lancamento",
  "obra_movimento",
  "regularizacao_recebimento",
  "avaliacao",
  "comissao_empresa",
] as const;
export type OrigemNota = (typeof ORIGENS_NOTA)[number];

export const ROTULO_ORIGEM: Record<OrigemNota, string> = {
  bpo_lancamento: "Lançamento do BPO",
  obra_movimento: "Recebimento da obra",
  regularizacao_recebimento: "Recebimento de regularização",
  avaliacao: "Avaliação entregue",
  comissao_empresa: "Comissão da empresa",
};

/**
 * Itens de regularização que são repasse (o dinheiro passa pela empresa e vai para cartório, prefeitura ou Caixa).
 * Nascem com o motivo SUGERIDO — nunca decidido sozinho (DIAGNOSTICO §3, risco R9).
 */
export const MOTIVO_SUGERIDO_POR_ITEM: Readonly<Record<string, MotivoSemNota>> = Object.freeze({
  itbi: "itbi_repassado",
  registro_cartorio: "reembolso_custas",
  cert_inteiro_teor: "reembolso_custas",
  averbacao: "reembolso_custas",
  alvara: "reembolso_custas",
  habite_se: "reembolso_custas",
  cnd_cno: "reembolso_custas",
  vistoria_cef: "taxa_caixa_repassada",
  tx_ass_cef: "taxa_caixa_repassada",
  seguro_cef: "taxa_caixa_repassada",
});

/** Sugestão de motivo para a origem (chave = tipo do lançamento do BPO ou chave_padrao do item da regularização). */
export function motivoSugerido(origem: OrigemNota, subtipo: string | null | undefined): MotivoSemNota | null {
  if (origem === "bpo_lancamento" && subtipo === "reembolso") return "reembolso_custas";
  if (origem === "regularizacao_recebimento" && subtipo) return MOTIVO_SUGERIDO_POR_ITEM[subtipo] ?? null;
  return null;
}

/**
 * Chave do mapa de origens do tipo de serviço: "origem:subtipo" (ex.: "regularizacao_recebimento:despachante") ou
 * "origem:*" para qualquer subtipo daquela origem. A chave mais específica vence.
 */
export function chavesDeMapa(origem: OrigemNota, subtipo: string | null | undefined): string[] {
  return subtipo ? [`${origem}:${subtipo}`, `${origem}:*`] : [`${origem}:*`];
}

export function escolherTipoServico<T extends { id: number; origens: unknown; ativo?: boolean | null }>(
  tipos: readonly T[],
  origem: OrigemNota,
  subtipo: string | null | undefined,
): T | null {
  for (const chave of chavesDeMapa(origem, subtipo)) {
    const achado = tipos.find(t => t.ativo !== false && Array.isArray(t.origens) && (t.origens as unknown[]).includes(chave));
    if (achado) return achado;
  }
  return null;
}

/** Primeiro dia do mês corrente em Brasília (AAAA-MM-DD) — data de corte padrão da varredura. */
export function primeiroDiaDoMesEmBrasilia(agora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" })
    .formatToParts(agora);
  const ano = partes.find(p => p.type === "year")?.value ?? String(agora.getUTCFullYear());
  const mes = partes.find(p => p.type === "month")?.value ?? String(agora.getUTCMonth() + 1).padStart(2, "0");
  return `${ano}-${mes}-01`;
}

/** Meia-noite de Brasília (UTC−3) da data AAAA-MM-DD, como instante — para comparar com as colunas `timestamp`. */
export function inicioDoDiaEmBrasilia(data: string): Date {
  return new Date(`${data}T03:00:00.000Z`);
}
