-- 16/11/2026 — EPIC-024 (S-02): logotipo próprio de cada empreendimento da Incorporação.
-- Tabela separada (nunca na linha do estudo): `getAllIncorporationStudies` lê todas as colunas do estudo e o gatilho de
-- versões copia cada UPDATE do estudo para `incorporation_study_versions` — os bytes do logotipo não podem ir junto.
-- Guarda o arquivo original (PNG, JPG, SVG ou PDF) e a imagem de exibição em PNG gerada no navegador (PDF e SVG
-- viram PNG), que é a única servida aos cartões. Um logotipo ativo por estudo (`deleted_at` nulo); trocar ou excluir
-- só marca `deleted_at` no anterior.
-- Somente aditiva e idempotente: cria uma tabela e um índice novos (IF NOT EXISTS); nada existente é alterado ou apagado.
-- Reversão: DROP TABLE "incorporation_study_logos" (nenhuma outra tabela depende dela).

CREATE TABLE IF NOT EXISTS "incorporation_study_logos" (
  "id" serial PRIMARY KEY,
  -- o logotipo sai junto com a exclusão definitiva do estudo
  "study_id" integer NOT NULL REFERENCES "incorporation_studies"("id") ON DELETE CASCADE,
  "mime" varchar(40) NOT NULL CHECK ("mime" IN ('image/png', 'image/jpeg', 'image/svg+xml', 'application/pdf')),
  "nome" varchar(255) NOT NULL,
  "origem" varchar(10) NOT NULL DEFAULT 'envio' CHECK ("origem" IN ('envio', 'ia')),
  "sha256" varchar(64) NOT NULL,
  "tamanho" integer NOT NULL CHECK ("tamanho" > 0),
  "original" bytea NOT NULL,
  "exibicao_png" bytea NOT NULL,
  -- ETag da imagem servida aos cartões
  "exibicao_sha256" varchar(64) NOT NULL,
  "largura" integer,
  "altura" integer,
  "enviado_por" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incorporation_study_logos_ativo_idx" ON "incorporation_study_logos" ("study_id") WHERE "deleted_at" IS NULL;
