-- 12/11/2026 — Central de Vendas (docs/prompts/central-de-vendas.md, etapa 2).
-- Somente aditiva e idempotente: cria tabelas novas (IF NOT EXISTS); nenhuma tabela ou dado existente é
-- alterado ou apagado. Reversão: DROP das tabelas central_vendas_* (nenhuma outra tabela depende delas).

CREATE TABLE IF NOT EXISTS "central_vendas_config" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "dados" text NOT NULL DEFAULT '{}',
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "central_vendas_checklists" (
  "id" serial PRIMARY KEY,
  "slug" varchar(60) NOT NULL UNIQUE,
  "nome" varchar(120) NOT NULL,
  -- JSON: [{ "chave", "nome", "tipo" (lead_doc_type), "obrigatorio" }]
  "documentos" text NOT NULL DEFAULT '[]',
  "ativo" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "central_vendas_produtos" (
  "id" serial PRIMARY KEY,
  "slug" varchar(80) NOT NULL UNIQUE,
  "nome" varchar(160) NOT NULL,
  "tipo" varchar(20) NOT NULL DEFAULT 'empreendimento' CHECK ("tipo" IN ('empreendimento', 'produto')),
  "descricao" text NOT NULL DEFAULT '',
  "cidade" varchar(100),
  "preco_min" numeric(15, 2),
  "preco_max" numeric(15, 2),
  "requisitos" text NOT NULL DEFAULT '',
  -- Única fonte de condição comercial que a IA pode citar.
  "condicoes" text NOT NULL DEFAULT '',
  "checklist_id" integer REFERENCES "central_vendas_checklists"("id") ON DELETE SET NULL,
  "ativo" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "central_vendas_campanhas" (
  "id" serial PRIMARY KEY,
  "codigo" varchar(80) NOT NULL UNIQUE,
  "canal" varchar(60) NOT NULL,
  "nome" varchar(160) NOT NULL,
  "produto_id" integer REFERENCES "central_vendas_produtos"("id") ON DELETE SET NULL,
  "ativo" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- Reivindicação do telefone (DDD + 8 últimos dígitos): dois avisos simultâneos nunca criam dois leads.
CREATE TABLE IF NOT EXISTS "central_vendas_contatos" (
  "phone_key" varchar(20) PRIMARY KEY,
  "lead_id" integer REFERENCES "leads"("id") ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "central_vendas_leads" (
  "lead_id" integer PRIMARY KEY REFERENCES "leads"("id") ON DELETE CASCADE,
  "status_atendimento" varchar(30) NOT NULL DEFAULT 'novo' CHECK ("status_atendimento" IN
    ('novo', 'em_atendimento_ia', 'em_atendimento_humano', 'aguardando_cliente', 'sem_resposta', 'encerrado')),
  "status_documental" varchar(30) NOT NULL DEFAULT 'nao_iniciado' CHECK ("status_documental" IN
    ('nao_iniciado', 'aguardando_documentos', 'parcial', 'completo')),
  "status_analise" varchar(20) NOT NULL DEFAULT 'nao_enviado' CHECK ("status_analise" IN
    ('nao_enviado', 'em_analise', 'pendente', 'aprovado', 'reprovado')),
  "origem" varchar(20) NOT NULL DEFAULT 'whatsapp',
  "id_externo" varchar(160),
  "campanha" varchar(80),
  "produto_id" integer REFERENCES "central_vendas_produtos"("id") ON DELETE SET NULL,
  "checklist_id" integer REFERENCES "central_vendas_checklists"("id") ON DELETE SET NULL,
  "connection_id" integer,
  "estado_civil" varchar(40),
  -- JSON com as respostas da qualificação já dadas (inclusive "não tem FGTS"), sem repetir o que está em leads.
  "qualificacao" text NOT NULL DEFAULT '{}',
  "operador_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "atribuido_em" timestamp,
  "aguardando_humano_desde" timestamp,
  "primeira_mensagem_em" timestamp,
  "primeira_resposta_em" timestamp,
  "primeira_resposta_humana_em" timestamp,
  "ultima_mensagem_cliente_em" timestamp,
  "ultima_mensagem_enviada_em" timestamp,
  "qualificado_em" timestamp,
  "docs_solicitados_em" timestamp,
  "docs_completos_em" timestamp,
  "enviado_analise_em" timestamp,
  "decisao_em" timestamp,
  "decisao_por" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "pendencias_analise" text,
  "motivo_transferencia" varchar(60),
  "resumo_transferencia" text,
  "sem_progresso" integer NOT NULL DEFAULT 0,
  "mensagens_ia" integer NOT NULL DEFAULT 0,
  "tokens_consumidos" integer NOT NULL DEFAULT 0,
  "opt_out" boolean NOT NULL DEFAULT false,
  "opt_out_em" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  -- Decisão da análise só existe com o humano que decidiu (nenhuma automação grava decisao_por).
  CONSTRAINT "central_vendas_leads_decisao_humana" CHECK
    ("status_analise" NOT IN ('pendente', 'aprovado', 'reprovado') OR "decisao_por" IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS "central_vendas_leads_origem_externo_uidx"
  ON "central_vendas_leads" ("origem", "id_externo") WHERE "id_externo" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "central_vendas_leads_operador_idx" ON "central_vendas_leads" ("operador_id");

CREATE TABLE IF NOT EXISTS "central_vendas_documentos" (
  "id" serial PRIMARY KEY,
  "lead_id" integer NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "lead_document_id" integer NOT NULL UNIQUE REFERENCES "lead_documents"("id") ON DELETE CASCADE,
  "message_id" integer UNIQUE,
  "chave" varchar(60),
  "confianca" numeric(4, 3),
  "a_conferir" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "central_vendas_eventos" (
  "id" serial PRIMARY KEY,
  "tipo" varchar(60) NOT NULL,
  "lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL,
  "origem" varchar(30) NOT NULL DEFAULT 'sistema',
  -- Resumo sem dados sensíveis (sem telefone, CPF, renda ou texto da conversa).
  "payload" text,
  "resultado" varchar(30) NOT NULL DEFAULT 'ok',
  "erro" text,
  "chave" varchar(200) UNIQUE,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "central_vendas_eventos_lead_idx" ON "central_vendas_eventos" ("lead_id");
CREATE INDEX IF NOT EXISTS "central_vendas_eventos_data_idx" ON "central_vendas_eventos" ("created_at");

CREATE TABLE IF NOT EXISTS "central_vendas_fila" (
  "id" serial PRIMARY KEY,
  "chave" varchar(200) NOT NULL UNIQUE,
  "tipo" varchar(30) NOT NULL DEFAULT 'mensagem',
  "lead_id" integer REFERENCES "leads"("id") ON DELETE CASCADE,
  "numero" varchar(30),
  "proativa" boolean NOT NULL DEFAULT false,
  "payload" text NOT NULL DEFAULT '{}',
  "status" varchar(20) NOT NULL DEFAULT 'pendente' CHECK ("status" IN
    ('pendente', 'processando', 'concluido', 'falhou', 'descartado', 'incerto')),
  "tentativas" integer NOT NULL DEFAULT 0,
  "proxima_tentativa_em" timestamp NOT NULL DEFAULT now(),
  "ultimo_erro" text,
  "mensagem_id" integer,
  "concluido_em" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "central_vendas_fila_status_idx" ON "central_vendas_fila" ("status", "proxima_tentativa_em");

CREATE TABLE IF NOT EXISTS "central_vendas_sequencias" (
  "id" serial PRIMARY KEY,
  "tipo" varchar(30) NOT NULL CHECK ("tipo" IN ('followup_aprovado', 'sem_resposta', 'reativacao')),
  "nome" varchar(120) NOT NULL,
  -- JSON: [{ "aposDias", "templateSlug" }]
  "passos" text NOT NULL DEFAULT '[]',
  "ativo" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Limitação de taxa dos endpoints de entrada (janela de 1 minuto).
CREATE TABLE IF NOT EXISTS "central_vendas_limites" (
  "chave" varchar(120) NOT NULL,
  "janela" timestamp NOT NULL,
  "total" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("chave", "janela")
);

-- Consumo mensal de tokens da IA (limite configurável).
CREATE TABLE IF NOT EXISTS "central_vendas_tokens_mes" (
  "mes" varchar(7) PRIMARY KEY,
  "tokens" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
