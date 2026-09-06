# EPIC-001: Catálogo de Imóveis

**Epic Owner:** Claude
**Status:** Draft

## Problem Statement

O Grupo Santa Fé tem um catálogo público de imóveis (`Imovel`: slug, tipo, status, preço, bairro/cidade, flags de publicação por portal) com listagem (`/imoveis`) e detalhe (`/imoveis/[id]`), além de CRUD admin. O Prospecta não tem nenhum equivalente — precisa ser reproduzido na stack Vite/tRPC/Drizzle.

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Tabela `imoveis` no Drizzle espelhando os campos de `Imovel` do Prisma (adaptados às convenções do Prospecta) |
| FR-02 | Páginas públicas `/imoveis` (listagem com filtro) e `/imoveis/:id` (detalhe com galeria) |
| FR-03 | CRUD admin de imóveis (upload de fotos, localização, preço, status) |
| FR-04 | Router tRPC `imoveis` com list/getById/create/update |

## Constraints

| ID | Constraint |
|----|------------|
| CON-01 | Depende do EPIC-000 estar mergeado antes de gerar a migration final (evitar colisão de numeração) |
| CON-02 | Não inclui os flags de publicação em feeds externos (Zap/OLX/VivaReal) — isso é EPIC-005 |

## Stories

| Story | Title | Status |
|-------|-------|--------|
| S-01 | Schema + router `imoveis` | Draft |
| S-02 | Páginas públicas de listagem/detalhe | Draft |
| S-03 | CRUD admin | Draft |
