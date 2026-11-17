-- 17/11/2026 — EPIC-025 (etapa 4b): a Dolores responde no grupo QUANDO É MARCADA (decisão do dono de 17/11/2026: "Nos grupos
-- ela só pode responder quando ela for marcada, quando o número for marcado; em nenhum outro momento ela deve responder as
-- mensagens do grupo e deve apenas observar até ser marcada.").
-- "dolores_marcacoes_config": linha única (id = 1) — interruptor GERAL "responder quando marcada" (DESLIGADO por padrão), tetos
--   (por grupo e dia, por remetente e hora), janela de frescor e o @lid da Dolores conferido pela Evolution para o número
--   conectado ("lid_do_numero": se o número mudar, o @lid deixa de valer até ser conferido de novo).
-- "dolores_marcacoes_grupo": interruptor POR GRUPO (DESLIGADO por padrão; sem linha = desligado). Responde só com os dois ligados.
-- "dolores_marcacoes": uma linha por marcação real num grupo cadastrado e ativo (idempotente por instância + id da mensagem):
--   remetente mascarado, pergunta filtrada, o que ela respondeu, se foi fora de escopo e a reserva do limite mensal. No máximo
--   UMA em andamento por grupo (índice único parcial). Nunca é apagada; o que chegou não muda.
-- "dolores_marcacoes_contagem": contadores atômicos (grupo/dia, remetente/hora, aviso de teto/dia), uma linha por chave.
-- Somente aditiva e idempotente: só tabelas, índices, função e gatilhos NOVOS (IF NOT EXISTS / OR REPLACE); a linha de
-- configuração entra com ON CONFLICT DO NOTHING. Nenhuma tabela existente é alterada (nem as da 0126).
-- FKs × gatilhos (lição da etapa 4): a única tabela com gatilho de UPDATE ("dolores_marcacoes") não recebe nenhum ON DELETE SET
-- NULL — a FK dela (grupo) é RESTRICT e o grupo nunca é apagado (gatilho da 0126). As FKs SET NULL (usuário que mudou a
-- configuração) ficam em tabelas SEM gatilho.
-- Reversão: DROP TABLE "dolores_marcacoes_contagem", "dolores_marcacoes", "dolores_marcacoes_grupo", "dolores_marcacoes_config";
-- DROP FUNCTION dolores_marcacoes_guarda() (nada depende delas).

CREATE TABLE IF NOT EXISTS "dolores_marcacoes_config" (
  "id" integer PRIMARY KEY NOT NULL DEFAULT 1 CHECK ("id" = 1),
  "responder_ligado" boolean NOT NULL DEFAULT false,
  "teto_grupo_dia" integer NOT NULL DEFAULT 20 CHECK ("teto_grupo_dia" BETWEEN 1 AND 200),
  "teto_remetente_hora" integer NOT NULL DEFAULT 5 CHECK ("teto_remetente_hora" BETWEEN 1 AND 30),
  "janela_frescor_segundos" integer NOT NULL DEFAULT 120 CHECK ("janela_frescor_segundos" BETWEEN 30 AND 600),
  "lid_dolores" varchar(40) CHECK ("lid_dolores" IS NULL OR "lid_dolores" ~ '^[0-9]{5,25}@lid$'),
  "lid_do_numero" varchar(20),
  "lid_conferido_em" timestamp with time zone,
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);
INSERT INTO "dolores_marcacoes_config" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "dolores_marcacoes_grupo" (
  "grupo_id" integer PRIMARY KEY NOT NULL REFERENCES "dolores_grupos"("id") ON DELETE RESTRICT,
  "responder_ligado" boolean NOT NULL DEFAULT false,
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "dolores_marcacoes" (
  "id" serial PRIMARY KEY NOT NULL,
  "grupo_id" integer NOT NULL REFERENCES "dolores_grupos"("id") ON DELETE RESTRICT,
  "instancia" varchar(80) NOT NULL,
  "external_id" varchar(160) NOT NULL,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "enviada_em" timestamp with time zone,
  -- sempre mascarado ("(99) *****-4567") ou "participante"; nunca o número inteiro
  "remetente" varchar(30),
  "pergunta" varchar(500),
  "situacao" varchar(16) NOT NULL DEFAULT 'processando'
    CHECK ("situacao" IN ('processando', 'respondida', 'fora_de_escopo', 'silencio', 'erro')),
  "motivo" varchar(200),
  "fora_de_escopo" boolean NOT NULL DEFAULT false,
  "resposta" varchar(800),
  "respondida_em" timestamp with time zone,
  "voltas" smallint NOT NULL DEFAULT 0,
  "tokens_entrada" integer NOT NULL DEFAULT 0,
  "tokens_saida" integer NOT NULL DEFAULT 0,
  "reserva_entrada" integer NOT NULL DEFAULT 0,
  "reserva_saida" integer NOT NULL DEFAULT 0,
  "reserva_ate" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "dolores_marcacoes_externa_uidx" ON "dolores_marcacoes" ("instancia", "external_id");
-- no máximo UMA resposta em andamento por grupo
CREATE UNIQUE INDEX IF NOT EXISTS "dolores_marcacoes_uma_por_grupo" ON "dolores_marcacoes" ("grupo_id") WHERE "situacao" = 'processando';
CREATE INDEX IF NOT EXISTS "dolores_marcacoes_grupo_idx" ON "dolores_marcacoes" ("grupo_id", "criado_em");
CREATE INDEX IF NOT EXISTS "dolores_marcacoes_reserva_idx" ON "dolores_marcacoes" ("reserva_ate") WHERE "reserva_ate" IS NOT NULL;

CREATE OR REPLACE FUNCTION dolores_marcacoes_guarda() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'DOLORES_MARCACOES_SEM_EXCLUSAO: registro de marcação não é apagado';
  END IF;
  IF NEW."grupo_id" IS DISTINCT FROM OLD."grupo_id" OR NEW."instancia" IS DISTINCT FROM OLD."instancia"
     OR NEW."external_id" IS DISTINCT FROM OLD."external_id" OR NEW."criado_em" IS DISTINCT FROM OLD."criado_em"
     OR NEW."remetente" IS DISTINCT FROM OLD."remetente" OR NEW."pergunta" IS DISTINCT FROM OLD."pergunta"
     OR NEW."enviada_em" IS DISTINCT FROM OLD."enviada_em" THEN
    RAISE EXCEPTION 'DOLORES_MARCACOES_IMUTAVEL: o que chegou no grupo não muda';
  END IF;
  -- desfecho final: depois de respondida/fora de escopo/silêncio, só a reserva pode ser solta
  IF OLD."situacao" <> 'processando' AND OLD."situacao" <> 'erro' AND (NEW."situacao" IS DISTINCT FROM OLD."situacao"
     OR NEW."resposta" IS DISTINCT FROM OLD."resposta") THEN
    RAISE EXCEPTION 'DOLORES_MARCACOES_FINAL: o desfecho registrado não muda';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dolores_marcacoes_guarda ON "dolores_marcacoes";
CREATE TRIGGER dolores_marcacoes_guarda BEFORE UPDATE OR DELETE ON "dolores_marcacoes"
  FOR EACH ROW EXECUTE FUNCTION dolores_marcacoes_guarda();
DROP TRIGGER IF EXISTS dolores_marcacoes_sem_truncate ON "dolores_marcacoes";
CREATE TRIGGER dolores_marcacoes_sem_truncate BEFORE TRUNCATE ON "dolores_marcacoes"
  FOR EACH STATEMENT EXECUTE FUNCTION dolores_marcacoes_guarda();

CREATE TABLE IF NOT EXISTS "dolores_marcacoes_contagem" (
  -- "g:<grupo>:<dia>", "r:<resumo HMAC do remetente>:<hora UTC>", "aviso:<grupo>:<dia>"
  "chave" varchar(80) PRIMARY KEY NOT NULL,
  "total" integer NOT NULL DEFAULT 0,
  "primeira_em" timestamp with time zone NOT NULL DEFAULT now(),
  "ultima_em" timestamp with time zone NOT NULL DEFAULT now()
);
