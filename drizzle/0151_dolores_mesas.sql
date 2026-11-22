-- 22/11/2026 — EPIC-027 C5, "criadora de mesas" da Dolores (pedido do dono aprovado em 21/11/2026). Quando o DONO pede uma função nova
-- ("quero que você passe a fazer X", "cria uma mesa para acompanhar Y"), a Dolores NÃO programa nem passa a fazer nada sozinha: escreve
-- uma PROPOSTA DE MESA e guarda para aprovação. Só entra em operação depois que ele aprovar e a função for construída pelo processo
-- normal de desenvolvimento (fora da Dolores). Story: docs/stories/epics/epic-027-correcoes-20-11-noite/C5-MESAS-criadora-de-mesas.md.
--
-- "dolores_mesas_propostas": uma linha por mesa (o cabeçalho): título atual, pedido original do dono (texto já sem senha/token/chave/
--   dado bancário e com CPF, telefone e e-mail MASCARADOS), situação, versão atual, origem ('conversa' = o dono pediu e respondeu "pode";
--   'semente' = mesa que já existe no sistema, registrada pelo servidor a partir do registro real de funções, com "chave_semente" única),
--   datas e autor. Aprovar só muda a situação: NADA é ligado por esta tabela.
-- "dolores_mesas_versoes": cada revisão da proposta é uma linha NOVA (versão 1, 2, 3…), IMUTÁVEL (o gatilho barra alterar e apagar).
--   A proposta estruturada fica em "proposta" (jsonb: objetivo, quando age, o que lê, o que grava, funções novas, quem aprova, exemplos,
--   riscos, faixa de custo) — os nomes de leitura/ação já conferidos por código contra o registro fechado.
-- Sem exclusão: o gatilho barra DELETE e TRUNCATE nas duas tabelas ("arquivada" é a forma de tirar uma mesa da lista); no cabeçalho,
--   pedido original, origem, chave da semente e data de criação não mudam, e a versão atual só sobe.
--
-- Somente ADITIVA e IDEMPOTENTE (CREATE ... IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE TRIGGER).
-- Nenhuma tabela anterior muda; nenhum dado existente é alterado. Reversão: DROP TABLE "dolores_mesas_versoes", "dolores_mesas_propostas";
-- DROP FUNCTION dolores_mesas_guarda(), dolores_mesas_versoes_guarda() (nada mais depende delas).

CREATE TABLE IF NOT EXISTS "dolores_mesas_propostas" (
  "id" serial PRIMARY KEY,
  "titulo" varchar(80) NOT NULL CHECK (char_length(btrim("titulo")) BETWEEN 3 AND 80),
  "pedido_original" varchar(600) NOT NULL DEFAULT '',
  "situacao" varchar(20) NOT NULL DEFAULT 'rascunho'
    CHECK ("situacao" IN ('rascunho', 'aguardando_dono', 'aprovada', 'em_construcao', 'em_operacao', 'recusada', 'arquivada')),
  "versao_atual" integer NOT NULL DEFAULT 1 CHECK ("versao_atual" BETWEEN 1 AND 20),
  "origem" varchar(10) NOT NULL CHECK ("origem" IN ('conversa', 'semente')),
  "chave_semente" varchar(40),
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "autor_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "mensagem_id" integer REFERENCES "dolores_mensagens"("id") ON DELETE SET NULL,
  "aprovada_em" timestamp with time zone,
  "aprovada_versao" integer,
  "aprovada_mensagem_id" integer REFERENCES "dolores_mensagens"("id") ON DELETE SET NULL,
  "encerrada_em" timestamp with time zone,
  CONSTRAINT "dolores_mesas_semente_com_chave" CHECK (("origem" = 'semente') = ("chave_semente" IS NOT NULL)),
  CONSTRAINT "dolores_mesas_aprovada_com_versao" CHECK ("aprovada_em" IS NULL OR "aprovada_versao" IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "dolores_mesas_chave_semente_uq" ON "dolores_mesas_propostas" ("chave_semente") WHERE "chave_semente" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "dolores_mesas_situacao_idx" ON "dolores_mesas_propostas" ("situacao", "atualizado_em");

CREATE TABLE IF NOT EXISTS "dolores_mesas_versoes" (
  "id" serial PRIMARY KEY,
  "mesa_id" integer NOT NULL REFERENCES "dolores_mesas_propostas"("id") ON DELETE RESTRICT,
  "versao" integer NOT NULL CHECK ("versao" BETWEEN 1 AND 20),
  "proposta" jsonb NOT NULL CHECK (jsonb_typeof("proposta") = 'object' AND octet_length("proposta"::text) <= 12000),
  "origem" varchar(10) NOT NULL CHECK ("origem" IN ('conversa', 'semente')),
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  -- sem chave estrangeira de propósito: a linha é imutável (um ON DELETE SET NULL seria uma alteração)
  "autor_user_id" integer,
  "mensagem_id" integer,
  CONSTRAINT "dolores_mesas_versoes_uma_por_numero" UNIQUE ("mesa_id", "versao")
);

-- Cabeçalho: sem exclusão; pedido original, origem, chave da semente e criação não mudam; a versão só sobe.
CREATE OR REPLACE FUNCTION dolores_mesas_guarda() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'DOLORES_MESAS_SEM_EXCLUSAO: propostas de mesa da Dolores não são apagadas (use arquivada)';
  END IF;
  IF NEW."pedido_original" IS DISTINCT FROM OLD."pedido_original" OR NEW."origem" IS DISTINCT FROM OLD."origem"
     OR NEW."chave_semente" IS DISTINCT FROM OLD."chave_semente" OR NEW."criado_em" IS DISTINCT FROM OLD."criado_em" THEN
    RAISE EXCEPTION 'DOLORES_MESAS_IMUTAVEL: pedido original, origem e criação da mesa não mudam';
  END IF;
  IF NEW."versao_atual" < OLD."versao_atual" THEN
    RAISE EXCEPTION 'DOLORES_MESAS_VERSAO: a versão atual da mesa só sobe';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dolores_mesas_guarda ON "dolores_mesas_propostas";
CREATE TRIGGER dolores_mesas_guarda BEFORE UPDATE OR DELETE ON "dolores_mesas_propostas"
  FOR EACH ROW EXECUTE FUNCTION dolores_mesas_guarda();
DROP TRIGGER IF EXISTS dolores_mesas_sem_truncate ON "dolores_mesas_propostas";
CREATE TRIGGER dolores_mesas_sem_truncate BEFORE TRUNCATE ON "dolores_mesas_propostas"
  FOR EACH STATEMENT EXECUTE FUNCTION dolores_mesas_guarda();

-- Versões: somente inserção.
CREATE OR REPLACE FUNCTION dolores_mesas_versoes_guarda() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'DOLORES_MESAS_VERSAO_IMUTAVEL: a versão de uma proposta de mesa não é alterada nem apagada (revisão = versão nova)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dolores_mesas_versoes_guarda ON "dolores_mesas_versoes";
CREATE TRIGGER dolores_mesas_versoes_guarda BEFORE UPDATE OR DELETE ON "dolores_mesas_versoes"
  FOR EACH ROW EXECUTE FUNCTION dolores_mesas_versoes_guarda();
DROP TRIGGER IF EXISTS dolores_mesas_versoes_sem_truncate ON "dolores_mesas_versoes";
CREATE TRIGGER dolores_mesas_versoes_sem_truncate BEFORE TRUNCATE ON "dolores_mesas_versoes"
  FOR EACH STATEMENT EXECUTE FUNCTION dolores_mesas_versoes_guarda();
