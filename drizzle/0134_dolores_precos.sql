-- 19/11/2026 — EPIC-025 (etapa 8, respostas longas e custo): estimativa do gasto da IA POR MODELO e por tipo de token.
-- (Número 0134: a 0133 é da etapa 7 — 0133_dolores_grupos_tipo.sql; a 0132 já é a de consentimentos.)
-- "dolores_precos_modelo": uma linha por modelo, com os 4 preços em US$ por milhão de tokens (entrada, saída, escrita de cache,
--   leitura de cache), TODOS informados pelo administrador na tela (o sistema não inventa preço). Escrita/leitura de cache vazias
--   = o sistema assume 1,25× e 0,1× do preço de entrada (e a tela diz isso). Entrada ou saída vazia = modelo sem preço (a
--   estimativa usa a reserva). Não há exclusão pela tela: "tirar o preço" é deixar os campos vazios.
-- "dolores_cotacao": linha única (id = 1) com a cotação do dólar (R$ por US$) informada pelo administrador; vazia = sem R$.
-- Os dois campos antigos de preço único (dolores_operacao_config.preco_entrada_milhao / preco_saida_milhao, R$ por milhão)
--   continuam existindo e viram RESERVA: só valem para modelo sem preço cadastrado. Nada é alterado neles.
-- Só configuração: nada aqui muda o limite mensal de tokens (a trava de segurança continua em dolores_whatsapp_config).
-- Somente aditiva e idempotente: CREATE TABLE IF NOT EXISTS e a linha da cotação com ON CONFLICT DO NOTHING. Nenhuma tabela
-- existente é alterada. Quem alterou fica em "atualizado_por" com ON DELETE SET NULL (tabelas sem gatilho de só inserção).
-- Reversão: DROP TABLE "dolores_precos_modelo", "dolores_cotacao" (nada fora da etapa 8 depende delas).

CREATE TABLE IF NOT EXISTS "dolores_precos_modelo" (
  -- id do modelo como a Anthropic o devolve (ex.: claude-haiku-5-5)
  "modelo" varchar(120) PRIMARY KEY NOT NULL CHECK (length(trim("modelo")) > 0),
  "entrada_milhao_usd" numeric(12, 4) CHECK ("entrada_milhao_usd" IS NULL OR "entrada_milhao_usd" >= 0),
  "saida_milhao_usd" numeric(12, 4) CHECK ("saida_milhao_usd" IS NULL OR "saida_milhao_usd" >= 0),
  "cache_escrita_milhao_usd" numeric(12, 4) CHECK ("cache_escrita_milhao_usd" IS NULL OR "cache_escrita_milhao_usd" >= 0),
  "cache_leitura_milhao_usd" numeric(12, 4) CHECK ("cache_leitura_milhao_usd" IS NULL OR "cache_leitura_milhao_usd" >= 0),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "dolores_cotacao" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  -- R$ por US$ (ex.: 5.4000); vazio = sem estimativa em reais pela tabela de preços
  "cotacao_dolar" numeric(8, 4) CHECK ("cotacao_dolar" IS NULL OR "cotacao_dolar" > 0),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);

INSERT INTO "dolores_cotacao" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
