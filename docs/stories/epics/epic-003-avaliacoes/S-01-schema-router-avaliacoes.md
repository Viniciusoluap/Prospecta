# Story S-01 — Schema + router tRPC de Avaliações (Laudos)
**Epic:** EPIC-003
**Status:** Done
**executor:** @data-engineer
**quality_gate:** @dev
**quality_gate_tools:** [tsc, drizzle-kit, manual-review]

## Contexto

O Grupo Santa Fé tem um módulo de avaliação de imóveis (laudo por metodologia comparativo/renda/custo, dados do cliente/imóvel a avaliar, checklist de vistoria em JSON, sugestão de valor via IA, documentos anexos, e cobrança automática no financeiro ao entregar). Modelo fonte: `Avaliacao` (`web/prisma/schema.prisma:476-513`) + `server/lib/actions/avaliacoes.ts`. Esta story cria a fundação (tabela + router CRUD) no Prospecta — checklist de vistoria (S-02), sugestão de valor via IA (S-03) e tela admin (S-04) ficam para as próximas stories.

## Acceptance Criteria

- [x] AC-01: Tabela `avaliacoes` criada no Drizzle espelhando os campos do `Avaliacao` do Santa Fé (dados do cliente, endereço, características do imóvel, metodologia, status do fluxo, campos de laudo/documentos/sugestão em JSON-text, vínculo opcional com `leads`)
- [x] AC-02: Router tRPC `avaliacoes` com `list`/`getById` (protegido, roles admin/corretor/colaborador — este módulo é operacional, não público), `create`/`update` (mesmas roles), `delete` (admin)
- [x] AC-03: `numero` (ex: `AVL-202609-1234`) gerado automaticamente no servidor, como no Santa Fé — nunca informado pelo cliente
- [x] AC-04: `tsc --noEmit` e `npm run build` passam limpos
- [x] AC-05: Migration gerada via `drizzle-kit generate` e aplicada em produção (Neon, SiteProspecta) — confirmado `SELECT count(*) FROM avaliacoes` = 0

## Tasks

- [x] Adicionar `avaliacaoStatusEnum` (solicitada/vistoria/elaboracao/revisao/entregue/cancelada) e tabela `avaliacoes` em `drizzle/schema.ts`: numero (unique), tipo, finalidade, status, dados do cliente (nome/cpf/tel/email), endereço/bairro/cidade/estado, área construída/terreno, quartos/banheiros/vagas, caracteristicas (checklist JSON, texto livre por ora), metodologia, valorEstimado, avaliador, datas (vistoria/prazoEntrega/dataEntrega), observacoes, laudo, documentos (JSON texto), sugestaoJson, valorServico, leadId (FK opcional para `leads`), timestamps
- [x] Funções em `server/db.ts`: `getAllAvaliacoes`, `getAvaliacaoById`, `createAvaliacao` (gera `numero` automaticamente), `updateAvaliacao`, `deleteAvaliacao`
- [x] Router `avaliacoes` em `server/routers.ts`: `list`, `getById`, `create`, `update`, `delete`
- [x] `drizzle-kit generate` (`0004_create_avaliacoes.sql`)
- [x] `tsc --noEmit` e `npm run build`
- [x] Aplicar migration em produção + registrar em `drizzle.__drizzle_migrations`

## File List

- `drizzle/schema.ts`
- `drizzle/0004_create_avaliacoes.sql`
- `server/routers.ts`
- `server/db.ts`

## Validation Notes (@po)

Título claro, contexto rastreável ao modelo `Avaliacao` do Santa Fé (campos não inventados — todos vieram do `schema.prisma` real + `actions/avaliacoes.ts`), AC testáveis, escopo bem definido (só backend; checklist estruturado, sugestão IA e UI ficam nas próximas stories do próprio EPIC-003). Diferença deliberada do Santa Fé: `list`/`create`/`update` exigem papel operacional (admin/corretor/colaborador) em vez de checar apenas `session` — reflete o EPIC-009 (papéis) já mergeado, que o Santa Fé não tinha até então. Sem dependências bloqueantes (EPIC-001 e EPIC-009 já mergeados). Complexidade pequena (1 tabela + 1 router CRUD). Risco baixo (tabela nova). **Score: 9/10.**

**Verdict: GO**

## QA Results (@qa)

Code review: tabela e router novos, sem tocar em código de outros épicos (Track B/Codex inclusive). `tsc`/`build` limpos. Segurança: todas as operações exigem `protectedProcedure` + checagem de role (list/getById/create/update: admin/corretor/colaborador; delete: admin apenas — exclusão de laudo é ação mais sensível). `numero` sempre gerado no servidor, nunca aceito como input do cliente (evita colisão/injeção de formato). Aplicado e conferido em produção (tabela vazia, hash de migration registrado). **Verdict: PASS**

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado, validado e aplicado em produção — Status: Ready → Done | @dev / @qa |
