-- Não inferir o tipo dos estudos existentes: classificar manualmente.
ALTER TABLE "incorporation_studies"
  ADD COLUMN IF NOT EXISTS "incorporation_type" varchar(40);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "incorporation_studies"
    ADD CONSTRAINT "incorporation_studies_type_chk"
    CHECK ("incorporation_type" IS NULL OR "incorporation_type" IN
      ('desmembramento_simples', 'residencial', 'vertical', 'loteamento'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
