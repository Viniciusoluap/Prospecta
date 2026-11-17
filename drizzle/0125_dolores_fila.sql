-- 16/11/2026 — EPIC-025 (etapa 3, Ações): fila de aprovação da Dolores, autoria do que ela cria e a validade da fila.
-- "dolores_aprovacoes": um item por ação que espera o dono (função + argumentos já validados + resumo montado pelo
--   sistema com TODO o texto que será gravado + conferência SHA-256 de função/resumo/argumentos, código curto para o dono
--   responder "aprovar CÓDIGO", situação, quem decidiu e quando, resultado, vencimento).
--   Nunca é apagada (gatilho recusa DELETE/TRUNCATE); depois de criada, função/argumentos/código/resumo/validade/pedido/
--   autor não mudam; "aguardando" só vai para executando/recusada/vencida (nunca "executada" direto); a decisão é gravada
--   uma vez; o resultado só na transição que encerra a execução; um item encerrado (executada, recusada, vencida, erro)
--   não volta — a execução acontece uma única vez.
-- "dolores_autoria": uma linha por registro do sistema criado pela Dolores (tabela + id), com o pedido (`pedido_id`, o
--   mesmo de dolores_acoes) e o item aprovado, quando houver. Só inclusão.
-- "dolores_fila_config": linha única (id = 1) com a validade dos itens, em horas (padrão 48).
-- Somente aditiva e idempotente: tabelas, índices, função e gatilhos novos (IF NOT EXISTS / OR REPLACE); a linha de
-- configuração entra com ON CONFLICT DO NOTHING. Nenhuma tabela existente é alterada.
-- Reversão: DROP TABLE "dolores_autoria", "dolores_aprovacoes", "dolores_fila_config";
-- DROP FUNCTION dolores_aprovacoes_guarda(), dolores_autoria_guarda() (nada depende delas).

CREATE TABLE IF NOT EXISTS "dolores_aprovacoes" (
  "id" serial PRIMARY KEY NOT NULL,
  "codigo" varchar(8) NOT NULL,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "vence_em" timestamp with time zone NOT NULL,
  -- quem pediu: a mensagem do dono no WhatsApp (dolores_mensagens.id) e o pedido da chamada (= dolores_acoes.pedido_id)
  "mensagem_id" integer,
  "pedido_id" varchar(120),
  "autor_user_id" integer REFERENCES "users"("id") ON DELETE RESTRICT,
  -- o que será feito
  "funcao" varchar(80) NOT NULL,
  "alvo" varchar(80) NOT NULL,
  "argumentos" jsonb NOT NULL,
  -- o que o dono lê: TODO o texto que será gravado (até 1.500 caracteres no código; a coluna tem folga)
  "resumo" varchar(2000) NOT NULL,
  -- SHA-256 de (função, resumo, argumentos) gravado na criação; a execução confere antes de fazer qualquer coisa
  "conferencia" varchar(64),
  "situacao" varchar(12) NOT NULL DEFAULT 'aguardando'
    CHECK ("situacao" IN ('aguardando', 'executando', 'executada', 'recusada', 'vencida', 'erro')),
  -- decisão
  "decidido_em" timestamp with time zone,
  "decidido_via" varchar(12) CHECK ("decidido_via" IS NULL OR "decidido_via" IN ('whatsapp', 'tela', 'sistema')),
  "decidido_por_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "motivo" varchar(300),
  -- execução
  "executado_em" timestamp with time zone,
  "resultado" jsonb
);

-- QA R2 (N3), para bancos em que uma versão anterior desta migração já criou a tabela: só aumenta o resumo (600 → 2000,
-- sem reescrever dados) e acrescenta a conferência. Idempotente.
ALTER TABLE "dolores_aprovacoes" ALTER COLUMN "resumo" TYPE varchar(2000);
ALTER TABLE "dolores_aprovacoes" ADD COLUMN IF NOT EXISTS "conferencia" varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS "dolores_aprovacoes_codigo_unico" ON "dolores_aprovacoes" ("codigo");
-- o mesmo pedido (função + alvo) não fica duas vezes aguardando
CREATE UNIQUE INDEX IF NOT EXISTS "dolores_aprovacoes_um_aguardando" ON "dolores_aprovacoes" ("funcao", "alvo") WHERE "situacao" = 'aguardando';
CREATE INDEX IF NOT EXISTS "dolores_aprovacoes_situacao_idx" ON "dolores_aprovacoes" ("situacao", "criado_em");
CREATE INDEX IF NOT EXISTS "dolores_aprovacoes_mensagem_idx" ON "dolores_aprovacoes" ("mensagem_id");

