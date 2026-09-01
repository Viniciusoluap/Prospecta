import { and, eq } from "drizzle-orm";
import { decryptSecret } from "@/lib/legacy/payment-secrets";
import { getDb, getPaymentSetting } from "@/lib/legacy/repository";
import {
  confirmTicketPayment,
  confirmUtefPayment,
  normalizeAsaasWebhookEvent,
  refundPayment,
  type PaymentDetails,
} from "@/lib/legacy/ecossistema-ledger";
import { asaasWebhookEvents } from "@/lib/legacy/schema";
import { secretsMatch } from "@/lib/security/secrets";
import { logOperationalError, requestId } from "@/lib/observability/logger";

const MAX_WEBHOOK_BYTES = 256 * 1024;

type WebhookPayload = {
  event: string;
  payment: PaymentDetails;
};

async function configuredWebhookToken() {
  if (process.env.ASAAS_WEBHOOK_TOKEN) return process.env.ASAAS_WEBHOOK_TOKEN;
  const setting = await getPaymentSetting();
  if (!setting?.isActive || !setting.asaasWebhookTokenEncrypted) return null;
  return decryptSecret(setting.asaasWebhookTokenEncrypted);
}

export async function POST(request: Request) {
  const correlationId = requestId(request);
  const token = await configuredWebhookToken();
  if (!token) return Response.json({ error: "Webhook Asaas não configurado." }, { status: 503 });
  if (!secretsMatch(request.headers.get("asaas-access-token"), token)) {
    return Response.json({ error: "Token de webhook inválido." }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: "Payload muito grande." }, { status: 413 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return Response.json({ error: "Content-Type inválido." }, { status: 415 });
  }

  const payload = (await request.json().catch(() => null)) as WebhookPayload | null;
  if (
    !payload ||
    typeof payload.event !== "string" ||
    typeof payload.payment?.id !== "string" ||
    !payload.payment.id ||
    typeof payload.payment.value !== "number"
  ) {
    return Response.json({ error: "Payload inválido." }, { status: 400 });
  }

  const normalizedEvent = normalizeAsaasWebhookEvent(payload.event);
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
      await confirmTicketPayment(payload.payment);
      await confirmUtefPayment(payload.payment);
    } else {
      await refundPayment(payload.payment);
    }
    await db.update(asaasWebhookEvents).set({ status: "completed", completedAt: new Date() }).where(eq(asaasWebhookEvents.eventKey, eventKey));
  } catch (error) {
    await db.update(asaasWebhookEvents).set({ status: "failed" }).where(eq(asaasWebhookEvents.eventKey, eventKey));
    logOperationalError("asaas.webhook.processing_failed", error, {
      correlationId,
      webhookEvent: normalizedEvent,
      paymentId: payload.payment.id,
    });
    return Response.json({ error: "Falha ao processar evento." }, { status: 500 });
  }
  return Response.json({ received: true });
}
