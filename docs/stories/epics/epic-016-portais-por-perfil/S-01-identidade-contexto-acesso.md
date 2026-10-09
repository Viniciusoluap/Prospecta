# Story S-01 — Identidade e contexto de acesso

**Epic:** EPIC-016  
**Status:** In Progress  
**Executor previsto:** @dev + @data-engineer  
**Quality gate:** @qa-security

## Objetivo

Criar uma fonte única e segura para transformar a sessão autenticada em contexto de cliente,
corretor ou administrador, sem permitir elevação de papel pela interface.

## Acceptance Criteria

- [ ] AC-01: contexto cliente exige conta ativa, papel `cliente` e `lead_id` persistido
- [ ] AC-02: contexto corretor exige conta ativa, papel `corretor` e perfil válido
- [ ] AC-03: e-mail é normalizado no provisionamento, mas consultas usam FK/ID da sessão
- [ ] AC-04: duplicidade ou colisão impede vínculo automático e gera pendência acionável
- [ ] AC-05: parâmetro de perfil do login não altera papel nem permissões
- [ ] AC-06: auditoria cobre provisionamento, alteração de vínculo e bloqueios relevantes
- [ ] AC-07: testes cruzados usam pelo menos dois clientes e dois corretores

## Tasks

- [ ] inventariar vínculos e duplicidades
- [ ] implementar resolvedores de contexto reutilizáveis
- [ ] desenhar/aplicar migrations aditivas aprovadas
- [ ] criar backfill com dry-run e idempotência
- [ ] adicionar testes unitários e de integração

## Dependências

EPIC-002 e EPIC-009.

