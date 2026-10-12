ALTER TABLE "incorporation_studies"
  ADD COLUMN IF NOT EXISTS "property_registration" text,
  ADD COLUMN IF NOT EXISTS "car_registration" text,
  ADD COLUMN IF NOT EXISTS "official_zoning" text,
  ADD COLUMN IF NOT EXISTS "zoning_source" text;
