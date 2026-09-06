# EPIC-005: Agregador e Feeds para Portais Imobiliários

**Epic Owner:** Claude
**Status:** Draft

## Problem Statement

O Grupo Santa Fé publica feeds XML de imóveis para ZAP, OLX, VivaReal e Chaves na Mão, e tem um agregador que raspa imóveis de portais externos para aprovação manual antes de entrar no catálogo interno (com proteção SSRF). Não existe equivalente no Prospecta.

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Rotas de feed XML por portal (`/api/feed/zap`, `/olx`, `/vivareal`, `/chavesnamao`) |
| FR-02 | Flags de publicação por portal na tabela `imoveis` |
| FR-03 | Scraper/agregador com staging de imóveis para aprovação, protegido contra SSRF |

## Constraints

| ID | Constraint |
|----|------------|
| CON-01 | Depende de EPIC-001 (catálogo de imóveis) |
| CON-02 | Reaproveitar a mesma lógica de proteção SSRF do Santa Fé (`web/src/lib/ssrf.ts`) como referência |

## Stories

| Story | Title | Status |
|-------|-------|--------|
| S-01 | Flags de publicação + feeds XML | Draft |
| S-02 | Agregador/scraper com proteção SSRF | Draft |
