-- 20/11/2026 (noite) — EPIC-027 C3. Decisão do dono: CLASSIFICAR um grupo da Dolores (tipo e vínculo) vale pelo WhatsApp E pela
-- tela (admin, ou colaborador com o módulo WhatsApp); ACEITAR grupo em que outra pessoa colocou a Dolores (recusado) ou cuja
-- entrada não foi provada e o dono ainda não aceitou continua SÓ do dono, pelo WhatsApp (regra de 19/11/2026).
-- Story: docs/stories/epics/epic-027-correcoes-20-11-noite/C3-categorias-dos-grupos.md.
--
-- Muda só o gatilho "dolores_grupos_guarda" (CREATE OR REPLACE; tudo o que a 0133 protegia continua igual):
--   - grupo 'recusado', ou automático 'aguardando_dono' SEM prova de quem colocou a Dolores (adicionado_por diferente de 'dono' e
--     prova_adicao diferente de 'aceito_pelo_dono'): só sai desse estado — situação, quem adicionou ou a prova — por decisão do
--     DONO pelo WhatsApp ("decidido_por" começando por 'whatsapp:'), como antes;
--   - NOVO: automático 'aguardando_dono' que o DONO adicionou ou aceitou (só falta o tipo): sai desse estado por decisão do dono
--     pelo WhatsApp OU pela tela ("decidido_por" começando por 'tela:'), e pela tela sem mexer em quem adicionou nem na prova.
--     Qualquer outra origem ('fila:', vazio) continua barrada.
--   - Ir PARA 'recusado' continua sempre permitido.
--   - NOVO (QA-SEG EPIC-027, achado 1 e rodada 2): fora da decisão do dono pelo WhatsApp, pôr ou tirar um tipo de ADMIN —
--     administrativo, jurídico, parceiros comerciais ou engenharia SEM obra (escopo interno) — exige "tela:<id de administrador
--     ativo>" (outro formato é barrado); e, pela tela, quem não é administrador só classifica grupo ainda sem vínculo (cliente/obra).
-- Colunas novas em "dolores_grupos" (ADD COLUMN IF NOT EXISTS, sem padrão: não dispara o gatilho nem altera linha):
--   - "pergunta_tipo_em": quando a Dolores perguntou ao dono o tipo do grupo (a resposta só com o número vale por 30 min);
--   - "aviso_classificacao_pendente_em": classificação feita pela tela cujo aviso ao dono não saiu (teto do dia) — relatório diário.
-- Somente aditiva e idempotente: função trocada (CREATE OR REPLACE) e duas colunas novas anuláveis; nenhuma linha é alterada.
-- Reversão: reexecutar a função da 0133_dolores_grupos_tipo.sql (as colunas novas não atrapalham o código anterior).

ALTER TABLE "dolores_grupos" ADD COLUMN IF NOT EXISTS "pergunta_tipo_em" timestamp with time zone;
ALTER TABLE "dolores_grupos" ADD COLUMN IF NOT EXISTS "aviso_classificacao_pendente_em" timestamp with time zone;

