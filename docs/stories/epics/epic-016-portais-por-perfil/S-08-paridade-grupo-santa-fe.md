# Story S-08 — Paridade no Grupo Santa Fé

**Epic:** EPIC-016  
**Status:** Draft  
**Executor previsto:** @dev nas duas stacks  
**Quality gate:** @qa

## Objetivo

Reproduzir no Grupo Santa Fé as mesmas regras de Cliente e Corretor, respeitando Next.js/Prisma,
banco separado e as exceções exclusivas da Prospecta.

## Acceptance Criteria

- [ ] AC-01: Santa Fé possui entradas e guardas equivalentes por perfil
- [ ] AC-02: Minhas Obras e Meu Financiamento têm a mesma whitelist e isolamento
- [ ] AC-03: Imóveis e Minhas Comissões do corretor têm a mesma regra de autoria/escopo
- [ ] AC-04: uploads possuem as mesmas validações e auditoria
- [ ] AC-05: Bilhetes, UTEF e Conversões não são criados no Santa Fé
- [ ] AC-06: matriz de paridade documenta equivalências e diferenças deliberadas
- [ ] AC-07: nenhum dado é transferido entre os bancos

## Tasks

- [ ] mapear modelos/rotas equivalentes no Santa Fé
- [ ] adaptar schema e server actions
- [ ] implementar interfaces equivalentes
- [ ] repetir testes de isolamento
- [ ] assinar matriz de paridade

## Dependências

S-01, S-02, S-03, S-04, S-06 e S-07 estabilizadas na Prospecta.

