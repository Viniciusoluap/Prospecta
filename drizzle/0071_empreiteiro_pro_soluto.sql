-- Opção da obra; dados anteriores preservam a base financeira original.
ALTER TABLE "construction_projects"
  ADD COLUMN IF NOT EXISTS "contractor_include_pro_soluto" boolean NOT NULL DEFAULT false;
