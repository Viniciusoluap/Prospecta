import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getTicketsByUserId } from "@/lib/legacy/repository";
import { resolveLegacyUser } from "@/lib/legacy/session";

export const dynamic = "force-dynamic";

const status = { pending: "Aguardando pagamento", confirmed: "Confirmado", failed: "Falhou" };

export default async function MeusBilhetesPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const user = await resolveLegacyUser(session);
  if (!user) redirect("/login");
  const tickets = await getTicketsByUserId(user.id);

  return (
    <div className="bg-gray-50 py-14 min-h-[65vh]"><div className="max-w-5xl mx-auto px-4">
      <h1 className="text-4xl font-black text-[var(--brand-dark)] mb-8">Meus bilhetes</h1>
      <div className="space-y-4">
        {tickets.length === 0 ? <div className="bg-white p-8 text-gray-500">Você ainda não comprou bilhetes.</div> : tickets.map((ticket) => (
          <article key={ticket.id} className="bg-white border border-gray-100 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div><span className="text-xs text-gray-400">Bilhete</span><p className="font-black text-[var(--brand-dark)]">{ticket.ticketNumber}</p></div>
            <div><span className="text-xs text-gray-400">Quantidade</span><p className="font-bold">{ticket.quantity}</p></div>
            <div><span className="text-xs text-gray-400">Status</span><p className="font-bold">{status[ticket.paymentStatus]}</p></div>
            {ticket.paymentStatus === "pending" && ticket.pixCopyPaste && <span className="text-xs text-amber-700">Pagamento PIX pendente</span>}
          </article>
        ))}
      </div>
    </div></div>
  );
}
