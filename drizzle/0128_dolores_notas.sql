-- 17/11/2026 — EPIC-025 (etapa 5, Notas de obra): leitura da nota que chega no grupo da obra, rascunho interno, confirmação
-- do empreiteiro (registrada como DADO) e vínculo com o lançamento do BPO aprovado pelo dono.
-- "obra_notas": uma linha por documento de grupo de OBRA lido como nota (prompt mestre, seção 6). É REGISTRO INTERNO da Dolores:
--   o rascunho do pagamento da obra (nunca um lançamento). Guarda só os dados lidos (texto pelo filtro do registro: dados
--   bancários nunca), as conferências do sistema, as dúvidas e os alertas — nunca o arquivo (só o SHA-256 e, depois da
--   aprovação do dono, o id do arquivo no Drive). O que foi lido não muda depois de gravado. Nunca é apagada.
--   Mudanças possíveis: a confirmação do empreiteiro (pendente → confirmada/correção), o vínculo com o BPO (vazio → um
--   lançamento, uma vez só, pela fila de aprovação), o arquivo no Drive (vazio → id, uma vez só) e os vínculos que o Postgres
--   esvazia sozinho (ON DELETE SET NULL de obra, usuário, lançamento do BPO e nota original): esses PODEM virar NULL, para
--   não barrar exclusões legítimas que o sistema já fazia (lição da etapa 4).
-- "obra_notas_respostas": cada resposta do empreiteiro no grupo reconhecida POR CÓDIGO como confirmação ou pedido de correção
--   de uma nota (indício, não assinatura). Só inserção (o usuário pode virar NULL pela exclusão dele).
-- "obra_notas_config": linha única (id = 1) — leitura de notas pela IA (DESLIGADA por padrão), prazo da confirmação e janela
--   de datas da conciliação. Os tetos diários, o orçamento próprio e a pausa por excesso são os MESMOS da classificação de
--   documentos da etapa 4 (dolores_grupos_config / dolores_grupos_contagem / dolores_grupos_consumo_mes): a leitura de nota
--   conta como um documento do grupo, uma chamada por vez, dentro do mesmo orçamento.
-- Somente aditiva e idempotente: tabelas, índices, funções e gatilhos novos (IF NOT EXISTS / OR REPLACE); a linha de
-- configuração entra com ON CONFLICT DO NOTHING. Nenhuma tabela existente é alterada.
-- Reversão: DROP TABLE "obra_notas_respostas", "obra_notas", "obra_notas_config";
-- DROP FUNCTION obra_notas_guarda(), obra_notas_respostas_guarda() (nada depende delas).

