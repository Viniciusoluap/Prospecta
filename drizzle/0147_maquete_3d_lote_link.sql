-- 22/11/2026 — EPIC-028 (Etapa 4): página pública por lote (/maquete/<empreendimento>/<lote>-<código>). Maquete 3D é
-- exceção de paridade registrada no ROADMAP (nada a portar ao Grupo Santa Fé).
-- Somente aditiva e idempotente (pode rodar duas vezes): colunas novas em "maquete_3d_lotes" (ADD COLUMN IF NOT EXISTS),
-- regras CHECK novas (recriadas com DROP CONSTRAINT IF EXISTS + ADD, só valem para as colunas novas, que nascem vazias)
-- e um índice novo (IF NOT EXISTS). Nenhuma coluna, tabela ou dado existente é apagado ou alterado.
-- Depende da 0146 (tabela "maquete_3d_lotes").
-- Reversão: DROP INDEX "maquete_3d_lotes_codigo_idx"; ALTER TABLE "maquete_3d_lotes" DROP COLUMN "codigo_link",
-- DROP COLUMN "empreendimento_nome", DROP COLUMN "quadra", DROP COLUMN "lote_numero" (nada depende delas).

-- Código não adivinhável do endereço público (10 letras/números aleatórios). null = lote sem link (página não abre).
-- Regenerar troca o código: o link antigo para de abrir na hora.
ALTER TABLE "maquete_3d_lotes" ADD COLUMN IF NOT EXISTS "codigo_link" varchar(24);
-- Textos mostrados ao cliente (ex.: "Vila Esmeralda", "18", "4").
ALTER TABLE "maquete_3d_lotes" ADD COLUMN IF NOT EXISTS "empreendimento_nome" varchar(120);
ALTER TABLE "maquete_3d_lotes" ADD COLUMN IF NOT EXISTS "quadra" varchar(20);
ALTER TABLE "maquete_3d_lotes" ADD COLUMN IF NOT EXISTS "lote_numero" varchar(20);

ALTER TABLE "maquete_3d_lotes" DROP CONSTRAINT IF EXISTS "maquete_3d_lotes_codigo_ck";
ALTER TABLE "maquete_3d_lotes" ADD CONSTRAINT "maquete_3d_lotes_codigo_ck" CHECK ("codigo_link" IS NULL OR "codigo_link" ~ '^[a-z0-9]{10,24}$');
CREATE UNIQUE INDEX IF NOT EXISTS "maquete_3d_lotes_codigo_idx" ON "maquete_3d_lotes" ("codigo_link") WHERE "codigo_link" IS NOT NULL;
