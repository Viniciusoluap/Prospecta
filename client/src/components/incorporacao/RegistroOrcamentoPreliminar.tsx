import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { FileCheck2, Wallet, Plus, Trash2, AlertTriangle } from "lucide-react";
import { resumoRegistro, DOCUMENTOS_PADRAO_REGISTRO, type DocumentoRegistro, type StatusDocumento } from "@shared/incorporacao/registro-incorporacao";
import { resumoOrcamentoPreliminar, CATEGORIAS_ORCAMENTO_PRELIMINAR, type CategoriaOrcamentoPreliminar, type ItemOrcamentoPreliminar } from "@shared/incorporacao/orcamento-preliminar";
import { calcularOrcamentoParametrizado, type PremissasOrcamentoParametrizado } from "@shared/incorporacao/orcamento-parametrizado";

const cardCls = "bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm";
const inputCls = "bg-[#2C3E50] border-[#C9A961]/30 text-white";
const selectCls = "bg-[#2C3E50] border border-[#C9A961]/30 text-white rounded-md px-2 h-9 text-sm w-full";

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function Metric({ label, valor, destaque, negativo }: { label: string; valor: string; destaque?: boolean; negativo?: boolean }) {
  return (
    <div className={`rounded-lg p-3 border ${destaque ? "bg-[#C9A961]/10 border-[#C9A961]/40" : "bg-[#0F1923] border-[#C9A961]/10"}`}>
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`font-black text-base leading-tight ${negativo ? "text-red-400" : destaque ? "text-[#C9A961]" : "text-white"}`}>{valor}</p>
    </div>
  );
}

export function RegistroOrcamentoPreliminar({ estudoId, incorporationRegistrationJson, preliminaryBudgetJson, parameterizedBudgetJson }: {
  estudoId: number;
  incorporationRegistrationJson: string | null;
  preliminaryBudgetJson: string | null;
  parameterizedBudgetJson: string | null;
}) {
  return (
    <div className="space-y-6">
      <RegistroIncorporacao estudoId={estudoId} incorporationRegistrationJson={incorporationRegistrationJson} />
      <OrcamentoPreliminar estudoId={estudoId} preliminaryBudgetJson={preliminaryBudgetJson} parameterizedBudgetJson={parameterizedBudgetJson} />
    </div>
  );
}

function defaultsRegistro(): { documentos: DocumentoRegistro[] } {
  return { documentos: DOCUMENTOS_PADRAO_REGISTRO.map((nome, i) => ({ id: `padrao-${i}`, nome, status: "pendente" as StatusDocumento })) };
}
const STATUS_DOC: { value: StatusDocumento; label: string }[] = [
  { value: "pendente", label: "Pendente" },
  { value: "em_providencia", label: "Em providência" },
  { value: "obtido", label: "Obtido" },
];

