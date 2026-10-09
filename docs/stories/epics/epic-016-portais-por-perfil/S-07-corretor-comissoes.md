# Story S-07 — Corretor: Minhas Comissões

**Epic:** EPIC-016  
**Status:** Draft  
**Executor previsto:** @dev + @data-engineer  
**Quality gate:** @qa-security

## Objetivo

Permitir que o corretor acompanhe somente comissões vinculadas ao próprio usuário, em modo de
consulta, sem acesso ao painel global de comissões.

## Acceptance Criteria

- [ ] AC-01: comissões novas são filtradas por `broker_id=session.userId`
- [ ] AC-02: corretor não informa `broker_id` no payload para definir escopo
- [ ] AC-03: portal é somente leitura
- [ ] AC-04: totais, parcelas, vencimentos e pagamentos refletem apenas o corretor autenticado
- [ ] AC-05: comissão de outro corretor não aparece por lista, detalhe, filtro ou URL direta
- [ ] AC-06: legado sem vínculo inequívoco fica fora do portal e entra em fila de conciliação
- [ ] AC-07: Admin Comissões permanece completo e sem regressão

## Tasks

- [ ] inventariar fontes nova e legada
- [ ] planejar backfill/mapeamento explícito do legado
- [ ] criar procedure `myCommissions`
- [ ] criar interface somente leitura
- [ ] testar dois corretores e registros sem vínculo

## Dependência

S-01.

