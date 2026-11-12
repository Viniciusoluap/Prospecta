// Pedido de 12/11 (noite): aba "A classificar" do BPO. Nada do banco entra em Cobranças/Despesas/DRE sem o
// dono classificar, exceto o que o sistema já liga com segurança (Asaas, Conta Azul pago, regra por titular).
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/format";
import { CurrencyInput } from "@/components/ui/currency-input";
import { normalizarTitular } from "@shared/financeiro/bpo-extrato";
import { CampoCentroCusto } from "@/components/bpo/CentrosCusto";
import { CATEGORIAS_BPO, TRANSFERENCIA_INTERNA, type CategoriaBpo } from "@shared/financeiro/bpo-extrato";
import { CONFIRMACAO_EXCLUSAO, confirmacaoExclusaoValida } from "@shared/financeiro/bpo-lote";

const CATEGORIAS = CATEGORIAS_BPO.filter(c => c !== TRANSFERENCIA_INTERNA);
const dataBR = (d: string | Date) => new Date(d).toLocaleDateString("pt-BR", { timeZone: "UTC" });
const selectCls = "mt-1 h-10 w-full rounded-md border border-[#C9A961]/30 bg-[#2C3E50] px-2 text-white";
const botaoSec = "h-8 text-xs border-[#C9A961]/30 text-[#C9A961]";

type Cliente = { id: number; razaoSocial: string };
export type MovimentacaoAClassificar = {
  id: number; data: string | Date; descricao: string; valor: string; tipo: "credito" | "debito"; categoria: string | null;
  titular: string | null; bpoClienteId: number | null; conta: string;
};
export type LancamentoAClassificar = {
  id: number; tipo: string; descricao: string; valor: string; valorRecebido: string; vencimento: string | Date; competencia: string;
  pago: boolean; categoria: string | null; centroCustos: string | null; clienteNome: string | null; asaasPaymentId: string | null; bankTransactionId: number | null;
  clienteId: number | null;
};

function useInvalidar() {
  const utils = trpc.useUtils();
  return () => {
    utils.bpo.aClassificar.invalidate();
    utils.bpo.lancamentos.list.invalidate();
    utils.bpo.dre.invalidate(); utils.bpo.dreCategorias.invalidate(); utils.bpo.dreAnos.invalidate();
    utils.bpo.clientes.list.invalidate();
  };
}

