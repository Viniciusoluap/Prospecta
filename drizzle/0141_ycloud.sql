-- 20/11/2026 — EPIC-027 (C7): integração com a YCloud (API oficial do WhatsApp, em coexistência com o WhatsApp Business App).
-- Pedido do dono: disparos de campanha pela API oficial (modelos aprovados pela Meta) sem arriscar o número; conversas, grupos e a
-- Dolores continuam pelo WhatsApp Web (Evolution). Story: docs/stories/epics/epic-027-correcoes-20-11-noite/C7-integracao-ycloud.md.
--
-- "ycloud_config"     — linha única (id = 1): interruptor geral (DESLIGADO por padrão), tetos, preço estimado e a última conferência do
--                       número na YCloud. A chave de API e o segredo do aviso de entrega NÃO ficam aqui: ficam cifrados (AES-256-GCM)
--                       em dashboard_settings, como as outras chaves do painel.
-- "ycloud_campanhas"  — uma campanha por disparo confirmado (modelo aprovado + variáveis + quem confirmou).
-- "ycloud_envios"     — um envio por destinatário: "external_id" ÚNICO (idempotência) e (campanha_id, telefone) ÚNICO (nunca duas vezes
--                       ao mesmo número na mesma campanha). Situação convergente pelos horários (aceita → enviada → entregue → lida; ou falhou).
-- "ycloud_eventos"    — ids dos avisos (webhook) já recebidos, para não processar o mesmo duas vezes. Só id e tipo: sem conteúdo.
-- "ycloud_optout"     — quem pediu para não receber: nunca mais recebe campanha pela API (não há rotina que apague).
-- "ycloud_auditoria"  — quem fez o quê e quando (ligar, salvar chave, criar campanha, quantidade, modelo). Sem telefones.
--
-- Somente ADITIVA e IDEMPOTENTE (CREATE ... IF NOT EXISTS; INSERT ... ON CONFLICT DO NOTHING). Nenhum dado existente é alterado.
-- Reversão: DROP TABLE na ordem inversa (ycloud_auditoria, ycloud_optout, ycloud_eventos, ycloud_envios, ycloud_campanhas, ycloud_config)
-- e apagar as chaves "segredo.ycloud_api_key" e "segredo.ycloud_webhook_secret" de dashboard_settings. Nada fora daqui depende delas.

