import { randomBytes } from "node:crypto";
import { z } from "zod";
import { auth } from "@/auth";
import {
  createAsaasPayment,
  createOrUpdateAsaasCustomer,
  getAsaasPixQrCode,
} from "@/lib/legacy/asaas";
import {
  createTicket,
  getDrawById,
  updateTicket,
} from "@/lib/legacy/repository";
import { resolveLegacyUser } from "@/lib/legacy/session";

const payloadSchema = z.object({
  drawId: z.number().int().positive(),
  quantity: z.number().int().min(1).max(100),
  paymentMethod: z.enum(["pix", "credit_card", "boleto"]),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Faça login para comprar bilhetes." }, { status: 401 });

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados da compra inválidos." }, { status: 400 });

  const user = await resolveLegacyUser(session);
  if (!user) return Response.json({ error: "Não foi possível identificar sua conta." }, { status: 409 });

  const draw = await getDrawById(parsed.data.drawId);
  if (!draw || draw.status !== "active") {
    return Response.json({ error: "Este sorteio não está disponível." }, { status: 404 });
  }

  const totalPaid = draw.ticketPrice * parsed.data.quantity;
  const ticketNumber = `PX-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const ticket = await createTicket({
    drawId: draw.id,
    userId: user.id,
    ticketNumber,
    quantity: parsed.data.quantity,
    totalPaid,
    paymentStatus: "pending",
    paymentMethod: parsed.data.paymentMethod,
  });

  try {
    const customer = await createOrUpdateAsaasCustomer({
      name: user.name ?? "Cliente Prospecta",
      email: user.email ?? undefined,
      cpfCnpj: user.cpf?.replace(/\D/g, "") || undefined,
      mobilePhone: user.phone?.replace(/\D/g, "") || undefined,
      externalReference: `prospecta_user_${user.id}`,
    });
    if (!customer.id) throw new Error("Cliente de pagamento sem identificador");

    const payment = await createAsaasPayment({
      customer: customer.id,
      billingType:
        parsed.data.paymentMethod === "pix"
          ? "PIX"
          : parsed.data.paymentMethod === "credit_card"
            ? "CREDIT_CARD"
            : "BOLETO",
      value: totalPaid / 100,
      dueDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      description: `${parsed.data.quantity} bilhete(s) — ${draw.title}`,
      externalReference: `ticket_purchase_${ticket.id}`,
    });

    let pixQrCode: string | undefined;
    let pixCopyPaste: string | undefined;
    if (parsed.data.paymentMethod === "pix") {
      const pix = await getAsaasPixQrCode(payment.id);
      pixQrCode = pix.encodedImage;
      pixCopyPaste = pix.payload;
    }

    await updateTicket(ticket.id, {
      stripePaymentIntentId: payment.id,
      pixQrCode,
      pixCopyPaste,
    });

    return Response.json({
      ticketId: ticket.id,
      invoiceUrl: payment.invoiceUrl,
      bankSlipUrl: payment.bankSlipUrl,
      pixQrCode,
      pixCopyPaste,
    });
  } catch (error) {
    await updateTicket(ticket.id, { paymentStatus: "failed" });
    console.error("[Ecossistema] Falha ao criar cobrança de bilhete", error);
    return Response.json({ error: "Não foi possível gerar a cobrança. Tente novamente." }, { status: 502 });
  }
}
