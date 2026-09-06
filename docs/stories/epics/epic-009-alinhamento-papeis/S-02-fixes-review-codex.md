# Story S-02 — Correções de review externo (Codex bot) na S-01
**Epic:** EPIC-009
**Status:** Done
**executor:** @dev
**quality_gate:** @qa
**quality_gate_tools:** [tsc, drizzle-kit, manual-review]

## Contexto

O bot de review do Codex (`chatgpt-codex-connector`) analisou o PR #6 (S-01, já mergeado) e achou 2 problemas reais depois do merge. Como o PR já estava fechado, os fixes viram uma story nova em vez de um push no PR antigo.

## Findings

### P1 — `drizzle/0002_migrate_user_role_data.sql` quebraria um banco novo

O migrator do Drizzle instalado (0.31.4, `PgDialect.migrate`) envolve **todas** as migrations pendentes em uma única transação. Se 0001 (`ALTER TYPE ADD VALUE 'cliente'`) e 0002 (`UPDATE ... WHERE role = 'cliente'`) ficassem juntas no journal, um `drizzle-kit migrate`/`db:push` rodado do zero (banco novo — staging, preview, ambiente de outro dev) tentaria usar o valor `'cliente'` do enum na mesma transação em que ele foi criado — o Postgres rejeita isso (`unsafe use of new value of enum type`) e a migration inteira falha. Em produção não deu problema porque eu apliquei manualmente em duas chamadas separadas (transações distintas), mas o *journal* ainda tinha as duas juntas, prontas pra quebrar em qualquer banco novo.

### P2 — Novos cadastros continuavam caindo em `role = 'user'`

A migração de dados corrige quem já existia, mas o **default** da coluna (`drizzle/schema.ts:82`) continuava `'user'`. Como `server/_core/oauth.ts` insere usuário novo sem setar `role` explicitamente, todo cadastro novo ia continuar recebendo `'user'` — o sistema nunca convergiria pro modelo de 4 papéis.

## Acceptance Criteria

- [x] AC-01: `drizzle/0002_migrate_user_role_data.sql` removido do `drizzle/meta/_journal.json` (não é mais auto-descoberto pelo `drizzle-kit migrate`) e movido para `drizzle/manual/` com comentário explicando por quê e como rodar
- [x] AC-02: Default da coluna `role` mudado de `'user'` para `'cliente'` em `drizzle/schema.ts`, com migration `0002_default_role_cliente.sql` gerada e aplicada
- [x] AC-03: `tsc --noEmit` e `npm run build` passam limpos
- [x] AC-04: Migration aplicada em produção (Neon, SiteProspecta) — confirmado via `information_schema.columns`

## Tasks

- [x] Remover entrada idx=2 (`0002_migrate_user_role_data`) de `drizzle/meta/_journal.json`
- [x] Mover `drizzle/0002_migrate_user_role_data.sql` → `drizzle/manual/0002_migrate_user_role_data.sql`, com header explicando a restrição de transação do Postgres
- [x] Editar `drizzle/schema.ts` — `role: userRoleEnum("role").default("cliente").notNull()`
- [x] Verificar `server/_core/oauth.ts` e demais pontos de criação de usuário — confirmado: só o endpoint de setup de admin (`api/index.ts`) seta `role` explicitamente (`"admin"`), não afetado pela mudança de default
- [x] `drizzle-kit generate` → `0002_default_role_cliente.sql`
- [x] Validar `tsc --noEmit` e `npm run build`
- [x] Aplicar `ALTER TABLE users ALTER COLUMN role SET DEFAULT 'cliente'` em produção + registrar em `drizzle.__drizzle_migrations`

## File List

- `drizzle/schema.ts`
- `drizzle/meta/_journal.json`
- `drizzle/manual/0002_migrate_user_role_data.sql` (movido)
- `drizzle/0002_default_role_cliente.sql` (novo)

## QA Results (@qa)

Ambos os findings do Codex verificados e corrigidos na raiz, não só documentados. `tsc`/`build` limpos. Produção conferida (`information_schema.columns` mostra default `'cliente'::user_role`). **Verdict: PASS**

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 1.0.0 | Story criada e fechada — fixes de review externo aplicados e validados | @dev |
