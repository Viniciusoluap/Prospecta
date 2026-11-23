-- EPIC-029 S-7 (22/11/2026) — fechar a emissão de NFS-e: envio da DPS, retorno, cancelamento (e101101) e DANFSe.
-- Story: docs/stories/epics/epic-029-modulo-fiscal/S-7-fechar-emissao.md. NADA é ligado por esta migração:
--   - "fiscal_emissores.emissao_liberada" nasce FALSE em todas as linhas (interruptor por emissor; nenhuma rota o liga);
--   - o ambiente continua como está (padrão "desligado"); e a constante EMISSAO_DISPONIVEL do código continua false.
--
-- Só ADITIVA e IDEMPOTENTE (pode rodar duas vezes):
--   - colunas NOVAS e opcionais (ADD COLUMN IF NOT EXISTS) em fiscal_emissores, fiscal_tipos_servico e fiscal_notas;
--   - índices únicos parciais NOVOS (dps_id; emissor + número da DPS) — só valem para linhas com DPS reservada (hoje: nenhuma);
--   - tabela NOVA "fiscal_eventos" (envio, retorno, rejeição, consulta e cancelamento; só inserção);
--   - CREATE OR REPLACE da função "fiscal_notas_guarda" (da 0154, tabela do próprio fiscal): troca o "recusa toda emissão"
--     por regras de emissão (ver abaixo). Nenhum dado existente muda; nenhuma coluna ou tabela é removida.
-- Reversão (só com o dono): DROP TABLE "fiscal_eventos"; DROP INDEX "fiscal_notas_dps_id_uidx", "fiscal_notas_numero_dps_uidx";
--   as colunas novas podem ficar (nulas/false); reaplicar a função fiscal_notas_guarda da 0154 devolve o "recusa tudo".

-- Interruptor de emissão por emissor (false = nada sai, mesmo com ambiente de testes) e parâmetros do contador da DPS que são
-- da EMPRESA (opSimpNac, regApTribSN, regEspTrib). Os do SERVIÇO (tribISSQN, tpRetISSQN, indTotTrib, IBS/CBS) ficam no tipo.
ALTER TABLE "fiscal_emissores" ADD COLUMN IF NOT EXISTS "emissao_liberada" boolean NOT NULL DEFAULT false;
ALTER TABLE "fiscal_emissores" ADD COLUMN IF NOT EXISTS "parametros_dps" jsonb;
ALTER TABLE "fiscal_tipos_servico" ADD COLUMN IF NOT EXISTS "parametros_dps" jsonb;

