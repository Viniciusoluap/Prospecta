-- Pedido de 29/10: organização completa do Google Drive (mesma regra no Grupo Santa Fé).
-- Só aditiva: referência da cópia no Drive dos arquivos que hoje ficam só no banco,
-- fila de lixeira pendente e estado/relatório do "Organizar Drive".
ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS drive_file_id text;
ALTER TABLE pci_models ADD COLUMN IF NOT EXISTS drive_file_id text;
ALTER TABLE pci_generated ADD COLUMN IF NOT EXISTS sheet_drive_file_id text;
ALTER TABLE pci_generated ADD COLUMN IF NOT EXISTS pdf_drive_file_id text;
ALTER TABLE construction_photos ADD COLUMN IF NOT EXISTS drive_file_id text;
ALTER TABLE construction_pci ADD COLUMN IF NOT EXISTS drive_file_id text;
ALTER TABLE whatsapp_midias ADD COLUMN IF NOT EXISTS drive_file_id text;
ALTER TABLE incorporation_studies ADD COLUMN IF NOT EXISTS budget_import_drive_file_id text;
ALTER TABLE incorporation_studies ADD COLUMN IF NOT EXISTS budget_import_sha256 varchar(64);

-- Arquivo/pasta que deveria ter ido para a lixeira do Drive e falhou: o sincronizador tenta de novo.
CREATE TABLE IF NOT EXISTS drive_trash_queue (
  id serial PRIMARY KEY,
  kind varchar(10) NOT NULL CHECK (kind IN ('arquivo', 'pasta')),
  target text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT drive_trash_queue_kind_target_key UNIQUE (kind, target)
);

-- Linha única (id = 1): posição de retomada e último relatório do "Organizar Drive".
CREATE TABLE IF NOT EXISTS drive_sync_state (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_report jsonb,
  last_run_at timestamp,
  updated_at timestamp NOT NULL DEFAULT now()
);
