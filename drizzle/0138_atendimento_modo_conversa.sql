-- 20/11/2026 — EPIC-026 (C6): botão "Assumir (humano)" / "Devolver para a Dolores" na conversa da Central WhatsApp.
-- Pedido do dono: "Faça um botão nas mensagens lá no WhatsApp para que coloque para assumir o humano ou devolver pra Dolores e
-- assim nós podemos fazer isso manualmente quando necessário."
-- Story: docs/stories/epics/epic-026-correcoes-20-11/C6-assumir-ou-devolver-conversa.md.
--
-- "whatsapp_atendimento_modo": quem atende cada conversa direta do número da empresa, por instância + resumo HMAC do número
--   (o mesmo de whatsapp_silencio; nunca o número). "humano" = a equipe assumiu: a Dolores fica calada nesta conversa, sem prazo,
--   até alguém devolver. "dolores" = devolvida: o silêncio automático daquele momento foi encerrado; só mensagem da equipe
--   enviada depois de "alterado_em" volta a calar. Sem linha = regra de sempre (silêncio automático de whatsapp_silencio).
--   Guarda quem mudou e quando; lead_id só para a auditoria e a tela.
--
-- Somente ADITIVA e IDEMPOTENTE (CREATE ... IF NOT EXISTS). Nenhum dado existente é alterado ou apagado. Sem gatilho; as FKs
-- ON DELETE SET NULL (usuário que mudou, lead) não esbarram em guarda nenhuma.
-- Reversão: DROP TABLE "whatsapp_atendimento_modo" (nada depende dela; sem ela, tudo volta à regra do silêncio automático).

CREATE TABLE IF NOT EXISTS "whatsapp_atendimento_modo" (
  "id" serial PRIMARY KEY NOT NULL,
  "instancia" varchar(80) NOT NULL,
  -- resumo HMAC do número (segredo do servidor); nunca o número
  "chave_numero" varchar(32) NOT NULL,
  "lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL,
  "modo" varchar(8) NOT NULL CHECK ("modo" IN ('humano', 'dolores')),
  "alterado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "alterado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_atendimento_modo_conversa_uidx" ON "whatsapp_atendimento_modo" ("instancia", "chave_numero");
CREATE INDEX IF NOT EXISTS "whatsapp_atendimento_modo_chave_idx" ON "whatsapp_atendimento_modo" ("chave_numero");
