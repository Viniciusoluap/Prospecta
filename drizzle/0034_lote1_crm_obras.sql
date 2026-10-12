-- Lote 1 (32 implementações) — CRM e estrutura de Obras.
-- Somente aditiva: acrescenta valores a enums existentes. Nenhum registro é
-- alterado e nenhum valor antigo é removido (obras legadas mantêm o status).
-- PRÉ-REQUISITO DE DEPLOY: aplicar antes de publicar o código.
ALTER TYPE "public"."construction_project_status" ADD VALUE IF NOT EXISTS 'aprovacao';--> statement-breakpoint
ALTER TYPE "public"."construction_project_status" ADD VALUE IF NOT EXISTS 'contrato_prospecta';--> statement-breakpoint
ALTER TYPE "public"."construction_project_status" ADD VALUE IF NOT EXISTS 'laudo_cef';--> statement-breakpoint
ALTER TYPE "public"."construction_project_status" ADD VALUE IF NOT EXISTS 'conformidade_cef';--> statement-breakpoint
ALTER TYPE "public"."lead_temperature" ADD VALUE IF NOT EXISTS 'closed';
