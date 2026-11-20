-- 17/11/2026 — EPIC-024 S-12 (texto definitivo do termo): retirada (revogação) do consentimento registrada no sistema.
-- A tabela "consentimentos" continua SÓ DE INCLUSÃO (gatilho da 0127): a retirada é uma NOVA linha, de tipo "revogacao",
-- com quem registrou ("registrado_por") e quando ("aceito_em" = instante do registro). Nada é alterado nem apagado.
--   - "tipo": 'aceite' (padrão; todas as linhas existentes são aceites) ou 'revogacao';
--   - "registrado_por": número da conta de quem registrou a retirada (admin em "Usuários e acesso", ou o próprio titular
--     pelo botão de Meu perfil). Sem chave estrangeira, pelo mesmo motivo de "user_id" (a prova permanece).
--   - canal: passa a aceitar também 'admin' (retirada registrada pelo administrador) e 'conta' (pelo próprio titular).
-- Somente aditiva e idempotente: duas colunas novas (ADD COLUMN IF NOT EXISTS, com padrão: não dispara o gatilho de
-- UPDATE), CHECKs novos criados só se faltarem, e a regra CHECK do canal trocada por outra que aceita os valores antigos
-- e os novos (ampliação; nenhuma linha existente deixa de valer).
-- Reversão: excluir as linhas de tipo 'revogacao' exige desligar o gatilho; para só desativar a função, basta voltar o
-- código — as colunas novas não atrapalham a versão anterior.

ALTER TABLE "consentimentos" ADD COLUMN IF NOT EXISTS "tipo" varchar(12) NOT NULL DEFAULT 'aceite';
ALTER TABLE "consentimentos" ADD COLUMN IF NOT EXISTS "registrado_por" integer;

DO $$
DECLARE c record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'consentimentos'::regclass AND conname = 'consentimentos_tipo_check') THEN
    ALTER TABLE "consentimentos" ADD CONSTRAINT "consentimentos_tipo_check" CHECK ("tipo" IN ('aceite', 'revogacao'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'consentimentos'::regclass AND conname = 'consentimentos_revogacao_com_autor') THEN
    ALTER TABLE "consentimentos" ADD CONSTRAINT "consentimentos_revogacao_com_autor"
      CHECK ("tipo" = 'aceite' OR ("registrado_por" IS NOT NULL AND "canal" IN ('admin', 'conta')));
  END IF;
  -- Regra do canal: remove a antiga (qualquer nome) e cria a ampliada.
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'consentimentos'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%canal%' AND conname <> 'consentimentos_revogacao_com_autor' LOOP
    EXECUTE format('ALTER TABLE "consentimentos" DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE "consentimentos" ADD CONSTRAINT "consentimentos_canal_check"
    CHECK ("canal" IN ('definir_senha', 'login', 'admin', 'conta'));
END $$;

CREATE INDEX IF NOT EXISTS "consentimentos_tipo_idx" ON "consentimentos" ("user_id", "tipo");
