// Pedido de 12/11 (noite): cadastro de centros de custo do BPO e campo "Centro de custo" dos lançamentos.
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { chaveCentro } from "@shared/financeiro/centros-custo";

const selectCls = "mt-1 h-10 w-full rounded-md border border-[#C9A961]/30 bg-[#2C3E50] px-2 text-white";

/** Campo opcional com os centros ativos; um valor gravado fora da lista (ex.: "A / B" do Conta Azul) continua como opção. */
export function CampoCentroCusto({ valor, onChange, className = "" }: { valor: string | null | undefined; onChange: (v: string | null) => void; className?: string }) {
  const { data: centros = [] } = trpc.bpo.centrosCusto.list.useQuery();
  const ativos = centros.filter(c => c.ativo);
  const atual = valor ?? "";
  const foraDaLista = atual && !ativos.some(c => chaveCentro(c.nome) === chaveCentro(atual));
  return (
    <div className={className}>
      <Label className="text-gray-300">Centro de custo</Label>
      <select aria-label="Centro de custo" className={selectCls} value={atual} onChange={e => onChange(e.target.value || null)}>
        <option value="">Nenhum</option>
        {foraDaLista && <option value={atual}>{atual}</option>}
        {ativos.map(c => <option key={c.id} value={c.nome}>{c.nome}</option>)}
      </select>
    </div>
  );
}

export function CentrosCustoDialog() {
  const utils = trpc.useUtils();
  const [aberto, setAberto] = useState(false);
  const [novo, setNovo] = useState("");
  const [editando, setEditando] = useState<{ id: number; nome: string } | null>(null);
  const { data: centros = [], isLoading } = trpc.bpo.centrosCusto.list.useQuery(undefined, { enabled: aberto });
  const atualizar = () => { utils.bpo.centrosCusto.list.invalidate(); utils.bpo.lancamentos.list.invalidate(); utils.bpo.aClassificar.invalidate(); };
  const criar = trpc.bpo.centrosCusto.criar.useMutation({ onSuccess: () => { setNovo(""); toast.success("Centro de custo criado."); atualizar(); }, onError: e => toast.error(e.message) });
  const renomear = trpc.bpo.centrosCusto.renomear.useMutation({
    onSuccess: r => { setEditando(null); toast.success(`Renomeado. ${r.lancamentos} lançamento(s) atualizado(s).`); atualizar(); },
    onError: e => toast.error(e.message),
  });
  const ativar = trpc.bpo.centrosCusto.ativar.useMutation({ onSuccess: atualizar, onError: e => toast.error(e.message) });
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <Button variant="outline" className="border-[#C9A961]/30 text-[#C9A961]">Centros de custo</Button>
      </DialogTrigger>
      <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-[#C9A961]">Centros de custo</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label className="text-gray-300">Novo centro de custo</Label>
            <Input value={novo} onChange={e => setNovo(e.target.value)} maxLength={100} className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
          </div>
          <Button className="bg-[#C9A961] text-[#1A2332]" disabled={novo.trim().length < 2 || criar.isPending} onClick={() => criar.mutate({ nome: novo })}>Criar</Button>
        </div>
        <p className="text-xs text-gray-400">Renomear atualiza os lançamentos que usam o centro (nos que têm dois centros, "A / B", só a parte dele). Desativado sai da lista de escolha, mas os lançamentos ficam como estão.</p>
        {isLoading ? <p className="text-sm text-gray-400">Carregando…</p> : (
          <ul className="divide-y divide-white/5 rounded border border-white/10">
            {centros.length === 0 && <li className="p-3 text-sm text-gray-400">Nenhum centro de custo cadastrado.</li>}
            {centros.map(c => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 p-2 text-sm">
                {editando?.id === c.id ? (
                  <>
                    <Input aria-label="Novo nome" value={editando.nome} onChange={e => setEditando({ ...editando, nome: e.target.value })} maxLength={100} className="h-8 flex-1 basis-40 bg-[#2C3E50] border-[#C9A961]/30 text-white" />
                    <Button size="sm" className="h-8 bg-[#C9A961] text-[#1A2332]" disabled={editando.nome.trim().length < 2 || renomear.isPending} onClick={() => renomear.mutate(editando)}>Salvar</Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditando(null)}>Voltar</Button>
                  </>
                ) : (
                  <>
                    <span className={`flex-1 basis-40 break-words ${c.ativo ? "" : "text-gray-500 line-through"}`}>{c.nome}</span>
                    <span className="text-xs text-gray-400">{c.lancamentos} lanç.</span>
                    <Button size="sm" variant="outline" className="h-8 text-xs border-[#C9A961]/30 text-[#C9A961]" onClick={() => setEditando({ id: c.id, nome: c.nome })}>Renomear</Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs border-[#C9A961]/30 text-[#C9A961]" disabled={ativar.isPending} onClick={() => ativar.mutate({ id: c.id, ativo: !c.ativo })}>{c.ativo ? "Desativar" : "Ativar"}</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
