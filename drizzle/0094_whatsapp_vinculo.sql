-- Lote 03, correção 02 (29/10/2026): vínculo manual conversa do WhatsApp ↔ lead.
-- O vínculo escolhido pelo usuário ("Vincular lead") tem prioridade sobre a inferência pelo
-- telefone. "phone_key" = DDD + 8 últimos dígitos (mesma normalização de mesmoTelefone).
-- Aditiva e idempotente. Não altera leads nem mensagens existentes.
CREATE TABLE IF NOT EXISTS "whatsapp_conversation_links" (
  "id" serial PRIMARY KEY,
  "connection_id" integer NOT NULL REFERENCES "whatsapp_connections"("id") ON DELETE CASCADE,
  "phone_key" varchar(20) NOT NULL,
  "lead_id" integer NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "linked_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "linked_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_conversation_links_conn_phone_uidx"
  ON "whatsapp_conversation_links" ("connection_id", "phone_key");
CREATE INDEX IF NOT EXISTS "whatsapp_conversation_links_lead_idx" ON "whatsapp_conversation_links" ("lead_id");
ALTER TABLE "whatsapp_conversation_links" ENABLE ROW LEVEL SECURITY;

-- Correção 04: contagem do dashboard por período sem varrer a tabela.
CREATE INDEX IF NOT EXISTS "whatsapp_messages_direcao_created_idx" ON "whatsapp_messages" ("direcao", "created_at");
