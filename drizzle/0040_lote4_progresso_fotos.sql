-- EPIC-020 Lote 4 (itens 27 e 28) — progresso por incidência e fotos no banco.
-- Somente aditiva: nenhuma coluna existente é alterada ou apagada.
-- Progresso: 20 serviços por obra (incidência × execução) + histórico de medições.
CREATE TABLE IF NOT EXISTS "construction_progress_items" (
  "project_id" integer NOT NULL REFERENCES "construction_projects"("id") ON DELETE CASCADE,
  "service_key" varchar(40) NOT NULL,
  "incidence_pct" numeric(7, 4) NOT NULL,
  "execution_pct" numeric(7, 4) NOT NULL DEFAULT 0,
  "updated_by" integer,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("project_id", "service_key"),
  CONSTRAINT "construction_progress_items_incidence_range" CHECK ("incidence_pct" >= 0 AND "incidence_pct" <= 100),
  CONSTRAINT "construction_progress_items_execution_range" CHECK ("execution_pct" >= 0 AND "execution_pct" <= 100)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "construction_progress_history" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL REFERENCES "construction_projects"("id") ON DELETE CASCADE,
  "progress_pct" numeric(9, 6) NOT NULL,
  "incidence_total_pct" numeric(9, 4) NOT NULL,
  "items" jsonb NOT NULL,
  "created_by" integer,
  "created_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "construction_progress_history_project_idx" ON "construction_progress_history" ("project_id", "created_at");--> statement-breakpoint
-- Progresso Geral medido com 6 casas (o inteiro "progress" segue para telas antigas).
ALTER TABLE "construction_projects" ADD COLUMN IF NOT EXISTS "progress_measured_pct" numeric(9, 6);--> statement-breakpoint
-- Fotos: bytes no próprio banco (o storage externo nunca gravou nenhuma foto em produção).
CREATE TABLE IF NOT EXISTS "construction_photo_files" (
  "photo_id" integer PRIMARY KEY REFERENCES "construction_photos"("id") ON DELETE CASCADE,
  "mime" varchar(40) NOT NULL,
  "size_bytes" integer NOT NULL,
  "data" bytea NOT NULL
);--> statement-breakpoint
ALTER TABLE "construction_photos" ADD COLUMN IF NOT EXISTS "include_in_report" boolean NOT NULL DEFAULT true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "construction_photos_project_idx" ON "construction_photos" ("project_id", "taken_at");
