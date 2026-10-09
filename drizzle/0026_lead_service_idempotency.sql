-- Não altera vínculos anteriores. A chave só é preenchida em novas associações.
ALTER TABLE "lead_services" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(120);
CREATE UNIQUE INDEX IF NOT EXISTS "lead_services_idempotency_key_unique"
  ON "lead_services" ("idempotency_key");
