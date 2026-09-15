# Checkpoint — Etapa 1: pagamentos e sorteios (Prospecta)

**Data:** 15/09/2026
**Branch:** `codex/auditoria-correcao-20260914`
**Status:** Código corrigido, testado e com gates aprovados. Migração **NÃO aplicada em
produção** — bloqueada por limite de branches do Neon (ver seção de bloqueios).

## Achados confirmados (verificados diretamente no código, não apenas aceitos do handoff)

1. **`tickets.confirmPayment` — vulnerabilidade crítica de fraude, ativa em produção.**
   Endpoint tRPC (`protectedProcedure`) que qualquer usuário autenticado podia chamar
   passando apenas um `ticketId`, marcando o próprio bilhete como pago **sem qualquer
   pagamento real**. A tela `ComprarBilhete.tsx` tinha um botão em produção com o texto
   literal "Já Paguei - Confirmar Pagamento" e a legenda "Simulação: Clique acima para
   confirmar o pagamento (em produção, seria automático via webhook)". Isto é mais grave
   do que qualquer item listado no handoff original — é um caminho direto e trivial para
   obter bilhetes/UTEF de graça. **Removido nesta entrega** (ver "Correções").
2. **Zero idempotência no webhook Asaas.** Reentrega do mesmo evento (`payment.id`)
   creditava UTEF ou confirmava bilhetes de novo, sem nenhuma guarda. Confirmado por
   leitura direta de `processUtefPurchase`/`processTicketPurchase` (código anterior).
3. **Estorno era um TODO vazio.** `processPaymentRefunded` não fazia nada.
4. **Webhook Stripe legado ativo e divergente**, com seu próprio cálculo de bônus e
   confirmação de bilhete, apesar de nenhuma tela oferecer Stripe como opção de
   pagamento (confirmado por busca no frontend).
5. **Corrida em `createOrUpdateUtefBalance`** (read-then-write): usada tanto no crédito
   de UTEF quanto no débito de conversão de produtos (`utef.convert`) — duas chamadas
   concorrentes podiam gastar o mesmo saldo duas vezes.
6. **Falha crítica de probabilidade do sorteio.** `performDraw` selecionava o ganhador
   por `parseInt(lotteryResult.slice(-2)) % confirmedTickets.length` — uma linha por
   compra, independentemente de `quantity`. Quem compra 100 bilhetes tinha a mesma
   chance de quem compra 1.
7. **Regra pública ≠ algoritmo.** FAQ: "Os 5 últimos dígitos do 1º prêmio determinam o
   número vencedor. Se não houver bilhete correspondente, vence o bilhete com numeração
   imediatamente anterior." O código usava 2 dígitos e módulo sobre contagem de linhas —
   nem o espaço numérico, nem a regra de fallback, existiam.
8. **Token do webhook Asaas do banco era ignorado.** `payment_settings.asaasWebhookTokenEncrypted`
   existe no schema (configurável no painel) mas o handler só lia
   `process.env.ASAAS_WEBHOOK_TOKEN`.
9. **Bônus UTEF (10% ≥1000) não aparecia na criação do pedido** — só era calculado no
   momento do crédito (webhook), então a prévia da compra não refletia o valor real.
10. **Liquidação não verificava se o sorteio ainda estava ativo** — um pagamento
    confirmado após o sorteio ser realizado ainda incrementaria `ticketsSold`.

## Correções implementadas

- **`drizzle/schema.ts`**: duas tabelas novas — `payment_orders` (ledger de idempotência,
  `provider_payment_id` único) e `ticket_numbers` (número individual 00000-99999 por
  unidade de `quantity`, único por sorteio). Nenhuma tabela existente alterada.
- **`shared/raffle.ts`** (funções puras, testáveis sem banco):
  `calculateUtefBonus`/`calculateUtefTotal` (única fonte de verdade do bônus, usada na
  criação do pedido E na liquidação); `computeDrawCapacity`; `assignTicketNumbers`
  (atribuição sequencial e determinística, proporcional a `quantity`);
  `extractLotteryTargetNumber` e `pickWinningNumber` (implementam exatamente a regra
  pública da FAQ: número exato ou o vendido imediatamente anterior, busca cíclica).
- **`server/db.ts`**: novas funções atômicas (single `UPDATE...WHERE...RETURNING`, sem
  read-then-write) — `reserveDrawCapacity` (guarda de concorrência de capacidade),
  `claimPendingPaymentOrder`/`demoteSettledOrderToReview`/`markPaymentOrderRefunded`
  (guarda de idempotência), `incrementUtefBalanceAtomic`, `decrementUtefBalanceAtomic`
  (débito condicional — corrige o double-spend em `utef.convert`).
  **Decisão de arquitetura registrada:** o driver `drizzle-orm/neon-http` usado neste
  projeto **não suporta `db.transaction()`** (`throw new Error("No transactions support
  in neon-http driver")`, confirmado em `node_modules`). Toda atomicidade aqui é feita
  via UPDATE condicional single-statement com `RETURNING`, nunca por transação
  multi-statement. Isso vale para qualquer trabalho futuro nesta base de código.
