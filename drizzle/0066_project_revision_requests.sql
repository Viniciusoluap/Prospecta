-- Lote 23/10, etapa 2C: pedidos de revisão de projeto (aditiva, idempotente).
CREATE TABLE IF NOT EXISTS "project_revision_requests" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL REFERENCES "operational_projects"("id") ON DELETE CASCADE,
  "requested_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "requested_by_name" varchar(255) NOT NULL,
  "request_text" text NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pendente',
  "engineer_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "notification_status" varchar(20) NOT NULL,
  "email_status" varchar(20) NOT NULL,
  "deliveries" text NOT NULL DEFAULT '[]',
  "delivered_at" timestamp,
  "delivered_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "project_revision_requests_project_idx" ON "project_revision_requests" ("project_id", "created_at" DESC);
