// Lote 23/10, etapa 6 — "Duplicar lead". Regras em shared/lead-duplicar.ts;
// gêmeo em Grupo-Santa-Fe/web/src/lib/crm/lead-duplicar-db.ts.
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { MODELO_NOTA_LEAD_NOVO, MODELO_NOTA_LEAD_ORIGEM } from "../shared/lead-duplicar.js";

/**
 * Uma única instrução SQL (atômica): cria o lead novo, copia os documentos ativos
 * (sem serviço vinculado, apontando para o original), copia o conteúdo dos que
 * estão guardados no banco e registra a origem nos dois leads. Se qualquer parte
 * falhar, nada é gravado.
 */
export async function duplicarLead(leadId: number, ator: { id: number; nome: string }) {
  const resultado = await getDb().execute(sql`
    WITH origem AS (
      SELECT * FROM leads WHERE id = ${leadId} AND deleted_at IS NULL
    ), novo AS (
      INSERT INTO leads (
        name, phone, email, city, state, type, temperature, responsible, responsible_user_id, broker_id,
        cpf, address, neighborhood, income, income_type, fgts_amount, pis_fgts, has_spouse, spouse_name,
        income_composition, cpf_status, simulation_value, approved_value, contract_type, source_channel, source_city,
        lgpd_consent, lgpd_consent_at, notes, admin_notes,
        stage, stage_classification_pending, duplicated_from_lead_id, duplicated_at, duplicated_by_user_id
      )
      SELECT
        name, phone, email, city, state, type, temperature, responsible, responsible_user_id, broker_id,
        cpf, address, neighborhood, income, income_type, fgts_amount, pis_fgts, has_spouse, spouse_name,
        income_composition, cpf_status, simulation_value, approved_value, contract_type, source_channel, source_city,
        lgpd_consent, lgpd_consent_at, notes, admin_notes,
        'lead_new', false, id, now(), ${ator.id}
      FROM origem
      RETURNING id, name
    ), docs AS (
      INSERT INTO lead_documents (
        lead_id, service_id, type, file_name, file_url, drive_file_id, mime_type, file_size, sha256, storage,
        storage_note, uploaded_by_user_id, status, notes, uploaded_at, reviewed_at, copied_from_document_id
      )
      SELECT novo.id, NULL, d.type, d.file_name, d.file_url, d.drive_file_id, d.mime_type, d.file_size, d.sha256, d.storage,
        d.storage_note, d.uploaded_by_user_id, d.status, d.notes, d.uploaded_at, d.reviewed_at, d.id
      FROM lead_documents d CROSS JOIN novo
      WHERE d.lead_id = ${leadId} AND d.deleted_at IS NULL
      RETURNING id, copied_from_document_id
    ), arquivos AS (
      INSERT INTO lead_document_file_data (document_id, mime, size_bytes, data)
      SELECT docs.id, f.mime, f.size_bytes, f.data
      FROM docs JOIN lead_document_file_data f ON f.document_id = docs.copied_from_document_id
      RETURNING document_id
    ), total AS (
      SELECT (SELECT count(*) FROM docs)::int AS documentos, (SELECT count(*) FROM arquivos)::int AS arquivos
    ), nota_novo AS (
      INSERT INTO lead_activities (lead_id, type, description, performed_by, metadata)
      SELECT novo.id, 'note', format(${MODELO_NOTA_LEAD_NOVO}, ${leadId}::text, novo.name, total.documentos::text), ${ator.nome}, json_build_object('kind', 'lead_duplicado', 'origemLeadId', ${leadId}, 'documentos', total.documentos)::text
      FROM novo CROSS JOIN total
      RETURNING id
    ), nota_origem AS (
      INSERT INTO lead_activities (lead_id, type, description, performed_by, metadata)
      SELECT ${leadId}, 'note', format(${MODELO_NOTA_LEAD_ORIGEM}, novo.id::text), ${ator.nome}, json_build_object('kind', 'lead_duplicado', 'novoLeadId', novo.id)::text
      FROM novo
      RETURNING id
    )
    SELECT novo.id, origem.name AS origem_nome, total.documentos, total.arquivos,
      (SELECT count(*) FROM nota_novo)::int + (SELECT count(*) FROM nota_origem)::int AS notas
    FROM novo CROSS JOIN origem CROSS JOIN total
  `);
  const linha = resultado.rows[0] as { id: number; origem_nome: string; documentos: number; arquivos: number } | undefined;
  if (!linha) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado ou excluído." });
  return { id: linha.id, documentos: linha.documentos };
}
