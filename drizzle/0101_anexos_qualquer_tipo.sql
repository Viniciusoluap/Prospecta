-- 11/11/2026: anexos da Due Diligence/registro aceitam qualquer tipo de arquivo
-- (foto, DWG, Word...). Só amplia a coluna do tipo e cria a área temporária
-- das partes do envio (a Vercel limita cada requisição a ~4,5 MB). Nada é apagado.
ALTER TABLE "incorporation_registration_documents" ALTER COLUMN "mime_type" TYPE varchar(120);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incorporation_upload_parts" (
  "upload_id" varchar(64) NOT NULL,
  "part" integer NOT NULL,
  "study_id" integer NOT NULL REFERENCES "incorporation_studies"("id") ON DELETE CASCADE,
  "item_id" varchar(120) NOT NULL,
  "user_id" integer NOT NULL,
  "data" bytea NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("upload_id", "part")
);
