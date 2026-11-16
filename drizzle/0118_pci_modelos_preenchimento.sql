-- 16/11/2026 — EPIC-024 (S-09): biblioteca de modelos de preenchimento da PCI. Um modelo guarda SÓ os dados técnicos
-- de um projeto padrão (memorial, sistema construtivo, áreas da casa, custos, cronograma), já sem dados pessoais —
-- a lista de permissão fica em shared/pci-gerador.ts (CAMPOS_COPIAVEIS_MODELO_PCI). Salvar sobre um modelo cria nova
-- versão (version + 1, previous_id) e mantém a anterior, no mesmo padrão de incorporation_mass_studies.
-- Não confundir com pci_models (versões do modelo OFICIAL da CAIXA), que não muda.
-- Somente aditiva e idempotente: cria uma tabela nova (IF NOT EXISTS); nada existente é alterado ou apagado.
-- Portão de QA 2 (L6): coluna "substituido" + índice único parcial do nome da versão atual.
-- Reversão: DROP TABLE "pci_modelos_preenchimento" (nenhuma outra tabela depende dela).

CREATE TABLE IF NOT EXISTS "pci_modelos_preenchimento" (
  "id" serial PRIMARY KEY,
  "nome" varchar(120) NOT NULL,
  "versao" integer NOT NULL DEFAULT 1 CHECK ("versao" >= 1),
  "previous_id" integer REFERENCES "pci_modelos_preenchimento"("id") ON DELETE SET NULL,
  -- DadosModeloPreenchimentoPci: campos técnicos, custos, adicionais e cronograma (nunca CPF, nome ou endereço)
  "form_data" jsonb NOT NULL,
  "observacao" text,
  "source_project_id" integer REFERENCES "construction_projects"("id") ON DELETE SET NULL,
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp,
  "deleted_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  -- true = já tem versão mais nova (marcado na mesma instrução que grava a sucessora).
  "substituido" boolean NOT NULL DEFAULT false
);
-- Para quem já tinha criado a tabela com a versão anterior desta migração (nenhum ambiente, mas idempotente).
ALTER TABLE "pci_modelos_preenchimento" ADD COLUMN IF NOT EXISTS "substituido" boolean NOT NULL DEFAULT false;
UPDATE "pci_modelos_preenchimento" m SET "substituido" = true
  WHERE NOT m."substituido" AND EXISTS (SELECT 1 FROM "pci_modelos_preenchimento" n WHERE n."previous_id" = m."id");
-- Uma versão só tem uma sucessora (a lista mostra a última de cada modelo).
CREATE UNIQUE INDEX IF NOT EXISTS "pci_modelos_preenchimento_previous_uidx" ON "pci_modelos_preenchimento" ("previous_id") WHERE "previous_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "pci_modelos_preenchimento_nome_idx" ON "pci_modelos_preenchimento" (lower("nome"));
-- Nome único (sem diferença de maiúsculas) entre os modelos em uso: só a versão atual (não substituída) e não excluída.
-- O servidor já confere antes de gravar; o índice fecha a corrida de dois salvamentos ao mesmo tempo.
CREATE UNIQUE INDEX IF NOT EXISTS "pci_modelos_preenchimento_nome_atual_uidx" ON "pci_modelos_preenchimento" (lower("nome"))
  WHERE "deleted_at" IS NULL AND NOT "substituido";

ALTER TABLE "pci_modelos_preenchimento" ENABLE ROW LEVEL SECURITY;
