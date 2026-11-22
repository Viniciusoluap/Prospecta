-- 22/11/2026 — EPIC-029 S-5 (parte que não depende do dono): NFS-e RECEBIDAS (de empreiteiros e fornecedores), capturadas
-- pela distribuição do Ambiente de Dados Nacional (ADN), entram como ORIGEM NOVA dentro das notas de obra da Dolores
-- ("obra_notas", 0128) — sem tabela paralela de notas (decisão g do EPIC-029).
-- Story: docs/stories/epics/epic-029-modulo-fiscal/S-5-producao-e-recebidas.md.
--
-- O que muda em "obra_notas" (só ACRESCENTA; nenhuma linha existente muda de valor):
--   - "origem": 'grupo' (a nota lida no grupo da obra, como sempre; é o padrão, então TODAS as linhas existentes ficam
--     'grupo') ou 'adn' (a NFS-e recebida pelo ADN);
--   - "chave_nfse": chave de acesso da NFS-e, 50 posições no padrão do XSD oficial `[0-9]{6}[0-9A-Z]{14}[0-9]{30}` (as 14
--     posições da inscrição federal podem ter LETRAS por causa do CNPJ alfanumérico — PESQUISA.md §1.4); a "chave_acesso"
--     antiga continua só para os 44 dígitos da NF-e, sem mudança nenhuma; única entre as notas (idempotência da captura);
--   - "nsu": número sequencial do documento na distribuição do ADN;
--   - "emitente_cnpj_alfa": CNPJ ALFANUMÉRICO do emitente (IN RFB 2.229/2024). O "emitente_documento" antigo continua SÓ
--     com números (CHECK da 0128 intacto): CNPJ numérico e CPF vão para ele; o alfanumérico (com letra) vai para esta
--     coluna; nunca os dois na mesma nota.
--
-- A ÚNICA troca de regra existente (inevitável: a nota do ADN não tem grupo nem mensagem do WhatsApp):
--   "grupo_id" e "mensagem_id" deixam de ser NOT NULL na coluna, MAS a mesma exigência passa a valer por CHECK para a
--   origem antiga: origem 'grupo' continua OBRIGADA a ter grupo e mensagem ("obra_notas_grupo_exige_mensagem_ck"). O CHECK
--   é criado ANTES de tirar o NOT NULL, então em nenhum momento uma nota de grupo pode ficar sem grupo ou sem mensagem.
--   A nota 'adn' é o contrário: sem grupo, sem mensagem, sem arquivo do WhatsApp, tipo 'nfse', com chave de 50 e NSU.
--
-- Guardas (gatilhos), sem tocar na guarda da 0128 ("obra_notas_guarda" continua igual):
--   - "obra_notas_guarda_origem": gatilho NOVO, ao lado do antigo — origem, chave_nfse, nsu e emitente_cnpj_alfa nunca
--     mudam depois de gravados (mesma regra "o que foi lido não muda").
--   - "obra_notas_adn": tabela-filha (uma linha por nota 'adn') com o XML original, o SHA-256 dele e o CNPJ do tomador
--     (a empresa do grupo que recebeu a nota). Só inserção; nunca muda nem é apagada; só aceita nota de origem 'adn'.
--     Fica fora de "obra_notas" para as leituras da Dolores e da tela não carregarem o XML.
--   - "fiscal_distribuicao_estado": um registro por CNPJ do grupo (tomador): interruptor DESLIGADO por padrão, último NSU
--     lido (nunca volta para trás), quando foi a última consulta e o resultado, e quando foi a última consulta SEM documento
--     novo (o ADN exige esperar no mínimo 1 hora depois dela — PESQUISA.md §1.3). Sem linha (ou desligado) = nada é consultado.
--
-- Somente ADITIVA e IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, CHECKs nomeados criados só se não existirem, DROP NOT NULL
-- (repetir não faz nada), CREATE ... IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS + CREATE TRIGGER.
-- Nenhum dado existente é alterado ou apagado.
-- Reversão (só se nenhuma nota 'adn' tiver sido gravada): DROP TABLE "obra_notas_adn", "fiscal_distribuicao_estado";
--   DROP TRIGGER obra_notas_guarda_origem ON obra_notas; DROP FUNCTION obra_notas_guarda_origem(), obra_notas_adn_guarda(),
--   fiscal_distribuicao_estado_guarda(); ALTER TABLE obra_notas ALTER COLUMN grupo_id SET NOT NULL, ALTER COLUMN mensagem_id
--   SET NOT NULL; DROP das constraints "obra_notas_*_ck" desta migração e das 4 colunas novas.

