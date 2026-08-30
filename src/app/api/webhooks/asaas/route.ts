import { and, eq, sql } from "drizzle-orm";
import { decryptSecret } from "@/lib/legacy/payment-secrets";
import { getDb, getPaymentSetting } from "@/lib/legacy/repository";
import { asaasWebhookEvents, draws, tickets, utefBalances, utefTransactions } from "@/lib/legacy/schema";

type Payment = {
  id: string;
  value: number;
  externalReference?: string;
};

type WebhookPayload = {
  event: string;
  payment: Payment;
};

async function configuredWebhookToken() {
  if (process.env.ASAAS_WEBHOOK_TOKEN) return process.env.ASAAS_WEBHOOK_TOKEN;
  const setting = await getPaymentSetting();
  if (!setting?.isActive || !setting.asaasWebhookTokenEncrypted) return null;
  return decryptSecret(setting.asaasWebhookTokenEncrypted);
}

async function confirmTicket(payment: Payment) {
  const ticketId = Number(payment.externalReference?.match(/^ticket_purchase_(\d+)$/)?.[1]);
  if (!Number.isInteger(ticketId)) return;
  const db = getDb();
  const confirmed = await db.update(tickets).set({ paymentStatus: "confirmed", updatedAt: new Date() })
    .where(and(eq(tickets.id, ticketId), eq(tickets.paymentStatus, "pending")))
    .returning({ drawId: tickets.drawId, quantity: tickets.quantity, totalPaid: tickets.totalPaid });
  if (confirmed.length === 0) return;
  const ticket = confirmed[0];
  await db.update(draws).set({
    ticketsSold: sql`${draws.ticketsSold} + ${ticket.quantity}`,
    currentAmount: sql`${draws.currentAmount} + ${ticket.totalPaid}`,
    updatedAt: new Date(),
  }).where(eq(draws.id, ticket.drawId));
}

async function confirmUtef(payment: Payment) {
  const match = payment.externalReference?.match(/^utef_purchase_(\d+)_/);
  const userId = Number(match?.[1]);
  if (!Number.isInteger(userId)) return;
  const db = getDb();
  const existing = await db.select({ id: utefTransactions.id }).from(utefTransactions)
    .where(eq(utefTransactions.referenceId, payment.id)).limit(1);
  if (existing.length) return;

  const base = Math.floor(payment.value);
  const bonus = base >= 1000 ? Math.floor(base * 0.1) : 0;
  const total = base + bonus;
  await db.insert(utefTransactions).values({
    userId,
    amount: total,
    type: "purchase",
    description: `Compra de ${base} UTEFs${bonus ? ` + ${bonus} de bônus` : ""}`,
    referenceId: payment.id,
  });
  await db.insert(utefBalances).values({ userId, balance: total }).onConflictDoUpdate({
    target: utefBalances.userId,
    set: { balance: sql`${utefBalances.balance} + ${total}`, updatedAt: new Date() },
  });
}

async function refund(payment: Payment) {
  const db = getDb();
  const refundedTickets = await db.update(tickets).set({ paymentStatus: "failed", updatedAt: new Date() })
    .where(and(eq(tickets.stripePaymentIntentId, payment.id), eq(tickets.paymentStatus, "confirmed")))
    .returning({ drawId: tickets.drawId, quantity: tickets.quantity, totalPaid: tickets.totalPaid });
  for (const ticket of refundedTickets) {
    await db.update(draws).set({
      ticketsSold: sql`GREATEST(0, ${draws.ticketsSold} - ${ticket.quantity})`,
      currentAmount: sql`GREATEST(0, ${draws.currentAmount} - ${ticket.totalPaid})`,
      updatedAt: new Date(),
    }).where(eq(draws.id, ticket.drawId));
  }

  const [purchase] = await db.select().from(utefTransactions)
    .where(and(eq(utefTransactions.referenceId, payment.id), eq(utefTransactions.type, "purchase"))).limit(1);
  if (!purchase) return;
  const refundReference = `refund:${payment.id}`;
  const [alreadyRefunded] = await db.select({ id: utefTransactions.id }).from(utefTransactions)
    .where(eq(utefTransactions.referenceId, refundReference)).limit(1);
  if (alreadyRefunded) return;
  await db.insert(utefTransactions).values({
    userId: purchase.userId,
    amount: -purchase.amount,
    type: "adjustment",
    description: "Estorno de compra UTEF",
    referenceId: refundReference,
  });
  await db.update(utefBalances).set({
    balance: sql`${utefBalances.balance} - ${purchase.amount}`,
    updatedAt: new Date(),
  }).where(eq(utefBalances.userId, purchase.userId));
}

export async function POST(request: Request) {
  const token = await configuredWebhookToken();
  if (!token) return Response.json({ error: "Webhook Asaas não configurado." }, { status: 503 });
  if (request.headers.get("asaas-access-token") !== token) {
    return Response.json({ error: "Token de webhook inválido." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as WebhookPayload | null;
  if (!payload?.event || !payload.payment?.id) {
    return Response.json({ error: "Payload inválido." }, { status: 400 });
  }

  const normalizedEvent = payload.event === "PAYMENT_CONFIRMED" || payload.event === "PAYMENT_RECEIVED" ? "confirmed" : payload.event === "PAYMENT_REFUNDED" ? "refunded" : null;
  if (!normalizedEvent) return Response.json({ received: true });
  const eventKey = `${normalizedEvent}:${payload.payment.id}`;
  const db = getDb();
  const claimed = await db.insert(asaasWebhookEvents).values({ eventKey }).onConflictDoNothing().returning({ eventKey: asaasWebhookEvents.eventKey });
  if (!claimed.length) {
    const retry = await db.update(asaasWebhookEvents).set({ status: "processing", completedAt: null })
      .where(and(eq(asaasWebhookEvents.eventKey, eventKey), eq(asaasWebhookEvents.status, "failed")))
      .returning({ eventKey: asaasWebhookEvents.eventKey });
    if (!retry.length) return Response.json({ received: true, duplicate: true });
  }

  try {
    if (normalizedEvent === "confirmed") {
      await confirmTicket(payload.payment);
      await confirmUtef(payload.payment);
    } else {
      await refund(payload.payment);
    }
    await db.update(asaasWebhookEvents).set({ status: "completed", completedAt: new Date() }).where(eq(asaasWebhookEvents.eventKey, eventKey));
  } catch (error) {
    await db.update(asaasWebhookEvents).set({ status: "failed" }).where(eq(asaasWebhookEvents.eventKey, eventKey));
    console.error("[Asaas webhook] Falha ao processar evento", error);
    return Response.json({ error: "Falha ao processar evento." }, { status: 500 });
  }
  return Response.json({ received: true });
}
