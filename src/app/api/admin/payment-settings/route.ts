import { z } from "zod";
import { auth } from "@/auth";
import { validateAsaasApiKey } from "@/lib/legacy/asaas";
import { encryptSecret } from "@/lib/legacy/payment-secrets";
import { getPaymentSetting, savePaymentSetting } from "@/lib/legacy/repository";

const schema = z.object({
  apiKey: z.string().trim().min(1),
  webhookToken: z.string().trim().min(1),
  environment: z.enum(["sandbox", "production"]),
});

async function isAdmin() {
  const session = await auth();
  return session?.user.role === "admin";
}

export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: "Acesso negado." }, { status: 403 });
  const setting = await getPaymentSetting();
  return Response.json({
    configured: Boolean(setting?.isActive && setting.asaasApiKeyEncrypted),
    webhookConfigured: Boolean(setting?.asaasWebhookTokenEncrypted),
    environment: setting?.asaasEnvironment === "production" ? "production" : "sandbox",
  });
}

export async function POST(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Acesso negado." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Preencha a chave e o token do webhook." }, { status: 400 });
  const valid = await validateAsaasApiKey({
    apiKey: parsed.data.apiKey,
    environment: parsed.data.environment,
  });
  if (!valid) return Response.json({ error: "Credencial Asaas inválida para o ambiente escolhido." }, { status: 400 });
  await savePaymentSetting({
    provider: "asaas",
    asaasApiKeyEncrypted: encryptSecret(parsed.data.apiKey),
    asaasWebhookTokenEncrypted: encryptSecret(parsed.data.webhookToken),
    asaasEnvironment: parsed.data.environment,
    isActive: true,
  });
  return Response.json({ success: true });
}
