-- Pedido de 25/10 (noite): mídia das conversas do WhatsApp guardada no próprio banco
-- (sem storage externo) e fim do responsável legado 'sarah' como padrão de novos leads.
-- Aditiva e idempotente.

ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "midia_tipo" varchar(20);
ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "midia_mime" varchar(120);
ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "midia_nome" varchar(255);
ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "midia_tamanho" integer;

-- Bytes em tabela separada: a lista de conversas lê whatsapp_messages a cada poucos
-- segundos e não deve carregar os arquivos junto.
CREATE TABLE IF NOT EXISTS "whatsapp_midias" (
  "id" serial PRIMARY KEY,
  "message_id" integer NOT NULL UNIQUE REFERENCES "whatsapp_messages"("id") ON DELETE CASCADE,
  "conteudo" bytea NOT NULL CHECK (octet_length("conteudo") BETWEEN 1 AND 10485760),
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- Responsável legado (enum lead_responsible): sem padrão 'sarah' e aceitando vazio.
-- Os dados existentes não são alterados aqui (limpeza só após prévia aprovada).
ALTER TABLE "leads" ALTER COLUMN "responsible" DROP DEFAULT;
ALTER TABLE "leads" ALTER COLUMN "responsible" DROP NOT NULL;
