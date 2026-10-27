-- Correções 09 e 12 (26/10/2026): limpeza segura de contas e edição auditável.
-- Aditiva/idempotente; não altera nem remove dados existentes.
ALTER TABLE "bpo_lancamentos" ADD COLUMN IF NOT EXISTS "observacoes" text;
ALTER TABLE "bpo_lancamentos" ADD COLUMN IF NOT EXISTS "origem_efetiva" varchar(30) DEFAULT 'manual' NOT NULL;
ALTER TABLE "bpo_lancamentos" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "bpo_lancamentos" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;

UPDATE "bpo_lancamentos"
SET "origem_efetiva" = CASE
  WHEN "asaas_payment_id" IS NOT NULL THEN 'asaas'
  WHEN "bank_transaction_id" IS NOT NULL THEN 'extrato'
  ELSE 'manual'
END
WHERE "origem_efetiva" = 'manual';

CREATE TABLE IF NOT EXISTS "bpo_lancamento_historico" (
  "id" serial PRIMARY KEY NOT NULL,
  "lancamento_id" integer,
  "lancamento_referencia" integer NOT NULL,
  "versao_anterior" integer NOT NULL,
  "alterado_por_user_id" integer,
  "motivo" text NOT NULL,
  "antes_json" text NOT NULL,
  "depois_json" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
DO $$ BEGIN
  ALTER TABLE "bpo_lancamento_historico" ADD CONSTRAINT "bpo_lancamento_historico_lancamento_id_fk"
    FOREIGN KEY ("lancamento_id") REFERENCES "public"."bpo_lancamentos"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "bpo_lancamento_historico" ADD CONSTRAINT "bpo_lancamento_historico_user_id_fk"
    FOREIGN KEY ("alterado_por_user_id") REFERENCES "public"."users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "bpo_lancamento_historico_ref_idx" ON "bpo_lancamento_historico" ("lancamento_referencia", "created_at");

CREATE TABLE IF NOT EXISTS "bpo_conta_limpeza_backups" (
  "id" serial PRIMARY KEY NOT NULL,
  "conta_referencia" integer NOT NULL,
  "conta_rotulo" varchar(255) NOT NULL,
  "snapshot_json" text NOT NULL,
  "transacoes" integer NOT NULL,
  "lancamentos_removidos" integer NOT NULL,
  "lancamentos_preservados" integer NOT NULL,
  "criado_por_user_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);
DO $$ BEGIN
  ALTER TABLE "bpo_conta_limpeza_backups" ADD CONSTRAINT "bpo_conta_limpeza_backups_user_id_fk"
    FOREIGN KEY ("criado_por_user_id") REFERENCES "public"."users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "bpo_conta_limpeza_backups_conta_idx" ON "bpo_conta_limpeza_backups" ("conta_referencia", "created_at");
