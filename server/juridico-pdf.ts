import { TRPCError } from "@trpc/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { portalContractDocuments, portalContracts, type PortalContract } from "../drizzle/schema.js";
import { gerarPdfModelo } from "../shared/contratos/pdf.js";
import { modeloNovo, MODELOS_CONTRATO } from "../shared/contratos/modelos.js";
import { getDb } from "./db.js";

export function pdfDoContrato(contrato: PortalContract | undefined) {
  if (!contrato || !modeloNovo(contrato.type) || !contrato.signatureDate || !contrato.signers || !contrato.clauses) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Contrato ou modelo não encontrado." });
  }
  const doc = gerarPdfModelo({ numero: contrato.number, titulo: MODELOS_CONTRATO[contrato.type],
    data: new Date(contrato.signatureDate), clausulas: contrato.clauses, assinaturas: contrato.signers });
  return Buffer.from(doc.output("arraybuffer"));
}

/** Documento e bytes são gravados na mesma transação; repetir o clique reutiliza a cópia gerada. */
export async function gerarESalvarContratoPdf(id: number) {
  const db = getDb();
  const [contrato] = await db.select().from(portalContracts).where(eq(portalContracts.id, id)).limit(1);
  const buffer = pdfDoContrato(contrato), nome = `${contrato.number}.pdf`;
  await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(18271, ${id})`),
    db.execute(sql`WITH novo AS (
      INSERT INTO portal_contract_documents (contract_id, name, type)
      SELECT ${id}, ${nome}, 'contrato_gerado'
      WHERE NOT EXISTS (SELECT 1 FROM portal_contract_documents
        WHERE contract_id = ${id} AND name = ${nome} AND type = 'contrato_gerado')
      RETURNING id
    ) INSERT INTO portal_contract_file_data (document_id, mime, size_bytes, data)
      SELECT id, 'application/pdf', ${buffer.length}, decode(${buffer.toString("base64")}, 'base64') FROM novo`),
  ]);
  const [documento] = await db.select().from(portalContractDocuments).where(and(
    eq(portalContractDocuments.contractId, id), eq(portalContractDocuments.name, nome),
    eq(portalContractDocuments.type, "contrato_gerado"),
  )).orderBy(asc(portalContractDocuments.createdAt)).limit(1);
  return documento;
}
