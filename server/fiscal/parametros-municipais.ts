// EPIC-029 S-7 (22/11/2026) — "Buscar alíquotas oficiais": consulta os parâmetros municipais da Sefin Nacional com o mTLS do
// emissor (só leitura) e grava o retorno, com data e origem "Sefin", em fiscal_parametros_municipais (histórico; nunca apaga).
// Caminhos [OFICIAL, MAN-API v1.2 §1.2.1]: `/parametros_municipais/{ibge}/{codigoServico}` (alíquotas por subitem) e
// `/parametros_municipais/{ibge}/{CNPJ}` (retenções). Campos da resposta: [NÃO CONFIRMADO no Swagger] — a leitura só aceita
// UMA alíquota sem ambiguidade (todos os campos "aliq…" numéricos do retorno com o mesmo valor); senão grava "sem_valor".
// Regra do coordenador/dono: nunca sobrescrever em silêncio a alíquota digitada no tipo de serviço — se a oficial for
// diferente, a linha fica "pendente" e a tela mostra as duas para o admin escolher.
import { and, desc, eq, sql } from "drizzle-orm";
import { fiscalEmissores, fiscalParametrosMunicipais, fiscalTiposServico, type SituacaoParametroMunicipal } from "../../drizzle/schema-fiscal.js";
import { MUNICIPIOS_CONHECIDOS } from "../../shared/fiscal/municipios.js";
import type { DrizzleDb } from "../db.js";
import { caminhoDe, sessaoDeConsulta, type DepsSefin } from "./sefin.js";

export class ErroParametros extends Error {
  constructor(message: string) { super(message); this.name = "ErroParametros"; }
}

const TAMANHO_MAXIMO_RETORNO = 50_000;

/** Todas as alíquotas numéricas (campos cujo nome contém "aliq") do retorno. */
export function aliquotasDoRetorno(o: unknown, nivel = 0, acc: number[] = []): number[] {
  if (!o || typeof o !== "object" || nivel > 6) return acc;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (/aliq/i.test(k) && (typeof v === "number" || (typeof v === "string" && /^\d{1,3}([.,]\d{1,4})?$/.test(v.trim())))) {
      const n = Number(String(v).replace(",", "."));
      if (Number.isFinite(n) && n >= 0 && n <= 100) acc.push(n);
    } else if (typeof v === "object") aliquotasDoRetorno(v, nivel + 1, acc);
  }
  return acc;
}

/** Uma alíquota sem ambiguidade, ou null. */
export function aliquotaUnica(o: unknown): number | null {
  const todas = Array.from(new Set(aliquotasDoRetorno(o).map(n => Math.round(n * 10_000) / 10_000)));
  return todas.length === 1 ? todas[0]! : null;
}

const retornoGuardavel = (corpo: string): unknown => {
  if (corpo.length > TAMANHO_MAXIMO_RETORNO) return { aviso: "retorno grande demais; não guardado" };
  try { return JSON.parse(corpo); } catch { return { aviso: "retorno não é JSON" }; }
};

/** Municípios consultados: os da operação + o do emissor + os de incidência já gravados nos rascunhos (com IBGE). */
export async function municipiosParaConsultar(db: DrizzleDb, emissorIbge: string | null, extras: string[] = []): Promise<string[]> {
  const deNotas = ((await db.execute(sql`SELECT DISTINCT municipio_incidencia_ibge AS ibge FROM fiscal_notas WHERE municipio_incidencia_ibge IS NOT NULL LIMIT 50`)) as { rows?: { ibge: string }[] }).rows ?? [];
  return Array.from(new Set([...(emissorIbge ? [emissorIbge] : []), ...MUNICIPIOS_CONHECIDOS.map(m => m.ibge), ...deNotas.map(r => String(r.ibge)), ...extras]))
    .filter(i => /^\d{7}$/.test(i)).slice(0, 20);
}

export type ResultadoBusca = { municipioIbge: string; consulta: "aliquota" | "retencoes"; situacao: SituacaoParametroMunicipal | "falhou"; aliquota: number | null; aliquotaDigitada: number | null; mensagem: string };

