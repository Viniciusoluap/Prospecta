-- EPIC-031 S-2: renomear no Google Drive os arquivos antigos de Projetos para o nome padrão (só o nome).
-- Aditiva: nada é apagado nem alterado. original_name continua intacto (é o que permite desfazer).
-- drive_renamed_at: quando o nome no Drive foi trocado pelo sistema; drive_rename_failures/drive_rename_error: falhas
-- registradas (só o código, sem dados pessoais) para a rotina não insistir para sempre no mesmo arquivo.
ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS drive_renamed_at timestamp;
ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS drive_rename_failures integer NOT NULL DEFAULT 0;
ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS drive_rename_error varchar(120);
-- Para desfazer (portão de QA de 26/11): o nome que o arquivo tinha NO DRIVE antes de a rotina renomear (lido no Drive;
-- gravado uma vez só, nunca sobrescrito), o nome que estava na lista da tela (`name`/`nome` do JSON) e se a rotina
-- ACRESCENTOU o `originalName`/`nomeOriginal` (true) ou ele já existia (false). Nulos até a rotina passar pelo registro.
ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS drive_name_before varchar(255);
ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS list_name_before varchar(255);
ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS list_original_added boolean;
-- Re-revisão do portão de QA (26/11): o "antes" é gravado e CONFIRMADO antes de qualquer escrita no Drive.
-- canonical_name_before: o canonical_name do registro antes da rotina (volta exata do registro).
-- drive_name_before_origem: 'drive' = lido no Drive antes de renomear (exato); 'registro' = o arquivo já estava com o
-- nome novo quando a rotina chegou e não havia leitura anterior, então drive_name_before é o canonical_name anterior
-- (ESTIMADO). Nulo = nada guardado.
ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS canonical_name_before varchar(255);
ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS drive_name_before_origem varchar(20);
-- 3ª rodada do portão de QA (26/11): o nome que a rotina TENTOU pôr no Drive e a marca de "PATCH tentado" (gravados
-- antes do PATCH; a marca só permanece em sucesso, 5xx ou tempo esgotado — num 4xx, que não foi aplicado, é limpa).
-- Sem a marca, "já estava com o nome novo" quer dizer que alguém renomeou à mão: não é atribuído à rotina.
ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS drive_name_target varchar(255);
ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS drive_patch_attempted boolean;
-- 4ª rodada do portão de QA (26/11): o nome que a rotina gravou (congelou) na lista/entrega da tela — sempre que congela,
-- inclusive quando o arquivo já estava com o nome no Drive. O "Como desfazer" só volta a lista se ela ainda tem este nome.
ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS list_name_target varchar(255);
