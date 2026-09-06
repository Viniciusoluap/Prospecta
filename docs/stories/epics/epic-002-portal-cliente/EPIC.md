# EPIC-002: Portal do Cliente

**Epic Owner:** Codex
**Status:** Draft (a detalhar pelo Codex — ver prompt de atribuição)

## Problem Statement

O Grupo Santa Fé tem um portal do cliente logado (acompanhamento de obra, documentos com assinatura gov.br, chat com corretor, agendamento de visitas). Não existe equivalente no Prospecta.

## Referência (Grupo Santa Fé)

- `web/src/app/portal/*`, modelos Prisma `ChatMensagem`, `Contrato`/`ContratoDocumento` (`assinaturaStatus`/`assinaturaGovId`), `Lead.senhaAcesso`

## Constraints

| ID | Constraint |
|----|------------|
| CON-01 | Requer alinhar papéis do Prospecta (`admin/user`) para granularidade do Santa Fé (`admin/corretor/colaborador/cliente`) sem quebrar login atual |
| CON-02 | Banco continua no Neon; segurar geração de migration final até EPIC-000 mergear |

## Stories

_A detalhar pelo Codex._
