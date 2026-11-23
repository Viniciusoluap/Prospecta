-- EPIC-029 S-7 — portão de QA (B6, 23/11/2026): o histórico imutável das notas (fiscal_notas_historico, gatilho da 0154) copiava
-- a linha INTEIRA a cada mudança, inclusive "xml_dps" (DPS assinada) e "xml_nfse" (NFS-e autorizada). O XML fica só na própria nota
-- (download de admin) e em fiscal_eventos (retorno oficial); o histórico passa a guardar "quem, o quê, quando" sem esses dois campos.
--
-- Só ADITIVA e IDEMPOTENTE: CREATE OR REPLACE da função do gatilho (tabela do próprio fiscal). Nenhuma tabela, coluna ou dado
-- existente muda (as linhas antigas do histórico ficam como estão — o histórico é imutável). Não edita a 0154 nem a 0167.
-- Reversão (só com o dono): reaplicar a função fiscal_notas_historico_registrar da 0154.
CREATE OR REPLACE FUNCTION fiscal_notas_historico_registrar() RETURNS trigger AS $$
DECLARE
  fora text[] := ARRAY['xml_dps', 'xml_nfse'];
BEGIN
  INSERT INTO fiscal_notas_historico (nota_id, acao, antes, depois, usuario_id, via)
  VALUES (
    NEW.id,
    CASE
      WHEN TG_OP = 'INSERT' THEN 'criada'
      WHEN OLD.status IS DISTINCT FROM NEW.status THEN lower(NEW.status)
      ELSE 'editada'
    END,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) - fora END,
    to_jsonb(NEW) - fora,
    NEW.atualizado_por,
    NEW.alterado_via
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
