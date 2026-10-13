-- 10 implementações, item 07: engenheiro responsável do projeto é um
-- colaborador cadastrado (vínculo por ID). O texto "engineer" continua como
-- nome exibido e preserva os registros anteriores. Migração aditiva.
ALTER TABLE "operational_projects" ADD COLUMN IF NOT EXISTS "engineer_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "operational_projects" ADD COLUMN IF NOT EXISTS "engineer_registration" varchar(60);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operational_projects_engineer_user_idx" ON "operational_projects" ("engineer_user_id");
