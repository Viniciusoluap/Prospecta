import { z } from "zod";
import { auth } from "@/auth";
import { getDb } from "@/lib/legacy/repository";
import { resolveLegacyUser } from "@/lib/legacy/session";
import { projectBudgetRequests } from "@/lib/legacy/schema";

const schema = z.object({ name: z.string().trim().min(2).max(255), email: z.string().trim().email().max(320), phone: z.string().trim().max(20).optional(), city: z.string().trim().max(255).optional(), projectType: z.string().trim().max(100).optional(), hasLot: z.enum(["yes", "no", "not_sure"]).optional(), message: z.string().trim().max(5000).optional() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Revise os dados informados." }, { status: 400 });
  const session = await auth();
  const user = session ? await resolveLegacyUser(session) : null;
  const [created] = await getDb().insert(projectBudgetRequests).values({ ...parsed.data, userId: user?.id, status: "pending" }).returning({ id: projectBudgetRequests.id });
  return Response.json({ success: true, id: created.id }, { status: 201 });
}
