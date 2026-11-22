-- 22/11/2026 — EPIC-029 (Módulo Fiscal), etapa 2 "rascunhos de nota (sem emitir nada)".
-- Story: docs/stories/epics/epic-029-modulo-fiscal/S-2-rascunhos.md. Mapa campo a campo: DIAGNOSTICO.md §7.1.
--
-- Tudo fica dentro da aba "Contabilidade" do BPO (decisão do dono k: "para não termos campos redundantes"):
--   - "fiscal_emissores": SÓ o complemento fiscal de um perfil tributário que já existe (tax_profiles), ligado pelo CNPJ.
--     Razão social e regime NÃO ficam aqui: são lidos do perfil vigente daquele CNPJ. Um por CNPJ (multi-CNPJ desde o início).
--   - "fiscal_tipos_servico": códigos/alíquotas do contador (nascem nulos, "a preencher") e o mapa de origens. Regra só
--     'sempre_perguntar' ou 'nunca_gerar' (decisão h: "automático" não existe nesta etapa).
--   - "fiscal_notas": um rascunho por origem (chave única origem_tipo + origem_id). O tomador, o valor, a competência e o
--     centro de custo NÃO são copiados: a nota guarda só a REFERÊNCIA (cliente do BPO / card do CRM / obra) e um ajuste,
--     se o dono editar. As colunas de emissão (dps, chave, xml, congelado…) ficam reservadas e nulas até a S-4.
--   - "fiscal_notas_historico": histórico imutável de cada nota (quem, o quê, quando), gravado pelo gatilho.
--   - "fiscal_config": linha única — gerador ligado/desligado (padrão desligado) e a data de corte da varredura.
--
-- Somente ADITIVA e IDEMPOTENTE: só CREATE ... IF NOT EXISTS, CREATE OR REPLACE (funções/gatilhos das tabelas NOVAS) e
-- INSERT dos tipos de serviço iniciais na tabela nova (ON CONFLICT DO NOTHING). Nenhuma tabela existente é alterada e
-- nenhum dado existente muda. Sem chave estrangeira para tabelas existentes (as referências são conferidas pelo servidor),
-- para não travar nem prender tabela nenhuma de produção.
-- Reversão: DROP TABLE fiscal_notas_historico, fiscal_notas, fiscal_tipos_servico, fiscal_emissores, fiscal_config
-- (e as funções fiscal_*); nada fora do fiscal depende delas.

