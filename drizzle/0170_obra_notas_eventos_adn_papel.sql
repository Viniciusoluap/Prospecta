-- 23/11/2026 — EPIC-029 S-5b (revisão do Codex no PR #318): papel do EVENTO do ADN — "recebida" (cancelamento de NFS-e que a
-- empresa RECEBEU, casado com "obra_notas") ou "emitida" (cancelamento de NFS-e que a própria empresa EMITIU: a distribuição
-- do ADN traz os dois). O evento de nota emitida NUNCA entra na lista/aviso de "cancelamento sem a nota recebida" (senão
-- apareceria ao dono para sempre); fica guardado marcado "emitida" para a S-7 casar com "fiscal_notas".
-- Story: docs/stories/epics/epic-029-modulo-fiscal/S-5-producao-e-recebidas.md (seção S-5b, revisão do Codex).
--
-- ORDEM: depois da 0166 (já aplicada em produção; esta não a altera). APLICAR ANTES de publicar o código desta correção (o
-- esquema passa a ler a coluna nova).
--
-- Somente ADITIVA e IDEMPOTENTE: ADD COLUMN IF NOT EXISTS (com DEFAULT: as linhas existentes ficam "recebida", que é o que
-- o código anterior supunha), CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE TRIGGER (gatilho NOVO, ao lado da
-- guarda da 0166, que continua igual). Nenhum dado existente é alterado ou apagado.
-- Reversão: DROP TRIGGER obra_notas_eventos_adn_guarda_papel ON obra_notas_eventos_adn; DROP FUNCTION
--   obra_notas_eventos_adn_guarda_papel(); ALTER TABLE obra_notas_eventos_adn DROP COLUMN papel.

ALTER TABLE "obra_notas_eventos_adn" ADD COLUMN IF NOT EXISTS "papel" varchar(8) NOT NULL DEFAULT 'recebida'
  CHECK ("papel" IN ('recebida', 'emitida'));

CREATE INDEX IF NOT EXISTS "obra_notas_eventos_adn_recebida_pendente_idx" ON "obra_notas_eventos_adn" ("recebido_em")
  WHERE "nota_id" IS NULL AND "papel" = 'recebida';

-- o papel lido não muda depois de gravado
CREATE OR REPLACE FUNCTION obra_notas_eventos_adn_guarda_papel() RETURNS trigger AS $$
BEGIN
  IF NEW."papel" IS DISTINCT FROM OLD."papel" THEN
    RAISE EXCEPTION 'OBRA_NOTAS_EVENTOS_IMUTAVEL: o papel do evento (recebida/emitida) não muda';
  END IF;
  -- evento de nota EMITIDA não é casado com nota recebida (obra_notas)
  IF NEW."papel" = 'emitida' AND NEW."nota_id" IS NOT NULL THEN
    RAISE EXCEPTION 'OBRA_NOTAS_EVENTOS_CASADO: evento de nota emitida não é casado com nota recebida';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS obra_notas_eventos_adn_guarda_papel ON "obra_notas_eventos_adn";
CREATE TRIGGER obra_notas_eventos_adn_guarda_papel BEFORE UPDATE ON "obra_notas_eventos_adn"
  FOR EACH ROW EXECUTE FUNCTION obra_notas_eventos_adn_guarda_papel();
