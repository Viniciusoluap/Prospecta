-- 16/11/2026 — EPIC-025 (etapa 1, Leitura): auditoria da Dolores e a chave de pausa da ponte.
-- "dolores_acoes": uma linha por chamada à ponte (função, argumentos saneados, resumo em contagens — nunca os dados —,
-- resultado ok/recusada/erro, duração, pedido e autora = usuária Dolores). Só inserção: o gatilho recusa UPDATE e DELETE.
-- "dolores_config": linha única (id = 1) com a pausa (pausada, a ponte recusa tudo) e o limite de chamadas por minuto.
-- Somente aditiva e idempotente: tabelas, índices, função e gatilho novos (IF NOT EXISTS / OR REPLACE); a linha de
-- configuração entra com ON CONFLICT DO NOTHING. Nada existente é alterado ou apagado.
-- "dolores_limite": contador do limite por minuto (reserva atômica da vaga).
-- Reversão: DROP TABLE "dolores_acoes", "dolores_config", "dolores_limite"; DROP FUNCTION dolores_acoes_guarda() (nada depende delas).

CREATE TABLE IF NOT EXISTS "dolores_acoes" (
  "id" serial PRIMARY KEY NOT NULL,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "autor_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  -- por onde chegou o pedido (etapa 1: só a ponte)
  "canal" varchar(30) NOT NULL DEFAULT 'ponte',
  "etapa" smallint NOT NULL DEFAULT 1,
  "funcao" varchar(80) NOT NULL,
  -- argumentos saneados (texto cortado, chaves sensíveis removidas)
  "argumentos" jsonb,
  "resultado" varchar(12) NOT NULL CHECK ("resultado" IN ('ok', 'recusada', 'erro')),
  "motivo" varchar(300),
  -- contagens do que foi devolvido, nunca os dados
  "resumo" jsonb,
  "duracao_ms" integer,
  "pedido_id" varchar(120)
);

CREATE INDEX IF NOT EXISTS "dolores_acoes_criado_em_idx" ON "dolores_acoes" ("criado_em");
CREATE INDEX IF NOT EXISTS "dolores_acoes_funcao_idx" ON "dolores_acoes" ("funcao", "criado_em");

CREATE OR REPLACE FUNCTION dolores_acoes_guarda() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'DOLORES_AUDITORIA_SOMENTE_INSERCAO: o registro de ações da Dolores não é alterado nem apagado';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dolores_acoes_guarda ON "dolores_acoes";
CREATE TRIGGER dolores_acoes_guarda BEFORE UPDATE OR DELETE ON "dolores_acoes"
  FOR EACH ROW EXECUTE FUNCTION dolores_acoes_guarda();

CREATE TABLE IF NOT EXISTS "dolores_config" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "pausada" boolean NOT NULL DEFAULT false,
  "motivo_pausa" text,
  "limite_por_minuto" integer NOT NULL DEFAULT 60 CHECK ("limite_por_minuto" BETWEEN 1 AND 600),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);

INSERT INTO "dolores_config" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

-- Contador do limite por minuto: uma linha por minuto do dia (0–1439), reaproveitada no dia seguinte; a vaga é reservada
-- numa só instrução (INSERT ... ON CONFLICT DO UPDATE ... WHERE total < limite), o que vale entre chamadas paralelas.
CREATE TABLE IF NOT EXISTS "dolores_limite" (
  "minuto" smallint PRIMARY KEY CHECK ("minuto" BETWEEN 0 AND 1439),
  "janela" timestamp with time zone NOT NULL,
  "total" integer NOT NULL DEFAULT 0
);
