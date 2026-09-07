# EPIC-009: Alinhamento de Papéis de Usuário

**Epic Owner:** Claude
**Status:** Done (S-01, S-02, S-03)
**Prioridade:** Foundational — bloqueia EPIC-001, EPIC-002, EPIC-004

## Problem Statement

O Prospecta hoje só tem dois papéis (`admin`/`user`, enum `user_role` na tabela `users`). O Grupo Santa Fé usa quatro (`admin | corretor | colaborador | cliente`, com RBAC em `src/lib/auth/rbac.ts`: `hasRole`, `requirePageRole`, `requireActionRole`). O dono do produto confirmou que isso precisa ser alinhado — é pré-requisito pro Portal do Cliente (EPIC-002) e para as demais telas admin diferenciarem corretor/colaborador.

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Estender o enum de papel do Prospecta para `admin \| corretor \| colaborador \| cliente`, mantendo compatibilidade com o login atual (usuários existentes com role `user` migram para `cliente` por padrão, `admin` continua `admin`) |
| FR-02 | Helper de RBAC equivalente ao do Santa Fé (`hasRole`, guarda de rota/procedure por papel) reutilizável nos routers tRPC e nas rotas protegidas do client |
| FR-03 | Nenhuma tela/fluxo existente pode quebrar — `AdminRoute`/`ProtectedRoute` atuais continuam funcionando durante a transição |

## Constraints

| ID | Constraint |
|----|------------|
| CON-01 | Migration é apenas ALTER TYPE (adicionar valores ao enum) + UPDATE de dados existentes — não é destrutivo, mas precisa rodar contra produção (Neon, projeto SiteProspecta) com cuidado |
| CON-02 | Não remover o papel `admin`/`user` atual sem antes migrar todos os usuários existentes |

## Stories

| Story | Title | Status |
|-------|-------|--------|
| S-01 | Estender enum de papel + migração de dados existentes | Done |
| S-02 | Correções de review externo (Codex bot) na S-01 | Done |
| S-03 | Helper de RBAC reutilizável (`hasRole`/`requireRole`) | Done |
