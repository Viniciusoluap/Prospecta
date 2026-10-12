-- Acrescenta colunas próprias sem remover o histórico em notes. O payload legado
-- fica disponível para auditoria até uma reconciliação supervisionada.
ALTER TABLE "construction_projects"
  ADD COLUMN IF NOT EXISTS "cef_title" varchar(255),
  ADD COLUMN IF NOT EXISTS "cef_branch" varchar(255),
  ADD COLUMN IF NOT EXISTS "mcmv_client_name" varchar(255),
  ADD COLUMN IF NOT EXISTS "broker_payment_settled" boolean;
--> statement-breakpoint

-- O Lote 2 já migrou os valores financeiros para o motor próprio. Aqui apenas
-- metadados restantes são preenchidos sem alterar saldos ou movimentos.
-- JSON malformado permanece intocado para reconciliação manual.
DO $$
DECLARE
  project record;
  payload jsonb;
  field record;
  raw_value text;
BEGIN
  FOR project IN
    SELECT id, notes FROM construction_projects
    WHERE notes LIKE E'%\n__MCMV_META__:%'
  LOOP
    BEGIN
      payload := substring(project.notes from position(E'\n__MCMV_META__:' in project.notes) + length(E'\n__MCMV_META__:'))::jsonb;
      IF jsonb_typeof(payload) <> 'object' THEN CONTINUE; END IF;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;

    FOR field IN SELECT * FROM (VALUES
      ('clientName', 'mcmv_client_name'),
      ('cefTitle', 'cef_title'), ('cefBranch', 'cef_branch')
    ) AS f(source_key, target_column) LOOP
      raw_value := payload ->> field.source_key;
      IF raw_value IS NOT NULL AND length(raw_value) <= 255 THEN
        EXECUTE format('UPDATE construction_projects SET %I = COALESCE(%I, $1) WHERE id = $2',
          field.target_column, field.target_column)
          USING raw_value, project.id;
      END IF;
    END LOOP;

    IF payload ->> 'brokerPaid' IN ('true', 'false') THEN
      UPDATE construction_projects
      SET broker_payment_settled = COALESCE(broker_payment_settled, (payload ->> 'brokerPaid')::boolean)
      WHERE id = project.id;
    END IF;
  END LOOP;
END $$;
