-- Pedido de 25/10: contas bancárias por provedor (Asaas, Pluggy/Meu Pluggy, manual/importação),
-- chave da API por conta (criptografada), data inicial (movimentações anteriores não pertencem
-- a esta empresa) e origem de cada transação. Aditiva.
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "provedor" varchar(20) DEFAULT 'manual' NOT NULL;
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "credencial_encrypted" text;
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "data_inicial" date;
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "ultimo_erro" text;
ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "origem" varchar(20) DEFAULT 'manual' NOT NULL;
UPDATE "bank_accounts" SET "provedor" = 'pluggy' WHERE "pluggy_account_id" IS NOT NULL AND "provedor" = 'manual';
