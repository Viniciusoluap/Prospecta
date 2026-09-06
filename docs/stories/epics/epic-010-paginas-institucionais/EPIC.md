# EPIC-010: Páginas Institucionais

**Epic Owner:** A dividir (Claude/Codex)
**Status:** Draft

## Problem Statement

O Grupo Santa Fé tem páginas públicas institucionais além da landing page: `/servicos`, `/sobre`, `/contato`, `/mercado` (inteligência de mercado imobiliário local), `/cursos`, `/instituto` (braço social do grupo). O dono do produto confirmou: **essas páginas precisam existir no Prospecta também** — só a landing page (`/`) em si e o ecossistema de sorteios ficam diferentes/exclusivos.

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | `/servicos` — lista de serviços oferecidos (espelhar estrutura do Santa Fé, conteúdo adaptado ao Prospecta) |
| FR-02 | `/sobre` — institucional da empresa |
| FR-03 | `/contato` — formulário de contato |
| FR-04 | `/mercado` — inteligência de mercado imobiliário local (pode reaproveitar dados do catálogo de imóveis, EPIC-001) |
| FR-05 | `/cursos` — página de cursos, se aplicável ao Prospecta |
| FR-06 | `/instituto` — braço social, se aplicável ao Prospecta |

## Constraints

| ID | Constraint |
|----|------------|
| CON-01 | Conteúdo/textos adaptados à marca Prospecta, não copiados literalmente do Santa Fé |
| CON-02 | `/mercado` depende de EPIC-001 (catálogo de imóveis) para ter dados reais |

## Stories

_A detalhar — candidata a dividir entre as duas trilhas por ser majoritariamente frontend/conteúdo, baixo acoplamento com o resto._
