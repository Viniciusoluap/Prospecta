-- 22/11/2026 — EPIC-029 S-8: dados da EMPRESA (raiz do CNPJ: matriz + filiais) que o cálculo da alíquota do Simples precisa e
-- que o sistema não tem: a folha de salários dos 12 meses (Fator R, LC 123 art. 18 §5º-J e §24) e a data de início de
-- atividade (RBT12 proporcional, art. 18 §2º). Informados pelo admin em "Dados fiscais do perfil" (aba Contabilidade).
-- Story: docs/stories/epics/epic-029-modulo-fiscal/S-8-aliquota-simples.md.
--
-- Só ADITIVA: uma tabela nova; nenhuma coluna ou linha existente muda. Sem a linha (ou sem esta tabela), o sistema trata a
-- folha como "a informar" e o serviço do Fator R (cAtvSN 9) usa o Anexo V (o lado de pagar mais).
-- Idempotente (pode rodar duas vezes). Reversão (só com o dono): DROP TABLE "fiscal_dados_simples";

CREATE TABLE IF NOT EXISTS "fiscal_dados_simples" (
  -- Raiz do CNPJ (8 primeiros caracteres; aceita o CNPJ alfanumérico).
  "raiz" varchar(8) PRIMARY KEY CHECK ("raiz" ~ '^[0-9A-Z]{8}$'),
  -- Folha dos 12 meses (salários + pró-labore + FGTS + CPP, §24), em centavos, e o ÚLTIMO mês que ela inclui (AAAA-MM).
  -- Vale para a nota cuja competência é o mês seguinte a "folha_ate"; senão, fica desatualizada (Anexo V).
  "folha_12m_centavos" bigint CHECK ("folha_12m_centavos" IS NULL OR "folha_12m_centavos" >= 0),
  "folha_ate" varchar(7) CHECK ("folha_ate" IS NULL OR "folha_ate" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  "inicio_atividade" date,
  "atualizado_por" integer,
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "fiscal_dados_simples_folha_completa_chk" CHECK (("folha_12m_centavos" IS NULL) = ("folha_ate" IS NULL))
);
