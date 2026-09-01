import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyHmacSha256 } from "@/lib/security/secrets";

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook não configurado" }, { status: 503 });
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 256 * 1024) {
    return NextResponse.json({ error: "Payload muito grande" }, { status: 413 });
  }
  const rawBody = await req.text();
  const sig = req.headers.get("x-hub-signature-256")?.replace("sha256=", "") ?? "";
  if (!verifyHmacSha256(rawBody, sig, webhookSecret)) {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
  }

  try {
    const body = JSON.parse(rawBody) as {
      event?: string;
      data?: { key?: { id?: string }; status?: string };
    };

    if (body.event === "messages.update" && body.data?.key?.id) {
      const externalId = body.data.key.id;
      const rawStatus = (body.data.status ?? "").toLowerCase();
      let dbStatus = "enviada";
      if (rawStatus === "delivery_ack" || rawStatus === "delivered") dbStatus = "entregue";
      else if (rawStatus === "read") dbStatus = "lida";
      else if (rawStatus === "failed" || rawStatus === "error") dbStatus = "falhou";

      await prisma.mensagemWhatsapp.updateMany({ where: { externalId }, data: { status: dbStatus } });
    }
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
