-- 21/11/2026 — EPIC-027 C5, etapa E5 ("gasto da Dolores separado por função"). Decisão do dono: "Dolores: cada função com seu
-- gasto", para uma função não consumir o crédito das outras. Divisão do limite mensal: conversa com o dono 55% · documentos
-- (classificação de documentos e notas de obra) 20% · grupos (resposta quando marcada) 10% · clientes (atendimento a cliente
-- cadastrado) 10% · avisos (proatividade/relatórios) 5%. Aprovado em 21/11: alerta ao dono em 80% (total e por função) e o aviso
-- de modo sem IA em 100%. Story: docs/stories/epics/epic-027-correcoes-20-11-noite/C5-E5-gasto-por-funcao.md.
--
-- "dolores_consumo.funcao": a função de cada chamada à IA, gravada a partir de agora. Linhas ANTIGAS ficam com NULL (nenhum dado
--   existente é alterado): a leitura usa COALESCE(funcao, regra antiga) — mensagem do dono = conversa, parada "grupo…" = grupos,
--   "cliente…" = clientes, o resto = documentos e notas (server/dolores/consumo.ts#funcaoSql).
-- "dolores_gasto_partes": linha única (id = 1) com a parte de cada função, em % inteiros. Padrão = a divisão do dono; soma
--   exatamente 100 e cada uma de 1 a 96 (CHECK no banco, além da validação do servidor). Só o administrador muda, pela tela.
-- "dolores_gasto_alertas": um registro por (mês, alvo, nível) — o alerta ao dono sai UMA vez por mês por limite. A chave
--   primária faz a idempotência sob concorrência (INSERT … ON CONFLICT DO NOTHING: só quem inseriu envia). Sem texto, sem
--   número, sem dado pessoal: só o mês, o alvo ("total" ou a função), o nível (80/100) e quando.
--
-- Somente ADITIVA e IDEMPOTENTE (ADD COLUMN / CREATE … IF NOT EXISTS; restrições criadas só se ainda não existem; linha de
-- configuração com ON CONFLICT DO NOTHING). Nenhuma linha existente é alterada ou apagada.
-- Reversão: DROP TABLE "dolores_gasto_alertas", "dolores_gasto_partes"; ALTER TABLE "dolores_consumo" DROP COLUMN "funcao"
-- (sem elas, o código usa a divisão padrão e não envia alertas).

ALTER TABLE "dolores_consumo" ADD COLUMN IF NOT EXISTS "funcao" varchar(24);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dolores_consumo_funcao_check') THEN
    ALTER TABLE "dolores_consumo" ADD CONSTRAINT "dolores_consumo_funcao_check"
      CHECK ("funcao" IS NULL OR "funcao" IN ('conversa', 'documentos_e_notas', 'grupos', 'clientes', 'avisos'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "dolores_consumo_mes_funcao_idx" ON "dolores_consumo" ("mes", "funcao");

CREATE TABLE IF NOT EXISTS "dolores_gasto_partes" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "conversa_pct" smallint NOT NULL DEFAULT 55 CHECK ("conversa_pct" BETWEEN 1 AND 96),
  "documentos_pct" smallint NOT NULL DEFAULT 20 CHECK ("documentos_pct" BETWEEN 1 AND 96),
  "grupos_pct" smallint NOT NULL DEFAULT 10 CHECK ("grupos_pct" BETWEEN 1 AND 96),
  "clientes_pct" smallint NOT NULL DEFAULT 10 CHECK ("clientes_pct" BETWEEN 1 AND 96),
  "avisos_pct" smallint NOT NULL DEFAULT 5 CHECK ("avisos_pct" BETWEEN 1 AND 96),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "dolores_gasto_partes_soma_check" CHECK ("conversa_pct" + "documentos_pct" + "grupos_pct" + "clientes_pct" + "avisos_pct" = 100)
);

INSERT INTO "dolores_gasto_partes" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "dolores_gasto_alertas" (
  -- mês de Imperatriz (AAAA-MM), o mesmo do limite mensal
  "mes" varchar(7) NOT NULL,
  "alvo" varchar(24) NOT NULL CHECK ("alvo" IN ('total', 'conversa', 'documentos_e_notas', 'grupos', 'clientes', 'avisos')),
  "nivel" smallint NOT NULL CHECK ("nivel" IN (80, 100)),
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  -- preenchido quando o envio ao dono saiu; NULL = reservado (envio em andamento) ou saiu junto com o de 100%
  "enviado_em" timestamp with time zone,
  PRIMARY KEY ("mes", "alvo", "nivel")
);
