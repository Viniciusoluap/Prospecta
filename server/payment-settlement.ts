// Servico de liquidacao idempotente de pagamentos (Asaas). Substitui a logica ad-hoc
// que existia em server/asaas-webhook.ts, que nao tinha nenhuma protecao contra
// reentrega de webhook (double-credit) nem verificava se o sorteio ainda estava ativo.
//
// Contrato de idempotencia: cada pagamento (Asaas payment.id) tem exatamente UMA linha
// em payment_orders, criada na hora da cobranca (status='pending'). A liquidacao so
// aplica efeito (credito de UTEF, confirmacao de bilhete) na PRIMEIRA chamada que
// consegue mover o status de 'pending' para 'settled' via UPDATE...WHERE atomico
// (server/db.ts claimPendingPaymentOrder) - qualquer reentrega subsequente encontra o
// pedido em outro estado e nao repete o efeito.
import * as db from "./db.js";
import { calculateUtefBonus, assignTicketNumbers, computeDrawCapacity } from "../shared/raffle.js";
import type { PaymentOrder } from "../drizzle/schema.js";

export type SettlementResult =
  | { outcome: "order_not_found" }
  | { outcome: "already_processed" }
  | { outcome: "utef_credited"; userId: number; total: number; bonus: number }
  | { outcome: "ticket_confirmed"; ticketId: number; numbers: number[] }
  | { outcome: "review_required"; reason: string };

export async function settlePaymentOrder(providerPaymentId: string): Promise<SettlementResult> {
  const order = await db.getPaymentOrderByProviderId(providerPaymentId);
  if (!order) return { outcome: "order_not_found" };
  if (order.status !== "pending") return { outcome: "already_processed" };

  if (order.purpose === "utef_purchase") {
    return settleUtefOrder(providerPaymentId);
  }
  return settleTicketOrder(providerPaymentId);
}

async function settleUtefOrder(providerPaymentId: string): Promise<SettlementResult> {
  const claimed = await db.claimPendingPaymentOrder(providerPaymentId);
  if (!claimed) return { outcome: "already_processed" };

  const bonus = calculateUtefBonus(claimed.principalAmount);
  const total = claimed.principalAmount + bonus;

  await db.createUtefTransaction({
    userId: claimed.userId,
    amount: total,
    type: "purchase",
    description: bonus > 0
      ? `Compra de ${claimed.principalAmount} UTEFs + ${bonus} de bônus (10%)`
      : `Compra de ${claimed.principalAmount} UTEFs`,
    referenceId: claimed.providerPaymentId,
  });
  await db.incrementUtefBalanceAtomic(claimed.userId, total);

  return { outcome: "utef_credited", userId: claimed.userId, total, bonus };
}

async function settleTicketOrder(providerPaymentId: string): Promise<SettlementResult> {
  const claimed = await db.claimPendingPaymentOrder(providerPaymentId);
  if (!claimed) return { outcome: "already_processed" };

  // A partir daqui o pedido pertence exclusivamente a esta chamada (status='settled').
  // Qualquer falha abaixo move o pedido para review_required em vez de deixa-lo
  // 'settled' sem efeito correspondente.
  return finishTicketSettlement(claimed);
}

async function finishTicketSettlement(claimed: PaymentOrder): Promise<SettlementResult> {
  if (!claimed.drawId || !claimed.ticketId) {
    return reviewOut(claimed, "payment_order de compra de bilhete sem drawId/ticketId");
  }

  const draw = await db.getDrawById(claimed.drawId);
  if (!draw) {
    return reviewOut(claimed, `sorteio ${claimed.drawId} não encontrado`);
  }
  if (draw.status !== "active") {
    // Pagamento confirmado depois do sorteio ter sido encerrado/realizado: nao conta
    // como bilhete vendido, vai para conciliacao manual (reembolso), nunca aumenta
    // ticketsSold de um sorteio que ja fechou.
    return reviewOut(claimed, `sorteio não está mais ativo (status="${draw.status}") no momento da confirmação do pagamento`);
  }

  const capacity = computeDrawCapacity(draw.targetAmount, draw.ticketPrice);
  const reserved = await db.reserveDrawCapacity(claimed.drawId, claimed.quantity, claimed.principalAmount, capacity);
  if (!reserved) {
    return reviewOut(claimed, "capacidade do sorteio esgotada no momento da confirmação do pagamento");
  }

  const numbers = assignTicketNumbers(reserved.ticketsSoldBefore, claimed.quantity, capacity);
  if (!numbers) {
    return reviewOut(claimed, "falha ao atribuir números após reserva de capacidade");
  }

  await db.insertTicketNumbers(numbers.map((number) => ({
    ticketId: claimed.ticketId!,
    drawId: claimed.drawId!,
    number,
  })));
  await db.updateTicket(claimed.ticketId, { paymentStatus: "confirmed" });

  return { outcome: "ticket_confirmed", ticketId: claimed.ticketId, numbers };
}

async function reviewOut(claimed: PaymentOrder, reason: string): Promise<SettlementResult> {
  await db.demoteSettledOrderToReview(claimed.providerPaymentId, reason);
  return { outcome: "review_required", reason };
}

export type RefundResult =
  | { outcome: "order_not_found" }
  | { outcome: "already_processed" }
  | { outcome: "refunded_unsettled" }
  | { outcome: "review_required"; reason: string };

// Estorno/chargeback: se o pedido nunca foi liquidado, apenas cancela (nada a
// reverter). Se ja tinha sido liquidado (credito/confirmacao aplicados), NAO reverte
// saldo/bilhete automaticamente - vai para conciliacao manual, pois a regra de negocio
// para reversao parcial/chargeback ainda nao foi definida pelo dono do produto.
export async function refundPaymentOrder(providerPaymentId: string): Promise<RefundResult> {
  const order = await db.getPaymentOrderByProviderId(providerPaymentId);
  if (!order) return { outcome: "order_not_found" };

  if (order.status === "pending") {
    const refunded = await db.markPaymentOrderRefunded(providerPaymentId);
    if (!refunded) return { outcome: "already_processed" };
    return { outcome: "refunded_unsettled" };
  }

  if (order.status === "settled") {
    const reason = "estorno recebido após liquidação — requer decisão manual sobre reversão de saldo/bilhete";
    const reviewed = await db.demoteSettledOrderToReview(providerPaymentId, reason);
    if (!reviewed) return { outcome: "already_processed" };
    return { outcome: "review_required", reason };
  }

  return { outcome: "already_processed" };
}
