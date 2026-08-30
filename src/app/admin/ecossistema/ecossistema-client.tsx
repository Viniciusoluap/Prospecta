"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Draw = { id: number; title: string; status: string; prizeAmount: number; ticketPrice: number; ticketsSold: number };
type Conversion = { id: number; userName: string; productTitle: string; utefAmount: number; status: string };

async function send(payload: Record<string, unknown>) {
  const response = await fetch("/api/admin/ecossistema", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = (await response.json()) as { error?: string; winnerTicket?: string };
  if (!response.ok) throw new Error(data.error ?? "Operação não concluída.");
  return data;
}

export function EcossistemaClient({ draws, conversions }: { draws: Draw[]; conversions: Conversion[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function run(payload: Record<string, unknown>) {
    setLoading(true); setMessage("");
    try { const result = await send(payload); setMessage(result.winnerTicket ? `Ganhador: ${result.winnerTicket}` : "Operação concluída."); router.refresh(); setLoading(false); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Falha inesperada."); setLoading(false); }
  }

  return <div className="space-y-6">
    {message && <p className="bg-amber-50 text-amber-800 p-3 text-sm" role="status">{message}</p>}
    <div className="grid lg:grid-cols-2 gap-5">
      <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void run({ action: "create_draw", title: data.get("title"), description: data.get("description"), prizeAmount: Number(data.get("prizeAmount")), ticketPrice: Math.round(Number(data.get("ticketPrice")) * 100), targetAmount: Math.round(Number(data.get("targetAmount")) * 100), drawDate: data.get("drawDate") || undefined }); }} className="bg-white border border-gray-100 p-5 space-y-3">
        <h2 className="font-black text-[var(--brand-dark)] uppercase">Novo sorteio</h2>
        <input name="title" required placeholder="Título" className="w-full border p-2.5" /><textarea name="description" placeholder="Descrição" className="w-full border p-2.5" />
        <div className="grid grid-cols-3 gap-2"><input name="prizeAmount" required type="number" min="1" placeholder="Prêmio UTEF" className="border p-2.5" /><input name="ticketPrice" required type="number" min="0.01" step="0.01" placeholder="Bilhete R$" className="border p-2.5" /><input name="targetAmount" required type="number" min="0.01" step="0.01" placeholder="Meta R$" className="border p-2.5" /></div>
        <input name="drawDate" type="datetime-local" className="w-full border p-2.5" /><button disabled={loading} className="bg-[var(--brand-yellow)] text-[var(--brand-dark)] px-5 py-2.5 font-bold">Criar sorteio</button>
      </form>
      <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void run({ action: "create_product", title: data.get("title"), description: data.get("description"), category: data.get("category"), priceUtef: Number(data.get("priceUtef")), imageUrl: data.get("imageUrl") }); }} className="bg-white border border-gray-100 p-5 space-y-3">
        <h2 className="font-black text-[var(--brand-dark)] uppercase">Novo produto UTEF</h2>
        <input name="title" required placeholder="Título" className="w-full border p-2.5" /><textarea name="description" placeholder="Descrição" className="w-full border p-2.5" />
        <div className="grid grid-cols-2 gap-2"><select name="category" className="border p-2.5 bg-white"><option value="real_estate">Imobiliário</option><option value="financial">Financeiro</option><option value="nautical">Náutico</option></select><input name="priceUtef" required type="number" min="1" placeholder="Preço UTEF" className="border p-2.5" /></div>
        <input name="imageUrl" type="url" placeholder="URL da imagem" className="w-full border p-2.5" /><button disabled={loading} className="bg-[var(--brand-yellow)] text-[var(--brand-dark)] px-5 py-2.5 font-bold">Criar produto</button>
      </form>
    </div>
    <section className="bg-white border border-gray-100 p-5"><h2 className="font-black text-[var(--brand-dark)] uppercase mb-4">Sorteios</h2><div className="space-y-3">{draws.map((draw) => <div key={draw.id} className="border border-gray-100 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3"><div><strong>{draw.title}</strong><p className="text-xs text-gray-400">{draw.status} · {draw.ticketsSold} bilhetes · prêmio {draw.prizeAmount} UTEF</p></div><div className="flex gap-2">{draw.status === "active" && <button onClick={() => void run({ action: "close_draw", drawId: draw.id })} className="border px-3 py-2 text-xs font-bold">Fechar</button>}{draw.status === "closed" && <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void run({ action: "perform_draw", drawId: draw.id, lotteryResult: data.get("result") }); }} className="flex"><input name="result" required pattern="\d{2,10}" placeholder="Loteria Federal" className="border px-2 text-xs" /><button className="bg-[var(--brand-dark)] text-white px-3 py-2 text-xs font-bold">Sortear</button></form>}</div></div>)}</div></section>
    <section className="bg-white border border-gray-100 p-5"><h2 className="font-black text-[var(--brand-dark)] uppercase mb-4">Conversões pendentes</h2><div className="space-y-3">{conversions.length === 0 ? <p className="text-gray-400">Nenhuma conversão pendente.</p> : conversions.map((item) => <div key={item.id} className="border p-4 flex items-center justify-between"><div><strong>{item.productTitle}</strong><p className="text-xs text-gray-400">{item.userName} · {item.utefAmount} UTEF</p></div><div className="flex gap-2"><button onClick={() => void run({ action: "update_conversion", conversionId: item.id, status: "completed" })} className="bg-green-700 text-white px-3 py-2 text-xs font-bold">Concluir</button><button onClick={() => void run({ action: "update_conversion", conversionId: item.id, status: "cancelled" })} className="border border-red-200 text-red-700 px-3 py-2 text-xs font-bold">Cancelar</button></div></div>)}</div></section>
  </div>;
}