-- 1. Colunas novas (todas as linhas existentes ficam com origem = 'grupo' e o resto NULL)
ALTER TABLE "obra_notas" ADD COLUMN IF NOT EXISTS "origem" varchar(10) NOT NULL DEFAULT 'grupo';
ALTER TABLE "obra_notas" ADD COLUMN IF NOT EXISTS "chave_nfse" varchar(50);
ALTER TABLE "obra_notas" ADD COLUMN IF NOT EXISTS "nsu" bigint;
ALTER TABLE "obra_notas" ADD COLUMN IF NOT EXISTS "emitente_cnpj_alfa" varchar(14);

-- 2. Regras novas, por CHECK nomeado (criado uma vez só). A regra antiga de grupo/mensagem entra AQUI, antes do passo 3.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"obra_notas"'::regclass AND conname = 'obra_notas_origem_ck') THEN
    ALTER TABLE "obra_notas" ADD CONSTRAINT "obra_notas_origem_ck" CHECK ("origem" IN ('grupo', 'adn'));
  END IF;
  -- a origem antiga continua exigindo grupo e mensagem (o que o NOT NULL garantia)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"obra_notas"'::regclass AND conname = 'obra_notas_grupo_exige_mensagem_ck') THEN
    ALTER TABLE "obra_notas" ADD CONSTRAINT "obra_notas_grupo_exige_mensagem_ck"
      CHECK ("origem" <> 'grupo' OR ("grupo_id" IS NOT NULL AND "mensagem_id" IS NOT NULL));
  END IF;
  -- a nota do ADN: sem grupo, sem mensagem, sem arquivo do WhatsApp, sempre NFS-e, com chave de 50 e NSU
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"obra_notas"'::regclass AND conname = 'obra_notas_adn_ck') THEN
    ALTER TABLE "obra_notas" ADD CONSTRAINT "obra_notas_adn_ck"
      CHECK ("origem" <> 'adn' OR ("grupo_id" IS NULL AND "mensagem_id" IS NULL AND "arquivo_sha256" IS NULL
        AND "tipo" = 'nfse' AND "chave_nfse" IS NOT NULL AND "nsu" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"obra_notas"'::regclass AND conname = 'obra_notas_chave_nfse_ck') THEN
    ALTER TABLE "obra_notas" ADD CONSTRAINT "obra_notas_chave_nfse_ck" CHECK ("chave_nfse" IS NULL OR "chave_nfse" ~ '^[0-9]{6}[0-9A-Z]{14}[0-9]{30}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"obra_notas"'::regclass AND conname = 'obra_notas_nsu_ck') THEN
    ALTER TABLE "obra_notas" ADD CONSTRAINT "obra_notas_nsu_ck" CHECK ("nsu" IS NULL OR "nsu" > 0);
  END IF;
  -- só o CNPJ que TEM letra (o numérico continua em emitente_documento); o dígito verificador é conferido pelo sistema
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"obra_notas"'::regclass AND conname = 'obra_notas_cnpj_alfa_ck') THEN
    ALTER TABLE "obra_notas" ADD CONSTRAINT "obra_notas_cnpj_alfa_ck"
      CHECK ("emitente_cnpj_alfa" IS NULL OR ("emitente_cnpj_alfa" ~ '^[0-9A-Z]{12}[0-9]{2}$' AND "emitente_cnpj_alfa" ~ '[A-Z]'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"obra_notas"'::regclass AND conname = 'obra_notas_um_documento_ck') THEN
    ALTER TABLE "obra_notas" ADD CONSTRAINT "obra_notas_um_documento_ck" CHECK ("emitente_documento" IS NULL OR "emitente_cnpj_alfa" IS NULL);
  END IF;
END $$;

-- 3. Só agora (com a regra do passo 2 valendo para a origem 'grupo') o NOT NULL da coluna sai.
ALTER TABLE "obra_notas" ALTER COLUMN "grupo_id" DROP NOT NULL;
ALTER TABLE "obra_notas" ALTER COLUMN "mensagem_id" DROP NOT NULL;

-- 4. Idempotência da captura: a mesma NFS-e (chave de 50) entra uma vez só.
CREATE UNIQUE INDEX IF NOT EXISTS "obra_notas_chave_nfse_uidx" ON "obra_notas" ("chave_nfse") WHERE "chave_nfse" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "obra_notas_cnpj_alfa_idx" ON "obra_notas" ("emitente_cnpj_alfa", "numero") WHERE "emitente_cnpj_alfa" IS NOT NULL;

-- 5. Guarda NOVA das colunas novas (a "obra_notas_guarda" da 0128 continua exatamente como está, ao lado desta).
CREATE OR REPLACE FUNCTION obra_notas_guarda_origem() RETURNS trigger AS $$
BEGIN
  IF NEW."origem" IS DISTINCT FROM OLD."origem" OR NEW."chave_nfse" IS DISTINCT FROM OLD."chave_nfse"
     OR NEW."nsu" IS DISTINCT FROM OLD."nsu" OR NEW."emitente_cnpj_alfa" IS DISTINCT FROM OLD."emitente_cnpj_alfa" THEN
    RAISE EXCEPTION 'OBRA_NOTAS_IMUTAVEL: a origem, a chave da NFS-e, o NSU e o CNPJ do emitente não mudam';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS obra_notas_guarda_origem ON "obra_notas";
CREATE TRIGGER obra_notas_guarda_origem BEFORE UPDATE ON "obra_notas"
  FOR EACH ROW EXECUTE FUNCTION obra_notas_guarda_origem();

-- 6. XML original da NFS-e recebida (tabela-filha, só inserção).
CREATE TABLE IF NOT EXISTS "obra_notas_adn" (
  "nota_id" integer PRIMARY KEY NOT NULL REFERENCES "obra_notas"("id") ON DELETE RESTRICT,
  -- a empresa do grupo que é a TOMADORA da nota (o CNPJ cuja distribuição trouxe o documento)
  "tomador_cnpj" varchar(14) NOT NULL CHECK ("tomador_cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  "xml" text NOT NULL CHECK (length("xml") BETWEEN 1 AND 300000),
  "xml_sha256" varchar(64) NOT NULL CHECK ("xml_sha256" ~ '^[0-9a-f]{64}$'),
  "capturada_em" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION obra_notas_adn_guarda() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM "obra_notas" WHERE "id" = NEW."nota_id" AND "origem" = 'adn') THEN
      RAISE EXCEPTION 'OBRA_NOTAS_ADN_ORIGEM: o XML do ADN só acompanha nota de origem adn';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'OBRA_NOTAS_ADN_SOMENTE_INSERCAO: o XML da nota recebida não muda nem é apagado';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS obra_notas_adn_guarda ON "obra_notas_adn";
CREATE TRIGGER obra_notas_adn_guarda BEFORE INSERT OR UPDATE OR DELETE ON "obra_notas_adn"
  FOR EACH ROW EXECUTE FUNCTION obra_notas_adn_guarda();
DROP TRIGGER IF EXISTS obra_notas_adn_sem_truncate ON "obra_notas_adn";
CREATE TRIGGER obra_notas_adn_sem_truncate BEFORE TRUNCATE ON "obra_notas_adn"
  FOR EACH STATEMENT EXECUTE FUNCTION obra_notas_adn_guarda();

-- 7. Estado da captura por CNPJ tomador (sem linha, ou desligada = nada é consultado).
CREATE TABLE IF NOT EXISTS "fiscal_distribuicao_estado" (
  "cnpj" varchar(14) PRIMARY KEY NOT NULL CHECK ("cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  "ligada" boolean NOT NULL DEFAULT false,
  "ultimo_nsu" bigint NOT NULL DEFAULT 0 CHECK ("ultimo_nsu" >= 0),
  "ultima_consulta_em" timestamp with time zone,
  -- última consulta que não trouxe documento novo: a próxima só depois de 1 hora (regra do ADN)
  "ultima_consulta_vazia_em" timestamp with time zone,
  "ultimo_resultado" varchar(12) CHECK ("ultimo_resultado" IS NULL OR "ultimo_resultado" IN ('ok', 'parcial', 'erro')),
  "documentos_gravados" integer NOT NULL DEFAULT 0 CHECK ("documentos_gravados" >= 0),
  -- NSUs de documentos que não deram para ler (os 20 mais recentes), para o dono conferir; a rodada fica "parcial"
  "nsus_ilegiveis" jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("nsus_ilegiveis") = 'array' AND jsonb_array_length("nsus_ilegiveis") <= 20),
  "atualizado_em" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION fiscal_distribuicao_estado_guarda() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'FISCAL_DISTRIBUICAO_SEM_EXCLUSAO: o estado da captura não é apagado (desligue em vez de apagar)';
  END IF;
  IF NEW."cnpj" IS DISTINCT FROM OLD."cnpj" THEN
    RAISE EXCEPTION 'FISCAL_DISTRIBUICAO_CNPJ: o CNPJ do estado da captura não muda';
  END IF;
  IF NEW."ultimo_nsu" < OLD."ultimo_nsu" THEN
    RAISE EXCEPTION 'FISCAL_DISTRIBUICAO_NSU: o último NSU lido não volta para trás';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fiscal_distribuicao_estado_guarda ON "fiscal_distribuicao_estado";
CREATE TRIGGER fiscal_distribuicao_estado_guarda BEFORE UPDATE OR DELETE ON "fiscal_distribuicao_estado"
  FOR EACH ROW EXECUTE FUNCTION fiscal_distribuicao_estado_guarda();
DROP TRIGGER IF EXISTS fiscal_distribuicao_estado_sem_truncate ON "fiscal_distribuicao_estado";
CREATE TRIGGER fiscal_distribuicao_estado_sem_truncate BEFORE TRUNCATE ON "fiscal_distribuicao_estado"
  FOR EACH STATEMENT EXECUTE FUNCTION fiscal_distribuicao_estado_guarda();
