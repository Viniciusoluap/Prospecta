# Handoff — Filtro "Atrasadas" nas Tarefas e SLA (11/11)

## Pedido do dono
No filtro de status da tela Tarefas e Agenda → Tarefas e SLA, incluir "Atrasadas" (status automático quando o prazo
passa). A lógica padrão deve mostrar só as atrasadas e as do dia (pendentes/em andamento com prazo hoje); futuras e
concluídas só aparecem se escolher no filtro.

## Concluído
- `shared/tarefas-filtro.ts`: `tarefaAtrasada` (prazo vencido e tarefa aberta), `tarefaDoDia`, `passaFiltroTarefa`
  e as opções do filtro: Atrasadas e do dia (padrão), Atrasadas, Pendentes, Em andamento, Concluídas, Todas.
- `client/src/pages/admin/AdminTarefas.tsx`: filtro novo, padrão "Atrasadas e do dia"; quem chega pelo link da Agenda
  (`#tarefa-ID`) abre em "Todas" para achar a tarefa; mensagem própria quando não há nada atrasado ou do dia.
  Os cartões do topo (Pendentes, Em andamento, Atrasadas) continuam contando todas.
- Tarefas sem prazo não aparecem no padrão (não são atrasadas nem do dia); aparecem em Pendentes/Todas.
- Paridade: no Grupo Santa Fé as tarefas ficam na Agenda; lá entraram as opções "Tarefas atrasadas e do dia" e
  "Tarefas atrasadas" no filtro "Exibir" (mesma regra), PR #253 do Santa Fé.

## Testes
- (a) `server/tarefas-filtro.test.ts` (3); suíte completa 192 arquivos / 1596 testes, typecheck e build OK.
- (b) manuais: nenhum.
- (c) produção: pendente — abrir Tarefas e SLA e conferir que só atrasadas e do dia aparecem.

## Próximo passo
Com autorização: merge/deploy deste PR (Prospecta) e do PR #253 (Santa Fé).
