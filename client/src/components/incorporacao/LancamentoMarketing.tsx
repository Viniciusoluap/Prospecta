import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { CalendarClock, Truck, Image, Plus, Trash2, AlertTriangle } from "lucide-react";
import { resumoPlanejamentoLancamento, MARCOS_PADRAO_LANCAMENTO, type MarcoLancamento, type StatusMarco } from "@shared/incorporacao/planejamento-lancamento";
import { resumoFornecedoresLancamento, CATEGORIAS_FORNECEDOR, type CategoriaFornecedor, type FornecedorLancamento, type StatusFornecedor } from "@shared/incorporacao/fornecedores-lancamento";
import { resumoMaterialPublicitario, TIPOS_PECA_PUBLICITARIA, type PecaPublicitaria, type StatusPeca, type TipoPecaPublicitaria } from "@shared/incorporacao/material-publicitario";

const cardCls = "bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm";
const inputCls = "bg-[#2C3E50] border-[#C9A961]/30 text-white";
const selectCls = "bg-[#2C3E50] border border-[#C9A961]/30 text-white rounded-md px-2 h-9 text-sm w-full";

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function Metric({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className={`rounded-lg p-3 border ${destaque ? "bg-[#C9A961]/10 border-[#C9A961]/40" : "bg-[#0F1923] border-[#C9A961]/10"}`}>
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`font-black text-base leading-tight ${destaque ? "text-[#C9A961]" : "text-white"}`}>{valor}</p>
    </div>
  );
}

export function LancamentoMarketing({ estudoId, launchPlanJson, launchSuppliersJson, marketingMaterialJson }: {
  estudoId: number; launchPlanJson: string | null; launchSuppliersJson: string | null; marketingMaterialJson: string | null;
}) {
  return (
    <div className="space-y-6">
      <PlanejamentoLancamento estudoId={estudoId} launchPlanJson={launchPlanJson} />
      <FornecedoresLancamento estudoId={estudoId} launchSuppliersJson={launchSuppliersJson} />
      <MaterialPublicitario estudoId={estudoId} marketingMaterialJson={marketingMaterialJson} />
    </div>
  );
}

const STATUS_MARCO: { value: StatusMarco; label: string }[] = [
  { value: "pendente", label: "Pendente" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "concluido", label: "Concluído" },
];
function defaultsMarcos(): { marcos: MarcoLancamento[] } {
  return { marcos: MARCOS_PADRAO_LANCAMENTO.map((nome, i) => ({ id: `padrao-${i}`, nome, status: "pendente" as StatusMarco })) };
}

