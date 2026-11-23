// Jurídico — relatório da conferência automática das assinaturas, gravado por documento (22/11/2026).
// Tabela: portal_contract_document_validacoes (drizzle/0161_juridico_validacao_assinaturas.sql, migração aditiva).
//
// - O relatório guarda o SHA-256 dos bytes conferidos, a origem (assinatura da empresa, retorno pelo portal, retorno
//   anexado pelo admin), o horário e o resultado por assinatura. Nada de senha, PFX ou chave: só dados do certificado
//   público (titular, CPF/CNPJ do nome do titular, emissor, serial).
// - Gravado no MESMO lote (transação) do documento, do arquivo e do status do contrato.
// - Atualizações (retentativa) são guardadas por `execucao` (token da rodada): duas rodadas simultâneas não se sobrescrevem.
// - Sem a migração aplicada, nada é gravado e o fluxo antigo continua (a conferência ainda é feita e devolvida na resposta).
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "./db.js";
import { conferirAssinaturas, type AssinaturaConferida, type ConferenciaAssinaturas, type OpcoesConferencia } from "./juridico-verificar-assinaturas.js";
import type { EstadoPki } from "./juridico-pki.js";
import type { Certificate } from "pkijs";

export type OrigemValidacao = "assinatura_empresa" | "retorno_portal" | "retorno_admin";
export const AVISO_VALIDACAO = "Conferência técnica automática feita pelo próprio sistema (integridade, cadeia ICP-Brasil e LCR na data da consulta). Não é o relatório oficial do VALIDAR/ITI.";
export const RETENTATIVA = {
  esperasMs: [10 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000, 24 * 3600_000],
  maxTentativas: 6,
  prazoMs: 7 * 24 * 3600_000,
  reservaMs: 5 * 60_000,
} as const;

export type RelatorioValidacao = {
  versao: 1;
  origem: OrigemValidacao;
  sha256: string;
  estado: EstadoPki;
  transitoria: boolean;
  motivo: string;
  verificadoEm: string;
  todos: boolean;
  assinaturas: AssinaturaConferida[];
  coberturaTotal: boolean;
  /** Assinatura da empresa: o titular da assinatura mais recente precisa ser a Parte A. */
  parteA?: { documento: string; conferida: boolean };
  /** Assinatura da empresa: o PDF assinado precisa começar exatamente pelos bytes do documento de origem. */
  documentoOrigemId?: number | null;
  shaOrigem?: string | null;
  vinculoOrigem?: "conferido" | "divergente" | "ausente";
  /** Retorno do cliente: revisão assinada pela empresa usada na comparação e se ela foi conservada. */
  documentoBaseId?: number | null;
  conservaEmpresa?: boolean | null;
  aviso: string;
};

export const sha256Hex = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const digitos = (v: string | null | undefined) => (v || "").replace(/\D/g, "");
const PESO: Record<EstadoPki, number> = { valida: 0, pendente: 1, invalida: 2 };

type Contrato = { partyADocument: string | null; partyBDocument: string | null; signers: string[] | null };

function base(origem: OrigemValidacao, bytes: Buffer, conf: ConferenciaAssinaturas): RelatorioValidacao {
  return {
    versao: 1, origem, sha256: sha256Hex(bytes), estado: conf.estado, transitoria: conf.transitoria, motivo: conf.motivo,
    verificadoEm: conf.verificadoEm, todos: conf.todos, assinaturas: conf.assinaturas, coberturaTotal: conf.coberturaTotal, aviso: AVISO_VALIDACAO,
  };
}
/** Piora o estado do relatório (nunca melhora). `transitoria` só sobrevive se todas as causas de pendência forem de rede. */
function piorar(r: RelatorioValidacao, estado: EstadoPki, motivo: string, transitoria = false): RelatorioValidacao {
  if (PESO[estado] > PESO[r.estado]) return { ...r, estado, motivo, transitoria: estado === "pendente" && transitoria };
  if (estado === "pendente" && r.estado === "pendente" && !transitoria) return { ...r, transitoria: false };
  return r;
}

