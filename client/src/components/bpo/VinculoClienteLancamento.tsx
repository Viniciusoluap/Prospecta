import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Alvo = { clienteId?: number | null; leadId?: number | null };
const alvoDaChave = (c: { clienteId: string | null; leadId: string | null }): Alvo =>
  c.clienteId ? { clienteId: Number(c.clienteId) } : { leadId: Number(c.leadId) };

/**
 * Lote 3, item 17: na edição de um lançamento "Cadastro livre", sugere o cliente do CRM
 * (ID → integração → CPF/CNPJ → telefone → nome) e só vincula após confirmação. A busca
 * manual cobre clientes BPO e leads; escolher um lead cria o cliente BPO (sem duplicar).
 */
export function VinculoClienteLancamento({ lancamento, clientes, onVinculado }: {
  lancamento: { id: number; version: number; clienteNomeLivre?: string | null };
  clientes: { id: number; razaoSocial: string }[];
  onVinculado: (r: { clienteId: number; version: number }) => void;
}) {
  const utils = trpc.useUtils();
  const [busca, setBusca] = useState("");
  const { data: sugestao } = trpc.bpo.lancamentos.sugestoesCliente.useQuery({ id: lancamento.id });
  const { data: leadsAchados = [] } = trpc.bpo.clientes.buscarLeads.useQuery({ q: busca.trim() }, { enabled: busca.trim().length >= 2 });
  const vincular = trpc.bpo.lancamentos.vincularCliente.useMutation({
    onSuccess: r => {
      toast.success(r.clienteCriado ? "Cliente BPO criado a partir do lead e vinculado." : "Lançamento vinculado ao cliente.");
      utils.bpo.lancamentos.list.invalidate(); utils.bpo.clientes.list.invalidate();
      onVinculado({ clienteId: r.clienteId, version: r.version });
    },
    onError: e => toast.error(e.message),
  });
  const clientesAchados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q.length >= 2 ? clientes.filter(c => c.razaoSocial.toLowerCase().includes(q)).slice(0, 10) : [];
  }, [busca, clientes]);
  const confirmar = (alvo: Alvo, motivo: string) => vincular.mutate({ id: lancamento.id, version: lancamento.version, ...alvo, motivo });

  return (
    <div className="col-span-2 space-y-2 rounded-lg border border-[#C9A961]/30 p-3">
      <p className="text-sm text-gray-200">Cadastro livre: <strong>{lancamento.clienteNomeLivre || "sem nome"}</strong></p>
      {sugestao?.sugestoes.length ? (
        <ul className="space-y-1">
          {sugestao.sugestoes.slice(0, 5).map(s => (
            <li key={s.candidato.chave} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                Possível cliente: <strong>{s.candidato.nome}</strong> — {s.descricao}
                <span className={`ml-2 rounded px-1.5 text-[10px] font-bold uppercase ${s.grau === "forte" ? "bg-green-700/40 text-green-200" : "bg-amber-700/40 text-amber-200"}`}>{s.grau === "forte" ? "forte" : "confirmar"}</span>
                {!s.candidato.clienteId && <span className="ml-1 text-[11px] text-gray-400">(lead sem cliente BPO — será criado)</span>}
              </span>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={vincular.isPending}
                onClick={() => confirmar(alvoDaChave(s.candidato), `sugestão (${s.descricao}) confirmada`)}>Confirmar</Button>
            </li>
          ))}
          {sugestao.ambiguo && <li className="text-xs text-amber-300">Há mais de um candidato possível: confirme manualmente o correto.</li>}
        </ul>
      ) : <p className="text-xs text-gray-400">Nenhuma sugestão automática encontrada.</p>}
      <div>
        <Label className="text-gray-300">Buscar cliente BPO ou lead do CRM</Label>
        <Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Nome ou telefone" className="bg-[#2C3E50] border-[#C9A961]/30 mt-1" />
        {(clientesAchados.length > 0 || leadsAchados.length > 0) && (
          <div className="mt-1 max-h-40 overflow-y-auto rounded border border-[#C9A961]/20">
            {clientesAchados.map(c => (
              <button key={`c${c.id}`} type="button" disabled={vincular.isPending} onClick={() => confirmar({ clienteId: c.id }, "escolhido na busca (cliente BPO)")}
                className="block w-full px-2 py-1 text-left text-sm hover:bg-[#2C3E50]">{c.razaoSocial} <span className="text-xs text-gray-400">BPO</span></button>
            ))}
            {leadsAchados.map(l => (
              <button key={`l${l.id}`} type="button" disabled={vincular.isPending} onClick={() => confirmar({ leadId: l.id }, "escolhido na busca (lead do CRM)")}
                className="block w-full px-2 py-1 text-left text-sm hover:bg-[#2C3E50]">{l.name} <span className="text-xs text-gray-400">Lead · {l.phone}</span></button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Ação em massa opcional: prévia dos "Cadastro livre" com sugestão e confirmação explícita. */
export function SugerirVinculosDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const { data, isFetching } = trpc.bpo.lancamentos.previaVinculos.useQuery(undefined, { enabled: open });
  const [escolhas, setEscolhas] = useState<Record<number, string>>({});
  const escolhaDe = (i: NonNullable<typeof data>["itens"][number]) => escolhas[i.lancamentoId] ?? (i.automatico?.candidato.chave ?? "");
  const aplicar = trpc.bpo.lancamentos.aplicarVinculos.useMutation({
    onSuccess: r => {
      toast.success(`${r.vinculados} lançamento(s) vinculado(s).${r.falhas.length ? ` ${r.falhas.length} não puderam ser vinculados (atualize e tente de novo).` : ""}`);
      utils.bpo.lancamentos.list.invalidate(); utils.bpo.clientes.list.invalidate(); utils.bpo.lancamentos.previaVinculos.invalidate();
      setEscolhas({}); onOpenChange(false);
    },
    onError: e => toast.error(e.message),
  });
  const selecionados = (data?.itens ?? []).flatMap(i => {
    const chave = escolhaDe(i);
    const c = i.sugestoes.find(s => s.candidato.chave === chave)?.candidato;
    return c ? [{ id: i.lancamentoId, version: i.version, ...alvoDaChave(c) }] : [];
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle className="text-[#C9A961]">Sugerir vínculos com clientes do CRM</DialogTitle></DialogHeader>
        {isFetching && <p className="text-sm text-gray-400">Analisando lançamentos…</p>}
        {data && (
          <div className="space-y-3">
            <p className="text-sm text-gray-300">{data.analisados} lançamento(s) "Cadastro livre" analisado(s) · {data.comSugestao} com sugestão · {data.automaticos} com um único candidato forte (pré-selecionados). Ambíguos ficam sem seleção: escolha manualmente.</p>
            {data.itens.map(i => (
              <div key={i.lancamentoId} className="flex flex-col gap-1 rounded border border-[#C9A961]/20 p-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-sm"><p className="font-medium">{i.nome}</p><p className="truncate text-xs text-gray-400">{i.descricao}</p></div>
                <select className="w-full rounded bg-[#2C3E50] p-1 text-sm sm:w-80" value={escolhaDe(i)}
                  onChange={e => setEscolhas(x => ({ ...x, [i.lancamentoId]: e.target.value }))}>
                  <option value="">Não vincular</option>
                  {i.sugestoes.map(s => <option key={s.candidato.chave} value={s.candidato.chave}>{s.candidato.nome} — {s.descricao} ({s.grau})</option>)}
                </select>
              </div>
            ))}
            <Button className="w-full bg-[#C9A961] text-[#1A2332]" disabled={!selecionados.length || aplicar.isPending}
              onClick={() => aplicar.mutate({ itens: selecionados })}>
              {aplicar.isPending ? "Vinculando…" : `Confirmar ${selecionados.length} vínculo(s)`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
