# EPIC-003: Avaliações (Laudos)

**Epic Owner:** Claude
**Status:** Draft

## Problem Statement

O Grupo Santa Fé tem um módulo de avaliação de imóveis (laudos por metodologia comparativo/renda/custo, checklist de vistoria, comparáveis, sugestão de valor por IA). Não existe equivalente no Prospecta.

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Tabela `avaliacoes` (laudo) + checklist de vistoria |
| FR-02 | Router tRPC com sugestão de valor via IA (Claude, já disponível via `@anthropic-ai/sdk`) |
| FR-03 | Upload de documentos da avaliação |
| FR-04 | Tela admin de avaliações/laudos |

## Constraints

| ID | Constraint |
|----|------------|
| CON-01 | Depende de EPIC-001 (avaliação referencia um imóvel do catálogo) |

## Stories

| Story | Title | Status |
|-------|-------|--------|
| S-01 | Schema + router `avaliacoes` | Done |
| S-02 | Checklist de vistoria | Done |
| S-03 | Sugestão de valor via IA | Done |
| S-04 | Tela admin | Draft |
