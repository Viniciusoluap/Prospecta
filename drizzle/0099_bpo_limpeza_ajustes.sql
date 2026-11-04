-- Limpeza local reversível durante ajustes, sem apagar vínculos nem registros externos.
ALTER TABLE bpo_lancamentos ADD COLUMN IF NOT EXISTS exclusao_lote_backup_id integer;

-- Vínculos novos não podem usar lançamento que já saiu do BPO. O lock se coordena
-- com o arquivamento, sem modificar vínculos operacionais existentes.
CREATE OR REPLACE FUNCTION bpo_impedir_vinculo_arquivado() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE removido integer;
BEGIN
  IF NEW.bpo_lancamento_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.bpo_lancamento_id IS NOT DISTINCT FROM OLD.bpo_lancamento_id
    AND (NEW.status <> 'confirmado' OR (OLD.status = 'confirmado' AND NEW.valor <= OLD.valor)) THEN RETURN NEW; END IF;
  SELECT exclusao_lote_backup_id INTO removido FROM bpo_lancamentos WHERE id = NEW.bpo_lancamento_id FOR UPDATE;
  IF removido IS NOT NULL THEN RAISE EXCEPTION 'Lançamento excluído na limpeza de ajustes: restaure o lote antes de vincular.'; END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER obra_bpo_nao_arquivado BEFORE INSERT OR UPDATE OF bpo_lancamento_id, status, valor ON obra_movimentos FOR EACH ROW EXECUTE FUNCTION bpo_impedir_vinculo_arquivado();
CREATE OR REPLACE TRIGGER regularizacao_bpo_nao_arquivado BEFORE INSERT OR UPDATE OF bpo_lancamento_id, status, valor ON regularizacao_recebimentos FOR EACH ROW EXECUTE FUNCTION bpo_impedir_vinculo_arquivado();