export function AClassificarPanel({ clientes, onReceber, onMarcarPago, filtrar }: {
  clientes: Cliente[];
  onReceber: (l: LancamentoAClassificar) => void;
  onMarcarPago: (id: number) => void;
  /** Bloco 4: filtros da tela aplicados às duas listas. */
  filtrar?: { movimentacoes: (m: MovimentacaoAClassificar[]) => MovimentacaoAClassificar[]; lancamentos: (l: LancamentoAClassificar[]) => LancamentoAClassificar[] };
}) {
  const invalidar = useInvalidar();
  const { data: movsTodas = [], isLoading: carregandoMovs } = trpc.bpo.aClassificar.movimentacoes.useQuery();
  const { data: lancsTodos = [], isLoading: carregandoLancs } = trpc.bpo.aClassificar.lancamentos.useQuery();
  const movs = filtrar ? filtrar.movimentacoes(movsTodas as MovimentacaoAClassificar[]) : (movsTodas as MovimentacaoAClassificar[]);
  const lancs = filtrar ? filtrar.lancamentos(lancsTodos as LancamentoAClassificar[]) : (lancsTodos as LancamentoAClassificar[]);
  const [selMovs, setSelMovs] = useState<number[]>([]);
  const [selLancs, setSelLancs] = useState<number[]>([]);
  const [criando, setCriando] = useState<number[] | null>(null);
  const [cancelando, setCancelando] = useState<number[] | null>(null);
  const [baixando, setBaixando] = useState<MovimentacaoAClassificar | null>(null);
  // Só age sobre o que está visível (o filtro esconde o resto).
  const visMovs = new Set(movs.map(m => m.id));
  const visLancs = new Set(lancs.map(l => l.id));
  const movsSel = selMovs.filter(id => visMovs.has(id));
  const lancsSel = selLancs.filter(id => visLancs.has(id));

  const ignorar = trpc.bpo.aClassificar.ignorar.useMutation({
    onSuccess: r => { toast.success(`${r.ignoradas} movimentação(ões) marcada(s) como transferência interna.`); setSelMovs([]); invalidar(); },
    onError: e => toast.error(e.message),
  });
  const confirmar = trpc.bpo.aClassificar.confirmar.useMutation({
    onSuccess: r => { toast.success(`${r.confirmados} lançamento(s) confirmado(s) — agora em Cobranças/Despesas.`); setSelLancs([]); invalidar(); },
    onError: e => toast.error(e.message),
  });

  const total = (xs: { valor: string; tipo: string }[]) => xs.reduce((t, x) => t + (x.tipo === "credito" || (x.tipo !== "debito" && x.tipo !== "despesa") ? 1 : -1) * Math.round(Number(x.valor) * 100), 0) / 100;

  return (
    <div className="space-y-6">
      <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
        <CardHeader>
          <CardTitle className="text-[#C9A961]">Movimentações do banco ({movs.length}{movs.length !== movsTodas.length ? ` de ${movsTodas.length}` : ""})</CardTitle>
          <p className="text-xs text-gray-400">Chegaram do banco sem correspondência segura. Só entram em Cobranças, Despesas e DRE quando você criar o lançamento ou der baixa. Saldo líquido das visíveis: {formatCurrency(total(movs))}.</p>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-[#1A2332] p-2 text-sm">
            <label className="flex items-center gap-2 px-1">
              <input type="checkbox" aria-label="Selecionar todas as movimentações visíveis" checked={movs.length > 0 && movs.every(m => selMovs.includes(m.id))}
                onChange={e => setSelMovs(e.target.checked ? movs.map(m => m.id) : [])} />
              Selecionar todas ({movs.length})
            </label>
            <span className="text-gray-400">{movsSel.length} selecionada(s)</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className={botaoSec} disabled={!movsSel.length} onClick={() => setCriando(movsSel)}>Criar lançamento</Button>
              <Button size="sm" variant="outline" className={botaoSec} disabled={!movsSel.length || ignorar.isPending} onClick={() => ignorar.mutate({ ids: movsSel })}>Transferência interna / ignorar</Button>
            </div>
          </div>
          {carregandoMovs ? <p className="text-sm text-gray-400">Carregando…</p> : movs.length === 0 ? (
            <p className="py-8 text-center text-gray-400">Nenhuma movimentação esperando classificação.</p>
          ) : (
            <div className="space-y-2">
              {movs.map(m => (
                <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-[#1A2332] p-3">
                  <input type="checkbox" className="h-4 w-4 shrink-0" aria-label={`Selecionar ${m.descricao}`} checked={selMovs.includes(m.id)}
                    onChange={e => setSelMovs(e.target.checked ? [...selMovs, m.id] : selMovs.filter(x => x !== m.id))} />
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="font-medium text-white break-words">{m.titular ? `${m.titular} — ` : ""}{m.descricao}</p>
                    <p className="text-xs text-gray-400">{dataBR(m.data)} • {m.conta} • {m.tipo === "credito" ? "entrada" : "saída"}{m.categoria ? ` • sugestão: ${m.categoria}` : ""}</p>
                  </div>
                  <span className={`font-bold ${m.tipo === "credito" ? "text-green-400" : "text-red-400"}`}>{m.tipo === "credito" ? "" : "−"}{formatCurrency(Number(m.valor))}</span>
                  <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                    <Button size="sm" variant="outline" className={botaoSec} onClick={() => setCriando([m.id])}>Criar lançamento</Button>
                    <Button size="sm" variant="outline" className={botaoSec} onClick={() => setBaixando(m)}>Dar baixa / dividir</Button>
                    <Button size="sm" variant="outline" className={botaoSec} disabled={ignorar.isPending} onClick={() => ignorar.mutate({ ids: [m.id] })}>Transferência interna / ignorar</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-[#2C3E50] border-[#C9A961]/20 text-gray-100">
        <CardHeader>
          <CardTitle className="text-[#C9A961]">Lançamentos em aberto a classificar ({lancs.length}{lancs.length !== lancsTodos.length ? ` de ${lancsTodos.length}` : ""})</CardTitle>
          <p className="text-xs text-gray-400">Em aberto que vieram de fora (ex.: backup do Conta Azul). Ficam fora de Cobranças, Despesas, DRE e totais até você confirmar. Total visível: {formatCurrency(total(lancs))}.</p>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-[#1A2332] p-2 text-sm">
            <label className="flex items-center gap-2 px-1">
              <input type="checkbox" aria-label="Selecionar todos os lançamentos visíveis" checked={lancs.length > 0 && lancs.every(l => selLancs.includes(l.id))}
                onChange={e => setSelLancs(e.target.checked ? lancs.map(l => l.id) : [])} />
              Selecionar todos ({lancs.length})
            </label>
            <span className="text-gray-400">{lancsSel.length} selecionado(s)</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className={botaoSec} disabled={!lancsSel.length || confirmar.isPending} onClick={() => confirmar.mutate({ ids: lancsSel })}>Confirmar</Button>
              <Button size="sm" variant="destructive" className="h-8 text-xs" disabled={!lancsSel.length} onClick={() => setCancelando(lancsSel)}>Cancelar</Button>
            </div>
          </div>
          {carregandoLancs ? <p className="text-sm text-gray-400">Carregando…</p> : lancs.length === 0 ? (
            <p className="py-8 text-center text-gray-400">Nenhum lançamento esperando classificação.</p>
          ) : (
            <div className="space-y-2">
              {lancs.map(l => {
                const saldo = (Math.round(Number(l.valor) * 100) - Math.round(Number(l.valorRecebido) * 100)) / 100;
                const recebivel = l.tipo !== "despesa" && !l.asaasPaymentId && !l.bankTransactionId;
                return (
                  <div key={l.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-[#1A2332] p-3">
                    <input type="checkbox" className="h-4 w-4 shrink-0" aria-label={`Selecionar ${l.descricao}`} checked={selLancs.includes(l.id)}
                      onChange={e => setSelLancs(e.target.checked ? [...selLancs, l.id] : selLancs.filter(x => x !== l.id))} />
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="font-medium text-white break-words">{l.descricao}</p>
                      <p className="text-xs text-gray-400">
                        {l.clienteNome || "—"} • {l.tipo === "despesa" ? "Despesa" : "Cobrança"} • {l.categoria || "sem categoria"} • vence {dataBR(l.vencimento)} • comp. {l.competencia}
                        {l.centroCustos ? ` • centro de custo: ${l.centroCustos}` : ""}
                      </p>
                      {Number(l.valorRecebido) > 0 && <p className="text-xs text-gray-300">Recebido {formatCurrency(Number(l.valorRecebido))} · Saldo {formatCurrency(saldo)}</p>}
                    </div>
                    <span className={`font-bold ${l.tipo === "despesa" ? "text-red-400" : "text-green-400"}`}>{formatCurrency(Number(l.valor))}</span>
                    <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                      <Button size="sm" variant="outline" className={botaoSec} disabled={confirmar.isPending} onClick={() => confirmar.mutate({ ids: [l.id] })}>Confirmar</Button>
                      {recebivel
                        ? <Button size="sm" variant="outline" className={botaoSec} onClick={() => onReceber(l)}>Registrar recebimento</Button>
                        : <Button size="sm" variant="outline" className="h-8 text-xs border-green-500/30 text-green-400" onClick={() => onMarcarPago(l.id)}>Marcar pago</Button>}
                      <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={() => setCancelando([l.id])}>Cancelar</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {criando && <CriarLancamentoDialog ids={criando} movs={movs.filter(m => criando.includes(m.id))} clientes={clientes}
        onFechar={ok => { setCriando(null); if (ok) { setSelMovs([]); invalidar(); } }} />}
      {baixando && <DarBaixaDialog mov={baixando} onFechar={ok => { setBaixando(null); if (ok) invalidar(); }} />}
      {cancelando && <CancelarDialog ids={cancelando} onFechar={ok => { setCancelando(null); if (ok) { setSelLancs([]); invalidar(); } }} />}
    </div>
  );
}

function CriarLancamentoDialog({ ids, movs, clientes, onFechar }: { ids: number[]; movs: MovimentacaoAClassificar[]; clientes: Cliente[]; onFechar: (ok: boolean) => void }) {
  const um = movs.length === 1 ? movs[0] : null;
  const sugestao = um && um.categoria && (CATEGORIAS as readonly string[]).includes(um.categoria) ? um.categoria : "";
  const [categoria, setCategoria] = useState<string>(sugestao);
  // "manter" = cada movimentação fica com o cliente que já tinha (sugerido pelo titular).
  const [cliente, setCliente] = useState<string>(um?.bpoClienteId ? String(um.bpoClienteId) : "manter");
  const [centroCustos, setCentroCustos] = useState<string | null>(null);
  const criar = trpc.bpo.aClassificar.criarLancamentos.useMutation({
    onSuccess: r => { toast.success(`${r.classificadas} lançamento(s) criado(s).`); onFechar(true); },
    onError: e => toast.error(e.message),
  });
  const totalCent = movs.reduce((t, m) => t + (m.tipo === "credito" ? 1 : -1) * Math.round(Number(m.valor) * 100), 0);
  return (
    <Dialog open onOpenChange={o => !o && onFechar(false)}>
      <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-[#C9A961]">Criar lançamento{ids.length > 1 ? ` (${ids.length} movimentações)` : ""}</DialogTitle></DialogHeader>
        <p className="text-sm text-gray-300">{um ? `${dataBR(um.data)} • ${um.titular ? `${um.titular} — ` : ""}${um.descricao}` : `${movs.length} movimentação(ões) selecionada(s)`} • {formatCurrency(Math.abs(totalCent) / 100)}</p>
        <p className="text-xs text-gray-400">Entrada vira cobrança paga; saída vira despesa paga, na data do banco.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="col-span-full">
            <Label className="text-gray-300">Categoria *</Label>
            <select aria-label="Categoria" className={selectCls} value={categoria} onChange={e => setCategoria(e.target.value)}>
              <option value="">Escolha…</option>
              {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-span-full">
            <Label className="text-gray-300">Cliente BPO</Label>
            <select aria-label="Cliente BPO" className={selectCls} value={cliente} onChange={e => setCliente(e.target.value)}>
              <option value="manter">{um ? "Sem alteração" : "Manter o de cada movimentação"}</option>
              <option value="nenhum">Nenhum</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.razaoSocial}</option>)}
            </select>
          </div>
          <CampoCentroCusto className="col-span-full" valor={centroCustos} onChange={setCentroCustos} />
        </div>
        <Button className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold" disabled={!categoria || criar.isPending}
          onClick={() => criar.mutate({
            ids, categoria: categoria as CategoriaBpo,
            ...(cliente === "manter" ? {} : { bpoClienteId: cliente === "nenhum" ? null : Number(cliente) }),
            ...(centroCustos ? { centroCustos } : {}),
          })}>
          {criar.isPending ? "Criando…" : "Criar lançamento"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/** Cancelar = arquivamento reversível (backup + histórico; volta em Exclusões em lote → Restaurar). */
function CancelarDialog({ ids, onFechar }: { ids: number[]; onFechar: (ok: boolean) => void }) {
  const [confirmacao, setConfirmacao] = useState("");
  const entrada = { aba: "a_classificar" as const, modo: "selecionados" as const, ids, limpezaAjustes: true };
  const { data: previa, isFetching } = trpc.bpo.lancamentos.previaExclusao.useQuery(entrada);
  const excluir = trpc.bpo.lancamentos.excluirLote.useMutation({
    onSuccess: r => { toast.success(`${r.excluidos} lançamento(s) cancelado(s)${r.backupId ? ` · backup #${r.backupId}` : ""}.`); onFechar(true); },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={o => !o && onFechar(false)}>
      <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white">
        <DialogHeader><DialogTitle className="text-red-300">Cancelar {ids.length} lançamento(s)</DialogTitle></DialogHeader>
        <p className="text-sm text-gray-300">Os lançamentos saem do BPO, mas nada é apagado: fica um backup e o histórico, e dá para restaurar em Cobranças › Exclusões em lote.</p>
        {isFetching && !previa && <p className="text-sm text-gray-400">Calculando…</p>}
        {previa && <>
          <p className="text-sm">Serão cancelados: <strong>{previa.excluiveis}</strong></p>
          <Label>Para confirmar, digite <strong>{CONFIRMACAO_EXCLUSAO}</strong></Label>
          <Input value={confirmacao} onChange={e => setConfirmacao(e.target.value)} autoComplete="off" className="bg-[#2C3E50] border-[#C9A961]/30" />
          <Button className="w-full bg-red-700 hover:bg-red-800" disabled={isFetching || !previa.excluiveis || !confirmacaoExclusaoValida(confirmacao) || excluir.isPending}
            onClick={() => excluir.mutate({ ...entrada, confirmacao, previaToken: previa.previaToken })}>
            {excluir.isPending ? "Cancelando…" : `Cancelar ${previa.excluiveis} lançamento(s)`}
          </Button>
        </>}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Bloco 2: dar baixa / dividir. A movimentação quita um ou vários lançamentos em aberto do mesmo sentido
 * (crédito ↔ cobrança, débito ↔ despesa). A soma aplicada tem que ser exatamente o valor da movimentação; valor
 * menor que o saldo de um lançamento é baixa parcial (ele só fica pago quando o recebido fecha o valor).
 */
function DarBaixaDialog({ mov, onFechar }: { mov: MovimentacaoAClassificar; onFechar: (ok: boolean) => void }) {
  const { data, isLoading, error } = trpc.bpo.aClassificar.abertosParaBaixa.useQuery({ movimentacaoId: mov.id });
  const [valores, setValores] = useState<Record<number, number>>({});
  const [busca, setBusca] = useState("");
  const darBaixa = trpc.bpo.aClassificar.darBaixa.useMutation({
    onSuccess: r => {
      const quitados = r.alocacoes.filter(a => a.pago).length;
      toast.success(`Baixa registrada em ${r.alocacoes.length} lançamento(s): ${quitados} quitado(s), ${r.alocacoes.length - quitados} parcial(is).`);
      onFechar(true);
    },
    onError: e => toast.error(e.message),
  });
  const cent = (v: number | string) => Math.round(Number(v) * 100);
  const totalMov = cent(mov.valor);
  const escolhidos = Object.entries(valores).filter(([, v]) => v > 0).map(([id, v]) => ({ lancamentoId: Number(id), valor: v }));
  const soma = escolhidos.reduce((t, a) => t + cent(a.valor), 0);
  const abertos = data?.abertos ?? [];
  const saldoDe = (l: { valor: string; valorRecebido: string }) => cent(l.valor) - cent(l.valorRecebido);
  const acimaDoSaldo = escolhidos.some(a => { const l = abertos.find(x => x.id === a.lancamentoId); return !l || cent(a.valor) > saldoDe(l); });
  const sugeridos = new Set(data?.sugeridos ?? []);
  const termo = normalizarTitular(busca);
  const lista = [
    ...(data?.sugeridos ?? []).map(id => abertos.find(l => l.id === id)).filter((l): l is (typeof abertos)[number] => Boolean(l)),
    ...abertos.filter(l => !sugeridos.has(l.id) && (valores[l.id] > 0 || (termo.length >= 2 && normalizarTitular(`${l.descricao} ${l.clienteNome ?? ""} ${l.valor}`).includes(termo)))),
  ];
  const marcar = (l: (typeof abertos)[number], on: boolean) => {
    if (!on) { const { [l.id]: _, ...resto } = valores; setValores(resto); return; }
    const restante = Math.max(0, totalMov - soma);
    setValores({ ...valores, [l.id]: Math.min(saldoDe(l), restante) / 100 });
  };
  return (
    <Dialog open onOpenChange={o => !o && onFechar(false)}>
      <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle className="text-[#C9A961]">Dar baixa / dividir</DialogTitle></DialogHeader>
        <p className="text-sm text-gray-200">{dataBR(mov.data)} • {mov.titular ? `${mov.titular} — ` : ""}{mov.descricao} • <strong>{formatCurrency(totalMov / 100)}</strong> ({mov.tipo === "credito" ? "entrada: baixa cobranças" : "saída: baixa despesas"})</p>
        {error && <p className="text-sm text-red-300">{error.message}</p>}
        {isLoading && <p className="text-sm text-gray-400">Buscando lançamentos em aberto…</p>}
        {data && <>
          <div>
            <Label className="text-gray-300">Procurar outro lançamento em aberto</Label>
            <Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="cliente, descrição ou valor" className="bg-[#2C3E50] border-[#C9A961]/30 mt-1" />
          </div>
          {lista.length === 0 ? <p className="text-sm text-gray-400">{abertos.length ? "Nenhuma sugestão. Procure pelo nome, descrição ou valor." : "Não há lançamentos em aberto deste sentido."}</p> : (
            <ul className="divide-y divide-white/5 rounded border border-white/10">
              {lista.map(l => {
                const marcado = valores[l.id] !== undefined;
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 p-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" aria-label={`Usar ${l.descricao}`} checked={marcado} onChange={e => marcar(l, e.target.checked)} />
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="break-words">{l.descricao}{sugeridos.has(l.id) && <span className="ml-1 text-xs text-[#C9A961]">sugestão</span>}{l.aClassificar && <span className="ml-1 text-xs text-amber-300">a classificar</span>}</p>
                      <p className="text-xs text-gray-400">{l.clienteNome || "—"} • vence {dataBR(l.vencimento)} • saldo {formatCurrency(saldoDe(l) / 100)}{cent(l.valorRecebido) > 0 ? ` de ${formatCurrency(cent(l.valor) / 100)}` : ""}</p>
                    </div>
                    {marcado && <div className="w-full sm:w-40"><CurrencyInput aria-label={`Valor aplicado em ${l.descricao}`} value={valores[l.id]} onChange={v => setValores({ ...valores, [l.id]: v })} className="bg-[#2C3E50] border-[#C9A961]/30" /></div>}
                  </li>
                );
              })}
            </ul>
          )}
          <div className={`rounded p-2 text-sm ${soma === totalMov && !acimaDoSaldo ? "bg-green-900/30 text-green-200" : "bg-amber-900/30 text-amber-200"}`}>
            Aplicado {formatCurrency(soma / 100)} de {formatCurrency(totalMov / 100)}
            {soma < totalMov ? ` — faltam ${formatCurrency((totalMov - soma) / 100)}` : soma > totalMov ? ` — passou ${formatCurrency((soma - totalMov) / 100)}` : ""}
            {acimaDoSaldo ? " — algum valor passa do saldo do lançamento" : ""}
          </div>
          <p className="text-xs text-gray-400">Valor menor que o saldo = baixa parcial (o lançamento fica em aberto com o saldo). A movimentação sai de A classificar e não vira lançamento próprio.</p>
          <Button className="w-full bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold" disabled={!escolhidos.length || soma !== totalMov || acimaDoSaldo || darBaixa.isPending}
            onClick={() => darBaixa.mutate({ movimentacaoId: mov.id, alocacoes: escolhidos })}>
            {darBaixa.isPending ? "Registrando…" : "Confirmar baixa"}
          </Button>
        </>}
      </DialogContent>
    </Dialog>
  );
}
