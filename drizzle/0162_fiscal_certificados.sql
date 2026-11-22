-- EPIC-029 S-4 (22/11/2026) — cofre do certificado A1 da emissão de NFS-e (fundação; NADA é emitido por esta migração).
-- Só ADITIVA: duas tabelas novas, gatilhos novos. Nenhuma coluna existente muda; a guarda de fiscal_notas (0154), que
-- recusa EMITINDO/EMITIDA, continua como está.
--
-- "fiscal_emissores_certificado": o .pfx e a senha, cifrados SEPARADOS (AES-256-GCM, server/_core/secret-vault.ts), e só
--   o que a tela pode mostrar (titular, CNPJ, AC emissora, validade, impressão digital). Remover = desativar: a linha
--   nunca é apagada e o conteúdo cifrado nunca é trocado (certificado novo = linha nova). Um ativo por emissor.
-- "fiscal_certificados_historico": quem fez o quê e quando (enviado, desativado, teste de conexão). Sem segredo, só inserção.
--
-- Idempotente (pode rodar duas vezes). Reversão (só com o dono): DROP TABLE "fiscal_certificados_historico"; DROP TABLE "fiscal_emissores_certificado";
--   DROP FUNCTION fiscal_certificado_guarda(); DROP FUNCTION fiscal_certificados_historico_guarda();

CREATE TABLE IF NOT EXISTS "fiscal_emissores_certificado" (
  "id" serial PRIMARY KEY,
  "emissor_id" integer NOT NULL REFERENCES "fiscal_emissores" ("id"),
  "pfx_cifrado" text NOT NULL,
  "senha_cifrada" text NOT NULL,
  "titular" varchar(200) NOT NULL,
  "cnpj" varchar(14) NOT NULL,
  "autoridade" varchar(200),
  "valido_de" timestamp with time zone NOT NULL,
  "valido_ate" timestamp with time zone NOT NULL,
  "impressao_digital" varchar(64) NOT NULL CHECK ("impressao_digital" ~ '^[0-9a-f]{64}$'),
  "cadeia_icp" boolean NOT NULL DEFAULT false,
  "origem" varchar(12) NOT NULL CHECK ("origem" IN ('juridico', 'arquivo')),
  "ativo" boolean NOT NULL DEFAULT true,
  "enviado_por" integer,
  "enviado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "desativado_por" integer,
  "desativado_em" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "fiscal_emissores_certificado_ativo_uidx"
  ON "fiscal_emissores_certificado" ("emissor_id") WHERE "ativo";

-- Guarda: sem exclusão; o conteúdo (cifrado e dados lidos) nunca muda; só ativo → inativo (com quem e quando).
CREATE OR REPLACE FUNCTION fiscal_certificado_guarda() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'FISCAL_CERTIFICADO_SEM_EXCLUSAO: remover o certificado é desativar';
  END IF;
  IF NEW.emissor_id IS DISTINCT FROM OLD.emissor_id OR NEW.pfx_cifrado IS DISTINCT FROM OLD.pfx_cifrado
    OR NEW.senha_cifrada IS DISTINCT FROM OLD.senha_cifrada OR NEW.titular IS DISTINCT FROM OLD.titular
    OR NEW.cnpj IS DISTINCT FROM OLD.cnpj OR NEW.valido_de IS DISTINCT FROM OLD.valido_de
    OR NEW.valido_ate IS DISTINCT FROM OLD.valido_ate OR NEW.impressao_digital IS DISTINCT FROM OLD.impressao_digital
    OR NEW.origem IS DISTINCT FROM OLD.origem OR NEW.enviado_por IS DISTINCT FROM OLD.enviado_por
    OR NEW.enviado_em IS DISTINCT FROM OLD.enviado_em THEN
    RAISE EXCEPTION 'FISCAL_CERTIFICADO_IMUTAVEL: envie um certificado novo';
  END IF;
  IF OLD.ativo = false AND NEW.ativo = true THEN
    RAISE EXCEPTION 'FISCAL_CERTIFICADO_DESATIVADO: envie o certificado de novo';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "fiscal_certificado_guarda_trg" ON "fiscal_emissores_certificado";
CREATE TRIGGER "fiscal_certificado_guarda_trg" BEFORE UPDATE OR DELETE ON "fiscal_emissores_certificado"
  FOR EACH ROW EXECUTE FUNCTION fiscal_certificado_guarda();
DROP TRIGGER IF EXISTS "fiscal_certificado_truncate_trg" ON "fiscal_emissores_certificado";
CREATE TRIGGER "fiscal_certificado_truncate_trg" BEFORE TRUNCATE ON "fiscal_emissores_certificado"
  FOR EACH STATEMENT EXECUTE FUNCTION fiscal_certificado_guarda();

CREATE TABLE IF NOT EXISTS "fiscal_certificados_historico" (
  "id" bigserial PRIMARY KEY,
  "emissor_id" integer,
  "certificado_id" integer,
  "acao" varchar(20) NOT NULL CHECK ("acao" IN ('enviado', 'desativado', 'recusado', 'teste_conexao')),
  "detalhe" varchar(300),
  "usuario_id" integer,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "fiscal_certificados_historico_emissor_idx" ON "fiscal_certificados_historico" ("emissor_id", "id");

CREATE OR REPLACE FUNCTION fiscal_certificados_historico_guarda() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'FISCAL_CERTIFICADO_HISTORICO_IMUTAVEL';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "fiscal_certificados_historico_guarda_trg" ON "fiscal_certificados_historico";
CREATE TRIGGER "fiscal_certificados_historico_guarda_trg" BEFORE UPDATE OR DELETE ON "fiscal_certificados_historico"
  FOR EACH ROW EXECUTE FUNCTION fiscal_certificados_historico_guarda();
DROP TRIGGER IF EXISTS "fiscal_certificados_historico_truncate_trg" ON "fiscal_certificados_historico";
CREATE TRIGGER "fiscal_certificados_historico_truncate_trg" BEFORE TRUNCATE ON "fiscal_certificados_historico"
  FOR EACH STATEMENT EXECUTE FUNCTION fiscal_certificados_historico_guarda();
