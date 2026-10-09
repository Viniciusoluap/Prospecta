# Story S-06 — Corretor: Imóveis

**Epic:** EPIC-016  
**Status:** Draft  
**Executor previsto:** @dev + @data-engineer  
**Quality gate:** @qa-security

## Objetivo

Criar portal do corretor com acesso ao catálogo completo e cadastro de novo imóvel, preservando a
governança de publicação e a autoria.

## Acceptance Criteria

- [ ] AC-01: somente conta `corretor` ativa acessa o portal
- [ ] AC-02: corretor vê o catálogo completo permitido
- [ ] AC-03: corretor cadastra imóvel com autoria derivada da sessão
- [ ] AC-04: imóvel novo entra em revisão antes da publicação pública
- [ ] AC-05: corretor não edita/exclui imóvel de terceiro nem campos administrativos
- [ ] AC-06: upload de imagens segue as mesmas validações seguras do catálogo
- [ ] AC-07: Admin Imóveis mantém revisão, edição, publicação e exclusão

## Tasks

- [ ] mapear campos permitidos no cadastro externo
- [ ] adicionar autoria/estado de revisão se necessário
- [ ] criar procedures do portal do corretor
- [ ] criar interface catálogo/cadastro
- [ ] testar autoria, revisão e acesso cruzado

## Dependência

S-01.

