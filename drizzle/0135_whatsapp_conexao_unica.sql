-- 20/11/2026 — EPIC-025 (etapa 9): WhatsApp com UMA conexão só (regra do dono de 20/11/2026: "Não, eu quero uma conexão só";
-- "Autorizo os itens 1 a 7, pode executar"). O número conectado em Integrações é o da empresa e serve a Dolores E a Central.
-- Story: docs/stories/epics/epic-025-dolores/E9-conexao-unica-e-atendimento.md.
--
-- "whatsapp_atendimento_config": linha única (id = 1) — interruptores e tetos da etapa 9, TODOS DESLIGADOS/conservadores por
--   padrão: Dolores responde cliente cadastrado (desligado), teto por cliente/dia e global/dia, horas de silêncio depois que a
--   equipe responde, teto diário de saudações, transcrição de áudio (desligada), duração máxima e tetos da transcrição, intervalo
--   e textos dos avisos de ligação e de áudio (editáveis em Templates).
-- "whatsapp_campanhas": campanhas de saudação (nome, empreendimento opcional, texto fixo). Nascem INATIVAS; no máximo UMA ativa
--   (índice único parcial — garantido no banco).
-- "whatsapp_saudacoes": a saudação que saiu (ou foi reivindicada) — UMA por número por campanha (índice único). O número fica só
--   como resumo HMAC (segredo do servidor) e mascarado; nunca o número inteiro.
-- "whatsapp_avisos_numero": último aviso de ligação/áudio por número (resumo HMAC) — no máximo 1 a cada N horas.
-- "whatsapp_silencio": a equipe respondeu naquela conversa → a Dolores fica calada nela até "ate" (resumo HMAC do número).
-- "whatsapp_roteamento_vistos": cada mensagem (instância + id) é tratada pelo roteamento UMA vez (reentrega do aviso não duplica
--   conversa, saudação nem resposta).
-- "whatsapp_atendimento_contagem": contadores atômicos (por cliente/dia, global/dia, saudações/dia, transcrições).
-- "dolores_atendimentos": uma linha por mensagem de cliente cadastrado tratada pela Dolores (idempotente por instância + id), com a
--   reserva do limite mensal; no máximo UMA em andamento por número (índice único parcial). Sem texto completo de terceiro além
--   da pergunta filtrada; remetente só mascarado.
-- "whatsapp_messages.automatica": marca as mensagens que o sistema enviou sozinho (resposta da Dolores, saudação, aviso) para a
--   Central mostrar como automáticas. ADD COLUMN com padrão constante (false): nenhuma linha existente muda de conteúdo.
--
-- Somente ADITIVA e IDEMPOTENTE: CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS e INSERT ... ON CONFLICT DO NOTHING. Nenhum
-- dado existente é alterado ou apagado; a instância conectada e a linha de whatsapp_connections do admin NÃO são tocadas (a
-- Central do admin passa a usar a conexão da empresa por CÓDIGO, ao ler). Nenhuma tabela nova tem gatilho; as FKs ON DELETE SET
-- NULL (usuário que mudou a configuração/criou a campanha, cliente do atendimento) não esbarram em guarda nenhuma.
-- Reversão: DROP TABLE "dolores_atendimentos", "whatsapp_atendimento_contagem", "whatsapp_roteamento_vistos", "whatsapp_silencio",
-- "whatsapp_avisos_numero", "whatsapp_saudacoes", "whatsapp_campanhas", "whatsapp_atendimento_config";
-- ALTER TABLE "whatsapp_messages" DROP COLUMN "automatica" (nada depende delas).

CREATE TABLE IF NOT EXISTS "whatsapp_atendimento_config" (
  "id" integer PRIMARY KEY NOT NULL DEFAULT 1 CHECK ("id" = 1),
  "cliente_ligado" boolean NOT NULL DEFAULT false,
  "cliente_teto_dia" integer NOT NULL DEFAULT 10 CHECK ("cliente_teto_dia" BETWEEN 1 AND 50),
  "cliente_teto_global_dia" integer NOT NULL DEFAULT 100 CHECK ("cliente_teto_global_dia" BETWEEN 1 AND 2000),
  "silencio_horas" integer NOT NULL DEFAULT 6 CHECK ("silencio_horas" BETWEEN 1 AND 72),
  "saudacao_teto_dia" integer NOT NULL DEFAULT 50 CHECK ("saudacao_teto_dia" BETWEEN 1 AND 500),
  "transcricao_ligada" boolean NOT NULL DEFAULT false,
  "transcricao_duracao_max_s" integer NOT NULL DEFAULT 120 CHECK ("transcricao_duracao_max_s" BETWEEN 10 AND 600),
  "transcricao_teto_numero_dia" integer NOT NULL DEFAULT 10 CHECK ("transcricao_teto_numero_dia" BETWEEN 1 AND 100),
  "transcricao_teto_global_dia" integer NOT NULL DEFAULT 100 CHECK ("transcricao_teto_global_dia" BETWEEN 1 AND 2000),
  "aviso_intervalo_horas" integer NOT NULL DEFAULT 3 CHECK ("aviso_intervalo_horas" BETWEEN 1 AND 48),
  "aviso_ligacao" varchar(500) NOT NULL DEFAULT 'Olá! Sou a Dolores, da Prospecta. Não atendo ligações por aqui, mas pode me escrever que a gente responde.',
  "aviso_audio" varchar(500) NOT NULL DEFAULT 'Olá! Não consegui ouvir o áudio. Pode escrever a sua mensagem, por favor?',
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);
INSERT INTO "whatsapp_atendimento_config" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "whatsapp_campanhas" (
  "id" serial PRIMARY KEY NOT NULL,
  "nome" varchar(120) NOT NULL,
  "empreendimento" varchar(160),
  "texto" varchar(1000) NOT NULL,
  "ativa" boolean NOT NULL DEFAULT false,
  "criado_por" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);
