-- Metadados de arquivos privados no Google Drive. Nenhum dado existente é removido.
ALTER TABLE "lead_documents"
  ADD COLUMN IF NOT EXISTS "service_id" integer,
  ADD COLUMN IF NOT EXISTS "drive_file_id" text,
  ADD COLUMN IF NOT EXISTS "mime_type" varchar(120),
  ADD COLUMN IF NOT EXISTS "file_size" integer,
  ADD COLUMN IF NOT EXISTS "sha256" varchar(64),
  ADD COLUMN IF NOT EXISTS "uploaded_by_user_id" integer,
  ADD COLUMN IF NOT EXISTS "deleted_by_user_id" integer,
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

DO $$ BEGIN
  ALTER TABLE "lead_documents" ADD CONSTRAINT "lead_documents_service_id_fk"
    FOREIGN KEY ("service_id") REFERENCES "public"."lead_services"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "lead_documents" ADD CONSTRAINT "lead_documents_uploaded_by_user_id_fk"
    FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "lead_documents" ADD CONSTRAINT "lead_documents_deleted_by_user_id_fk"
    FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "lead_documents_lead_active_idx" ON "lead_documents" ("lead_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "lead_documents_drive_file_id_idx" ON "lead_documents" ("drive_file_id");
