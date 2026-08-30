import Link from "next/link";
import { Gift, Ticket, Trophy } from "lucide-react";
import { getActiveDraws } from "@/lib/legacy/repository";

export const dynamic = "force-dynamic";

const reais = (centavos: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    centavos / 100
  );

export default async function SorteiosPage() {
  const draws = await getActiveDraws();

  return (
    <div className="bg-gray-50 py-14 min-h-[65vh]">
      <div className="max-w-7xl mx-auto px-4">
        <div className="max-w-3xl mb-10">
          <span className="text-[var(--brand-yellow-dark)] font-bold uppercase tracking-widest text-xs">
            Ecossistema VFX Capital
          </span>
          <h1 className="text-4xl md:text-5xl font-black text-[var(--brand-dark)] mt-2">
            Sorteios ativos
          </h1>
          <p className="text-gray-500 mt-4">
            Adquira seus bilhetes, acompanhe a arrecadação e concorra a prêmios em UTEF.
          </p>
        </div>

        {draws.length === 0 ? (
          <div className="bg-white border border-gray-100 p-10 text-center">
            <Gift className="mx-auto text-[var(--brand-yellow)] mb-4" size={42} />
            <h2 className="font-bold text-xl text-[var(--brand-dark)]">Nenhum sorteio ativo agora</h2>
            <p className="text-gray-500 mt-2">Volte em breve para conferir as próximas oportunidades.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
            {draws.map((draw) => {
              const progress = Math.min(100, Math.round((draw.currentAmount / draw.targetAmount) * 100));
              return (
                <article key={draw.id} className="bg-white border border-gray-100 shadow-sm p-6 flex flex-col">
                  <div className="flex items-center justify-between mb-5">
                    <Trophy className="text-[var(--brand-yellow)]" size={30} />
                    <span className="text-xs font-bold uppercase tracking-wider text-green-700 bg-green-50 px-3 py-1">Ativo</span>
                  </div>
                  <h2 className="font-black text-2xl text-[var(--brand-dark)]">{draw.title}</h2>
                  {draw.description && <p className="text-gray-500 mt-3 flex-1">{draw.description}</p>}
                  <div className="grid grid-cols-2 gap-3 my-6 text-sm">
                    <div className="bg-gray-50 p-3"><span className="text-gray-400 block">Prêmio</span><strong>{draw.prizeAmount.toLocaleString("pt-BR")} UTEF</strong></div>
                    <div className="bg-gray-50 p-3"><span className="text-gray-400 block">Bilhete</span><strong>{reais(draw.ticketPrice)}</strong></div>
                  </div>
                  <div className="h-2 bg-gray-100 overflow-hidden"><div className="h-full bg-[var(--brand-yellow)]" style={{ width: `${progress}%` }} /></div>
                  <div className="flex justify-between text-xs text-gray-400 mt-2 mb-5"><span>{draw.ticketsSold} vendidos</span><span>{progress}%</span></div>
                  <Link href={`/comprar-bilhete/${draw.id}`} className="inline-flex justify-center items-center gap-2 bg-[var(--brand-dark)] text-[var(--brand-yellow)] py-3 px-5 font-bold uppercase tracking-wider text-sm hover:bg-[var(--brand-dark-secondary)]">
                    <Ticket size={17} /> Comprar bilhetes
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
