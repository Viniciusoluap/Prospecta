-- 17/11/2026 — EPIC-025 (etapa 4, QA r2 N2): a guarda da fila de aprovação (0125, JÁ APLICADA em produção) barrava a
-- exclusão de um usuário que decidiu um item da fila pela tela. "decidido_por_user_id" é ON DELETE SET NULL: ao excluir o
-- usuário, o Postgres faz um UPDATE que só põe NULL nessa coluna, e o gatilho recusava (DOLORES_FILA_ENCERRADO no item
-- encerrado; DOLORES_FILA_IMUTAVEL no item em execução). Resultado: Configurações › Usuários › Excluir falhava.
-- Correção: a mesma função, com o corpo completo da 0125 e UMA exceção no começo — passa o UPDATE em que a ÚNICA mudança da
-- linha é "decidido_por_user_id" virar NULL (o resto da linha idêntico, conferido pela linha inteira em jsonb). Qualquer
-- outra mudança junto continua barrada pelas regras de antes.
-- Revisão das chaves estrangeiras das tabelas da Dolores com gatilho de guarda (0123, 0124, 0125, 0126):
-- - dolores_acoes.autor_user_id (0123): ON DELETE RESTRICT de propósito (a usuária Dolores não é apagada com auditoria).
-- - dolores_aprovacoes.autor_user_id (0125): ON DELETE RESTRICT de propósito (a autora é a usuária Dolores); NÃO liberado.
-- - dolores_aprovacoes.decidido_por_user_id (0125): ON DELETE SET NULL → liberado aqui (só a passagem para NULL).
-- - dolores_autoria.autor_user_id e .aprovacao_id (0125): ON DELETE RESTRICT de propósito (Dolores; a fila não é apagada).
-- - dolores_config/dolores_whatsapp_config/dolores_fila_config/dolores_grupos_config.atualizado_por, dolores_consumo.mensagem_id:
--   ON DELETE SET NULL em tabelas SEM gatilho de guarda — já funcionavam.
-- - dolores_grupos.lead_id/obra_id/criado_por_user_id/atualizado_por_user_id (0126): SET NULL; o gatilho do grupo não confere
--   essas colunas — já funcionavam. dolores_grupo_mensagens.lead_document_id (0126): SET NULL já liberado na própria 0126.
-- Somente aditiva e idempotente: só CREATE OR REPLACE FUNCTION (os gatilhos da 0125 continuam apontando para ela).
-- Reversão: reaplicar a função da 0125 (volta a barrar a exclusão do usuário que decidiu item da fila).

CREATE OR REPLACE FUNCTION dolores_aprovacoes_guarda() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'DOLORES_FILA_SEM_EXCLUSAO: itens da fila de aprovação da Dolores não são apagados';
  END IF;
  -- QA r2 N2: o ON DELETE SET NULL de "decidido_por_user_id" (exclusão do usuário que decidiu). Só essa coluna, só para NULL,
  -- e todo o resto da linha igual.
  IF OLD."decidido_por_user_id" IS NOT NULL AND NEW."decidido_por_user_id" IS NULL
     AND (to_jsonb(NEW) - 'decidido_por_user_id') = (to_jsonb(OLD) - 'decidido_por_user_id') THEN
    RETURN NEW;
  END IF;
  -- o que será feito, o que o dono lê (resumo), a validade e a origem do pedido não mudam depois de entrar na fila
  IF NEW."codigo" IS DISTINCT FROM OLD."codigo" OR NEW."funcao" IS DISTINCT FROM OLD."funcao" OR NEW."alvo" IS DISTINCT FROM OLD."alvo"
     OR NEW."argumentos" IS DISTINCT FROM OLD."argumentos" OR NEW."criado_em" IS DISTINCT FROM OLD."criado_em"
     OR NEW."mensagem_id" IS DISTINCT FROM OLD."mensagem_id" OR NEW."vence_em" IS DISTINCT FROM OLD."vence_em"
     OR NEW."resumo" IS DISTINCT FROM OLD."resumo" OR NEW."pedido_id" IS DISTINCT FROM OLD."pedido_id"
     OR NEW."autor_user_id" IS DISTINCT FROM OLD."autor_user_id" OR NEW."conferencia" IS DISTINCT FROM OLD."conferencia" THEN
    RAISE EXCEPTION 'DOLORES_FILA_IMUTAVEL: o que será feito não muda depois de entrar na fila';
  END IF;
  IF OLD."situacao" IN ('executada', 'recusada', 'vencida', 'erro') THEN
    RAISE EXCEPTION 'DOLORES_FILA_ENCERRADO: item encerrado não muda de situação';
  END IF;
  -- aguardando só sai para executando (aprovado), recusada ou vencida: nunca "executada" sem passar pela execução
  IF OLD."situacao" = 'aguardando' AND NEW."situacao" NOT IN ('aguardando', 'executando', 'recusada', 'vencida') THEN
    RAISE EXCEPTION 'DOLORES_FILA_EXECUCAO_UNICA: item aguardando só vai para executando, recusada ou vencida';
  END IF;
  IF OLD."situacao" = 'executando' AND NEW."situacao" NOT IN ('executando', 'executada', 'erro') THEN
    RAISE EXCEPTION 'DOLORES_FILA_EXECUCAO_UNICA: item em execução só termina (executada ou erro)';
  END IF;
  -- a decisão (quem, quando, por onde) é gravada uma vez, ao sair de "aguardando"
  IF OLD."situacao" <> 'aguardando' AND (NEW."decidido_em" IS DISTINCT FROM OLD."decidido_em"
     OR NEW."decidido_via" IS DISTINCT FROM OLD."decidido_via" OR NEW."decidido_por_user_id" IS DISTINCT FROM OLD."decidido_por_user_id") THEN
    RAISE EXCEPTION 'DOLORES_FILA_IMUTAVEL: a decisão do item não muda depois de tomada';
  END IF;
  -- resultado e hora da execução só na transição que encerra a execução (executando → executada/erro)
  IF (NEW."resultado" IS DISTINCT FROM OLD."resultado" OR NEW."executado_em" IS DISTINCT FROM OLD."executado_em")
     AND NOT (OLD."situacao" = 'executando' AND NEW."situacao" IN ('executada', 'erro')) THEN
    RAISE EXCEPTION 'DOLORES_FILA_RESULTADO: o resultado só é gravado ao encerrar a execução';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
