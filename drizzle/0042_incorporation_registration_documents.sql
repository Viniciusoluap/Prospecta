-- Histórico append-only dos anexos do checklist de registro. Eventos de
-- desvinculação preservam o arquivo e a autoria para auditoria e recuperação.
CREATE TABLE IF NOT EXISTS "incorporation_registration_documents" (
  "id" serial PRIMARY KEY,
  "study_id" integer NOT NULL REFERENCES "incorporation_studies"("id") ON DELETE RESTRICT,
  "item_id" varchar(120) NOT NULL,
  "action" varchar(12) NOT NULL CHECK ("action" IN ('uploaded', 'unlinked')),
  "drive_file_id" text,
  "file_name" varchar(255),
  "mime_type" varchar(40),
  "file_size" integer,
  "sha256" varchar(64),
  "performed_by_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "incorporation_registration_documents_payload_chk" CHECK (
    ("action" = 'uploaded' AND "drive_file_id" IS NOT NULL AND "file_name" IS NOT NULL AND "mime_type" IS NOT NULL AND "file_size" IS NOT NULL AND "sha256" IS NOT NULL)
    OR ("action" = 'unlinked' AND "drive_file_id" IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS "incorporation_registration_documents_study_item_idx"
  ON "incorporation_registration_documents" ("study_id", "item_id", "id" DESC);
