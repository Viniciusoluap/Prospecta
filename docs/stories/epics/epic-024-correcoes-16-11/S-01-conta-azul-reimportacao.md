# S-01 — BPO / Conta Azul: reimportação bloqueada por arquivados

Status: Done (publicada em 16/11/2026)
Epic: EPIC-024 (Fase 1) — correção 01 do dono (16/11/2026)
Paridade: BPO existe nos dois sistemas — porte para o Grupo Santa Fé fica como pendência no ROADMAP (Santa Fé em espera).
Tamanho estimado: M
Dependência: nenhuma. Em produção, os 1.528 arquivados já foram copiados e apagados na Fase 0 (com autorização do dono).

## Problema

Ao importar o backup do Conta Azul, a tela disse que 1.528 lançamentos "já foram importados", mas todos estavam
arquivados (`exclusao_lote_backup_id`). `chavesJaImportadas` buscava o `request_key` sem separar arquivados, e o
arquivado continuava segurando a chave única — o `onConflictDoNothing` não deixava nada entrar.

## Critérios de aceite
- [x] AC1: a prévia separa "já importados (ativos)" de "arquivados que bloqueiam", com a quantidade e o que significa;
      a importação também informa quantos ficaram bloqueados por arquivados.
- [x] AC2: ação "Liberar reimportação", só admin, auditada: remove em definitivo SÓ os lançamentos arquivados do Conta
      Azul (origem `conta_azul` e chave `contaazul:%`, `exclusao_lote_backup_id IS NOT NULL`) que seguram as chaves do
      backup e não têm vínculo (banco, Asaas, `bpo_recebimentos`, `obra_movimentos`, `regularizacao_recebimentos`,
      combinação em qualquer sentido) — numa transação, depois de copiar cada linha para `bpo_lancamentos_expurgo`
      (lote + data + usuário) e gravar o histórico; devolve as contagens exatas.
- [x] AC3: os que têm vínculo não são removidos e voltam listados com o motivo.
- [x] AC4: a tela mostra a quantidade e exige digitar LIBERAR antes de executar.
- [x] AC5: restaurar um backup antigo não duplica o que foi reimportado: a limpeza de ajustes avisa que a linha foi
      removida para liberar a reimportação e não a recria; a exclusão com backup JSON pula a linha do Conta Azul cuja
      chave voltou a existir (antes ela voltava sem a chave, duplicada).
- [x] AC6: ativos e outras origens (legado, Asaas, manual, extrato) nunca são tocados.
- [x] AC7: regras financeiras mantidas e cobertas: transferência interna fora, linha repetida por centro de custo sem
      dobrar, reimportar duas vezes não duplica, classificação (A classificar) preservada, clientes reaproveitados.

## Tarefas
- [x] T1: `chavesJaImportadas` diz se a chave está num arquivado; `planejar` conta ativos e arquivados à parte.
- [x] T2: `arquivadosQueBloqueiam` (motivos de vínculo) e `liberarReimportacaoContaAzul` (transação, travas, cópia,
      histórico, DELETE revalidando os vínculos).
- [x] T3: tabela `bpo_lancamentos_expurgo` (Drizzle + `drizzle/0122_bpo_lancamentos_expurgo.sql`, aditiva e idempotente).
- [x] T4: rota admin `bpo.contaAzul.liberarReimportacao`.
- [x] T5: restauração (`planejarRestauracao` e `planoArquivado`) sem recriar o que foi liberado/reimportado.
- [x] T6: tela `ImportarContaAzul.tsx` (cartão de ativos, aviso dos arquivados, confirmação digitada).
- [x] T7: testes, `tsc --noEmit`, `vite build`.

## Dev Notes (16/11/2026)
- [AUTO-DECISION] "Liberar" só alcança os arquivados que seguram as chaves DO BACKUP enviado (a rota recebe os CSVs de
  novo e relê no servidor), não todos os arquivados do Conta Azul: nunca remove mais do que o necessário para importar.
- [AUTO-DECISION] Confirmação digitada `LIBERAR` (mesmo padrão de EXCLUIR/RESTAURAR do lote), validada no servidor.
- Travas na ordem `bpo_exclusao_lote` → `bpo_importar_conta_azul` (a restauração só usa a primeira e a importação só a
  segunda: sem impasse). Linhas lidas com `FOR UPDATE`; o DELETE repete todas as condições e, se o número de linhas
  apagadas divergir, a transação inteira é desfeita.
- Auditoria: uma linha por lançamento em `bpo_lancamento_historico` (motivo com o lote) + `bpo_lancamentos_expurgo`
  (linha inteira em `dados_json`, `expurgado_por_user_id`, `expurgado_em`) + log `[bpo] Liberar reimportação…` só com contagens.