/** Assinatura da empresa: integridade, cadeia/LCR, titular = Parte A e vínculo com o documento de origem. */
export type ComparaConteudo = (antes: Buffer, depois: Buffer, marca?: { titular: string }) => Promise<boolean>;
export async function relatorioEmpresa(contrato: Contrato, bytes: Buffer, origem: { id: number; bytes: Buffer } | null, mesmoConteudo: ComparaConteudo, roots?: Certificate[], opcoes?: OpcoesConferencia): Promise<RelatorioValidacao> {
  const conf = await conferirAssinaturas(bytes, contrato, roots, opcoes);
  let r: RelatorioValidacao = { ...base("assinatura_empresa", bytes, conf), documentoOrigemId: origem?.id ?? null, shaOrigem: origem ? sha256Hex(origem.bytes) : null };
  // A assinatura da empresa ainda não conclui o contrato; "todos" só vale para o retorno.
  r.todos = false;
  if (!origem) { r.vinculoOrigem = "ausente"; r = piorar(r, "pendente", "Documento de origem não informado: confira manualmente que este PDF é o contrato certo."); }
  const ultima = [...conf.assinaturas].sort((a, b) => b.cobertura[1] - a.cobertura[1])[0];
  if (origem) {
    // Prefixo idêntico (atualização incremental) E conteúdo das páginas conservado: só a marca visível da assinatura
    // daquele titular pode ter entrado (achado A1: texto acrescentado antes de assinar não passa).
    const prefixo = origem.bytes.length < bytes.length && bytes.subarray(0, origem.bytes.length).equals(origem.bytes);
    const conserva = prefixo && await mesmoConteudo(origem.bytes, bytes, { titular: ultima?.titular || "" });
    if (!conserva) { r.vinculoOrigem = "divergente"; r = piorar(r, "invalida", "O PDF assinado não corresponde ao documento de origem deste contrato (conteúdo alterado ou outro arquivo)."); }
    else r.vinculoOrigem = "conferido";
  }
  const esperado = digitos(contrato.partyADocument);
  if (esperado.length !== 11 && esperado.length !== 14) {
    r.parteA = { documento: esperado, conferida: false };
    r = piorar(r, "pendente", "O contrato não tem CPF/CNPJ da Parte A para comparar com o titular do certificado.");
  } else if (ultima) {
    const confere = ultima.documento === esperado;
    r.parteA = { documento: esperado, conferida: confere && ultima.estado === "valida" };
    if (ultima.documento && !confere) r = piorar(r, "invalida", "O titular do certificado não é a Parte A do contrato.");
    else if (!ultima.documento) r = piorar(r, "pendente", "O certificado não identifica o CPF/CNPJ do titular para comparar com a Parte A.");
  } else r.parteA = { documento: esperado, conferida: false };
  return r;
}

/** Retorno do cliente (portal ou anexado pelo admin). `base` = revisão assinada pela empresa JÁ CONFERIDA (válida e vinculada à origem), se houver. */
export async function relatorioRetorno(origem: "retorno_portal" | "retorno_admin", contrato: Contrato, bytes: Buffer, baseEmpresa: { id: number; bytes: Buffer } | null,
  mesmoConteudo: (antes: Buffer, depois: Buffer) => Promise<boolean>, roots?: Certificate[], opcoes?: OpcoesConferencia): Promise<RelatorioValidacao> {
  const conf = await conferirAssinaturas(bytes, contrato, roots, opcoes);
  const r: RelatorioValidacao = { ...base(origem, bytes, conf), documentoBaseId: baseEmpresa?.id ?? null, conservaEmpresa: null };
  if (baseEmpresa && conf.estado !== "invalida") {
    const prefixo = baseEmpresa.bytes.length < bytes.length && bytes.subarray(0, baseEmpresa.bytes.length).equals(baseEmpresa.bytes);
    r.conservaEmpresa = prefixo && await mesmoConteudo(baseEmpresa.bytes, bytes);
  }
  // Conclusão automática exige as identidades conferidas E a revisão da empresa conservada.
  if (r.todos && !baseEmpresa) { r.todos = false; r.motivo = "Não há assinatura da empresa conferida para comparar. O responsável confere o documento."; }
  else if (r.todos && r.conservaEmpresa !== true) { r.todos = false; r.motivo = "O documento retornado precisa de conferência do responsável."; }
  return r;
}

