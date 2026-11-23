// Jurídico — retentativa automática das conferências pendentes por falha de rede (22/11/2026).
//
// Quando: ao abrir o contrato no Jurídico (chamada automática da tela) e no cron diário já existente
// (/api/cron/lead-card-due, com CRON_SECRET), sempre com prazo e quantidade limitados.
// Política: só pendências "transitórias" (certificadora/LCR fora do ar, prazo); esperas de 10 min, 30 min, 2 h, 6 h e
// 24 h; no máximo 6 tentativas e 7 dias desde a primeira conferência. Esgotado o prazo, fica pendente para conferência
// manual — timeout NUNCA vira válido. Cada rodada reserva a linha (token em `execucao` + tentativa contada antes da rede),
// então duas rodadas simultâneas não conferem nem gravam o mesmo documento.
// Retorno pelo portal: se a nova conferência passar (todas as identidades obrigatórias conferidas E revisão da empresa
// conservada), o documento vira "Assinado por todos" no mesmo lote, só se ainda estiver "Recebido para conferência".
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Certificate } from "pkijs";
import { portalContractDocuments, portalContracts } from "../drizzle/schema.js";
import { nomeContrato } from "../shared/contratos/documentos.js";
import { getDb } from "./db.js";
import { baseDaEmpresa, conteudoContrato, mesmoConteudo } from "./juridico-workflow.js";
import { listarValidacoes, proximaTentativa, relatorioEmpresa, relatorioRetorno, RETENTATIVA, resumir, sha256Hex, tabelaValidacoes, type RelatorioValidacao, type ResumoValidacao } from "./juridico-validacao.js";
import type { OpcoesConferencia } from "./juridico-verificar-assinaturas.js";
import { SessaoPki } from "./juridico-pki-download.js";

export type OpcoesRevalidacao = OpcoesConferencia & { roots?: Certificate[] };
/** "Conferir novamente" (admin): no máximo uma vez por minuto por documento; serve também à reserva entre rodadas. */
export const INTERVALO_MANUAL_MS = 60_000;
type Linha = { relatorio: RelatorioValidacao | string; tentativas: number; primeira_em: string | Date; sha256: string; origem: RelatorioValidacao["origem"] };
const linhas = <T,>(res: unknown) => (res as { rows: T[] }).rows;

async function bytesDoDocumento(id: number | null | undefined, contractId: number): Promise<{ id: number; bytes: Buffer } | null> {
  if (!id) return null;
  const [doc] = await getDb().select().from(portalContractDocuments).where(and(eq(portalContractDocuments.id, id), eq(portalContractDocuments.contractId, contractId))).limit(1);
  const bytes = doc ? await conteudoContrato(doc) : null;
  return doc && bytes ? { id: doc.id, bytes } : null;
}

/**
 * Confere de novo UM documento pendente cuja vez chegou. Devolve o resumo atual (ou null sem relatório).
 * `manual` ("Conferir novamente", só admin): confere de novo um documento PENDENTE ou INVÁLIDO a qualquer momento,
 * pelos mesmos bytes gravados (o SHA-256 precisa bater) e pelo mesmo motor — é assim que um documento marcado
 * "inválido" por uma falha da própria conferência (ex.: cadeia ICP-Brasil que o sistema não soube completar, 23/11)
 * é reavaliado. Nada é alterado à mão: o novo relatório substitui o anterior. Documento já válido não é reconferido.
 */
