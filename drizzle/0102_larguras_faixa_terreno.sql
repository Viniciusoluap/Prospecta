-- 11/11/2026: larguras de faixa (servidão/domínio) confirmadas pelo dono no mapa do terreno.
-- Só acrescenta uma coluna opcional; nada existente é alterado ou apagado.
ALTER TABLE "incorporation_studies" ADD COLUMN IF NOT EXISTS "terrain_widths_json" text;
