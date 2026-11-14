-- 14/11/2026 — Maquete 3D (EPIC-022, etapa 1). Exclusivo do Prospecta (exceção de paridade registrada no ROADMAP).
-- Somente aditiva e idempotente: cria tabelas novas (IF NOT EXISTS); nenhuma tabela ou dado existente é alterado
-- ou apagado. Reversão: DROP das tabelas maquete_3d_config e maquetes_3d (nenhuma outra tabela depende delas).

CREATE TABLE IF NOT EXISTS "maquete_3d_config" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  -- JSON: { precos: { faixa: valor }, modeloIA, esforcoIA }
  "dados" text NOT NULL DEFAULT '{}',
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "maquetes_3d" (
  "id" serial PRIMARY KEY,
  -- Identificador público do link da maquete (etapa 2).
  "token" varchar(64) NOT NULL UNIQUE,
  "titulo" varchar(255) NOT NULL,
  "origem" varchar(20) NOT NULL CHECK ("origem" IN ('projeto', 'incorporacao')),
  "project_id" integer REFERENCES "operational_projects"("id") ON DELETE RESTRICT,
  "study_id" integer REFERENCES "incorporation_studies"("id") ON DELETE RESTRICT,
  "tipo" varchar(20) NOT NULL CHECK ("tipo" IN ('casa', 'predio', 'condominio', 'loteamento')),
  "status" varchar(30) NOT NULL,
  -- Cobrança (só origem = projeto). Incorporação não tem preço.
  "faixa_preco" varchar(30),
  "preco" numeric(15, 2),
  "payment_order_id" integer REFERENCES "payment_orders"("id") ON DELETE SET NULL,
  "pago_em" timestamp,
  -- Quem liberou: confirmação de pagamento (projeto) ou autorização do administrador (incorporação).
  "liberado_por" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "liberado_em" timestamp,
  "liberacao_nota" varchar(400),
  -- JSON: [{ fonte, id, nome }] — PDFs escolhidos para a leitura.
  "documentos" text NOT NULL DEFAULT '[]',
  -- JSON: passos da leitura, resultados parciais e consumo de tokens.
  "leitura" text NOT NULL DEFAULT '{}',
  -- JSON: modelo em três camadas (shared/maquete-3d/modelo.ts). Nulo até a leitura terminar.
  "modelo" text,
  "modelo_versao" integer NOT NULL DEFAULT 0,
  "revisado_por" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "revisado_em" timestamp,
  "publicado_em" timestamp,
  "recusa_motivo" varchar(400),
  "solicitado_por" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp,
  CONSTRAINT "maquetes_3d_origem_alvo_ck" CHECK (
    ("origem" = 'projeto' AND "project_id" IS NOT NULL AND "study_id" IS NULL) OR
    ("origem" = 'incorporacao' AND "study_id" IS NOT NULL AND "project_id" IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS "maquetes_3d_project_idx" ON "maquetes_3d" ("project_id");
CREATE INDEX IF NOT EXISTS "maquetes_3d_study_idx" ON "maquetes_3d" ("study_id");
CREATE INDEX IF NOT EXISTS "maquetes_3d_status_idx" ON "maquetes_3d" ("status");
