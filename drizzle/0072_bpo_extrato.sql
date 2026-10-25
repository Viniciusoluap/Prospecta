-- LOTE C (25/10): extrato bancário alimentando o BPO Financeiro. Aditiva e idempotente.
-- Cada movimentação bancária gera um lançamento pago no BPO (vínculo 1:1 por
-- bpo_lancamentos.bank_transaction_id), com categoria e Cliente BPO opcional.
-- Os lançamentos das movimentações já gravadas são gerados pelo botão
-- "Reprocessar movimentações" (BPO › Bancos), não por esta migração.
ALTER TYPE "bpo_lancamento_tipo" ADD VALUE IF NOT EXISTS 'receita';--> statement-breakpoint

ALTER TABLE "bpo_lancamentos" ADD COLUMN IF NOT EXISTS "categoria" varchar(60);--> statement-breakpoint
ALTER TABLE "bpo_lancamentos" ADD COLUMN IF NOT EXISTS "bank_transaction_id" integer;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bpo_lancamentos" ADD CONSTRAINT "bpo_lancamentos_bank_transaction_id_unique" UNIQUE ("bank_transaction_id");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bpo_lancamentos" ADD CONSTRAINT "bpo_lancamentos_bank_transaction_id_bank_transactions_id_fk"
    FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "bpo_cliente_id" integer;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bpo_cliente_id_bpo_clients_id_fk"
    FOREIGN KEY ("bpo_cliente_id") REFERENCES "public"."bpo_clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "saldo_fonte" varchar(20);