export async function revalidarDocumento(documentId: number, opcoes: OpcoesRevalidacao & { manual?: boolean } = {}): Promise<ResumoValidacao | null> {
  if (!(await tabelaValidacoes())) return null;
  const db = getDb(), agora = opcoes.agora ?? new Date(), token = randomUUID();
  const limitePrazo = new Date(agora.getTime() - RETENTATIVA.prazoMs).toISOString();
  const reservaAte = new Date(agora.getTime() + RETENTATIVA.reservaMs).toISOString();
  // Achado M3: o teto (tentativas e 7 dias) vale na própria reserva; quem passou do teto fica pendente para conferência manual.
  // Na conferência manual, o intervalo mínimo desde a última gravação faz o papel de reserva (duas chamadas seguidas
  // não conferem juntas) e de limite de uso.
  const reserva = opcoes.manual
    ? await db.execute(sql`UPDATE portal_contract_document_validacoes
      SET execucao = ${token}, tentativas = tentativas + 1, proxima_tentativa = ${reservaAte}::timestamptz, atualizado_em = now()
      WHERE document_id = ${documentId} AND estado IN ('pendente', 'invalida')
        AND atualizado_em <= ${new Date(agora.getTime() - INTERVALO_MANUAL_MS).toISOString()}::timestamptz
      RETURNING relatorio, tentativas, primeira_em, sha256, origem`)
    : await db.execute(sql`UPDATE portal_contract_document_validacoes
      SET execucao = ${token}, tentativas = tentativas + 1, proxima_tentativa = ${reservaAte}::timestamptz, atualizado_em = now()
      WHERE document_id = ${documentId} AND estado = 'pendente' AND proxima_tentativa IS NOT NULL AND proxima_tentativa <= ${agora.toISOString()}::timestamptz
        AND tentativas < ${RETENTATIVA.maxTentativas} AND primeira_em > ${limitePrazo}::timestamptz
      RETURNING relatorio, tentativas, primeira_em, sha256, origem`);
  const linha = linhas<Linha>(reserva)[0];
  if (!linha && opcoes.manual) return (await listarValidacoes([documentId]))[0] ?? null;
  if (!linha) {
    await db.execute(sql`UPDATE portal_contract_document_validacoes
      SET proxima_tentativa = NULL, versao = versao + 1, atualizado_em = now(),
          relatorio = jsonb_set(jsonb_set(relatorio, '{transitoria}', 'false'::jsonb), '{motivo}', to_jsonb(COALESCE(relatorio->>'motivo', '') || ' Prazo das novas tentativas esgotado: confira manualmente.'))
      WHERE document_id = ${documentId} AND estado = 'pendente' AND proxima_tentativa IS NOT NULL
        AND (tentativas >= ${RETENTATIVA.maxTentativas} OR primeira_em <= ${limitePrazo}::timestamptz)`);
    return (await listarValidacoes([documentId]))[0] ?? null;
  }
  const antigo: RelatorioValidacao = typeof linha.relatorio === "string" ? JSON.parse(linha.relatorio) : linha.relatorio;
  const tentativas = Number(linha.tentativas), primeiraEm = new Date(linha.primeira_em);
  const [doc] = await db.select().from(portalContractDocuments).where(eq(portalContractDocuments.id, documentId)).limit(1);
  const [contract] = doc ? await db.select().from(portalContracts).where(eq(portalContracts.id, doc.contractId)).limit(1) : [];
  const bytes = doc ? await conteudoContrato(doc) : null;
  let novo: RelatorioValidacao;
  if (!doc || !contract || !bytes || sha256Hex(bytes) !== linha.sha256) {
    novo = { ...antigo, estado: "pendente", transitoria: false, verificadoEm: agora.toISOString(), motivo: "O arquivo conferido não está mais disponível ou mudou. Confira manualmente." };
  } else if (linha.origem === "assinatura_empresa") {
    novo = await relatorioEmpresa(contract, bytes, await bytesDoDocumento(antigo.documentoOrigemId, contract.id), mesmoConteudo, opcoes.roots, opcoes);
  } else {
    // A base só vale se ainda for a ÚLTIMA assinatura da empresa, conferida, e a mesma usada no envio (achados A2/M2).
    const base = await baseDaEmpresa(contract.id);
    novo = await relatorioRetorno(linha.origem, contract, bytes, base && base.id === antigo.documentoBaseId ? base : null, mesmoConteudo, opcoes.roots, opcoes);
  }
  const proxima = proximaTentativa(novo, tentativas, primeiraEm, agora);
  if (novo.estado === "pendente" && novo.transitoria && !proxima) novo = { ...novo, transitoria: false, motivo: `${novo.motivo} Prazo das novas tentativas esgotado: confira manualmente.` };
  const ops = [db.execute(sql`UPDATE portal_contract_document_validacoes
    SET estado = ${novo.estado}, relatorio = ${JSON.stringify(novo)}::jsonb, verificado_em = ${novo.verificadoEm}::timestamptz,
        proxima_tentativa = ${proxima ? proxima.toISOString() : null}::timestamptz, versao = versao + 1, atualizado_em = now()
    WHERE document_id = ${documentId} AND execucao = ${token}`)];
  const baseId = novo.documentoBaseId;
  if (doc && contract && baseId && linha.origem === "retorno_portal" && novo.todos && novo.estado === "valida" && novo.conservaEmpresa === true) {
    // Achado M2: no momento da gravação, o contrato precisa continuar "em conferência" e a base usada precisa continuar
    // sendo a última assinatura da empresa, com conferência válida. Senão, nada é concluído.
    ops.push(db.execute(sql`UPDATE portal_contract_documents SET type = 'assinado', name = ${nomeContrato(contract.partyB, "assinado")}
      WHERE id = ${documentId} AND type = 'recebido_assinado'
        AND EXISTS (SELECT 1 FROM portal_contract_document_validacoes WHERE document_id = ${documentId} AND execucao = ${token} AND estado = 'valida')
        AND EXISTS (SELECT 1 FROM portal_contracts WHERE id = ${contract.id} AND signature_status = 'em_conferencia')
        AND ${baseId} = (SELECT id FROM portal_contract_documents WHERE contract_id = ${contract.id} AND type = 'assinatura_digital' ORDER BY created_at DESC, id DESC LIMIT 1)
        AND EXISTS (SELECT 1 FROM portal_contract_document_validacoes WHERE document_id = ${baseId} AND estado = 'valida' AND relatorio->>'vinculoOrigem' = 'conferido')`));
    ops.push(db.execute(sql`UPDATE portal_contracts SET signature_status = 'assinado', updated_at = now()
      WHERE id = ${contract.id} AND signature_status = 'em_conferencia'
        AND EXISTS (SELECT 1 FROM portal_contract_documents WHERE id = ${documentId} AND type = 'assinado')
        AND EXISTS (SELECT 1 FROM portal_contract_document_validacoes WHERE document_id = ${documentId} AND execucao = ${token})`));
  }
  await db.batch(ops as unknown as Parameters<typeof db.batch>[0]);
  return resumir(documentId, novo, tentativas, proxima);
}

