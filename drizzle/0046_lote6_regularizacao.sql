-- EPIC-020 Lote 6 — Regularização (itens 30 e 31).
-- 30: Status do Processo (em_analise, em_andamento, concluido) + Etapas livres.
-- 31: tabela financeira por processo (17 itens iniciais) com recebimentos
--     manuais ou do BPO, parciais e com histórico.
-- Somente aditiva: "Valor Pago" (paid_value) e os documentos antigos ficam no
-- banco; o status antigo fica preservado em legacy_status. Idempotente.

ALTER TABLE "regularizacoes" ADD COLUMN IF NOT EXISTS "legacy_status" varchar(40);--> statement-breakpoint
UPDATE "regularizacoes" SET "legacy_status" = "status"
  WHERE "legacy_status" IS NULL AND "status" NOT IN ('em_analise', 'em_andamento', 'concluido', 'cancelado');--> statement-breakpoint
UPDATE "regularizacoes" SET "status" = CASE "status"
    WHEN 'analysis' THEN 'em_analise'
    WHEN 'documentation' THEN 'em_andamento'
    WHEN 'protocol' THEN 'em_andamento'
    WHEN 'registry' THEN 'em_andamento'
    WHEN 'completed' THEN 'concluido'
    WHEN 'cancelled' THEN 'cancelado'
    ELSE 'em_analise'
  END
  WHERE "status" NOT IN ('em_analise', 'em_andamento', 'concluido', 'cancelado');--> statement-breakpoint
