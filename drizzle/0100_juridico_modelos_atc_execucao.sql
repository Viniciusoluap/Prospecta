ALTER TABLE portal_contracts
  ADD COLUMN IF NOT EXISTS signature_date date,
  ADD COLUMN IF NOT EXISTS project_id integer REFERENCES construction_projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contractor_id integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS broker_id integer REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signers jsonb;
