import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { PiggyBank, Plus, Trash2 } from "lucide-react";
import { calcularBusinessPlan, type FonteCaptacao, type PeriodoRemuneracao } from "@shared/incorporacao/captacao";

const cardCls = "bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm";
const inputCls = "bg-[#2C3E50] border-[#C9A961]/30 text-white";

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

interface Dados {
  investimentoTotalManual: number;
  fontes: FonteCaptacao[];
}

function defaults(): Dados {
  return { investimentoTotalManual: 0, fontes: [] };
}
function novaFonte(): FonteCaptacao {
  return { id: Math.random().toString(36).slice(2), nome: "Novo investidor", capitalAportado: 0, remuneracaoPct: 1, periodoRemuneracao: "mensal", prazoResgateMeses: 24 };
}

export function BusinessPlan({ estudoId, businessPlanJson }: { estudoId: number; businessPlanJson: string | null }) {
  const utils = trpc.useUtils();
  const [dados, setDados] = useState<Dados>(() => {
    if (businessPlanJson) {
      try { return { ...defaults(), ...JSON.parse(businessPlanJson) }; } catch { /* defaults */ }
    }
    return defaults();
  });

  const saveMutation = trpc.incorporacao.saveBusinessPlan.useMutation({
    onSuccess: () => { toast.success("Business plan salvo!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const resultado = useMemo(() => calcularBusinessPlan(dados.fontes, dados.investimentoTotalManual), [dados]);

  function addFonte() { setDados((d) => ({ ...d, fontes: [...d.fontes, novaFonte()] })); }
  function removerFonte(id: string) { setDados((d) => ({ ...d, fontes: d.fontes.filter((f) => f.id !== id) })); }
  function updFonte<K extends keyof FonteCaptacao>(id: string, campo: K, valor: FonteCaptacao[K]) {
    setDados((d) => ({ ...d, fontes: d.fontes.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)) }));
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <PiggyBank className="h-5 w-5 text-[#C9A961]" /> Business Plan e Investidores
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">
          Uma fonte de captação por linha (fundo, investidor-anjo, sócio capitalista). O investimento total para
          comparação é informado manualmente abaixo — o Prospecta ainda não tem um módulo de Viabilidade Econômica
          que o calcule automaticamente.
        </p>

        <div className="max-w-xs">
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Investimento total (R$, manual)</label>
          <Input type="number" value={dados.investimentoTotalManual || ""} onChange={(e) => setDados((d) => ({ ...d, investimentoTotalManual: parseFloat(e.target.value) || 0 }))} className={inputCls} />
        </div>

        <div className="overflow-x-auto">
          <table className="text-xs min-w-[680px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-40">Fonte</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-28">Capital (R$)</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-24">Remuneração (%)</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-24">Período</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-24">Resgate (meses)</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-28">Valor no resgate</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dados.fontes.map((f) => {
                const r = resultado.fontes.find((x) => x.id === f.id);
                return (
                  <tr key={f.id}>
                    <td className="px-1 py-1"><Input value={f.nome} onChange={(e) => updFonte(f.id, "nome", e.target.value)} className={inputCls} placeholder="Ex.: Fundo X" /></td>
                    <td className="px-1 py-1"><Input type="number" value={f.capitalAportado || ""} onChange={(e) => updFonte(f.id, "capitalAportado", parseFloat(e.target.value) || 0)} className={`${inputCls} text-right`} /></td>
                    <td className="px-1 py-1"><Input type="number" step={0.1} value={f.remuneracaoPct} onChange={(e) => updFonte(f.id, "remuneracaoPct", parseFloat(e.target.value) || 0)} className={`${inputCls} text-right`} /></td>
                    <td className="px-1 py-1">
                      <select value={f.periodoRemuneracao} onChange={(e) => updFonte(f.id, "periodoRemuneracao", e.target.value as PeriodoRemuneracao)} className="bg-[#2C3E50] border border-[#C9A961]/30 text-white rounded-md px-2 h-9 text-sm w-full">
                        <option value="mensal">Mensal</option>
                        <option value="anual">Anual</option>
                      </select>
                    </td>
                    <td className="px-1 py-1"><Input type="number" value={f.prazoResgateMeses} onChange={(e) => updFonte(f.id, "prazoResgateMeses", parseFloat(e.target.value) || 0)} className={`${inputCls} text-right`} /></td>
                    <td className="px-1 py-1 text-right font-bold text-white">{r ? fmtBRL(r.valorResgate) : "—"}</td>
                    <td className="px-1 py-1">
                      <button type="button" onClick={() => removerFonte(f.id)} className="text-gray-500 hover:text-red-400 flex justify-center"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={addFonte} className="flex items-center gap-1 text-xs font-bold text-[#C9A961]">
          <Plus className="h-3.5 w-3.5" /> Adicionar fonte de captação
        </button>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-[#C9A961]/10">
          <Metric label="Capital total captado" valor={fmtBRL(resultado.capitalTotalCaptado)} />
          <Metric label="Custo total da captação" valor={fmtBRL(resultado.custoTotalCaptacao)} />
          <Metric label="% do investimento total" valor={resultado.pctDoInvestimentoTotal != null ? `${resultado.pctDoInvestimentoTotal.toFixed(1)}%` : "—"} />
          <Metric label="Capital próprio necessário" valor={resultado.capitalProprioNecessario != null ? fmtBRL(resultado.capitalProprioNecessario) : "—"} destaque />
        </div>

        <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify(dados) })}
          disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
          {saveMutation.isPending ? "Salvando..." : "Salvar business plan"}
        </Button>
      </CardContent>
    </Card>
  );
}
