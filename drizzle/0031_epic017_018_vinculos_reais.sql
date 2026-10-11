-- EPIC-017 / EPIC-018 — vínculos reais entre CRM, serviços operacionais e comissões.
-- Todas as instruções são aditivas e idempotentes (IF NOT EXISTS). PRÉ-REQUISITO DE DEPLOY:
-- aplicar este arquivo no banco ANTES de publicar o código, pois `select()` em `leads`
-- passa a incluir as colunas novas (o deploy na Vercel não executa migrations).
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "responsible_user_id" integer REFERENCES "users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "broker_id" integer REFERENCES "users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "cpf" varchar(14);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "address" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "neighborhood" varchar(100);--> statement-breakpoint
ALTER TABLE "avaliacoes" ADD COLUMN IF NOT EXISTS "lead_service_id" integer REFERENCES "lead_services"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "operational_commissions" ADD COLUMN IF NOT EXISTS "property_id" integer REFERENCES "imoveis"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "operational_commissions" ADD COLUMN IF NOT EXISTS "construction_project_id" integer REFERENCES "construction_projects"("id") ON DELETE set null;--> statement-breakpoint
UPDATE "operational_commissions" SET "business_type" = 'obra' WHERE "business_type" = 'construcao';
