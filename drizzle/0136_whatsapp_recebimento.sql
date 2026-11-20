-- 20/11/2026 — EPIC-026 (C2): mensagem recebida de outro número não aparecia na Central e não deixava registro nenhum.
-- Regra nova do dono (registrada no epic): nenhuma mensagem é descartada sem registro visível.
-- Story: docs/stories/epics/epic-026-correcoes-20-11/C2-mensagem-recebida-nao-aparece.md.
--
-- "whatsapp_recebimento_contagem": diagnóstico do recebimento, SEM CONTEÚDO — contador por hora (UTC) de cada aviso que chega ao
--   webhook da empresa e do que foi feito com cada item: evento (ex.: "messages.upsert"), destino ("chegou", "central",
--   "central_sem_numero", "dolores", "grupo", "propria", "ignorado", "repetida", "erro", "evento"), motivo curto e a FORMA do
--   endereço ("numero", "lid", "grupo", "status", "vazio", "outro"). Nunca texto da mensagem, nunca número, nunca nome. Tamanho
--   limitado pelas combinações (uma linha por hora por combinação; spam só soma no total). Retenção de 7 dias (o próprio código
--   apaga as horas mais antigas). Lido só pela tela de administrador "Recebimento nas últimas 24 h".
-- "whatsapp_lid_numeros": o número real de um endereço "@lid" do WhatsApp, aprendido do próprio aviso (quando a Evolution manda
--   os dois juntos) ou consultado na Evolution. Serve para (1) nunca mostrar na Central a conversa do dono que chegue só com o
--   "@lid" e (2) a conversa de "número não identificado" passar a mostrar o número quando ele for conhecido. Nunca serve para
--   comando: comando continua exigindo o número no próprio endereço da mensagem. Origem: "aviso" (número no endereço: confirmado),
--   "evolution" (só a consulta de contatos: provável — a conversa continua "não identificada" para envio e vínculo) ou
--   "nao_resolvido" (a consulta não achou o número; número vazio; a consulta não se repete por 10 minutos).
--
-- Somente ADITIVA e IDEMPOTENTE (CREATE ... IF NOT EXISTS). Nenhum dado existente é alterado ou apagado.
-- Reversão: DROP TABLE "whatsapp_recebimento_contagem", "whatsapp_lid_numeros" (nada depende delas).

CREATE TABLE IF NOT EXISTS "whatsapp_recebimento_contagem" (
  "hora" varchar(13) NOT NULL,
  "evento" varchar(40) NOT NULL,
  "destino" varchar(24) NOT NULL,
  "motivo" varchar(60) NOT NULL DEFAULT '',
  "endereco" varchar(12) NOT NULL DEFAULT '',
  "total" integer NOT NULL DEFAULT 0 CHECK ("total" >= 0),
  "ultima_em" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("hora", "evento", "destino", "motivo", "endereco")
);

CREATE TABLE IF NOT EXISTS "whatsapp_lid_numeros" (
  "instancia" varchar(80) NOT NULL,
  "lid" varchar(40) NOT NULL,
  "numero" varchar(20) NOT NULL,
  "origem" varchar(16) NOT NULL DEFAULT 'aviso' CHECK ("origem" IN ('aviso', 'evolution', 'nao_resolvido')),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("instancia", "lid")
);
