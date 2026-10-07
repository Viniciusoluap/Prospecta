ALTER TABLE "construction_projects" ADD COLUMN IF NOT EXISTS "lead_id" integer REFERENCES "leads"("id") ON DELETE set null;
ALTER TABLE "construction_projects" ADD COLUMN IF NOT EXISTS "lead_service_id" integer REFERENCES "lead_services"("id") ON DELETE set null;
ALTER TABLE "construction_projects" ALTER COLUMN "user_id" DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "construction_projects_lead_service_id_unique" ON "construction_projects" ("lead_service_id");
