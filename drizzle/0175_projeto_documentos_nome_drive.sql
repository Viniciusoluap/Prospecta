-- EPIC-031 S-2: renomear no Google Drive os arquivos antigos de Projetos para o nome padrão (só o nome).
-- Aditiva: nada é apagado nem alterado. original_name continua intacto (é o que permite desfazer).
-- drive_renamed_at: quando o nome no Drive foi trocado pelo sistema; drive_rename_failures/drive_rename_error: falhas
-- registradas (só o código, sem dados pessoais) para a rotina não insistir para sempre no mesmo arquivo.
ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS drive_renamed_at timestamp;
ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS drive_rename_failures integer NOT NULL DEFAULT 0;
ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS drive_rename_error varchar(120);
