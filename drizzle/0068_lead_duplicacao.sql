-- Lote 23/10, etapa 6: "Duplicar lead" registra a origem (aditiva).
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "duplicated_from_lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "duplicated_at" timestamp;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "duplicated_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;
-- Documento copiado aponta para o original: reaproveita o mesmo arquivo do Drive sem que
-- a organização de pastas o mova para a pasta do lead novo.
ALTER TABLE "lead_documents" ADD COLUMN IF NOT EXISTS "copied_from_document_id" integer REFERENCES "lead_documents"("id") ON DELETE SET NULL;
