-- 22/11/2026 — EPIC-029 S-5b (correções da revisão independente do PR #315, antes de LIGAR a captura do ADN).
-- Story: docs/stories/epics/epic-029-modulo-fiscal/S-5-producao-e-recebidas.md (seção "S-5b").
--
-- ORDEM: depende da 0163 (obra_notas.origem/chave_nfse/nsu e fiscal_distribuicao_estado). APLICAR ANTES de publicar o código
-- desta etapa: o esquema do sistema passa a ler as colunas novas de "obra_notas" (sem elas, a leitura das notas falha).
--
-- O que muda (só ACRESCENTA; nenhuma linha existente muda de valor — todas ficam com as colunas novas vazias/padrão):
--
-- 1. "obra_notas" — cancelamento e "mesma nota por outra origem":
--    - "cancelada_em" + "cancelamento_tipo": a NFS-e foi CANCELADA (evento do ADN: 101101 cancelamento, 105102 por
--      substituição, 105104 deferido em análise fiscal, 305101 de ofício — PESQUISA.md §1.5). Vazio → preenchido UMA vez,
--      os dois juntos; depois não muda nem volta. Nota cancelada não pode ser ligada a um pagamento do BPO (gatilho novo);
--      se já estava ligada, o vínculo NÃO é desfeito aqui (nada existente é alterado): o dono recebe o aviso e decide.
--    - "outra_origem_de": a MESMA nota já registrada pela OUTRA origem (ADN × grupo da obra, mesmo emitente e número). Não é
--      "duplicada" (a nota de grupo pode ter o arquivo salvo no Drive), mas só UMA é conciliada: a primeira, ou a oficial do
--      ADN quando valor/data divergem (a de grupo ainda não conciliada passa a apontar para ela — único preenchimento depois
--      de gravada; ver o gatilho). Nunca junto com "duplicada_de"; fora isso, só pode VIRAR NULL.
-- 2. "obra_notas_eventos_adn" (NOVA): eventos de cancelamento lidos na distribuição do ADN (chave da NFS-e, tipo, NSU, XML e
--    SHA-256). Se a nota ainda não chegou, o evento fica guardado e é casado quando ela chegar. Só inserção; o único campo
--    que muda é o vínculo com a nota (vazio → nota, uma vez, com a data). Nunca é apagado.
-- 3. "fiscal_distribuicao_estado":
--    - "nsu_com_falha" + "tentativas_nsu_com_falha": o NSU cuja gravação deu exceção e quantas vezes; na 3ª, o documento
--      vai para os ilegíveis e a captura segue (antes travava o CNPJ para sempre);
--    - "nsus_a_conferir": NSUs de eventos de tipo que o sistema não sabe ler (os 20 mais recentes), para o dono conferir —
--      antes eram descartados em silêncio.
--
-- Somente ADITIVA e IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, CHECKs nomeados criados só se não existirem, CREATE ... IF NOT
-- EXISTS, CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE TRIGGER. Nenhum dado existente é alterado ou apagado.
-- Reversão (só se nenhuma nota tiver sido cancelada/ligada por aqui): DROP TABLE "obra_notas_eventos_adn"; DROP TRIGGER
--   obra_notas_guarda_cancelamento ON obra_notas; DROP FUNCTION obra_notas_guarda_cancelamento(), obra_notas_eventos_adn_guarda();
--   DROP das constraints "obra_notas_cancelamento_ck"/"obra_notas_outra_origem_ck" e das colunas novas.

-- 1. obra_notas
ALTER TABLE "obra_notas" ADD COLUMN IF NOT EXISTS "cancelada_em" timestamp with time zone;
ALTER TABLE "obra_notas" ADD COLUMN IF NOT EXISTS "cancelamento_tipo" varchar(6);
ALTER TABLE "obra_notas" ADD COLUMN IF NOT EXISTS "outra_origem_de" integer REFERENCES "obra_notas"("id") ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"obra_notas"'::regclass AND conname = 'obra_notas_cancelamento_ck') THEN
    ALTER TABLE "obra_notas" ADD CONSTRAINT "obra_notas_cancelamento_ck"
      CHECK (("cancelada_em" IS NULL) = ("cancelamento_tipo" IS NULL) AND ("cancelamento_tipo" IS NULL OR "cancelamento_tipo" ~ '^[0-9]{6}$'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"obra_notas"'::regclass AND conname = 'obra_notas_outra_origem_ck') THEN
    ALTER TABLE "obra_notas" ADD CONSTRAINT "obra_notas_outra_origem_ck" CHECK ("outra_origem_de" IS NULL OR "duplicada_de" IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "obra_notas_outra_origem_idx" ON "obra_notas" ("outra_origem_de") WHERE "outra_origem_de" IS NOT NULL;

-- guarda NOVA (as da 0128 e da 0163 continuam exatamente como estão, ao lado desta)
CREATE OR REPLACE FUNCTION obra_notas_guarda_cancelamento() RETURNS trigger AS $$
BEGIN
  IF OLD."cancelada_em" IS NOT NULL AND (NEW."cancelada_em" IS DISTINCT FROM OLD."cancelada_em"
     OR NEW."cancelamento_tipo" IS DISTINCT FROM OLD."cancelamento_tipo") THEN
    RAISE EXCEPTION 'OBRA_NOTAS_CANCELADA: o cancelamento registrado da nota não muda nem é desfeito';
  END IF;
  -- outra_origem_de só pode VIRAR NULL, com UMA exceção (portão de QA da S-5b): a nota de GRUPO ainda sem vínculo, não
  -- conciliada e não duplicada passa a apontar para a NFS-e OFICIAL do ADN que chegou depois com valor/data diferentes (a
  -- conciliação passa para a oficial). Nunca de grupo para grupo, nunca para outra nota de grupo, nunca trocada depois.
  IF NEW."outra_origem_de" IS DISTINCT FROM OLD."outra_origem_de" AND NEW."outra_origem_de" IS NOT NULL THEN
    IF NOT (OLD."outra_origem_de" IS NULL AND NEW."origem" = 'grupo' AND NEW."duplicada_de" IS NULL
            AND OLD."bpo_lancamento_id" IS NULL AND NEW."bpo_lancamento_id" IS NULL
            AND EXISTS (SELECT 1 FROM "obra_notas" o WHERE o."id" = NEW."outra_origem_de" AND o."origem" = 'adn'
                        AND o."outra_origem_de" IS NULL AND o."duplicada_de" IS NULL)) THEN
      RAISE EXCEPTION 'OBRA_NOTAS_VINCULO: a nota da outra origem não é trocada';
    END IF;
  END IF;
  IF NEW."cancelada_em" IS NOT NULL AND NEW."bpo_lancamento_id" IS NOT NULL
     AND NEW."bpo_lancamento_id" IS DISTINCT FROM OLD."bpo_lancamento_id" THEN
    RAISE EXCEPTION 'OBRA_NOTAS_CANCELADA: nota cancelada não é ligada a pagamento do BPO';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS obra_notas_guarda_cancelamento ON "obra_notas";
CREATE TRIGGER obra_notas_guarda_cancelamento BEFORE UPDATE ON "obra_notas"
  FOR EACH ROW EXECUTE FUNCTION obra_notas_guarda_cancelamento();

-- 2. Eventos de cancelamento do ADN (com ou sem a nota já registrada)
CREATE TABLE IF NOT EXISTS "obra_notas_eventos_adn" (
  "id" serial PRIMARY KEY NOT NULL,
  "chave_nfse" varchar(50) NOT NULL CHECK ("chave_nfse" ~ '^[0-9]{6}[0-9A-Z]{14}[0-9]{30}$'),
  "tipo_evento" varchar(6) NOT NULL CHECK ("tipo_evento" ~ '^[0-9]{6}$'),
  "nsu" bigint NOT NULL CHECK ("nsu" > 0),
  -- a empresa do grupo cuja distribuição trouxe o evento
  "tomador_cnpj" varchar(14) NOT NULL CHECK ("tomador_cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  "xml" text NOT NULL CHECK (length("xml") BETWEEN 1 AND 300000),
  "xml_sha256" varchar(64) NOT NULL CHECK ("xml_sha256" ~ '^[0-9a-f]{64}$'),
  "recebido_em" timestamp with time zone NOT NULL DEFAULT now(),
  "nota_id" integer REFERENCES "obra_notas"("id") ON DELETE RESTRICT,
  "casado_em" timestamp with time zone,
  CONSTRAINT "obra_notas_eventos_adn_casado_ck" CHECK (("nota_id" IS NULL) = ("casado_em" IS NULL))
);
-- o mesmo evento (chave + tipo) entra uma vez só, mesmo relido ou distribuído a dois CNPJs do grupo
CREATE UNIQUE INDEX IF NOT EXISTS "obra_notas_eventos_adn_uidx" ON "obra_notas_eventos_adn" ("chave_nfse", "tipo_evento");
CREATE INDEX IF NOT EXISTS "obra_notas_eventos_adn_pendente_idx" ON "obra_notas_eventos_adn" ("chave_nfse") WHERE "nota_id" IS NULL;

CREATE OR REPLACE FUNCTION obra_notas_eventos_adn_guarda() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'OBRA_NOTAS_EVENTOS_SEM_EXCLUSAO: o evento do ADN não é apagado';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."chave_nfse" IS DISTINCT FROM OLD."chave_nfse" OR NEW."tipo_evento" IS DISTINCT FROM OLD."tipo_evento"
     OR NEW."nsu" IS DISTINCT FROM OLD."nsu" OR NEW."tomador_cnpj" IS DISTINCT FROM OLD."tomador_cnpj" OR NEW."xml" IS DISTINCT FROM OLD."xml"
     OR NEW."xml_sha256" IS DISTINCT FROM OLD."xml_sha256" OR NEW."recebido_em" IS DISTINCT FROM OLD."recebido_em" THEN
    RAISE EXCEPTION 'OBRA_NOTAS_EVENTOS_IMUTAVEL: o evento lido do ADN não muda';
  END IF;
  IF OLD."nota_id" IS NOT NULL AND (NEW."nota_id" IS DISTINCT FROM OLD."nota_id" OR NEW."casado_em" IS DISTINCT FROM OLD."casado_em") THEN
    RAISE EXCEPTION 'OBRA_NOTAS_EVENTOS_CASADO: o evento já casado com a nota não é trocado';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS obra_notas_eventos_adn_guarda ON "obra_notas_eventos_adn";
CREATE TRIGGER obra_notas_eventos_adn_guarda BEFORE UPDATE OR DELETE ON "obra_notas_eventos_adn"
  FOR EACH ROW EXECUTE FUNCTION obra_notas_eventos_adn_guarda();
DROP TRIGGER IF EXISTS obra_notas_eventos_adn_sem_truncate ON "obra_notas_eventos_adn";
CREATE TRIGGER obra_notas_eventos_adn_sem_truncate BEFORE TRUNCATE ON "obra_notas_eventos_adn"
  FOR EACH STATEMENT EXECUTE FUNCTION obra_notas_eventos_adn_guarda();

-- 3. fiscal_distribuicao_estado (o gatilho da 0163 continua valendo: sem exclusão, CNPJ fixo, NSU não volta)
ALTER TABLE "fiscal_distribuicao_estado" ADD COLUMN IF NOT EXISTS "nsu_com_falha" bigint CHECK ("nsu_com_falha" IS NULL OR "nsu_com_falha" > 0);
ALTER TABLE "fiscal_distribuicao_estado" ADD COLUMN IF NOT EXISTS "tentativas_nsu_com_falha" integer NOT NULL DEFAULT 0
  CHECK ("tentativas_nsu_com_falha" BETWEEN 0 AND 10);
ALTER TABLE "fiscal_distribuicao_estado" ADD COLUMN IF NOT EXISTS "nsus_a_conferir" jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof("nsus_a_conferir") = 'array' AND jsonb_array_length("nsus_a_conferir") <= 20);