export function proximaTentativa(r: Pick<RelatorioValidacao, "estado" | "transitoria">, tentativas: number, primeiraEm: Date, agora = new Date()): Date | null {
  if (r.estado !== "pendente" || !r.transitoria) return null;
  if (tentativas >= RETENTATIVA.maxTentativas) return null;
  const quando = agora.getTime() + RETENTATIVA.esperasMs[Math.min(tentativas, RETENTATIVA.esperasMs.length - 1)];
  if (quando - primeiraEm.getTime() > RETENTATIVA.prazoMs) return null;
  return new Date(quando);
}

let tabelaExiste = false;
/** A migração 0161 é aplicada pelo dono no Neon; até lá, o relatório não é gravado (nada quebra). Só o "sim" fica em cache. */
export async function tabelaValidacoes(): Promise<boolean> {
  if (tabelaExiste) return true;
  try {
    const res = await getDb().execute(sql`SELECT to_regclass('public.portal_contract_document_validacoes') IS NOT NULL AS ok`);
    tabelaExiste = !!(res as unknown as { rows: { ok: boolean }[] }).rows[0]?.ok;
  } catch { tabelaExiste = false; }
  return tabelaExiste;
}
export function _esquecerTabela() { tabelaExiste = false; }

/** INSERT para ir no mesmo lote do documento (o id do documento já foi reservado). */
export function sqlInserirValidacao(documentId: number, r: RelatorioValidacao, agora = new Date()): SQL {
  const proxima = proximaTentativa(r, 0, agora, agora);
  return sql`INSERT INTO portal_contract_document_validacoes (document_id, estado, origem, sha256, relatorio, verificado_em, tentativas, proxima_tentativa, primeira_em)
    VALUES (${documentId}, ${r.estado}, ${r.origem}, ${r.sha256}, ${JSON.stringify(r)}::jsonb, ${r.verificadoEm}::timestamptz, 0, ${proxima ? proxima.toISOString() : null}::timestamptz, ${agora.toISOString()}::timestamptz)`;
}

export type ResumoValidacao = {
  documentId: number; estado: EstadoPki; origem: OrigemValidacao; motivo: string; verificadoEm: string; transitoria: boolean;
  proximaTentativa: string | null; tentativas: number; aviso: string;
  titulares: { titular: string; documento: string; estado: EstadoPki }[];
  parteA?: RelatorioValidacao["parteA"]; vinculoOrigem?: RelatorioValidacao["vinculoOrigem"]; conservaEmpresa?: boolean | null;
  /** Só na reconferência manual: false = recusada pelo intervalo mínimo (devolve o resultado anterior). */
  reconferida?: boolean;
};
export function resumir(documentId: number, r: RelatorioValidacao, tentativas: number, proxima: string | Date | null): ResumoValidacao {
  return {
    documentId, estado: r.estado, origem: r.origem, motivo: r.motivo, verificadoEm: r.verificadoEm, transitoria: r.transitoria,
    proximaTentativa: proxima ? new Date(proxima).toISOString() : null, tentativas, aviso: r.aviso,
    titulares: r.assinaturas.map(s => ({ titular: s.titular, documento: s.documento, estado: s.estado })),
    parteA: r.parteA, vinculoOrigem: r.vinculoOrigem, conservaEmpresa: r.conservaEmpresa,
  };
}

export async function listarValidacoes(documentIds: number[]): Promise<ResumoValidacao[]> {
  const ids = documentIds.filter(id => Number.isSafeInteger(id) && id > 0).slice(0, 200);
  if (!ids.length || !(await tabelaValidacoes())) return [];
  const res = await getDb().execute(sql`SELECT document_id, relatorio, tentativas, proxima_tentativa FROM portal_contract_document_validacoes
    WHERE document_id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);
  return (res as unknown as { rows: { document_id: number; relatorio: RelatorioValidacao | string; tentativas: number; proxima_tentativa: string | Date | null }[] }).rows
    .map(row => resumir(Number(row.document_id), typeof row.relatorio === "string" ? JSON.parse(row.relatorio) : row.relatorio, Number(row.tentativas), row.proxima_tentativa));
}
