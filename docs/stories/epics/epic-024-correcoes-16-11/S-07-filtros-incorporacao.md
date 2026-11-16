# S-07 — Filtros na listagem de incorporações

Status: Ready for Review
Epic: EPIC-024 (Fase 2) — correção 07 do dono (16/11/2026)
Paridade: Incorporação existe nos dois sistemas — pendência de porte para o Grupo Santa Fé no ROADMAP (Santa Fé em espera).
Tamanho estimado: S
Dependência: nenhuma.

## Problema

A listagem de Incorporação (`client/src/pages/admin/AdminIncorporacao.tsx`) só filtra pela situação, e cada troca de
situação refaz a consulta no servidor. O dono quer achar o empreendimento pelo nome e pelo tipo.

## Critérios de aceite
- [x] AC1: o filtro de situação continua existindo.
- [x] AC2: busca dinâmica pelo nome, sem diferenciar maiúsculas e acentos.
- [x] AC3: filtro de tipo: Todos os tipos, Desmembramento Simples, Vertical, Loteamento.
- [x] AC4: os três filtros combinam; o resultado muda sem recarregar a página.
- [x] AC5: os cartões mantêm o comportamento (abrir o estudo, excluir).
- [x] AC6: estudos de tipo legado (`residencial`) ou sem tipo continuam acessíveis em "Todos os tipos".
- [x] AC7: responsivo (celular: filtros empilhados em largura total; tablet/computador: lado a lado).

## Tarefas
- [x] T1: função pura `filtrarEstudosIncorporacao` em `shared/` (reaproveita `normalizarTexto` de `shared/obras-filtro.ts`).
- [x] T2: tela — busca, tipo, "Limpar filtros" e aviso de nenhum resultado; a lista vem inteira uma vez só.
- [x] T3: testes (acentos, maiúsculas, combinações, tipo nulo e legado).

## Dev Notes
- [AUTO-DECISION] Situação passou a filtrar no navegador também (a lista já vinha inteira quando "Todas"), para que
  os três filtros respondam na hora, sem nova consulta. A rota `incorporacao.list` não mudou.
- Com filtros que não acham nada, a tela diz "Nenhum estudo encontrado com esses filtros" (não o aviso de lista vazia).

## Testes
- Automáticos: `server/incorporacao-filtros-listagem.test.ts` (4 testes) — passando.
- Manuais: conferir no navegador em celular, tablet e computador.
- Pendente em produção: nenhum além da conferência visual.

## File List
- `shared/incorporacao/filtro-listagem.ts` (novo)
- `server/incorporacao-filtros-listagem.test.ts` (novo)
- `client/src/pages/admin/AdminIncorporacao.tsx`
- `docs/stories/epics/epic-024-correcoes-16-11/S-07-filtros-incorporacao.md` (esta story)

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 16/11/2026 | @dev (Dex) | Story criada e implementada (YOLO); Ready for Review |
