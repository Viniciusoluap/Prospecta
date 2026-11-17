-- 17/11/2026 — EPIC-025 (etapa 6, Operação contínua): rondas agendadas, eventos, relatório diário e a configuração da
-- operação (tela "Dolores — operação contínua", só admin).
-- "dolores_operacao_config": linha única (id = 1). TUDO DESLIGADO por padrão (rondas, relatório diário, eventos). Hora do
--   relatório no horário de Brasília/Imperatriz (UTC−3; o Neon está em GMT — a conta é feita no código). Preço por milhão de
--   tokens (R$) é OPCIONAL e fica vazio: sem ele, a tela não estima reais (o sistema não inventa preço).
-- "dolores_rondas": uma linha por ronda (varredura POR CÓDIGO, sem IA). Só inserção. A "janela" é única: a mesma ronda do
--   dia (ou do minuto, na ronda sob demanda) não roda duas vezes; a reentrega do cron não duplica (INSERT ... ON CONFLICT DO
--   NOTHING depois de montar o resultado — nada é atualizado).
-- "dolores_relatorios": uma linha por relatório montado (diário ou sob demanda), com o texto JÁ FILTRADO pelo filtro do
--   registro (dados pessoais mascarados; segredos e dados bancários sempre). Só inserção; janela única (o diário sai uma vez
--   por dia). O resultado do envio fica em dolores_acoes (função "relatorio_envio").
-- "dolores_eventos": registro leve de eventos do sistema (documento recebido em grupo, nota lida, prazo vencido, pagamento
--   sincronizado do banco). Só inserção; chave única (o mesmo evento não entra duas vezes). Evento NUNCA dispara ação de
--   escrita: no máximo entra no relatório.
-- Nenhuma destas tabelas tem chave estrangeira para "users" (quem pediu fica como número, sem FK): a exclusão de um usuário
-- nunca esbarra nos gatilhos de só inserção (um ON DELETE SET NULL viraria UPDATE). A única FK (relatório → ronda) é
-- RESTRICT, e a ronda não se apaga.
-- Somente aditiva e idempotente: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, gatilhos no padrão das outras
-- migrações da Dolores (DROP TRIGGER IF EXISTS + CREATE TRIGGER, só dos gatilhos desta migração) e a linha de
-- configuração com ON CONFLICT DO NOTHING. Nenhuma tabela existente é alterada.
-- Reversão: DROP TABLE "dolores_relatorio_reenvios", "dolores_relatorios", "dolores_rondas", "dolores_eventos", "dolores_operacao_config";
-- DROP FUNCTION dolores_operacao_somente_insercao() (nada fora da etapa 6 depende delas).

CREATE TABLE IF NOT EXISTS "dolores_operacao_config" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "rondas_ligadas" boolean NOT NULL DEFAULT false,
  "relatorio_ligado" boolean NOT NULL DEFAULT false,
  -- hora (0–23) no horário de Brasília/Imperatriz a partir da qual o relatório diário pode sair
  "relatorio_hora" smallint NOT NULL DEFAULT 7 CHECK ("relatorio_hora" BETWEEN 0 AND 23),
  "eventos_ligados" boolean NOT NULL DEFAULT false,
  -- preço informado pelo admin (R$ por milhão de tokens); vazio = sem estimativa em reais
  "preco_entrada_milhao" numeric(10, 2) CHECK ("preco_entrada_milhao" IS NULL OR "preco_entrada_milhao" >= 0),
  "preco_saida_milhao" numeric(10, 2) CHECK ("preco_saida_milhao" IS NULL OR "preco_saida_milhao" >= 0),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);

