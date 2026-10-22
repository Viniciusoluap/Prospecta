ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "card_due_date" date;
CREATE INDEX IF NOT EXISTS "leads_card_due_date_idx" ON "leads" ("card_due_date") WHERE "deleted_at" IS NULL;
CREATE TABLE IF NOT EXISTS "lead_card_due_alerts" (
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "lead_id" integer NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "due_date" date NOT NULL,
  "channel" varchar(12) NOT NULL,
  "sent_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "lead_id", "due_date", "channel")
);
CREATE TABLE IF NOT EXISTS "lead_card_due_digest_claims" (
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "digest_date" date NOT NULL,
  "claimed_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "digest_date")
);
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "lead_service_id" integer REFERENCES "lead_services"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_lead_service_id_unique" ON "tasks" ("lead_service_id");
