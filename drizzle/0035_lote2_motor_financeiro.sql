-- EPIC-020 Lote 2 — Motor financeiro da Obra (Valores da Operação e Custos).
-- Somente aditiva. Nenhuma coluna ou registro existente é apagado: campos que
-- deixaram de ser editáveis continuam no banco com o valor original.
-- PRÉ-REQUISITO DE DEPLOY: aplicar antes de publicar o código.

ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'empreiteiro';--> statement-breakpoint

ALTER TABLE "construction_projects" ADD COLUMN IF NOT EXISTS "commission_amount" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "construction_projects" ADD COLUMN IF NOT EXISTS "contractor_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "construction_projects" ADD COLUMN IF NOT EXISTS "contractor_share_pct" numeric(9, 6);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "construction_projects" ADD CONSTRAINT "construction_projects_contractor_share_pct_range"
    CHECK ("contractor_share_pct" IS NULL OR ("contractor_share_pct" >= 0 AND "contractor_share_pct" <= 100));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "investidores" (
  "id" serial PRIMARY KEY,
  "nome" varchar(255) NOT NULL,
  "documento" varchar(20),
  "telefone" varchar(30),
  "email" varchar(320),
  "ativo" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "obra_investidores" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL REFERENCES "construction_projects"("id") ON DELETE CASCADE,
  "investidor_id" integer NOT NULL REFERENCES "investidores"("id") ON DELETE RESTRICT,
  "percentual" numeric(9, 6) NOT NULL CHECK ("percentual" >= 0 AND "percentual" <= 100),
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "obra_investidores_unique" UNIQUE ("project_id", "investidor_id")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "obra_movimentos" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL REFERENCES "construction_projects"("id") ON DELETE RESTRICT,
  "natureza" varchar(20) NOT NULL CHECK ("natureza" IN ('entrada', 'recebimento_cef', 'pagamento')),
  "categoria" varchar(30) CHECK ("categoria" IS NULL OR "categoria" IN ('terreno', 'comissao', 'empreiteiro', 'fornecedor', 'outros', 'nao_detalhado')),
  "descricao" varchar(255) NOT NULL,
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
  CONSTRAINT "obra_movimentos_origem_bpo" CHECK (("origem" = 'bpo') = ("bpo_lancamento_id" IS NOT NULL)),
  CONSTRAINT "obra_movimentos_categoria_pagamento" CHECK (("natureza" = 'pagamento') = ("categoria" IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obra_movimentos_project_idx" ON "obra_movimentos" ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "obra_movimentos_bpo_idx" ON "obra_movimentos" ("bpo_lancamento_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "obra_movimentos_historico" (
  "id" serial PRIMARY KEY,
  "movimento_id" integer NOT NULL REFERENCES "obra_movimentos"("id") ON DELETE RESTRICT,
  "acao" varchar(20) NOT NULL,
  "antes" jsonb,
  "depois" jsonb NOT NULL,
  "usuario_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Garantias no próprio banco (valem para qualquer caminho de escrita):
-- 1) movimento nunca é apagado; 2) toda inclusão/alteração vira histórico;
-- 3) uma transação do BPO não pode ser alocada além do próprio valor, nem
--    usada sem estar paga, nem com natureza incompatível (despesa ↔ pagamento).
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
    SELECT COALESCE(SUM(valor), 0) INTO alocado FROM obra_movimentos
      WHERE bpo_lancamento_id = NEW.bpo_lancamento_id AND status = 'confirmado' AND id <> NEW.id;
    IF alocado + NEW.valor > lanc.valor THEN
      RAISE EXCEPTION 'BPO_ALOCACAO_EXCEDIDA: disponível R$ %', lanc.valor - alocado;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE OR REPLACE FUNCTION obra_movimentos_historico_registrar() RETURNS trigger AS $$
BEGIN
  INSERT INTO obra_movimentos_historico (movimento_id, acao, antes, depois, usuario_id)
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

DROP TRIGGER IF EXISTS obra_movimentos_guarda_trg ON obra_movimentos;--> statement-breakpoint
CREATE TRIGGER obra_movimentos_guarda_trg BEFORE INSERT OR UPDATE OR DELETE ON obra_movimentos
  FOR EACH ROW EXECUTE FUNCTION obra_movimentos_guarda();--> statement-breakpoint
DROP TRIGGER IF EXISTS obra_movimentos_historico_trg ON obra_movimentos;--> statement-breakpoint
CREATE TRIGGER obra_movimentos_historico_trg AFTER INSERT OR UPDATE ON obra_movimentos
  FOR EACH ROW EXECUTE FUNCTION obra_movimentos_historico_registrar();--> statement-breakpoint

-- Migração dos valores que a tela antiga guardava como JSON em `notes`
-- (marcador __MCMV_META__). Só preenche colunas ainda vazias; os totais já
-- informados viram um único movimento de origem 'migracao' por natureza,
-- identificado como saldo anterior sem detalhamento. Idempotente.
WITH meta AS (
  SELECT id, substring(notes from position('__MCMV_META__:' in notes) + 14)::jsonb AS j
  FROM construction_projects WHERE notes LIKE '%__MCMV_META__:%'
)
UPDATE construction_projects cp SET
  vgv = COALESCE(cp.vgv, NULLIF(meta.j->>'vgv', '')::numeric),
  financed_amount = COALESCE(cp.financed_amount, NULLIF(meta.j->>'financedAmount', '')::numeric),
  fgts_amount = COALESCE(cp.fgts_amount, NULLIF(meta.j->>'fgtsAmount', '')::numeric),
  subsidy_amount = COALESCE(cp.subsidy_amount, NULLIF(meta.j->>'subsidyAmount', '')::numeric),
  installment_rate = COALESCE(cp.installment_rate, NULLIF(meta.j->>'installmentRate', '')::numeric),
  installment_qty = COALESCE(cp.installment_qty, NULLIF(meta.j->>'installmentQty', '')::numeric::integer)
FROM meta WHERE meta.id = cp.id;--> statement-breakpoint

INSERT INTO obra_movimentos (project_id, natureza, categoria, descricao, valor, data, observacao, origem)
SELECT m.id, x.natureza, x.categoria, x.descricao, x.valor, CURRENT_DATE,
  'Valor total informado na tela anterior, sem histórico de datas. Substitua pelos lançamentos detalhados quando possível.', 'migracao'
FROM (
  SELECT id, substring(notes from position('__MCMV_META__:' in notes) + 14)::jsonb AS j
  FROM construction_projects WHERE notes LIKE '%__MCMV_META__:%'
) m
CROSS JOIN LATERAL (VALUES
  ('entrada', NULL, 'Saldo anterior de entrada paga (migrado)', NULLIF(m.j->>'downPaymentPaid', '')::numeric),
  ('recebimento_cef', NULL, 'Saldo anterior recebido da CEF (migrado)', NULLIF(m.j->>'cefReceivedAmount', '')::numeric),
  ('pagamento', 'nao_detalhado', 'Saldo anterior de gastos realizados na obra (migrado)', NULLIF(m.j->>'constructionSpent', '')::numeric)
) AS x(natureza, categoria, descricao, valor)
WHERE x.valor > 0
  AND NOT EXISTS (
    SELECT 1 FROM obra_movimentos om
    WHERE om.project_id = m.id AND om.origem = 'migracao' AND om.natureza = x.natureza
  );
