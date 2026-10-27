-- Lote 2, 15/16: aditiva; nomes e histórico comerciais preservados.
ALTER TABLE incorporation_units ADD COLUMN IF NOT EXISTS buyer_lead_id integer REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE incorporation_units ADD COLUMN IF NOT EXISTS source_key varchar(255);
ALTER TABLE incorporation_units ADD COLUMN IF NOT EXISTS scenario_id varchar(120);
ALTER TABLE incorporation_units ADD COLUMN IF NOT EXISTS deleted_at timestamp;
CREATE UNIQUE INDEX IF NOT EXISTS incorporation_units_source_idx ON incorporation_units(study_id, source_key) WHERE source_key IS NOT NULL;
