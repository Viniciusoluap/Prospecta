import { sql } from "drizzle-orm";
import { getDb } from "./repository";

export type AsaasWebhookEvent = "confirmed" | "refunded";

export type PaymentDetails = {
  id: string;
  value: number;
  externalReference?: string;
};

export function normalizeAsaasWebhookEvent(event: string): AsaasWebhookEvent | null {
  if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") return "confirmed";
  if (event === "PAYMENT_REFUNDED") return "refunded";
  return null;
}

export function parseTicketPurchaseReference(reference?: string): number | null {
  if (typeof reference !== "string") return null;
  const ticketId = Number(reference?.match(/^ticket_purchase_(\d+)$/)?.[1]);
  return Number.isSafeInteger(ticketId) && ticketId > 0 ? ticketId : null;
}

export function parseUtefPurchaseReference(reference?: string): number | null {
  if (typeof reference !== "string") return null;
  const userId = Number(reference?.match(/^utef_purchase_(\d+)_/)?.[1]);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

export function asaasValueToCents(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error("Valor de pagamento inválido.");
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 0.000_001) {
    throw new Error("Valor de pagamento deve ter, no máximo, duas casas decimais.");
  }
  return cents;
}

export function calculatePurchasedUtefs(value: number): { base: number; bonus: number; total: number } {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    throw new Error("Quantidade de UTEFs inválida.");
  }
  const bonus = value >= 1_000 ? Math.floor(value * 0.1) : 0;
  return { base: value, bonus, total: value + bonus };
}

export async function confirmTicketPayment(payment: PaymentDetails): Promise<void> {
  const ticketId = parseTicketPurchaseReference(payment.externalReference);
  if (!ticketId) return;
  const paymentCents = asaasValueToCents(payment.value);
  const db = getDb();

  await db.execute(sql`
    WITH confirmed_ticket AS (
      UPDATE tickets
      SET payment_status = 'confirmed', updated_at = NOW()
      WHERE id = ${ticketId}
        AND payment_status = 'pending'
        AND stripe_payment_intent_id = ${payment.id}
        AND total_paid = ${paymentCents}
        AND EXISTS (SELECT 1 FROM draws WHERE draws.id = tickets.draw_id)
      RETURNING draw_id, quantity, total_paid
    )
    UPDATE draws
    SET tickets_sold = draws.tickets_sold + confirmed_ticket.quantity,
        current_amount = draws.current_amount + confirmed_ticket.total_paid,
        updated_at = NOW()
    FROM confirmed_ticket
    WHERE draws.id = confirmed_ticket.draw_id
  `);
}

export async function confirmUtefPayment(payment: PaymentDetails): Promise<void> {
  const userId = parseUtefPurchaseReference(payment.externalReference);
  if (!userId) return;
  const { base, bonus, total } = calculatePurchasedUtefs(payment.value);
  const db = getDb();

  await db.execute(sql`
    WITH purchase AS (
      INSERT INTO utef_transactions (user_id, amount, type, description, reference_id)
      VALUES (
        ${userId},
        ${total},
        'purchase',
        ${`Compra de ${base} UTEFs${bonus ? ` + ${bonus} de bônus` : ""}`},
        ${payment.id}
      )
      ON CONFLICT DO NOTHING
      RETURNING user_id, amount
    )
    INSERT INTO utef_balances (user_id, balance, updated_at)
    SELECT user_id, amount, NOW() FROM purchase
    ON CONFLICT (user_id) DO UPDATE
    SET balance = utef_balances.balance + EXCLUDED.balance,
        updated_at = NOW()
  `);
}

export async function refundPayment(payment: PaymentDetails): Promise<void> {
  const db = getDb();
  const ticketRefund = db.execute(sql`
    WITH refunded_ticket AS (
      UPDATE tickets
      SET payment_status = 'failed', updated_at = NOW()
      WHERE stripe_payment_intent_id = ${payment.id}
        AND payment_status = 'confirmed'
      RETURNING draw_id, quantity, total_paid
    )
    UPDATE draws
    SET tickets_sold = GREATEST(0, draws.tickets_sold - refunded_ticket.quantity),
        current_amount = GREATEST(0, draws.current_amount - refunded_ticket.total_paid),
        updated_at = NOW()
    FROM refunded_ticket
    WHERE draws.id = refunded_ticket.draw_id
  `);
  const utefRefund = db.execute(sql`
    WITH purchase AS (
      SELECT transaction.user_id, transaction.amount
      FROM utef_transactions AS transaction
      INNER JOIN utef_balances AS balance ON balance.user_id = transaction.user_id
      WHERE transaction.reference_id = ${payment.id}
        AND transaction.type = 'purchase'
    ), refund AS (
      INSERT INTO utef_transactions (user_id, amount, type, description, reference_id)
      SELECT user_id, -amount, 'adjustment', 'Estorno de compra UTEF', ${`refund:${payment.id}`}
      FROM purchase
      ON CONFLICT DO NOTHING
      RETURNING user_id, amount
    )
    UPDATE utef_balances
    SET balance = GREATEST(0, utef_balances.balance + refund.amount),
        updated_at = NOW()
    FROM refund
    WHERE utef_balances.user_id = refund.user_id
  `);
  await Promise.all([ticketRefund, utefRefund]);
}

