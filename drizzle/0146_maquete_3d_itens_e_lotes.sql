-- 21/11/2026 — EPIC-028 (Etapa 3): itens editáveis da maquete (móveis, bancadas, balcão) versionados, com rascunho ×
-- publicado, e a ligação lote → maquete (a página pública por lote é da Etapa 4). Maquete 3D é exceção de paridade
-- registrada no ROADMAP (nada a portar ao Grupo Santa Fé).
-- Somente aditiva e idempotente (pode rodar duas vezes): colunas novas (ADD COLUMN IF NOT EXISTS), tabelas novas
-- (CREATE TABLE IF NOT EXISTS), índices novos (IF NOT EXISTS), gatilhos recriados (DROP TRIGGER IF EXISTS + CREATE).
-- As duas regras CHECK de origem da maquete são recriadas com a lista anterior + 'fonte' (toda linha existente continua
-- válida: 'projeto' e 'incorporacao' seguem com as mesmas condições). Nenhuma coluna, tabela ou dado existente é apagado.
-- Reversão: DROP TABLE "maquete_3d_lotes", "maquete_3d_itens"; DROP FUNCTION maquete_3d_itens_imutavel();
-- ALTER TABLE "maquetes_3d" DROP COLUMN "glb_url", DROP COLUMN "itens_versao_publicada", DROP COLUMN "fonte_slug"
-- (nada depende delas) e as duas CHECK de volta à versão da 0111/0115 (só depois de não haver linha com origem 'fonte').

-- ── maquetes_3d ("maquete_modelos" do pedido: o JSON da estrutura já é a coluna "modelo") ──
-- Endereço de um arquivo 3D pronto (vazio por enquanto; quando usado, só do próprio armazenamento).
ALTER TABLE "maquetes_3d" ADD COLUMN IF NOT EXISTS "glb_url" text;
-- Versão dos itens que o cliente vê (maquete_3d_itens.versao); null = ainda não publicada (vale a mobília da planta).
ALTER TABLE "maquetes_3d" ADD COLUMN IF NOT EXISTS "itens_versao_publicada" integer;
-- Maquete que nasce de um JSON-fonte do repositório (data/plantas/<fonte_slug>.json): uma por planta.
ALTER TABLE "maquetes_3d" ADD COLUMN IF NOT EXISTS "fonte_slug" varchar(80);
CREATE UNIQUE INDEX IF NOT EXISTS "maquetes_3d_fonte_slug_idx" ON "maquetes_3d" ("fonte_slug") WHERE "deleted_at" IS NULL AND "fonte_slug" IS NOT NULL;

-- origem aceita 'fonte' (a regra da coluna, criada na 0111 com o nome padrão do Postgres, e a regra de vínculo da 0115).
ALTER TABLE "maquetes_3d" DROP CONSTRAINT IF EXISTS "maquetes_3d_origem_check";
ALTER TABLE "maquetes_3d" ADD CONSTRAINT "maquetes_3d_origem_check" CHECK ("origem" IN ('projeto', 'incorporacao', 'fonte'));
ALTER TABLE "maquetes_3d" DROP CONSTRAINT IF EXISTS "maquetes_3d_origem_alvo_ck";
ALTER TABLE "maquetes_3d" ADD CONSTRAINT "maquetes_3d_origem_alvo_ck" CHECK (
  ("origem" = 'projeto' AND "study_id" IS NULL AND (
    ("project_id" IS NOT NULL AND "lead_id" IS NULL) OR ("project_id" IS NULL AND "lead_id" IS NOT NULL)
  )) OR
  ("origem" = 'incorporacao' AND "study_id" IS NOT NULL AND "project_id" IS NULL AND "lead_id" IS NULL) OR
  ("origem" = 'fonte' AND "fonte_slug" IS NOT NULL AND "project_id" IS NULL AND "lead_id" IS NULL)
);