CREATE TABLE IF NOT EXISTS "obra_notas" (
  "id" serial PRIMARY KEY NOT NULL,
  "grupo_id" integer NOT NULL REFERENCES "dolores_grupos"("id") ON DELETE RESTRICT,
  "mensagem_id" integer NOT NULL REFERENCES "dolores_grupo_mensagens"("id") ON DELETE RESTRICT,
  "obra_id" integer REFERENCES "construction_projects"("id") ON DELETE SET NULL,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "arquivo_sha256" varchar(64) CHECK ("arquivo_sha256" IS NULL OR "arquivo_sha256" ~ '^[0-9a-f]{64}$'),
  "arquivo_mime" varchar(60),
  "arquivo_bytes" integer,
  "situacao" varchar(12) NOT NULL CHECK ("situacao" IN ('rascunho', 'confira', 'ilegivel', 'nao_lida', 'nao_e_nota')),
  "tipo" varchar(8) CHECK ("tipo" IS NULL OR "tipo" IN ('nfe', 'nfse', 'nfce', 'recibo', 'cupom', 'outro')),
  "emitente_nome" varchar(160),
  -- só dígitos, e só depois de conferir o dígito verificador (CPF 11, CNPJ 14)
  "emitente_documento" varchar(14) CHECK ("emitente_documento" IS NULL OR "emitente_documento" ~ '^([0-9]{11}|[0-9]{14})$'),
  "numero" varchar(30),
  "data_emissao" date,
  "valor_centavos" bigint CHECK ("valor_centavos" IS NULL OR ("valor_centavos" > 0 AND "valor_centavos" <= 100000000000)),
  "descricao" varchar(400),
  "itens" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "chave_acesso" varchar(44) CHECK ("chave_acesso" IS NULL OR "chave_acesso" ~ '^[0-9]{44}$'),
  "categoria" varchar(20) CHECK ("categoria" IS NULL OR "categoria" IN ('empreiteiro', 'fornecedor', 'material', 'mao_de_obra', 'outros')),
  "etapa" varchar(40),
  "empreiteiro_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "confianca" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "duvidas" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "alertas" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "duplicada_de" integer REFERENCES "obra_notas"("id") ON DELETE SET NULL,
  "modelo" varchar(120),
  "lida_em" timestamp with time zone,
  "confirmacao" varchar(10) NOT NULL DEFAULT 'pendente' CHECK ("confirmacao" IN ('pendente', 'confirmada', 'correcao')),
  "confirmacao_em" timestamp with time zone,
  "bpo_lancamento_id" integer REFERENCES "bpo_lancamentos"("id") ON DELETE SET NULL,
  "conciliada_em" timestamp with time zone,
  "conciliada_aprovacao_id" integer REFERENCES "dolores_aprovacoes"("id") ON DELETE RESTRICT,
  "drive_file_id" varchar(200),
  "salva_em" timestamp with time zone,
  "salva_aprovacao_id" integer REFERENCES "dolores_aprovacoes"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "obra_notas_mensagem_uidx" ON "obra_notas" ("mensagem_id");
CREATE INDEX IF NOT EXISTS "obra_notas_obra_idx" ON "obra_notas" ("obra_id", "criado_em");
CREATE INDEX IF NOT EXISTS "obra_notas_grupo_idx" ON "obra_notas" ("grupo_id", "criado_em");
CREATE INDEX IF NOT EXISTS "obra_notas_sha_idx" ON "obra_notas" ("arquivo_sha256") WHERE "arquivo_sha256" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "obra_notas_chave_idx" ON "obra_notas" ("chave_acesso") WHERE "chave_acesso" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "obra_notas_emitente_idx" ON "obra_notas" ("emitente_documento", "numero") WHERE "emitente_documento" IS NOT NULL;
-- um pagamento do BPO concilia com UMA nota só (a segunda é "provável duplicata")
CREATE UNIQUE INDEX IF NOT EXISTS "obra_notas_bpo_uidx" ON "obra_notas" ("bpo_lancamento_id") WHERE "bpo_lancamento_id" IS NOT NULL;

CREATE OR REPLACE FUNCTION obra_notas_guarda() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'OBRA_NOTAS_SEM_EXCLUSAO: nota de obra registrada não é apagada';
  END IF;
  -- o que foi lido não muda
  IF NEW."grupo_id" IS DISTINCT FROM OLD."grupo_id" OR NEW."mensagem_id" IS DISTINCT FROM OLD."mensagem_id"
     OR NEW."criado_em" IS DISTINCT FROM OLD."criado_em" OR NEW."arquivo_sha256" IS DISTINCT FROM OLD."arquivo_sha256"
     OR NEW."arquivo_mime" IS DISTINCT FROM OLD."arquivo_mime" OR NEW."arquivo_bytes" IS DISTINCT FROM OLD."arquivo_bytes"
     OR NEW."situacao" IS DISTINCT FROM OLD."situacao" OR NEW."tipo" IS DISTINCT FROM OLD."tipo"
     OR NEW."emitente_nome" IS DISTINCT FROM OLD."emitente_nome" OR NEW."emitente_documento" IS DISTINCT FROM OLD."emitente_documento"
     OR NEW."numero" IS DISTINCT FROM OLD."numero" OR NEW."data_emissao" IS DISTINCT FROM OLD."data_emissao"
     OR NEW."valor_centavos" IS DISTINCT FROM OLD."valor_centavos" OR NEW."descricao" IS DISTINCT FROM OLD."descricao"
     OR NEW."itens" IS DISTINCT FROM OLD."itens" OR NEW."chave_acesso" IS DISTINCT FROM OLD."chave_acesso"
     OR NEW."categoria" IS DISTINCT FROM OLD."categoria" OR NEW."etapa" IS DISTINCT FROM OLD."etapa"
     OR NEW."confianca" IS DISTINCT FROM OLD."confianca" OR NEW."duvidas" IS DISTINCT FROM OLD."duvidas"
     OR NEW."alertas" IS DISTINCT FROM OLD."alertas" OR NEW."modelo" IS DISTINCT FROM OLD."modelo"
     OR NEW."lida_em" IS DISTINCT FROM OLD."lida_em" THEN
    RAISE EXCEPTION 'OBRA_NOTAS_IMUTAVEL: o que foi lido da nota não muda';
  END IF;
  -- vínculos que o Postgres esvazia sozinho (ON DELETE SET NULL): só podem VIRAR NULL, nunca trocar de dono
  IF (NEW."obra_id" IS DISTINCT FROM OLD."obra_id" AND NEW."obra_id" IS NOT NULL)
     OR (NEW."empreiteiro_user_id" IS DISTINCT FROM OLD."empreiteiro_user_id" AND NEW."empreiteiro_user_id" IS NOT NULL)
     OR (NEW."duplicada_de" IS DISTINCT FROM OLD."duplicada_de" AND NEW."duplicada_de" IS NOT NULL) THEN
    RAISE EXCEPTION 'OBRA_NOTAS_VINCULO: obra, empreiteiro e nota original não são trocados';
  END IF;
  -- confirmação: pendente → confirmada/correção, uma vez, com a data; depois nada muda (nem o tipo nem a data)
  IF OLD."confirmacao" <> 'pendente' THEN
    IF NEW."confirmacao" IS DISTINCT FROM OLD."confirmacao" OR NEW."confirmacao_em" IS DISTINCT FROM OLD."confirmacao_em" THEN
      RAISE EXCEPTION 'OBRA_NOTAS_CONFIRMACAO: a resposta do empreiteiro registrada não é desfeita nem trocada';
    END IF;
  ELSIF NEW."confirmacao" = 'pendente' THEN
    IF NEW."confirmacao_em" IS DISTINCT FROM OLD."confirmacao_em" THEN
      RAISE EXCEPTION 'OBRA_NOTAS_CONFIRMACAO: sem resposta registrada, não há data de confirmação';
    END IF;
  ELSIF NEW."confirmacao_em" IS NULL THEN
    RAISE EXCEPTION 'OBRA_NOTAS_CONFIRMACAO: a resposta do empreiteiro é registrada com a data';
  END IF;
  -- conciliação: vazio → um lançamento, uma vez, SEMPRE com a aprovação do dono; depois o lançamento só pode virar NULL
  -- (exclusão do lançamento no BPO)
  IF OLD."conciliada_em" IS NULL THEN
    IF NEW."conciliada_em" IS NULL THEN
      IF NEW."bpo_lancamento_id" IS NOT NULL OR NEW."conciliada_aprovacao_id" IS NOT NULL THEN
        RAISE EXCEPTION 'OBRA_NOTAS_CONCILIADA: vínculo com o BPO só pela aprovação do dono';
      END IF;
    ELSIF NEW."bpo_lancamento_id" IS NULL OR NEW."conciliada_aprovacao_id" IS NULL THEN
      RAISE EXCEPTION 'OBRA_NOTAS_CONCILIADA: a conciliação grava o lançamento e a aprovação do dono juntos';
    END IF;
  ELSIF NEW."conciliada_em" IS DISTINCT FROM OLD."conciliada_em"
     OR NEW."conciliada_aprovacao_id" IS DISTINCT FROM OLD."conciliada_aprovacao_id"
     OR (NEW."bpo_lancamento_id" IS DISTINCT FROM OLD."bpo_lancamento_id" AND NEW."bpo_lancamento_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'OBRA_NOTAS_CONCILIADA: o vínculo com o BPO não é trocado';
  END IF;
  -- arquivo no Drive: vazio → id, uma vez, junto com a data e a aprovação do dono; depois nada muda
  IF OLD."drive_file_id" IS NULL THEN
    IF NEW."drive_file_id" IS NULL THEN
      IF NEW."salva_em" IS NOT NULL OR NEW."salva_aprovacao_id" IS NOT NULL THEN
        RAISE EXCEPTION 'OBRA_NOTAS_SALVA: sem o arquivo no Drive, a nota não é dada como salva';
      END IF;
    ELSIF NEW."salva_em" IS NULL OR NEW."salva_aprovacao_id" IS NULL THEN
      RAISE EXCEPTION 'OBRA_NOTAS_SALVA: o arquivo no Drive é gravado com a data e a aprovação do dono juntos';
    END IF;
  ELSIF NEW."drive_file_id" IS DISTINCT FROM OLD."drive_file_id"
     OR NEW."salva_em" IS DISTINCT FROM OLD."salva_em" OR NEW."salva_aprovacao_id" IS DISTINCT FROM OLD."salva_aprovacao_id" THEN
    RAISE EXCEPTION 'OBRA_NOTAS_SALVA: o arquivo da nota no Drive não é trocado';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS obra_notas_guarda ON "obra_notas";
CREATE TRIGGER obra_notas_guarda BEFORE UPDATE OR DELETE ON "obra_notas"
  FOR EACH ROW EXECUTE FUNCTION obra_notas_guarda();
DROP TRIGGER IF EXISTS obra_notas_sem_truncate ON "obra_notas";
CREATE TRIGGER obra_notas_sem_truncate BEFORE TRUNCATE ON "obra_notas"
  FOR EACH STATEMENT EXECUTE FUNCTION obra_notas_guarda();

CREATE TABLE IF NOT EXISTS "obra_notas_respostas" (
  "id" serial PRIMARY KEY NOT NULL,
  "nota_id" integer NOT NULL REFERENCES "obra_notas"("id") ON DELETE RESTRICT,
  "grupo_mensagem_id" integer NOT NULL REFERENCES "dolores_grupo_mensagens"("id") ON DELETE RESTRICT,
  "tipo" varchar(12) NOT NULL CHECK ("tipo" IN ('confirmacao', 'correcao')),
  -- como a resposta foi ligada à nota: citando a mensagem da nota ou escrevendo "NOTA <número do sistema>"
  "ligacao" varchar(12) NOT NULL CHECK ("ligacao" IN ('citacao', 'referencia')),
  -- quem respondeu: só mascarado
  "remetente" varchar(30),
  "empreiteiro_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  -- texto da resposta pelo filtro do registro
  "texto" varchar(500),
  "recebida_em" timestamp with time zone,
  "criado_em" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "obra_notas_respostas_msg_uidx" ON "obra_notas_respostas" ("grupo_mensagem_id");
CREATE INDEX IF NOT EXISTS "obra_notas_respostas_nota_idx" ON "obra_notas_respostas" ("nota_id", "criado_em");

CREATE OR REPLACE FUNCTION obra_notas_respostas_guarda() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'OBRA_NOTAS_RESPOSTAS_SOMENTE_INSERCAO: resposta registrada não é apagada';
  END IF;
  -- única mudança aceita: o usuário virar NULL (ON DELETE SET NULL da exclusão do usuário)
  IF NEW."nota_id" IS DISTINCT FROM OLD."nota_id" OR NEW."grupo_mensagem_id" IS DISTINCT FROM OLD."grupo_mensagem_id"
     OR NEW."tipo" IS DISTINCT FROM OLD."tipo" OR NEW."ligacao" IS DISTINCT FROM OLD."ligacao"
     OR NEW."remetente" IS DISTINCT FROM OLD."remetente" OR NEW."texto" IS DISTINCT FROM OLD."texto"
     OR NEW."recebida_em" IS DISTINCT FROM OLD."recebida_em" OR NEW."criado_em" IS DISTINCT FROM OLD."criado_em"
     OR (NEW."empreiteiro_user_id" IS DISTINCT FROM OLD."empreiteiro_user_id" AND NEW."empreiteiro_user_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'OBRA_NOTAS_RESPOSTAS_SOMENTE_INSERCAO: resposta registrada não muda';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS obra_notas_respostas_guarda ON "obra_notas_respostas";
CREATE TRIGGER obra_notas_respostas_guarda BEFORE UPDATE OR DELETE ON "obra_notas_respostas"
  FOR EACH ROW EXECUTE FUNCTION obra_notas_respostas_guarda();
DROP TRIGGER IF EXISTS obra_notas_respostas_sem_truncate ON "obra_notas_respostas";
CREATE TRIGGER obra_notas_respostas_sem_truncate BEFORE TRUNCATE ON "obra_notas_respostas"
  FOR EACH STATEMENT EXECUTE FUNCTION obra_notas_respostas_guarda();

CREATE TABLE IF NOT EXISTS "obra_notas_config" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "leitura_ligada" boolean NOT NULL DEFAULT false,
  "prazo_confirmacao_dias" integer NOT NULL DEFAULT 7 CHECK ("prazo_confirmacao_dias" BETWEEN 1 AND 60),
  "janela_conciliacao_dias" integer NOT NULL DEFAULT 30 CHECK ("janela_conciliacao_dias" BETWEEN 1 AND 120),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now(),
  "atualizado_por" integer REFERENCES "users"("id") ON DELETE SET NULL
);

INSERT INTO "obra_notas_config" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
