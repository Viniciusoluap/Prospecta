-- Sem backfill: estudos antigos começam sem etapas e podem ser editados.
ALTER TABLE "incorporation_studies"
  ADD COLUMN IF NOT EXISTS "due_diligence_json" text;
