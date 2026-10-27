-- Lote 2, correção 03 (AD-06): Gerador de PCI.
-- Modelos oficiais da PCI (CAIXA) versionados e PCIs geradas por obra.
-- Arquivos guardados no próprio banco (bytea), lidos/gravados só por SQL
-- explícito em server/pci-gerador.ts e servidos por rota autenticada.
-- Aditiva e idempotente. Não altera o envio de PCI da obra (construction_pci*).

CREATE TABLE IF NOT EXISTS "pci_models" (
  "id" serial PRIMARY KEY,
  "version" integer NOT NULL UNIQUE CHECK ("version" >= 1),
  "file_name" varchar(255) NOT NULL,
  "format" varchar(5) NOT NULL CHECK ("format" IN ('xls', 'xlsm', 'xlsb')),
  "size_bytes" integer NOT NULL CHECK ("size_bytes" BETWEEN 1 AND 8388608),
  "checksum" varchar(64) NOT NULL,
  "data" bytea NOT NULL CHECK (octet_length("data") BETWEEN 1 AND 8388608),
  "is_current" boolean NOT NULL DEFAULT false,
  "notes" text,
  "uploaded_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "uploaded_at" timestamp NOT NULL DEFAULT now()
);
-- No máximo um modelo atual.
CREATE UNIQUE INDEX IF NOT EXISTS "pci_models_current_uidx" ON "pci_models" ("is_current") WHERE "is_current";

-- Rascunho do formulário do gerador (um por obra).
CREATE TABLE IF NOT EXISTS "pci_generator_drafts" (
  "project_id" integer PRIMARY KEY REFERENCES "construction_projects"("id") ON DELETE CASCADE,
  "form_data" jsonb NOT NULL,
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- PCIs geradas (histórico por obra): dados do formulário, planilha e PDF.
CREATE TABLE IF NOT EXISTS "pci_generated" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL REFERENCES "construction_projects"("id") ON DELETE CASCADE,
  "model_id" integer REFERENCES "pci_models"("id") ON DELETE SET NULL,
  "model_version" integer NOT NULL,
  "form_data" jsonb NOT NULL,
  "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "sheet_file_name" varchar(255) NOT NULL,
  "sheet_format" varchar(5) NOT NULL CHECK ("sheet_format" IN ('xls', 'xlsm')),
  "sheet_data" bytea NOT NULL,
  "pdf_file_name" varchar(255) NOT NULL,
  "pdf_data" bytea NOT NULL,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "pci_generated_project_idx" ON "pci_generated" ("project_id", "created_at" DESC);

ALTER TABLE "pci_models" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pci_generator_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pci_generated" ENABLE ROW LEVEL SECURITY;
