# Story S-04 — Cliente: Financiamento e documentos

**Epic:** EPIC-016  
**Status:** Draft  
**Executor previsto:** @dev + @data-engineer  
**Quality gate:** @qa-security

## Objetivo

Adicionar ao Portal do Cliente o acompanhamento somente leitura de financiamento ativo e o envio
de documentos exclusivamente quando solicitado.

## Acceptance Criteria

- [ ] AC-01: financiamento é filtrado por `lead_id` da sessão e por status ativo
- [ ] AC-02: a aba só aparece com processo ativo
- [ ] AC-03: cliente vê etapa, progresso, próximos passos e pendências públicas
- [ ] AC-04: observações internas e controles administrativos não constam no payload
- [ ] AC-05: cliente não altera status, checklist, valores ou vínculos
- [ ] AC-06: upload exige solicitação aberta pertencente ao cliente e ao processo
- [ ] AC-07: arquivo é validado por MIME, assinatura e tamanho, com armazenamento privado e auditoria
- [ ] AC-08: Admin Financiamentos permanece completo e sem regressão

## Tasks

- [ ] definir DTO público e cálculo de progresso
- [ ] modelar solicitações/documentos
- [ ] implementar procedures somente leitura/upload controlado
- [ ] criar aba condicional no Portal
- [ ] testar abuso de IDs e arquivos inválidos

## Dependência

S-01.

