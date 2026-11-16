-- 16/11/2026 — EPIC-024 (S-01): "Liberar reimportação" do Conta Azul no BPO. Antes de remover em definitivo um
-- lançamento ARQUIVADO do Conta Azul que segura a chave única request_key, a linha inteira é copiada para cá
-- (um lote_id por execução, com quem fez e quando).
-- Somente aditiva e idempotente: cria uma tabela nova e seus índices (IF NOT EXISTS); nada existente é alterado ou apagado.
-- Reversão: DROP TABLE "bpo_lancamentos_expurgo" (nenhuma outra tabela depende dela). Para devolver um lançamento,
-- reinserir a partir de "dados_json".

CREATE TABLE IF NOT EXISTS "bpo_lancamentos_expurgo" (
  "id" serial PRIMARY KEY NOT NULL,
  "lote_id" varchar(40) NOT NULL,
  "lancamento_id" integer NOT NULL,
  "request_key" varchar(80),
  "origem_efetiva" varchar(30),
  "exclusao_lote_backup_id" integer,
  "motivo" varchar(60) DEFAULT 'liberar_reimportacao_conta_azul' NOT NULL,
  "dados_json" text NOT NULL,
  "expurgado_por_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "expurgado_em" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "bpo_lancamentos_expurgo_lote_idx" ON "bpo_lancamentos_expurgo" ("lote_id");
CREATE INDEX IF NOT EXISTS "bpo_lancamentos_expurgo_lancamento_idx" ON "bpo_lancamentos_expurgo" ("lancamento_id");