INSERT INTO "dolores_operacao_config" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "dolores_rondas" (
  "id" serial PRIMARY KEY NOT NULL,
  -- "diaria:AAAA-MM-DD" (cron) ou "sob-demanda:AAAA-MM-DDTHH:MM" (tela/WhatsApp, no máximo uma por minuto)
  "janela" varchar(60) NOT NULL,
  "origem" varchar(12) NOT NULL CHECK ("origem" IN ('cron', 'tela', 'whatsapp')),
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "duracao_ms" integer,
  -- contagens por seção (fila, grupos, notas, atrasos, tarefas, documentos, recebíveis, banco, consumo…)
  "totais" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- poucos itens por seção, já pelo filtro do registro (nomes, prazos, códigos; nunca CPF, telefone, conta)
  "destaques" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- seções que falharam ou ficaram sem tempo (a ronda e o relatório dizem que falta)
  "falhas" jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS "dolores_rondas_janela_uidx" ON "dolores_rondas" ("janela");
CREATE INDEX IF NOT EXISTS "dolores_rondas_criado_em_idx" ON "dolores_rondas" ("criado_em");

CREATE TABLE IF NOT EXISTS "dolores_relatorios" (
  "id" serial PRIMARY KEY NOT NULL,
  -- "diario:AAAA-MM-DD" ou "sob-demanda:AAAA-MM-DDTHH:MM"
  "janela" varchar(60) NOT NULL,
  "tipo" varchar(12) NOT NULL CHECK ("tipo" IN ('diario', 'sob_demanda')),
  "origem" varchar(12) NOT NULL CHECK ("origem" IN ('cron', 'tela', 'whatsapp')),
  "ronda_id" integer NOT NULL CONSTRAINT "dolores_relatorios_ronda_fk" REFERENCES "dolores_rondas"("id") ON DELETE RESTRICT,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  -- texto montado pelo sistema (modelo fixo, sem IA), pelo filtro do registro
  "texto" varchar(4000) NOT NULL,
  "caracteres" integer NOT NULL DEFAULT 0,
  -- quem pediu pela tela (id do usuário, sem FK)
  "pedido_por_user_id" integer
);
CREATE UNIQUE INDEX IF NOT EXISTS "dolores_relatorios_janela_uidx" ON "dolores_relatorios" ("janela");
CREATE INDEX IF NOT EXISTS "dolores_relatorios_criado_em_idx" ON "dolores_relatorios" ("criado_em");

-- "dolores_relatorio_reenvios": reenvio pela tela do MESMO texto gravado do relatório diário cujo envio falhou (achado 3 do
--   QA de segurança). Não monta outro relatório; janela própria por minuto ("reenvio:AAAA-MM-DDTHH:MM", única): clique duplo
--   não manda duas vezes. Só inserção. O resultado do envio fica em dolores_acoes ("relatorio_envio", pedido "relatorio:<id>").
CREATE TABLE IF NOT EXISTS "dolores_relatorio_reenvios" (
  "id" serial PRIMARY KEY NOT NULL,
  "relatorio_id" integer NOT NULL CONSTRAINT "dolores_relatorio_reenvios_relatorio_fk" REFERENCES "dolores_relatorios"("id") ON DELETE RESTRICT,
  "janela" varchar(60) NOT NULL,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  -- quem pediu pela tela (id do usuário, sem FK)
  "pedido_por_user_id" integer
);
CREATE UNIQUE INDEX IF NOT EXISTS "dolores_relatorio_reenvios_janela_uidx" ON "dolores_relatorio_reenvios" ("janela");
CREATE INDEX IF NOT EXISTS "dolores_relatorio_reenvios_relatorio_idx" ON "dolores_relatorio_reenvios" ("relatorio_id");

CREATE TABLE IF NOT EXISTS "dolores_eventos" (
  "id" serial PRIMARY KEY NOT NULL,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "tipo" varchar(30) NOT NULL CHECK ("tipo" IN ('documento_grupo', 'nota_lida', 'prazo_vencido', 'pagamento_banco')),
  -- de onde veio (tabela e id), sem copiar o dado
  "origem_tabela" varchar(60),
  "origem_id" integer,
  -- idempotência: o mesmo evento não entra duas vezes
  "chave" varchar(160) NOT NULL,
  -- contagens e ids, nunca texto de terceiro
  "resumo" jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS "dolores_eventos_chave_uidx" ON "dolores_eventos" ("chave");
CREATE INDEX IF NOT EXISTS "dolores_eventos_tipo_idx" ON "dolores_eventos" ("tipo", "criado_em");

CREATE OR REPLACE FUNCTION dolores_operacao_somente_insercao() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'DOLORES_OPERACAO_SOMENTE_INSERCAO: rondas, relatórios e eventos da Dolores não são alterados nem apagados';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dolores_rondas_guarda ON "dolores_rondas";
CREATE TRIGGER dolores_rondas_guarda BEFORE UPDATE OR DELETE ON "dolores_rondas"
  FOR EACH ROW EXECUTE FUNCTION dolores_operacao_somente_insercao();
DROP TRIGGER IF EXISTS dolores_rondas_sem_truncate ON "dolores_rondas";
CREATE TRIGGER dolores_rondas_sem_truncate BEFORE TRUNCATE ON "dolores_rondas"
  FOR EACH STATEMENT EXECUTE FUNCTION dolores_operacao_somente_insercao();
DROP TRIGGER IF EXISTS dolores_relatorios_guarda ON "dolores_relatorios";
CREATE TRIGGER dolores_relatorios_guarda BEFORE UPDATE OR DELETE ON "dolores_relatorios"
  FOR EACH ROW EXECUTE FUNCTION dolores_operacao_somente_insercao();
DROP TRIGGER IF EXISTS dolores_relatorios_sem_truncate ON "dolores_relatorios";
CREATE TRIGGER dolores_relatorios_sem_truncate BEFORE TRUNCATE ON "dolores_relatorios"
  FOR EACH STATEMENT EXECUTE FUNCTION dolores_operacao_somente_insercao();
DROP TRIGGER IF EXISTS dolores_relatorio_reenvios_guarda ON "dolores_relatorio_reenvios";
CREATE TRIGGER dolores_relatorio_reenvios_guarda BEFORE UPDATE OR DELETE ON "dolores_relatorio_reenvios"
  FOR EACH ROW EXECUTE FUNCTION dolores_operacao_somente_insercao();
DROP TRIGGER IF EXISTS dolores_relatorio_reenvios_sem_truncate ON "dolores_relatorio_reenvios";
CREATE TRIGGER dolores_relatorio_reenvios_sem_truncate BEFORE TRUNCATE ON "dolores_relatorio_reenvios"
  FOR EACH STATEMENT EXECUTE FUNCTION dolores_operacao_somente_insercao();
DROP TRIGGER IF EXISTS dolores_eventos_guarda ON "dolores_eventos";
CREATE TRIGGER dolores_eventos_guarda BEFORE UPDATE OR DELETE ON "dolores_eventos"
  FOR EACH ROW EXECUTE FUNCTION dolores_operacao_somente_insercao();
DROP TRIGGER IF EXISTS dolores_eventos_sem_truncate ON "dolores_eventos";
CREATE TRIGGER dolores_eventos_sem_truncate BEFORE TRUNCATE ON "dolores_eventos"
  FOR EACH STATEMENT EXECUTE FUNCTION dolores_operacao_somente_insercao();
