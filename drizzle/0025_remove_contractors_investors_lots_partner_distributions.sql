-- EPIC-000: remove entidades exclusivas do Prospecta sem equivalente no Grupo Santa Fé
-- (contractors, investors/investor_transactions, lots, partner_distributions)
ALTER TABLE "construction_projects" DROP COLUMN IF EXISTS "contractor_id";
ALTER TABLE "obra_measurements" DROP COLUMN IF EXISTS "contractor_id";

DROP TABLE IF EXISTS "investor_transactions";
DROP TABLE IF EXISTS "investors";
DROP TABLE IF EXISTS "lots";
DROP TABLE IF EXISTS "partner_distributions";
DROP TABLE IF EXISTS "contractors";

DROP TYPE IF EXISTS "public"."contractor_status";
DROP TYPE IF EXISTS "public"."lot_status";
DROP TYPE IF EXISTS "public"."investor_status";
DROP TYPE IF EXISTS "public"."investor_transaction_type";
DROP TYPE IF EXISTS "public"."partner_reference_type";
DROP TYPE IF EXISTS "public"."partner_distribution_status";
