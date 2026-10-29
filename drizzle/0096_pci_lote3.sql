-- Lote 03, correções 09b e 10: modelo oficial da PCI — exclusão lógica por versão,
-- relatório de compatibilidade e confirmação de mudança crítica, com auditoria.
-- Aditiva e idempotente. O arquivo (data) nunca é apagado: as PCIs já geradas
-- continuam vinculadas à versão usada (pci_generated.model_id/model_version).

ALTER TABLE "pci_models" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "pci_models" ADD COLUMN IF NOT EXISTS "deleted_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "pci_models" ADD COLUMN IF NOT EXISTS "compat_report" jsonb;
ALTER TABLE "pci_models" ADD COLUMN IF NOT EXISTS "awaiting_confirmation" boolean NOT NULL DEFAULT false;
ALTER TABLE "pci_models" ADD COLUMN IF NOT EXISTS "confirmed_by" integer REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "pci_models" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp;

-- Versão excluída nunca é a atual.
DO $$ BEGIN
  ALTER TABLE "pci_models" ADD CONSTRAINT "pci_models_excluida_nao_atual" CHECK ("deleted_at" IS NULL OR NOT "is_current");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Auditoria das operações com o modelo (envio, tornar atual, confirmar, excluir).
CREATE TABLE IF NOT EXISTS "pci_model_audit" (
  "id" serial PRIMARY KEY,
  "model_id" integer NOT NULL REFERENCES "pci_models"("id") ON DELETE CASCADE,
  "action" varchar(30) NOT NULL CHECK ("action" IN ('enviar', 'tornar_atual', 'confirmar_critica', 'excluir')),
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "details" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "pci_model_audit_model_idx" ON "pci_model_audit" ("model_id", "created_at" DESC);
ALTER TABLE "pci_model_audit" ENABLE ROW LEVEL SECURITY;
