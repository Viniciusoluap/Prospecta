-- 16/11/2026 — EPIC-025 (etapa 4, Grupos de clientes): grupos de WhatsApp cadastrados, o que chega neles e a classificação
-- dos documentos.
-- "dolores_grupos": um grupo da instância da Dolores (id "…@g.us") ligado pelo administrador a um cliente do CRM, a uma obra
--   ou a nenhum ainda (o card do cliente é criado depois, ao comando do dono, pela fila de aprovação). Só grupos CADASTRADOS e
--   ATIVOS são lidos; os demais continuam ignorados (nada é gravado). Nunca é apagado (desativa-se); o id do grupo e a
--   instância não mudam depois de cadastrados.
-- "dolores_grupo_mensagens": cada mensagem de grupo cadastrado (idempotente por instância + id da mensagem). Guarda SÓ o texto
--   filtrado (dados pessoais mascarados; senhas, segredos e dados bancários sempre) e os metadados da mídia — nunca o arquivo:
--   ele é baixado da Evolution sob demanda (classificação e, depois da aprovação do dono, envio ao Drive). Nunca é apagada; o
--   que chegou (texto, remetente, tipo, mídia) não muda; "salvo" é final.
-- "dolores_grupos_contagem": uma linha por grupo e dia (grupo 0 = total do dia): mensagens registradas, ignoradas pelo teto
--   (spam) e classificações pela IA. Cresce no máximo uma linha por grupo por dia.
-- "dolores_grupos_consumo_mes": tokens usados pela classificação no mês (orçamento próprio, QA E4 r2 N0).
-- "dolores_grupos_config": linha única (id = 1) — classificação pela IA (DESLIGADA por padrão), tetos diários, teto de
--   mensagens por grupo por dia, tamanho máximo do arquivo e retenção do pendente (em dias; vencida, o documento deixa de ser
--   oferecido para classificar/salvar — NADA é apagado).
-- Somente aditiva e idempotente: tabelas, índices, função e gatilhos novos (IF NOT EXISTS / OR REPLACE); a linha de configuração
-- entra com ON CONFLICT DO NOTHING. Nenhuma tabela existente é alterada.
-- Reversão: DROP TABLE "dolores_grupo_mensagens", "dolores_grupos_contagem", "dolores_grupos_consumo_mes", "dolores_grupos_config",
-- "dolores_grupos";
-- DROP FUNCTION dolores_grupos_guarda(), dolores_grupo_mensagens_guarda() (nada depende delas).

