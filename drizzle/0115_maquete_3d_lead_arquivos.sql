-- 15/11/2026 — Maquete 3D (EPIC-023, S-C): pedido ligado a um cliente do CRM (lead) e PDF avulso.
-- Aditiva: coluna e tabela novas. A regra de vínculo é recriada para aceitar o lead (autorizado pelo dono em 15/11);
-- toda linha existente continua válida (projeto com project_id, incorporação com study_id).
ALTER TABLE "maquetes_3d" ADD COLUMN IF NOT EXISTS "lead_id" integer REFERENCES "leads"("id") ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS "maquetes_3d_lead_idx" ON "maquetes_3d" ("lead_id");

ALTER TABLE "maquetes_3d" DROP CONSTRAINT IF EXISTS "maquetes_3d_origem_alvo_ck";
ALTER TABLE "maquetes_3d" ADD CONSTRAINT "maquetes_3d_origem_alvo_ck" CHECK (
  ("origem" = 'projeto' AND "study_id" IS NULL AND (
    ("project_id" IS NOT NULL AND "lead_id" IS NULL) OR ("project_id" IS NULL AND "lead_id" IS NOT NULL)
  )) OR
  ("origem" = 'incorporacao' AND "study_id" IS NOT NULL AND "project_id" IS NULL AND "lead_id" IS NULL)
);

-- PDFs enviados direto no pedido (sem passar pelos documentos do projeto ou do estudo).
CREATE TABLE IF NOT EXISTS "maquete_3d_arquivos" (
  "id" serial PRIMARY KEY,
  "maquete_id" integer NOT NULL REFERENCES "maquetes_3d"("id") ON DELETE CASCADE,
  "nome" varchar(255) NOT NULL,
  "tamanho" integer NOT NULL,
  "dados" bytea NOT NULL,
  "enviado_por" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "maquete_3d_arquivos_maquete_idx" ON "maquete_3d_arquivos" ("maquete_id");
