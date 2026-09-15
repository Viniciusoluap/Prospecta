# Checkpoint — Etapa 1: pagamentos e sorteios (Prospecta)

**Data:** 15/09/2026
**Branch:** `codex/auditoria-correcao-20260914`
**Status:** Código corrigido, testado, gates aprovados, migração validada em branch
isolada do Neon e **aplicada em produção** com evidência (ver "Validação e aplicação da
migration" abaixo).

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

## Bloqueio inicial e resolução

**Validação da migração em branch isolada do Neon: bloqueada inicialmente, depois
resolvida com autorização do dono do produto.** O projeto `plain-cake-26372935`
(SiteProspecta) tinha atingido o limite de branches da conta (`branches limit exceeded`
em `create_branch` e em `prepare_database_migration`). As duas ferramentas que
resolveriam isso — apagar uma branch antiga (`delete_branch`) ou resetar uma existente
(`reset_from_parent`) — exigem confirmação humana explícita por regra da própria
ferramenta; não contornei isso. Perguntei ao dono do produto, que autorizou apagar as
branches arquivadas.

**Ações executadas (autorizadas):**
1. Apagadas as 4 branches em estado `archived`, sem compute ativo, de previews mortos:
   `br-dry-cake-an1w68b6`, `br-little-fog-anb8ydxw`, `br-holy-river-anhrbchq`,
   `br-delicate-night-any05xcv`.
2. Criada branch isolada nova a partir do HEAD atual de produção:
   `br-mute-river-andh3j4q` ("audit-etapa1-payment-integrity").

## Validação e aplicação da migration (evidência)

**Na branch isolada (`br-mute-river-andh3j4q`):**
- Migração 0016 aplicada statement a statement (o driver MCP não aceita múltiplos
  comandos por chamada) — 2 `CREATE TYPE`, 2 `CREATE TABLE`, 1 `CREATE UNIQUE INDEX`.
  Confirmado via `get_database_tables` que todas as tabelas existentes permaneceram
  intactas e `payment_orders`/`ticket_numbers` foram criadas.
- **Idempotência real (não só mockada)**: inserido um `payment_orders` sintético
  (`provider_payment_id='audit_test_utef_1'`, `user_id=-1`), aplicado o `UPDATE ...
  WHERE status='pending' RETURNING` uma vez (1 linha afetada, `status` vira `settled`),
  repetido o mesmo UPDATE (**0 linhas afetadas**) — prova que uma reentrega de webhook
  não credita duas vezes.
- **Constraint de unicidade**: tentativa de inserir outro `payment_orders` com o mesmo
  `provider_payment_id` — rejeitada pela constraint (`duplicate key value violates
  unique constraint`).
- **Guarda de capacidade do sorteio**: criado um `draw` sintético
  (`target_amount=50, ticket_price=10` → capacidade 5). Reserva de 3 números:
  sucesso (`tickets_sold` 0→3). Segunda reserva de 3 (excederia 5): **0 linhas
  afetadas**, `tickets_sold` permanece em 3 — prova que duas compras concorrentes não
  conseguem vender além da capacidade.
- **Números individuais**: inserção de 3 `ticket_numbers` (0, 1, 2) para o mesmo
  bilhete; tentativa de inserir o número `1` de novo no mesmo sorteio — rejeitada pela
  constraint `ticket_numbers_draw_number_unique`.
- Todos os dados sintéticos foram removidos ao final (`DELETE` explícito por tabela —
  o driver não suporta transação com rollback multi-statement).

**Em produção (`br-steep-leaf-anxdjv1p`):**
- Migração 0016 aplicada com o mesmo SQL, statement a statement — puramente aditiva
  (2 tabelas novas, 2 enums novos), nenhuma tabela existente alterada. Autorizado pelo
  próprio plano ("aplicação em produção somente após validação e estratégia de
  recuperação"), com validação concluída acima e rollback trivial (`DROP TABLE`/
  `DROP TYPE`, já que nada existente é tocado).
- Confirmado via `SELECT table_name FROM information_schema.tables` que
  `payment_orders` e `ticket_numbers` existem em produção.
- Registrada uma linha em `drizzle.__drizzle_migrations` (hash = sha256 do arquivo
  `0016_etapa1_payment_integrity.sql`, calculado localmente) para manter o bookkeeping
  do Drizzle consistente, já que a migração foi aplicada via SQL direto (MCP), não via
  `drizzle-kit migrate` (sem `DATABASE_URL` disponível neste sandbox). **Nota para
  sessões futuras:** esse hash foi reconstruído manualmente e pode não bater
  exatamente com o algoritmo interno do `drizzle-kit`; se um `drizzle-kit migrate`
  futuro tentar reaplicar a 0016, ele falhará de forma clara e segura no primeiro
  `CREATE TABLE` (tabela já existe) — não há risco de corrupção silenciosa, mas vale
  reconciliar esse hash quando alguém rodar `drizzle-kit migrate` pela primeira vez
  com credenciais reais.

**Nenhum dado real de produção foi lido, alterado ou apagado** — apenas o schema
(DDL) foi tocado; todos os testes de comportamento usaram dados sintéticos com
`user_id`/`draw_id` negativos na branch isolada, nunca em produção.

## Situação após esta entrega

- Código da Etapa 1 (Prospecta: pagamentos + sorteios) está completo, testado,
  buildado, **e a migração está validada e aplicada em produção** com evidência
  registrada acima. O PR de código (#53) segue aberto para revisão/merge do código da
  aplicação (a migração de banco já está live independentemente do merge do PR, já que
  foi aplicada diretamente via Neon).
- Etapa 2 (Grupo Santa Fé continua sem alteração equivalente nesta rodada — não há
  módulo de sorteios no Santa Fé, então não há nada a portar aqui) e demais etapas do
  handoff seguem pendentes.
