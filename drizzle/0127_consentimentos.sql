-- 17/11/2026 — EPIC-024 S-12: termo de consentimento aceito ao criar a senha do primeiro acesso.
-- "consentimentos": uma linha por aceite (usuário, versão do termo, data/hora, canal/tela e um resumo técnico mínimo).
--   Prova do aceite: só inclusão. O gatilho recusa UPDATE, DELETE e TRUNCATE. Não guarda IP nem user-agent: o resumo
--   técnico é só o tipo de aparelho ("celular", "tablet", "computador", "desconhecido") e se a senha foi criada junto.
--   O aceite do primeiro acesso é gravado na MESMA transação que grava a senha (server/consentimento.ts).
--   "user_id" guarda o número da conta SEM chave estrangeira, de propósito: excluir um usuário em "Usuários e acesso"
--   continua funcionando como hoje e a prova do aceite (número da conta, versão, data) permanece. A conta existir na
--   hora do aceite é garantido pelo servidor, que grava o aceite na mesma transação que atualiza a senha da conta.
-- Somente aditiva e idempotente: tabela, índices, função e gatilhos novos (IF NOT EXISTS / OR REPLACE / DROP TRIGGER
-- IF EXISTS + CREATE). Nenhuma tabela existente é alterada.
-- Reversão: DROP TABLE "consentimentos"; DROP FUNCTION consentimentos_somente_inclusao() (nada depende delas).

CREATE TABLE IF NOT EXISTS "consentimentos" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "versao_termo" varchar(40) NOT NULL,
  "aceito_em" timestamp with time zone NOT NULL DEFAULT now(),
  "canal" varchar(20) NOT NULL CHECK ("canal" IN ('definir_senha', 'login')),
  "aparelho" varchar(12) NOT NULL DEFAULT 'desconhecido'
    CHECK ("aparelho" IN ('celular', 'tablet', 'computador', 'desconhecido')),
  "com_senha" boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS "consentimentos_usuario_idx" ON "consentimentos" ("user_id", "aceito_em");
CREATE INDEX IF NOT EXISTS "consentimentos_versao_idx" ON "consentimentos" ("versao_termo");

CREATE OR REPLACE FUNCTION consentimentos_somente_inclusao() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CONSENTIMENTO_SO_INCLUSAO: o registro de aceite do termo não é alterado nem apagado';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "consentimentos_sem_alteracao" ON "consentimentos";
CREATE TRIGGER "consentimentos_sem_alteracao" BEFORE UPDATE OR DELETE ON "consentimentos"
  FOR EACH ROW EXECUTE FUNCTION consentimentos_somente_inclusao();

DROP TRIGGER IF EXISTS "consentimentos_sem_truncate" ON "consentimentos";
CREATE TRIGGER "consentimentos_sem_truncate" BEFORE TRUNCATE ON "consentimentos"
  FOR EACH STATEMENT EXECUTE FUNCTION consentimentos_somente_inclusao();
