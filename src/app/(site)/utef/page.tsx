import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUtefBalance, getUtefTransactionsByUserId } from "@/lib/legacy/repository";
import { resolveLegacyUser } from "@/lib/legacy/session";

export const dynamic = "force-dynamic";

export default async function UtefPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const user = await resolveLegacyUser(session);
  if (!user) redirect("/login");
  const [balance, transactions] = await Promise.all([getUtefBalance(user.id), getUtefTransactionsByUserId(user.id)]);

  return (
    <div className="bg-gray-50 py-14 min-h-[65vh]"><div className="max-w-5xl mx-auto px-4">
      <div className="bg-[var(--brand-dark)] text-white p-8 mb-8">
        <span className="text-gray-400 text-sm">Saldo disponível</span>
        <p className="text-5xl font-black text-[var(--brand-yellow)] mt-2">{(balance?.balance ?? 0).toLocaleString("pt-BR")} UTEF</p>
        <div className="flex gap-3 mt-6"><Link href="/comprar-utef" className="bg-[var(--brand-accent)] text-[var(--brand-dark)] px-5 py-3 font-bold">Comprar UTEF</Link><Link href="/produtos" className="border border-[var(--brand-yellow)] text-[var(--brand-yellow)] px-5 py-3 font-bold">Ver produtos</Link></div>
      </div>
      <h1 className="font-black text-2xl text-[var(--brand-dark)] mb-4">Movimentações</h1>
      <div className="bg-white divide-y divide-gray-100">
        {transactions.length === 0 ? <p className="p-6 text-gray-500">Nenhuma movimentação.</p> : transactions.map((transaction) => (
          <div key={transaction.id} className="p-5 flex justify-between gap-4"><div><p className="font-medium">{transaction.description ?? transaction.type}</p><span className="text-xs text-gray-400">{transaction.createdAt.toLocaleDateString("pt-BR")}</span></div><strong className={transaction.amount >= 0 ? "text-green-700" : "text-red-700"}>{transaction.amount >= 0 ? "+" : ""}{transaction.amount.toLocaleString("pt-BR")}</strong></div>
        ))}
      </div>
    </div></div>
  );
}
