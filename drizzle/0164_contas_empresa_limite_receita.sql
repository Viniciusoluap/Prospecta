-- 22/11/2026 — EPIC-029 S-6 (contas bancárias por empresa, regime por empresa e limite de receita do ano).
-- Story: docs/stories/epics/epic-029-modulo-fiscal/S-6-contas-por-empresa-e-teto-simples.md.
-- Número 0164 (0161–0163 reservados para as frentes S-3, S-4 e S-5).
--
-- O que muda:
--   1) "bank_accounts" ganha duas colunas NOVAS e opcionais (nulas em todas as contas que já existem — nenhum dado muda):
--      - "apelido": nome amigável que o dono escolhe (renomear não mexe em banco, agência nem número);
--      - "empresa_cnpj": o CNPJ (só os caracteres) do perfil tributário dono da conta. N contas por empresa. Sem chave estrangeira,
--        do mesmo jeito que "fiscal_emissores" (0154): o servidor confere que existe perfil com esse CNPJ antes de gravar.
--   2) A restrição CHECK da coluna "tipo" de "dolores_avisos_tipos" (nome padrão do Postgres "dolores_avisos_tipos_tipo_check") passa a
--      aceitar também 'limite_receita' (aviso de limite de receita por empresa). A lista inclui 'nota_fiscal' (da 0161, S-3) para que a
--      ordem de aplicação não importe: a lista nova é a UNIÃO; aceita todas as linhas que a antiga aceitava.
--      ATENÇÃO: se a 0161 for aplicada DEPOIS desta, ela tira 'limite_receita' da lista — nesse caso, rode esta de novo (é idempotente).
--
-- Aditiva e IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, CHECK novo só se ainda não existir, índice IF NOT EXISTS e a troca do CHECK de tipo
-- em DROP IF EXISTS + ADD na MESMA transação. Nenhuma linha existente é alterada ou apagada.
-- Reversão: ALTER TABLE bank_accounts DROP COLUMN apelido, DROP COLUMN empresa_cnpj (pedir ao dono: é remoção de coluna) e a troca do CHECK
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
      CHECK ("apelido" IS NULL OR length(btrim("apelido")) > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "bank_accounts_empresa_cnpj_idx" ON "bank_accounts" ("empresa_cnpj");

ALTER TABLE "dolores_avisos_tipos" DROP CONSTRAINT IF EXISTS "dolores_avisos_tipos_tipo_check";
ALTER TABLE "dolores_avisos_tipos" ADD CONSTRAINT "dolores_avisos_tipos_tipo_check"
  CHECK ("tipo" IN ('obra_atrasada', 'tarefa_vencida', 'documento_pendente', 'nota_obra', 'regularizacao_parada', 'grupo_aguardando', 'integracao', 'gasto', 'nota_fiscal', 'limite_receita'));

COMMIT;
