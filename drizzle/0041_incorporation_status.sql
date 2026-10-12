-- EPIC-020 Lote 5, item 01. Estados antigos permanecem intactos para
-- classificação administrativa quando não houver correspondência inequívoca.
-- O inventário de produção antes desta mudança encontrou apenas in_study.
ALTER TABLE "incorporation_studies"
  ALTER COLUMN "status" SET DEFAULT 'in_study';
