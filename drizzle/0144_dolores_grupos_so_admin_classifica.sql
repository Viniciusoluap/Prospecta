-- 21/11/2026 — EPIC-027 C3, regra corrigida pelo dono: "eu disse que o colaborador pode ter acesso às mensagens do grupo assim
-- como as mensagens dos clientes, mas em nenhum momento eu falei que ele iria classificar". Classificar grupo da Dolores (tipo e
-- vínculo) é SÓ do administrador, pela tela, e do dono, pelo WhatsApp. Colaborador nunca classifica, com ou sem módulo WhatsApp.
-- Story: docs/stories/epics/epic-027-correcoes-20-11-noite/C3-categorias-dos-grupos.md.
--
-- A 0139 já está em produção: aqui só a função do gatilho "dolores_grupos_guarda" é trocada (CREATE OR REPLACE), igual à da 0139
-- (sem exclusão; id/instância/criação, nome visto, código e origem imutáveis; tipo e vínculo só por decisão; obra excluída →
-- "não identificado", calado, com "obra_excluida_em"; recusado/sem prova só sai pelo dono no WhatsApp; aceito pelo dono pode ser
-- classificado pela tela), com o bloco final trocado por uma regra única e mais restrita: fora de 'whatsapp:%', mudar tipo ou
-- vínculo ou tirar o grupo de 'aguardando_dono' exige 'tela:<id de administrador ativo>'; qualquer outro valor é barrado com
-- 'DOLORES_GRUPOS_DECISAO: só o administrador classifica o grupo pela tela'.
-- Caminhos do sistema que gravam decisão de tipo/vínculo: comando do dono ('whatsapp:dono'), o dono adicionou a Dolores
-- ('whatsapp:dono-adicionou'; a entrada pelo aviso de "add" é INSERT, fora do gatilho), tela do admin ('tela:<id>': definirTipo,
-- atualizar; o cadastro manual é INSERT) e a fila (ligar o grupo ao card aprovado), que passa a gravar quem aprovou:
-- 'whatsapp:fila:<id>' (o dono, no WhatsApp) ou 'tela:<id>' (quem aprovou pela tela) — nunca mais 'fila:…'.
-- Somente aditiva e idempotente: só a função é trocada; nenhuma tabela, coluna ou linha é alterada.
-- Reversão: reexecutar a função da 0139_dolores_grupos_classificar_pela_tela.sql.

CREATE OR REPLACE FUNCTION dolores_grupos_guarda() RETURNS trigger AS $$
DECLARE
  decidiu boolean;
  aceito_pelo_dono boolean;
  tela_user integer;
  eh_admin boolean;
  obra_excluida boolean;
  mudou boolean;
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
  -- QA-SEG EPIC-027 (rodada 3, R3-1): a obra foi EXCLUÍDA no CRM (ON DELETE SET NULL, sem decisão de ninguém) num grupo de
  -- engenharia: o grupo NÃO vira "engenharia geral" (escopo interno). Fica "não identificado", aguardando reclassificação (calado),
  -- com a marca "obra_excluida_em" (tela e relatório: "obra excluída: reclassifique"). Recusado continua recusado. Nunca barra a
  -- exclusão da obra.
  obra_excluida := OLD."obra_id" IS NOT NULL AND NEW."obra_id" IS NULL AND NOT decidiu
    AND coalesce(OLD."tipo", 'engenharia') = 'engenharia' AND NEW."tipo" IS NOT DISTINCT FROM OLD."tipo";
  IF obra_excluida THEN
    NEW."tipo" := 'indefinido';
    NEW."situacao_confirmacao" := CASE WHEN OLD."situacao_confirmacao" = 'recusado' THEN 'recusado' ELSE 'aguardando_dono' END;
    NEW."obra_excluida_em" := now();
  END IF;
  -- Etapa 7: tipo e vínculo só mudam por decisão do dono (decidido_em gravado na mesma operação), nas linhas da etapa 7. O
  -- vínculo pode VIRAR NULL sem decisão: é o ON DELETE SET NULL do Postgres quando o CRM exclui o cliente ou a obra. Linha
  -- manual antiga (origem 'manual' e tipo vazio antes e depois): regra antiga (o código anterior à etapa 7 continua valendo).
  IF (OLD."origem" = 'automatico' OR OLD."tipo" IS NOT NULL OR NEW."tipo" IS NOT NULL)
     AND (NEW."tipo" IS DISTINCT FROM OLD."tipo"
      OR (NEW."lead_id" IS DISTINCT FROM OLD."lead_id" AND NEW."lead_id" IS NOT NULL)
      OR (NEW."obra_id" IS DISTINCT FROM OLD."obra_id" AND NEW."obra_id" IS NOT NULL))
     AND NOT decidiu AND NOT obra_excluida THEN
    RAISE EXCEPTION 'DOLORES_GRUPOS_DECISAO: tipo e vínculo do grupo só mudam por decisão do dono';
  END IF;
  -- EPIC-027 (regra do dono de 21/11/2026: classificar grupo é SÓ do administrador pela tela e do dono pelo WhatsApp): fora de
  -- 'whatsapp:%', mudar tipo ou vínculo (cliente/obra) ou tirar o grupo de 'aguardando_dono' exige decisão com
  -- 'tela:<id de administrador ATIVO>'. Colaborador, 'tela:x', 'fila:…', vazio, id fora do formato → barrado. Exceções que não
  -- são decisão: o vínculo VIRAR NULL pelo ON DELETE SET NULL (exclusão no CRM, tratada acima para obra) e ir PARA 'recusado'.
  mudou := NEW."tipo" IS DISTINCT FROM OLD."tipo"
    OR (NEW."lead_id" IS DISTINCT FROM OLD."lead_id" AND (decidiu OR NEW."lead_id" IS NOT NULL))
    OR (NEW."obra_id" IS DISTINCT FROM OLD."obra_id" AND (decidiu OR NEW."obra_id" IS NOT NULL))
    OR (OLD."situacao_confirmacao" = 'aguardando_dono' AND NEW."situacao_confirmacao" NOT IN ('aguardando_dono', 'recusado'));
  IF mudou AND NOT obra_excluida AND NOT (decidiu AND coalesce(NEW."decidido_por", '') LIKE 'whatsapp:%') THEN
    eh_admin := false;
    IF decidiu AND coalesce(NEW."decidido_por", '') ~ '^tela:[0-9]{1,9}$' THEN
      tela_user := substring(NEW."decidido_por" from 6)::integer;
      eh_admin := EXISTS (SELECT 1 FROM "users" WHERE "id" = tela_user AND "role" = 'admin' AND "active" IS TRUE);
    END IF;
    IF NOT eh_admin THEN
      RAISE EXCEPTION 'DOLORES_GRUPOS_DECISAO: só o administrador classifica o grupo pela tela';
    END IF;
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
