CREATE TABLE IF NOT EXISTS "incorporation_units" (
  "id" serial PRIMARY KEY,
  "study_id" integer NOT NULL REFERENCES "incorporation_studies"("id") ON DELETE RESTRICT,
  "code" varchar(120) NOT NULL,
  "code_key" varchar(120) NOT NULL,
  "kind" varchar(40) NOT NULL,
  "status" varchar(20) DEFAULT 'disponivel' NOT NULL CHECK ("status" IN ('disponivel', 'reservada', 'vendida')),
  "buyer" varchar(255),
  "sale_price" numeric(15,2),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "incorporation_units_sold_buyer_chk" CHECK ("status" <> 'vendida' OR ("buyer" IS NOT NULL AND "sale_price" IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "incorporation_units_study_code_key_idx" ON "incorporation_units" ("study_id", "code_key");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incorporation_unit_events" (
  "id" serial PRIMARY KEY,
  "unit_id" integer NOT NULL REFERENCES "incorporation_units"("id") ON DELETE RESTRICT,
  "previous_status" varchar(20),
  "next_status" varchar(20) NOT NULL,
  "buyer" varchar(255),
  "sale_price" numeric(15,2),
  "legacy_sale_id" varchar(120),
  "performed_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incorporation_unit_events_unit_idx" ON "incorporation_unit_events" ("unit_id", "id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "incorporation_unit_events_legacy_sale_idx" ON "incorporation_unit_events" ("unit_id", "legacy_sale_id") WHERE "legacy_sale_id" IS NOT NULL;--> statement-breakpoint

-- Impede que uma mudança de tipologia esconda o inventário existente e que
-- endpoints antigos recriem vendas no JSON em paralelo às vendas auditáveis.
CREATE OR REPLACE FUNCTION protect_incorporation_unit_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.incorporation_type IS DISTINCT FROM OLD.incorporation_type
     AND EXISTS (SELECT 1 FROM incorporation_units WHERE study_id = OLD.id) THEN
    RAISE EXCEPTION 'INVENTARIO_TIPO_BLOQUEADO';
  END IF;
  IF NEW.incorporation_type = 'desmembramento_simples'
     AND NEW.real_estate_launch_json IS DISTINCT FROM OLD.real_estate_launch_json THEN
    RAISE EXCEPTION 'INVENTARIO_VENDAS_JSON_BLOQUEADAS';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS protect_incorporation_unit_origin_trg ON incorporation_studies;--> statement-breakpoint
CREATE TRIGGER protect_incorporation_unit_origin_trg BEFORE UPDATE ON incorporation_studies
FOR EACH ROW EXECUTE FUNCTION protect_incorporation_unit_origin();
