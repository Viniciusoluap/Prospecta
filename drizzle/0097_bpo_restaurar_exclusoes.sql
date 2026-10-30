-- Lote 4 (30/10/2026) — BPO: "Restaurar" exclusões em lote a partir do backup.
-- Aditiva e idempotente. Marca quem/quando restaurou (impede restaurar duas vezes) e guarda o resumo.
-- Paridade: Santa Fé web/prisma/migrations/20261030120000_bpo_restaurar_exclusoes. Não aplicar em produção sem autorização.
ALTER TABLE bpo_lancamento_exclusoes_backup ADD COLUMN IF NOT EXISTS restaurado_em timestamp;--> statement-breakpoint
ALTER TABLE bpo_lancamento_exclusoes_backup ADD COLUMN IF NOT EXISTS restaurado_por_user_id integer REFERENCES users(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE bpo_lancamento_exclusoes_backup ADD COLUMN IF NOT EXISTS restauracao_json text;
