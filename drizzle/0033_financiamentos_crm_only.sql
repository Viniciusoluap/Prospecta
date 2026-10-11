-- Lote 3 — Financiamentos originados exclusivamente no CRM.
-- Aditiva: não apaga nem invalida financiamentos legados (criados sem lead
-- vinculado). Eles continuam com imovel/tipo/banco preenchidos e editáveis
-- normalmente; só os NOVOS registros passam a nascer sem esses dados
-- técnicos, pois agora são criados automaticamente ao vincular o serviço
-- no lead (ver ensureFinanciamentoRecord em server/lead-services-router.ts).
ALTER TABLE "financiamentos" ALTER COLUMN "imovel" DROP NOT NULL;
ALTER TABLE "financiamentos" ALTER COLUMN "tipo" DROP NOT NULL;
ALTER TABLE "financiamentos" ALTER COLUMN "banco" DROP NOT NULL;

-- Idempotência: um lead_service nunca pode originar mais de um financiamento.
-- NULLs (financiamentos legados sem vínculo) não conflitam entre si.
CREATE UNIQUE INDEX IF NOT EXISTS "financiamentos_lead_service_id_unique"
  ON "financiamentos" ("lead_service_id");
