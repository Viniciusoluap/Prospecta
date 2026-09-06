import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { FileStack, HardHat, TrendingUp, Plus, Trash2, AlertTriangle } from "lucide-react";
import { resumoProjetosExecutivos, DISCIPLINAS_EXECUTIVO, type ProjetoExecutivo, type DisciplinaExecutivo, type StatusProjetoExecutivo } from "@shared/incorporacao/projetos-executivos";
import { resumoOrcamentoObra, CATEGORIAS_ORCAMENTO_OBRA, type ItemOrcamentoObra, type CategoriaOrcamentoObra } from "@shared/incorporacao/orcamento-obra";
import { resumoOrcamentoPreliminar } from "@shared/incorporacao/orcamento-preliminar";
import { resumoCronogramaObra, type MedicaoMensal } from "@shared/incorporacao/cronograma-obra";
import type { ItemOrcamentoPreliminar } from "@shared/incorporacao/orcamento-preliminar";

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

export function ObraExecutiva({ estudoId, executiveProjectsJson, workBudgetJson, physicalFinancialScheduleJson, preliminaryBudgetJson }: {
  estudoId: number;
  executiveProjectsJson: string | null;
  workBudgetJson: string | null;
  physicalFinancialScheduleJson: string | null;
  preliminaryBudgetJson: string | null;
}) {
  return (
    <div className="space-y-6">
      <ProjetosExecutivos estudoId={estudoId} executiveProjectsJson={executiveProjectsJson} />
      <OrcamentoObra estudoId={estudoId} workBudgetJson={workBudgetJson} preliminaryBudgetJson={preliminaryBudgetJson} />
      <CronogramaObra estudoId={estudoId} physicalFinancialScheduleJson={physicalFinancialScheduleJson} />
    </div>
  );
}

const STATUS_EXECUTIVO: { value: StatusProjetoExecutivo; label: string }[] = [
  { value: "nao_iniciado", label: "Não iniciado" },
  { value: "em_elaboracao", label: "Em elaboração" },
  { value: "em_revisao", label: "Em revisão" },
  { value: "liberado_para_obra", label: "Liberado para obra" },
];
function novoProjetoExecutivo(): ProjetoExecutivo {
  return { id: Math.random().toString(36).slice(2), disciplina: "Arquitetura Executiva", status: "nao_iniciado" };
}

