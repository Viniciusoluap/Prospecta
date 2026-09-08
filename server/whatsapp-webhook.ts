// Webhook do WhatsApp Business Cloud API — recebe atualizações assíncronas de
// status de entrega/leitura. Porta direta de `api/whatsapp/webhook/route.ts`
// do Grupo Santa Fé, incluindo a verificação HMAC opcional
// (WHATSAPP_WEBHOOK_SECRET) e a variante sem verificação quando a env não
// está configurada — mesmo comportamento da origem.

import { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { aplicarStatusWebhook } from "./whatsapp-router.js";

interface WebhookBody {
  event?: string;
  data?: { key?: { id?: string }; status?: string };
}

function verifyHmac(payload: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function processarEvento(body: WebhookBody): Promise<void> {
  if (body.event === "messages.update" && body.data?.key?.id) {
    await aplicarStatusWebhook(body.data.key.id, body.data.status);
  }
}

export async function handleWhatsappWebhook(req: Request, res: Response): Promise<void> {
  const webhookSecret = process.env.WHATSAPP_WEBHOOK_SECRET;

  if (webhookSecret) {
    const rawBody = req.body instanceof Buffer ? req.body.toString("utf8") : JSON.stringify(req.body);
    const sig = (req.headers["x-hub-signature-256"] as string | undefined)?.replace("sha256=", "") ?? "";
    if (!verifyHmac(rawBody, sig, webhookSecret)) {
      res.status(401).json({ error: "Assinatura inválida" });
      return;
    }
    try {
      await processarEvento(JSON.parse(rawBody) as WebhookBody);
    } catch {
      // ignora payload malformado
    }
    res.json({ ok: true });
    return;
  }

  try {
    await processarEvento(req.body as WebhookBody);
  } catch {
    // ignora payload malformado
  }
  res.json({ ok: true });
}
