# Story S-02 — Checklist de Vistoria
**Epic:** EPIC-003
**Status:** Done
**executor:** @dev
**quality_gate:** @dev
**quality_gate_tools:** [tsc, build, manual-review]

## Contexto

O Grupo Santa Fé usa um checklist de vistoria estruturado (ABNT NBR 14653-2) para avaliações, com dois catálogos distintos — imóvel pronto (9 grupos, ~75 itens: localização, documentação, estrutura, cobertura, acabamentos, elétrica, hidráulica, conservação, benfeitorias) e terreno (5 grupos, ~44 itens: localização, documentação, características físicas, aptidão para construção, estado atual) — cada item marcável como conforme/não conforme/não verificado, com nota opcional, mais estado geral do imóvel/aptidão do terreno e fotos da vistoria. Tudo é salvo como JSON no campo `caracteristicas` da avaliação (fonte: `web/src/app/admin/avaliacoes/[id]/_components/checklist-vistoria.tsx` + `web/src/app/api/avaliacoes/[id]/checklist/route.ts`).

Esta story traz o catálogo completo (grupos/itens/opções de estado geral) para o Prospecta como dado compartilhado, e um endpoint de leitura do catálogo + gravação do checklist preenchido. A UI de preenchimento (formulário admin) fica para S-04, junto com o resto da tela administrativa.

## Acceptance Criteria

- [x] AC-01: Catálogo completo do checklist (grupos, itens, labels, opções de estado geral para imóvel e terreno) declarado em `shared/avaliacao-checklist.ts`, transcrito fielmente do Santa Fé — nenhum item inventado ou removido
- [x] AC-02: Router `avaliacoes.getChecklistCatalog` retorna o catálogo (grupos + opções de estado geral) para o tipo pedido (`imovel`/`terreno`)
- [x] AC-03: Router `avaliacoes.updateChecklist` valida a estrutura do checklist preenchido (tipo, estado geral, itens com `ok`/`nota`, até 15 fotos) e grava como JSON em `avaliacoes.caracteristicas`
- [x] AC-04: `tsc --noEmit` e `npm run build` passam limpos
- [x] AC-05: Nenhuma migration de banco necessária — `caracteristicas` já existe na tabela desde a S-01

## Tasks

- [x] Criar `shared/avaliacao-checklist.ts`: tipos (`ChecklistData`, `ChecklistItemState`, `ChecklistGroup`), catálogo `CHECKLIST_IMOVEL`/`CHECKLIST_TERRENO`, opções `ESTADO_GERAL_IMOVEL`/`ESTADO_GERAL_TERRENO`, helpers `getChecklistGroups`/`getEstadoGeralOptions`, constante `CHECKLIST_MAX_FOTOS`
- [x] Router `avaliacoes.getChecklistCatalog` (query, roles admin/corretor/colaborador) em `server/routers.ts`
- [x] Router `avaliacoes.updateChecklist` (mutation, mesmas roles, valida com zod e grava via `db.updateAvaliacao`) em `server/routers.ts`
- [x] `tsc --noEmit` e `npm run build`

## File List

- `shared/avaliacao-checklist.ts`
- `server/routers.ts`

## Validation Notes (@po)

Título claro, escopo restrito ao catálogo + endpoints de leitura/gravação (UI fica pra S-04, já documentado no epic), conteúdo 100% rastreável ao componente real do Santa Fé (sem invenção de itens — Artigo IV da Constitution). Dependência (S-01, tabela `avaliacoes` + campo `caracteristicas`) já satisfeita. Risco baixo: só adiciona, não toca em nada existente. Complexidade pequena (1 arquivo de dados + 2 procedures). **Score: 9/10.**

**Verdict: GO**

## QA Results (@qa)

Code review: catálogo conferido item a item contra o componente original do Santa Fé — 9 grupos/75 itens (imóvel) e 5 grupos/44 itens (terreno) idênticos, nenhuma divergência de key/label. Segurança: `getChecklistCatalog`/`updateChecklist` exigem role operacional (admin/corretor/colaborador), consistente com o resto do router `avaliacoes`; `updateChecklist` valida `items` como record tipado e limita fotos a 15 (mesmo limite do Santa Fé) antes de persistir. `tsc`/`build` limpos. Sem migration — usa coluna já existente. **Verdict: PASS**

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado e validado — Status: Ready → Done | @dev / @qa |
