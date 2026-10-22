# Agenda unificada — 22/10/2026

Status: Ready for Review. Fluxo AIOX: escopo/aceite → implementação Dex → revisão Quinn → DevOps pelo orquestrador.

## Problema e aceite

O calendário contava leads e tarefas, mas a tabela inferior renderizava somente visitas. Ao selecionar 22/10 com nove leads, a lista ficava vazia. A lista agora usa as mesmas fontes do calendário.

- [x] Remover listas superiores redundantes de prazos e vencimentos.
- [x] Substituir Dia por Exibir: Data selecionada, Leads vencidos, Leads do dia, Leads a vencer e Todas as tarefas.
- [x] Clique em data mostra leads, tarefas ativas e agendamentos desse dia abaixo do calendário; troca de mês seleciona dia 1.
- [x] Todas as tarefas, inclusive sem prazo/concluídas/canceladas, aparecem juntas somente quando selecionado esse filtro.
- [x] Status/corretor se aplicam aos agendamentos; não escondem leads/tarefas.
- [x] Remover botão Mostrar todos os dias na lista; links de lead/tarefa e edição/exclusão de visitas preservados.
- [x] Mesmo critério para contagem e lista; datas sem hora do CRM não mudam de dia por fuso.
- [x] Corretor mantém somente a própria agenda, sem carregar/expor tarefas e vencimentos de leads.
- [x] Loading, erro e tentativa novamente cobrem todas as fontes habilitadas.

## Decisões IDS e implementação

- ADAPT `AdminAgenda.tsx`: reaproveitar página, queries, calendário, linhas e editor; unificar as três fontes e filtrar por visão.
- ADAPT `AdminTarefas.tsx`: âncora no cartão existente para Abrir tarefa.
- CREATE `shared/agenda-unificada.ts`: seleção/ordenação e normalização de dia em função pura usada por calendário e tabela; busca prévia não encontrou helper equivalente.
- CREATE `server/agenda-unificada.test.ts`: regressão dos cenários reportados e fronteiras de filtro/data.
- Sem alteração de banco, API ou datas individuais dos cards.

## Revisão e validação

- Self-critique: contagens e registros derivam da mesma seleção; identificadores das três categorias não colidem; tarefas sem prazo só entram na visão explícita; filtros de visitas têm rótulo de escopo.
- Automáticos: TypeScript passou; seis testes do helper e três testes SSR do componente passaram (nove leads na tabela, conjunto misto e isolamento do corretor); diff sem espaços inválidos.
- Manuais: interface autenticada e interações no navegador ainda não executadas.
- Produção: merge/deploy e homologação pelo orquestrador.
- Limite AIOX: wrappers/persona locais foram lidos; `.aiox-core` e `.aiox/gotchas.json` não existem neste checkout, portanto tasks/checklists referenciados não puderam ser executados por engine. Aplicado o fluxo equivalente documentado acima, sem alegar execução dessas dependências ausentes.

## QA Results

- Gate: **APPROVED** para o código; publicação condicionada ao build da prévia pelo orquestrador.
- Revisão independente confirmou que o JSX itera a lista unificada e que os cliques retornam ao modo por data. Calendário e tabela usam a mesma seleção. Filtros de agendamento não atingem leads/tarefas; corretor não carrega fontes internas.
- Regressão SSR do componente real: nove leads produzem nove linhas de tabela; quatro leads, tarefa e visita produzem seis linhas com ações preservadas; tarefa sem prazo fica ausente por padrão; corretor não vê tarefas/leads internos. Ausência dos blocos redundantes e do estado vazio indevido conferida.
- Execução final: `vitest` dos dois arquivos 9/9; os mesmos testes passaram em `TZ=America/Fortaleza`; `git diff --check` sem erros.
- Limitação: não houve sessão autenticada no navegador nem simulação DOM de eventos. A renderização real e a inspeção dos callbacks cobrem o defeito reportado; clique real deve ser homologado na prévia/produção.
