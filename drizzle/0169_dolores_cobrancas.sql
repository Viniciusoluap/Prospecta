-- 23/11/2026 — EPIC-025 E10: a Dolores cobra o colaborador e pede documentos ao cliente (decisão do dono de 23/11/2026).
-- Story: docs/stories/epics/epic-025-dolores/E10-cobrar-colaborador-e-pedir-documentos.md.
--
-- Número 0169: 0164–0168 estão reservadas por outras frentes (fiscal), em outras branches.
--
-- "dolores_cobrancas_config" (linha única): os dois interruptores (DESLIGADOS por padrão), os tetos diários globais, o máximo de
--   itens listados na mensagem do colaborador, o intervalo mínimo entre pedidos de documentos ao mesmo cliente (3 dias, pedido do
--   dono) e o teto de respostas de colaborador encaminhadas ao dono por dia.
-- "dolores_cobrancas_colaborador": UMA cobrança por colaborador por dia (índice único dia + usuário). "texto" é o enviado, pelo
--   filtro do REGISTRO (dados pessoais, segredos e dados bancários mascarados). Sem telefone válido: linha "sem_telefone" (vai ao
--   resumo do dono, nada é enviado).
-- "dolores_pedidos_documentos_vaga": a vaga de cada cliente (último pedido): reivindicação atômica "1 a cada N dias".
-- "dolores_pedidos_documentos": um registro por pedido enviado (índice único dia + cliente).
-- "dolores_cobrancas_respostas": a resposta do colaborador (texto do REGISTRO), encaminhada ao dono; nunca é comando.
-- "dolores_cobrancas_resumos": o resumo diário ao dono (dia único: sai uma vez por dia).
--
-- Somente ADITIVA e IDEMPOTENTE (CREATE ... IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING). Nenhuma tabela anterior muda;
-- nenhum dado existente é alterado. Reversão: DROP TABLE das seis tabelas (sem elas, nada desta etapa sai).

CREATE TABLE IF NOT EXISTS "dolores_cobrancas_config" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "colaborador_ligado" boolean NOT NULL DEFAULT false,
  "documentos_ligado" boolean NOT NULL DEFAULT false,
  "colaborador_teto_dia" smallint NOT NULL DEFAULT 30 CHECK ("colaborador_teto_dia" BETWEEN 1 AND 200),
  "documentos_teto_dia" smallint NOT NULL DEFAULT 30 CHECK ("documentos_teto_dia" BETWEEN 1 AND 200),
  "max_itens" smallint NOT NULL DEFAULT 10 CHECK ("max_itens" BETWEEN 3 AND 20),
  "documentos_intervalo_dias" smallint NOT NULL DEFAULT 3 CHECK ("documentos_intervalo_dias" BETWEEN 3 AND 30),
  "respostas_teto_dia" smallint NOT NULL DEFAULT 5 CHECK ("respostas_teto_dia" BETWEEN 1 AND 20),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);
INSERT INTO "dolores_cobrancas_config" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "dolores_cobrancas_colaborador" (
  "id" serial PRIMARY KEY,
  "dia" varchar(10) NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "situacao" varchar(16) NOT NULL DEFAULT 'enviando' CHECK ("situacao" IN ('enviando', 'enviada', 'falhou', 'sem_confirmacao', 'sem_telefone')),
  "itens" smallint NOT NULL DEFAULT 0,
  "listados" smallint NOT NULL DEFAULT 0,
  "texto" varchar(2000),
  "motivo" varchar(200),
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "terminado_em" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "dolores_cobrancas_colaborador_dia_user_uidx" ON "dolores_cobrancas_colaborador" ("dia", "user_id");
CREATE INDEX IF NOT EXISTS "dolores_cobrancas_colaborador_criado_em_idx" ON "dolores_cobrancas_colaborador" ("criado_em");

CREATE TABLE IF NOT EXISTS "dolores_pedidos_documentos_vaga" (
  "lead_id" integer PRIMARY KEY REFERENCES "leads"("id") ON DELETE CASCADE,
  "ultimo_em" timestamp with time zone NOT NULL,
  "total" integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS "dolores_pedidos_documentos" (
  "id" serial PRIMARY KEY,
  "dia" varchar(10) NOT NULL,
  "lead_id" integer NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "situacao" varchar(16) NOT NULL DEFAULT 'enviando' CHECK ("situacao" IN ('enviando', 'enviada', 'falhou', 'sem_confirmacao')),
  "documentos" smallint NOT NULL DEFAULT 0,
  "texto" varchar(2000),
  "motivo" varchar(200),
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "terminado_em" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "dolores_pedidos_documentos_dia_lead_uidx" ON "dolores_pedidos_documentos" ("dia", "lead_id");
CREATE INDEX IF NOT EXISTS "dolores_pedidos_documentos_criado_em_idx" ON "dolores_pedidos_documentos" ("criado_em");

CREATE TABLE IF NOT EXISTS "dolores_cobrancas_respostas" (
  "id" serial PRIMARY KEY,
  "cobranca_id" integer REFERENCES "dolores_cobrancas_colaborador"("id") ON DELETE SET NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "dia" varchar(10) NOT NULL,
  "external_id" varchar(160) NOT NULL,
  "texto" varchar(1000),
  "encaminhada" boolean NOT NULL DEFAULT false,
  "motivo" varchar(200),
  "criado_em" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "dolores_cobrancas_respostas_external_uidx" ON "dolores_cobrancas_respostas" ("external_id");

CREATE TABLE IF NOT EXISTS "dolores_cobrancas_resumos" (
  "id" serial PRIMARY KEY,
  "dia" varchar(10) NOT NULL,
  "situacao" varchar(10) NOT NULL DEFAULT 'enviando' CHECK ("situacao" IN ('enviando', 'enviado', 'falhou')),
  "texto" varchar(4000),
  "criado_em" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "dolores_cobrancas_resumos_dia_uidx" ON "dolores_cobrancas_resumos" ("dia");
