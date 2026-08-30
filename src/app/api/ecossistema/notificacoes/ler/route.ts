import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { getDb } from "@/lib/legacy/repository";
import { resolveLegacyUser } from "@/lib/legacy/session";
import { userNotifications } from "@/lib/legacy/schema";

const schema = z.object({ id: z.number().int().positive().optional() });

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado." }, { status: 401 });
  const user = await resolveLegacyUser(session);
  if (!user) return Response.json({ error: "Conta não encontrada." }, { status: 409 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Dados inválidos." }, { status: 400 });
  const where = parsed.data.id ? and(eq(userNotifications.userId, user.id), eq(userNotifications.id, parsed.data.id)) : eq(userNotifications.userId, user.id);
  await getDb().update(userNotifications).set({ isRead: true, readAt: new Date() }).where(where);
  return Response.json({ success: true });
}
