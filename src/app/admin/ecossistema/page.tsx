import { asc, desc, eq } from "drizzle-orm";
import { Gift } from "lucide-react";
import { auth } from "@/auth";
import { requirePageRole } from "@/lib/auth/rbac";
import { getDb } from "@/lib/legacy/repository";
import { draws, productConversions, products, users } from "@/lib/legacy/schema";
import { EcossistemaClient } from "./ecossistema-client";

export const dynamic = "force-dynamic";

export default async function AdminEcossistemaPage() {
  const session = await auth();
  requirePageRole(session, "admin");
  const db = getDb();
  const [drawList, conversionList] = await Promise.all([
    db.select().from(draws).orderBy(desc(draws.createdAt)),
    db.select({ id: productConversions.id, userName: users.name, productTitle: products.title, utefAmount: productConversions.utefAmount, status: productConversions.status })
      .from(productConversions).innerJoin(users, eq(productConversions.userId, users.id)).innerJoin(products, eq(productConversions.productId, products.id))
      .where(eq(productConversions.status, "pending")).orderBy(asc(productConversions.createdAt)),
  ]);
  return <div className="space-y-5 max-w-5xl"><div className="flex items-center gap-3"><Gift size={24} /><div><h1 className="font-black text-2xl uppercase text-[var(--brand-dark)]">Sorteios e UTEF</h1><p className="text-sm text-gray-400">Gestão do ecossistema Prospecta</p></div></div><EcossistemaClient draws={drawList.map((draw) => ({ id: draw.id, title: draw.title, status: draw.status, prizeAmount: draw.prizeAmount, ticketPrice: draw.ticketPrice, ticketsSold: draw.ticketsSold }))} conversions={conversionList.map((item) => ({ ...item, userName: item.userName ?? "Cliente" }))} /></div>;
}
