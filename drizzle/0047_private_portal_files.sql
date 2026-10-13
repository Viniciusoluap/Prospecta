-- EPIC-020 Lote 7: fallback privado em banco, sem URL pública ou storage Forge.
-- Tabelas com FK evitam arquivos órfãos ao remover o registro pai.
CREATE TABLE IF NOT EXISTS "financiamento_checklist_file_data" (
  "checklist_item_id" integer PRIMARY KEY REFERENCES "financiamento_checklist_items"("id") ON DELETE CASCADE,
  "mime" varchar(120) NOT NULL,
  "size_bytes" integer NOT NULL,
  "data" bytea NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "portal_contract_file_data" (
  "document_id" integer PRIMARY KEY REFERENCES "portal_contract_documents"("id") ON DELETE CASCADE,
  "mime" varchar(120) NOT NULL,
  "size_bytes" integer NOT NULL,
  "data" bytea NOT NULL
);
