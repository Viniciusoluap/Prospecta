-- 16/11/2026 — EPIC-025 (etapa 2, WhatsApp): conexão própria da Dolores, comando pelo número do dono e consumo da IA.
-- "dolores_whatsapp_config": linha única (id = 1) — interruptor da IA (DESLIGADO por padrão), modelo (vazio = o
--   preferencial de Integrações › Anthropic), instância e situação da conexão por QR code, número da Dolores, número do
--   dono (o único que comanda) e os limites mensais de tokens (0 = IA bloqueada até o admin definir).
-- "dolores_mensagens": uma linha por mensagem direta DO DONO recebida no número dela (instância + id externo únicos: a
--   mesma mensagem entregue de novo não gera outra resposta nem outro gasto). Guarda o remetente mascarado e o comando
--   do dono já filtrado; nunca a resposta. Mensagem de outro número não grava linha aqui (só a contagem por hora em
--   "dolores_remetentes_estranhos"): spam não faz a tabela crescer.
-- "dolores_consumo": uma linha por chamada ao modelo (tokens de entrada, saída e cache), base do limite mensal.
-- Somente aditiva e idempotente: só tabelas, colunas e índices novos (IF NOT EXISTS); a linha de configuração entra com
-- ON CONFLICT DO NOTHING. Nenhuma tabela anterior a esta migração é alterada.
-- Reversão: DROP TABLE "dolores_remetentes_estranhos", "dolores_consumo", "dolores_mensagens", "dolores_whatsapp_config"
-- (nada depende delas).

CREATE TABLE IF NOT EXISTS "dolores_whatsapp_config" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "ia_ligada" boolean NOT NULL DEFAULT false,
  "modelo" varchar(120),
  "instancia" varchar(80),
  "status_conexao" varchar(20) NOT NULL DEFAULT 'desconectado',
  "numero_dolores" varchar(20),
  "numero_dono" varchar(20),
  "limite_mensal_tokens_entrada" integer NOT NULL DEFAULT 0 CHECK ("limite_mensal_tokens_entrada" >= 0),
  "limite_mensal_tokens_saida" integer NOT NULL DEFAULT 0 CHECK ("limite_mensal_tokens_saida" >= 0),
  -- mês (AAAA-MM, Imperatriz) em que o dono já foi avisado do limite: o aviso sai uma vez por mês
  "aviso_limite_mes" varchar(7),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);

INSERT INTO "dolores_whatsapp_config" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "dolores_mensagens" (
  "id" serial PRIMARY KEY NOT NULL,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "instancia" varchar(80) NOT NULL,
  "external_id" varchar(160) NOT NULL,
  -- remetente mascarado: DDD + 4 últimos dígitos
  "remetente" varchar(30),
  "do_dono" boolean NOT NULL DEFAULT false,
  "situacao" varchar(20) NOT NULL DEFAULT 'recebida'
    CHECK ("situacao" IN ('recebida', 'ignorada', 'processando', 'respondida', 'bloqueada', 'erro')),
  "motivo" varchar(300),
  -- só o comando do dono, filtrado e cortado
  "texto" varchar(2000),
  "enviada_em" timestamp with time zone,
  "respondida_em" timestamp with time zone,
  "voltas" smallint NOT NULL DEFAULT 0,
  "tokens_entrada" integer NOT NULL DEFAULT 0,
  "tokens_saida" integer NOT NULL DEFAULT 0,
  -- reserva do limite mensal para a chamada ao modelo EM ANDAMENTO desta mensagem (tirada sob trava antes de chamar,
  -- liberada depois; vence sozinha em "reserva_ate" se a função morrer no meio)
  "reserva_entrada" integer NOT NULL DEFAULT 0,
  "reserva_saida" integer NOT NULL DEFAULT 0,
  "reserva_ate" timestamp with time zone
);

-- colunas acrescentadas depois da primeira versão desta migração (idempotente, caso a tabela já exista)
ALTER TABLE "dolores_mensagens" ADD COLUMN IF NOT EXISTS "reserva_entrada" integer NOT NULL DEFAULT 0;
ALTER TABLE "dolores_mensagens" ADD COLUMN IF NOT EXISTS "reserva_saida" integer NOT NULL DEFAULT 0;
ALTER TABLE "dolores_mensagens" ADD COLUMN IF NOT EXISTS "reserva_ate" timestamp with time zone;

CREATE UNIQUE INDEX IF NOT EXISTS "dolores_mensagens_externa_uidx" ON "dolores_mensagens" ("instancia", "external_id");
CREATE INDEX IF NOT EXISTS "dolores_mensagens_criado_em_idx" ON "dolores_mensagens" ("criado_em");
-- QA r2 N8: índices parciais — a recuperação de pedidos interrompidos (situacao = 'processando') e a soma das reservas
-- válidas (reserva_ate) leem só as poucas linhas vivas, não a tabela inteira, a cada aviso.
CREATE INDEX IF NOT EXISTS "dolores_mensagens_processando_idx" ON "dolores_mensagens" ("instancia", "criado_em") WHERE "situacao" = 'processando';
CREATE INDEX IF NOT EXISTS "dolores_mensagens_reserva_idx" ON "dolores_mensagens" ("reserva_ate") WHERE "reserva_ate" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "dolores_consumo" (
  "id" serial PRIMARY KEY NOT NULL,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  -- mês de Imperatriz (AAAA-MM): soma do limite mensal
  "mes" varchar(7) NOT NULL,
  "mensagem_id" integer REFERENCES "dolores_mensagens"("id") ON DELETE SET NULL,
  "modelo" varchar(120) NOT NULL,
  "volta" smallint NOT NULL,
  "tokens_entrada" integer NOT NULL DEFAULT 0,
  "tokens_saida" integer NOT NULL DEFAULT 0,
  "tokens_cache_escrita" integer NOT NULL DEFAULT 0,
  "tokens_cache_leitura" integer NOT NULL DEFAULT 0,
  "parada" varchar(30)
);

CREATE INDEX IF NOT EXISTS "dolores_consumo_mes_idx" ON "dolores_consumo" ("mes");

-- "dolores_remetentes_estranhos": contagem, por hora, das mensagens de números que NÃO são o dono (spam não infla
--   "dolores_acoes", que só recebe a primeira de cada remetente na hora). "chave" = resumo HMAC do número com o segredo
--   do servidor (não se reverte); "remetente" só mascarado. Nunca o texto.
CREATE TABLE IF NOT EXISTS "dolores_remetentes_estranhos" (
  "chave" varchar(16) NOT NULL,
  -- hora (UTC) da janela: AAAA-MM-DDTHH
  "hora" varchar(13) NOT NULL,
  "remetente" varchar(30),
  "mensagens" integer NOT NULL DEFAULT 1,
  "primeira_em" timestamp with time zone NOT NULL DEFAULT now(),
  "ultima_em" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("chave", "hora")
);
