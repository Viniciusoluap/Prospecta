import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { getDb } from "@/lib/legacy/repository";
import { draws, productConversions, products, tickets, userNotifications, utefBalances, utefTransactions } from "@/lib/legacy/schema";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_draw"), title: z.string().trim().min(3), description: z.string().trim().optional(), prizeAmount: z.number().int().positive(), ticketPrice: z.number().int().positive(), targetAmount: z.number().int().positive(), drawDate: z.string().optional() }),
  z.object({ action: z.literal("close_draw"), drawId: z.number().int().positive() }),
  z.object({ action: z.literal("perform_draw"), drawId: z.number().int().positive(), lotteryResult: z.string().trim().regex(/^\d{2,10}$/) }),
  z.object({ action: z.literal("create_product"), title: z.string().trim().min(3), description: z.string().trim().optional(), category: z.enum(["real_estate", "financial", "nautical"]), priceUtef: z.number().int().positive(), imageUrl: z.string().url().optional().or(z.literal("")) }),
  z.object({ action: z.literal("update_conversion"), conversionId: z.number().int().positive(), status: z.enum(["completed", "cancelled"]) }),
  z.object({ action: z.literal("adjust_utef"), userId: z.number().int().positive(), amount: z.number().int().refine((value) => value !== 0), description: z.string().trim().min(3) }),
]);

export async function POST(request: Request) {
  const session = await auth();
  if (session?.user.role !== "admin") return Response.json({ error: "Acesso negado." }, { status: 403 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Dados inválidos." }, { status: 400 });
  const db = getDb();
  const input = parsed.data;

  if (input.action === "create_draw") {
    const [draw] = await db.insert(draws).values({
      title: input.title,
      description: input.description,
      prizeAmount: input.prizeAmount,
      ticketPrice: input.ticketPrice,
      targetAmount: input.targetAmount,
      drawDate: input.drawDate ? new Date(input.drawDate) : undefined,
    }).returning();
    return Response.json({ success: true, id: draw.id });
  }

  if (input.action === "close_draw") {
    await db.update(draws).set({ status: "closed", updatedAt: new Date() }).where(and(eq(draws.id, input.drawId), eq(draws.status, "active")));
    return Response.json({ success: true });
  }

  if (input.action === "perform_draw") {
    const [draw] = await db.select().from(draws).where(and(eq(draws.id, input.drawId), eq(draws.status, "closed"))).limit(1);
    if (!draw) return Response.json({ error: "O sorteio precisa estar fechado." }, { status: 409 });
    const confirmed = await db.select().from(tickets).where(and(eq(tickets.drawId, draw.id), eq(tickets.paymentStatus, "confirmed")));
    if (!confirmed.length) return Response.json({ error: "Não há bilhetes confirmados." }, { status: 409 });
    const winner = confirmed[Number(input.lotteryResult.slice(-2)) % confirmed.length];
    const updated = await db.update(draws).set({ status: "drawn", winnerUserId: winner.userId, lotteryResult: input.lotteryResult, updatedAt: new Date() })
      .where(and(eq(draws.id, draw.id), eq(draws.status, "closed"))).returning({ id: draws.id });
    if (!updated.length) return Response.json({ error: "Sorteio já processado." }, { status: 409 });
    await db.insert(utefBalances).values({ userId: winner.userId, balance: draw.prizeAmount }).onConflictDoUpdate({ target: utefBalances.userId, set: { balance: sql`${utefBalances.balance} + ${draw.prizeAmount}`, updatedAt: new Date() } });
    await db.insert(utefTransactions).values({ userId: winner.userId, amount: draw.prizeAmount, type: "prize", description: `Prêmio do sorteio: ${draw.title}`, relatedId: draw.id, referenceId: `draw:${draw.id}` });
    await db.insert(userNotifications).values({ userId: winner.userId, title: "Você ganhou!", message: `Seu bilhete ${winner.ticketNumber} ganhou ${draw.prizeAmount} UTEFs em ${draw.title}.`, type: "draw_result", relatedId: draw.id, actionUrl: "/utef" });
    return Response.json({ success: true, winnerTicket: winner.ticketNumber });
  }

  if (input.action === "create_product") {
    const [product] = await db.insert(products).values({ category: input.category, title: input.title, description: input.description, priceUtef: input.priceUtef, imageUrl: input.imageUrl || undefined }).returning();
    return Response.json({ success: true, id: product.id });
  }

  if (input.action === "update_conversion") {
    const [conversion] = await db.select().from(productConversions).where(eq(productConversions.id, input.conversionId)).limit(1);
    if (!conversion || conversion.status !== "pending") return Response.json({ error: "Conversão já processada." }, { status: 409 });
    await db.update(productConversions).set({ status: input.status, updatedAt: new Date() }).where(eq(productConversions.id, input.conversionId));
    if (input.status === "cancelled") {
      await db.update(utefBalances).set({ balance: sql`${utefBalances.balance} + ${conversion.utefAmount}`, updatedAt: new Date() }).where(eq(utefBalances.userId, conversion.userId));
      await db.insert(utefTransactions).values({ userId: conversion.userId, amount: conversion.utefAmount, type: "adjustment", description: "Estorno de conversão cancelada", relatedId: conversion.id });
    }
    return Response.json({ success: true });
  }

  await db.insert(utefBalances).values({ userId: input.userId, balance: input.amount }).onConflictDoUpdate({ target: utefBalances.userId, set: { balance: sql`${utefBalances.balance} + ${input.amount}`, updatedAt: new Date() } });
  await db.insert(utefTransactions).values({ userId: input.userId, amount: input.amount, type: "adjustment", description: input.description });
  return Response.json({ success: true });
}
