-- 10 implementações, item 09: quando o Google Drive recusa a gravação, o
-- documento fica guardado no próprio banco (privado, servido só pela API
-- autenticada). `storage` diz onde está o arquivo; nada existente muda.
ALTER TABLE "lead_documents" ADD COLUMN IF NOT EXISTS "storage" varchar(10) DEFAULT 'drive' NOT NULL;--> statement-breakpoint
ALTER TABLE "incorporation_registration_documents" ADD COLUMN IF NOT EXISTS "storage" varchar(10) DEFAULT 'drive' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_documents" ADD COLUMN IF NOT EXISTS "storage_note" varchar(400);--> statement-breakpoint
ALTER TABLE "incorporation_registration_documents" ADD COLUMN IF NOT EXISTS "storage_note" varchar(400);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_document_file_data" (
  "document_id" integer PRIMARY KEY REFERENCES "lead_documents"("id") ON DELETE CASCADE,
  "mime" varchar(120) NOT NULL,
  "size_bytes" integer NOT NULL,
  "data" bytea NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incorporation_registration_file_data" (
  "document_id" integer PRIMARY KEY REFERENCES "incorporation_registration_documents"("id") ON DELETE CASCADE,
  "mime" varchar(120) NOT NULL,
  "size_bytes" integer NOT NULL,
  "data" bytea NOT NULL
);
