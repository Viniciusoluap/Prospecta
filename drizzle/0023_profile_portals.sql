ALTER TABLE "financiamento_checklist_items"
  ADD COLUMN IF NOT EXISTS "visivel_cliente" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "solicitar_documento" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "documento_url" text,
  ADD COLUMN IF NOT EXISTS "documento_nome" varchar(255),
  ADD COLUMN IF NOT EXISTS "documento_mime" varchar(120),
  ADD COLUMN IF NOT EXISTS "enviado_em" timestamp;

ALTER TABLE "imoveis"
  ADD COLUMN IF NOT EXISTS "created_by_user_id" integer,
  ADD COLUMN IF NOT EXISTS "review_status" varchar(30) DEFAULT 'approved' NOT NULL;

-- Preserva o acesso dos usuários da versão anterior e relaciona obras
-- antigas ao mesmo lead da conta quando o vínculo for inequívoco.
UPDATE "users" SET "role" = 'cliente' WHERE "role" = 'user';
UPDATE "construction_projects" AS project
SET "lead_id" = "users"."lead_id"
FROM "users"
WHERE project."lead_id" IS NULL
  AND project."user_id" = "users"."id"
  AND "users"."lead_id" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "imoveis"
    ADD CONSTRAINT "imoveis_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "construction_projects_lead_id_idx"
  ON "construction_projects" ("lead_id");
CREATE INDEX IF NOT EXISTS "financiamentos_lead_id_idx"
  ON "financiamentos" ("lead_id");
CREATE INDEX IF NOT EXISTS "operational_commissions_broker_id_idx"
  ON "operational_commissions" ("broker_id");
CREATE INDEX IF NOT EXISTS "imoveis_created_by_user_id_idx"
  ON "imoveis" ("created_by_user_id");
