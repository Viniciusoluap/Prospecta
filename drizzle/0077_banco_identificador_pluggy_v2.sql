ALTER TABLE "bank_transactions" ADD COLUMN IF NOT EXISTS "identificador_bancario" varchar(255);
CREATE INDEX IF NOT EXISTS "bank_transactions_identificador_bancario_idx" ON "bank_transactions" ("identificador_bancario");