/** Rodada limitada: as pendências mais antigas cuja vez chegou, uma por vez, até o prazo. Nunca lança. */
export async function revalidarPendentes(limiteMs: number, opcoes: OpcoesRevalidacao & { maxDocumentos?: number } = {}): Promise<{ conferidos: number; erro?: boolean }> {
  const inicio = Date.now();
  try {
    if (limiteMs < 3_000 || !(await tabelaValidacoes())) return { conferidos: 0 };
    const agora = opcoes.agora ?? new Date();
    const res = await getDb().execute(sql`SELECT document_id FROM portal_contract_document_validacoes
      WHERE estado = 'pendente' AND proxima_tentativa IS NOT NULL AND proxima_tentativa <= ${agora.toISOString()}::timestamptz
      ORDER BY proxima_tentativa ASC LIMIT ${Math.min(opcoes.maxDocumentos ?? 5, 20)}`);
    let conferidos = 0;
    for (const { document_id } of linhas<{ document_id: number }>(res)) {
      const resta = limiteMs - (Date.now() - inicio);
      if (resta < 3_000) break;
      try {
        await revalidarDocumento(Number(document_id), { ...opcoes, sessao: opcoes.sessao ?? new SessaoPki({ prazoMs: resta - 1_000 }) });
        conferidos++;
      } catch (e) {
        // Um documento com erro não impede os outros; a tentativa já foi contada na reserva (teto garantido).
        console.error("[juridico/revalidar]", Number(document_id), e instanceof Error ? e.message : "falha");
      }
    }
    return { conferidos };
  } catch (e) {
    console.error("[juridico/revalidar]", e instanceof Error ? e.message : "falha");
    return { conferidos: 0, erro: true };
  }
}
