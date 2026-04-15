import express from "express";
import { stripe } from "./stripe";
import { ENV } from "./env";
import * as db from "../db";

export function registerStripeWebhook(app: express.Application) {
  // Webhook deve estar registrado ANTES do express.json() para receber raw body
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      const sig = req.headers["stripe-signature"];

      if (!sig) {
        console.error("[Stripe Webhook] Missing stripe-signature header");
        return res.status(400).send("Missing signature");
      }

      let event;

      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          ENV.stripeWebhookSecret
        );
      } catch (err: any) {
        console.error(
          "[Stripe Webhook] Signature verification failed:",
          err.message
        );
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      // Detectar eventos de teste
      if (event.id.startsWith("evt_test_")) {
        console.log(
          "[Stripe Webhook] Test event detected, returning verification response"
        );
        return res.json({ verified: true });
      }

      console.log("[Stripe Webhook] Event received:", event.type, event.id);

      try {
        switch (event.type) {
          case "checkout.session.completed": {
            const session = event.data.object as any;
            console.log("[Stripe Webhook] Checkout completed:", session.id);

            // Verificar se é uma compra de UTEFs
            if (session.metadata?.transaction_type === "utef_purchase") {
              const userId = parseInt(session.metadata.user_id);
              const utefAmount = parseInt(session.metadata.utef_amount);
              const txId = session.metadata.tx_id;

              // Calcular bônus (10% para compras acima de 1000 UTEFs)
              let bonusAmount = 0;
              if (utefAmount >= 1000) {
                bonusAmount = Math.floor(utefAmount * 0.1);
              }

              const totalUtef = utefAmount + bonusAmount;

              // Creditar UTEFs na conta do usuário
              await db.addUtefBalance(userId, totalUtef);

              // Registrar transação
              await db.createUtefTransaction({
                userId,
                amount: totalUtef,
                type: "purchase",
                description:
                  bonusAmount > 0
                    ? `Compra de ${utefAmount} UTEFs + ${bonusAmount} bônus (10%)`
                    : `Compra de ${utefAmount} UTEFs`,
                referenceId: txId,
              });

              console.log(
                `[Stripe Webhook] UTEFs credited: ${totalUtef} (${utefAmount} + ${bonusAmount} bonus) for user ${userId}`
              );
            } else {
              // Buscar o bilhete pelo session ID
              const ticket = await db.getTicketByStripeSessionId(session.id);
              if (ticket) {
                // Atualizar status do bilhete para confirmado
                await db.updateTicketPaymentStatus(ticket.id, "confirmed");

                // Atualizar o sorteio (incrementar arrecadação e bilhetes vendidos)
                await db.incrementDrawStats(
                  ticket.drawId,
                  ticket.totalPaid,
                  ticket.quantity
                );

                console.log("[Stripe Webhook] Ticket confirmed:", ticket.id);
              } else {
                console.warn(
                  "[Stripe Webhook] Ticket not found for session:",
                  session.id
                );
              }
            }
            break;
          }

          case "payment_intent.payment_failed": {
            const paymentIntent = event.data.object as any;
            console.log("[Stripe Webhook] Payment failed:", paymentIntent.id);

            // Buscar o bilhete pelo payment intent ID
            const ticket = await db.getTicketByStripePaymentIntentId(
              paymentIntent.id
            );
            if (ticket) {
              await db.updateTicketPaymentStatus(ticket.id, "failed");
              console.log(
                "[Stripe Webhook] Ticket marked as failed:",
                ticket.id
              );
            }
            break;
          }

          default:
            console.log("[Stripe Webhook] Unhandled event type:", event.type);
        }

        res.json({ received: true });
      } catch (error: any) {
        console.error("[Stripe Webhook] Error processing event:", error);
        res.status(500).json({ error: error.message });
      }
    }
  );
}
