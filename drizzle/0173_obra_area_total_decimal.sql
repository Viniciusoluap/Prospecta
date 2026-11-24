-- 24/11/2026 — pedido do dono: a Área Total da obra precisa aceitar casas decimais (ex.: 166,56 m²). A coluna era INTEGER e a
-- tela cortava o valor para 166.
--
-- Alargamento SEM PERDA: todo inteiro já gravado cabe exatamente em double precision; nenhum valor existente muda.
-- Idempotente: rodar de novo com a coluna já em double precision não altera nada.
-- Reversão (só com o dono, pois arredondaria os decimais): ALTER COLUMN total_area TYPE integer USING round(total_area)::integer.
ALTER TABLE construction_projects ALTER COLUMN total_area TYPE double precision;