-- Retorno da emissão e do cancelamento.
ALTER TABLE "fiscal_notas" ADD COLUMN IF NOT EXISTS "numero_nfse" varchar(15);
ALTER TABLE "fiscal_notas" ADD COLUMN IF NOT EXISTS "ambiente_emissao" varchar(20);
ALTER TABLE "fiscal_notas" ADD COLUMN IF NOT EXISTS "emitindo_desde" timestamp with time zone;
ALTER TABLE "fiscal_notas" ADD COLUMN IF NOT EXISTS "ultimo_erro" jsonb;
ALTER TABLE "fiscal_notas" ADD COLUMN IF NOT EXISTS "cancelamento_motivo" smallint;
ALTER TABLE "fiscal_notas" ADD COLUMN IF NOT EXISTS "cancelamento_justificativa" varchar(255);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_notas_ambiente_emissao_ck') THEN
    ALTER TABLE "fiscal_notas" ADD CONSTRAINT "fiscal_notas_ambiente_emissao_ck"
      CHECK ("ambiente_emissao" IS NULL OR "ambiente_emissao" IN ('producao_restrita', 'producao'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_notas_chave_ck') THEN
    ALTER TABLE "fiscal_notas" ADD CONSTRAINT "fiscal_notas_chave_ck"
      CHECK ("chave_acesso" IS NULL OR "chave_acesso" ~ '^[0-9]{6}[0-9A-Z]{14}[0-9]{30}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_notas_dps_id_ck') THEN
    ALTER TABLE "fiscal_notas" ADD CONSTRAINT "fiscal_notas_dps_id_ck"
      CHECK ("dps_id" IS NULL OR "dps_id" ~ '^DPS[0-9]{7}(1[0-9]{14}|2[0-9A-Z]{14})[0-9]{20}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_notas_cancelamento_ck') THEN
    ALTER TABLE "fiscal_notas" ADD CONSTRAINT "fiscal_notas_cancelamento_ck" CHECK (
      ("cancelamento_motivo" IS NULL OR "cancelamento_motivo" IN (1, 2, 9))
      AND ("cancelamento_justificativa" IS NULL OR length(btrim("cancelamento_justificativa")) BETWEEN 15 AND 255));
  END IF;
END $$;

-- Idempotência no banco: um Id de DPS nunca serve a duas notas, e o número da DPS nunca se repete no mesmo emissor.
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_notas_dps_id_uidx" ON "fiscal_notas" ("dps_id") WHERE "dps_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_notas_numero_dps_uidx" ON "fiscal_notas" ("emissor_id", "numero_dps") WHERE "numero_dps" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_notas_chave_uidx" ON "fiscal_notas" ("chave_acesso") WHERE "chave_acesso" IS NOT NULL;

-- Eventos da emissão (só inserção). O XML guardado aqui é o RETORNO oficial (NFS-e autorizada, evento de cancelamento) — fica
-- no banco, nunca em log. "codigos" = só os códigos da Sefin (ex.: ["E0822"]).
CREATE TABLE IF NOT EXISTS "fiscal_eventos" (
  "id" bigserial PRIMARY KEY,
  "nota_id" integer NOT NULL REFERENCES "fiscal_notas" ("id") ON DELETE RESTRICT,
  "tipo" varchar(20) NOT NULL CHECK ("tipo" IN ('emissao', 'consulta_dps', 'cancelamento')),
  "situacao" varchar(16) NOT NULL CHECK ("situacao" IN ('autorizada', 'rejeitada', 'incerta', 'nao_encontrada')),
  "ambiente" varchar(20) NOT NULL CHECK ("ambiente" IN ('producao_restrita', 'producao')),
  "http_status" integer,
  "codigos" jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("codigos") = 'array'),
  "protocolo" varchar(60),
  "xml" text,
  "usuario_id" integer,
  "via" varchar(10) NOT NULL CHECK ("via" IN ('tela', 'whatsapp', 'sistema')),
  "criado_em" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "fiscal_eventos_nota_idx" ON "fiscal_eventos" ("nota_id", "id");
DROP TRIGGER IF EXISTS "fiscal_eventos_guarda_trg" ON "fiscal_eventos";
CREATE TRIGGER "fiscal_eventos_guarda_trg" BEFORE UPDATE OR DELETE ON "fiscal_eventos"
  FOR EACH ROW EXECUTE FUNCTION fiscal_bloquear_alteracao();
DROP TRIGGER IF EXISTS "fiscal_eventos_truncate_trg" ON "fiscal_eventos";
CREATE TRIGGER "fiscal_eventos_truncate_trg" BEFORE TRUNCATE ON "fiscal_eventos"
  FOR EACH STATEMENT EXECUTE FUNCTION fiscal_bloquear_alteracao();

-- Guarda da nota (substitui a da 0154). Regras:
--   - nunca se apaga; nasce sempre como rascunho (A_DECIDIR/ADIADA/SEM_NOTA);
--   - ENTRAR em EMITINDO exige emissor com ambiente de emissão (producao_restrita/producao) E emissao_liberada, DPS
--     reservada (dps_id + numero_dps) e ambiente_emissao igual ao do emissor;
--   - EMITIDA só vem de EMITINDO, com chave, número, XML autorizado e data (o resultado de um envio já feito é gravado mesmo
--     que o interruptor tenha sido desligado no meio);
--   - ERRO só vem de EMITINDO;
--   - Id e número da DPS, depois de reservados, nunca mudam;
--   - EMITIDA só muda para CANCELADA (com data, motivo e justificativa), e nada mais muda junto; CANCELADA nunca muda;
--   - a origem nunca muda (0154).
CREATE OR REPLACE FUNCTION fiscal_notas_guarda() RETURNS trigger AS $$
DECLARE
  livres text[] := ARRAY['status', 'cancelada_em', 'cancelada_por', 'cancelamento_motivo', 'cancelamento_justificativa',
    'versao', 'atualizado_por', 'alterado_via', 'atualizado_em'];
  em record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FISCAL_NOTA_SEM_EXCLUSAO: rascunho de nota não se apaga';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('A_DECIDIR', 'ADIADA', 'SEM_NOTA') OR NEW.dps_id IS NOT NULL OR NEW.chave_acesso IS NOT NULL THEN
      RAISE EXCEPTION 'FISCAL_EMISSAO_INDISPONIVEL: a nota nasce como rascunho';
    END IF;
    NEW.atualizado_em := now();
    RETURN NEW;
  END IF;
  -- UPDATE
  IF OLD.status = 'CANCELADA' THEN
    RAISE EXCEPTION 'FISCAL_NOTA_EMITIDA_IMUTAVEL';
  END IF;
  IF OLD.status = 'EMITIDA' THEN
    IF NEW.status <> 'CANCELADA' OR NEW.cancelada_em IS NULL OR NEW.cancelamento_motivo IS NULL OR NEW.cancelamento_justificativa IS NULL
       OR (to_jsonb(NEW) - livres) IS DISTINCT FROM (to_jsonb(OLD) - livres) THEN
      RAISE EXCEPTION 'FISCAL_NOTA_EMITIDA_IMUTAVEL';
    END IF;
    NEW.atualizado_em := now();
    RETURN NEW;
  END IF;
  IF NEW.origem_tipo IS DISTINCT FROM OLD.origem_tipo OR NEW.origem_id IS DISTINCT FROM OLD.origem_id THEN
    RAISE EXCEPTION 'FISCAL_NOTA_ORIGEM_IMUTAVEL';
  END IF;
  IF (OLD.dps_id IS NOT NULL AND NEW.dps_id IS DISTINCT FROM OLD.dps_id)
     OR (OLD.numero_dps IS NOT NULL AND NEW.numero_dps IS DISTINCT FROM OLD.numero_dps)
     OR (OLD.dps_id IS NOT NULL AND NEW.emissor_id IS DISTINCT FROM OLD.emissor_id) THEN
    RAISE EXCEPTION 'FISCAL_DPS_IMUTAVEL: o identificador da DPS reservado não muda';
  END IF;
  IF NEW.status = 'CANCELADA' THEN
    RAISE EXCEPTION 'FISCAL_EMISSAO_INDISPONIVEL: só uma nota emitida pode ser cancelada';
  END IF;
  IF NEW.chave_acesso IS DISTINCT FROM OLD.chave_acesso AND NEW.status <> 'EMITIDA' THEN
    RAISE EXCEPTION 'FISCAL_EMISSAO_INDISPONIVEL: chave só com a nota emitida';
  END IF;
  IF NEW.status = 'EMITINDO' AND OLD.status <> 'EMITINDO' THEN
    SELECT ambiente, emissao_liberada INTO em FROM fiscal_emissores WHERE id = NEW.emissor_id;
    IF NOT FOUND OR em.ambiente NOT IN ('producao_restrita', 'producao') OR NOT em.emissao_liberada
       OR NEW.ambiente_emissao IS DISTINCT FROM em.ambiente OR NEW.dps_id IS NULL OR NEW.numero_dps IS NULL THEN
      RAISE EXCEPTION 'FISCAL_EMISSAO_INDISPONIVEL: emissão não liberada para esta empresa emissora';
    END IF;
    IF OLD.status NOT IN ('A_DECIDIR', 'ADIADA', 'ERRO') THEN
      RAISE EXCEPTION 'FISCAL_EMISSAO_INDISPONIVEL: só um rascunho a decidir, adiado ou com erro vai para emissão';
    END IF;
  END IF;
  IF NEW.status = 'EMITIDA' AND (OLD.status <> 'EMITINDO' OR NEW.chave_acesso IS NULL OR NEW.xml_nfse IS NULL
       OR NEW.numero_nfse IS NULL OR NEW.emitida_em IS NULL OR NEW.dps_id IS NULL) THEN
    RAISE EXCEPTION 'FISCAL_EMISSAO_INDISPONIVEL: nota emitida precisa de chave, número e XML autorizado';
  END IF;
  IF NEW.status = 'ERRO' AND OLD.status NOT IN ('EMITINDO', 'ERRO') THEN
    RAISE EXCEPTION 'FISCAL_EMISSAO_INDISPONIVEL: erro só vem de uma emissão';
  END IF;
  IF OLD.status = 'EMITINDO' AND NEW.status NOT IN ('EMITINDO', 'EMITIDA', 'ERRO') THEN
    RAISE EXCEPTION 'FISCAL_EMISSAO_EM_ANDAMENTO: resolva a emissão antes de mudar a nota';
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Parâmetros municipais OFICIAIS lidos da Sefin Nacional com o mTLS do emissor (botão só-admin "Buscar alíquotas oficiais").
-- Uma linha por consulta (histórico; a mais recente vale). "situacao": aceita (vale na DPS), pendente (difere da alíquota
-- digitada no tipo de serviço — o admin escolhe), recusada (o admin manteve a digitada), sem_valor (o retorno não trouxe uma
-- alíquota única). Só muda a decisão de uma linha "pendente" (gatilho); nunca se apaga. O retorno é parâmetro público do
-- município (sem dado pessoal).
CREATE TABLE IF NOT EXISTS "fiscal_parametros_municipais" (
  "id" bigserial PRIMARY KEY,
  "emissor_id" integer NOT NULL REFERENCES "fiscal_emissores" ("id") ON DELETE RESTRICT,
  "tipo_servico_id" integer REFERENCES "fiscal_tipos_servico" ("id") ON DELETE RESTRICT,
  "consulta" varchar(12) NOT NULL CHECK ("consulta" IN ('aliquota', 'retencoes')),
  "municipio_ibge" varchar(7) NOT NULL CHECK ("municipio_ibge" ~ '^[0-9]{7}$'),
  "codigo_servico" varchar(9),
  "ambiente" varchar(20) NOT NULL CHECK ("ambiente" IN ('producao_restrita', 'producao')),
  "http_status" integer,
  "aliquota" numeric(7,4) CHECK ("aliquota" IS NULL OR ("aliquota" >= 0 AND "aliquota" <= 100)),
  "aliquota_digitada" numeric(7,4),
  "situacao" varchar(10) NOT NULL CHECK ("situacao" IN ('aceita', 'pendente', 'recusada', 'sem_valor')),
  "origem" varchar(10) NOT NULL DEFAULT 'sefin' CHECK ("origem" = 'sefin'),
  "retorno" jsonb,
  "consultado_por" integer,
  "consultado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "decidido_por" integer,
  "decidido_em" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "fiscal_parametros_municipais_busca_idx"
  ON "fiscal_parametros_municipais" ("consulta", "municipio_ibge", "codigo_servico", "id");

CREATE OR REPLACE FUNCTION fiscal_parametros_municipais_guarda() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FISCAL_IMUTAVEL: fiscal_parametros_municipais não aceita DELETE';
  END IF;
  IF OLD.situacao <> 'pendente' OR NEW.situacao NOT IN ('aceita', 'recusada') OR NEW.decidido_em IS NULL
     OR (to_jsonb(NEW) - ARRAY['situacao', 'decidido_por', 'decidido_em']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['situacao', 'decidido_por', 'decidido_em']) THEN
    RAISE EXCEPTION 'FISCAL_IMUTAVEL: só a escolha de uma alíquota pendente muda';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "fiscal_parametros_municipais_guarda_trg" ON "fiscal_parametros_municipais";
CREATE TRIGGER "fiscal_parametros_municipais_guarda_trg" BEFORE UPDATE OR DELETE ON "fiscal_parametros_municipais"
  FOR EACH ROW EXECUTE FUNCTION fiscal_parametros_municipais_guarda();
DROP TRIGGER IF EXISTS "fiscal_parametros_municipais_truncate_trg" ON "fiscal_parametros_municipais";
CREATE TRIGGER "fiscal_parametros_municipais_truncate_trg" BEFORE TRUNCATE ON "fiscal_parametros_municipais"
  FOR EACH STATEMENT EXECUTE FUNCTION fiscal_bloquear_alteracao();
