import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getConversionsByUserId } from "@/lib/legacy/repository";
import { resolveLegacyUser } from "@/lib/legacy/session";

export const dynamic = "force-dynamic";

export default async function MinhasConversoesPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const user = await resolveLegacyUser(session);
  if (!user) redirect("/login");
  const conversions = await getConversionsByUserId(user.id);
  return <div className="bg-gray-50 py-14 min-h-[65vh]"><div className="max-w-5xl mx-auto px-4"><h1 className="text-4xl font-black text-[var(--brand-dark)] mb-8">Minhas conversões</h1><div className="space-y-4">{conversions.length === 0 ? <div className="bg-white p-8 text-gray-500">Nenhuma conversão solicitada.</div> : conversions.map((item) => <article key={item.id} className="bg-white p-5 flex justify-between"><div><strong>{item.product?.title ?? "Produto"}</strong><p className="text-sm text-gray-400">{item.utefAmount.toLocaleString("pt-BR")} UTEF</p></div><span className="font-bold uppercase text-xs">{item.status}</span></article>)}</div></div></div>;
}
