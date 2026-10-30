import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/format";
import { CONFIRMACAO_EXCLUSAO, ROTULOS_PROTECAO, confirmacaoExclusaoValida, type FiltrosLote, type MotivoProtecao } from "@shared/financeiro/bpo-lote";

type Aba = "cobrancas" | "despesas";

/**
 * Lote 3, item 16: barra de ações em lote de Cobranças/Despesas. "Excluir" age nos selecionados;
 * "Excluir tudo" alcança a aba inteira no servidor (com os filtros atuais). Protegidos nunca são
 * apagados; toda exclusão pede EXCLUIR, gera backup recuperável e fica no histórico.
 */
export function BarraLote({ aba, visiveis, selecionados, setSelecionados, filtros, onSugerirVinculos }: {
  aba: Aba;
  visiveis: number[];
  selecionados: number[];
  setSelecionados: (ids: number[]) => void;
  filtros: FiltrosLote;
  onSugerirVinculos: () => void;
}) {
  const [exclusao, setExclusao] = useState<null | "selecionados" | "tudo">(null);
  const [combinando, setCombinando] = useState(false);
  const todosMarcados = visiveis.length > 0 && visiveis.every(id => selecionados.includes(id));
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-[#1A2332] p-2 text-sm">
      <label className="flex items-center gap-2 px-1">
        <input type="checkbox" checked={todosMarcados} aria-label="Selecionar todos da página"
          onChange={e => setSelecionados(e.target.checked ? Array.from(new Set([...selecionados, ...visiveis])) : selecionados.filter(id => !visiveis.includes(id)))} />
        Selecionar todos ({visiveis.length})
      </label>
      <span className="text-gray-400">{selecionados.length} selecionado(s)</span>
      <div className="ml-auto flex flex-wrap gap-2">
        {aba === "cobrancas" && <Button size="sm" variant="outline" className="h-8 border-[#C9A961]/30 text-[#C9A961]" disabled={selecionados.length < 2} onClick={() => setCombinando(true)}>Combinar pagamentos</Button>}
        <Button size="sm" variant="outline" className="h-8 border-[#C9A961]/30 text-[#C9A961]" onClick={onSugerirVinculos}>Sugerir vínculos</Button>
        <Button size="sm" variant="destructive" className="h-8" disabled={!selecionados.length} onClick={() => setExclusao("selecionados")}>Excluir</Button>
        <Button size="sm" variant="destructive" className="h-8" onClick={() => setExclusao("tudo")}>Excluir tudo</Button>
      </div>
      {exclusao && <ExcluirLoteDialog aba={aba} modo={exclusao} ids={selecionados} filtros={filtros}
        onFechar={ok => { setExclusao(null); if (ok) setSelecionados([]); }} />}
      {combinando && <CombinarDialog ids={selecionados} onFechar={ok => { setCombinando(false); if (ok) setSelecionados([]); }} />}
    </div>
  );
}

