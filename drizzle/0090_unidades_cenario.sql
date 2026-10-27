-- Lote 2, 15/16: aditiva; nomes e histórico comerciais preservados.
ALTER TABLE incorporation_units ADD COLUMN IF NOT EXISTS buyer_lead_id integer REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE incorporation_units ADD COLUMN IF NOT EXISTS source_key varchar(255);
ALTER TABLE incorporation_units ADD COLUMN IF NOT EXISTS scenario_id varchar(120);
ALTER TABLE incorporation_units ADD COLUMN IF NOT EXISTS deleted_at timestamp;
CREATE UNIQUE INDEX IF NOT EXISTS incorporation_units_source_idx ON incorporation_units(study_id, source_key) WHERE source_key IS NOT NULL;
ALTER TABLE incorporation_units ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION bump_incorporation_unit_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.revision := OLD.revision + 1; RETURN NEW; END $$;
CREATE OR REPLACE TRIGGER incorporation_unit_revision_trg BEFORE UPDATE ON incorporation_units FOR EACH ROW EXECUTE FUNCTION bump_incorporation_unit_revision();
