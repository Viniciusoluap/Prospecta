-- Versões imutáveis: substituir a PCI atual não altera medições já gravadas.
CREATE TABLE IF NOT EXISTS construction_pci_versions (
 id serial PRIMARY KEY,
 project_id integer NOT NULL REFERENCES construction_projects(id) ON DELETE CASCADE,
 checksum varchar(32) NOT NULL, file_name varchar(255) NOT NULL, data bytea NOT NULL,
 parsed jsonb NOT NULL, uploaded_by integer, uploaded_at timestamp NOT NULL DEFAULT now(),
 UNIQUE(project_id, checksum)
);
--> statement-breakpoint
ALTER TABLE construction_pci ADD COLUMN IF NOT EXISTS version_id integer REFERENCES construction_pci_versions(id) ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE construction_progress_history ADD COLUMN IF NOT EXISTS pci_version_id integer REFERENCES construction_pci_versions(id) ON DELETE NO ACTION;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION snapshot_construction_pci() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM construction_projects WHERE id = NEW.project_id FOR UPDATE;
 INSERT INTO construction_pci_versions(project_id, checksum, file_name, data, parsed, uploaded_by, uploaded_at)
 VALUES(NEW.project_id, md5(NEW.data), NEW.file_name, NEW.data, NEW.parsed, NEW.uploaded_by, NEW.uploaded_at)
 ON CONFLICT(project_id, checksum) DO NOTHING;
 SELECT id INTO NEW.version_id FROM construction_pci_versions WHERE project_id = NEW.project_id AND checksum = md5(NEW.data);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER snapshot_construction_pci_before_write BEFORE INSERT OR UPDATE OF data ON construction_pci
 FOR EACH ROW EXECUTE FUNCTION snapshot_construction_pci();
-- Arquivos atuais viram versões; medições antigas ficam sem versão até revisão explícita.
--> statement-breakpoint
UPDATE construction_pci SET data = data WHERE version_id IS NULL;
--> statement-breakpoint
ALTER TABLE construction_pci_versions ENABLE ROW LEVEL SECURITY;
