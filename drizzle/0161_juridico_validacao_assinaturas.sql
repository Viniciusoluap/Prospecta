-- 22/11/2026 — Jurídico: relatório da conferência automática das assinaturas digitais, por documento do contrato.
-- Frente: HANDOFF-22-11-JURIDICO-VALIDACAO-AUTOMATICA.md. Código: server/juridico-validacao.ts e server/juridico-revalidacao.ts.
--
-- Número 0161: o maior número na origin/main em 22/11 é 0160; a faixa 0154–0159 pode estar em uso pela frente fiscal.
--
-- Um relatório por documento (PDF já salvo em portal_contract_documents): estado (valida/pendente/invalida), origem,
-- SHA-256 dos bytes conferidos, o relatório completo (JSON, só dados públicos do certificado: titular, CPF/CNPJ do nome,
-- emissor e serial), horário e controle da retentativa automática das pendências de rede.
-- `execucao` guarda o token da última rodada que gravou: duas rodadas simultâneas não se sobrescrevem.
--
-- Somente ADITIVA e IDEMPOTENTE (CREATE ... IF NOT EXISTS). Nenhuma tabela ou dado existente é alterado. Sem esta
-- migração, o sistema confere e mostra o resultado na hora, mas não grava o relatório (e não há retentativa).
-- Reversão: DROP TABLE "portal_contract_document_validacoes";

CREATE TABLE IF NOT EXISTS "portal_contract_document_validacoes" (
  "document_id" integer PRIMARY KEY REFERENCES "portal_contract_documents"("id") ON DELETE CASCADE,
  "estado" varchar(20) NOT NULL CHECK ("estado" IN ('valida', 'pendente', 'invalida')),
  "origem" varchar(30) NOT NULL CHECK ("origem" IN ('assinatura_empresa', 'retorno_portal', 'retorno_admin')),
  "sha256" char(64) NOT NULL CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  "relatorio" jsonb NOT NULL,
  "verificado_em" timestamp with time zone NOT NULL,
  "tentativas" integer NOT NULL DEFAULT 0 CHECK ("tentativas" >= 0),
  "proxima_tentativa" timestamp with time zone,
  "primeira_em" timestamp with time zone NOT NULL DEFAULT now(),
  "execucao" varchar(64),
  "versao" integer NOT NULL DEFAULT 1,
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "portal_contract_document_validacoes_pendentes_idx"
  ON "portal_contract_document_validacoes" ("proxima_tentativa")
  WHERE "estado" = 'pendente' AND "proxima_tentativa" IS NOT NULL;