CREATE OR REPLACE FUNCTION dolores_aprovacoes_guarda() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'DOLORES_FILA_SEM_EXCLUSAO: itens da fila de aprovação da Dolores não são apagados';
  END IF;
  -- o que será feito, o que o dono lê (resumo), a validade e a origem do pedido não mudam depois de entrar na fila
  IF NEW."codigo" IS DISTINCT FROM OLD."codigo" OR NEW."funcao" IS DISTINCT FROM OLD."funcao" OR NEW."alvo" IS DISTINCT FROM OLD."alvo"
     OR NEW."argumentos" IS DISTINCT FROM OLD."argumentos" OR NEW."criado_em" IS DISTINCT FROM OLD."criado_em"
     OR NEW."mensagem_id" IS DISTINCT FROM OLD."mensagem_id" OR NEW."vence_em" IS DISTINCT FROM OLD."vence_em"
     OR NEW."resumo" IS DISTINCT FROM OLD."resumo" OR NEW."pedido_id" IS DISTINCT FROM OLD."pedido_id"
     OR NEW."autor_user_id" IS DISTINCT FROM OLD."autor_user_id" OR NEW."conferencia" IS DISTINCT FROM OLD."conferencia" THEN
    RAISE EXCEPTION 'DOLORES_FILA_IMUTAVEL: o que será feito não muda depois de entrar na fila';
  END IF;
  IF OLD."situacao" IN ('executada', 'recusada', 'vencida', 'erro') THEN
    RAISE EXCEPTION 'DOLORES_FILA_ENCERRADO: item encerrado não muda de situação';
  END IF;
  -- aguardando só sai para executando (aprovado), recusada ou vencida: nunca "executada" sem passar pela execução
  IF OLD."situacao" = 'aguardando' AND NEW."situacao" NOT IN ('aguardando', 'executando', 'recusada', 'vencida') THEN
    RAISE EXCEPTION 'DOLORES_FILA_EXECUCAO_UNICA: item aguardando só vai para executando, recusada ou vencida';
  END IF;
  IF OLD."situacao" = 'executando' AND NEW."situacao" NOT IN ('executando', 'executada', 'erro') THEN
    RAISE EXCEPTION 'DOLORES_FILA_EXECUCAO_UNICA: item em execução só termina (executada ou erro)';
  END IF;
  -- a decisão (quem, quando, por onde) é gravada uma vez, ao sair de "aguardando"
  IF OLD."situacao" <> 'aguardando' AND (NEW."decidido_em" IS DISTINCT FROM OLD."decidido_em"
     OR NEW."decidido_via" IS DISTINCT FROM OLD."decidido_via" OR NEW."decidido_por_user_id" IS DISTINCT FROM OLD."decidido_por_user_id") THEN
    RAISE EXCEPTION 'DOLORES_FILA_IMUTAVEL: a decisão do item não muda depois de tomada';
  END IF;
  -- resultado e hora da execução só na transição que encerra a execução (executando → executada/erro)
  IF (NEW."resultado" IS DISTINCT FROM OLD."resultado" OR NEW."executado_em" IS DISTINCT FROM OLD."executado_em")
     AND NOT (OLD."situacao" = 'executando' AND NEW."situacao" IN ('executada', 'erro')) THEN
    RAISE EXCEPTION 'DOLORES_FILA_RESULTADO: o resultado só é gravado ao encerrar a execução';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dolores_aprovacoes_guarda ON "dolores_aprovacoes";
CREATE TRIGGER dolores_aprovacoes_guarda BEFORE UPDATE OR DELETE ON "dolores_aprovacoes"
  FOR EACH ROW EXECUTE FUNCTION dolores_aprovacoes_guarda();
DROP TRIGGER IF EXISTS dolores_aprovacoes_sem_truncate ON "dolores_aprovacoes";
CREATE TRIGGER dolores_aprovacoes_sem_truncate BEFORE TRUNCATE ON "dolores_aprovacoes"
  FOR EACH STATEMENT EXECUTE FUNCTION dolores_aprovacoes_guarda();

CREATE TABLE IF NOT EXISTS "dolores_autoria" (
  "id" serial PRIMARY KEY NOT NULL,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  -- a usuária Dolores (autora); não pode ser apagada com registros dela
  "autor_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "tabela" varchar(60) NOT NULL,
  "registro_id" integer NOT NULL,
  "funcao" varchar(80) NOT NULL,
  "mensagem_id" integer,
  "pedido_id" varchar(120),
  "aprovacao_id" integer REFERENCES "dolores_aprovacoes"("id") ON DELETE RESTRICT,
  "descricao" varchar(300)
);

CREATE INDEX IF NOT EXISTS "dolores_autoria_registro_idx" ON "dolores_autoria" ("tabela", "registro_id");
CREATE INDEX IF NOT EXISTS "dolores_autoria_mensagem_idx" ON "dolores_autoria" ("mensagem_id");

CREATE OR REPLACE FUNCTION dolores_autoria_guarda() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'DOLORES_AUTORIA_SOMENTE_INSERCAO: o registro de autoria da Dolores não é alterado nem apagado';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dolores_autoria_guarda ON "dolores_autoria";
CREATE TRIGGER dolores_autoria_guarda BEFORE UPDATE OR DELETE ON "dolores_autoria"
  FOR EACH ROW EXECUTE FUNCTION dolores_autoria_guarda();
DROP TRIGGER IF EXISTS dolores_autoria_sem_truncate ON "dolores_autoria";
CREATE TRIGGER dolores_autoria_sem_truncate BEFORE TRUNCATE ON "dolores_autoria"
  FOR EACH STATEMENT EXECUTE FUNCTION dolores_autoria_guarda();

CREATE TABLE IF NOT EXISTS "dolores_fila_config" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "validade_horas" integer NOT NULL DEFAULT 48 CHECK ("validade_horas" BETWEEN 1 AND 336),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);

INSERT INTO "dolores_fila_config" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