CREATE OR REPLACE FUNCTION dolores_grupos_guarda() RETURNS trigger AS $$
DECLARE
  decidiu boolean;
  aceito_pelo_dono boolean;
  tela_user integer;
  tipo_antes text;
  tipo_depois text;
  admin_antes boolean;
  admin_depois boolean;
  eh_admin boolean;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'DOLORES_GRUPOS_SEM_EXCLUSAO: grupo cadastrado não é apagado (desative)';
  END IF;
  IF NEW."grupo_jid" IS DISTINCT FROM OLD."grupo_jid" OR NEW."instancia" IS DISTINCT FROM OLD."instancia"
     OR NEW."criado_em" IS DISTINCT FROM OLD."criado_em" THEN
    RAISE EXCEPTION 'DOLORES_GRUPOS_IMUTAVEL: o id do grupo e a instância não mudam depois do cadastro';
  END IF;
  -- Etapa 7: o nome visto na entrada e o código, uma vez preenchidos, não mudam; automático não vira manual
  IF (OLD."nome_whatsapp" IS NOT NULL AND NEW."nome_whatsapp" IS DISTINCT FROM OLD."nome_whatsapp")
     OR (OLD."codigo" IS NOT NULL AND NEW."codigo" IS DISTINCT FROM OLD."codigo")
     OR (OLD."origem" = 'automatico' AND NEW."origem" IS DISTINCT FROM OLD."origem") THEN
    RAISE EXCEPTION 'DOLORES_GRUPOS_IMUTAVEL: o nome visto na entrada, o código e a origem do grupo não mudam';
  END IF;
  decidiu := NEW."decidido_em" IS NOT NULL AND NEW."decidido_em" IS DISTINCT FROM OLD."decidido_em";
  -- Etapa 7: tipo e vínculo só mudam por decisão do dono (decidido_em gravado na mesma operação), nas linhas da etapa 7. O
  -- vínculo pode VIRAR NULL sem decisão: é o ON DELETE SET NULL do Postgres quando o CRM exclui o cliente ou a obra. Linha
  -- manual antiga (origem 'manual' e tipo vazio antes e depois): regra antiga (o código anterior à etapa 7 continua valendo).
  IF (OLD."origem" = 'automatico' OR OLD."tipo" IS NOT NULL OR NEW."tipo" IS NOT NULL)
     AND (NEW."tipo" IS DISTINCT FROM OLD."tipo"
      OR (NEW."lead_id" IS DISTINCT FROM OLD."lead_id" AND NEW."lead_id" IS NOT NULL)
      OR (NEW."obra_id" IS DISTINCT FROM OLD."obra_id" AND NEW."obra_id" IS NOT NULL))
     AND NOT decidiu THEN
    RAISE EXCEPTION 'DOLORES_GRUPOS_DECISAO: tipo e vínculo do grupo só mudam por decisão do dono';
  END IF;
  -- EPIC-027 C3: automático "aguardando o dono" que o próprio dono adicionou ou aceitou (só falta o tipo)
  aceito_pelo_dono := OLD."origem" = 'automatico' AND OLD."situacao_confirmacao" = 'aguardando_dono'
    AND (OLD."adicionado_por" = 'dono' OR OLD."prova_adicao" = 'aceito_pelo_dono');
  IF (OLD."situacao_confirmacao" = 'recusado'
      OR (OLD."origem" = 'automatico' AND OLD."situacao_confirmacao" = 'aguardando_dono'))
     AND NEW."situacao_confirmacao" IS DISTINCT FROM 'recusado'
     AND (NEW."situacao_confirmacao" IS DISTINCT FROM OLD."situacao_confirmacao"
      OR NEW."adicionado_por" IS DISTINCT FROM OLD."adicionado_por"
      OR NEW."prova_adicao" IS DISTINCT FROM OLD."prova_adicao")
     AND NOT (decidiu AND coalesce(NEW."decidido_por", '') LIKE 'whatsapp:%')
     AND NOT (aceito_pelo_dono AND decidiu AND coalesce(NEW."decidido_por", '') LIKE 'tela:%'
      AND NEW."adicionado_por" IS NOT DISTINCT FROM OLD."adicionado_por"
      AND NEW."prova_adicao" IS NOT DISTINCT FROM OLD."prova_adicao") THEN
    RAISE EXCEPTION 'DOLORES_GRUPOS_DECISAO: grupo recusado ou sem prova de quem colocou a Dolores só é aceito pelo dono, no WhatsApp';
  END IF;
  -- QA-SEG EPIC-027 (achado 1; rodada 2, R2-1 a R2-3): fora de 'whatsapp:%' (o dono), mexer em grupo de tipo de ADMIN —
  -- administrativo, jurídico, parceiros ou engenharia SEM obra (escopo interno), antes OU depois — exige 'tela:<id de admin
  -- ativo>'; qualquer outro formato ('tela:x', 'fila:1', vazio, id fora do formato) é barrado. Pela tela, quem não é admin só
  -- classifica grupo ainda SEM vínculo (trocar ou tirar cliente/obra existente é do admin).
  IF decidiu AND coalesce(NEW."decidido_por", '') NOT LIKE 'whatsapp:%' THEN
    tipo_antes := coalesce(OLD."tipo", CASE WHEN OLD."obra_id" IS NOT NULL THEN 'engenharia' ELSE 'cliente' END);
    tipo_depois := coalesce(NEW."tipo", CASE WHEN NEW."obra_id" IS NOT NULL THEN 'engenharia' ELSE 'cliente' END);
    IF tipo_depois IS DISTINCT FROM tipo_antes OR NEW."lead_id" IS DISTINCT FROM OLD."lead_id" OR NEW."obra_id" IS DISTINCT FROM OLD."obra_id" THEN
      admin_antes := tipo_antes IN ('administrativo', 'juridico', 'parceiros') OR (tipo_antes = 'engenharia' AND OLD."obra_id" IS NULL);
      admin_depois := tipo_depois IN ('administrativo', 'juridico', 'parceiros') OR (tipo_depois = 'engenharia' AND NEW."obra_id" IS NULL);
      eh_admin := false;
      IF coalesce(NEW."decidido_por", '') ~ '^tela:[0-9]{1,9}$' THEN
        tela_user := substring(NEW."decidido_por" from 6)::integer;
        eh_admin := EXISTS (SELECT 1 FROM "users" WHERE "id" = tela_user AND "role" = 'admin' AND "active" IS TRUE);
      END IF;
      IF (admin_antes OR admin_depois) AND NOT eh_admin THEN
        RAISE EXCEPTION 'DOLORES_GRUPOS_DECISAO: administrativo, jurídico, parceiros e engenharia geral (sem obra) só o administrador define ou tira';
      END IF;
      IF coalesce(NEW."decidido_por", '') LIKE 'tela:%' AND NOT eh_admin AND (OLD."lead_id" IS NOT NULL OR OLD."obra_id" IS NOT NULL) THEN
        RAISE EXCEPTION 'DOLORES_GRUPOS_DECISAO: trocar ou tirar o vínculo do grupo só o administrador';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
