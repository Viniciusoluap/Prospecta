-- 22/11/2026 — EPIC-027 C5-E4: a Dolores avisa o dono sozinha (proatividade por REGRAS do sistema; a IA só escreve o texto).
-- Story: docs/stories/epics/epic-027-correcoes-20-11-noite/C5-E4-proatividade.md. Decisões do dono (21/11): "tudo o que achar
-- relevante", decidido por regras; só ao número dele; segunda a sábado, 07h às 20h; no máximo 6 por dia; agrupados; ele silencia
-- um tipo; função com limite próprio (a parte "avisos", 5%, da 0148).
--
-- "dolores_avisos_config" (linha única): o interruptor (DESLIGADO por padrão, como todo o resto da Dolores), a IA no texto
--   (desligada por padrão: sem ela sai o texto fixo), o teto diário (1 a 6), o intervalo mínimo entre avisos, o reaviso do mesmo
--   achado na mesma faixa e os limites N de cada regra.
-- "dolores_avisos_tipos": os tipos SILENCIADOS (sem linha = não silenciado). Muda pela tela (admin) ou pela conversa do dono, com
--   o "pode" dele.
-- "dolores_avisos_achados": o ESTADO de cada achado (tipo + entidade, chave única): a faixa atual, a faixa já avisada e quando, se
--   foi resolvido. É o que impede repetir o mesmo achado enquanto nada mudou. "dados" guarda só nome limpo (sem formatação), números
--   e marcas fixas do sistema — nunca CPF, telefone, texto de mensagem ou erro de integração.
-- "dolores_avisos_envios": um registro por aviso (dia de Brasília + ordem 1..6, ÚNICOS juntos: dois crons ao mesmo tempo nunca
--   enviam dois avisos com a mesma ordem; a ordem nunca passa de 6). "texto" é o enviado, pelo filtro do REGISTRO (dados pessoais,
--   segredos e dados bancários mascarados).
--
-- Somente ADITIVA e IDEMPOTENTE (CREATE ... IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING). Nenhuma tabela anterior muda; nenhum
-- dado existente é alterado. Reversão: DROP TABLE das quatro tabelas (sem elas, nenhum aviso sai; o resto da Dolores não muda).

CREATE TABLE IF NOT EXISTS "dolores_avisos_config" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "ligado" boolean NOT NULL DEFAULT false,
  "ia_no_texto" boolean NOT NULL DEFAULT false,
  "max_por_dia" smallint NOT NULL DEFAULT 6 CHECK ("max_por_dia" BETWEEN 1 AND 6),
  "intervalo_minutos" smallint NOT NULL DEFAULT 60 CHECK ("intervalo_minutos" BETWEEN 30 AND 240),
  "reaviso_dias" smallint NOT NULL DEFAULT 7 CHECK ("reaviso_dias" BETWEEN 0 AND 30),
  "obra_atraso_dias" smallint NOT NULL DEFAULT 3 CHECK ("obra_atraso_dias" BETWEEN 1 AND 60),
  "tarefa_vencida_dias" smallint NOT NULL DEFAULT 2 CHECK ("tarefa_vencida_dias" BETWEEN 1 AND 30),
  "documento_pendente_dias" smallint NOT NULL DEFAULT 7 CHECK ("documento_pendente_dias" BETWEEN 1 AND 90),
  "nota_confirmacao_dias" smallint NOT NULL DEFAULT 3 CHECK ("nota_confirmacao_dias" BETWEEN 1 AND 30),
  "regularizacao_parada_dias" smallint NOT NULL DEFAULT 15 CHECK ("regularizacao_parada_dias" BETWEEN 5 AND 180),
  "grupo_aguardando_horas" smallint NOT NULL DEFAULT 24 CHECK ("grupo_aguardando_horas" BETWEEN 1 AND 168),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);
INSERT INTO "dolores_avisos_config" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "dolores_avisos_tipos" (
  "tipo" varchar(30) PRIMARY KEY CHECK ("tipo" IN ('obra_atrasada', 'tarefa_vencida', 'documento_pendente', 'nota_obra', 'regularizacao_parada', 'grupo_aguardando', 'integracao', 'gasto')),
  "silenciado" boolean NOT NULL DEFAULT false,
  "via" varchar(10) NOT NULL DEFAULT 'tela' CHECK ("via" IN ('tela', 'whatsapp')),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "dolores_avisos_achados" (
  "id" serial PRIMARY KEY,
  "chave" varchar(120) NOT NULL,
  "tipo" varchar(30) NOT NULL,
  "faixa" integer NOT NULL DEFAULT 0,
  "dados" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "visto_em" timestamp with time zone NOT NULL DEFAULT now(),
  "resolvido_em" timestamp with time zone,
  "faixa_avisada" integer,
  "avisado_em" timestamp with time zone,
  "envio_id" integer
);
CREATE UNIQUE INDEX IF NOT EXISTS "dolores_avisos_achados_chave_uidx" ON "dolores_avisos_achados" ("chave");
CREATE INDEX IF NOT EXISTS "dolores_avisos_achados_tipo_idx" ON "dolores_avisos_achados" ("tipo", "resolvido_em");

CREATE TABLE IF NOT EXISTS "dolores_avisos_envios" (
  "id" serial PRIMARY KEY,
  "dia" varchar(10) NOT NULL,
  "ordem" smallint NOT NULL CHECK ("ordem" BETWEEN 1 AND 6),
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "situacao" varchar(10) NOT NULL DEFAULT 'enviando' CHECK ("situacao" IN ('enviando', 'enviado', 'falhou')),
  "texto" varchar(4000),
  "tipos" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "itens" smallint NOT NULL DEFAULT 0,
  "com_ia" boolean NOT NULL DEFAULT false,
  "motivo" varchar(200),
  "terminado_em" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "dolores_avisos_envios_dia_ordem_uidx" ON "dolores_avisos_envios" ("dia", "ordem");
CREATE INDEX IF NOT EXISTS "dolores_avisos_envios_criado_em_idx" ON "dolores_avisos_envios" ("criado_em");
