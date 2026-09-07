# Story S-01 — Estender enum de papel do usuário
**Epic:** EPIC-009
**Status:** Done
**executor:** @data-engineer
**quality_gate:** @dev
**quality_gate_tools:** [tsc, drizzle-kit, manual-review]

## Contexto

O Prospecta hoje só tem dois papéis (`admin`/`user`, enum `user_role` na tabela `users`). O Grupo Santa Fé usa quatro (`admin | corretor | colaborador | cliente`). Esta story estende o enum de forma aditiva (sem quebrar nada existente) e migra os dados atuais: usuários com `role = 'user'` passam a ter `role = 'cliente'`.

## Acceptance Criteria

- [ ] AC-01: Enum `user_role` no Drizzle (`drizzle/schema.ts`) passa a aceitar `admin | corretor | colaborador | cliente` (valores antigos `user`/`admin` continuam válidos até a migração de dados rodar)
- [ ] AC-02: Migration SQL gerada via `drizzle-kit generate` (ALTER TYPE ADD VALUE, aditivo) + UPDATE que migra `role = 'user'` para `role = 'cliente'`
- [ ] AC-03: `server/db.ts`/`server/routers.ts` — nenhuma verificação de `role !== "admin"` quebra (checagens continuam funcionando com os papéis novos coexistindo)
- [x] AC-04: Migration aplicada em produção (Neon, projeto SiteProspecta) — passo manual/explícito, não automático
- [ ] AC-05: `tsc --noEmit` e `npm run build` passam limpos

## Tasks

- [x] Editar `drizzle/schema.ts` — estender `userRoleEnum` para `["user", "admin", "corretor", "colaborador", "cliente"]` (manter `user` por compatibilidade retroativa até todos os dados migrarem; pode ser removido em story futura)
- [x] Rodar `drizzle-kit generate` para a migration do ALTER TYPE (`0001_extend_user_role_enum.sql`)
- [x] Escrever migration adicional (mesma pasta) com `UPDATE users SET role = 'cliente' WHERE role = 'user'` (`0002_migrate_user_role_data.sql`)
- [x] Validar `tsc --noEmit` e `npm run build`
- [x] Aplicar as duas migrations em produção via Neon MCP — autorizado e aplicado pelo usuário em 2026-09-06. Confirmado via `enum_range`: os 5 valores existem em produção. Tabela `drizzle.__drizzle_migrations` atualizada com os hashes das duas migrations.

## File List

- `drizzle/schema.ts`
- `drizzle/000X_*.sql` (nova migration)

## Validation Notes (@po)

Checklist de 10 pontos (`story-lifecycle.md`): título claro, contexto completo, AC testáveis (AC-01 a AC-05), escopo bem definido (aditivo, sem quebrar nada existente), sem dependências bloqueantes, complexidade pequena (1 tabela, 1 enum), valor de negócio claro (libera EPIC-002/004), risco documentado (migração de dados de `role='user'`→`'cliente'`, mitigado por ser aditivo), critério de pronto claro (AC-05), alinhado ao EPIC-009. **Score: 9/10** — único ponto sem nota explícita é estimativa formal de esforço (T-shirt: XS).

CodeRabbit: desabilitado neste ambiente (`coderabbit_integration.enabled: false` em `.aiox-core/core-config.yaml` — WSL não existe neste container). Revisão de qualidade fica manual via @qa (etapa de review desta mesma story).

**Verdict: GO**

## QA Results (@qa)

**7 checks (story-lifecycle.md):**
1. Code review — mudança mínima e correta: só estende o enum, não remove valores antigos. ✅
2. Testes unitários — não há suíte de testes para schema/enum neste projeto; validado via `tsc --noEmit`. ✅ (sem regressão)
3. Acceptance criteria — AC-01/02/03/05 atendidos. **AC-04 pendente** (aplicação em produção depende de confirmação explícita do usuário, por design da própria story). ⏳
4. Sem regressões — `tsc --noEmit` e `npm run build` limpos, nenhum arquivo além de `drizzle/schema.ts` e as duas migrations foi tocado. ✅
5. Performance — N/A (mudança de schema aditiva). ✅
6. Segurança — nenhum dado sensível exposto; `ALTER TYPE ADD VALUE` é operação segura e reversível (não remove nada). ✅
7. Documentação — story atualizada com File List e Change Log. ✅

**Verdict: CONCERNS → DONE** — código pronto e seguro. AC-04 foi concluído em 2026-09-06 após autorização explícita do usuário (ver Change Log). Todas as ACs atendidas.

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada | @sm |
| 2026-09-06 | 0.2.0 | Validated GO (9/10) — Status: Draft → Ready | @po |
| 2026-09-06 | 0.3.0 | Dev started — Status: Ready → InProgress | @dev |
| 2026-09-06 | 0.4.0 | Dev completo (schema + migrations geradas, typecheck/build OK) — Status: InProgress → InReview | @dev |
| 2026-09-06 | 0.5.0 | QA: CONCERNS — código aprovado, AC-04 (aplicar em produção) pendente de confirmação do usuário — Status mantido InReview | @qa |
| 2026-09-06 | 1.0.0 | Usuário autorizou aplicação em produção. Migrations 0001/0002 aplicadas no Neon (SiteProspecta) em transações separadas. `drizzle.__drizzle_migrations` atualizada. AC-04 concluído — Status: InReview → Done | @qa |
