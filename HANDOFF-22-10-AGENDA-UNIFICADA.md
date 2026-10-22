# Handoff — correção da lista do calendário — 22/10/2026

Branch `codex/agenda-unificada-20261022`, base `751252d`. Implementação no worktree `Prospecta-agenda-unificada`; nada das branches anteriores foi alterado.

## Concluído

- `AdminAgenda.tsx`: remoção dos dois blocos superiores e botão redundante; filtros solicitados; lista unificada de leads, tarefas e visitas abaixo do calendário. Clique em data reseta filtro; calendário e lista usam os mesmos registros.
- `shared/agenda-unificada.ts`: seleção/ordenação, status ativo de tarefas no dia e preservação de datas CRM sem hora.
- `AdminTarefas.tsx`: âncora individual para navegação da agenda.
- `docs/stories/2026-10-22-agenda-unificada.md`: aceite e decisões AIOX/IDS.

## Verificação e próximo passo

(a) Seis testes unitários de cenários/datas e três testes SSR do HTML do componente passaram (nove leads na tabela, lista mista e isolamento do corretor); TypeScript passou; diff sem erro. Não há script lint/typecheck nomeado no package; comando equivalente `node_modules/.bin/tsc --noEmit` utilizado. Alterações acidentais do lockfile pelo launcher pnpm foram revertidas; nenhum arquivo de dependências foi alterado.

(b) Interface autenticada não exercitada em navegador nesta frente.

(c) QA independente aprovado: tabela SSR com nove leads, cenário misto e isolamento do corretor. Paridade Santa Fé revisada. Próximo passo: commit/push pelo DevOps AIOX e validar preview/produção conforme autorização. Nenhum envio de email ou alteração de dados reais.

Gate DevOps: suites exatas reexecutadas (9/9), diff limpo e sem mudança de dependências. CLI CodeRabbit e tasks/checklists `.aiox-core` indisponíveis; revisão independente e testes reais usados, com build Vercel obrigatório antes do merge.

Dev não faz commit/push: orquestrador fica responsável por salvar esta etapa no GitHub e confirmar SHA. Não alegar salvamento remoto antes disso.