function ExcluirLoteDialog({ aba, modo, ids, filtros, onFechar }: { aba: Aba; modo: "selecionados" | "tudo"; ids: number[]; filtros: FiltrosLote; onFechar: (ok: boolean) => void }) {
  const utils = trpc.useUtils();
  const [confirmacao, setConfirmacao] = useState("");
  const entrada = { aba, modo, ...(modo === "selecionados" ? { ids } : { filtros }) };
  const { data: previa, isFetching } = trpc.bpo.lancamentos.previaExclusao.useQuery(entrada);
  const excluir = trpc.bpo.lancamentos.excluirLote.useMutation({
    onSuccess: r => {
      toast.success(`${r.excluidos} lançamento(s) excluído(s)${r.backupId ? ` · backup #${r.backupId}` : ""}. ${r.protegidos} protegido(s) preservado(s).`);
      utils.bpo.lancamentos.list.invalidate(); utils.bpo.dre.invalidate(); utils.bpo.dreCategorias.invalidate(); utils.bpo.clientes.list.invalidate();
      onFechar(true);
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={o => !o && onFechar(false)}>
      <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-red-300">{modo === "tudo" ? `Excluir tudo — ${aba === "cobrancas" ? "Cobranças" : "Despesas"}` : "Excluir selecionados"}</DialogTitle></DialogHeader>
        {isFetching && !previa && <p className="text-sm text-gray-400">Calculando impacto…</p>}
        {previa && <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 rounded border border-white/10 p-3">
            <p>Total da aba: <strong>{previa.totalAba}</strong></p>
            <p>Selecionados: <strong>{previa.selecionados}</strong></p>
            <p>{modo === "tudo" ? "Alcançados pelo filtro" : "Alcançados"}: <strong>{previa.alcancados}</strong></p>
            <p className="text-red-300">Serão excluídos: <strong>{previa.excluiveis}</strong></p>
            <p className="col-span-2 text-amber-300">Protegidos (não serão apagados): <strong>{previa.protegidos}</strong></p>
          </div>
          {previa.protegidos > 0 && <ul className="list-disc pl-5 text-xs text-gray-300">
            {(Object.entries(previa.porMotivo) as [MotivoProtecao, number][]).map(([m, n]) => <li key={m}>{n} {ROTULOS_PROTECAO[m]}</li>)}
          </ul>}
          <p className="text-xs text-gray-300">Antes de apagar, é gravado um backup JSON recuperável e o histórico de cada lançamento (usuário e data). Somente administradores.</p>
          <Label>Para confirmar, digite <strong>{CONFIRMACAO_EXCLUSAO}</strong></Label>
          <Input value={confirmacao} onChange={e => setConfirmacao(e.target.value)} autoComplete="off" className="bg-[#2C3E50] border-[#C9A961]/30" />
          <Button className="w-full bg-red-700 hover:bg-red-800" disabled={!previa.excluiveis || !confirmacaoExclusaoValida(confirmacao) || excluir.isPending}
            onClick={() => excluir.mutate({ ...entrada, confirmacao })}>
            {excluir.isPending ? "Gravando backup e excluindo…" : `Excluir ${previa.excluiveis} lançamento(s)`}
          </Button>
        </div>}
      </DialogContent>
    </Dialog>
  );
}

function CombinarDialog({ ids, onFechar }: { ids: number[]; onFechar: (ok: boolean) => void }) {
  const utils = trpc.useUtils();
  const [requestKey] = useState(() => crypto.randomUUID());
  const { data: previa, isFetching } = trpc.bpo.lancamentos.previaCombinacao.useQuery({ ids });
  const combinar = trpc.bpo.lancamentos.combinar.useMutation({
    onSuccess: r => {
      toast.success(`${r.combinadas} cobranças combinadas na #${r.novaId} (${formatCurrency(r.total)}).`);
      utils.bpo.lancamentos.list.invalidate(); utils.bpo.dre.invalidate(); utils.bpo.dreCategorias.invalidate(); utils.bpo.clientes.list.invalidate();
      onFechar(true);
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={o => !o && onFechar(false)}>
      <DialogContent className="bg-[#1A2332] border-[#C9A961]/20 text-white max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-[#C9A961]">Combinar pagamentos</DialogTitle></DialogHeader>
        {isFetching && !previa && <p className="text-sm text-gray-400">Validando…</p>}
        {previa && (previa.ok ? (
          <div className="space-y-3 text-sm">
            <p>Será criada uma nova cobrança de <strong>{formatCurrency(previa.total)}</strong>, vencendo em <strong>{new Date(previa.vencimento).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</strong> (competência {previa.competencia}).</p>
            <p className="text-xs text-gray-300">{previa.descricao}</p>
            <p className="text-xs text-gray-300">As {ids.length} cobranças originais NÃO são apagadas: ficam marcadas como combinadas (rastreáveis no histórico) e saem dos totais para não contar em dobro.</p>
            <Button className="w-full bg-[#C9A961] text-[#1A2332]" disabled={combinar.isPending} onClick={() => combinar.mutate({ ids, requestKey })}>
              {combinar.isPending ? "Combinando…" : "Confirmar combinação"}
            </Button>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="text-red-300">Não é possível combinar estas cobranças:</p>
            <ul className="list-disc pl-5 text-xs">
              {previa.erros.map(e => <li key={e}>{e}</li>)}
              {previa.bloqueados.map(b => <li key={String(b.id)}>Cobrança #{b.id}: {b.motivo}</li>)}
            </ul>
          </div>
        ))}
      </DialogContent>
    </Dialog>
  );
}
