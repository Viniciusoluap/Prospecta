# EPIC-018: Corretores & Comissões — vínculos reais

**Owner:** Claude / AIOX
**Status:** InReview — branch `claude/prospecta-epic-017-018-vinculos-reais` (11/10/2026)
**Dependências:** EPIC-012 (comissões unificadas), EPIC-017 (migration 0031)

## Objetivo
Comissões deixam de ter texto livre: corretor, imóvel e obra vêm dos cadastros reais, e o valor é
sugerido pelo percentual de referência sobre o valor cadastrado.

## Stories

| ID | Título | Status |
|---|---|---|
| 2.1 | Cadastro de corretor sem foto e especialidades | InReview |
| 2.2 | Nova comissão: corretor dos cadastros reais | InReview |
| 2.3 | Nova comissão: imóvel pré-cadastrado (sem texto livre) | InReview |
| 2.4 | Nova comissão: valor calculado pelo percentual | InReview |
| 2.5 | Tipo "construção" vira "Obra" com seletor de obra | InReview |

## Dados
Migration `0031`: `operational_commissions.property_id` (→ `imoveis`),
`operational_commissions.construction_project_id` (→ `construction_projects`) e
`UPDATE business_type 'construcao' → 'obra'`. A coluna `property` continua guardando o título no
momento do cadastro (e o texto dos registros antigos).

## Paridade Grupo Santa Fé
Pendente: portar as mesmas regras para o Santa Fé (ver ROADMAP).
