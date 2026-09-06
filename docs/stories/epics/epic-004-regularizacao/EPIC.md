# EPIC-004: Regularização

**Epic Owner:** Codex
**Status:** Draft (a detalhar pelo Codex — ver prompt de atribuição)

## Problem Statement

O Grupo Santa Fé tem um módulo de regularização imobiliária (`Regularizacao`/`RegDocumento`) com workflow de documentos e status.

**Atualização (06/09/2026):** já existem em produção (Neon, projeto SiteProspecta) as tabelas `regularizacoes` e `regularizacao_documents`, vazias (0 linhas), sem nenhum código associado (não estão em `drizzle/schema.ts` nem em nenhum router). Origem desconhecida (provavelmente um experimento anterior da plataforma Manus). O dono do produto decidiu **reaproveitar** essa estrutura em vez de recriar do zero.

## Schema já existente em produção (reaproveitar, só declarar no Drizzle)

`regularizacoes`: id, client_name, client_phone, type, status (default 'analysis'), address, registration, registry_office, responsible, lead_id (FK conceitual pra `leads`), service_value, paid_value, expected_end_at, description, notes, created_at, updated_at.

`regularizacao_documents`: id, regularizacao_id (FK pra `regularizacoes`), name, status (default 'pending'), observation, file_url, created_at, updated_at.

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Declarar `regularizacoes` e `regularizacao_documents` em `drizzle/schema.ts` exatamente como já existem em produção (sem ALTER — só declaração) |
| FR-02 | Router tRPC `regularizacoes` (list/getById/create/update) e sub-rotas de documentos |
| FR-03 | Tela admin de regularização com workflow de status e upload de documentos |

## Constraints

| ID | Constraint |
|----|------------|
| CON-01 | Não alterar a estrutura das tabelas existentes — só declarar o que já está no banco |
| CON-02 | `lead_id` referencia a tabela `leads` já existente — aproveitar para linkar ao CRM |

## Stories

_A detalhar pelo Codex._
