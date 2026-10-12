-- EPIC-020 Lote 3 (item 32) — comissões automáticas pelo CRM.
-- Somente aditiva. Regra de comissão: percentual da obra ou, na falta dele,
-- o percentual padrão do corretor. Nenhum percentual é preenchido aqui: a
-- regra é cadastrada pela empresa (nunca inventada).
ALTER TABLE "construction_projects" ADD COLUMN IF NOT EXISTS "commission_pct" numeric(7, 4);--> statement-breakpoint
ALTER TABLE "broker_profiles" ADD COLUMN IF NOT EXISTS "default_commission_pct" numeric(7, 4);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "construction_projects" ADD CONSTRAINT "construction_projects_commission_pct_range"
    CHECK ("commission_pct" IS NULL OR ("commission_pct" >= 0 AND "commission_pct" <= 100));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "broker_profiles" ADD CONSTRAINT "broker_profiles_default_commission_pct_range"
    CHECK ("default_commission_pct" IS NULL OR ("default_commission_pct" >= 0 AND "default_commission_pct" <= 100));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
