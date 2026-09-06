# Story S-01 — Schema + router tRPC de Imóveis
**Epic:** EPIC-001
**Status:** Done
**executor:** @data-engineer
**quality_gate:** @dev
**quality_gate_tools:** [tsc, drizzle-kit, manual-review]

## Contexto

O Grupo Santa Fé tem um catálogo de imóveis (`Imovel`: slug, tipo, status, preço, bairro/cidade/estado, flags de publicação por portal — `publicadoSite/Zap/Olx/Viva`, `destaque` usado na home). O Prospecta não tem nenhum equivalente. Esta story cria a fundação (tabela + router) — as páginas públicas e o CRUD admin ficam para S-02/S-03.

## Acceptance Criteria

- [x] AC-01: Tabela `imoveis` criada no Drizzle com os campos de catálogo (ver Tasks) + flags de publicação por portal (`publicadoSite`, `publicadoZap`, `publicadoOlx`, `publicadoViva`, `publicadoChavesNaMao`) e `destaque`, espelhando o conceito do `Imovel` do Santa Fé
- [x] AC-02: Router tRPC `imoveis` com `list` (público, filtra por publicado; admin com `adminView` vê tudo), `getById`/`getBySlug` (público), `create`/`update` (admin, `protectedProcedure` + checagem de `role==="admin"`, seguindo o padrão do resto do arquivo)
- [x] AC-03: `tsc --noEmit` e `npm run build` passam limpos
- [x] AC-04: Migration gerada via `drizzle-kit generate` e aplicada em produção (Neon, SiteProspecta) — confirmado `SELECT count(*) FROM imoveis` = 0

## Tasks

- [x] Adicionar tabela `imoveis` em `drizzle/schema.ts`: id, slug (unique), titulo, descricao, tipo, status (default 'disponivel'), preco, quartos, banheiros, vagas, areaM2, endereco, bairro, cidade, estado, latitude, longitude, fotos (text/json), destaque (bool, default false), publicadoSite/Zap/Olx/Viva/ChavesNaMao (bool), createdAt, updatedAt
- [x] Router `imoveis` em `server/routers.ts`: `list`, `getById`, `getBySlug`, `create`, `update`
- [x] Funções em `server/db.ts`: `getAllImoveis`, `getImovelById`, `getImovelBySlug`, `createImovel`, `updateImovel`
- [x] `drizzle-kit generate` (`0003_create_imoveis.sql`)
- [x] `tsc --noEmit` e `npm run build`
- [x] Aplicar migration em produção + registrar em `drizzle.__drizzle_migrations`

## File List

- `drizzle/schema.ts`
- `drizzle/000X_create_imoveis.sql`
- `server/routers.ts`
- `server/db.ts`

## Validation Notes (@po)

Título claro, contexto rastreável ao mapeamento do Santa Fé (não inventa campos fora do que foi documentado + necessidades padrão de um catálogo imobiliário), AC testáveis, escopo bem definido (só backend, UI fica pra S-02/S-03), sem dependências bloqueantes (EPIC-000 e EPIC-009 já mergeados), complexidade pequena (1 tabela + 1 router), valor de negócio claro (base pra EPIC-003/005/010), risco baixo (tabela nova, não mexe em nada existente). **Score: 9/10.**

**Verdict: GO**

## QA Results (@qa)

Code review: tabela nova + router novo, não toca em código de outros EPICs (nem os meus EPIC-003/005, nem os do Track B). Sem regressões: `tsc`/`build` limpos. Segurança: `create`/`update` protegidos por checagem de admin, consistente com o resto do arquivo; `list` público só expõe imóveis com `publicadoSite=true` (a menos que seja admin pedindo `adminView`). Aplicado e conferido em produção. **Verdict: PASS**

## Change Log

| Date | Version | Change | Agent |
|------|---------|--------|-------|
| 2026-09-06 | 0.1.0 | Story criada e validada GO — Status: Draft → Ready | @sm / @po |
| 2026-09-06 | 1.0.0 | Implementado, validado e aplicado em produção — Status: Ready → Done | @dev / @qa |
