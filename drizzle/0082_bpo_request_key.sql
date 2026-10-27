-- Chave por submissão: repetir uma requisição não cria outra cobrança/parcela.
ALTER TABLE bpo_lancamentos ADD COLUMN IF NOT EXISTS request_key varchar(80);
CREATE UNIQUE INDEX IF NOT EXISTS bpo_lancamentos_request_key_unique ON bpo_lancamentos(request_key);
