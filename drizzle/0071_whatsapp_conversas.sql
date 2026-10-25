-- Pedido de 25/10: Conversas do WhatsApp (mensagens recebidas pelo webhook da Evolution). Aditiva.
ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "direcao" varchar(10) DEFAULT 'saida' NOT NULL;
ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "lida" boolean DEFAULT true NOT NULL;
CREATE INDEX IF NOT EXISTS "whatsapp_messages_conversa_idx" ON "whatsapp_messages" ("connection_id", "destinatario", "created_at");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_external_idx" ON "whatsapp_messages" ("external_id");
