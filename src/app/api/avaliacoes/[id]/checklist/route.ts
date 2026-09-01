import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { apiRoleError } from "@/lib/auth/rbac";

export const runtime = "nodejs";

// Separate API route to avoid Next.js page re-render after server actions,
// which would send all base64 photos back in the response and crash iOS Safari.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const denied = apiRoleError(session, "admin", "corretor", "colaborador");
  if (denied) return denied;
  const { id } = await params;
  const { dados } = (await req.json()) as { dados: string };

  if (!id || !dados || typeof dados !== "string" || dados.length > 9 * 1024 * 1024) {
    return NextResponse.json({ error: "Missing id or dados" }, { status: 400 });
  }

  await prisma.avaliacao.update({
    where: { id },
    data: { caracteristicas: dados },
  });

  return NextResponse.json({ ok: true });
}
