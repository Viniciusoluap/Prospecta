# Story S-05 — Cliente: ecossistema Prospecta

**Epic:** EPIC-016  
**Status:** Draft  
**Executor previsto:** @dev  
**Quality gate:** @qa

## Objetivo

Mover Meus Bilhetes, Meu Saldo UTEF e Minhas Conversões para dentro do Portal do Cliente sem
alterar saldos, histórico ou regras transacionais.

## Acceptance Criteria

- [ ] AC-01: as três funções aparecem na navegação interna do cliente
- [ ] AC-02: consultas continuam filtradas exclusivamente por `user_id` da sessão
- [ ] AC-03: nenhuma contagem, saldo ou conversão muda durante a reorganização
- [ ] AC-04: URLs antigas redirecionam para a aba correspondente
- [ ] AC-05: as funções não são adicionadas ao Grupo Santa Fé
- [ ] AC-06: estados vazio, erro e carregamento são preservados

## Tasks

- [ ] reutilizar componentes/queries existentes no shell do Portal
- [ ] ajustar rotas e redirects
- [ ] comparar contagens antes/depois
- [ ] testar mobile e sessão expirada

## Dependências

S-01 e S-02.

