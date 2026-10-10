-- Preserve the original stage of each legacy row before any classification.
-- The six ambiguous stages are deliberately left intact for administrator review.
-- PostgreSQL does not permit using enum values added in the same transaction.
-- Convert this single commercial-stage column to bounded text; the historic
-- enum and its existing data remain available for recovery.
ALTER TABLE "leads" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "leads" ALTER COLUMN "stage" TYPE varchar(40) USING "stage"::text;
ALTER TABLE "leads" ALTER COLUMN "stage" SET DEFAULT 'lead_new';

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "legacy_stage" varchar(40),
  ADD COLUMN IF NOT EXISTS "stage_classification_pending" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp,
  ADD COLUMN IF NOT EXISTS "deleted_by_user_id" integer;

UPDATE "leads"
SET "legacy_stage" = "stage"::text
WHERE "legacy_stage" IS NULL;

UPDATE "leads"
SET "stage_classification_pending" = true
WHERE "stage"::text IN ('waiting_docs', 'analysis', 'caixa_register', 'approval', 'rejected', 'in_process')
  AND "stage_classification_pending" = false;

UPDATE "leads" SET "stage" = 'approved_projects' WHERE "stage"::text = 'approved';
UPDATE "leads" SET "stage" = 'finalized' WHERE "stage"::text = 'done';

DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_allowed_ck"
    CHECK ("stage" IN (
      'lead_new', 'attending', 'approved_projects', 'followup',
      'contracts_registry', 'measurements', 'finalized',
      'waiting_docs', 'analysis', 'caixa_register', 'approval', 'rejected', 'in_process'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "leads" ADD CONSTRAINT "leads_deleted_by_user_id_users_id_fk"
    FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "leads_deleted_at_idx" ON "leads" ("deleted_at");
CREATE INDEX IF NOT EXISTS "leads_stage_classification_pending_idx" ON "leads" ("stage_classification_pending")
  WHERE "stage_classification_pending" = true;
