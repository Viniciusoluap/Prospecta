-- Pedido de 12/11 (noite) — BPO: cadastro de centros de custo.
-- Aditiva e idempotente; só insere. bpo_lancamentos.centro_custos continua texto (um nome ou "A / B").
-- Nome único sem diferenciar maiúsculas nem acentos (índice por lower(translate(...)); sem depender de extensão).
-- Não aplicar em produção sem autorização.
CREATE TABLE IF NOT EXISTS bpo_centros_custo (
  id serial PRIMARY KEY,
  nome varchar(100) NOT NULL,
  ativo boolean DEFAULT true NOT NULL,
  created_at timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS bpo_centros_custo_nome_unico ON bpo_centros_custo (
  lower(translate(btrim(nome), 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'))
);--> statement-breakpoint
-- Semente: os nomes já usados nos lançamentos (os combinados "A / B" viram A e B).
INSERT INTO bpo_centros_custo (nome)
SELECT DISTINCT left(regexp_replace(btrim(parte), '\s+', ' ', 'g'), 100)
FROM bpo_lancamentos l, regexp_split_to_table(l.centro_custos, ' / ') AS parte
WHERE l.centro_custos IS NOT NULL AND btrim(parte) <> ''
ON CONFLICT DO NOTHING;
