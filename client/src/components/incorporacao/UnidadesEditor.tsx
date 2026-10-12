import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { CurrencyInput } from "@/components/ui/currency-input";

export function UnidadesEditor({ estudoId }: { estudoId: number }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.incorporacao.units.list.useQuery({ studyId: estudoId });
  const [code, setCode] = useState(""); const [kind, setKind] = useState("lote");
  const [buyer, setBuyer] = useState<Record<number, string>>({});
  const [price, setPrice] = useState<Record<number, number>>({});
  const refresh = () => { void utils.incorporacao.units.list.invalidate({ studyId: estudoId }); };
  const onError = (e: { message: string }) => { toast.error(e.message); refresh(); };
  const create = trpc.incorporacao.units.create.useMutation({ onSuccess: () => { setCode(""); refresh(); }, onError });
  const transition = trpc.incorporacao.units.transition.useMutation({ onSuccess: refresh, onError });
  const reconcile = trpc.incorporacao.units.reconcile.useMutation({ onSuccess: refresh, onError });
  const input = "min-w-0 w-full rounded border border-[#C9A961]/40 bg-[#2C3E50] p-2 text-white";
  const action = "rounded border border-[#C9A961] px-3 py-2 text-[#E8C879] disabled:opacity-50";
  const locked = !!data?.legacyInvalid || !!data?.legacyPending.length;
  const counters = { disponivel: 0, reservada: 0, vendida: 0 };
  for (const unit of data?.units ?? []) counters[unit.status as keyof typeof counters]++;
  return <section className="space-y-4 text-white" aria-label="Unidades à Venda">
    <h2 className="text-xl font-bold">Unidades à Venda</h2>
    <p className="text-sm text-gray-300">{data?.units.length ?? 0} unidades · {counters.disponivel} disponíveis · {counters.reservada} reservadas · {counters.vendida} vendidas</p>
    {data?.legacyInvalid && <p role="alert" className="text-amber-200">Vendas históricas ambíguas ou incompletas. Revise o lançamento anterior antes de liberar novas vendas; nenhum registro foi descartado.</p>}
    {!!data?.legacyPending.length && <div className="rounded border border-amber-500 p-3 space-y-2"><p className="font-semibold text-amber-200">Concilie {data.legacyPending.length} venda(s) histórica(s) por código exato antes de movimentar unidades.</p>
      {data.legacyPending.map((sale) => <div key={sale.id} className="flex flex-wrap items-center gap-2 text-sm"><span>{sale.unidade} · {sale.comprador} · {Number(sale.valorVenda).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span><button type="button" disabled={reconcile.isPending} onClick={() => { if (window.confirm(`Conciliar venda histórica da unidade ${sale.unidade}?`)) reconcile.mutate({ studyId: estudoId, saleId: sale.id, kind: "lote" }); }} className={action}>Conciliar</button></div>)}
    </div>}
    <div className="flex flex-wrap items-end gap-2"><label className="flex-1 min-w-36 text-sm">Código da unidade<input value={code} maxLength={120} onChange={(e) => setCode(e.target.value)} className={input} /></label><label className="w-40 text-sm">Tipo<input value={kind} maxLength={40} onChange={(e) => setKind(e.target.value)} className={input} /></label><button type="button" className={action} disabled={!code.trim() || !kind.trim() || create.isPending} onClick={() => create.mutate({ studyId: estudoId, code, kind })}>Adicionar unidade</button></div>
    {isLoading && <p>Carregando inventário...</p>}
    <div className="grid gap-3">{data?.units.map((unit) => <article key={unit.id} className="rounded border border-[#C9A961]/30 bg-[#0F1923] p-3 space-y-2">
      <div className="flex flex-wrap justify-between gap-2"><strong>{unit.code} · {unit.kind}</strong><span>{unit.status}</span></div>
      {unit.status === "vendida" ? <p className="text-sm">{unit.buyer} · {Number(unit.salePrice).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p> : <div className="flex flex-wrap gap-2 items-end">
        <label className="flex-1 min-w-40 text-sm">Comprador<input value={buyer[unit.id] ?? ""} onChange={(e) => setBuyer((old) => ({ ...old, [unit.id]: e.target.value }))} className={input} /></label>
        <label className="w-40 text-sm">Valor da venda<CurrencyInput value={price[unit.id] ?? 0} onChange={(v) => setPrice((old) => ({ ...old, [unit.id]: v }))} className={input} /></label>
        {unit.status === "disponivel" && <button type="button" className={action} disabled={locked || transition.isPending} onClick={() => transition.mutate({ studyId: estudoId, unitId: unit.id, action: "reservar" })}>Reservar</button>}
        <button type="button" className={action} disabled={locked || transition.isPending || !buyer[unit.id]?.trim() || !price[unit.id]} onClick={() => { if (window.confirm(`Registrar venda de ${unit.code}?`)) transition.mutate({ studyId: estudoId, unitId: unit.id, action: "vender", buyer: buyer[unit.id], salePrice: price[unit.id].toFixed(2) }); }}>Vender</button>
        {unit.status === "reservada" && <button type="button" className={action} disabled={locked || transition.isPending} onClick={() => transition.mutate({ studyId: estudoId, unitId: unit.id, action: "liberar" })}>Liberar reserva</button>}
      </div>}
    </article>)}</div>
  </section>;
}
