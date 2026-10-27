ALTER TABLE "bpo_lancamentos" ADD COLUMN IF NOT EXISTS "categoria_operacional" varchar(40);
ALTER TABLE "bpo_lancamentos" ADD COLUMN IF NOT EXISTS "vinculo_operacional_id" varchar(80);
ALTER TABLE "bpo_lancamentos" ADD COLUMN IF NOT EXISTS "vinculo_operacional_rotulo" varchar(255);
ALTER TABLE "bpo_lancamentos" ADD COLUMN IF NOT EXISTS "tipo_despesa_obra" varchar(30);
ALTER TABLE "bpo_lancamentos" ADD COLUMN IF NOT EXISTS "etapa_obra" varchar(80);

CREATE INDEX IF NOT EXISTS "bpo_lancamentos_vinculo_operacional_idx"
  ON "bpo_lancamentos" ("categoria_operacional", "vinculo_operacional_id");
CREATE INDEX IF NOT EXISTS "bpo_clients_lead_id_idx" ON "bpo_clients" ("lead_id");

ALTER TABLE "bpo_lancamentos" DROP CONSTRAINT IF EXISTS "bpo_lancamentos_tipo_despesa_obra_check";
ALTER TABLE "bpo_lancamentos" ADD CONSTRAINT "bpo_lancamentos_tipo_despesa_obra_check"
  CHECK ("tipo_despesa_obra" IS NULL OR "tipo_despesa_obra" IN
    ('empreiteiro','terreno','comissao','fornecedor','outros','mao_de_obra','material'));
