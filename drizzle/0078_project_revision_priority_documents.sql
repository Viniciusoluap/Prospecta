-- Correção 16: revisão prioritária e documentos de projeto normalizados/versionados.
ALTER TABLE "project_revision_requests"
  ADD COLUMN IF NOT EXISTS "previous_project_status" varchar(40);

CREATE TABLE IF NOT EXISTS "project_documents" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL REFERENCES "operational_projects"("id") ON DELETE CASCADE,
  "revision_id" integer REFERENCES "project_revision_requests"("id") ON DELETE SET NULL,
  "item_id" varchar(100) NOT NULL,
  "kind" varchar(20) NOT NULL CHECK ("kind" IN ('pdf', 'editable')),
  "original_name" varchar(255) NOT NULL,
  "canonical_name" varchar(255) NOT NULL,
  "mime" varchar(150) NOT NULL,
  "size" integer NOT NULL CHECK ("size" > 0),
  "version" integer NOT NULL CHECK ("version" > 0),
  "drive_file_id" varchar(200),
  "url" text,
  "status" varchar(20) NOT NULL DEFAULT 'uploading' CHECK ("status" IN ('uploading', 'active', 'substituted', 'deleted', 'failed')),
  "replaced_by_id" integer REFERENCES "project_documents"("id") ON DELETE SET NULL,
  "uploaded_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "project_documents_project_item_kind_version_uq"
  ON "project_documents" ("project_id", "item_id", "kind", "version");
CREATE INDEX IF NOT EXISTS "project_documents_active_idx"
  ON "project_documents" ("project_id", "item_id", "kind", "status");
