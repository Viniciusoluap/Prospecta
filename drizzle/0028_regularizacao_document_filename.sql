-- Achado no Codex Review da PR #79: o upload de documentos de Regularização
-- recebia o nome e o tipo reais do arquivo, mas nunca os gravava — o download
-- reusava o rótulo da exigência (ex.: "Matrícula atualizada") como nome do
-- arquivo, sem extensão nem tipo MIME reconhecível.
ALTER TABLE "regularizacao_documents" ADD COLUMN IF NOT EXISTS "uploaded_file_name" varchar(255);
ALTER TABLE "regularizacao_documents" ADD COLUMN IF NOT EXISTS "uploaded_mime_type" varchar(120);
