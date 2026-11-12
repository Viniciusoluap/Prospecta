// Pedido de 12/11 (noite), bloco 4: filtros de Cobranças, Despesas e A classificar (regras em shared/financeiro/bpo-filtros.ts).
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/format";
import { MESES_DRE } from "@shared/financeiro/bpo-extrato";
import { FILTROS_VAZIOS, ROTULOS_STATUS, algumFiltro, type FiltrosTela, type StatusFiltro } from "@shared/financeiro/bpo-filtros";

const sel = "mt-1 h-10 w-full rounded-md border border-[#C9A961]/30 bg-[#1A2332] px-2 text-white";
const inp = "mt-1 h-10 bg-[#1A2332] border-[#C9A961]/30 text-white";

export function FiltrosBpo({ valor, onChange, anos, semStatus = false, semCentro = false }: {
  valor: FiltrosTela; onChange: (f: FiltrosTela) => void; anos: string[]; semStatus?: boolean; semCentro?: boolean;
}) {
  const { data: centros = [] } = trpc.bpo.centrosCusto.list.useQuery(undefined, { enabled: !semCentro });
  const set = (p: Partial<FiltrosTela>) => onChange({ ...valor, ...p });
  return (
    <div className="mb-3 grid grid-cols-1 gap-3 rounded-lg bg-[#1A2332]/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="col-span-full lg:col-span-2">
        <Label className="text-gray-300">Busca</Label>
        <Input aria-label="Busca" value={valor.busca} onChange={e => set({ busca: e.target.value })} placeholder="cliente, titular ou descrição" className={inp} />
      </div>
      <div>
        <Label className="text-gray-300">Mês (competência)</Label>
        <select aria-label="Mês" className={sel} value={valor.mes} onChange={e => set({ mes: e.target.value })}>
          <option value="">Todos os meses</option>
          {MESES_DRE.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
        </select>
      </div>
      <div>
        <Label className="text-gray-300">Ano</Label>
        <select aria-label="Ano" className={sel} value={valor.ano} onChange={e => set({ ano: e.target.value })}>
          <option value="">Todos os anos</option>
          {Array.from(new Set([...anos, ...(valor.ano ? [valor.ano] : [])])).sort().reverse().map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      <div>
        <Label className="text-gray-300">Valor mínimo (R$)</Label>
        <Input aria-label="Valor mínimo" inputMode="decimal" value={valor.valorMin} onChange={e => set({ valorMin: e.target.value })} placeholder="0,00" className={inp} />
      </div>
      <div>
        <Label className="text-gray-300">Valor máximo (R$)</Label>
        <Input aria-label="Valor máximo" inputMode="decimal" value={valor.valorMax} onChange={e => set({ valorMax: e.target.value })} placeholder="igual ao mínimo = valor exato" className={inp} />
      </div>
      {!semStatus && <div>
        <Label className="text-gray-300">Status</Label>
        <select aria-label="Status" className={sel} value={valor.status} onChange={e => set({ status: e.target.value as StatusFiltro })}>
          {(Object.keys(ROTULOS_STATUS) as StatusFiltro[]).map(s => <option key={s} value={s}>{ROTULOS_STATUS[s]}</option>)}
        </select>
      </div>}
      {!semCentro && <div>
        <Label className="text-gray-300">Centro de custo</Label>
        <select aria-label="Centro de custo do filtro" className={sel} value={valor.centroCusto} onChange={e => set({ centroCusto: e.target.value })}>
          <option value="">Todos</option>
          {centros.map(c => <option key={c.id} value={c.nome}>{c.nome}{c.ativo ? "" : " (inativo)"}</option>)}
        </select>
      </div>}
      {algumFiltro(valor) && <div className="col-span-full"><Button variant="ghost" size="sm" className="text-gray-300" onClick={() => onChange(FILTROS_VAZIOS)}>Limpar filtros</Button></div>}
    </div>
  );
}

/** Painel de valores do que está visível (acompanha os filtros). */
export function PainelValores({ resumo, despesa = false }: { resumo: { quantidade: number; total: number; recebido: number; emAberto: number }; despesa?: boolean }) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      <div className="rounded-lg bg-[#1A2332] p-2"><p className="text-xs text-gray-400">Lançamentos</p><p className="font-bold text-white">{resumo.quantidade}</p></div>
      <div className="rounded-lg bg-[#1A2332] p-2"><p className="text-xs text-gray-400">Total</p><p className="font-bold text-white">{formatCurrency(resumo.total)}</p></div>
      <div className="rounded-lg bg-[#1A2332] p-2"><p className="text-xs text-gray-400">{despesa ? "Pago" : "Recebido"}</p><p className="font-bold text-green-400">{formatCurrency(resumo.recebido)}</p></div>
      <div className="rounded-lg bg-[#1A2332] p-2"><p className="text-xs text-gray-400">Em aberto</p><p className="font-bold text-amber-300">{formatCurrency(resumo.emAberto)}</p></div>
    </div>
  );
}