function RegistroIncorporacao({ estudoId, incorporationRegistrationJson }: { estudoId: number; incorporationRegistrationJson: string | null }) {
  const utils = trpc.useUtils();
  const [dados, setDados] = useState(() => {
    if (incorporationRegistrationJson) {
      try {
        const salvo = JSON.parse(incorporationRegistrationJson) as Partial<{ documentos: DocumentoRegistro[] }>;
        if (salvo.documentos?.length) return { ...defaultsRegistro(), ...salvo };
      } catch { /* defaults */ }
    }
    return defaultsRegistro();
  });

  const saveMutation = trpc.incorporacao.saveRegistroIncorporacao.useMutation({
    onSuccess: () => { toast.success("Registro da incorporação salvo!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const resumo = useMemo(() => resumoRegistro(dados.documentos), [dados]);

  function upd(id: string, campo: "status" | "dataObtencao" | "observacoes", valor: string) {
    setDados((d) => ({ documentos: d.documentos.map((doc) => (doc.id === id ? { ...doc, [campo]: valor } : doc)) }));
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <FileCheck2 className="h-5 w-5 text-[#C9A961]" /> Registro da Incorporação
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">
          Checklist padrão do art. 32 da Lei 4.591/64, já pré-preenchido. A etapa fica concluída quando todos os documentos estiverem marcados como obtidos.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Documentos" valor={String(resumo.total)} />
          <Metric label="Em providência" valor={String(resumo.emProvidencia)} />
          <Metric label="Pendentes" valor={String(resumo.pendentes.length)} />
          <Metric label="Obtidos" valor={`${resumo.pctObtido}%`} destaque />
        </div>

        <div className="overflow-x-auto">
          <table className="text-xs min-w-[760px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-72">Documento</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Status</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Data de obtenção</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-52">Observações</th>
              </tr>
            </thead>
            <tbody>
              {dados.documentos.map((doc) => (
                <tr key={doc.id}>
                  <td className="px-1 py-1.5 text-gray-300">{doc.nome}</td>
                  <td className="px-1 py-1">
                    <select value={doc.status} onChange={(e) => upd(doc.id, "status", e.target.value)} className={selectCls}>
                      {STATUS_DOC.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1"><Input type="date" value={doc.dataObtencao ?? ""} onChange={(e) => upd(doc.id, "dataObtencao", e.target.value)} className={inputCls} /></td>
                  <td className="px-1 py-1"><Input value={doc.observacoes ?? ""} onChange={(e) => upd(doc.id, "observacoes", e.target.value)} className={inputCls} placeholder="Observações" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify(dados) })}
          disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
          {saveMutation.isPending ? "Salvando..." : "Salvar registro"}
        </Button>
      </CardContent>
    </Card>
  );
}

function novoItemOrcamento(): ItemOrcamentoPreliminar {
  return { id: Math.random().toString(36).slice(2), categoria: "Estrutura", valorOrcado: 0 };
}

function OrcamentoPreliminar({ estudoId, preliminaryBudgetJson, parameterizedBudgetJson }: {
  estudoId: number; preliminaryBudgetJson: string | null; parameterizedBudgetJson: string | null;
}) {
  const utils = trpc.useUtils();
  const [itens, setItens] = useState<ItemOrcamentoPreliminar[]>(() => {
    if (preliminaryBudgetJson) {
      try { return (JSON.parse(preliminaryBudgetJson) as { itens?: ItemOrcamentoPreliminar[] }).itens ?? []; } catch { /* vazio */ }
    }
    return [];
  });

  const saveMutation = trpc.incorporacao.saveOrcamentoPreliminar.useMutation({
    onSuccess: () => { toast.success("Orçamento preliminar salvo!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const referencia = useMemo(() => {
    if (!parameterizedBudgetJson) return null;
    try {
      const premissas = JSON.parse(parameterizedBudgetJson) as PremissasOrcamentoParametrizado;
      const r = calcularOrcamentoParametrizado(premissas);
      return r.custoTotal > 0 ? r.custoTotal : null;
    } catch {
      return null;
    }
  }, [parameterizedBudgetJson]);

  const resumo = useMemo(() => resumoOrcamentoPreliminar(itens, referencia), [itens, referencia]);
  const divergeMuito = resumo.variacaoPct != null && Math.abs(resumo.variacaoPct) > 15;

  function addItem() { setItens((l) => [...l, novoItemOrcamento()]); }
  function removerItem(id: string) { setItens((l) => l.filter((i) => i.id !== id)); }
  function upd<K extends keyof ItemOrcamentoPreliminar>(id: string, campo: K, valor: ItemOrcamentoPreliminar[K]) {
    setItens((l) => l.map((i) => (i.id === id ? { ...i, [campo]: valor } : i)));
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <Wallet className="h-5 w-5 text-[#C9A961]" /> Orçamento Preliminar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">
          Um item por categoria de obra. O total é reconciliado automaticamente com o custo total já calculado no
          Orçamento Parametrizado{referencia ? `: ${fmtBRL(referencia)}` : ", quando ele estiver preenchido"}.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Metric label="Total orçado (preliminar)" valor={fmtBRL(resumo.totalOrcado)} destaque />
          <Metric label="Referência (Orçamento Parametrizado)" valor={resumo.custoParametrizadoReferencia ? fmtBRL(resumo.custoParametrizadoReferencia) : "—"} />
          <Metric label="Variação vs. referência" valor={resumo.variacaoPct != null ? `${resumo.variacaoPct > 0 ? "+" : ""}${resumo.variacaoPct}%` : "—"} negativo={divergeMuito} />
        </div>

        {divergeMuito && (
          <div className="bg-red-950/40 border border-red-900/50 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">
              O orçamento preliminar diverge {Math.abs(resumo.variacaoPct as number)}% do custo parametrizado — revise os itens ou atualize as premissas de custo.
            </p>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="text-xs min-w-[600px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-52">Categoria</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Valor orçado (R$)</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-52">Observações</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={item.id}>
                  <td className="px-1 py-1">
                    <select value={item.categoria} onChange={(e) => upd(item.id, "categoria", e.target.value as CategoriaOrcamentoPreliminar)} className={selectCls}>
                      {CATEGORIAS_ORCAMENTO_PRELIMINAR.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1"><Input type="number" value={item.valorOrcado || ""} onChange={(e) => upd(item.id, "valorOrcado", parseFloat(e.target.value) || 0)} className={`${inputCls} text-right`} /></td>
                  <td className="px-1 py-1"><Input value={item.observacoes ?? ""} onChange={(e) => upd(item.id, "observacoes", e.target.value)} className={inputCls} placeholder="Observações" /></td>
                  <td className="px-1 py-1">
                    <button type="button" onClick={() => removerItem(item.id)} className="text-gray-500 hover:text-red-400 flex justify-center"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={addItem} className="flex items-center gap-1 text-xs font-bold text-[#C9A961]">
            <Plus className="h-3.5 w-3.5" /> Adicionar item
          </button>
          <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify({ itens }) })}
            disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold ml-auto">
            {saveMutation.isPending ? "Salvando..." : "Salvar orçamento preliminar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
