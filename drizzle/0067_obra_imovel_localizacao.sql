-- Lote 23/10, etapa 3: "Localização exata" da obra vira um imóvel vinculado (aditiva).
-- Cada obra aponta para no máximo um imóvel e cada imóvel serve a no máximo uma obra.
ALTER TABLE "construction_projects" ADD COLUMN IF NOT EXISTS "imovel_id" integer REFERENCES "imoveis"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "construction_projects_imovel_id_unique" ON "construction_projects" ("imovel_id") WHERE "imovel_id" IS NOT NULL;
