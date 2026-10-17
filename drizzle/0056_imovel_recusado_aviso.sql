-- Pedido de 18/10 (item 8): exclusão definitiva de imóveis. O corretor que
-- cadastrou um imóvel recusado continua vendo "Recusado" por 3 dias, mesmo que o
-- admin exclua o imóvel antes disso. Só acrescenta coluna/tabela (não destrutiva).
ALTER TABLE "imoveis" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "imovel_recusado_avisos" (
  "id" serial PRIMARY KEY,
  "broker_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "titulo" varchar(255) NOT NULL,
  "recusado_em" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "imovel_recusado_avisos_broker_idx" ON "imovel_recusado_avisos" ("broker_user_id");
