import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Calculator, Handshake, Plus, Trash2, BadgeCheck } from "lucide-react";
import {
  calcularOrcamentoParametrizado,
  type ItemOrcamentoParametrizado,
  type PremissasOrcamentoParametrizado,
} from "@shared/incorporacao/orcamento-parametrizado";
import {
  resumoNegociacao,
  valorEstimadoProposta,
  type DadosNegociacao,
  type Proposta,
  type StatusProposta,
  type TipoProposta,
} from "@shared/incorporacao/negociacao";

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

export function OrcamentoNegociacao({ estudoId, parameterizedBudgetJson, landNegotiationJson }: {
  estudoId: number;
  parameterizedBudgetJson: string | null;
  landNegotiationJson: string | null;
}) {
  return (
    <div className="space-y-6">
      <OrcamentoParametrizado estudoId={estudoId} parameterizedBudgetJson={parameterizedBudgetJson} />
      <NegociacaoTerreno estudoId={estudoId} landNegotiationJson={landNegotiationJson} />
    </div>
  );
}

function defaultsOrcamento(): PremissasOrcamentoParametrizado {
  return {
    itens: [{ pavimento: "Torre padrão", areaM2: 0, coeficienteEquivalencia: 1 }],
    custoM2Equivalente: 2500,
    passivoAmbiental: 0,
    decoracaoEquipamentos: 0,
    projetos: 0,
    previsaoInfra: 0,
    outros: 0,
  };
}

