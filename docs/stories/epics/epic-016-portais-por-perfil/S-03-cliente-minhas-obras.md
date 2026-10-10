# Story S-03 — Cliente: Minhas Obras

**Epic:** EPIC-016  
**Status:** Draft  
**Executor previsto:** @dev  
**Quality gate:** @qa-security

## Objetivo

Permitir que o cliente acompanhe exclusivamente obras vinculadas ao próprio lead, sem reproduzir
o painel administrativo e sem ações de gestão.

## Acceptance Criteria

- [ ] AC-01: obras são filtradas no servidor por `lead_id` da sessão
- [ ] AC-02: a aba aparece somente quando houver obra vinculada
- [ ] AC-03: lista/detalhe expõem apenas campos públicos aprovados
- [ ] AC-04: etapas, fotos e arquivos respeitam marcação de visibilidade
- [ ] AC-05: cliente não cria, edita, exclui, conclui ou muda progresso/status
- [ ] AC-06: IDs de outra obra retornam `NOT_FOUND`/`FORBIDDEN` sem vazar metadados
- [ ] AC-07: a rota antiga `/obras` redireciona ao portal do cliente
- [ ] AC-08: Admin Obras permanece completo e sem regressão

## Tasks

- [ ] definir DTO/projeção pública
- [ ] criar procedures cliente list/detail
- [ ] incorporar a experiência ao Portal existente
- [ ] remover do cliente botões e mutations de gestão
- [ ] testar dois clientes com múltiplas obras

## Dependência

S-01.

