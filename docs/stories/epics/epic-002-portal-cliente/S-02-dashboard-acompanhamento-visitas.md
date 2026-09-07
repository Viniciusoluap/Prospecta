# Story S-02 — Dashboard, acompanhamento e visitas

**Epic:** EPIC-002  
**Status:** Done
**executor:** Codex  
**quality_gate:** TypeScript, Vitest, build e revisão visual

## Contexto e rastreabilidade

O portal Santa Fé apresenta dados do lead, última atualização, processo/obra associado, histórico de interações e visitas. A página de visitas é somente leitura e orienta o cliente a falar com a equipe para agendar.

Fontes: `web/src/app/portal/page.tsx`, `web/src/app/portal/acompanhamento/page.tsx`, `web/src/app/portal/visitas/page.tsx` e `web/src/lib/data/portal-real.ts`.

## Acceptance Criteria

- [x] AC-01: `/portal` exibe boas-vindas, resumo do processo/obra e última atualização do lead autenticado
- [x] AC-02: `/portal/acompanhamento` lista somente atividades publicáveis do próprio lead em ordem cronológica
- [x] AC-03: `/portal/visitas` lista somente visitas do próprio lead, com data, estado, local e responsável disponíveis
- [x] AC-04: o cliente não cria, altera, cancela ou reagenda visita pelo portal
- [x] AC-05: estados vazios e perfil sem vínculo não vazam dados nem quebram a navegação

## Tasks

- [x] Implementar queries isoladas do dashboard, atividades e visitas
- [x] Criar layout/navegação do portal com a identidade visual da Prospecta
- [x] Criar páginas responsivas de dashboard, acompanhamento e visitas
- [x] Cobrir filtros de dados publicáveis e isolamento por lead

## Change Log

| Date | Version | Change |
|------|---------|--------|
| 2026-09-07 | 0.1.0 | Story detalhada a partir da fonte Santa Fé |