CREATE TABLE IF NOT EXISTS "fiscal_config" (
  "id" boolean PRIMARY KEY DEFAULT true CHECK ("id"),
  "ligado" boolean NOT NULL DEFAULT false,
  "inicio_em" date NOT NULL,
  "ultima_varredura_em" timestamp with time zone,
  "atualizado_por" integer,
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fiscal_emissores" (
  "id" serial PRIMARY KEY,
  "cnpj" varchar(14) NOT NULL CHECK ("cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  "municipio_nome" varchar(100),
  "municipio_uf" varchar(2) CHECK ("municipio_uf" IS NULL OR "municipio_uf" ~ '^[A-Z]{2}$'),
  "municipio_ibge" varchar(7) CHECK ("municipio_ibge" IS NULL OR "municipio_ibge" ~ '^[0-9]{7}$'),
  "inscricao_municipal" varchar(30),
  "serie_dps" varchar(5) CHECK ("serie_dps" IS NULL OR "serie_dps" ~ '^[0-9]{1,5}$'),
  "proximo_numero_dps" bigint NOT NULL DEFAULT 1 CHECK ("proximo_numero_dps" > 0),
  "ambiente" varchar(20) NOT NULL DEFAULT 'desligado' CHECK ("ambiente" IN ('desligado', 'producao_restrita', 'producao')),
  "ativo" boolean NOT NULL DEFAULT true,
  "criado_por" integer,
  "atualizado_por" integer,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_emissores_cnpj_uq" ON "fiscal_emissores" ("cnpj");

CREATE TABLE IF NOT EXISTS "fiscal_tipos_servico" (
  "id" serial PRIMARY KEY,
  "nome" varchar(120) NOT NULL,
  "emissor_id" integer REFERENCES "fiscal_emissores"("id") ON DELETE RESTRICT,
  "codigo_tributacao_nacional" varchar(6) CHECK ("codigo_tributacao_nacional" IS NULL OR "codigo_tributacao_nacional" ~ '^[0-9]{6}$'),
  "codigo_nbs" varchar(9) CHECK ("codigo_nbs" IS NULL OR "codigo_nbs" ~ '^[0-9]{9}$'),
  "item_lc116" varchar(5) CHECK ("item_lc116" IS NULL OR "item_lc116" ~ '^[0-9]{1,2}\.[0-9]{2}$'),
  "descricao_padrao" text CHECK ("descricao_padrao" IS NULL OR length("descricao_padrao") <= 2000),
  "aliquota_iss" numeric(7,4) CHECK ("aliquota_iss" IS NULL OR ("aliquota_iss" >= 0 AND "aliquota_iss" <= 100)),
  "retencoes" jsonb,
  "regra" varchar(20) NOT NULL DEFAULT 'sempre_perguntar' CHECK ("regra" IN ('sempre_perguntar', 'nunca_gerar')),
  "origens" jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("origens") = 'array'),
  "ativo" boolean NOT NULL DEFAULT true,
  "atualizado_por" integer,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_tipos_servico_nome_uq" ON "fiscal_tipos_servico" ("nome");

-- Tipos iniciais: todos "sempre perguntar", códigos e alíquotas nulos (a preencher pelo contador).
INSERT INTO "fiscal_tipos_servico" ("nome", "origens") VALUES
  ('Assessoria e honorários (BPO)', '["bpo_lancamento:honorario"]'::jsonb),
  ('Outras receitas do BPO', '["bpo_lancamento:receita", "bpo_lancamento:reembolso"]'::jsonb),
  ('Recebimento de obra', '["obra_movimento:*"]'::jsonb),
  ('Regularização e despachante', '["regularizacao_recebimento:*"]'::jsonb),
  ('Avaliação de imóvel', '["avaliacao:*"]'::jsonb),
  ('Comissão de correspondente', '["comissao_empresa:*"]'::jsonb)
ON CONFLICT ("nome") DO NOTHING;

CREATE TABLE IF NOT EXISTS "fiscal_notas" (
  "id" serial PRIMARY KEY,
  "emissor_id" integer REFERENCES "fiscal_emissores"("id") ON DELETE RESTRICT,
  "tipo_servico_id" integer REFERENCES "fiscal_tipos_servico"("id") ON DELETE RESTRICT,
  "origem_tipo" varchar(30) NOT NULL CHECK ("origem_tipo" IN
    ('bpo_lancamento', 'obra_movimento', 'regularizacao_recebimento', 'avaliacao', 'comissao_empresa')),
  "origem_id" integer NOT NULL,
  "origem_subtipo" varchar(40),
  "data_evento" date NOT NULL,
  -- Referências (nunca cópia) do tomador e da obra/serviço.
  "bpo_client_id" integer,
  "lead_id" integer,
  "obra_id" integer,
  "lead_service_id" integer,
  -- Ajustes feitos pelo dono (nulo = vale o da origem / o calculado).
  "valor_ajustado_centavos" bigint CHECK ("valor_ajustado_centavos" IS NULL OR "valor_ajustado_centavos" > 0),
  "descricao_ajustada" text CHECK ("descricao_ajustada" IS NULL OR length("descricao_ajustada") <= 2000),
  "municipio_incidencia_nome" varchar(100),
  "municipio_incidencia_uf" varchar(2) CHECK ("municipio_incidencia_uf" IS NULL OR "municipio_incidencia_uf" ~ '^[A-Z]{2}$'),
  "municipio_incidencia_ibge" varchar(7) CHECK ("municipio_incidencia_ibge" IS NULL OR "municipio_incidencia_ibge" ~ '^[0-9]{7}$'),
  "status" varchar(12) NOT NULL DEFAULT 'A_DECIDIR' CHECK ("status" IN
    ('A_DECIDIR', 'ADIADA', 'SEM_NOTA', 'EMITINDO', 'EMITIDA', 'CANCELADA', 'ERRO')),
  "motivo_sem_nota" varchar(30) CHECK ("motivo_sem_nota" IS NULL OR "motivo_sem_nota" IN
    ('reembolso_custas', 'itbi_repassado', 'taxa_caixa_repassada', 'servico_nao_faturavel', 'emitida_fora', 'outro')),
  "motivo_texto" text CHECK ("motivo_texto" IS NULL OR length("motivo_texto") <= 500),
  "motivo_sugerido" varchar(30) CHECK ("motivo_sugerido" IS NULL OR "motivo_sugerido" IN
    ('reembolso_custas', 'itbi_repassado', 'taxa_caixa_repassada', 'servico_nao_faturavel', 'emitida_fora', 'outro')),
  "adiada_ate" date,
  "alerta" text,
  "versao" integer NOT NULL DEFAULT 1,
  "decidida_por" integer,
  "decidida_em" timestamp with time zone,
  "atualizado_por" integer,
  "alterado_via" varchar(10) NOT NULL DEFAULT 'sistema' CHECK ("alterado_via" IN ('tela', 'whatsapp', 'sistema')),
  -- Reservado para a S-4 (emissão); nulo nesta etapa.
  "dps_id" varchar(60),
  "numero_dps" bigint,
  "chave_acesso" varchar(50),
  "xml_dps" text,
  "xml_nfse" text,
  "protocolo" varchar(60),
  "ibscbs" jsonb,
  "congelado" jsonb,
  "emitida_em" timestamp with time zone,
  "emitida_por" integer,
  "cancelada_em" timestamp with time zone,
  "cancelada_por" integer,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "fiscal_notas_sem_nota_tem_motivo" CHECK ("status" <> 'SEM_NOTA' OR "motivo_sem_nota" IS NOT NULL),
  CONSTRAINT "fiscal_notas_outro_tem_texto" CHECK (
    "motivo_sem_nota" IS DISTINCT FROM 'outro' OR length(btrim(coalesce("motivo_texto", ''))) >= 3
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_notas_origem_uq" ON "fiscal_notas" ("origem_tipo", "origem_id");
CREATE INDEX IF NOT EXISTS "fiscal_notas_status_idx" ON "fiscal_notas" ("status", "data_evento");
CREATE INDEX IF NOT EXISTS "fiscal_notas_emissor_idx" ON "fiscal_notas" ("emissor_id");

CREATE TABLE IF NOT EXISTS "fiscal_notas_historico" (
  "id" bigserial PRIMARY KEY,
  "nota_id" integer NOT NULL REFERENCES "fiscal_notas"("id") ON DELETE RESTRICT,
  "acao" varchar(20) NOT NULL,
  "antes" jsonb,
  "depois" jsonb NOT NULL,
  "usuario_id" integer,
  "via" varchar(10) NOT NULL CHECK ("via" IN ('tela', 'whatsapp', 'sistema')),
  "criado_em" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "fiscal_notas_historico_nota_idx" ON "fiscal_notas_historico" ("nota_id", "id");

-- Guarda da nota: nunca é apagada; nesta etapa nenhuma nota pode ir para emissão (EMITINDO/EMITIDA/CANCELADA/ERRO só
-- com a S-4, que troca esta função); a origem não muda; o que foi emitido nunca muda.
CREATE OR REPLACE FUNCTION fiscal_notas_guarda() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FISCAL_NOTA_SEM_EXCLUSAO: rascunho de nota não se apaga';
  END IF;
  IF NEW.status IN ('EMITINDO', 'EMITIDA', 'CANCELADA', 'ERRO') THEN
    RAISE EXCEPTION 'FISCAL_EMISSAO_INDISPONIVEL: emissão disponível após a homologação';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('EMITIDA', 'CANCELADA') THEN
      RAISE EXCEPTION 'FISCAL_NOTA_EMITIDA_IMUTAVEL';
    END IF;
    IF NEW.origem_tipo IS DISTINCT FROM OLD.origem_tipo OR NEW.origem_id IS DISTINCT FROM OLD.origem_id THEN
      RAISE EXCEPTION 'FISCAL_NOTA_ORIGEM_IMUTAVEL';
    END IF;
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fiscal_notas_historico_registrar() RETURNS trigger AS $$
BEGIN
  INSERT INTO fiscal_notas_historico (nota_id, acao, antes, depois, usuario_id, via)
  VALUES (
    NEW.id,
    CASE
      WHEN TG_OP = 'INSERT' THEN 'criada'
      WHEN OLD.status IS DISTINCT FROM NEW.status THEN lower(NEW.status)
      ELSE 'editada'
    END,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END,
    to_jsonb(NEW),
    NEW.atualizado_por,
    NEW.alterado_via
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fiscal_bloquear_alteracao() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'FISCAL_IMUTAVEL: % não aceita % (histórico só recebe linhas novas)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER "fiscal_notas_guarda_trg" BEFORE INSERT OR UPDATE OR DELETE ON "fiscal_notas"
  FOR EACH ROW EXECUTE FUNCTION fiscal_notas_guarda();
CREATE OR REPLACE TRIGGER "fiscal_notas_truncate_trg" BEFORE TRUNCATE ON "fiscal_notas"
  FOR EACH STATEMENT EXECUTE FUNCTION fiscal_bloquear_alteracao();
CREATE OR REPLACE TRIGGER "fiscal_notas_historico_trg" AFTER INSERT OR UPDATE ON "fiscal_notas"
  FOR EACH ROW EXECUTE FUNCTION fiscal_notas_historico_registrar();
CREATE OR REPLACE TRIGGER "fiscal_notas_historico_guarda_trg" BEFORE UPDATE OR DELETE ON "fiscal_notas_historico"
  FOR EACH ROW EXECUTE FUNCTION fiscal_bloquear_alteracao();
CREATE OR REPLACE TRIGGER "fiscal_notas_historico_truncate_trg" BEFORE TRUNCATE ON "fiscal_notas_historico"
  FOR EACH STATEMENT EXECUTE FUNCTION fiscal_bloquear_alteracao();
