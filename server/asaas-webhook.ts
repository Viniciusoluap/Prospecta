import { Request, Response } from "express";
import { getDb, createOrUpdateUtefBalance } from "./db";
import { utefTransactions, tickets, users } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getAsaasPayment } from "./_core/asaas";

/**
 * Webhook do Asaas para receber notificações de pagamento
 *
 * Documentação: https://docs.asaas.com/docs/about-webhooks
 *
 * Eventos suportados:
 * - PAYMENT_CREATED: Cobrança criada
 * - PAYMENT_UPDATED: Cobrança atualizada
 * - PAYMENT_CONFIRMED: Pagamento confirmado (PIX pessoa física em análise)
 * - PAYMENT_RECEIVED: Pagamento recebido e confirmado
 * - PAYMENT_OVERDUE: Cobrança vencida
 * - PAYMENT_REFUNDED: Pagamento estornado
 */

interface AsaasWebhookPayload {
  event: string;
  payment: {
    id: string;
    customer: string;
    billingType: string;
    value: number;
    netValue: number;
    status: string;
    dueDate: string;
    paymentDate?: string;
    externalReference?: string;
  };
}

export async function handleAsaasWebhook(req: Request, res: Response) {
  try {
    // Validar assinatura do webhook Asaas
    const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
    if (webhookToken) {
      const receivedToken = req.headers["asaas-access-token"];
      if (!receivedToken || receivedToken !== webhookToken) {
        return res
          .status(401)
          .json({ error: "Unauthorized: invalid webhook token" });
      }
    }

    const payload: AsaasWebhookPayload = req.body;

    // Validar payload
    if (!payload.event || !payload.payment) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const { event, payment } = payload;

    // Processar apenas eventos de pagamento recebido
    if (event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED") {
      await processPaymentReceived(payment);
    } else if (event === "PAYMENT_REFUNDED") {
      await processPaymentRefunded(payment);
    }

    // Retornar 200 OK para confirmar recebimento
    res.status(200).json({ received: true });
  } catch (error) {
    console.error("[Asaas Webhook] Error processing webhook:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Processa pagamento recebido
 */
async function processPaymentReceived(payment: AsaasWebhookPayload["payment"]) {
  const db = await getDb();
  if (!db) {
    console.error("[Asaas Webhook] Database not available");
    return;
  }

  try {
    // Buscar detalhes completos do pagamento
    const fullPayment = await getAsaasPayment(payment.id);

    console.log("[Asaas Webhook] Processing payment:", fullPayment);

    // Extrair informações do externalReference
    // Formato esperado: "ticket_purchase_{drawId}_{userId}" ou "utef_purchase_{userId}"
    const externalRef = payment.externalReference || "";

    if (externalRef.startsWith("ticket_purchase_")) {
      await processTicketPurchase(db, fullPayment, externalRef);
    } else if (externalRef.startsWith("utef_purchase_")) {
      await processUtefPurchase(db, fullPayment, externalRef);
    } else {
      console.warn(
        "[Asaas Webhook] Unknown external reference format:",
        externalRef
      );
    }
  } catch (error) {
    console.error("[Asaas Webhook] Error processing payment received:", error);
    throw error;
  }
}

/**
 * Processa compra de bilhetes
 */
async function processTicketPurchase(
  db: any,
  payment: any,
  externalRef: string
) {
  // Extrair drawId e userId do externalReference
  const parts = externalRef.split("_");
  const drawId = parseInt(parts[2]);
  const userId = parseInt(parts[3]);

  if (isNaN(drawId) || isNaN(userId)) {
    console.error("[Asaas Webhook] Invalid external reference:", externalRef);
    return;
  }

  console.log(
    "[Asaas Webhook] Processing ticket purchase for draw:",
    drawId,
    "user:",
    userId
  );

  // Buscar bilhetes pendentes
  const existingTickets = await db
    .select()
    .from(tickets)
    .where(eq(tickets.userId, userId))
    .where(eq(tickets.drawId, drawId))
    .where(eq(tickets.paymentStatus, "pending"));

  if (existingTickets.length === 0) {
    console.warn("[Asaas Webhook] No pending tickets found for user:", userId);
    return;
  }

  // Atualizar bilhetes para status 'confirmed'
  await db
    .update(tickets)
    .set({
      paymentStatus: "confirmed",
      paymentMethod: payment.billingType.toLowerCase(),
      updatedAt: new Date(),
    })
    .where(eq(tickets.userId, userId))
    .where(eq(tickets.drawId, drawId))
    .where(eq(tickets.paymentStatus, "pending"));

  console.log("[Asaas Webhook] Ticket purchase processed successfully");

  // Enviar email de confirmação
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (user[0] && user[0].email) {
    const { sendEmail, paymentConfirmedTemplate } = await import(
      "./_core/email-smtp"
    );
    const template = paymentConfirmedTemplate({
      name: user[0].name || "Cliente",
      amount: Math.floor(payment.value * 100), // Converter para centavos
      type: "bilhete",
      quantity: existingTickets.length,
    });
    await sendEmail({
      to: user[0].email,
      subject: template.subject,
      html: template.html,
      recipientName: user[0].name,
      templateType: "payment_confirmation",
      metadata: { paymentId: payment.id, drawId, userId },
    });
  }
}

/**
 * Processa compra de UTEFs
 */
async function processUtefPurchase(db: any, payment: any, externalRef: string) {
  // Extrair userId do externalReference
  const parts = externalRef.split("_");
  const userId = parseInt(parts[2]);

  if (isNaN(userId)) {
    console.error("[Asaas Webhook] Invalid external reference:", externalRef);
    return;
  }

  console.log("[Asaas Webhook] Processing UTEF purchase for user:", userId);

  // Buscar usuário
  const userResult = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (userResult.length === 0) {
    console.error("[Asaas Webhook] User not found:", userId);
    return;
  }

  const user = userResult[0];

  // Calcular UTEFs (1 UTEF = R$ 1,00)
  const utefAmount = payment.value;

  // Calcular bônus (10% para compras acima de 1000 UTEFs)
  const bonus = utefAmount >= 1000 ? utefAmount * 0.1 : 0;
  const totalUtef = utefAmount + bonus;

  // Criar transação de crédito
  await db.insert(utefTransactions).values({
    userId: userId,
    amount: Math.floor(totalUtef),
    type: "purchase",
    description: `Compra de ${utefAmount} UTEFs${bonus > 0 ? ` + ${bonus} de bônus` : ""}`,
    referenceId: payment.id,
    createdAt: new Date(),
  });

  // Atualizar saldo de UTEF do usuário
  await createOrUpdateUtefBalance(userId, Math.floor(totalUtef));

  // Enviar email de confirmação
  if (user.email) {
    const { sendEmail, paymentConfirmedTemplate } = await import(
      "./_core/email-smtp"
    );
    const template = paymentConfirmedTemplate({
      name: user.name || "Cliente",
      amount: Math.floor(payment.value * 100), // Converter para centavos
      type: "utef",
      quantity: Math.floor(totalUtef),
    });
    await sendEmail({
      to: user.email,
      subject: template.subject,
      html: template.html,
      recipientName: user.name,
      templateType: "payment_confirmation",
      metadata: { paymentId: payment.id, userId, utefAmount: totalUtef },
    });
  }
}

/**
 * Processa pagamento estornado
 */
async function processPaymentRefunded(payment: AsaasWebhookPayload["payment"]) {
  const db = await getDb();
  if (!db) {
    console.error("[Asaas Webhook] Database not available");
    return;
  }

  console.log("[Asaas Webhook] Processing refund for payment:", payment.id);

  // TODO: Implementar lógica de estorno
  // - Reverter saldo de UTEF
  // - Cancelar bilhetes
  // - Atualizar transação para 'refunded'
}
