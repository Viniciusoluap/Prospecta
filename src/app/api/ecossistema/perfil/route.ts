import { z } from "zod";
import { auth } from "@/auth";
import { updateUserProfile } from "@/lib/legacy/repository";
import { resolveLegacyUser } from "@/lib/legacy/session";

const schema = z.object({ name: z.string().trim().min(2).max(255), email: z.string().trim().email().max(320), cpf: z.string().trim().max(14), phone: z.string().trim().max(20), address: z.string().trim().max(500), city: z.string().trim().max(100), state: z.string().trim().max(2), zipCode: z.string().trim().max(10) });

export async function PATCH(request: Request) {
  const session = await auth(); if (!session) return Response.json({ error: "Não autenticado." }, { status: 401 });
  const user = await resolveLegacyUser(session); if (!user) return Response.json({ error: "Conta não encontrada." }, { status: 409 });
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: "Revise os dados informados." }, { status: 400 });
  await updateUserProfile(user.id, parsed.data); return Response.json({ success: true });
}
