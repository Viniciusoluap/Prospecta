-- 20/11/2026 — EPIC-026 (C3): saudação de campanha com imagem e áudio (pedido do dono: "na tela de saudação permita também
-- adicionar imagem e áudio como profissionais além do texto").
-- Story: docs/stories/epics/epic-026-correcoes-20-11/C3-saudacao-com-imagem-e-audio.md.
--
-- "whatsapp_campanha_midias": no máximo UMA imagem (JPG/PNG) e UM áudio (OGG/Opus, MP3 ou M4A, até 2 minutos) por campanha
--   (chave primária campanha + tipo). Os bytes ficam no próprio banco (regra do dono para a mídia do WhatsApp: sem storage
--   externo), com teto de 5 MB por arquivo garantido também aqui (CHECK). Lido só pelo servidor: no envio da saudação (vai à
--   Evolution em base64, nunca por URL) e na pré-visualização da tela do administrador. Apagar a campanha apaga a mídia.
-- "whatsapp_saudacoes.texto_saiu / imagem_saiu / audio_saiu": o que de fato saiu em cada saudação (null = a campanha não tinha
--   aquela parte). A saudação continua UMA vez por número por campanha; a falha de uma parte fica registrada e nada é reenviado.
--   "sem_confirmacao" = true: algum envio estourou o prazo sem resposta da Evolution (pode ter chegado); nada foi repetido para não
--   duplicar mensagem ao cliente (a parte sem confirmação fica null). ADD COLUMN sem padrão: nenhuma linha existente muda de conteúdo.
--
-- Somente ADITIVA e IDEMPOTENTE (CREATE/ADD ... IF NOT EXISTS). Nenhum dado existente é alterado ou apagado.
-- Reversão: DROP TABLE "whatsapp_campanha_midias"; ALTER TABLE "whatsapp_saudacoes" DROP COLUMN "texto_saiu",
--   DROP COLUMN "imagem_saiu", DROP COLUMN "audio_saiu", DROP COLUMN "sem_confirmacao" (nada depende deles).

CREATE TABLE IF NOT EXISTS "whatsapp_campanha_midias" (
  "campanha_id" integer NOT NULL REFERENCES "whatsapp_campanhas"("id") ON DELETE CASCADE,
  "tipo" varchar(10) NOT NULL CHECK ("tipo" IN ('imagem', 'audio')),
  "mime" varchar(20) NOT NULL CHECK (
    ("tipo" = 'imagem' AND "mime" IN ('image/jpeg', 'image/png')) OR
    ("tipo" = 'audio' AND "mime" IN ('audio/ogg', 'audio/mpeg', 'audio/mp4'))
  ),
  "nome" varchar(100) NOT NULL,
  "tamanho" integer NOT NULL CHECK ("tamanho" BETWEEN 1 AND 5242880),
  "duracao_s" real CHECK ("duracao_s" IS NULL OR ("duracao_s" > 0 AND "duracao_s" <= 121)),
  "sha256" varchar(64) NOT NULL,
  "conteudo" bytea NOT NULL CHECK (octet_length("conteudo") BETWEEN 1 AND 5242880),
  "enviado_por" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("campanha_id", "tipo")
);

ALTER TABLE "whatsapp_saudacoes" ADD COLUMN IF NOT EXISTS "texto_saiu" boolean;
ALTER TABLE "whatsapp_saudacoes" ADD COLUMN IF NOT EXISTS "imagem_saiu" boolean;
ALTER TABLE "whatsapp_saudacoes" ADD COLUMN IF NOT EXISTS "audio_saiu" boolean;
ALTER TABLE "whatsapp_saudacoes" ADD COLUMN IF NOT EXISTS "sem_confirmacao" boolean;
