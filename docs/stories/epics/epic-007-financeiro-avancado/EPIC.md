# EPIC-007: Financeiro Avançado

**Epic Owner:** originalmente Codex, assumido pela trilha Claude em 07/09/2026 (Codex ainda não havia iniciado)
**Status:** Draft — detalhamento de escopo, aguardando confirmação do dono do produto antes de implementar

## Problem Statement

O Grupo Santa Fé tem três módulos financeiros que o Prospecta ainda não replica por completo:

1. **Contabilidade** (`/admin/contabilidade`) — livro-razão de receitas/despesas gerais da empresa (`Lancamento`), com status (pendente/pago/cancelado), vencimento, forma de pagamento, fornecedor, competência.
2. **BPO** (`/admin/bpo`) — gestão de clientes de terceirização contábil (`BpoCliente`/`BpoLancamento`): cobranças de honorários, despesas, DRE simplificado, relatórios.
3. **Integração bancária via Pluggy** (`/admin/bpo` aba "Bancos") — sincronização de contas e transações bancárias reais via Open Finance (`ContaBancaria`/`TransacaoBancaria`), com fallback gracioso quando as credenciais Pluggy não estão configuradas.

**Achado ao pesquisar o código-fonte:** o Prospecta **já tem** uma tabela `financial_transactions` + router (`financialTransactions.list`/`create`) + página `AdminFinanceiro.tsx` (220 linhas) — mas é uma versão simples, sem `status`/`vencimento`/`formaPagamento`/`fornecedor`/`competencia`, sem atualização de status, sem BPO, sem integração bancária. Não é do zero — é extensão do que já existe.

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-01 | Estender `financial_transactions` com os campos que faltam (status, vencimento, forma de pagamento, referência, competência, fornecedor) + mutation de atualização de status; UI de contas a pagar/receber |
| FR-02 | Schema + router + UI para clientes de BPO (cadastro, serviços contratados, honorários) e lançamentos (honorário/despesa/reembolso) vinculados a um cliente BPO ou a um lead |
| FR-03 | Schema + router + UI para contas bancárias e suas transações, com botão de sincronização manual via Pluggy quando configurado |
| FR-04 | Cliente Pluggy (`auth` + `transactions` + `accounts`) com fallback gracioso e mensagem clara quando `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` não estão configurados |
| FR-05 | DRE simplificado (receitas − despesas por competência) e relatórios agregados, iguais aos da origem |

## Constraints

| ID | Constraint |
|----|-------------|
| CON-01 | Credenciais Pluggy reais ficam por conta do dono do produto — adiantar schema/UI/lógica sem esperar a credencial (mesmo padrão já usado para Asaas no EPIC-007... na verdade decisão #2 do ROADMAP) |
| CON-02 | **Decisão pendente de confirmação**: armazenar `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` como env var (igual à origem) ou como credencial por-tela criptografada no banco (igual ao padrão já estabelecido no Prospecta para Asaas — `payment_settings` + `encryptSecret`)? Ver pergunta ao dono do produto. |
| CON-03 | Estender `financial_transactions` em vez de criar uma tabela paralela para não duplicar o que já existe |

## Stories (proposta, ainda não iniciadas)

| Story | Title | Escopo | Status |
|-------|-------|--------|--------|
| S-01 | Contabilidade — contas a pagar/receber | Estende `financial_transactions`, adiciona status/vencimento/forma de pagamento/fornecedor/competência, tela com filtros e atualização de status | Done |
| S-02 | BPO — clientes e lançamentos | Tabelas `bpo_clients`/`bpo_lancamentos`, router, tela com clientes/cobranças/despesas/DRE | Done |
| S-03 | Integração bancária (Pluggy) | Tabelas `bank_accounts`/`bank_transactions`, cliente Pluggy com fallback gracioso, tela de contas + sincronização manual | Draft |

_Ordem sugerida: S-01 → S-02 → S-03 (do mais simples/menos dependente de credencial externa para o mais dependente)._

## Perguntas para o dono do produto antes de implementar

1. **BPO faz sentido para o Prospecta?** No Santa Fé, BPO é terceirização contábil oferecida como serviço a clientes externos. Isso é um serviço real que a Prospecta oferece, ou é específico do Santa Fé e deveria ficar de fora do espelhamento (como a landing page/sorteios)?
2. **Pluggy real será configurado?** Se sim, quando — para eu saber se adianto só schema/UI (sem token real) ou se você já tem uma conta Pluggy de sandbox para testar de ponta a ponta.
3. **Onde guardar as credenciais Pluggy**: env var (Vercel) como na origem, ou tela própria com criptografia no banco (como já fizemos para o Asaas)?
