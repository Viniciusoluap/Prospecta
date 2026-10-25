-- Pedido de 25/10 (noite), itens 9 e 10: titular e texto original das movimentações do extrato,
-- regra de classificação por titular e vínculo do Cliente BPO com o lead do CRM.
-- Aditiva e idempotente (pode rodar mais de uma vez). Nenhum dado existente é alterado:
-- os nomes das 379 movimentações já gravadas entram ao reimportar o mesmo arquivo.
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "titular" varchar(255);--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "descricao_original" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_transactions_titular_idx" ON "bank_transactions" ("titular");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bpo_regras_titular" (
  "id" serial PRIMARY KEY NOT NULL,
  "titular_normalizado" varchar(255) NOT NULL,
  "categoria" varchar(60),
  "bpo_cliente_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bpo_regras_titular" ADD CONSTRAINT "bpo_regras_titular_titular_normalizado_unique" UNIQUE ("titular_normalizado");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bpo_regras_titular" ADD CONSTRAINT "bpo_regras_titular_bpo_cliente_id_bpo_clients_id_fk"
    FOREIGN KEY ("bpo_cliente_id") REFERENCES "public"."bpo_clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TABLE "bpo_clients" ADD COLUMN IF NOT EXISTS "lead_id" integer;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bpo_clients" ADD CONSTRAINT "bpo_clients_lead_id_leads_id_fk"
    FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bpo_clients_lead_id_idx" ON "bpo_clients" ("lead_id");