/**
 * Busca as alíquotas oficiais do tipo de serviço (pelo cTribNac) em cada município, e as retenções do CNPJ do emissor.
 * Só leitura na Sefin; grava o retorno aqui. Ambiente desligado → recusa sem rede (cliente mTLS).
 */
export async function buscarAliquotasOficiais(db: DrizzleDb, e: { emissorId: number; tipoServicoId: number; municipios?: string[]; usuarioId: number }, d: DepsSefin = {}): Promise<ResultadoBusca[]> {
  const [emissor] = await db.select().from(fiscalEmissores).where(eq(fiscalEmissores.id, e.emissorId)).limit(1);
  if (!emissor || !emissor.ativo) throw new ErroParametros("Empresa emissora não encontrada ou inativa.");
  const [tipo] = await db.select().from(fiscalTiposServico).where(eq(fiscalTiposServico.id, e.tipoServicoId)).limit(1);
  if (!tipo) throw new ErroParametros("Tipo de serviço não encontrado.");
  if (!tipo.codigoTributacaoNacional) throw new ErroParametros("Cadastre o código de tributação nacional (6 números) do tipo de serviço antes de buscar as alíquotas oficiais.");
  if (emissor.ambiente !== "producao_restrita" && emissor.ambiente !== "producao") {
    throw new ErroParametros("A consulta usa a conexão segura da empresa emissora, que está com o ambiente desligado. Mude o ambiente para produção restrita (testes) e tente de novo. Nada foi enviado.");
  }
  const ambiente = emissor.ambiente;
  const cliente = await sessaoDeConsulta(db, { id: emissor.id, ambiente }, d);
  const municipios = e.municipios?.length ? e.municipios.filter(i => /^\d{7}$/.test(i)).slice(0, 20) : await municipiosParaConsultar(db, emissor.municipioIbge);
  const digitada = tipo.aliquotaIss == null ? null : Number(tipo.aliquotaIss);
  const resultados: ResultadoBusca[] = [];
  for (const ibge of municipios) {
    // Alíquota do serviço no município
    try {
      const r = await cliente.requisitar("GET", caminhoDe("aliquotasMunicipio", { ibge, servico: tipo.codigoTributacaoNacional }));
      const ok = r.status >= 200 && r.status < 300;
      const retorno = retornoGuardavel(r.corpo);
      const aliq = ok ? aliquotaUnica(retorno) : null;
      const situacao: SituacaoParametroMunicipal = aliq == null ? "sem_valor" : digitada == null || Math.abs(digitada - aliq) < 1e-9 ? "aceita" : "pendente";
      await db.insert(fiscalParametrosMunicipais).values({
        emissorId: emissor.id, tipoServicoId: tipo.id, consulta: "aliquota", municipioIbge: ibge, codigoServico: tipo.codigoTributacaoNacional, ambiente,
        httpStatus: r.status, aliquota: aliq == null ? null : String(aliq), aliquotaDigitada: digitada == null ? null : String(digitada), situacao, retorno, consultadoPor: e.usuarioId,
      });
      resultados.push({ municipioIbge: ibge, consulta: "aliquota", situacao, aliquota: aliq, aliquotaDigitada: digitada,
        mensagem: situacao === "aceita" ? `Alíquota oficial ${aliq}% gravada.` : situacao === "pendente" ? `A alíquota oficial (${aliq}%) é diferente da digitada (${digitada}%): escolha qual vale.`
          : ok ? "A Sefin respondeu, mas sem uma alíquota única para este serviço: confira com o contador." : `A Sefin não trouxe a alíquota (HTTP ${r.status}).` });
    } catch {
      resultados.push({ municipioIbge: ibge, consulta: "aliquota", situacao: "falhou", aliquota: null, aliquotaDigitada: digitada, mensagem: "Não foi possível consultar agora." });
    }
    // Retenções do CNPJ do emissor no município (só guardadas e mostradas; não mudam a DPS sozinhas)
    try {
      const r = await cliente.requisitar("GET", caminhoDe("retencoesMunicipio", { ibge, cnpj: emissor.cnpj }));
      await db.insert(fiscalParametrosMunicipais).values({
        emissorId: emissor.id, tipoServicoId: null, consulta: "retencoes", municipioIbge: ibge, codigoServico: null, ambiente, httpStatus: r.status,
        situacao: "sem_valor", retorno: retornoGuardavel(r.corpo), consultadoPor: e.usuarioId,
      });
      resultados.push({ municipioIbge: ibge, consulta: "retencoes", situacao: "sem_valor", aliquota: null, aliquotaDigitada: null, mensagem: `Retenções consultadas (HTTP ${r.status}); guardadas para o contador.` });
    } catch {
      resultados.push({ municipioIbge: ibge, consulta: "retencoes", situacao: "falhou", aliquota: null, aliquotaDigitada: null, mensagem: "Não foi possível consultar agora." });
    }
  }
  return resultados;
}

