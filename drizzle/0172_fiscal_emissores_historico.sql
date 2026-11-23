-- EPIC-029 S-7 — portão de QA de 23/11/2026 (M2): histórico IMUTÁVEL das travas da empresa emissora.
-- Toda mudança em "emissao_liberada" (rota emissores.liberarEmissao), "ambiente" (rota emissores.ambiente) ou "ativo" de
-- fiscal_emissores grava uma linha por campo alterado: de → para, quem (NEW.atualizado_por) e quando. Sem CNPJ, nome ou segredo.
--
-- Só ADITIVA e IDEMPOTENTE (pode rodar duas vezes): tabela NOVA, índice NOVO, funções e gatilhos NOVOS. Nenhuma tabela, coluna
-- ou dado existente muda (o gatilho em fiscal_emissores só INSERE no histórico; não altera a linha do emissor).
-- Reversão (só com o dono): DROP TRIGGER "fiscal_emissores_historico_trg" ON "fiscal_emissores";
--   DROP TABLE "fiscal_emissores_historico"; DROP FUNCTION fiscal_emissores_historico_registrar(); DROP FUNCTION fiscal_emissores_historico_guarda();

CREATE TABLE IF NOT EXISTS "fiscal_emissores_historico" (
  "id" bigserial PRIMARY KEY,
  "emissor_id" integer NOT NULL,
  "campo" varchar(20) NOT NULL CHECK ("campo" IN ('emissao_liberada', 'ambiente', 'ativo')),
  "de" text,
  "para" text,
  "usuario_id" integer,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "fiscal_emissores_historico_emissor_idx" ON "fiscal_emissores_historico" ("emissor_id", "id");

-- Uma linha por campo alterado (IS DISTINCT FROM: UPDATE que não muda o campo não grava nada).
CREATE OR REPLACE FUNCTION fiscal_emissores_historico_registrar() RETURNS trigger AS $$
BEGIN
  IF OLD.emissao_liberada IS DISTINCT FROM NEW.emissao_liberada THEN
    INSERT INTO fiscal_emissores_historico (emissor_id, campo, de, para, usuario_id)
    VALUES (NEW.id, 'emissao_liberada', OLD.emissao_liberada::text, NEW.emissao_liberada::text, NEW.atualizado_por);
  END IF;
  IF OLD.ambiente IS DISTINCT FROM NEW.ambiente THEN
    INSERT INTO fiscal_emissores_historico (emissor_id, campo, de, para, usuario_id)
    VALUES (NEW.id, 'ambiente', OLD.ambiente::text, NEW.ambiente::text, NEW.atualizado_por);
  END IF;
  IF OLD.ativo IS DISTINCT FROM NEW.ativo THEN
    INSERT INTO fiscal_emissores_historico (emissor_id, campo, de, para, usuario_id)
    VALUES (NEW.id, 'ativo', OLD.ativo::text, NEW.ativo::text, NEW.atualizado_por);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "fiscal_emissores_historico_trg" ON "fiscal_emissores";
CREATE TRIGGER "fiscal_emissores_historico_trg" AFTER UPDATE ON "fiscal_emissores"
  FOR EACH ROW EXECUTE FUNCTION fiscal_emissores_historico_registrar();

-- O histórico só recebe inserção: UPDATE e DELETE são recusados.
CREATE OR REPLACE FUNCTION fiscal_emissores_historico_guarda() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'FISCAL_HISTORICO_IMUTAVEL';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "fiscal_emissores_historico_guarda_trg" ON "fiscal_emissores_historico";
CREATE TRIGGER "fiscal_emissores_historico_guarda_trg" BEFORE UPDATE OR DELETE ON "fiscal_emissores_historico"
  FOR EACH ROW EXECUTE FUNCTION fiscal_emissores_historico_guarda();

-- TRUNCATE também é recusado (mesmo cuidado do histórico dos certificados, 0162).
DROP TRIGGER IF EXISTS "fiscal_emissores_historico_truncate_trg" ON "fiscal_emissores_historico";
CREATE TRIGGER "fiscal_emissores_historico_truncate_trg" BEFORE TRUNCATE ON "fiscal_emissores_historico"
  FOR EACH STATEMENT EXECUTE FUNCTION fiscal_emissores_historico_guarda();
