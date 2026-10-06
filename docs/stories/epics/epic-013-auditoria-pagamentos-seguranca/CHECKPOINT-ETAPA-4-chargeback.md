# Checkpoint — Reversão automática em chargeback (Passo 4)

## Contexto

A PR #53 (Etapa 1) já tinha deixado o terreno preparado: `payment_order_status`
já incluía o valor `"chargeback"` no enum, e o comentário em
`refundPaymentOrder` dizia explicitamente que "a regra de negócio para reversão
parcial/chargeback ainda não foi definida pelo dono do produto" — ficava tudo em
`review_required` (conciliação manual).

O dono do produto definiu a regra: **em chargeback, a reversão é sempre
automática** — cancela o bilhete e desconta o saldo UTEF integralmente, mesmo
que o saldo fique negativo, e independente de o sorteio já ter sido realizado.
Isso é diferente de um estorno voluntário (`PAYMENT_REFUNDED`), que continua
indo para conciliação manual quando já liquidado — chargeback é uma perda
financeira já consumada (o adquirente já tomou o dinheiro de volta), não uma
decisão a aguardar.

## Lacuna adicional encontrada

O webhook (`server/asaas-webhook.ts`) só tratava `PAYMENT_REFUNDED`. Os
eventos reais de chargeback do Asaas (`PAYMENT_CHARGEBACK_REQUESTED`,
`PAYMENT_CHARGEBACK_DISPUTE`, `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` — ver
https://docs.asaas.com/docs/payment-events) caíam no `else` e eram
silenciosamente ignorados. Ou seja: um chargeback de verdade não acionava
nenhuma lógica, nem a de conciliação manual que já existia para estorno.

`PAYMENT_CHARGEBACK_REQUESTED` ("chargeback recebido") é o evento certo para
reverter — é quando o adquirente já retirou o valor do lojista.
`PAYMENT_CHARGEBACK_DISPUTE` é só a fase de contestação (nada mudou ainda) e
`PAYMENT_AWAITING_CHARGEBACK_REVERSAL` é o lojista *ganhando* a disputa (fluxo
inverso, de devolução do dinheiro) — nenhum dos dois está no escopo deste
checkpoint.

## Solução

- `drizzle/schema.ts`: `ticket_payment_status` ganha `"chargeback"`;
  `utef_transaction_type` ganha `"chargeback"` (migration aditiva
  `0019_etapa4_chargeback_reversao.sql`, só `ALTER TYPE ... ADD VALUE`).
- `server/db.ts`: `markPaymentOrderChargeback`,
  `claimSettledPaymentOrderForChargeback` (guarda de idempotência, mesmo
  padrão de `claimPendingPaymentOrder`), `releaseDrawCapacity` (reverso de
  `reserveDrawCapacity`) e `deleteTicketNumbersByTicketId`.
- `server/payment-settlement.ts`: nova `chargebackPaymentOrder`:
  - **compra de UTEF**: debita principal+bônus via `incrementUtefBalanceAtomic`
    (sem piso — pode ficar negativo), registra transação `type: "chargeback"`.
  - **compra de bilhete**: apaga os números individuais atribuídos ao bilhete
    (senão continuariam elegíveis ao sorteio mesmo com o pagamento revertido —
    `getTicketNumbersByDrawId` não filtra por status de pagamento), devolve a
    capacidade reservada do sorteio (`ticketsSold`/`currentAmount`), e marca o
    bilhete como `"chargeback"`.
  - Dado inconsistente (pedido de bilhete sem `drawId`/`ticketId`) continua
    indo para `review_required`, igual ao resto da liquidação.
- `server/asaas-webhook.ts`: passa a tratar `PAYMENT_CHARGEBACK_REQUESTED`
  chamando `chargebackPaymentOrder`.

## Por que apagar os números e não só marcar o bilhete

Sem isso, o bilhete cancelado continuaria contando pra sorte de quem pagou com
cartão clonado/contestado, e a próxima venda real colidiria com a constraint
de unicidade `(draw_id, number)` ao tentar reatribuir o mesmo intervalo
liberado. Não é escopo extra — é o mínimo pra "cancela o bilhete" ter efeito
real.

## Gates executados

- `npx tsc --noEmit` — limpo.
- `npx vitest run` — 53 arquivos, 387/387 testes (6 novos para
  `chargebackPaymentOrder`).
- `npm run build` — passa (aviso de bundle size pré-existente).
- `git diff --check` — limpo.
- Migration validada e aplicada em produção (Neon `plain-cake-26372935`) —
  confirmada via `pg_enum`.

## Fora do escopo (registrado, não implementado)

- Reversão da reversão quando o lojista *ganha* a disputa
  (`PAYMENT_AWAITING_CHARGEBACK_REVERSAL`) — recreditar UTEF/reativar bilhete.
  Não foi pedido; precisaria de uma decisão própria do dono do produto sobre
  como tratar um bilhete que talvez já tenha sido sorteado nesse meio-tempo.
