import { auth } from "@/auth";
import { getProductById } from "@/lib/legacy/repository";
import { resolveLegacyUser } from "@/lib/legacy/session";
import { createProductConversion } from "@/lib/legacy/ecossistema-ledger";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Faça login para converter UTEFs." }, { status: 401 });
  const user = await resolveLegacyUser(session);
  if (!user) return Response.json({ error: "Conta não encontrada." }, { status: 409 });

  const { id } = await context.params;
  const productId = Number(id);
  const product = Number.isInteger(productId) ? await getProductById(productId) : undefined;
  if (!product || product.status !== "available") {
    return Response.json({ error: "Produto indisponível." }, { status: 404 });
  }

  try {
    const conversionId = await createProductConversion({
      userId: user.id,
      productId: product.id,
      productTitle: product.title,
      utefAmount: product.priceUtef,
    });
    if (!conversionId) return Response.json({ error: "Saldo UTEF insuficiente." }, { status: 400 });
    return Response.json({ message: "Conversão registrada com sucesso." });
  } catch (error) {
    console.error("[Ecossistema] Falha ao converter UTEF", error);
    return Response.json({ error: "Não foi possível concluir a conversão." }, { status: 500 });
  }
}
