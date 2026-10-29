import { useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ListChecks, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumeroInput } from "@/components/ui/numero-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { CampoDecimal } from "@/components/obra/FinanceiroObra";
import { centavosDe } from "@shared/financeiro/obra";
import {
  GRUPOS_FINANCEIROS,
  GRUPO_FINANCEIRO_LABEL,
  type FinanceiroRegularizacao,
  type GrupoFinanceiro,
} from "@shared/financeiro/regularizacao";

// EPIC-020 Lote 6 — Etapas do Processo (30) e Tabela financeira (31).
// Mesmas regras de Grupo-Santa-Fe/web/src/app/admin/regularizacao/[id]/_components/.

const campo = "bg-[#1A2332] border-white/20 text-white";
const brl = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string) => iso.split("-").reverse().join("/");
const percentual = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;

interface Etapa { id: number; nome: string; progresso: number; observacoes: string | null }

export function EtapasProcesso({ regularizacaoId, etapas, progressoEtapas, onMudou }: {
  regularizacaoId: number;
  etapas: Etapa[];
  progressoEtapas: number | null;
  onMudou: () => void;
}) {
  const [editando, setEditando] = useState<Partial<Etapa> | null>(null);
  const erro = (e: { message: string }) => toast.error(e.message);
  const criar = trpc.regularizacao.etapas.criar.useMutation({ onSuccess: () => { toast.success("Etapa incluída"); setEditando(null); onMudou(); }, onError: erro });
  const editar = trpc.regularizacao.etapas.editar.useMutation({ onSuccess: () => { toast.success("Etapa atualizada"); setEditando(null); onMudou(); }, onError: erro });
  const excluir = trpc.regularizacao.etapas.excluir.useMutation({ onSuccess: () => { toast.success("Etapa excluída"); onMudou(); }, onError: erro });
  const mover = trpc.regularizacao.etapas.mover.useMutation({ onSuccess: onMudou, onError: erro });

  const salvar = () => {
    if (!editando) return;
    const dados = { nome: editando.nome ?? "", progresso: editando.progresso ?? 0, observacoes: editando.observacoes || null };
    if (editando.id) editar.mutate({ id: editando.id, ...dados });
    else criar.mutate({ regularizacaoId, ...dados });
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-[#C9A961]"><ListChecks className="h-4 w-4" />Etapas do Processo</h2>
        <Button size="sm" variant="outline" className="gap-1 border-[#C9A961]/60 text-[#E6CA88]" onClick={() => setEditando({ nome: "", progresso: 0, observacoes: "" })}>
          <Plus className="h-4 w-4" />Nova etapa
        </Button>
      </div>
      {progressoEtapas !== null && (
        <div>
          <div className="flex justify-between text-xs text-gray-300"><span>Progresso das etapas (média)</span><span>{percentual(progressoEtapas)}</span></div>
          <div className="mt-1 h-2 rounded bg-white/10"><div className="h-2 rounded bg-[#C9A961]" style={{ width: `${Math.min(100, progressoEtapas)}%` }} /></div>
        </div>
      )}
      {!etapas.length && <p className="text-sm text-gray-300">Nenhuma etapa cadastrada. As etapas são livres para cada processo e não alteram o status geral.</p>}
      <ol className="space-y-2">
        {etapas.map((etapa, i) => (
          <li key={etapa.id} className="rounded-md border border-white/10 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{i + 1}. {etapa.nome}</p>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 w-32 rounded bg-white/10"><div className="h-1.5 rounded bg-[#C9A961]" style={{ width: `${etapa.progresso}%` }} /></div>
                  <span className="text-xs text-gray-300">{etapa.progresso}%</span>
                </div>
                {etapa.observacoes && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-300">{etapa.observacoes}</p>}
              </div>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" aria-label={`Subir ${etapa.nome}`} disabled={i === 0 || mover.isPending} onClick={() => mover.mutate({ id: etapa.id, direcao: -1 })}><ArrowUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label={`Descer ${etapa.nome}`} disabled={i === etapas.length - 1 || mover.isPending} onClick={() => mover.mutate({ id: etapa.id, direcao: 1 })}><ArrowDown className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label={`Editar ${etapa.nome}`} onClick={() => setEditando(etapa)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="text-red-300" aria-label={`Excluir ${etapa.nome}`} disabled={excluir.isPending} onClick={() => { if (window.confirm(`Excluir a etapa "${etapa.nome}"?`)) excluir.mutate({ id: etapa.id }); }}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent className="bg-[#1A2332] text-white">
          <DialogHeader><DialogTitle>{editando?.id ? "Editar etapa" : "Nova etapa"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Nome da etapa *</Label><Input className={campo} maxLength={120} value={editando?.nome ?? ""} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} /></div>
            <div className="space-y-1">
              <Label>Progresso (%)</Label>
              <NumeroInput className={campo} casas={0} sufixo="%" min={0} max={100} aria-label="Progresso (%)" value={editando?.progresso ?? 0}
                onChange={(v) => setEditando({ ...editando, progresso: Math.max(0, Math.min(100, Math.round(v ?? 0))) })} />
            </div>
            <div className="space-y-1"><Label>Observações</Label><Textarea className={campo} maxLength={2000} value={editando?.observacoes ?? ""} onChange={(e) => setEditando({ ...editando, observacoes: e.target.value })} /></div>
            <Button className="w-full bg-[#C9A961] text-[#1A2332]" disabled={criar.isPending || editar.isPending || (editando?.nome ?? "").trim().length < 2} onClick={salvar}>Salvar etapa</Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

interface Recebimento {
  id: number;
  itemId: number;
  item: string;
  valor: string;
  data: string;
  observacao: string | null;
  origem: "manual" | "bpo" | "migracao";
  status: "confirmado" | "cancelado";
  motivoCancelamento: string | null;
  bpoDescricao: string | null;
  autor: string | null;
}

const ORIGEM_LABEL = { manual: "Manual", bpo: "BPO", migracao: "Migrado" } as const;

export function FinanceiroRegularizacaoTabela({ regularizacaoId, financeiro, recebimentos, itensComRecebimento, onMudou }: {
  regularizacaoId: number;
  financeiro: FinanceiroRegularizacao;
  recebimentos: Recebimento[];
  itensComRecebimento: number[];
  onMudou: () => void;
}) {
  const [item, setItem] = useState<{ id?: number; nome: string; grupo: GrupoFinanceiro; previsto: string | null } | null>(null);
  const [recebendo, setRecebendo] = useState<number | null>(null);
  const [excluindo, setExcluindo] = useState<Recebimento | null>(null);
  const erro = (e: { message: string }) => toast.error(e.message);
  const criarItem = trpc.regularizacao.financeiro.criarItem.useMutation({ onSuccess: () => { toast.success("Item incluído"); setItem(null); onMudou(); }, onError: erro });
  const editarItem = trpc.regularizacao.financeiro.editarItem.useMutation({ onSuccess: () => { toast.success("Item atualizado"); setItem(null); onMudou(); }, onError: erro });
  const excluirItem = trpc.regularizacao.financeiro.excluirItem.useMutation({ onSuccess: () => { toast.success("Item excluído"); onMudou(); }, onError: erro });
  const excluir = trpc.regularizacao.financeiro.excluirRecebimento.useMutation({
    onSuccess: () => { toast.success("Recebimento excluído."); setExcluindo(null); onMudou(); },
    onError: erro,
  });

  const salvarItem = () => {
    if (!item) return;
    const dados = { nome: item.nome, grupo: item.grupo, previsto: item.previsto ?? "0" };
    if (item.id) editarItem.mutate({ id: item.id, ...dados });
    else criarItem.mutate({ regularizacaoId, ...dados });
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-[#C9A961]"><Wallet className="h-4 w-4" />Financeiro do processo</h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="gap-1 border-[#C9A961]/60 text-[#E6CA88]" onClick={() => setItem({ nome: "", grupo: "durante_obra", previsto: null })}><Plus className="h-4 w-4" />Novo item</Button>
          <Button size="sm" className="gap-1 bg-[#C9A961] text-[#1A2332]" onClick={() => setRecebendo(financeiro.linhas[0] ? Number(financeiro.linhas[0].id) : null)} disabled={!financeiro.linhas.length}><Plus className="h-4 w-4" />Registrar recebimento</Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-white/10">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-[#1A2332] text-xs uppercase text-gray-300">
            <tr><th className="p-2 text-left">Item</th><th className="p-2 text-right">Previsto</th><th className="p-2 text-right">Recebido</th><th className="p-2 text-right">Saldo</th><th className="p-2" /></tr>
          </thead>
          {GRUPOS_FINANCEIROS.map((grupo) => {
            const linhas = financeiro.linhas.filter((l) => l.grupo === grupo);
            const total = financeiro.grupos[grupo];
            return (
              <tbody key={grupo}>
                <tr className="bg-white/5"><td colSpan={5} className="p-2 text-xs font-semibold uppercase tracking-wide text-[#E6CA88]">{GRUPO_FINANCEIRO_LABEL[grupo]}</td></tr>
                {linhas.map((l) => (
                  <tr key={l.id} className="border-t border-white/5">
                    <td className="p-2">{l.nome}</td>
                    <td className="p-2 text-right whitespace-nowrap">{brl(l.previsto)}</td>
                    <td className="p-2 text-right whitespace-nowrap text-green-300">{brl(l.recebido)}</td>
                    <td className={`p-2 text-right whitespace-nowrap ${l.recebidoAMaior ? "text-red-300" : l.saldo > 0 ? "text-amber-200" : "text-gray-300"}`} title={l.recebidoAMaior ? "Recebido acima do previsto" : undefined}>{brl(l.saldo)}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <Button size="icon" variant="ghost" aria-label={`Editar ${l.nome}`} onClick={() => setItem({ id: Number(l.id), nome: l.nome, grupo: l.grupo, previsto: (l.previsto / 100).toFixed(2) })}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="text-red-300" aria-label={`Excluir ${l.nome}`}
                        disabled={excluirItem.isPending || itensComRecebimento.includes(Number(l.id))}
                        title={itensComRecebimento.includes(Number(l.id)) ? "Item com recebimentos não pode ser excluído" : undefined}
                        onClick={() => { if (window.confirm(`Excluir o item "${l.nome}"?`)) excluirItem.mutate({ id: Number(l.id) }); }}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-white/10 font-semibold">
                  <td className="p-2">Total {GRUPO_FINANCEIRO_LABEL[grupo]}</td>
                  <td className="p-2 text-right whitespace-nowrap">{brl(total.previsto)}</td>
                  <td className="p-2 text-right whitespace-nowrap text-green-300">{brl(total.recebido)}</td>
                  <td className="p-2 text-right whitespace-nowrap">{brl(total.saldo)}</td>
                  <td />
                </tr>
              </tbody>
            );
          })}
          <tfoot>
            <tr className="border-t-2 border-[#C9A961]/50 bg-[#1A2332] font-bold">
              <td className="p-2">Total geral</td>
              <td className="p-2 text-right whitespace-nowrap">{brl(financeiro.geral.previsto)}</td>
              <td className="p-2 text-right whitespace-nowrap text-green-300">{brl(financeiro.geral.recebido)}</td>
              <td className={`p-2 text-right whitespace-nowrap ${financeiro.geral.saldo < 0 ? "text-red-300" : ""}`}>{brl(financeiro.geral.saldo)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-gray-200">Histórico de recebimentos</p>
        {!recebimentos.length ? <p className="text-xs text-gray-400">Nenhum recebimento registrado.</p> : (
          <div className="overflow-x-auto rounded-md border border-white/10">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-[#1A2332] text-xs uppercase text-gray-300">
                <tr><th className="p-2 text-left">Data</th><th className="p-2 text-left">Item</th><th className="p-2 text-left">Origem</th><th className="p-2 text-right">Valor</th><th className="p-2" /></tr>
              </thead>
              <tbody>
                {recebimentos.map((r) => (
                  <tr key={r.id} className="border-t border-white/5">
                    <td className="p-2 whitespace-nowrap">{dataBr(r.data)}</td>
                    <td className="p-2">
                      <span>{r.item}</span>
                      {r.observacao && <span className="block text-xs text-gray-400">{r.observacao}</span>}
                      {r.bpoDescricao && <span className="block text-xs text-gray-400">BPO: {r.bpoDescricao}</span>}
                    </td>
                    <td className="p-2 text-gray-300">{ORIGEM_LABEL[r.origem]}</td>
                    <td className="p-2 text-right whitespace-nowrap">{brl(centavosDe(r.valor) ?? 0)}</td>
                    <td className="p-2 text-right">
                      <Button size="icon" variant="ghost" className="text-red-300" aria-label="Excluir recebimento" onClick={() => setExcluindo(r)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!item} onOpenChange={(o) => !o && setItem(null)}>
        <DialogContent className="bg-[#1A2332] text-white">
          <DialogHeader><DialogTitle>{item?.id ? "Editar item" : "Novo item"}</DialogTitle></DialogHeader>
          {item && (
            <div className="space-y-3">
              <div className="space-y-1"><Label>Nome *</Label><Input className={campo} maxLength={120} value={item.nome} onChange={(e) => setItem({ ...item, nome: e.target.value })} /></div>
              <div className="space-y-1">
                <Label>Grupo</Label>
                <Select value={item.grupo} onValueChange={(g) => setItem({ ...item, grupo: g as GrupoFinanceiro })}>
                  <SelectTrigger className={campo}><SelectValue /></SelectTrigger>
                  <SelectContent>{GRUPOS_FINANCEIROS.map((g) => <SelectItem key={g} value={g}>{GRUPO_FINANCEIRO_LABEL[g]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Previsto</Label><CampoDecimal valor={item.previsto} onChange={(v) => setItem({ ...item, previsto: v })} prefixo="R$" placeholder="0,00" /></div>
              <Button className="w-full bg-[#C9A961] text-[#1A2332]" disabled={criarItem.isPending || editarItem.isPending || item.nome.trim().length < 2} onClick={salvarItem}>Salvar item</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {recebendo !== null && (
        <NovoRecebimento regularizacaoId={regularizacaoId} itens={financeiro.linhas.map((l) => ({ id: Number(l.id), nome: l.nome }))} itemInicial={recebendo}
          onFechar={() => setRecebendo(null)} onMudou={onMudou} />
      )}

      <Dialog open={!!excluindo} onOpenChange={(o) => !o && setExcluindo(null)}>
        <DialogContent className="bg-[#1A2332] text-white">
          <DialogHeader><DialogTitle>Excluir recebimento</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-300">
            {excluindo?.item} — {excluindo ? brl(centavosDe(excluindo.valor) ?? 0) : ""}. O recebimento será removido definitivamente e sai dos totais. Esta ação não pode ser desfeita.
            {excluindo?.origem === "bpo" && " O lançamento original no BPO não é alterado (o valor volta a ficar disponível)."}
          </p>
          <Button className="bg-red-500 hover:bg-red-600" disabled={excluir.isPending} onClick={() => excluindo && excluir.mutate({ id: excluindo.id })}>Excluir definitivamente</Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function NovoRecebimento({ regularizacaoId, itens, itemInicial, onFechar, onMudou }: {
  regularizacaoId: number;
  itens: { id: number; nome: string }[];
  itemInicial: number;
  onFechar: () => void;
  onMudou: () => void;
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [itemId, setItemId] = useState(String(itemInicial));
  const [origem, setOrigem] = useState<"manual" | "bpo">("manual");
  const [bpoId, setBpoId] = useState("");
  const [valor, setValor] = useState<string | null>(null);
  const [data, setData] = useState(hoje);
  const [observacao, setObservacao] = useState("");
  const disponiveis = trpc.regularizacao.financeiro.bpoDisponiveis.useQuery(undefined, { enabled: origem === "bpo" });
  const adicionar = trpc.regularizacao.financeiro.adicionarRecebimento.useMutation({
    onSuccess: () => { toast.success("Recebimento registrado."); onFechar(); onMudou(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg bg-[#1A2332] text-white">
        <DialogHeader><DialogTitle>Registrar recebimento</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Item</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger className={campo}><SelectValue /></SelectTrigger>
              <SelectContent>{itens.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Origem</Label>
            <Select value={origem} onValueChange={(v) => setOrigem(v as "manual" | "bpo")}>
              <SelectTrigger className={campo}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Recebimento manual</SelectItem>
                <SelectItem value="bpo">Vincular receita do BPO Financeiro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {origem === "bpo" && (
            <div className="space-y-1">
              <Label>Receita do BPO (recebida)</Label>
              <Select value={bpoId} onValueChange={(v) => {
                setBpoId(v);
                const b = disponiveis.data?.find((x) => String(x.id) === v);
                if (b) setValor((b.disponivelCentavos / 100).toFixed(2));
              }}>
                <SelectTrigger className={campo}><SelectValue placeholder={disponiveis.isLoading ? "Carregando..." : "Selecione"} /></SelectTrigger>
                <SelectContent>{(disponiveis.data ?? []).map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.descricao} · disponível {brl(b.disponivelCentavos)}</SelectItem>)}</SelectContent>
              </Select>
              {disponiveis.data?.length === 0 && <p className="text-xs text-gray-400">Nenhuma receita recebida com saldo disponível no BPO.</p>}
              <p className="text-xs text-gray-400">Pode usar parte do valor; o restante continua disponível. A mesma receita nunca é usada duas vezes (obras e regularizações somadas).</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Valor</Label><CampoDecimal valor={valor} onChange={setValor} prefixo="R$" placeholder="0,00" /></div>
            <div className="space-y-1"><Label>Data</Label><Input className={campo} type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label>Observação (opcional)</Label><Textarea className={campo} rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} /></div>
          <Button className="w-full bg-[#C9A961] text-[#1A2332]"
            disabled={adicionar.isPending || !valor || Number(valor) <= 0 || !data || (origem === "bpo" && !bpoId)}
            onClick={() => adicionar.mutate({
              regularizacaoId,
              itemId: Number(itemId),
              valor: valor!,
              data,
              observacao: observacao || undefined,
              bpoLancamentoId: origem === "bpo" ? Number(bpoId) : undefined,
            })}>
            Registrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