- A prévia faz primeiro uma consulta leve (sem subconsultas de vínculo) e só confere os vínculos se houver arquivado.
- A tabela de produção da Fase 0 (`bpo_lancamentos_backup_conta_azul_20261116`) não é usada nem alterada pelo código.
- Migração 0122 NÃO aplicada em nenhum banco real nesta execução.

## Correções do portão de QA (16/11, FAIL)
- [x] Q1 (HIGH): `adminProcedure` só confere o módulo — colaborador com BPO chamava a remoção. A rota agora exige
      `ctx.user.role === "admin"` (padrão local dos routers; não há helper comum), a tela esconde o botão para quem não é
      admin, e os testes do Conta Azul passam pelo `appRouter` com o caminho completo `bpo.contaAzul.*` (o
      `bpoRouter.createCaller` perdia o prefixo e dava falso positivo). Prévia e importação mantêm a permissão do módulo.
- [x] Q2 (MEDIUM): restauração com lançamento que não existe mais e não está no expurgo → "não existe mais (foi apagado
      em definitivo)", nada recriado; sem a tabela 0122 (`to_regclass`), mesma mensagem, sem abortar a transação.
      Situação atual da produção: zero lançamentos, todos os backups antigos caem nesse caso.
- [x] Q3 (LOW): chave do Conta Azul presa a um lançamento ARQUIVADO → aviso próprio ("está em outro lançamento
      ARQUIVADO"), separado do "importado de novo" (ativo).
- [x] Q4 (LOW): arquivado de outra origem com chave `contaazul:` → contado em `arquivados.outraOrigem`, com o motivo, e
      nunca removido (antes aparecia como bloqueando sem motivo).

## Testes
- Automáticos (`server/bpo-conta-azul.test.ts`, 5 novos, 16 no arquivo): arquivados aparecem como bloqueando (não como
  já importados); liberar remove só os elegíveis, copia, registra histórico e mantém o com vínculo bancário, o ativo e o
  legado arquivado; confirmação errada recusada; reimportar depois de liberar cria tudo uma vez, a segunda vez nada,
  sem novos clientes, com transferência fora, centro de custo sem dobrar e A classificar preservado; restaurar a limpeza
  antiga e uma exclusão JSON antiga não duplica; colaborador barrado. Suítes do BPO (restauração, lote 3, A classificar)
  passam com a migração 0122 no banco em memória.
- Manuais: abrir o BPO, enviar o ZIP com arquivados, conferir o aviso, digitar LIBERAR, importar.
- Pendente em produção: aplicar a migração 0122; conferir com o ZIP real do dono (hoje os 1.528 já foram apagados na
  Fase 0, então a prévia deve mostrar 0 arquivados bloqueando e importar tudo).

## File List
- `server/bpo-conta-azul.ts` — prévia/importação separando arquivados; `liberarReimportacaoContaAzul`.
- `server/bpo-router.ts` — rota `contaAzul.liberarReimportacao` (admin).
- `server/bpo-restauracao.ts` — aviso dos removidos para liberar a reimportação.
- `shared/financeiro/conta-azul.ts` — `PREFIXO_CHAVE_CONTA_AZUL`, `CONFIRMACAO_LIBERAR_REIMPORTACAO`.
- `shared/financeiro/bpo-restauracao.ts` — chave do Conta Azul em uso = já reimportado (não duplica).
- `drizzle/schema.ts` — `bpoLancamentosExpurgo`.
- `drizzle/0122_bpo_lancamentos_expurgo.sql` (nova) — tabela de cópia, aditiva e idempotente.
- `client/src/components/bpo/ImportarContaAzul.tsx` — ativos x arquivados, "Liberar reimportação" com confirmação.
- `server/bpo-conta-azul.test.ts` — 5 testes novos.
- `server/bpo-restauracao.test.ts`, `server/bpo-lote3.test.ts`, `server/bpo-a-classificar.test.ts` — aplicam a 0122.

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 16/11/2026 | @dev (Dex) | Story criada e Draft → InProgress (YOLO, regra de execução contínua do EPIC-024) |
| 16/11/2026 | @dev (Dex) | InProgress → Ready for Review: prévia separada, liberar reimportação, restauração sem duplicar, 5 testes |
| 16/11/2026 | @qa | Portão: FAIL (Q1 HIGH, Q2 MEDIUM, Q3/Q4 LOW) → InProgress |
| 16/11/2026 | @dev (Dex) | InProgress → Ready for Review: Q1–Q4 corrigidos, testes pelo appRouter, 19 testes no arquivo |
