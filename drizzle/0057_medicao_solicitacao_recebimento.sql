-- Pedido de 18/10: cada medição do histórico pode ser solicitada e ter o
-- recebimento confirmado; edição registra quem alterou. Só acrescenta colunas.
ALTER TABLE "construction_progress_history" ADD COLUMN IF NOT EXISTS "requested_at" timestamp;
--> statement-breakpoint
ALTER TABLE "construction_progress_history" ADD COLUMN IF NOT EXISTS "requested_by" integer;
--> statement-breakpoint
ALTER TABLE "construction_progress_history" ADD COLUMN IF NOT EXISTS "received_at" timestamp;
--> statement-breakpoint
ALTER TABLE "construction_progress_history" ADD COLUMN IF NOT EXISTS "received_by" integer;
--> statement-breakpoint
ALTER TABLE "construction_progress_history" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;
--> statement-breakpoint
ALTER TABLE "construction_progress_history" ADD COLUMN IF NOT EXISTS "updated_by" integer;