ALTER TABLE "regularizacoes" ALTER COLUMN "status" SET DEFAULT 'em_analise';--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "regularizacoes" ADD CONSTRAINT "regularizacoes_status_chk"
    CHECK ("status" IN ('em_analise', 'em_andamento', 'concluido', 'cancelado'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "regularizacao_etapas" (
  "id" serial PRIMARY KEY,
  "regularizacao_id" integer NOT NULL REFERENCES "regularizacoes"("id") ON DELETE CASCADE,
  "nome" varchar(120) NOT NULL,
  "ordem" integer NOT NULL,
  "progresso" integer DEFAULT 0 NOT NULL CHECK ("progresso" BETWEEN 0 AND 100),
  "observacoes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "regularizacao_etapas_reg_idx" ON "regularizacao_etapas" ("regularizacao_id", "ordem");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "regularizacao_itens_financeiros" (
  "id" serial PRIMARY KEY,
  "regularizacao_id" integer NOT NULL REFERENCES "regularizacoes"("id") ON DELETE CASCADE,
  "chave_padrao" varchar(40),
  "nome" varchar(120) NOT NULL,
  "grupo" varchar(20) NOT NULL CHECK ("grupo" IN ('durante_obra', 'casa_pronta')),
  "ordem" integer NOT NULL,
  "previsto" numeric(15, 2) DEFAULT 0 NOT NULL CHECK ("previsto" >= 0),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "regularizacao_itens_id_reg_unique" UNIQUE ("id", "regularizacao_id")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "regularizacao_itens_padrao_idx" ON "regularizacao_itens_financeiros" ("regularizacao_id", "chave_padrao") WHERE "chave_padrao" IS NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "regularizacao_recebimentos" (
  "id" serial PRIMARY KEY,
  "regularizacao_id" integer NOT NULL REFERENCES "regularizacoes"("id") ON DELETE RESTRICT,
  "item_id" integer NOT NULL,
  "valor" numeric(15, 2) NOT NULL CHECK ("valor" > 0),
  "data" date NOT NULL,
  "observacao" text,
  "origem" varchar(12) NOT NULL CHECK ("origem" IN ('manual', 'bpo', 'migracao')),
  "bpo_lancamento_id" integer REFERENCES "bpo_lancamentos"("id") ON DELETE RESTRICT,
  "status" varchar(12) DEFAULT 'confirmado' NOT NULL CHECK ("status" IN ('confirmado', 'cancelado')),
  "motivo_cancelamento" text,
  "criado_por" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "regularizacao_recebimentos_item_fk" FOREIGN KEY ("item_id", "regularizacao_id")
    REFERENCES "regularizacao_itens_financeiros"("id", "regularizacao_id") ON DELETE RESTRICT,
  CONSTRAINT "regularizacao_recebimentos_origem_bpo" CHECK (("origem" = 'bpo') = ("bpo_lancamento_id" IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "regularizacao_recebimentos_reg_idx" ON "regularizacao_recebimentos" ("regularizacao_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "regularizacao_recebimentos_bpo_idx" ON "regularizacao_recebimentos" ("bpo_lancamento_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "regularizacao_recebimentos_historico" (
  "id" serial PRIMARY KEY,
  "recebimento_id" integer NOT NULL REFERENCES "regularizacao_recebimentos"("id") ON DELETE RESTRICT,
  "acao" varchar(20) NOT NULL,
  "antes" jsonb,
  "depois" jsonb NOT NULL,
  "usuario_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Uma transação do BPO é uma só: a soma do que foi alocado em obras E em
-- regularizações nunca passa do valor dela (mesmo lock nas duas tabelas).
CREATE OR REPLACE FUNCTION bpo_valor_alocado(lancamento integer, mov_excluido integer, rec_excluido integer) RETURNS numeric AS $$
  SELECT COALESCE((SELECT SUM(valor) FROM obra_movimentos
      WHERE bpo_lancamento_id = lancamento AND status = 'confirmado' AND id IS DISTINCT FROM mov_excluido), 0)
    + COALESCE((SELECT SUM(valor) FROM regularizacao_recebimentos
      WHERE bpo_lancamento_id = lancamento AND status = 'confirmado' AND id IS DISTINCT FROM rec_excluido), 0);
$$ LANGUAGE sql STABLE;--> statement-breakpoint

CREATE OR REPLACE FUNCTION obra_movimentos_guarda() RETURNS trigger AS $$
DECLARE
  lanc record;
  alocado numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'MOVIMENTO_NAO_PODE_SER_APAGADO: cancele o movimento para preservar o histórico';
  END IF;
  IF NEW.bpo_lancamento_id IS NOT NULL AND NEW.status = 'confirmado' THEN
    PERFORM pg_advisory_xact_lock(hashtext('bpo_lancamento:' || NEW.bpo_lancamento_id));
    SELECT id, valor, pago, tipo INTO lanc FROM bpo_lancamentos WHERE id = NEW.bpo_lancamento_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'BPO_LANCAMENTO_INEXISTENTE'; END IF;
    IF NOT lanc.pago THEN RAISE EXCEPTION 'BPO_LANCAMENTO_NAO_PAGO: só lançamentos pagos/recebidos podem ser vinculados'; END IF;
    IF (NEW.natureza = 'pagamento') <> (lanc.tipo::text = 'despesa') THEN
      RAISE EXCEPTION 'BPO_NATUREZA_INCOMPATIVEL: pagamentos usam despesas do BPO; recebimentos usam receitas';
    END IF;
    alocado := bpo_valor_alocado(NEW.bpo_lancamento_id, NEW.id, NULL);
    IF alocado + NEW.valor > lanc.valor THEN
      RAISE EXCEPTION 'BPO_ALOCACAO_EXCEDIDA: disponível R$ %', lanc.valor - alocado;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE OR REPLACE FUNCTION regularizacao_recebimentos_guarda() RETURNS trigger AS $$
DECLARE
  lanc record;
  alocado numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'RECEBIMENTO_NAO_PODE_SER_APAGADO: cancele o recebimento para preservar o histórico';
  END IF;
  IF NEW.bpo_lancamento_id IS NOT NULL AND NEW.status = 'confirmado' THEN
    PERFORM pg_advisory_xact_lock(hashtext('bpo_lancamento:' || NEW.bpo_lancamento_id));
    SELECT id, valor, pago, tipo INTO lanc FROM bpo_lancamentos WHERE id = NEW.bpo_lancamento_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'BPO_LANCAMENTO_INEXISTENTE'; END IF;
    IF NOT lanc.pago THEN RAISE EXCEPTION 'BPO_LANCAMENTO_NAO_PAGO: só lançamentos pagos/recebidos podem ser vinculados'; END IF;
    IF lanc.tipo::text = 'despesa' THEN
      RAISE EXCEPTION 'BPO_NATUREZA_INCOMPATIVEL: recebimentos usam receitas do BPO';
    END IF;
    alocado := bpo_valor_alocado(NEW.bpo_lancamento_id, NULL, NEW.id);
    IF alocado + NEW.valor > lanc.valor THEN
      RAISE EXCEPTION 'BPO_ALOCACAO_EXCEDIDA: disponível R$ %', lanc.valor - alocado;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE OR REPLACE FUNCTION regularizacao_recebimentos_historico_registrar() RETURNS trigger AS $$
BEGIN
  INSERT INTO regularizacao_recebimentos_historico (recebimento_id, acao, antes, depois, usuario_id)
  VALUES (
    NEW.id,
    CASE
      WHEN TG_OP = 'INSERT' THEN 'criado'
      WHEN OLD.status <> NEW.status AND NEW.status = 'cancelado' THEN 'cancelado'
      WHEN OLD.status <> NEW.status THEN 'reativado'
      ELSE 'editado'
    END,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END,
    to_jsonb(NEW),
    COALESCE(NEW.atualizado_por, NEW.criado_por)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS regularizacao_recebimentos_guarda_trg ON regularizacao_recebimentos;--> statement-breakpoint
CREATE TRIGGER regularizacao_recebimentos_guarda_trg BEFORE INSERT OR UPDATE OR DELETE ON regularizacao_recebimentos
  FOR EACH ROW EXECUTE FUNCTION regularizacao_recebimentos_guarda();--> statement-breakpoint
DROP TRIGGER IF EXISTS regularizacao_recebimentos_historico_trg ON regularizacao_recebimentos;--> statement-breakpoint
CREATE TRIGGER regularizacao_recebimentos_historico_trg AFTER INSERT OR UPDATE ON regularizacao_recebimentos
  FOR EACH ROW EXECUTE FUNCTION regularizacao_recebimentos_historico_registrar();--> statement-breakpoint

-- Item com recebimento (mesmo cancelado) não é excluído: o histórico fica.
CREATE OR REPLACE FUNCTION regularizacao_itens_guarda() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM regularizacao_recebimentos WHERE item_id = OLD.id) THEN
    RAISE EXCEPTION 'ITEM_COM_RECEBIMENTOS';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS regularizacao_itens_guarda_trg ON regularizacao_itens_financeiros;--> statement-breakpoint
CREATE TRIGGER regularizacao_itens_guarda_trg BEFORE DELETE ON regularizacao_itens_financeiros
  FOR EACH ROW EXECUTE FUNCTION regularizacao_itens_guarda();--> statement-breakpoint

-- Os 17 itens iniciais (mesma lista de shared/financeiro/regularizacao.ts),
-- criados para todo processo — existente ou novo, venha de onde vier.
CREATE OR REPLACE FUNCTION regularizacao_semear_itens(reg integer) RETURNS void AS $$
  INSERT INTO regularizacao_itens_financeiros (regularizacao_id, chave_padrao, nome, grupo, ordem)
  SELECT reg, v.chave, v.nome, v.grupo, v.ordem FROM (VALUES
    ('projetos', 'Projetos', 'durante_obra', 1),
    ('pci', 'PCI', 'durante_obra', 2),
    ('impressoes', 'Impressões', 'durante_obra', 3),
    ('agua', 'Água', 'durante_obra', 4),
    ('despachante', 'Despachante', 'durante_obra', 5),
    ('cert_inteiro_teor', 'Cert. Inteiro Teor', 'durante_obra', 6),
    ('art', 'ART', 'durante_obra', 7),
    ('alvara', 'Alvará', 'durante_obra', 8),
    ('vistoria_cef', 'Vistoria CEF', 'durante_obra', 9),
    ('tx_ass_cef', 'Tx Ass CEF', 'durante_obra', 10),
    ('seguro_cef', 'Seguro CEF', 'durante_obra', 11),
    ('itbi', 'ITBI', 'durante_obra', 12),
    ('registro_cartorio', 'Registro Cartório', 'durante_obra', 13),
    ('encargos_obra', 'Encargos de Obra', 'durante_obra', 14),
    ('habite_se', 'Habite-se', 'casa_pronta', 15),
    ('cnd_cno', 'CND e CNO', 'casa_pronta', 16),
    ('averbacao', 'Averbação', 'casa_pronta', 17)
  ) AS v(chave, nome, grupo, ordem)
  ON CONFLICT ("regularizacao_id", "chave_padrao") WHERE "chave_padrao" IS NOT NULL DO NOTHING;
$$ LANGUAGE sql;--> statement-breakpoint

CREATE OR REPLACE FUNCTION regularizacoes_semear_trg_fn() RETURNS trigger AS $$
BEGIN
  PERFORM regularizacao_semear_itens(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS regularizacoes_semear_trg ON regularizacoes;--> statement-breakpoint
CREATE TRIGGER regularizacoes_semear_trg AFTER INSERT ON regularizacoes
  FOR EACH ROW EXECUTE FUNCTION regularizacoes_semear_trg_fn();--> statement-breakpoint

SELECT regularizacao_semear_itens(id) FROM regularizacoes;--> statement-breakpoint

-- "Valor Pago" antigo (preenchido à mão, sem datas): vira um item próprio com
-- um único recebimento 'migracao', para o valor continuar no total recebido.
INSERT INTO regularizacao_itens_financeiros (regularizacao_id, chave_padrao, nome, grupo, ordem, previsto)
SELECT id, 'valor_pago_anterior', 'Valor pago anteriormente (migrado, sem detalhamento)', 'durante_obra', 99, paid_value
FROM regularizacoes WHERE paid_value > 0
ON CONFLICT ("regularizacao_id", "chave_padrao") WHERE "chave_padrao" IS NOT NULL DO NOTHING;--> statement-breakpoint
INSERT INTO regularizacao_recebimentos (regularizacao_id, item_id, valor, data, observacao, origem)
SELECT r.id, i.id, r.paid_value, CURRENT_DATE,
  'Valor pago informado na tela anterior, sem histórico de datas.', 'migracao'
FROM regularizacoes r
JOIN regularizacao_itens_financeiros i ON i.regularizacao_id = r.id AND i.chave_padrao = 'valor_pago_anterior'
WHERE r.paid_value > 0
  AND NOT EXISTS (SELECT 1 FROM regularizacao_recebimentos x WHERE x.item_id = i.id AND x.origem = 'migracao');