function OrcamentoParametrizado({ estudoId, parameterizedBudgetJson }: { estudoId: number; parameterizedBudgetJson: string | null }) {
  const utils = trpc.useUtils();
  const [dados, setDados] = useState<PremissasOrcamentoParametrizado>(() => {
    if (parameterizedBudgetJson) {
      try {
        const salvo = JSON.parse(parameterizedBudgetJson) as Partial<PremissasOrcamentoParametrizado>;
        if (salvo.itens?.length) return { ...defaultsOrcamento(), ...salvo };
      } catch { /* JSON corrompido -> defaults */ }
    }
    return defaultsOrcamento();
  });

  const saveMutation = trpc.incorporacao.saveOrcamentoParametrizado.useMutation({
    onSuccess: () => { toast.success("Orçamento parametrizado salvo!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const resultado = useMemo(() => calcularOrcamentoParametrizado(dados), [dados]);

  function set<K extends keyof PremissasOrcamentoParametrizado>(campo: K) {
    return (valor: string) => setDados((d) => ({ ...d, [campo]: parseFloat(valor) || 0 }));
  }
  function addItem() {
    setDados((d) => ({ ...d, itens: [...d.itens, { pavimento: "Novo pavimento", areaM2: 0, coeficienteEquivalencia: 1 }] }));
  }
  function removerItem(i: number) {
    setDados((d) => ({ ...d, itens: d.itens.filter((_, j) => j !== i) }));
  }
  function updItem(i: number, campo: keyof ItemOrcamentoParametrizado, valor: string) {
    setDados((d) => {
      const itens = [...d.itens];
      itens[i] = { ...itens[i], [campo]: campo === "pavimento" ? valor : (parseFloat(valor) || 0) };
      return { ...d, itens };
    });
  }

  const CUSTOS: { k: "custoM2Equivalente" | "passivoAmbiental" | "decoracaoEquipamentos" | "projetos" | "previsaoInfra" | "outros"; label: string }[] = [
    { k: "custoM2Equivalente", label: "Custo/m² equivalente (R$)" },
    { k: "passivoAmbiental", label: "Passivo ambiental (R$)" },
    { k: "decoracaoEquipamentos", label: "Decoração/equipamentos (R$)" },
    { k: "projetos", label: "Todos os projetos (R$)" },
    { k: "previsaoInfra", label: "Previsão de infraestrutura (R$)" },
    { k: "outros", label: "Outros (R$)" },
  ];

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <Calculator className="h-5 w-5 text-[#C9A961]" /> Orçamento Parametrizado
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">
          Um pavimento por linha, cada um com seu coeficiente de equivalência de custo (1,0 = padrão; menor para
          garagem/áreas externas, maior para acabamentos superiores).
        </p>

        <div className="overflow-x-auto">
          <table className="text-xs min-w-[520px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-48">Pavimento</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-28">Área (m²)</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-32">Coef. equivalência</th>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-28">Área equivalente</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dados.itens.map((it, i) => (
                <tr key={i}>
                  <td className="px-1 py-1"><Input value={it.pavimento} onChange={(e) => updItem(i, "pavimento", e.target.value)} className={inputCls} placeholder="Ex.: Torre A" /></td>
                  <td className="px-1 py-1"><Input type="number" value={it.areaM2 || ""} onChange={(e) => updItem(i, "areaM2", e.target.value)} className={`${inputCls} text-right`} /></td>
                  <td className="px-1 py-1"><Input type="number" step={0.05} value={it.coeficienteEquivalencia} onChange={(e) => updItem(i, "coeficienteEquivalencia", e.target.value)} className={`${inputCls} text-right`} /></td>
                  <td className="px-1 py-1 text-right text-gray-400">{Math.round(it.areaM2 * it.coeficienteEquivalencia).toLocaleString("pt-BR")} m²</td>
                  <td className="px-1 py-1">
                    <button type="button" onClick={() => removerItem(i)} className="text-gray-500 hover:text-red-400 flex justify-center"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={addItem} className="flex items-center gap-1 text-xs font-bold text-[#C9A961]">
          <Plus className="h-3.5 w-3.5" /> Adicionar pavimento
        </button>

        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Custos adicionais</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {CUSTOS.map((c) => (
              <div key={c.k}>
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">{c.label}</label>
                <Input type="number" value={dados[c.k]} onChange={(e) => set(c.k)(e.target.value)} className={inputCls} />
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-[#C9A961]/10">
          <Metric label="Área total" valor={`${Math.round(resultado.areaTotalM2).toLocaleString("pt-BR")} m²`} />
          <Metric label="Área equivalente total" valor={`${Math.round(resultado.areaEquivalenteTotalM2).toLocaleString("pt-BR")} m²`} />
          <Metric label="Custo de obra base" valor={fmtBRL(resultado.custoObraBase)} />
          <Metric label="Custo total" valor={fmtBRL(resultado.custoTotal)} />
          <Metric label="Custo/m² real" valor={fmtBRL(resultado.custoM2Real)} destaque />
        </div>

        <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify(dados) })}
          disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
          {saveMutation.isPending ? "Salvando..." : "Salvar orçamento parametrizado"}
        </Button>
      </CardContent>
    </Card>
  );
}

const TIPOS: { value: TipoProposta; label: string }[] = [
  { value: "compra_avista", label: "Compra à vista" },
  { value: "compra_parcelada", label: "Compra parcelada" },
  { value: "permuta_fisica", label: "Permuta física" },
  { value: "permuta_financeira", label: "Permuta financeira" },
  { value: "misto", label: "Misto" },
];
const STATUS_OPTS: { value: StatusProposta; label: string }[] = [
  { value: "enviada", label: "Enviada" },
  { value: "em_analise", label: "Em análise" },
  { value: "contraproposta", label: "Contraproposta" },
  { value: "aceita", label: "Aceita" },
  { value: "recusada", label: "Recusada" },
];

function defaultsNegociacao(): DadosNegociacao {
  return { proprietarioNome: "", proprietarioContato: "", vgvGrossManual: 0, propostas: [] };
}
function novaProposta(): Proposta {
  return { id: Math.random().toString(36).slice(2), data: new Date().toISOString().slice(0, 10), autor: "grupo", tipo: "compra_avista", status: "enviada" };
}

function NegociacaoTerreno({ estudoId, landNegotiationJson }: { estudoId: number; landNegotiationJson: string | null }) {
  const utils = trpc.useUtils();
  const [dados, setDados] = useState<DadosNegociacao>(() => {
    if (landNegotiationJson) {
      try { return { ...defaultsNegociacao(), ...JSON.parse(landNegotiationJson) }; } catch { /* defaults */ }
    }
    return defaultsNegociacao();
  });

  const saveMutation = trpc.incorporacao.saveNegociacaoTerreno.useMutation({
    onSuccess: () => { toast.success("Negociação salva!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const resumo = useMemo(() => resumoNegociacao(dados, dados.vgvGrossManual), [dados]);

  function setCampo<K extends keyof DadosNegociacao>(campo: K, valor: DadosNegociacao[K]) {
    setDados((d) => ({ ...d, [campo]: valor }));
  }
  function addProposta() { setDados((d) => ({ ...d, propostas: [...d.propostas, novaProposta()] })); }
  function removerProposta(id: string) { setDados((d) => ({ ...d, propostas: d.propostas.filter((p) => p.id !== id) })); }
  function updProposta<K extends keyof Proposta>(id: string, campo: K, valor: Proposta[K]) {
    setDados((d) => ({ ...d, propostas: d.propostas.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)) }));
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <Handshake className="h-5 w-5 text-[#C9A961]" /> Negociação do Terreno
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">
          Registre cada proposta trocada com o proprietário/terreneiro. O VGV bruto usado para estimar a permuta
          financeira é informado manualmente abaixo — o Prospecta ainda não tem um módulo de Viabilidade Econômica
          que o calcule automaticamente (diferente do Santa Fé, que já tem essa etapa implementada).
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Proprietário/Terreneiro</label>
            <Input value={dados.proprietarioNome} onChange={(e) => setCampo("proprietarioNome", e.target.value)} className={inputCls} placeholder="Nome" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Contato</label>
            <Input value={dados.proprietarioContato} onChange={(e) => setCampo("proprietarioContato", e.target.value)} className={inputCls} placeholder="Telefone/e-mail" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">VGV bruto estimado (R$, manual)</label>
            <Input type="number" value={dados.vgvGrossManual || ""} onChange={(e) => setCampo("vgvGrossManual", parseFloat(e.target.value) || 0)} className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Metric label="Propostas registradas" valor={String(resumo.totalPropostas)} />
          <Metric label="Status atual" valor={resumo.propostaAtual ? (STATUS_OPTS.find((s) => s.value === resumo.propostaAtual!.status)?.label ?? "—") : "—"} />
          <Metric label="Valor estimado (proposta atual)" valor={fmtBRL(resumo.valorEstimadoAtual)} destaque />
        </div>

        {resumo.fechada && (
          <div className="bg-green-950/40 border border-green-900/50 rounded-lg p-3 flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-green-400 shrink-0" />
            <p className="text-xs text-green-300 font-bold">Negociação fechada — proposta aceita registrada abaixo.</p>
          </div>
        )}

        <div className="space-y-3">
          {dados.propostas.length === 0 && <p className="text-xs text-gray-500">Nenhuma proposta registrada ainda.</p>}
          {dados.propostas.map((p) => (
            <div key={p.id} className="border border-[#C9A961]/10 rounded-lg p-3 space-y-2 bg-[#0F1923]">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Data</label>
                  <Input type="date" value={p.data} onChange={(e) => updProposta(p.id, "data", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Autor</label>
                  <select value={p.autor} onChange={(e) => updProposta(p.id, "autor", e.target.value as Proposta["autor"])} className="bg-[#2C3E50] border border-[#C9A961]/30 text-white rounded-md px-2 h-9 text-sm w-full">
                    <option value="grupo">Empresa</option>
                    <option value="proprietario">Proprietário</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Tipo</label>
                  <select value={p.tipo} onChange={(e) => updProposta(p.id, "tipo", e.target.value as TipoProposta)} className="bg-[#2C3E50] border border-[#C9A961]/30 text-white rounded-md px-2 h-9 text-sm w-full">
                    {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Status</label>
                  <select value={p.status} onChange={(e) => updProposta(p.id, "status", e.target.value as StatusProposta)} className="bg-[#2C3E50] border border-[#C9A961]/30 text-white rounded-md px-2 h-9 text-sm w-full">
                    {STATUS_OPTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div className="flex items-end justify-end">
                  <button type="button" onClick={() => removerProposta(p.id)} className="text-gray-500 hover:text-red-400 p-2"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {(p.tipo === "compra_avista" || p.tipo === "compra_parcelada" || p.tipo === "permuta_fisica" || p.tipo === "misto") && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Valor (R$)</label>
                    <Input type="number" value={p.valorTotal ?? ""} onChange={(e) => updProposta(p.id, "valorTotal", parseFloat(e.target.value) || 0)} className={inputCls} />
                  </div>
                )}
                {p.tipo === "compra_parcelada" && (
                  <>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Entrada (%)</label>
                      <Input type="number" value={p.entradaPct ?? ""} onChange={(e) => updProposta(p.id, "entradaPct", parseFloat(e.target.value) || 0)} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Prazo (meses)</label>
                      <Input type="number" value={p.prazoParcelamentoMeses ?? ""} onChange={(e) => updProposta(p.id, "prazoParcelamentoMeses", parseFloat(e.target.value) || 0)} className={inputCls} />
                    </div>
                  </>
                )}
                {(p.tipo === "permuta_financeira" || p.tipo === "misto") && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Permuta (% do VGV)</label>
                    <Input type="number" value={p.permutaPctVgv ?? ""} onChange={(e) => updProposta(p.id, "permutaPctVgv", parseFloat(e.target.value) || 0)} className={inputCls} />
                  </div>
                )}
                {(p.tipo === "permuta_fisica" || p.tipo === "misto") && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Unidades entregues</label>
                    <Input type="number" value={p.unidadesPermuta ?? ""} onChange={(e) => updProposta(p.id, "unidadesPermuta", parseFloat(e.target.value) || 0)} className={inputCls} />
                  </div>
                )}
                <div className="col-span-2 md:col-span-4">
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Condições / observações</label>
                  <Input value={p.condicoes ?? ""} onChange={(e) => updProposta(p.id, "condicoes", e.target.value)} className={inputCls} placeholder="Ex.: prazo de escritura, cláusulas específicas..." />
                </div>
              </div>

              <p className="text-[11px] text-right text-gray-400">
                Valor estimado: <span className="font-bold text-white">{fmtBRL(valorEstimadoProposta(p, dados.vgvGrossManual))}</span>
              </p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={addProposta} className="flex items-center gap-1 text-xs font-bold text-[#C9A961]">
            <Plus className="h-3.5 w-3.5" /> Adicionar proposta
          </button>
          <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify(dados) })}
            disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold ml-auto">
            {saveMutation.isPending ? "Salvando..." : "Salvar negociação"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
