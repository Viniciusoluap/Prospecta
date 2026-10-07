CREATE TABLE IF NOT EXISTS "lead_services" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" integer NOT NULL REFERENCES "leads"("id") ON DELETE cascade,
  "service_type" varchar(60) NOT NULL,
  "title" varchar(255),
  "status" varchar(40) DEFAULT 'awaiting_data' NOT NULL,
  "origin_list" varchar(255),
  "source_card_url" text,
  "due_at" timestamp,
  "description" text DEFAULT '' NOT NULL,
  "operational_module" varchar(80),
  "operational_record_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "lead_services_source_card_url_unique" ON "lead_services" ("source_card_url");
ALTER TABLE "regularizacoes" ADD COLUMN IF NOT EXISTS "lead_service_id" integer REFERENCES "lead_services"("id") ON DELETE set null;
ALTER TABLE "financiamentos" ADD COLUMN IF NOT EXISTS "lead_service_id" integer REFERENCES "lead_services"("id") ON DELETE set null;
ALTER TABLE "operational_projects" ADD COLUMN IF NOT EXISTS "lead_service_id" integer REFERENCES "lead_services"("id") ON DELETE set null;
