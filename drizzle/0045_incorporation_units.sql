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
);
CREATE UNIQUE INDEX IF NOT EXISTS "incorporation_units_study_code_key_idx" ON "incorporation_units" ("study_id", "code_key");
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
);
CREATE INDEX IF NOT EXISTS "incorporation_unit_events_unit_idx" ON "incorporation_unit_events" ("unit_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "incorporation_unit_events_legacy_sale_idx" ON "incorporation_unit_events" ("unit_id", "legacy_sale_id") WHERE "legacy_sale_id" IS NOT NULL;
