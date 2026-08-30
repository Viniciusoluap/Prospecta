import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "@/auth";
import { createAsaasPayment, createOrUpdateAsaasCustomer, getAsaasPixQrCode } from "@/lib/legacy/asaas";
import { resolveLegacyUser } from "@/lib/legacy/session";

const payloadSchema = z.object({
  amount: z.number().int().min(1).max(1_000_000),
  paymentMethod: z.enum(["pix", "credit_card", "boleto"]),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Faça login para comprar UTEFs." }, { status: 401 });
  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados da compra inválidos." }, { status: 400 });
  const user = await resolveLegacyUser(session);
  if (!user) return Response.json({ error: "Conta não encontrada." }, { status: 409 });

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
      billingType: parsed.data.paymentMethod === "pix" ? "PIX" : parsed.data.paymentMethod === "credit_card" ? "CREDIT_CARD" : "BOLETO",
      value: parsed.data.amount,
      dueDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      description: `Compra de ${parsed.data.amount} UTEFs`,
      externalReference: `utef_purchase_${user.id}_${randomUUID()}`,
    });
    let pixQrCode: string | undefined;
    let pixCopyPaste: string | undefined;
    if (parsed.data.paymentMethod === "pix") {
      const pix = await getAsaasPixQrCode(payment.id);
      pixQrCode = pix.encodedImage;
      pixCopyPaste = pix.payload;
    }
    return Response.json({ invoiceUrl: payment.invoiceUrl, bankSlipUrl: payment.bankSlipUrl, pixQrCode, pixCopyPaste });
  } catch (error) {
    console.error("[Ecossistema] Falha ao criar cobrança UTEF", error);
    return Response.json({ error: "Não foi possível gerar a cobrança. Tente novamente." }, { status: 502 });
  }
}
