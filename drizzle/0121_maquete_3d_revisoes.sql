-- 16/11/2026 — EPIC-024 (S-05): histórico das plantas da Maquete 3D e importação de planta arquitetônica na revisão.
-- Cada mudança do modelo (leitura, edição na revisão, troca de tipo, implantação do estudo, planta importada,
-- restauração) grava uma linha com o modelo inteiro, para poder conferir e restaurar. A importação em andamento
-- (leitura do PDF importado e a planta candidata) fica numa coluna nova, separada do modelo em uso.
-- O teto de pranchas lidas pela IA vale por maquete, somando leituras e importações: o contador fica numa coluna
-- própria, incrementada no mesmo UPDATE condicional que reserva a chamada paga (duas abas não chamam a IA duas vezes).
-- Somente aditiva e idempotente: uma tabela nova e duas colunas novas (IF NOT EXISTS); nada existente é alterado ou apagado.
-- Maquetes existentes começam com o contador em 0 (a leitura híbrida por prancha estreia com esta migração).
-- Reversão: DROP TABLE "maquete_3d_revisoes"; ALTER TABLE "maquetes_3d" DROP COLUMN "importacao", DROP COLUMN "ia_pranchas_lidas" (nada depende delas).

CREATE TABLE IF NOT EXISTS "maquete_3d_revisoes" (
  "id" serial PRIMARY KEY,
  "maquete_id" integer NOT NULL REFERENCES "maquetes_3d" ("id"),
  -- maquetes_3d.modelo_versao depois da mudança
  "versao" integer NOT NULL,
  -- ModeloMaquete em JSON
  "modelo" text NOT NULL,
  "origem" varchar(30) NOT NULL CHECK ("origem" IN ('anterior', 'leitura', 'edicao', 'tipo_padrao', 'implantacao_estudo', 'importacao_pdf', 'restauracao')),
  "motivo" varchar(400),
  -- DocumentoMaquete em JSON (PDF de origem, guardado em maquete_3d_arquivos ou no projeto/estudo)
  "documento" text,
  "autor_id" integer,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "maquete_3d_revisoes_versao_idx" ON "maquete_3d_revisoes" ("maquete_id", "versao");

-- Importação em andamento: { documento, estado da leitura, candidata, pranchas, avisos } em JSON; null sem importação.
ALTER TABLE "maquetes_3d" ADD COLUMN IF NOT EXISTS "importacao" text;

-- Chamadas pagas à IA já feitas nesta maquete (leituras + importações): contador do teto por maquete.
ALTER TABLE "maquetes_3d" ADD COLUMN IF NOT EXISTS "ia_pranchas_lidas" integer NOT NULL DEFAULT 0;