CREATE TABLE IF NOT EXISTS "ycloud_config" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "ligado" boolean NOT NULL DEFAULT false,
  "teto_dia" integer NOT NULL DEFAULT 200 CHECK ("teto_dia" BETWEEN 1 AND 100000),
  "teto_campanha" integer NOT NULL DEFAULT 250 CHECK ("teto_campanha" BETWEEN 1 AND 100000),
  -- quem recebeu o MESMO modelo nos últimos N dias (qualquer campanha) é pulado; 0 = não confere
  "janela_repeticao_dias" integer NOT NULL DEFAULT 7 CHECK ("janela_repeticao_dias" BETWEEN 0 AND 90),
  "preco_estimado" numeric(10, 4) CHECK ("preco_estimado" IS NULL OR "preco_estimado" >= 0),
  "moeda" varchar(3) NOT NULL DEFAULT 'USD',
  -- última conferência do número na YCloud (GET /whatsapp/phoneNumbers)
  "numero_api" varchar(20),
  "waba_id" varchar(64),
  "nome_verificado" varchar(255),
  "status_numero" varchar(30),
  "qualidade" varchar(20),
  "limite_tier" varchar(30),
  "limite_diario" integer,
  "numero_confere" boolean NOT NULL DEFAULT false,
  "conferido_em" timestamp with time zone,
  -- aviso de entrega (POST /webhookEndpoints); o segredo fica cifrado em dashboard_settings
  "webhook_endpoint_id" varchar(80),
  "webhook_status" varchar(20),
  -- trava de UM lote por vez (em todas as campanhas): o limite diário e as 5 mensagens/s valem para o número inteiro
  "lote_ate" timestamp with time zone,
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);
INSERT INTO "ycloud_config" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "ycloud_campanhas" (
  "id" serial PRIMARY KEY NOT NULL,
  -- chave de idempotência gerada na prévia e exigida na confirmação: duas confirmações = UMA campanha
  "chave_confirmacao" varchar(64) NOT NULL,
  "nome" varchar(120) NOT NULL,
  "modelo_nome" varchar(512) NOT NULL,
  "modelo_idioma" varchar(20) NOT NULL,
  "modelo_categoria" varchar(30),
  "corpo" text NOT NULL,
  "variaveis" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" varchar(20) NOT NULL DEFAULT 'enviando' CHECK ("status" IN ('enviando', 'pausada', 'concluida', 'cancelada')),
  "motivo_pausa" varchar(300),
  "total" integer NOT NULL DEFAULT 0,
  "custo_estimado" numeric(12, 4),
  "moeda" varchar(3),
  "criada_por" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "criada_em" timestamp with time zone NOT NULL DEFAULT now(),
  "concluida_em" timestamp with time zone,
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "ycloud_campanhas_chave_confirmacao_uidx" ON "ycloud_campanhas" ("chave_confirmacao");
CREATE INDEX IF NOT EXISTS "ycloud_campanhas_modelo_idx" ON "ycloud_campanhas" ("modelo_nome", "modelo_idioma");
CREATE INDEX IF NOT EXISTS "ycloud_campanhas_status_idx" ON "ycloud_campanhas" ("status");

CREATE TABLE IF NOT EXISTS "ycloud_envios" (
  "id" serial PRIMARY KEY NOT NULL,
  "campanha_id" integer NOT NULL REFERENCES "ycloud_campanhas"("id") ON DELETE CASCADE,
  "lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL,
  -- E.164 com "+", como vai para a YCloud
  "telefone" varchar(20) NOT NULL,
  -- forma canônica (DDI + DDD + nono dígito normalizado no celular, a mesma regra estrita do número do dono): deduplicação e opt-out
  "chave_telefone" varchar(20) NOT NULL,
  "nome" varchar(255),
  "parametros" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- corpo do modelo já preenchido (o que a pessoa lê); usado para reconhecer o eco pela Evolution
  "texto" text NOT NULL,
  "external_id" varchar(80) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'na_fila'
    CHECK ("status" IN ('na_fila', 'enviando', 'aceita', 'enviada', 'entregue', 'lida', 'falhou', 'incerto')),
  "motivo" varchar(300),
  "erro_codigo" varchar(60),
  "ycloud_id" varchar(80),
  "wamid" varchar(255),
  "preco" numeric(12, 6),
  "moeda" varchar(3),
  "preco_final" boolean NOT NULL DEFAULT false,
  "tentativas" integer NOT NULL DEFAULT 0,
  "reservado_em" timestamp with time zone,
  "aceito_em" timestamp with time zone,
  "enviado_em" timestamp with time zone,
  "entregue_em" timestamp with time zone,
  "lido_em" timestamp with time zone,
  "falhou_em" timestamp with time zone,
  "mensagem_central_id" integer REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "ycloud_envios_external_id_uidx" ON "ycloud_envios" ("external_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ycloud_envios_campanha_telefone_uidx" ON "ycloud_envios" ("campanha_id", "chave_telefone");
CREATE INDEX IF NOT EXISTS "ycloud_envios_chave_telefone_idx" ON "ycloud_envios" ("chave_telefone");
CREATE INDEX IF NOT EXISTS "ycloud_envios_mensagem_central_idx" ON "ycloud_envios" ("mensagem_central_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ycloud_envios_ycloud_id_uidx" ON "ycloud_envios" ("ycloud_id");
CREATE INDEX IF NOT EXISTS "ycloud_envios_campanha_status_idx" ON "ycloud_envios" ("campanha_id", "status");
CREATE INDEX IF NOT EXISTS "ycloud_envios_aceito_idx" ON "ycloud_envios" ("aceito_em");

CREATE TABLE IF NOT EXISTS "ycloud_eventos" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "tipo" varchar(80) NOT NULL,
  "recebido_em" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ycloud_optout" (
  "id" serial PRIMARY KEY NOT NULL,
  -- E.164 com "+" (como chegou) e a forma canônica (a que vale para bloquear)
  "telefone" varchar(20) NOT NULL,
  "chave_telefone" varchar(20) NOT NULL,
  "origem" varchar(30) NOT NULL CHECK ("origem" IN ('painel', 'whatsapp_preferencia', 'ycloud_descadastro')),
  "lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL,
  "registrado_por" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "ycloud_optout_chave_telefone_uidx" ON "ycloud_optout" ("chave_telefone");

CREATE TABLE IF NOT EXISTS "ycloud_auditoria" (
  "id" serial PRIMARY KEY NOT NULL,
  "acao" varchar(60) NOT NULL,
  "usuario_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "campanha_id" integer REFERENCES "ycloud_campanhas"("id") ON DELETE SET NULL,
  "modelo" varchar(600),
  "quantidade" integer,
  "detalhe" varchar(300),
  "criado_em" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ycloud_auditoria_criado_idx" ON "ycloud_auditoria" ("criado_em");
