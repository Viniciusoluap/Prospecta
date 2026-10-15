-- Pedido de 15/10: fotos de imóveis no Google Drive
-- (Imóveis/<Título (nº id)>/01 - Fotos). "data" só guarda a foto quando o Drive
-- está indisponível; o "Testar Google Drive" envia essas pendentes depois.
CREATE TABLE IF NOT EXISTS "imovel_fotos" (
  "id" serial PRIMARY KEY,
  "imovel_id" integer NOT NULL REFERENCES "imoveis"("id") ON DELETE CASCADE,
  "mime" varchar(40) NOT NULL,
  "size_bytes" integer NOT NULL,
  "drive_file_id" varchar(255),
  "data" bytea,
  "created_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "imovel_fotos_origem" CHECK ("drive_file_id" IS NOT NULL OR "data" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "imovel_fotos_imovel_idx" ON "imovel_fotos" ("imovel_id");