-- ── maquete_3d_itens ("maquete_itens" do pedido): uma linha por versão salva, imutável depois de gravada ──
CREATE TABLE IF NOT EXISTS "maquete_3d_itens" (
  "id" serial PRIMARY KEY,
  "maquete_id" integer NOT NULL REFERENCES "maquetes_3d" ("id"),
  "versao" integer NOT NULL CHECK ("versao" > 0),
  -- ItemFonte[] em JSON (json_itens), já conferido pelo servidor (zod + validarFonte contra a estrutura do servidor).
  "itens" text NOT NULL,
  "quantidade" integer NOT NULL CHECK ("quantidade" >= 0),
  -- Estrutura a que os itens se referem: versão do modelo da maquete e hash (SHA-256) da estrutura do JSON-fonte.
  "modelo_versao" integer NOT NULL,
  "estrutura_hash" varchar(64) NOT NULL,
  "situacao" varchar(20) NOT NULL CHECK ("situacao" IN ('rascunho', 'publicada', 'arquivada')),
  -- 'rascunho' (edição), 'restauracao' (padrão da planta) ou 'semente' (itens do JSON ao criar a maquete).
  "origem" varchar(20) NOT NULL DEFAULT 'rascunho' CHECK ("origem" IN ('rascunho', 'restauracao', 'semente')),
  "motivo" varchar(400),
  "autor_id" integer REFERENCES "users" ("id") ON DELETE SET NULL,
  "publicada_em" timestamp,
  "publicada_por" integer REFERENCES "users" ("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "maquete_3d_itens_versao_idx" ON "maquete_3d_itens" ("maquete_id", "versao");

-- Versão gravada não muda: só a situação anda (rascunho → publicada/arquivada, publicada → arquivada), a publicação
-- é marcada uma vez, e o autor/publicador pode virar null quando o usuário é excluído (ON DELETE SET NULL). Sem exclusão.
CREATE OR REPLACE FUNCTION maquete_3d_itens_imutavel() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'MAQUETE_ITENS_IMUTAVEL: versão de itens da maquete não pode ser apagada';
  END IF;
  IF NEW."maquete_id" IS DISTINCT FROM OLD."maquete_id" OR NEW."versao" IS DISTINCT FROM OLD."versao"
    OR NEW."itens" IS DISTINCT FROM OLD."itens" OR NEW."quantidade" IS DISTINCT FROM OLD."quantidade"
    OR NEW."modelo_versao" IS DISTINCT FROM OLD."modelo_versao" OR NEW."estrutura_hash" IS DISTINCT FROM OLD."estrutura_hash"
    OR NEW."origem" IS DISTINCT FROM OLD."origem" OR NEW."motivo" IS DISTINCT FROM OLD."motivo"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" OR NEW."id" IS DISTINCT FROM OLD."id"
    OR (NEW."autor_id" IS DISTINCT FROM OLD."autor_id" AND NEW."autor_id" IS NOT NULL)
    OR (NEW."publicada_em" IS DISTINCT FROM OLD."publicada_em" AND OLD."publicada_em" IS NOT NULL)
    OR (NEW."publicada_por" IS DISTINCT FROM OLD."publicada_por" AND NEW."publicada_por" IS NOT NULL AND OLD."publicada_por" IS NOT NULL) THEN
    RAISE EXCEPTION 'MAQUETE_ITENS_IMUTAVEL: versão de itens da maquete não pode ser alterada';
  END IF;
  IF NEW."situacao" IS DISTINCT FROM OLD."situacao" AND NOT (
    (OLD."situacao" = 'rascunho' AND NEW."situacao" IN ('publicada', 'arquivada')) OR
    (OLD."situacao" = 'publicada' AND NEW."situacao" = 'arquivada')) THEN
    RAISE EXCEPTION 'MAQUETE_ITENS_IMUTAVEL: situação % não pode voltar para %', OLD."situacao", NEW."situacao";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS maquete_3d_itens_imutavel_upd ON "maquete_3d_itens";
CREATE TRIGGER maquete_3d_itens_imutavel_upd BEFORE UPDATE OR DELETE ON "maquete_3d_itens" FOR EACH ROW EXECUTE FUNCTION maquete_3d_itens_imutavel();
DROP TRIGGER IF EXISTS maquete_3d_itens_imutavel_trunc ON "maquete_3d_itens";
CREATE TRIGGER maquete_3d_itens_imutavel_trunc BEFORE TRUNCATE ON "maquete_3d_itens" FOR EACH STATEMENT EXECUTE FUNCTION maquete_3d_itens_imutavel();

-- ── maquete_3d_lotes: o lote aponta para a maquete (e, opcionalmente, para uma versão publicada fixa) ──
CREATE TABLE IF NOT EXISTS "maquete_3d_lotes" (
  "id" serial PRIMARY KEY,
  -- ex.: vila-esmeralda / qd18-lote4 (só a-z, 0-9 e hífen)
  "empreendimento_slug" varchar(80) NOT NULL CHECK ("empreendimento_slug" ~ '^[a-z0-9-]{1,80}$'),
  "lote_slug" varchar(80) NOT NULL CHECK ("lote_slug" ~ '^[a-z0-9-]{1,80}$'),
  "maquete_id" integer NOT NULL REFERENCES "maquetes_3d" ("id"),
  -- null = segue maquetes_3d.itens_versao_publicada
  "itens_versao" integer,
  -- de onde vem o status do lote (disponível/reservado/vendido), quando houver
  "unit_id" integer REFERENCES "incorporation_units" ("id") ON DELETE SET NULL,
  "ativo" boolean NOT NULL DEFAULT true,
  "criado_por" integer REFERENCES "users" ("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "maquete_3d_lotes_slug_idx" ON "maquete_3d_lotes" ("empreendimento_slug", "lote_slug");
CREATE INDEX IF NOT EXISTS "maquete_3d_lotes_maquete_idx" ON "maquete_3d_lotes" ("maquete_id");