function PlanejamentoLancamento({ estudoId, launchPlanJson }: { estudoId: number; launchPlanJson: string | null }) {
  const utils = trpc.useUtils();
  const [dados, setDados] = useState(() => {
    if (launchPlanJson) {
      try {
        const salvo = JSON.parse(launchPlanJson) as Partial<{ marcos: MarcoLancamento[] }>;
        if (salvo.marcos?.length) return { ...defaultsMarcos(), ...salvo };
      } catch { /* defaults */ }
    }
    return defaultsMarcos();
  });

  const saveMutation = trpc.incorporacao.savePlanejamentoLancamento.useMutation({
    onSuccess: () => { toast.success("Planejamento de lançamento salvo!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const resumo = useMemo(() => resumoPlanejamentoLancamento(dados.marcos), [dados]);

  function upd(id: string, campo: "status" | "dataPrevista" | "dataRealizada", valor: string) {
    setDados((d) => ({ marcos: d.marcos.map((m) => (m.id === id ? { ...m, [campo]: valor } : m)) }));
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-[#C9A961]" /> Planejamento do Lançamento
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">Cronograma padrão de marcos do evento de lançamento, já pré-preenchido.</p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Metric label="Marcos" valor={String(resumo.total)} />
          <Metric label="Concluídos" valor={`${resumo.pctConcluido}%`} destaque />
          <Metric label="Atrasados" valor={String(resumo.atrasados.length)} />
        </div>

        {resumo.atrasados.length > 0 && (
          <div className="bg-red-950/40 border border-red-900/50 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">{resumo.atrasados.length} marco(s) com prazo vencido: {resumo.atrasados.map((m) => m.nome).join(", ")}.</p>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="text-xs min-w-[640px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-64">Marco</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Data prevista</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Data realizada</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Status</th>
              </tr>
            </thead>
            <tbody>
              {dados.marcos.map((m) => (
                <tr key={m.id}>
                  <td className="px-1 py-1.5 text-gray-300">{m.nome}</td>
                  <td className="px-1 py-1"><Input type="date" value={m.dataPrevista ?? ""} onChange={(e) => upd(m.id, "dataPrevista", e.target.value)} className={inputCls} /></td>
                  <td className="px-1 py-1"><Input type="date" value={m.dataRealizada ?? ""} onChange={(e) => upd(m.id, "dataRealizada", e.target.value)} className={inputCls} /></td>
                  <td className="px-1 py-1">
                    <select value={m.status} onChange={(e) => upd(m.id, "status", e.target.value)} className={selectCls}>
                      {STATUS_MARCO.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify(dados) })}
          disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
          {saveMutation.isPending ? "Salvando..." : "Salvar planejamento"}
        </Button>
      </CardContent>
    </Card>
  );
}

const STATUS_FORNECEDOR: { value: StatusFornecedor; label: string }[] = [
  { value: "nao_contratado", label: "Não contratado" },
  { value: "orcamento", label: "Orçamento" },
  { value: "contratado", label: "Contratado" },
  { value: "entregue", label: "Entregue" },
];
function novoFornecedor(): FornecedorLancamento {
  return { id: Math.random().toString(36).slice(2), categoria: "Agência de Publicidade", nome: "", valorContratado: 0, status: "nao_contratado" };
}

function FornecedoresLancamento({ estudoId, launchSuppliersJson }: { estudoId: number; launchSuppliersJson: string | null }) {
  const utils = trpc.useUtils();
  const [fornecedores, setFornecedores] = useState<FornecedorLancamento[]>(() => {
    if (launchSuppliersJson) {
      try { return (JSON.parse(launchSuppliersJson) as { fornecedores?: FornecedorLancamento[] }).fornecedores ?? []; } catch { /* vazio */ }
    }
    return [];
  });

  const saveMutation = trpc.incorporacao.saveFornecedoresLancamento.useMutation({
    onSuccess: () => { toast.success("Fornecedores salvos!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const resumo = useMemo(() => resumoFornecedoresLancamento(fornecedores), [fornecedores]);

  function addFornecedor() { setFornecedores((l) => [...l, novoFornecedor()]); }
  function removerFornecedor(id: string) { setFornecedores((l) => l.filter((f) => f.id !== id)); }
  function upd<K extends keyof FornecedorLancamento>(id: string, campo: K, valor: FornecedorLancamento[K]) {
    setFornecedores((l) => l.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)));
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <Truck className="h-5 w-5 text-[#C9A961]" /> Contratação de Fornecedores
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">Fornecedores de marketing, estande de vendas, decoração e eventos do lançamento.</p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Metric label="Fornecedores" valor={String(resumo.total)} />
          <Metric label="Contratados" valor={`${resumo.pctContratado}%`} destaque />
          <Metric label="Valor total contratado" valor={fmtBRL(resumo.valorTotalContratado)} />
        </div>

        <div className="overflow-x-auto">
          <table className="text-xs min-w-[680px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-44">Categoria</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-40">Nome</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Contato</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-28">Valor (R$)</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-36">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {fornecedores.map((f) => (
                <tr key={f.id}>
                  <td className="px-1 py-1">
                    <select value={f.categoria} onChange={(e) => upd(f.id, "categoria", e.target.value as CategoriaFornecedor)} className={selectCls}>
                      {CATEGORIAS_FORNECEDOR.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1"><Input value={f.nome} onChange={(e) => upd(f.id, "nome", e.target.value)} className={inputCls} placeholder="Nome" /></td>
                  <td className="px-1 py-1"><Input value={f.contato ?? ""} onChange={(e) => upd(f.id, "contato", e.target.value)} className={inputCls} placeholder="Telefone/e-mail" /></td>
                  <td className="px-1 py-1"><Input type="number" value={f.valorContratado || ""} onChange={(e) => upd(f.id, "valorContratado", parseFloat(e.target.value) || 0)} className={`${inputCls} text-right`} /></td>
                  <td className="px-1 py-1">
                    <select value={f.status} onChange={(e) => upd(f.id, "status", e.target.value as StatusFornecedor)} className={selectCls}>
                      {STATUS_FORNECEDOR.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <button type="button" onClick={() => removerFornecedor(f.id)} className="text-gray-500 hover:text-red-400 flex justify-center"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={addFornecedor} className="flex items-center gap-1 text-xs font-bold text-[#C9A961]">
            <Plus className="h-3.5 w-3.5" /> Adicionar fornecedor
          </button>
          <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify({ fornecedores }) })}
            disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold ml-auto">
            {saveMutation.isPending ? "Salvando..." : "Salvar fornecedores"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const STATUS_PECA: { value: StatusPeca; label: string }[] = [
  { value: "em_producao", label: "Em produção" },
  { value: "em_aprovacao", label: "Em aprovação" },
  { value: "aprovado", label: "Aprovado" },
  { value: "reprovado", label: "Reprovado" },
];
function novaPeca(): PecaPublicitaria {
  return { id: Math.random().toString(36).slice(2), tipo: "Site", nome: "", status: "em_producao" };
}

function MaterialPublicitario({ estudoId, marketingMaterialJson }: { estudoId: number; marketingMaterialJson: string | null }) {
  const utils = trpc.useUtils();
  const [pecas, setPecas] = useState<PecaPublicitaria[]>(() => {
    if (marketingMaterialJson) {
      try { return (JSON.parse(marketingMaterialJson) as { pecas?: PecaPublicitaria[] }).pecas ?? []; } catch { /* vazio */ }
    }
    return [];
  });

  const saveMutation = trpc.incorporacao.saveMaterialPublicitario.useMutation({
    onSuccess: () => { toast.success("Material publicitário salvo!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const resumo = useMemo(() => resumoMaterialPublicitario(pecas), [pecas]);

  function addPeca() { setPecas((l) => [...l, novaPeca()]); }
  function removerPeca(id: string) { setPecas((l) => l.filter((p) => p.id !== id)); }
  function upd<K extends keyof PecaPublicitaria>(id: string, campo: K, valor: PecaPublicitaria[K]) {
    setPecas((l) => l.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)));
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <Image className="h-5 w-5 text-[#C9A961]" /> Material Publicitário
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">Repositório e aprovação das peças publicitárias do lançamento.</p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Metric label="Peças" valor={String(resumo.total)} />
          <Metric label="Em aprovação" valor={String(resumo.emAprovacao)} />
          <Metric label="Aprovadas" valor={`${resumo.pctAprovado}%`} destaque />
        </div>

        <div className="overflow-x-auto">
          <table className="text-xs min-w-[600px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-40">Tipo</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-40">Nome</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-40">URL</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-36">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pecas.map((p) => (
                <tr key={p.id}>
                  <td className="px-1 py-1">
                    <select value={p.tipo} onChange={(e) => upd(p.id, "tipo", e.target.value as TipoPecaPublicitaria)} className={selectCls}>
                      {TIPOS_PECA_PUBLICITARIA.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1"><Input value={p.nome} onChange={(e) => upd(p.id, "nome", e.target.value)} className={inputCls} placeholder="Nome da peça" /></td>
                  <td className="px-1 py-1"><Input value={p.url ?? ""} onChange={(e) => upd(p.id, "url", e.target.value)} className={inputCls} placeholder="https://..." /></td>
                  <td className="px-1 py-1">
                    <select value={p.status} onChange={(e) => upd(p.id, "status", e.target.value as StatusPeca)} className={selectCls}>
                      {STATUS_PECA.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <button type="button" onClick={() => removerPeca(p.id)} className="text-gray-500 hover:text-red-400 flex justify-center"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={addPeca} className="flex items-center gap-1 text-xs font-bold text-[#C9A961]">
            <Plus className="h-3.5 w-3.5" /> Adicionar peça
          </button>
          <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify({ pecas }) })}
            disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold ml-auto">
            {saveMutation.isPending ? "Salvando..." : "Salvar material publicitário"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
