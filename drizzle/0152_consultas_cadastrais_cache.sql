-- 22/11/2026 — EPIC-029 (Módulo Fiscal), etapa 1 "cadastro automático por CNPJ e CEP".
-- Story: docs/stories/epics/epic-029-modulo-fiscal/S-1-brasil-api.md.
--
-- "consultas_cadastrais_cache": guarda por 30 dias o resultado JÁ LIMPO (não a resposta bruta) das consultas gratuitas
--   de CNPJ (Brasil API) e de CEP (Brasil API, com o ViaCEP de reserva), para não repetir a mesma consulta na rede.
--   - "tipo": 'cnpj' ou 'cep';
--   - "chave": o CNPJ (14 caracteres; o novo CNPJ alfanumérico usa letras) ou o CEP (8 números), só os caracteres;
--   - "resposta": razão social, nome fantasia, situação, CNAE principal e endereço (CNPJ) ou logradouro, bairro,
--     cidade, UF e código IBGE (CEP) — dados públicos da Receita/Correios; nada digitado pelo usuário entra aqui;
--   - "fonte": 'brasilapi' ou 'viacep'; "consultado_em": quando veio da rede (vale 30 dias, conferido pelo servidor).
--   Uma linha por (tipo, chave): a consulta nova substitui a antiga. Só o servidor lê e grava.
--
-- Somente ADITIVA e IDEMPOTENTE (CREATE ... IF NOT EXISTS). Nenhuma tabela existente muda; nenhum dado é alterado.
-- Reversão: DROP TABLE "consultas_cadastrais_cache" (sem ela, toda consulta vai à rede; o cadastro continua funcionando).

CREATE TABLE IF NOT EXISTS "consultas_cadastrais_cache" (
  "id" serial PRIMARY KEY,
  "tipo" varchar(10) NOT NULL CHECK ("tipo" IN ('cnpj', 'cep')),
  "chave" varchar(14) NOT NULL CHECK (
    ("tipo" = 'cnpj' AND "chave" ~ '^[0-9A-Z]{12}[0-9]{2}$') OR ("tipo" = 'cep' AND "chave" ~ '^[0-9]{8}$')
  ),
  "resposta" jsonb NOT NULL,
  "fonte" varchar(10) NOT NULL DEFAULT 'brasilapi' CHECK ("fonte" IN ('brasilapi', 'viacep')),
  "consultado_em" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "consultas_cadastrais_cache_tipo_chave_uq" ON "consultas_cadastrais_cache" ("tipo", "chave");
CREATE INDEX IF NOT EXISTS "consultas_cadastrais_cache_consultado_em_idx" ON "consultas_cadastrais_cache" ("consultado_em");
