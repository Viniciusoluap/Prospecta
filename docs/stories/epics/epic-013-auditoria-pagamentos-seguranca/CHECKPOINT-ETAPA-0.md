# Checkpoint — Etapa 0: recuperação e checkpoint WIP

**Data:** 15/09/2026
**Branch:** `codex/auditoria-correcao-20260914` (criada a partir de `origin/main` — sem merge)
**Escopo:** handoff de auditoria integral Prospecta ↔ Grupo Santa Fé (pagamentos, sorteios, RBAC,
sessões, webhooks), recebido de outra sessão (GPT/Codex).

## Resultado da recuperação de workspace

O handoff referenciava um workspace local em `/workspace/scratch/52ab5092b27f/Prospecta` com
alterações não commitadas (novo `server/_core/app.ts`, `server/payment-settlement.ts`,
`drizzle/0016_payment_integrity.sql`, etc.) e uma branch `codex/auditoria-correcao-20260914` com
base em `268d241`.

**Verificado nesta sessão:**

- `/workspace/scratch/52ab5092b27f/` **não existe** neste ambiente — não há nada para recuperar.
- Nenhuma branch `codex/auditoria-correcao-20260914` existe em `origin` (Prospecta).
- Nenhum dos arquivos citados como "já implementados parcialmente" existe no repositório:
  `payment_orders` não está em `drizzle/schema.ts`; `server/payment-settlement.ts`,
  `server/_core/app.ts`, `drizzle/0016_payment_integrity.sql` não existem.
- O `main` atual já está **adiante** da base citada no handoff (`268d241`) — já inclui C1
  (relatórios de comissões unificados, PR #51/#52) e C2 (navegação, PR #49/#50), concluídos em
  rodada anterior desta mesma sessão.

**Conclusão:** não há WIP a recuperar. Toda a implementação descrita nas Etapas 1–5 do handoff
será construída do zero, a partir do `main` atual (que já é superset da base informada),
seguindo a contingência prevista no próprio handoff ("se os arquivos locais não estiverem
disponíveis... parta das bases informadas... não procure essas mudanças na PR #7").

## Verificação pontual de severidade (spot-check antes de priorizar)

Antes de aceitar a lista de bloqueadores do handoff como verdade, foi feita uma verificação
direta no código do item classificado como mais grave (falha de probabilidade do sorteio):

- `server/routers.ts:207-254` (`performDraw`): o ganhador é selecionado por
  `winnerIndex = parseInt(input.lotteryResult.slice(-2)) % confirmedTickets.length` — uma
  seleção uniforme entre **linhas** de bilhete.
- `server/routers.ts:264-326` (`tickets.purchase`): uma compra com `quantity=N` cria **uma única
  linha** com um único `ticketNumber`, independentemente de N.

**Confirmado:** quem compra 100 bilhetes tem exatamente a mesma probabilidade de ganhar que quem
compra 1. A claim do handoff é real e grave (risco de fraude/reclamação de consumidor/questão
legal). Também confirmado que o algoritmo usa 2 dígitos (`.slice(-2)`) e módulo direto, sem busca
de número anterior — divergente de qualquer regra pública de 5 dígitos da Loteria Federal.

Os demais itens do handoff (pagamentos, RBAC, sessões, webhooks) serão verificados
individualmente no início de cada etapa correspondente, antes de qualquer correção — nenhuma
claim do handoff será aceita sem confirmação direta no código.

## Próximo passo

Etapa 1 (Prospecta): pagamentos e sorteios — maior risco financeiro/fraude, tratada primeiro
conforme a ordem obrigatória do plano.
