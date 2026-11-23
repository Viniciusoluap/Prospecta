// EPIC-029 S-7 (22/11/2026) — PONTO DE ENTRADA da alíquota do ISS que vai na DPS (pAliq). Nenhum número é inventado aqui.
// - Simples Nacional: a alíquota sai do RBT12 (receita bruta dos últimos 12 meses) e do anexo da atividade — a tabela vem de
//   OUTRA frente (EPIC-029, alíquotas do Simples). Até ela entrar, `FONTES_ALIQUOTA.simples` é null e a DPS é recusada com
//   a frase do que falta. Quem entregar a tabela só registra a função aqui (`registrarFonteSimples`).
// - Demais regimes conhecidos: a alíquota OFICIAL do município de incidência lida da Sefin ("Buscar alíquotas oficiais",
//   parametros-municipais.ts; obra 7.02/7.05 = município da obra) quando aceita; diferente da digitada e ainda não escolhida
//   → recusa até o admin escolher; sem consulta → a `aliquota_iss` do tipo de serviço (cadastrada pelo contador).
// - Regime desconhecido, "a_confirmar", "outro" ou vazio: recusa (a DPS não é montada).
import { REGIMES_CONHECIDOS } from "./dps.js";

export type ContextoAliquota = {
  emissorCnpj: string;
  /** dCompet (AAAA-MM-DD). */
  competencia: string;
  municipioIncidenciaIbge: string | null;
  tipoServico: { id: number; itemLc116: string | null; codigoAtividadeSimples: string | null; aliquotaIss: string | null } | null;
  /** Última consulta oficial (Sefin) para o município de incidência e o serviço. */
  municipal?: { aliquota: string | null; aliquotaDigitada: string | null; situacao: string } | null;
};

/** Devolve a alíquota em texto ("2.01") ou null quando não sabe (nunca um palpite). */
export type FonteAliquotaSimples = (c: ContextoAliquota) => Promise<string | null>;

export const FONTES_ALIQUOTA: { simples: FonteAliquotaSimples | null } = { simples: null };

/** Para a frente das alíquotas do Simples ligar a sua tabela (RBT12 + anexo). */
export function registrarFonteSimples(fonte: FonteAliquotaSimples | null): void {
  FONTES_ALIQUOTA.simples = fonte;
}

export const FALTA_ALIQUOTA_SIMPLES = "alíquota do ISS no Simples Nacional (calculada pelo RBT12 e pelo anexo da atividade) — a tabela ainda não está no sistema";
export const FALTA_ALIQUOTA_TIPO = "alíquota do ISS do tipo de serviço — contador";
export const FALTA_CONSULTA_FALHOU = "alíquota oficial do município: a última consulta à Sefin não trouxe um valor — busque as alíquotas oficiais de novo (Tipos de serviço › Alíquotas oficiais) antes de emitir";
export const FALTA_REGIME = "regime tributário confirmado no perfil da empresa emissora (hoje está a confirmar ou desconhecido)";

export type AliquotaResolvida = { aliquota: string; fonte: "simples" | "sefin" | "tipo_servico" } | { aliquota: null; falta: string };

export async function resolverAliquotaIss(regime: string | null | undefined, c: ContextoAliquota, fontes = FONTES_ALIQUOTA): Promise<AliquotaResolvida> {
  if (!regime || !(REGIMES_CONHECIDOS as readonly string[]).includes(regime)) return { aliquota: null, falta: FALTA_REGIME };
  if (regime === "simples_nacional") {
    const v = fontes.simples ? await fontes.simples(c) : null;
    return v ? { aliquota: v, fonte: "simples" } : { aliquota: null, falta: FALTA_ALIQUOTA_SIMPLES };
  }
  const m = c.municipal;
  if (m?.situacao === "aceita" && m.aliquota != null) return { aliquota: String(m.aliquota), fonte: "sefin" };
  // QA S-7 (M1): uma consulta oficial que não trouxe valor (ou "aceita" sem número) nunca vira, em silêncio, a digitada.
  if (m && (m.situacao === "sem_valor" || (m.situacao === "aceita" && m.aliquota == null) || !["aceita", "pendente", "recusada"].includes(m.situacao))) {
    return { aliquota: null, falta: FALTA_CONSULTA_FALHOU };
  }
  if (m?.situacao === "pendente") {
    return { aliquota: null, falta: `escolha entre a alíquota oficial do município (${Number(m.aliquota)}%) e a digitada no tipo de serviço (${Number(m.aliquotaDigitada)}%) — Tipos de serviço › Alíquotas oficiais` };
  }
  const v = c.tipoServico?.aliquotaIss;
  return v != null && String(v).trim() !== "" ? { aliquota: String(v), fonte: "tipo_servico" } : { aliquota: null, falta: FALTA_ALIQUOTA_TIPO };
}
