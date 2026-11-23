-- 22/11/2026 — EPIC-029 S-6 (contas bancárias por empresa, regime por empresa e limite de receita do ano).
-- Story: docs/stories/epics/epic-029-modulo-fiscal/S-6-contas-por-empresa-e-teto-simples.md.
-- Número 0164. AINDA NÃO aplicada em produção (22/11/2026).
--
-- O que muda:
--   1) "bank_accounts" ganha duas colunas NOVAS e opcionais (nulas em todas as contas que já existem — nenhum dado muda):
--      - "apelido": nome amigável que o dono escolhe (renomear não mexe em banco, agência nem número);
--      - "empresa_cnpj": o CNPJ (só os caracteres) do perfil tributário dono da conta. N contas por empresa. Sem chave estrangeira,
--        do mesmo jeito que "fiscal_emissores" (0154): o servidor confere que existe perfil com esse CNPJ antes de gravar.
--   2) A restrição CHECK da coluna "tipo" de "dolores_avisos_tipos" (nome padrão do Postgres "dolores_avisos_tipos_tipo_check") passa a
--      aceitar também 'limite_receita' (aviso de limite de receita por empresa). A lista é a lista COMPLETA: os 8 tipos de antes +
--      'nota_fiscal' (da 0165_dolores_aviso_fiscal.sql, S-3, já aplicada em produção) + 'limite_receita' — a UNIÃO; aceita todas as
--      linhas que a antiga aceitava, então a ordem de aplicação não importa.
--      ATENÇÃO: a 0165 grava a lista SEM 'limite_receita'. Se a 0165 for reaplicada DEPOIS desta, reaplique esta 0164 (é idempotente).
--   4) QA3 S-6 (Q3): tabela NOVA "bpo_transferencia_marcacoes" (só INSERT pelo sistema): cada movimentação marcada como "Transferência
--      interna" pela tela (ignorar em "A classificar", classificação em lote, regra do titular) — quem, quando, por onde, valor e o lote
--      (quantas e o valor somado saem do lote). Nenhuma linha existente muda.
--   3) QA S-6 (A10): o CHECK do apelido exige ao menos um caractere que não seja espaço em branco ([[:space:]]: espaço, TAB, quebra de
--      linha) — apelido só com TAB/quebra de linha é recusado também na gravação direta no banco.
--
-- Aditiva e IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, CHECK novo só se ainda não existir, índice IF NOT EXISTS e a troca do CHECK de tipo
-- em DROP IF EXISTS + ADD na MESMA transação. Nenhuma linha existente é alterada ou apagada.
-- Reversão: DROP TABLE bpo_transferencia_marcacoes (pedir ao dono: é auditoria), ALTER TABLE bank_accounts DROP COLUMN apelido,
-- DROP COLUMN empresa_cnpj (pedir ao dono: é remoção de coluna) e a troca do CHECK
-- com a lista sem 'limite_receita', depois de apagar a linha 'limite_receita' de dolores_avisos_tipos, se houver.

BEGIN;

ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "apelido" varchar(80);
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "empresa_cnpj" varchar(14);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_accounts_empresa_cnpj_check') THEN
    ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_empresa_cnpj_check"
      CHECK ("empresa_cnpj" IS NULL OR "empresa_cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_accounts_apelido_check') THEN
    ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_apelido_check"
      CHECK ("apelido" IS NULL OR "apelido" ~ '[^[:space:]]');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "bank_accounts_empresa_cnpj_idx" ON "bank_accounts" ("empresa_cnpj");

CREATE TABLE IF NOT EXISTS "bpo_transferencia_marcacoes" (
  "id" bigserial PRIMARY KEY,
  "lote" varchar(40) NOT NULL,
  "bank_transaction_id" integer NOT NULL,
  "usuario_id" integer,
  "via" varchar(20) NOT NULL,
  "valor" numeric(15, 2) NOT NULL,
  "criado_em" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "bpo_transferencia_marcacoes_tx_idx" ON "bpo_transferencia_marcacoes" ("bank_transaction_id");
CREATE INDEX IF NOT EXISTS "bpo_transferencia_marcacoes_lote_idx" ON "bpo_transferencia_marcacoes" ("lote");

ALTER TABLE "dolores_avisos_tipos" DROP CONSTRAINT IF EXISTS "dolores_avisos_tipos_tipo_check";
ALTER TABLE "dolores_avisos_tipos" ADD CONSTRAINT "dolores_avisos_tipos_tipo_check"
  CHECK ("tipo" IN ('obra_atrasada', 'tarefa_vencida', 'documento_pendente', 'nota_obra', 'regularizacao_parada', 'grupo_aguardando', 'integracao', 'gasto', 'nota_fiscal', 'limite_receita'));

COMMIT;