function ProjetosExecutivos({ estudoId, executiveProjectsJson }: { estudoId: number; executiveProjectsJson: string | null }) {
  const utils = trpc.useUtils();
  const [projetos, setProjetos] = useState<ProjetoExecutivo[]>(() => {
    if (executiveProjectsJson) {
      try { return (JSON.parse(executiveProjectsJson) as { projetos?: ProjetoExecutivo[] }).projetos ?? []; } catch { /* vazio */ }
    }
    return [];
  });

  const saveMutation = trpc.incorporacao.saveProjetosExecutivos.useMutation({
    onSuccess: () => { toast.success("Projetos executivos salvos!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const resumo = useMemo(() => resumoProjetosExecutivos(projetos), [projetos]);

  function addProjeto() { setProjetos((l) => [...l, novoProjetoExecutivo()]); }
  function removerProjeto(id: string) { setProjetos((l) => l.filter((p) => p.id !== id)); }
  function upd<K extends keyof ProjetoExecutivo>(id: string, campo: K, valor: ProjetoExecutivo[K]) {
    setProjetos((l) => l.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)));
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <FileStack className="h-5 w-5 text-[#C9A961]" /> Projetos Executivos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">Repositório dos projetos executivos de engenharia por disciplina, até a liberação para obra.</p>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Metric label="Projetos" valor={String(resumo.total)} />
          <Metric label="Liberados" valor={String(resumo.liberados)} />
          <Metric label="% liberado" valor={`${resumo.pctLiberado}%`} destaque />
        </div>

        <div className="overflow-x-auto">
          <table className="text-xs min-w-[640px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-56">Disciplina</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-40">URL</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Data de liberação</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-40">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {projetos.map((p) => (
                <tr key={p.id}>
                  <td className="px-1 py-1">
                    <select value={p.disciplina} onChange={(e) => upd(p.id, "disciplina", e.target.value as DisciplinaExecutivo)} className={selectCls}>
                      {DISCIPLINAS_EXECUTIVO.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1"><Input value={p.url ?? ""} onChange={(e) => upd(p.id, "url", e.target.value)} className={inputCls} placeholder="https://..." /></td>
                  <td className="px-1 py-1"><Input type="date" value={p.dataLiberacao ?? ""} onChange={(e) => upd(p.id, "dataLiberacao", e.target.value)} className={inputCls} /></td>
                  <td className="px-1 py-1">
                    <select value={p.status} onChange={(e) => upd(p.id, "status", e.target.value as StatusProjetoExecutivo)} className={selectCls}>
                      {STATUS_EXECUTIVO.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <button type="button" onClick={() => removerProjeto(p.id)} className="text-gray-500 hover:text-red-400 flex justify-center"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={addProjeto} className="flex items-center gap-1 text-xs font-bold text-[#C9A961]">
            <Plus className="h-3.5 w-3.5" /> Adicionar projeto
          </button>
          <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify({ projetos }) })}
            disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold ml-auto">
            {saveMutation.isPending ? "Salvando..." : "Salvar projetos executivos"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function novoItemObra(): ItemOrcamentoObra {
  return { id: Math.random().toString(36).slice(2), categoria: "Estrutura", valorOrcado: 0, valorRealizado: 0 };
}

function OrcamentoObra({ estudoId, workBudgetJson, preliminaryBudgetJson }: { estudoId: number; workBudgetJson: string | null; preliminaryBudgetJson: string | null }) {
  const utils = trpc.useUtils();
  const [itens, setItens] = useState<ItemOrcamentoObra[]>(() => {
    if (workBudgetJson) {
      try { return (JSON.parse(workBudgetJson) as { itens?: ItemOrcamentoObra[] }).itens ?? []; } catch { /* vazio */ }
    }
    return [];
  });

  const saveMutation = trpc.incorporacao.saveOrcamentoObra.useMutation({
    onSuccess: () => { toast.success("Orçamento da obra salvo!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const referenciaPreliminar = useMemo(() => {
    if (!preliminaryBudgetJson) return null;
    try {
      const dados = JSON.parse(preliminaryBudgetJson) as { itens?: ItemOrcamentoPreliminar[] };
      const r = resumoOrcamentoPreliminar(dados.itens ?? []);
      return r.totalOrcado > 0 ? r.totalOrcado : null;
    } catch {
      return null;
    }
  }, [preliminaryBudgetJson]);

  const resumo = useMemo(() => resumoOrcamentoObra(itens, referenciaPreliminar), [itens, referenciaPreliminar]);
  const divergeMuito = resumo.variacaoVsPreliminarPct != null && Math.abs(resumo.variacaoVsPreliminarPct) > 15;

  function addItem() { setItens((l) => [...l, novoItemObra()]); }
  function removerItem(id: string) { setItens((l) => l.filter((i) => i.id !== id)); }
  function upd<K extends keyof ItemOrcamentoObra>(id: string, campo: K, valor: ItemOrcamentoObra[K]) {
    setItens((l) => l.map((i) => (i.id === id ? { ...i, [campo]: valor } : i)));
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <HardHat className="h-5 w-5 text-[#C9A961]" /> Orçamento da Obra
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">
          Orçado x realizado por categoria, comparado automaticamente ao total do Orçamento Preliminar
          {referenciaPreliminar ? `: ${fmtBRL(referenciaPreliminar)}` : ", quando ele estiver preenchido"}.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Total orçado" valor={fmtBRL(resumo.totalOrcado)} />
          <Metric label="Total realizado" valor={fmtBRL(resumo.totalRealizado)} destaque />
          <Metric label="% executado" valor={`${resumo.pctExecutado}%`} />
          <Metric label="Variação vs. preliminar" valor={resumo.variacaoVsPreliminarPct != null ? `${resumo.variacaoVsPreliminarPct > 0 ? "+" : ""}${resumo.variacaoVsPreliminarPct}%` : "—"} negativo={divergeMuito} />
        </div>

        {divergeMuito && (
          <div className="bg-red-950/40 border border-red-900/50 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">O orçamento da obra diverge {Math.abs(resumo.variacaoVsPreliminarPct as number)}% do orçamento preliminar — revise os itens.</p>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="text-xs min-w-[600px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-48">Categoria</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-28">Orçado (R$)</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-28">Realizado (R$)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {itens.map((it) => (
                <tr key={it.id}>
                  <td className="px-1 py-1">
                    <select value={it.categoria} onChange={(e) => upd(it.id, "categoria", e.target.value as CategoriaOrcamentoObra)} className={selectCls}>
                      {CATEGORIAS_ORCAMENTO_OBRA.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1"><Input type="number" value={it.valorOrcado || ""} onChange={(e) => upd(it.id, "valorOrcado", parseFloat(e.target.value) || 0)} className={`${inputCls} text-right`} /></td>
                  <td className="px-1 py-1"><Input type="number" value={it.valorRealizado || ""} onChange={(e) => upd(it.id, "valorRealizado", parseFloat(e.target.value) || 0)} className={`${inputCls} text-right`} /></td>
                  <td className="px-1 py-1">
                    <button type="button" onClick={() => removerItem(it.id)} className="text-gray-500 hover:text-red-400 flex justify-center"><Trash2 className="h-4 w-4" /></button>
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
            {saveMutation.isPending ? "Salvando..." : "Salvar orçamento da obra"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function novaMedicao(): MedicaoMensal {
  return { id: Math.random().toString(36).slice(2), mes: 0, avancoFisicoAcumuladoPct: 0 };
}

function CronogramaObra({ estudoId, physicalFinancialScheduleJson }: { estudoId: number; physicalFinancialScheduleJson: string | null }) {
  const utils = trpc.useUtils();
  const [medicoes, setMedicoes] = useState<MedicaoMensal[]>(() => {
    if (physicalFinancialScheduleJson) {
      try {
        const dados = JSON.parse(physicalFinancialScheduleJson) as { medicoes?: MedicaoMensal[] };
        return dados.medicoes ?? [];
      } catch { /* vazio */ }
    }
    return [];
  });
  const [duracaoObraMeses, setDuracaoObraMeses] = useState<number>(() => {
    if (physicalFinancialScheduleJson) {
      try { return (JSON.parse(physicalFinancialScheduleJson) as { duracaoObraMeses?: number }).duracaoObraMeses ?? 0; } catch { /* 0 */ }
    }
    return 0;
  });

  const saveMutation = trpc.incorporacao.saveCronogramaObra.useMutation({
    onSuccess: () => { toast.success("Cronograma salvo!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const resumo = useMemo(() => resumoCronogramaObra(medicoes, duracaoObraMeses || null), [medicoes, duracaoObraMeses]);

  function addMedicao() { setMedicoes((l) => [...l, { ...novaMedicao(), mes: l.length }]); }
  function removerMedicao(id: string) { setMedicoes((l) => l.filter((m) => m.id !== id)); }
  function upd<K extends keyof MedicaoMensal>(id: string, campo: K, valor: MedicaoMensal[K]) {
    setMedicoes((l) => l.map((m) => (m.id === id ? { ...m, [campo]: valor } : m)));
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-[#C9A961]" /> Cronograma Físico-Financeiro
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">
          Curva S: avanço físico medido em obra comparado ao avanço financeiro projetado (desembolso linear ao longo da
          duração de obra, informada manualmente abaixo — o Prospecta ainda não tem um módulo de Viabilidade que a calcule
          automaticamente).
        </p>

        <div className="max-w-xs">
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Duração da obra (meses)</label>
          <Input type="number" value={duracaoObraMeses || ""} onChange={(e) => setDuracaoObraMeses(parseFloat(e.target.value) || 0)} className={inputCls} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Avanço físico atual" valor={`${resumo.avancoFisicoAtualPct}%`} destaque />
          <Metric label="Avanço financeiro projetado" valor={resumo.avancoFinanceiroProjetadoAtualPct != null ? `${resumo.avancoFinanceiroProjetadoAtualPct}%` : "—"} />
          <Metric label="Desvio" valor={resumo.desvioAtualPct != null ? `${resumo.desvioAtualPct > 0 ? "+" : ""}${resumo.desvioAtualPct}%` : "—"} negativo={resumo.desvioAtualPct != null && resumo.desvioAtualPct < -10} />
          <Metric label="Obra concluída" valor={resumo.obraConcluida ? "Sim" : "Não"} />
        </div>

        <div className="overflow-x-auto">
          <table className="text-xs min-w-[560px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-24">Mês</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Avanço físico (%)</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Data da medição</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Financeiro projetado</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-24">Desvio</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {resumo.itens.map((it) => (
                <tr key={it.id}>
                  <td className="px-1 py-1"><Input type="number" value={it.mes} onChange={(e) => upd(it.id, "mes", parseFloat(e.target.value) || 0)} className={`${inputCls} text-right`} /></td>
                  <td className="px-1 py-1"><Input type="number" value={it.avancoFisicoAcumuladoPct || ""} onChange={(e) => upd(it.id, "avancoFisicoAcumuladoPct", parseFloat(e.target.value) || 0)} className={`${inputCls} text-right`} /></td>
                  <td className="px-1 py-1"><Input type="date" value={it.data ?? ""} onChange={(e) => upd(it.id, "data", e.target.value)} className={inputCls} /></td>
                  <td className="px-1 py-1 text-right text-gray-300">{it.avancoFinanceiroProjetadoPct != null ? `${it.avancoFinanceiroProjetadoPct}%` : "—"}</td>
                  <td className={`px-1 py-1 text-right font-bold ${it.desvioPct != null && it.desvioPct < -10 ? "text-red-400" : "text-white"}`}>{it.desvioPct != null ? `${it.desvioPct > 0 ? "+" : ""}${it.desvioPct}%` : "—"}</td>
                  <td className="px-1 py-1">
                    <button type="button" onClick={() => removerMedicao(it.id)} className="text-gray-500 hover:text-red-400 flex justify-center"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={addMedicao} className="flex items-center gap-1 text-xs font-bold text-[#C9A961]">
            <Plus className="h-3.5 w-3.5" /> Adicionar medição
          </button>
          <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify({ medicoes, duracaoObraMeses }) })}
            disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold ml-auto">
            {saveMutation.isPending ? "Salvando..." : "Salvar cronograma"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
