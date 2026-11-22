-- 21/11/2026 — EPIC-027 C5, etapa "memória de longo prazo" da Dolores (decisão do dono de 21/11: "memória de longo prazo dentro
-- do sistema — fatos e preferências permanentes, com tela para ver, corrigir e apagar"; sem ferramenta externa).
-- Story: docs/stories/epics/epic-027-correcoes-20-11-noite/C5-MLP-memoria-longo-prazo.md.
--
-- "dolores_memoria_longa": as coisas que o DONO pediu para a Dolores lembrar (preferência dele, fato do negócio, regra de trabalho,
--   pessoa). Uma linha por fato, texto curto (até 300 caracteres), já sem senha/token/chave/código de acesso/dado bancário (o sistema
--   recusa) e com CPF, telefone e e-mail MASCARADOS (o texto é reenviado à IA em toda conversa do dono).
--   - "origem": 'conversa' (o dono pediu no WhatsApp e respondeu "pode" à proposta) ou 'tela' (o administrador cadastrou);
--   - "situacao": 'ativa' (entra no contexto da conversa do dono) ou 'arquivada' ("apagar" na tela e "esquece que…" na conversa
--     ARQUIVAM: o registro fica, com quem e quando, e pode ser restaurado — regra do projeto de não excluir registro);
--   - vínculo opcional a UM cliente do CRM (lead_id) OU a UMA obra (obra_id).
--   Nunca vai a grupo nem a cliente: só a conversa direta do número do dono a usa. Toda criação/edição/arquivamento é auditada em
--   dolores_acoes (só ids e categoria; sem o texto).
--
-- Somente ADITIVA e IDEMPOTENTE (CREATE ... IF NOT EXISTS). Nenhuma tabela anterior muda; nenhum dado existente é alterado.
-- Reversão: DROP TABLE "dolores_memoria_longa" (sem ela, a Dolores volta a conversar só com a memória curta da 0143).

CREATE TABLE IF NOT EXISTS "dolores_memoria_longa" (
  "id" serial PRIMARY KEY,
  "texto" varchar(300) NOT NULL CHECK (char_length(btrim("texto")) BETWEEN 3 AND 300),
  "categoria" varchar(20) NOT NULL CHECK ("categoria" IN ('preferencia_dono', 'fato_negocio', 'regra_trabalho', 'pessoa')),
  "lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL,
  "obra_id" integer REFERENCES "construction_projects"("id") ON DELETE SET NULL,
  "origem" varchar(10) NOT NULL CHECK ("origem" IN ('conversa', 'tela')),
  "situacao" varchar(10) NOT NULL DEFAULT 'ativa' CHECK ("situacao" IN ('ativa', 'arquivada')),
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "autor_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "arquivado_em" timestamp with time zone,
  "mensagem_id" integer REFERENCES "dolores_mensagens"("id") ON DELETE SET NULL,
  CONSTRAINT "dolores_memoria_longa_um_vinculo" CHECK ("lead_id" IS NULL OR "obra_id" IS NULL)
);

CREATE INDEX IF NOT EXISTS "dolores_memoria_longa_situacao_idx" ON "dolores_memoria_longa" ("situacao", "atualizado_em");
