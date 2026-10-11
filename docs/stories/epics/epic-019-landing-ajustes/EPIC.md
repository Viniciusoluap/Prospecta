# EPIC-019: Ajustes de Landing Page e Rodapé

**Epic Owner:** Claude
**Status:** Done (S-3.2, S-4.1, S-4.2, S-4.3, S-4.4)

## Problem Statement

Lote de 5 ajustes pontuais na landing page pública e no rodapé, reportados diretamente pelo
dono do produto: um bug visual de sobreposição de texto no rodapé, uma seção de prova social
("Veja Com Seus Próprios Olhos") que deveria aparecer também em "Sobre Nós" além da home, um
@ de Instagram desatualizado, e duas seções consideradas redundantes com o resto do site que
devem ser removidas da home. Escopo estritamente limitado à landing page pública e ao rodapé —
nenhuma mudança em área administrativa/CRM.

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Rodapé público: coluna "Links Rápidos" sem sobreposição visual entre itens, em qualquer largura de tela |
| FR-02 | Seção "Veja Com Seus Próprios Olhos" extraída para componente reaproveitável, renderizada tanto na Home quanto em "Sobre Nós" (em sequência ao conteúdo já existente da página) |
| FR-03 | @ do Instagram atualizado de `@imoveiscomvinifreitas` para `@viniciusincorporador` (texto exibido e `href`) em todas as ocorrências do client |
| FR-04 | Seção "Invista no ramo imobiliário!" removida da Home, sem deixar link/âncora quebrado |
| FR-05 | Seção "Por Que Construir na Planta?" removida da Home |

## Constraints

| ID | Constraint |
|----|------------|
| CON-01 | Nenhuma alteração em páginas/rotas do admin/CRM — outro agente trabalha em paralelo nessa área |
| CON-02 | A seção de prova social deve continuar existindo na Home (reaproveitamento via componente, não remoção) |
| CON-03 | `tsc --noEmit` e `npm run build` devem passar limpos antes de qualquer commit |

## Stories

| Story | Title | Status |
|-------|-------|--------|
| S-3.2 | Rodapé "Links Rápidos" — corrigir sobreposição de texto | Done |
| S-4.1 | Extrair seção "Veja Com Seus Próprios Olhos" para componente e reaproveitar em Home + Sobre Nós | Done |
| S-4.2 | Atualizar @ do Instagram para @viniciusincorporador | Done |
| S-4.3 | Remover seção "Invista no ramo imobiliário!" da Home | Done |
| S-4.4 | Remover seção "Por Que Construir na Planta?" da Home | Done |