export async function createProductConversion(input: {
  userId: number;
  productId: number;
  productTitle: string;
  utefAmount: number;
}): Promise<number | null> {
  const db = getDb();
  const result = await db.execute<{ id: number }>(sql`
    WITH debited_balance AS (
      UPDATE utef_balances
      SET balance = balance - ${input.utefAmount}, updated_at = NOW()
      WHERE user_id = ${input.userId} AND balance >= ${input.utefAmount}
      RETURNING user_id
    ), conversion AS (
      INSERT INTO product_conversions (user_id, product_id, utef_amount, status, updated_at)
      SELECT user_id, ${input.productId}, ${input.utefAmount}, 'pending', NOW()
      FROM debited_balance
      RETURNING id, user_id
    ), ledger_entry AS (
      INSERT INTO utef_transactions (user_id, amount, type, description, related_id)
      SELECT user_id, ${-input.utefAmount}, 'conversion', ${`Conversão em: ${input.productTitle}`}, ${input.productId}
      FROM conversion
      RETURNING user_id
    ), notification AS (
      INSERT INTO user_notifications (user_id, title, message, type, related_id, action_url)
      SELECT conversion.user_id,
             'Conversão realizada',
             ${`Você converteu ${input.utefAmount} UTEFs em ${input.productTitle}.`},
             'utef_update',
             conversion.id,
             '/minhas-conversoes'
      FROM conversion
      INNER JOIN ledger_entry ON ledger_entry.user_id = conversion.user_id
      RETURNING id
    )
    SELECT id FROM conversion
  `);
  return result.rows[0]?.id ?? null;
}

export async function processConversion(input: {
  conversionId: number;
  status: "completed" | "cancelled";
}): Promise<boolean> {
  const db = getDb();
  if (input.status === "completed") {
    const result = await db.execute<{ id: number }>(sql`
      UPDATE product_conversions
      SET status = 'completed', updated_at = NOW()
      WHERE id = ${input.conversionId} AND status = 'pending'
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  const result = await db.execute<{ id: number }>(sql`
    WITH cancelled_conversion AS (
      UPDATE product_conversions
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = ${input.conversionId} AND status = 'pending'
      RETURNING id, user_id, utef_amount
    ), credited_balance AS (
      INSERT INTO utef_balances (user_id, balance, updated_at)
      SELECT user_id, utef_amount, NOW() FROM cancelled_conversion
      ON CONFLICT (user_id) DO UPDATE
      SET balance = utef_balances.balance + EXCLUDED.balance,
          updated_at = NOW()
      RETURNING user_id
    ), ledger_entry AS (
      INSERT INTO utef_transactions (user_id, amount, type, description, related_id)
      SELECT cancelled_conversion.user_id,
             cancelled_conversion.utef_amount,
             'adjustment',
             'Estorno de conversão cancelada',
             cancelled_conversion.id
      FROM cancelled_conversion
      INNER JOIN credited_balance ON credited_balance.user_id = cancelled_conversion.user_id
      RETURNING id
    )
    SELECT id FROM cancelled_conversion
  `);
  return result.rows.length > 0;
}

export async function adjustUtefBalance(input: {
  userId: number;
  amount: number;
  description: string;
}): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    WITH adjustment AS (
      INSERT INTO utef_transactions (user_id, amount, type, description)
      VALUES (${input.userId}, ${input.amount}, 'adjustment', ${input.description})
      RETURNING user_id, amount
    )
    INSERT INTO utef_balances (user_id, balance, updated_at)
    SELECT user_id, amount, NOW() FROM adjustment
    ON CONFLICT (user_id) DO UPDATE
    SET balance = utef_balances.balance + EXCLUDED.balance,
        updated_at = NOW()
  `);
}

export async function performDraw(input: {
  drawId: number;
  lotteryResult: string;
  winnerUserId: number;
  winnerTicketNumber: string;
}): Promise<boolean> {
  const db = getDb();
  const result = await db.execute<{ id: number }>(sql`
    WITH drawn_draw AS (
      UPDATE draws
      SET status = 'drawn',
          winner_user_id = ${input.winnerUserId},
          lottery_result = ${input.lotteryResult},
          updated_at = NOW()
      WHERE id = ${input.drawId} AND status = 'closed'
      RETURNING id, title, prize_amount, winner_user_id
    ), prize_ledger AS (
      INSERT INTO utef_transactions (user_id, amount, type, description, related_id, reference_id)
      SELECT winner_user_id,
             prize_amount,
             'prize',
             CONCAT('Prêmio do sorteio: ', title),
             id,
             CONCAT('draw:', id)
      FROM drawn_draw
      RETURNING user_id, amount, related_id
    ), credited_balance AS (
      INSERT INTO utef_balances (user_id, balance, updated_at)
      SELECT user_id, amount, NOW() FROM prize_ledger
      ON CONFLICT (user_id) DO UPDATE
      SET balance = utef_balances.balance + EXCLUDED.balance,
          updated_at = NOW()
      RETURNING user_id
    ), notification AS (
      INSERT INTO user_notifications (user_id, title, message, type, related_id, action_url)
      SELECT drawn_draw.winner_user_id,
             'Você ganhou!',
             CONCAT('Seu bilhete ', ${input.winnerTicketNumber}, ' ganhou ', drawn_draw.prize_amount, ' UTEFs em ', drawn_draw.title, '.'),
             'draw_result',
             drawn_draw.id,
             '/utef'
      FROM drawn_draw
      INNER JOIN credited_balance ON credited_balance.user_id = drawn_draw.winner_user_id
      RETURNING id
    )
    SELECT id FROM drawn_draw
  `);
  return result.rows.length > 0;
}
