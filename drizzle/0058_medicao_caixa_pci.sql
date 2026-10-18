-- Pedido de 18/10: PCI da CAIXA por obra, tipo/dados da medição (PLS,
-- Repactuação, Alteração de Projeto), fotos ligadas à medição e incidência com
-- todas as casas da PCI. Só acrescenta (alargar numeric não perde valores).
CREATE TABLE IF NOT EXISTS "construction_pci" (
  "project_id" integer PRIMARY KEY REFERENCES "construction_projects"("id") ON DELETE CASCADE,
  "file_name" varchar(255) NOT NULL,
  "size_bytes" integer NOT NULL,
  "data" bytea NOT NULL,
  "parsed" jsonb NOT NULL,
  "uploaded_by" integer,
  "uploaded_at" timestamp DEFAULT now() NOT NULL,
  "linked_at" timestamp,
  "linked_by" integer
);
--> statement-breakpoint
ALTER TABLE "construction_progress_items" ALTER COLUMN "incidence_pct" TYPE numeric(20,15);
--> statement-breakpoint
ALTER TABLE "construction_progress_history" ALTER COLUMN "incidence_total_pct" TYPE numeric(20,15);
--> statement-breakpoint
ALTER TABLE "construction_progress_history" ADD COLUMN IF NOT EXISTS "measurement_type" varchar(20) DEFAULT 'pls' NOT NULL;
--> statement-breakpoint
ALTER TABLE "construction_progress_history" ADD COLUMN IF NOT EXISTS "caixa_data" jsonb;
--> statement-breakpoint
ALTER TABLE "construction_photos" ADD COLUMN IF NOT EXISTS "progress_history_id" integer REFERENCES "construction_progress_history"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "construction_photos_progress_history_idx" ON "construction_photos" ("progress_history_id");