- **`server/payment-settlement.ts`** (novo): serviço único de liquidação. Reivindica o
  pedido atomicamente (`claimPendingPaymentOrder`) antes de qualquer efeito colateral —
  qualquer reentrega de webhook encontra o pedido já não-`pending` e não repete o
  efeito. Verifica status do sorteio antes de confirmar bilhete; se não está mais
  `active`, ou se a capacidade foi excedida, move o pedido para `review_required` em vez
  de aplicar o efeito. Nunca reverte saldo automaticamente em estorno pós-liquidação
  (decisão explícita — ver "Decisões não implementadas").
- **`server/asaas-webhook.ts`**: reescrito para delegar ao `payment-settlement.ts`.
  Token do webhook agora lê `ASAAS_WEBHOOK_TOKEN` (env, precedência) com fallback para
  `payment_settings.asaasWebhookTokenEncrypted` (banco, descriptografado); falha fechado
  (401) se nenhuma das duas fontes existir.
- **`server/_core/stripeWebhook.ts`**: processamento desabilitado explicitamente
  (retorna 410, loga a tentativa, nunca muda dados) em vez de migrado — Stripe não é
  oferecido em nenhuma tela, então manter um segundo pipeline financeiro completo não
  se justificava.
- **`server/routers.ts`**:
  `tickets.purchase`/`utef.purchase` agora criam um `payment_orders` na hora da
  cobrança; `utef.purchase` retorna `bonus`/`totalUtef` calculados pela mesma função
  usada na liquidação; `performDraw` usa `ticket_numbers` + a regra pública real;
  `utef.convert` usa o débito atômico condicional; **`tickets.confirmPayment` removido**,
  substituído por `tickets.getStatus` (query somente leitura, com verificação de
  propriedade do bilhete).
- **`client/src/pages/ComprarBilhete.tsx`**: botão de simulação removido; a tela agora
  faz polling real do status (`tickets.getStatus`, a cada 5s) e só mostra "confirmado"
  quando o webhook real confirmou.

## Decisões não implementadas (registradas, não inventadas)

- **Reembolso parcial/chargeback após liquidação**: por regra do próprio handoff
  ("nenhuma alteração automática de saldo enquanto a regra não estiver definida"),
  qualquer estorno recebido depois que o crédito/confirmação já foi aplicado move o
  pedido para `review_required` com o motivo registrado, e **não reverte saldo nem
  bilhete automaticamente**. Isso precisa de uma tela/fila administrativa de
  conciliação manual, que não existe ainda — pendência explícita, não risco aceito
  silenciosamente.
- **Migração de KDF de senha, rate limiting, sessionVersion**: pertencem à Etapa 2.

## Gates (evidência)

- `npx tsc --noEmit`: **zero erros**.
- `npx vitest run`: **52 arquivos, 373 testes aprovados** (29 novos: 18 em
  `server/raffle.test.ts`, 11 em `server/payment-settlement.test.ts`).
- `npm run build` (Vite + esbuild do servidor): aprovado. Alerta de bundle >500KB é
  pré-existente (não relacionado a esta entrega).
- `git diff --check`: aprovado, sem erros de espaço em branco.
- `npx drizzle-kit generate`: migração `0016_etapa1_payment_integrity.sql` gerada pela
  ferramenta oficial (não escrita à mão) — confirmado que **só cria as duas tabelas
  novas**, nenhuma tabela existente é alterada ou recriada.

## Bloqueio registrado (não contornado)

**Validação da migração em branch isolada do Neon: bloqueada.** O projeto
`plain-cake-26372935` (SiteProspecta) atingiu o limite de branches da conta
(`branches limit exceeded` em `create_branch` e em `prepare_database_migration`, que
também precisa criar uma branch temporária internamente). As únicas duas ferramentas
que resolveriam isso — apagar uma branch antiga (`delete_branch`) ou resetar uma branch
existente a partir do parent (`reset_from_parent`) — **exigem confirmação humana
explícita por regra da própria ferramenta** ("NEVER run autonomously; always ask the
user first"). Não contornei essa regra.

Branches existentes no projeto (via `list_branches`):
- `br-morning-moon-anmimcag` ("etapa-3-migration-0014-validation") — sobra de uma
  validação anterior (Etapa 3/migration 0014), estado `ready`, mas parada em um LSN de
  11/09 (pode estar sem as migrações posteriores, como a 0015 da Etapa 4).
- 4 branches em estado `archived`, sem compute ativo, de previews antigos e já mortos:
  `br-dry-cake-an1w68b6`, `br-little-fog-anb8ydxw`, `br-holy-river-anhrbchq`,
  `br-delicate-night-any05xcv`.

**Decisão pendente do dono do produto:** apagar uma das branches arquivadas (para abrir
espaço e criar uma branch nova e limpa para validar a migração 0016), ou autorizar reset
de `br-morning-moon-anmimcag` a partir do HEAD atual de produção para reutilizá-la. Até
essa decisão, a migração 0016 **não foi aplicada em nenhum ambiente**, nem de teste nem
de produção — apenas gerada e revisada localmente.

## Situação após esta entrega

- Código da Etapa 1 (Prospecta: pagamentos + sorteios) está completo, testado e
  buildado, mas **não mesclado, não implantado, e a migração não foi validada em banco
  real**. Nada aqui deve ser tratado como "publicado" ou "100% operacional".
- Etapa 2 (Grupo Santa Fé continua sem alteração equivalente nesta rodada — não há
  módulo de sorteios no Santa Fé, então não há nada a portar aqui) e demais etapas do
  handoff seguem pendentes.
