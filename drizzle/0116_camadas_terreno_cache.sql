-- 15/11/2026 — EPIC-023 (S-E): camadas do mapa do terreno resilientes. Guarda o último resultado bom ("ok" ou
-- "vazio") de cada camada por terreno, com a data, para o mapa mostrar quando a fonte pública estiver fora do ar.
-- Somente aditiva e idempotente: cria uma tabela nova (IF NOT EXISTS); nada existente é alterado ou apagado.
-- Reversão: DROP TABLE "camadas_terreno_cache" (nenhuma outra tabela depende dela).

CREATE TABLE IF NOT EXISTS "camadas_terreno_cache" (
  -- chaveDoTerreno(contorno): bbox arredondado + nº de vértices
  "chave_terreno" varchar(160) NOT NULL,
  "camada" varchar(30) NOT NULL,
  "estado" varchar(20) NOT NULL CHECK ("estado" IN ('ok', 'vazio')),
  "fonte" text NOT NULL,
  -- EstadoCamada completo em JSON
  "dados" text NOT NULL,
  "salvo_em" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("chave_terreno", "camada")
);
