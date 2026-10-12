import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { HeartHandshake, Plus, Trash2 } from "lucide-react";
import { resumoAtendimentoClientes, TIPOS_CHAMADO, type ChamadoAtendimento, type StatusChamado, type TipoChamado } from "@shared/incorporacao/atendimento-clientes";
import { RelatorioExecutivo } from "@/components/incorporacao/RelatorioExecutivo";
import type { EstudoParaRelatorioExecutivo } from "@shared/incorporacao/relatorio-executivo";

const cardCls = "bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm";
const inputCls = "bg-[#2C3E50] border-[#C9A961]/30 text-white";
const selectCls = "bg-[#2C3E50] border border-[#C9A961]/30 text-white rounded-md px-2 h-9 text-sm w-full";

function Metric({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className={`rounded-lg p-3 border ${destaque ? "bg-[#C9A961]/10 border-[#C9A961]/40" : "bg-[#0F1923] border-[#C9A961]/10"}`}>
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`font-black text-base leading-tight ${destaque ? "text-[#C9A961]" : "text-white"}`}>{valor}</p>
    </div>
  );
}

export function AtendimentoRelatorio({ estudoId, customerServiceJson, estudo }: {
  estudoId: number; customerServiceJson: string | null; estudo: EstudoParaRelatorioExecutivo;
}) {
  return (
    <div className="space-y-6">
      <AtendimentoClientes estudoId={estudoId} customerServiceJson={customerServiceJson} />
      <RelatorioExecutivo estudo={estudo} />
    </div>
  );
}

const STATUS_CHAMADO: { value: StatusChamado; label: string }[] = [
  { value: "aberto", label: "Aberto" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "concluido", label: "Concluído" },
];
function novoChamado(): ChamadoAtendimento {
  return { id: Math.random().toString(36).slice(2), cliente: "", tipo: "Repasse Bancário", status: "aberto" };
}

function AtendimentoClientes({ estudoId, customerServiceJson }: { estudoId: number; customerServiceJson: string | null }) {
  const utils = trpc.useUtils();
  const [chamados, setChamados] = useState<ChamadoAtendimento[]>(() => {
    if (customerServiceJson) {
      try { return (JSON.parse(customerServiceJson) as { chamados?: ChamadoAtendimento[] }).chamados ?? []; } catch { /* vazio */ }
    }
    return [];
  });

  const saveMutation = trpc.incorporacao.saveAtendimentoClientes.useMutation({
    onSuccess: () => { toast.success("Atendimento salvo!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const resumo = useMemo(() => resumoAtendimentoClientes(chamados), [chamados]);

  function addChamado() { setChamados((l) => [...l, novoChamado()]); }
  function removerChamado(id: string) { setChamados((l) => l.filter((c) => c.id !== id)); }
  function upd<K extends keyof ChamadoAtendimento>(id: string, campo: K, valor: ChamadoAtendimento[K]) {
    setChamados((l) => l.map((c) => (c.id === id ? { ...c, [campo]: valor } : c)));
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <HeartHandshake className="h-5 w-5 text-[#C9A961]" /> Atendimento aos Clientes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">
          Central de atendimento pós-venda: repasses bancários, assembleias de condomínio, entrega de chaves,
          assistência técnica e documentação.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Chamados" valor={String(resumo.total)} />
          <Metric label="Abertos" valor={String(resumo.abertos)} />
          <Metric label="Em andamento" valor={String(resumo.emAndamento)} />
          <Metric label="Concluídos" valor={`${resumo.pctConcluido}%`} destaque />
        </div>

        <div className="overflow-x-auto">
          <table className="text-xs min-w-[680px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-40">Cliente</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-28">Unidade</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-44">Tipo</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Status</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Abertura</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {chamados.map((c) => (
                <tr key={c.id}>
                  <td className="px-1 py-1"><Input value={c.cliente} onChange={(e) => upd(c.id, "cliente", e.target.value)} className={inputCls} placeholder="Nome do cliente" /></td>
                  <td className="px-1 py-1"><Input value={c.unidade ?? ""} onChange={(e) => upd(c.id, "unidade", e.target.value)} className={inputCls} placeholder="Ex.: Lote 12" /></td>
                  <td className="px-1 py-1">
                    <select value={c.tipo} onChange={(e) => upd(c.id, "tipo", e.target.value as TipoChamado)} className={selectCls}>
                      {TIPOS_CHAMADO.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <select value={c.status} onChange={(e) => upd(c.id, "status", e.target.value as StatusChamado)} className={selectCls}>
                      {STATUS_CHAMADO.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1"><Input type="date" value={c.dataAbertura ?? ""} onChange={(e) => upd(c.id, "dataAbertura", e.target.value)} className={inputCls} /></td>
                  <td className="px-1 py-1">
                    <button type="button" onClick={() => removerChamado(c.id)} className="text-gray-500 hover:text-red-400 flex justify-center"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={addChamado} className="flex items-center gap-1 text-xs font-bold text-[#C9A961]">
            <Plus className="h-3.5 w-3.5" /> Adicionar chamado
          </button>
          <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify({ chamados }) })}
            disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold ml-auto">
            {saveMutation.isPending ? "Salvando..." : "Salvar atendimento"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
