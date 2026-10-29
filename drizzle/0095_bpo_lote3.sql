-- Lote 3 (29/10/2026) — BPO: item 16 (combinar pagamentos e exclusão em lote com backup).
-- Aditiva. Paridade: Santa Fé web/prisma/migrations/20261029111000_bpo_lote3. Não aplicar em produção sem autorização.
ALTER TABLE bpo_lancamentos ADD COLUMN IF NOT EXISTS combinada_em_id integer REFERENCES bpo_lancamentos(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bpo_lancamentos_combinada_em_idx ON bpo_lancamentos(combinada_em_id);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS bpo_lancamento_exclusoes_backup (
  id serial PRIMARY KEY,
  modo varchar(20) NOT NULL,
  aba varchar(20) NOT NULL,
  filtros_json text DEFAULT '{}' NOT NULL,
  quantidade integer NOT NULL,
  protegidos integer DEFAULT 0 NOT NULL,
  snapshot_json text NOT NULL,
  criado_por_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bpo_lancamento_exclusoes_backup_created_idx ON bpo_lancamento_exclusoes_backup(created_at);