CREATE TABLE IF NOT EXISTS "dolores_grupos" (
  "id" serial PRIMARY KEY NOT NULL,
  "instancia" varchar(80) NOT NULL,
  "grupo_jid" varchar(80) NOT NULL CHECK ("grupo_jid" ~ '^[0-9]{5,40}(-[0-9]{1,20})?@g\.us$'),
  -- rótulo dado pelo administrador (não é o nome do grupo no WhatsApp, que é texto de terceiro)
  "nome" varchar(120) NOT NULL,
  "lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL,
  "obra_id" integer REFERENCES "construction_projects"("id") ON DELETE SET NULL,
  "ativo" boolean NOT NULL DEFAULT true,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "criado_por_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "dolores_grupos_um_vinculo" CHECK ("lead_id" IS NULL OR "obra_id" IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "dolores_grupos_jid_unico" ON "dolores_grupos" ("instancia", "grupo_jid");
CREATE INDEX IF NOT EXISTS "dolores_grupos_lead_idx" ON "dolores_grupos" ("lead_id");

CREATE OR REPLACE FUNCTION dolores_grupos_guarda() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'DOLORES_GRUPOS_SEM_EXCLUSAO: grupo cadastrado não é apagado (desative)';
  END IF;
  IF NEW."grupo_jid" IS DISTINCT FROM OLD."grupo_jid" OR NEW."instancia" IS DISTINCT FROM OLD."instancia"
     OR NEW."criado_em" IS DISTINCT FROM OLD."criado_em" THEN
    RAISE EXCEPTION 'DOLORES_GRUPOS_IMUTAVEL: o id do grupo e a instância não mudam depois do cadastro';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dolores_grupos_guarda ON "dolores_grupos";
CREATE TRIGGER dolores_grupos_guarda BEFORE UPDATE OR DELETE ON "dolores_grupos"
  FOR EACH ROW EXECUTE FUNCTION dolores_grupos_guarda();
DROP TRIGGER IF EXISTS dolores_grupos_sem_truncate ON "dolores_grupos";
CREATE TRIGGER dolores_grupos_sem_truncate BEFORE TRUNCATE ON "dolores_grupos"
  FOR EACH STATEMENT EXECUTE FUNCTION dolores_grupos_guarda();

CREATE TABLE IF NOT EXISTS "dolores_grupo_mensagens" (
  "id" serial PRIMARY KEY NOT NULL,
  "grupo_id" integer NOT NULL REFERENCES "dolores_grupos"("id") ON DELETE RESTRICT,
  "instancia" varchar(80) NOT NULL,
  "external_id" varchar(160) NOT NULL,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "enviada_em" timestamp with time zone,
  -- quem mandou: só mascarado; "do_dono" só para a leitura dizer "o dono escreveu no grupo" (nunca é comando)
  "remetente" varchar(30),
  "do_dono" boolean NOT NULL DEFAULT false,
  "encaminhada" boolean NOT NULL DEFAULT false,
  "tipo" varchar(12) NOT NULL CHECK ("tipo" IN ('texto', 'imagem', 'documento', 'video', 'audio', 'figurinha')),
  -- texto ou legenda, já filtrado (registro: dados pessoais mascarados)
  "texto" varchar(2000),
  "midia_mime" varchar(120),
  "midia_nome" varchar(160),
  "midia_tamanho" integer,
  "situacao" varchar(16) NOT NULL DEFAULT 'sem_documento' CHECK ("situacao" IN
    ('sem_documento', 'a_classificar', 'classificando', 'classificado', 'confira', 'grande_demais', 'formato', 'erro', 'salvo')),
  "classificacao" varchar(30) CHECK ("classificacao" IS NULL OR "classificacao" IN ('rg', 'cnh', 'comprovante_endereco',
    'comprovante_renda', 'fgts', 'certidao', 'pis', 'documento_conjuge', 'matricula', 'contrato', 'planta', 'foto_obra',
    'nota_fiscal', 'outro')),
  "confianca" numeric(4, 3) CHECK ("confianca" IS NULL OR ("confianca" >= 0 AND "confianca" <= 1)),
  "motivo" varchar(200),
  "classificado_em" timestamp with time zone,
  "modelo" varchar(120),
  "tentativas" smallint NOT NULL DEFAULT 0,
  -- reserva do limite mensal da classificação em andamento (somada às reservas dos comandos do dono)
  "reserva_entrada" integer NOT NULL DEFAULT 0,
  "reserva_saida" integer NOT NULL DEFAULT 0,
  "reserva_ate" timestamp with time zone,
  "lead_document_id" integer REFERENCES "lead_documents"("id") ON DELETE SET NULL,
  "salvo_em" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "dolores_grupo_mensagens_externa_uidx" ON "dolores_grupo_mensagens" ("instancia", "external_id");
CREATE INDEX IF NOT EXISTS "dolores_grupo_mensagens_grupo_idx" ON "dolores_grupo_mensagens" ("grupo_id", "criado_em");
CREATE INDEX IF NOT EXISTS "dolores_grupo_mensagens_pendentes_idx" ON "dolores_grupo_mensagens" ("situacao", "criado_em")
  WHERE "situacao" IN ('a_classificar', 'classificando', 'confira', 'classificado');
CREATE INDEX IF NOT EXISTS "dolores_grupo_mensagens_reserva_idx" ON "dolores_grupo_mensagens" ("reserva_ate") WHERE "reserva_ate" IS NOT NULL;

CREATE OR REPLACE FUNCTION dolores_grupo_mensagens_guarda() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'DOLORES_GRUPO_MENSAGENS_SEM_EXCLUSAO: mensagens de grupo registradas não são apagadas';
  END IF;
  -- o que chegou não muda
  IF NEW."grupo_id" IS DISTINCT FROM OLD."grupo_id" OR NEW."instancia" IS DISTINCT FROM OLD."instancia"
     OR NEW."external_id" IS DISTINCT FROM OLD."external_id" OR NEW."criado_em" IS DISTINCT FROM OLD."criado_em"
     OR NEW."enviada_em" IS DISTINCT FROM OLD."enviada_em" OR NEW."remetente" IS DISTINCT FROM OLD."remetente"
     OR NEW."do_dono" IS DISTINCT FROM OLD."do_dono" OR NEW."encaminhada" IS DISTINCT FROM OLD."encaminhada"
     OR NEW."tipo" IS DISTINCT FROM OLD."tipo" OR NEW."texto" IS DISTINCT FROM OLD."texto"
     OR NEW."midia_mime" IS DISTINCT FROM OLD."midia_mime" OR NEW."midia_nome" IS DISTINCT FROM OLD."midia_nome"
     OR NEW."midia_tamanho" IS DISTINCT FROM OLD."midia_tamanho" THEN
    RAISE EXCEPTION 'DOLORES_GRUPO_MENSAGENS_IMUTAVEL: o conteúdo registrado da mensagem não muda';
  END IF;
  -- salvo no card é final: a situação e a classificação não mudam e o vínculo com o documento não é trocado.
  -- Exceção única: o vínculo pode VIRAR NULL — é o ON DELETE SET NULL do Postgres (um UPDATE) quando o CRM exclui o
  -- documento ou o lead arquivado (exclusões legítimas que já existiam). A linha continua "salvo" (histórico).
  IF OLD."situacao" = 'salvo' AND (NEW."situacao" <> 'salvo'
     OR (NEW."lead_document_id" IS DISTINCT FROM OLD."lead_document_id" AND NEW."lead_document_id" IS NOT NULL)
     OR NEW."classificacao" IS DISTINCT FROM OLD."classificacao") THEN
    RAISE EXCEPTION 'DOLORES_GRUPO_MENSAGENS_SALVO: documento já salvo no card não muda';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dolores_grupo_mensagens_guarda ON "dolores_grupo_mensagens";
CREATE TRIGGER dolores_grupo_mensagens_guarda BEFORE UPDATE OR DELETE ON "dolores_grupo_mensagens"
  FOR EACH ROW EXECUTE FUNCTION dolores_grupo_mensagens_guarda();
DROP TRIGGER IF EXISTS dolores_grupo_mensagens_sem_truncate ON "dolores_grupo_mensagens";
CREATE TRIGGER dolores_grupo_mensagens_sem_truncate BEFORE TRUNCATE ON "dolores_grupo_mensagens"
  FOR EACH STATEMENT EXECUTE FUNCTION dolores_grupo_mensagens_guarda();

CREATE TABLE IF NOT EXISTS "dolores_grupos_contagem" (
  -- 0 = total do dia (todos os grupos), para o teto diário total de classificações
  "grupo_id" integer NOT NULL,
  -- dia civil de Imperatriz (AAAA-MM-DD)
  "dia" varchar(10) NOT NULL,
  "mensagens" integer NOT NULL DEFAULT 0,
  "ignoradas" integer NOT NULL DEFAULT 0,
  "classificacoes" integer NOT NULL DEFAULT 0,
  -- linha do GRUPO: tokens de entrada usados ACIMA da reserva naquele dia (QA E4, achado 2; r2 N3: só o grupo que causou é
  -- pausado). Maior que zero, a classificação desse grupo fica pausada até o dia seguinte (o documento continua "a classificar").
  "excesso_entrada" integer NOT NULL DEFAULT 0,
  "ultima_em" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("grupo_id", "dia")
);

CREATE TABLE IF NOT EXISTS "dolores_grupos_config" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "classificacao_ligada" boolean NOT NULL DEFAULT false,
  "teto_classificacoes_dia" integer NOT NULL DEFAULT 30 CHECK ("teto_classificacoes_dia" BETWEEN 0 AND 1000),
  "teto_classificacoes_grupo_dia" integer NOT NULL DEFAULT 10 CHECK ("teto_classificacoes_grupo_dia" BETWEEN 0 AND 200),
  "max_mensagens_grupo_dia" integer NOT NULL DEFAULT 300 CHECK ("max_mensagens_grupo_dia" BETWEEN 1 AND 5000),
  "tamanho_maximo_bytes" integer NOT NULL DEFAULT 10485760 CHECK ("tamanho_maximo_bytes" BETWEEN 1048576 AND 20971520),
  "retencao_dias" integer NOT NULL DEFAULT 30 CHECK ("retencao_dias" BETWEEN 1 AND 365),
  -- QA E4 r2, N0: orçamento PRÓPRIO da classificação, em % do limite mensal (uso real da classificação + reservas). Atingido,
  -- só a classificação para; os comandos do dono continuam com o restante do limite.
  "orcamento_classificacao_pct" integer NOT NULL DEFAULT 20 CHECK ("orcamento_classificacao_pct" BETWEEN 1 AND 50),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);

INSERT INTO "dolores_grupos_config" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

-- QA E4 r2, N0: consumo da CLASSIFICAÇÃO por mês (AAAA-MM de Imperatriz), o mesmo que também entra em "dolores_consumo".
-- Base do orçamento próprio da classificação. Uma linha por mês.
CREATE TABLE IF NOT EXISTS "dolores_grupos_consumo_mes" (
  "mes" varchar(7) PRIMARY KEY NOT NULL CHECK ("mes" ~ '^[0-9]{4}-[0-9]{2}$'),
  "tokens_entrada" bigint NOT NULL DEFAULT 0 CHECK ("tokens_entrada" >= 0),
  "tokens_saida" bigint NOT NULL DEFAULT 0 CHECK ("tokens_saida" >= 0),
  "chamadas" integer NOT NULL DEFAULT 0,
  "ultima_em" timestamp with time zone NOT NULL DEFAULT now()
);
