-- Prepara os 3 módulos legados (Regularização, Jurídico, Financiamento do cliente)
-- para gravar uploads novos no Google Drive privado, como já ocorre no CRM.
-- Nenhum dado existente é alterado; os campos antigos continuam disponíveis
-- para os arquivos já enviados antes desta migração.
ALTER TABLE "regularizacao_documents" ADD COLUMN IF NOT EXISTS "drive_file_id" text;
ALTER TABLE "portal_contract_documents" ADD COLUMN IF NOT EXISTS "drive_file_id" text;
ALTER TABLE "portal_contract_documents" ALTER COLUMN "url" DROP NOT NULL;
ALTER TABLE "financiamento_checklist_items" ADD COLUMN IF NOT EXISTS "documento_drive_file_id" text;