/** O admin escolhe entre a oficial ("sefin") e a digitada ("digitada") numa linha pendente. */
export async function escolherAliquota(db: DrizzleDb, e: { id: number; escolha: "sefin" | "digitada"; usuarioId: number }) {
  const [salva] = await db.update(fiscalParametrosMunicipais)
    .set({ situacao: e.escolha === "sefin" ? "aceita" : "recusada", decididoPor: e.usuarioId, decididoEm: new Date() })
    .where(and(eq(fiscalParametrosMunicipais.id, e.id), eq(fiscalParametrosMunicipais.situacao, "pendente"))).returning();
  if (!salva) throw new ErroParametros("Esta alíquota já foi decidida ou não existe. Atualize a tela.");
  return salva;
}

/** A consulta mais recente de alíquota para o município e o serviço (o que vale na DPS). */
export async function aliquotaMunicipalVigente(db: DrizzleDb, municipioIbge: string | null, codigoServico: string | null) {
  if (!municipioIbge || !codigoServico) return null;
  const [r] = await db.select().from(fiscalParametrosMunicipais)
    .where(and(eq(fiscalParametrosMunicipais.consulta, "aliquota"), eq(fiscalParametrosMunicipais.municipioIbge, municipioIbge), eq(fiscalParametrosMunicipais.codigoServico, codigoServico)))
    .orderBy(desc(fiscalParametrosMunicipais.id)).limit(1);
  return r ? { id: r.id, aliquota: r.aliquota, aliquotaDigitada: r.aliquotaDigitada, situacao: r.situacao, consultadoEm: r.consultadoEm } : null;
}

/** Para a tela: as últimas consultas (sem limite de município), mais recentes primeiro. */
export async function listarParametros(db: DrizzleDb, tipoServicoId?: number | null) {
  return db.select({ id: fiscalParametrosMunicipais.id, emissorId: fiscalParametrosMunicipais.emissorId, tipoServicoId: fiscalParametrosMunicipais.tipoServicoId,
    consulta: fiscalParametrosMunicipais.consulta, municipioIbge: fiscalParametrosMunicipais.municipioIbge, codigoServico: fiscalParametrosMunicipais.codigoServico,
    ambiente: fiscalParametrosMunicipais.ambiente, httpStatus: fiscalParametrosMunicipais.httpStatus, aliquota: fiscalParametrosMunicipais.aliquota,
    aliquotaDigitada: fiscalParametrosMunicipais.aliquotaDigitada, situacao: fiscalParametrosMunicipais.situacao, retorno: fiscalParametrosMunicipais.retorno,
    consultadoEm: fiscalParametrosMunicipais.consultadoEm, decididoEm: fiscalParametrosMunicipais.decididoEm })
    .from(fiscalParametrosMunicipais)
    .where(tipoServicoId ? eq(fiscalParametrosMunicipais.tipoServicoId, tipoServicoId) : sql`true`)
    .orderBy(desc(fiscalParametrosMunicipais.id)).limit(200);
}
