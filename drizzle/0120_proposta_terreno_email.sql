-- 16/11/2026 — EPIC-024 (S-06): proposta formal de aquisição do terreno enviada por e-mail com o PDF.
-- 1) Tipo próprio em email_logs ('proposta_terreno'). O valor novo não é usado nesta migração (ADD VALUE não pode ser
--    usado na mesma transação em que é criado).
-- 2) Registro de cada envio (data, destinatário, situação, motivo da falha, hash do PDF) em tabela própria — fora do
--    JSON da negociação, que o salvamento automático da aba reescreve.
-- Somente aditiva e idempotente: novo valor de enum (IF NOT EXISTS) e tabela/índice novos (IF NOT EXISTS); nada
-- existente é alterado ou apagado.
-- Reversão: DROP TABLE "incorporation_proposal_sends" (o valor do enum pode ficar; nenhum dado depende dele).

ALTER TYPE "email_template_type" ADD VALUE IF NOT EXISTS 'proposta_terreno';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incorporation_proposal_sends" (
  "id" serial PRIMARY KEY,
  "study_id" integer NOT NULL REFERENCES "incorporation_studies"("id") ON DELETE CASCADE,
  -- id da proposta dentro de land_negotiation_json
  "proposta_id" varchar(80) NOT NULL,
  "destinatario" varchar(254) NOT NULL,
  "status" varchar(10) NOT NULL CHECK ("status" IN ('enviado', 'falhou')),
  "motivo" varchar(400),
  "data_emissao" date NOT NULL,
  "pdf_sha256" varchar(64) NOT NULL,
  "enviado_por" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "enviado_por_nome" varchar(255),
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incorporation_proposal_sends_estudo_idx" ON "incorporation_proposal_sends" ("study_id", "proposta_id");
