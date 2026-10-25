-- Pedido de 25/10: WhatsApp por QR code (Evolution API). Aditiva.
ALTER TABLE "whatsapp_connections" ADD COLUMN IF NOT EXISTS "instancia" varchar(80);
CREATE TABLE IF NOT EXISTS "whatsapp_evolution_settings" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "url" varchar(500) NOT NULL,
  "api_key_encrypted" text NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
