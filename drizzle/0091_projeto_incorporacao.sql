-- Lote 2, correção 07 (AD-07): processo de Incorporação › Projeto Aprovado ↔ módulo Projetos.
-- Aditiva e idempotente. Projeto vindo da Incorporação não tem lead (lead_id já é opcional).
ALTER TABLE "operational_projects" ADD COLUMN IF NOT EXISTS "incorporation_study_id" integer REFERENCES "incorporation_studies"("id") ON DELETE SET NULL;
ALTER TABLE "operational_projects" ADD COLUMN IF NOT EXISTS "approval_process_id" varchar(100);
-- Situação de aprovação externa (órgão); o andamento técnico interno continua em "status".
ALTER TABLE "operational_projects" ADD COLUMN IF NOT EXISTS "approval_authority" varchar(120);
ALTER TABLE "operational_projects" ADD COLUMN IF NOT EXISTS "approval_protocol" varchar(120);
ALTER TABLE "operational_projects" ADD COLUMN IF NOT EXISTS "approval_status" varchar(30);
ALTER TABLE "operational_projects" ADD COLUMN IF NOT EXISTS "approval_notes" text;
-- Um projeto por (estudo, processo): salvar/editar/reabrir faz upsert, nunca duplica.
CREATE UNIQUE INDEX IF NOT EXISTS "operational_projects_incorporation_process_unique"
  ON "operational_projects" ("incorporation_study_id", "approval_process_id");
