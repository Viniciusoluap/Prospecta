import { and, eq, gte, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { getProductById, getDb } from "@/lib/legacy/repository";
import { resolveLegacyUser } from "@/lib/legacy/session";
import {
  productConversions,
  userNotifications,
  utefBalances,
  utefTransactions,
} from "@/lib/legacy/schema";

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

  const db = getDb();
  const debited = await db
    .update(utefBalances)
    .set({
      balance: sql`${utefBalances.balance} - ${product.priceUtef}`,
      updatedAt: new Date(),
    })
    .where(and(eq(utefBalances.userId, user.id), gte(utefBalances.balance, product.priceUtef)))
    .returning({ id: utefBalances.id });

  if (debited.length === 0) {
    return Response.json({ error: "Saldo UTEF insuficiente." }, { status: 400 });
  }

  try {
    const [conversion] = await db.insert(productConversions).values({
      userId: user.id,
      productId: product.id,
      utefAmount: product.priceUtef,
      status: "pending",
    }).returning();
    await db.insert(utefTransactions).values({
      userId: user.id,
      amount: -product.priceUtef,
      type: "conversion",
      description: `Conversão em: ${product.title}`,
      relatedId: product.id,
    });
    await db.insert(userNotifications).values({
      userId: user.id,
      title: "Conversão realizada",
      message: `Você converteu ${product.priceUtef} UTEFs em ${product.title}.`,
      type: "utef_update",
      relatedId: conversion.id,
      actionUrl: "/minhas-conversoes",
    });
    return Response.json({ message: "Conversão registrada com sucesso." });
  } catch (error) {
    await db.update(utefBalances).set({
      balance: sql`${utefBalances.balance} + ${product.priceUtef}`,
      updatedAt: new Date(),
    }).where(eq(utefBalances.userId, user.id));
    console.error("[Ecossistema] Falha ao converter UTEF", error);
    return Response.json({ error: "Não foi possível concluir a conversão." }, { status: 500 });
  }
}
