-- Pedido A6 (14/10/2026): excluir é excluir, em todo o sistema. Lançamentos
-- financeiros (movimentos da obra e recebimentos da regularização) deixam de ser
-- "cancelados" e passam a ser apagados de verdade, junto com o próprio histórico.
-- Os lançamentos que já estavam cancelados são apagados aqui (autorizado pelo dono).
-- Mesma regra no Santa Fé: web/prisma/migrations/20261014120000_exclusao_definitiva_lancamentos.
DROP TRIGGER IF EXISTS obra_movimentos_guarda_trg ON obra_movimentos;--> statement-breakpoint
CREATE TRIGGER obra_movimentos_guarda_trg BEFORE INSERT OR UPDATE ON obra_movimentos
  FOR EACH ROW EXECUTE FUNCTION obra_movimentos_guarda();--> statement-breakpoint
DROP TRIGGER IF EXISTS regularizacao_recebimentos_guarda_trg ON regularizacao_recebimentos;--> statement-breakpoint
CREATE TRIGGER regularizacao_recebimentos_guarda_trg BEFORE INSERT OR UPDATE ON regularizacao_recebimentos
  FOR EACH ROW EXECUTE FUNCTION regularizacao_recebimentos_guarda();--> statement-breakpoint
-- Histórico sai junto com o lançamento (troca a FK RESTRICT, seja qual for o nome dela).
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conrelid::regclass AS tabela, conname FROM pg_constraint
    WHERE contype = 'f' AND (
      (conrelid = 'obra_movimentos_historico'::regclass AND confrelid = 'obra_movimentos'::regclass) OR
      (conrelid = 'regularizacao_recebimentos_historico'::regclass AND confrelid = 'regularizacao_recebimentos'::regclass))
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tabela, c.conname);
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "obra_movimentos_historico" ADD CONSTRAINT "obra_movimentos_historico_movimento_id_fkey"
  FOREIGN KEY ("movimento_id") REFERENCES "obra_movimentos"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "regularizacao_recebimentos_historico" ADD CONSTRAINT "regularizacao_recebimentos_historico_recebimento_id_fkey"
  FOREIGN KEY ("recebimento_id") REFERENCES "regularizacao_recebimentos"("id") ON DELETE CASCADE;--> statement-breakpoint
DELETE FROM "obra_movimentos" WHERE "status" = 'cancelado';--> statement-breakpoint
DELETE FROM "regularizacao_recebimentos" WHERE "status" = 'cancelado';