-- UMA campanha ativa por vez (garantido no banco: uma segunda "ativa = true" é recusada)
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_campanhas_uma_ativa" ON "whatsapp_campanhas" ((true)) WHERE "ativa";

CREATE TABLE IF NOT EXISTS "whatsapp_saudacoes" (
  "id" serial PRIMARY KEY NOT NULL,
  "campanha_id" integer NOT NULL REFERENCES "whatsapp_campanhas"("id") ON DELETE CASCADE,
  -- resumo HMAC do número (segredo do servidor); nunca o número
  "chave_numero" varchar(32) NOT NULL,
  -- sempre mascarado: "(99) *****-4567"
  "remetente" varchar(30),
  "situacao" varchar(12) NOT NULL DEFAULT 'enviando' CHECK ("situacao" IN ('enviando', 'enviada', 'erro')),
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "enviada_em" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_saudacoes_uma_por_numero" ON "whatsapp_saudacoes" ("campanha_id", "chave_numero");

CREATE TABLE IF NOT EXISTS "whatsapp_avisos_numero" (
  "chave_numero" varchar(32) NOT NULL,
  "tipo" varchar(10) NOT NULL CHECK ("tipo" IN ('ligacao', 'audio')),
  "ultimo_em" timestamp with time zone NOT NULL DEFAULT now(),
  "total" integer NOT NULL DEFAULT 1,
  PRIMARY KEY ("chave_numero", "tipo")
);

CREATE TABLE IF NOT EXISTS "whatsapp_silencio" (
  "chave_numero" varchar(32) PRIMARY KEY NOT NULL,
  "ate" timestamp with time zone NOT NULL,
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "whatsapp_roteamento_vistos" (
  "instancia" varchar(80) NOT NULL,
  "external_id" varchar(160) NOT NULL,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("instancia", "external_id")
);
CREATE INDEX IF NOT EXISTS "whatsapp_roteamento_vistos_criado_idx" ON "whatsapp_roteamento_vistos" ("criado_em");

CREATE TABLE IF NOT EXISTS "whatsapp_atendimento_contagem" (
  "chave" varchar(80) PRIMARY KEY NOT NULL,
  "total" integer NOT NULL DEFAULT 0,
  "primeira_em" timestamp with time zone NOT NULL DEFAULT now(),
  "ultima_em" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "dolores_atendimentos" (
  "id" serial PRIMARY KEY NOT NULL,
  "instancia" varchar(80) NOT NULL,
  "external_id" varchar(160) NOT NULL,
  "chave_numero" varchar(32) NOT NULL,
  "remetente" varchar(30),
  "lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL,
  "origem" varchar(8) NOT NULL DEFAULT 'texto' CHECK ("origem" IN ('texto', 'audio')),
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "enviada_em" timestamp with time zone,
  "pergunta" varchar(500),
  "situacao" varchar(16) NOT NULL DEFAULT 'processando'
    CHECK ("situacao" IN ('processando', 'respondida', 'fora_de_escopo', 'silencio', 'erro')),
  "motivo" varchar(200),
  "resposta" varchar(800),
  "respondida_em" timestamp with time zone,
  "voltas" smallint NOT NULL DEFAULT 0,
  "tokens_entrada" integer NOT NULL DEFAULT 0,
  "tokens_saida" integer NOT NULL DEFAULT 0,
  "reserva_entrada" integer NOT NULL DEFAULT 0,
  "reserva_saida" integer NOT NULL DEFAULT 0,
  "reserva_ate" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "dolores_atendimentos_externa_uidx" ON "dolores_atendimentos" ("instancia", "external_id");
CREATE UNIQUE INDEX IF NOT EXISTS "dolores_atendimentos_um_por_numero" ON "dolores_atendimentos" ("chave_numero") WHERE "situacao" = 'processando';
CREATE INDEX IF NOT EXISTS "dolores_atendimentos_reserva_idx" ON "dolores_atendimentos" ("reserva_ate") WHERE "reserva_ate" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "dolores_atendimentos_criado_idx" ON "dolores_atendimentos" ("criado_em");

ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "automatica" boolean NOT NULL DEFAULT false;
