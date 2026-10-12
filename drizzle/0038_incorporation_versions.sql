CREATE TABLE IF NOT EXISTS "incorporation_study_versions" (
  "id" serial PRIMARY KEY,
  "study_id" integer NOT NULL,
  "revision" integer NOT NULL,
  "snapshot" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "incorporation_study_versions_study_revision_idx"
  ON "incorporation_study_versions" ("study_id", "revision");
--> statement-breakpoint

-- Primeiro retrato do estado atual; versões anteriores não são inferidas.
INSERT INTO incorporation_study_versions (study_id, revision, snapshot)
SELECT id, 1, row_to_json(s)::text FROM incorporation_studies s
ON CONFLICT (study_id, revision) DO NOTHING;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION record_incorporation_study_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - 'updated_at') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'updated_at') THEN
    RETURN NEW;
  END IF;
  INSERT INTO incorporation_study_versions (study_id, revision, snapshot)
  VALUES (NEW.id, COALESCE((SELECT MAX(revision) FROM incorporation_study_versions WHERE study_id = NEW.id), 0) + 1, row_to_json(NEW)::text);
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS incorporation_study_version_trigger ON incorporation_studies;
--> statement-breakpoint
CREATE TRIGGER incorporation_study_version_trigger
AFTER INSERT OR UPDATE ON incorporation_studies
FOR EACH ROW EXECUTE FUNCTION record_incorporation_study_version();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION protect_incorporation_study_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'O histórico de versões do estudo é somente leitura';
END $$;
--> statement-breakpoint
CREATE TRIGGER incorporation_study_version_immutable
BEFORE UPDATE OR DELETE ON incorporation_study_versions
FOR EACH ROW EXECUTE FUNCTION protect_incorporation_study_version();
