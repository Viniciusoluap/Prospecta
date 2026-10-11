-- Correção pós-PR #87 (revisão Codex): um único registro operacional por serviço do lead
-- em Projetos e Regularização, para que aberturas simultâneas do módulo
-- (leadServices.materializePending) não criem dois registros para o mesmo serviço.
-- Idempotente. Também é aplicado automaticamente em runtime por
-- ensureLeadServicesSchema() (server/lead-services-router.ts), então não exige passo manual.
-- Antes do índice, duplicatas existentes perdem só o lead_service_id: fica o registro
-- referenciado pelo serviço (operational_record_id) ou, sem referência, o mais antigo.
UPDATE "operational_projects" AS r SET "lead_service_id" = NULL
FROM (
  SELECT t."lead_service_id" AS sid,
    COALESCE(MAX(CASE WHEN t."id" = s."operational_record_id" THEN t."id" END), MIN(t."id")) AS keep_id
  FROM "operational_projects" t LEFT JOIN "lead_services" s ON s."id" = t."lead_service_id"
  WHERE t."lead_service_id" IS NOT NULL
  GROUP BY t."lead_service_id" HAVING COUNT(*) > 1
) d
WHERE r."lead_service_id" = d.sid AND r."id" <> d.keep_id;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "operational_projects_lead_service_id_unique" ON "operational_projects" ("lead_service_id");--> statement-breakpoint
UPDATE "regularizacoes" AS r SET "lead_service_id" = NULL
FROM (
  SELECT t."lead_service_id" AS sid,
    COALESCE(MAX(CASE WHEN t."id" = s."operational_record_id" THEN t."id" END), MIN(t."id")) AS keep_id
  FROM "regularizacoes" t LEFT JOIN "lead_services" s ON s."id" = t."lead_service_id"
  WHERE t."lead_service_id" IS NOT NULL
  GROUP BY t."lead_service_id" HAVING COUNT(*) > 1
) d
WHERE r."lead_service_id" = d.sid AND r."id" <> d.keep_id;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "regularizacoes_lead_service_id_unique" ON "regularizacoes" ("lead_service_id");
