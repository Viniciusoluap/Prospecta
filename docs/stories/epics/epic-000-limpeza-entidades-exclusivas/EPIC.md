# EPIC-000: Limpeza de entidades exclusivas do Prospecta sem equivalente no Grupo Santa Fé

**Epic Owner:** Claude
**Status:** In Progress

## Problem Statement

O Prospecta tem quatro entidades de negócio que não existem no Grupo Santa Fé (fonte da verdade) e que o dono do produto decidiu que não devem existir: `contractors` (empreiteiros), `investors`/`investorTransactions` (investidores), `lots` (lotes/loteamento) e `partnerDistributions` (distribuição entre sócios). Antes de portar os módulos que faltam, o Prospecta precisa parar de divergir nesses pontos.

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Remover o router tRPC `contractors` e as páginas/rotas admin de empreiteiros |
| FR-02 | Remover o router tRPC `investors` e as páginas/rotas admin de investidores |
| FR-03 | Remover o router tRPC `lots` e as páginas/rotas admin de lotes |
| FR-04 | Remover o router tRPC `partnerDistributions` e qualquer UI relacionada |
| FR-05 | Remover as tabelas correspondentes do schema Drizzle e gerar migration de DROP |
| FR-06 | Remover colunas órfãs que só existiam para referenciar essas tabelas (`constructionProjects.contractorId`, `obraMeasurements.contractorId`) |
| FR-07 | Sistema deve continuar funcionando (typecheck limpo, sem rotas quebradas) após a remoção |

## Constraints

| ID | Constraint |
|----|------------|
| CON-01 | Banco continua no Neon — migration é aplicada via Drizzle, não trocamos de provedor |
| CON-02 | Não remover `brokerCommissions` (corretores) — isso tem equivalente no Santa Fé (`Corretor`/`Comissao`) e fica |
| CON-03 | Não confundir o campo `hasLot` do formulário público de orçamento (`budgetRequests`) com a tabela `lots` — são conceitos diferentes, `hasLot` fica |
| CON-04 | `constructionProjects.investorProfit` e `constructionProjects.prospectaProfit` são apenas colunas decimais (não FK) — mantidas por ora; remoção de `investorProfit` fica registrada como item em aberto, não decidida neste épico |
| CON-05 | Aplicar a migration de DROP contra o banco de produção exige confirmação explícita do usuário antes de rodar — é uma ação destrutiva e difícil de reverter |

## Stories

| Story | Title | Status |
|-------|-------|--------|
| S-01 | Remover contractors | In Progress |
| S-02 | Remover investors | In Progress |
| S-03 | Remover lots | In Progress |
| S-04 | Remover partnerDistributions | In Progress |
| S-05 | Migration Drizzle + validação | Pending |
