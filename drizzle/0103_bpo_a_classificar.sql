-- Pedido de 12/11 (noite) — BPO: aba "A classificar" e divisão de pagamentos (split).
-- Aditiva e idempotente; sem UPDATE de dados. A marcação dos lançamentos do Conta Azul em aberto
-- já importados é um passo separado, autorizado pelo dono (SQL no HANDOFF-12-11-BPO-CONTA-AZUL.md).
-- Não aplicar em produção sem autorização.
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS a_classificar boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE bpo_lancamentos ADD COLUMN IF NOT EXISTS a_classificar boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE bpo_recebimentos ADD COLUMN IF NOT EXISTS bank_transaction_id integer REFERENCES bank_transactions(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bpo_recebimentos_bank_transaction_idx ON bpo_recebimentos(bank_transaction_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bank_transactions_a_classificar_idx ON bank_transactions(a_classificar) WHERE a_classificar;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bpo_lancamentos_a_classificar_idx ON bpo_lancamentos(a_classificar) WHERE a_classificar;
