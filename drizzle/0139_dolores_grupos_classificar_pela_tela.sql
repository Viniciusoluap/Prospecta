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
-- Somente aditiva e idempotente: só a função é trocada (CREATE OR REPLACE); nenhuma tabela, coluna ou linha é alterada.
-- Reversão: reexecutar a função da 0133_dolores_grupos_tipo.sql.

CREATE OR REPLACE FUNCTION dolores_grupos_guarda() RETURNS trigger AS $$
DECLARE
  decidiu boolean;
  aceito_pelo_dono boolean;
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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
