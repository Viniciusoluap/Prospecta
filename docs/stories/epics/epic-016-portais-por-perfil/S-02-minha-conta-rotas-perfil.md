# Story S-02 — Minha Conta e rotas por perfil

**Epic:** EPIC-016  
**Status:** Draft  
**Executor previsto:** @dev  
**Quality gate:** @qa

## Objetivo

Concentrar as entradas de Cliente, Corretor e Admin em “Minha Conta” e remover atalhos globais que
pertencem ao portal autenticado.

## Acceptance Criteria

- [ ] AC-01: Obras, Bilhetes, Saldo e Conversões não aparecem na navegação global
- [ ] AC-02: existem entradas explícitas de Login Cliente e Login Corretor
- [ ] AC-03: Painel Admin aparece somente para administrador autorizado
- [ ] AC-04: Sair aparece somente com sessão ativa e encerra a sessão
- [ ] AC-05: pós-login respeita o papel real e leva ao portal correto
- [ ] AC-06: perfil incompatível mostra erro sem conceder acesso
- [ ] AC-07: URLs antigas redirecionam sem contornar RBAC
- [ ] AC-08: desktop e menu móvel possuem a mesma regra

## Tasks

- [ ] definir mapa final de rotas
- [ ] ajustar Minha Conta desktop/mobile
- [ ] criar guardas de portal por perfil
- [ ] criar redirects de compatibilidade
- [ ] testar navegação, refresh e deep link

## Dependência

S-01.

