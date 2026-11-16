-- 16/11/2026 — EPIC-023 (S-I): APP com o contorno real no Estudo de Massa. Guarda no estudo o contorno da APP que o
-- mapa do Terreno calcula (MultiPolygon GeoJSON em longitude/latitude, já recortado pelo terreno), para o motor do
-- Estudo de Massa tirar a APP da área loteável pela posição real, e não só pelo tamanho em m².
-- Somente aditiva e idempotente: cria uma coluna nova, nula (IF NOT EXISTS); nada existente é alterado ou apagado.
-- Reversão: ALTER TABLE "incorporation_studies" DROP COLUMN "app_geometry_json" (nenhuma outra coluna depende dela).

ALTER TABLE "incorporation_studies" ADD COLUMN IF NOT EXISTS "app_geometry_json" text;
