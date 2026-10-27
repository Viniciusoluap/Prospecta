ALTER TABLE bpo_lancamentos ADD COLUMN IF NOT EXISTS valor_recebido numeric(15,2) DEFAULT 0 NOT NULL;
CREATE TABLE IF NOT EXISTS bpo_recebimentos (
  id serial PRIMARY KEY,
  lancamento_id integer NOT NULL REFERENCES bpo_lancamentos(id) ON DELETE RESTRICT,
  request_key varchar(80) NOT NULL UNIQUE,
  valor numeric(15,2) NOT NULL CHECK (valor > 0),
  recebido_em timestamp NOT NULL,
  registrado_por_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  observacoes text,
  created_at timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS bpo_recebimentos_lancamento_idx ON bpo_recebimentos(lancamento_id);
