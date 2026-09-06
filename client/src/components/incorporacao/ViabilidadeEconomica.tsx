import { useMemo, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Calculator, Plus, Trash2 } from "lucide-react";
import {
  calcularCenarios,
  type PremissasLoteamento,
  type ResultadoLoteamento,
  type ItemMixProduto,
  type PerfilVendas,
} from "@shared/incorporacao/viabilidade-economica";

const cardCls = "bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm";
const inputCls = "bg-[#2C3E50] border-[#C9A961]/30 text-white";

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function fmtM2(v: number) {
  return `${Math.round(v).toLocaleString("pt-BR")} m²`;
}
function fmtPct(v: number, casas = 1) {
  return `${(v * 100).toFixed(casas)}%`;
}

type CenarioId = "conservador" | "ideal" | "agressivo";

interface PremissasForm {
  areaBrutaM2: number;
  pctAreaPublica: number;
  pctAreaVerde: number;
  pctSistemaViario: number;
  pctFaixaServidao: number;
  duracaoVendasMeses: number;
  perfilVendas: PerfilVendas;
  entradaPct: number;
  prazoParcelamentoMeses: number;
  jurosClienteMensal: number;
  indexacaoMensal: number;
  vendasAVistaPct: number;
  descontoAVistaPct: number;
  inadimplenciaPct: number;
  comissaoPctVgv: number;
  despesasGeraisPctVgv: number;
  impostosPctVgv: number;
  taxaIncorporacaoPctVgv: number;
  inicioObraMes: number;
  duracaoObraMeses: number;
  inicioVendasMes: number;
  custoInfraM2Lote: number;
  projetosLicencas: number;
  marketing: number;
  registroPorUnidade: number;
  contingenciaPctInfra: number;
  bdiPct: number;
  taxaAdministracaoObraPct: number;
  manutencaoPctObra: number;
  inccObraMensal: number;
  permutaPctVgv: number;
  taxaDescontoAnual: number;
}

const PERFIS: { value: PerfilVendas; label: string }[] = [
  { value: "lancamento_forte", label: "Lançamento Forte" },
  { value: "organico", label: "Crescimento Orgânico" },
  { value: "constante", label: "Ritmo Constante" },
  { value: "fechamento_forte", label: "Fechamento Forte" },
];

function defaultsForm(areaM2: number): PremissasForm {
  return {
    areaBrutaM2: Math.round(areaM2) || 100_000,
    pctAreaPublica: 10,
    pctAreaVerde: 5,
    pctSistemaViario: 25,
    pctFaixaServidao: 0,
    duracaoVendasMeses: 24,
    perfilVendas: "lancamento_forte",
    entradaPct: 10,
    prazoParcelamentoMeses: 180,
    jurosClienteMensal: 0.52,
    indexacaoMensal: 0.4,
    vendasAVistaPct: 5,
    descontoAVistaPct: 10,
    inadimplenciaPct: 5,
    comissaoPctVgv: 5,
    despesasGeraisPctVgv: 3,
    impostosPctVgv: 6.58,
    taxaIncorporacaoPctVgv: 1,
    inicioObraMes: 0,
    duracaoObraMeses: 24,
    inicioVendasMes: 12,
    custoInfraM2Lote: 245,
    projetosLicencas: 500_000,
    marketing: 500_000,
    registroPorUnidade: 400,
    contingenciaPctInfra: 10,
    bdiPct: 10,
    taxaAdministracaoObraPct: 10,
    manutencaoPctObra: 1.5,
    inccObraMensal: 0.3,
    permutaPctVgv: 40,
    taxaDescontoAnual: 12,
  };
}

function paraMotor(f: PremissasForm, itensMix: ItemMixProduto[], pctAPP: number): PremissasLoteamento {
  const pct = (v: number) => v / 100;
  return {
    areaBrutaM2: f.areaBrutaM2,
    pctAreaPublica: pct(f.pctAreaPublica),
    pctAreaVerde: pct(f.pctAreaVerde),
    pctSistemaViario: pct(f.pctSistemaViario),
    pctAPP,
    pctFaixaServidao: pct(f.pctFaixaServidao),
    itensMix,
    duracaoVendasMeses: f.duracaoVendasMeses,
    perfilVendas: f.perfilVendas,
    entradaPct: pct(f.entradaPct),
    prazoParcelamentoMeses: f.prazoParcelamentoMeses,
    jurosClienteMensal: pct(f.jurosClienteMensal),
    indexacaoMensal: pct(f.indexacaoMensal),
    vendasAVistaPct: pct(f.vendasAVistaPct),
    descontoAVistaPct: pct(f.descontoAVistaPct),
    inadimplenciaPct: pct(f.inadimplenciaPct),
    comissaoPctVgv: pct(f.comissaoPctVgv),
    despesasGeraisPctVgv: pct(f.despesasGeraisPctVgv),
    impostosPctVgv: pct(f.impostosPctVgv),
    taxaIncorporacaoPctVgv: pct(f.taxaIncorporacaoPctVgv),
    inicioObraMes: f.inicioObraMes,
    duracaoObraMeses: f.duracaoObraMeses,
    inicioVendasMes: f.inicioVendasMes,
    custoInfraM2Lote: f.custoInfraM2Lote,
    projetosLicencas: f.projetosLicencas,
    marketing: f.marketing,
    registroPorUnidade: f.registroPorUnidade,
    contingenciaPctInfra: pct(f.contingenciaPctInfra),
    bdiPct: pct(f.bdiPct),
    taxaAdministracaoObraPct: pct(f.taxaAdministracaoObraPct),
    manutencaoPctObra: pct(f.manutencaoPctObra),
    inccObraMensal: pct(f.inccObraMensal),
    permutaPctVgv: pct(f.permutaPctVgv),
    taxaDescontoAnual: pct(f.taxaDescontoAnual),
  };
}

function Num({ label, value, onChange, sufixo, step = 1 }: {
  label: string; value: number; onChange: (v: number) => void; sufixo?: string; step?: number;
}) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">
        {label}{sufixo ? <span className="text-gray-500 normal-case font-normal"> ({sufixo})</span> : null}
      </label>
      <Input type="number" value={Number.isFinite(value) ? value : ""} step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)} className={inputCls} />
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#0F1923] border border-[#C9A961]/10 p-4 rounded-lg">
      <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">{titulo}</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{children}</div>
    </div>
  );
}

function Kpi({ label, valor, sub, destaque, negativo }: {
  label: string; valor: string; sub?: string; destaque?: boolean; negativo?: boolean;
}) {
  return (
    <div className={`rounded-lg p-3 border ${destaque ? "bg-[#C9A961]/10 border-[#C9A961]/40" : "bg-[#0F1923] border-[#C9A961]/10"}`}>
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`font-black text-base leading-tight ${destaque ? (negativo ? "text-red-400" : "text-[#C9A961]") : negativo ? "text-red-400" : "text-white"}`}>
        {valor}
      </p>
      {sub && <p className="text-[10px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function Linha({ label, valor, sub, forte }: { label: string; valor: string; sub?: string; forte?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2 py-1 border-b border-[#C9A961]/10 last:border-0">
      <div className="min-w-0">
        <span className="text-xs text-gray-400">{label}</span>
        {sub && <p className="text-[10px] text-gray-500">{sub}</p>}
      </div>
      <span className={`text-xs shrink-0 ${forte ? "font-black text-white" : "font-bold text-gray-300"}`}>{valor}</span>
    </div>
  );
}

export function ViabilidadeEconomica({ estudoId, areaM2, appAreaM2, productMixJson, lottingJson }: {
  estudoId: number;
  areaM2: string;
  appAreaM2: string | null;
  productMixJson: string | null;
  lottingJson: string | null;
}) {
  const utils = trpc.useUtils();
  const areaTerrenoM2 = parseFloat(areaM2) || 0;
  const appM2 = parseFloat(appAreaM2 ?? "0") || 0;

  const salvo = useMemo(() => {
    if (!lottingJson) return null;
    try { return JSON.parse(lottingJson) as (Partial<PremissasForm> & { itensMix?: ItemMixProduto[] }); }
    catch { return null; }
  }, [lottingJson]);

  const [form, setForm] = useState<PremissasForm>(() => ({ ...defaultsForm(areaTerrenoM2), ...(salvo ?? {}) }));
  const [mix, setMix] = useState<ItemMixProduto[]>(() => {
    if (salvo?.itensMix && salvo.itensMix.length > 0) return salvo.itensMix;
    if (productMixJson) {
      try {
        const itens = JSON.parse(productMixJson) as ItemMixProduto[];
        if (Array.isArray(itens) && itens.length > 0) return itens;
      } catch { /* vazio */ }
    }
    return [{ nome: "Lotes", quantidade: 100, areaUnidadeM2: 160, precoM2: 500 }];
  });
  const [cenarioAtivo, setCenarioAtivo] = useState<CenarioId>("ideal");

  const saveMutation = trpc.incorporacao.saveViabilidade.useMutation({
    onSuccess: () => { toast.success("Viabilidade econômica salva!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const set = <K extends keyof PremissasForm>(k: K) => (v: PremissasForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  function addProduto() { setMix((m) => [...m, { nome: "Novo produto", quantidade: 0, areaUnidadeM2: 0, precoM2: 0 }]); }
  function updProduto(i: number, campo: keyof ItemMixProduto, valor: string) {
    setMix((m) => { const novo = [...m]; novo[i] = { ...novo[i], [campo]: campo === "nome" ? valor : (parseFloat(valor) || 0) }; return novo; });
  }
  function removerProduto(i: number) { setMix((m) => m.filter((_, j) => j !== i)); }

  const pctAPP = form.areaBrutaM2 > 0 ? appM2 / form.areaBrutaM2 : 0;

  const cenarios = useMemo(() => calcularCenarios(paraMotor(form, mix, pctAPP)), [form, mix, pctAPP]);
  const r: ResultadoLoteamento = cenarios[cenarioAtivo];
  const urb = r.urbanistico;

  const dadosGrafico = useMemo(() => r.fluxo.map((f) => ({ mes: f.mes, saldo: f.saldoAcumulado })), [r]);

  function salvar() {
    saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify({ ...form, itensMix: mix }) });
  }

  const CENARIO_META: { id: CenarioId; label: string }[] = [
    { id: "conservador", label: "Conservador" },
    { id: "ideal", label: "Ideal" },
    { id: "agressivo", label: "Agressivo" },
  ];

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <Calculator className="h-5 w-5 text-[#C9A961]" /> Viabilidade Econômica (EVE)
        </CardTitle>
        <p className="text-xs text-gray-400 mt-1">
          Premissas + mix de produtos → VGV, fluxo de caixa mensal, VPL, TIR, ROI, payback e exposição máxima —
          tudo por fórmula, recalculado em tempo real, sem IA.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-end">
          <Button onClick={salvar} disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
            {saveMutation.isPending ? "Salvando..." : "Salvar premissas"}
          </Button>
        </div>

        {/* Mix de produtos (independente do mix do Lançamento — premissa própria da viabilidade, igual ao Santa Fé) */}
        <div className="bg-[#0F1923] border border-[#C9A961]/10 p-4 rounded-lg">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Mix de produtos</p>
          <p className="text-[11px] text-gray-500 mb-3">
            Lotes, casas, apartamentos ou qualquer combinação. Pré-preenchido a partir do Mix de Produtos do Lançamento
            Imobiliário quando existir — ajuste livremente aqui sem afetar aquele.
          </p>
          <div className="space-y-2">
            {mix.map((p, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <Input value={p.nome} onChange={(e) => updProduto(i, "nome", e.target.value)} className={`${inputCls} col-span-5`} placeholder="Ex.: Lotes" />
                <Input type="number" value={p.quantidade || ""} onChange={(e) => updProduto(i, "quantidade", e.target.value)} className={`${inputCls} col-span-2`} placeholder="Qtd" />
                <Input type="number" value={p.areaUnidadeM2 || ""} onChange={(e) => updProduto(i, "areaUnidadeM2", e.target.value)} className={`${inputCls} col-span-2`} placeholder="Área m²" />
                <Input type="number" value={p.precoM2 || ""} onChange={(e) => updProduto(i, "precoM2", e.target.value)} className={`${inputCls} col-span-2`} placeholder="R$/m²" />
                <button type="button" onClick={() => removerProduto(i)} className="col-span-1 text-gray-500 hover:text-red-400 flex justify-center"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addProduto} className="mt-3 flex items-center gap-1 text-xs font-bold text-[#C9A961]">
            <Plus className="h-3.5 w-3.5" /> Adicionar produto
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Secao titulo="Terreno & Urbanístico">
            <Num label="Área bruta" sufixo="m²" value={form.areaBrutaM2} onChange={set("areaBrutaM2")} step={100} />
            <Num label="Área pública" sufixo="%" value={form.pctAreaPublica} onChange={set("pctAreaPublica")} step={0.1} />
            <Num label="Área verde" sufixo="%" value={form.pctAreaVerde} onChange={set("pctAreaVerde")} step={0.1} />
            <Num label="Sistema viário" sufixo="%" value={form.pctSistemaViario} onChange={set("pctSistemaViario")} step={0.1} />
            <Num label="Faixa de servidão" sufixo="%" value={form.pctFaixaServidao} onChange={set("pctFaixaServidao")} step={0.1} />
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">APP (automática)</label>
              <div className="w-full border border-green-500/30 bg-green-500/10 rounded-md px-2.5 py-2 text-sm text-green-400 font-bold">
                {fmtM2(appM2)} ({(pctAPP * 100).toFixed(1)}%)
              </div>
            </div>
          </Secao>

          <Secao titulo="Vendas & Financeiro">
            <Num label="Duração das vendas" sufixo="meses" value={form.duracaoVendasMeses} onChange={set("duracaoVendasMeses")} />
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Perfil da curva</label>
              <select value={form.perfilVendas} onChange={(e) => set("perfilVendas")(e.target.value as PerfilVendas)} className={`${inputCls} w-full rounded-md px-2.5 py-2 text-sm`}>
                {PERFIS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <Num label="Entrada" sufixo="%" value={form.entradaPct} onChange={set("entradaPct")} step={0.5} />
            <Num label="Parcelamento" sufixo="meses" value={form.prazoParcelamentoMeses} onChange={set("prazoParcelamentoMeses")} />
            <Num label="Juros ao cliente" sufixo="% a.m." value={form.jurosClienteMensal} onChange={set("jurosClienteMensal")} step={0.01} />
            <Num label="Correção (IPCA)" sufixo="% a.m." value={form.indexacaoMensal} onChange={set("indexacaoMensal")} step={0.01} />
            <Num label="Vendas à vista" sufixo="%" value={form.vendasAVistaPct} onChange={set("vendasAVistaPct")} step={0.5} />
            <Num label="Desconto à vista" sufixo="%" value={form.descontoAVistaPct} onChange={set("descontoAVistaPct")} step={0.5} />
            <Num label="Inadimplência" sufixo="%" value={form.inadimplenciaPct} onChange={set("inadimplenciaPct")} step={0.5} />
            <Num label="Comissão" sufixo="% VGV" value={form.comissaoPctVgv} onChange={set("comissaoPctVgv")} step={0.5} />
            <Num label="Despesas gerais" sufixo="% VGV" value={form.despesasGeraisPctVgv} onChange={set("despesasGeraisPctVgv")} step={0.5} />
            <Num label="Impostos" sufixo="% VGV" value={form.impostosPctVgv} onChange={set("impostosPctVgv")} step={0.01} />
          </Secao>

          <Secao titulo="Cronograma & Terreno">
            <Num label="Início da obra" sufixo="mês" value={form.inicioObraMes} onChange={set("inicioObraMes")} />
            <Num label="Duração da obra" sufixo="meses" value={form.duracaoObraMeses} onChange={set("duracaoObraMeses")} />
            <Num label="Início das vendas" sufixo="mês" value={form.inicioVendasMes} onChange={set("inicioVendasMes")} />
            <Num label="Permuta ao terreneiro" sufixo="% VGV" value={form.permutaPctVgv} onChange={set("permutaPctVgv")} step={0.5} />
            <Num label="Taxa de desconto (VPL/TMA)" sufixo="% a.a." value={form.taxaDescontoAnual} onChange={set("taxaDescontoAnual")} step={0.5} />
          </Secao>

          <Secao titulo="Custos">
            <Num label="Infra por m² vendido" sufixo="R$/m²" value={form.custoInfraM2Lote} onChange={set("custoInfraM2Lote")} />
            <Num label="Projetos e licenças" sufixo="R$" value={form.projetosLicencas} onChange={set("projetosLicencas")} step={1000} />
            <Num label="Marketing" sufixo="R$" value={form.marketing} onChange={set("marketing")} step={1000} />
            <Num label="Registro por unidade" sufixo="R$" value={form.registroPorUnidade} onChange={set("registroPorUnidade")} />
            <Num label="Contingência" sufixo="% infra" value={form.contingenciaPctInfra} onChange={set("contingenciaPctInfra")} step={0.5} />
            <Num label="BDI" sufixo="% infra" value={form.bdiPct} onChange={set("bdiPct")} step={0.5} />
            <Num label="Taxa adm. da obra" sufixo="% obra" value={form.taxaAdministracaoObraPct} onChange={set("taxaAdministracaoObraPct")} step={0.5} />
            <Num label="Manutenção pós-obra" sufixo="% obra" value={form.manutencaoPctObra} onChange={set("manutencaoPctObra")} step={0.1} />
            <Num label="Taxa de incorporação" sufixo="% VGV" value={form.taxaIncorporacaoPctVgv} onChange={set("taxaIncorporacaoPctVgv")} step={0.1} />
            <Num label="Correção INCC da obra" sufixo="% a.m." value={form.inccObraMensal} onChange={set("inccObraMensal")} step={0.05} />
          </Secao>
        </div>

        {/* Resultado urbanístico */}
        <div className="bg-[#0F1923] border border-[#C9A961]/10 p-4 rounded-lg">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Resultado do estudo urbanístico</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Capacidade estimada" valor={urb.capacidadeEstimadaUnidades.toLocaleString("pt-BR")} destaque />
            <Kpi label="Área líquida vendável" valor={fmtM2(urb.areaVendavelM2)} />
            <Kpi label="Taxa de aproveitamento" valor={fmtPct(urb.taxaAproveitamento)} />
            <Kpi label="Preço médio/unidade" valor={fmtBRL(r.mix.precoMedioUnidade)} />
          </div>
        </div>

        {/* Cenários */}
        <div>
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Análise por cenário (sensibilidade)</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {CENARIO_META.map(({ id, label }) => {
              const c = cenarios[id];
              const ativo = cenarioAtivo === id;
              return (
                <button key={id} onClick={() => setCenarioAtivo(id)}
                  className={`text-left rounded-lg border-2 p-4 transition-colors ${ativo ? "border-[#C9A961] bg-[#C9A961]/5" : "border-[#C9A961]/10 bg-[#0F1923] hover:border-[#C9A961]/30"}`}>
                  <p className="text-xs font-bold text-gray-500 uppercase mb-1">{label}</p>
                  <p className="font-black text-white text-lg leading-none">VGV {fmtBRL(c.vgvGross)}</p>
                  <p className="text-xs text-gray-500 mt-1.5">
                    VPL: <span className={c.vpl >= 0 ? "text-green-400 font-bold" : "text-red-400 font-bold"}>{fmtBRL(c.vpl)}</span>
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Indicadores do cenário ativo */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Kpi label="VPL" valor={fmtBRL(r.vpl)} negativo={r.vpl < 0} destaque />
          <Kpi label="TIR" valor={r.tirAnual != null ? `${(r.tirAnual * 100).toFixed(2)}% a.a.` : "—"} />
          <Kpi label="ROI" valor={fmtPct(r.roi, 1)} negativo={r.roi < 0} />
          <Kpi label="Margem líquida" valor={fmtPct(r.margemLiquida, 1)} negativo={r.margemLiquida < 0} />
          <Kpi label="Payback" valor={r.paybackMes != null ? `${r.paybackMes} meses` : "não recupera"} />
          <Kpi label="Exposição máx." valor={fmtBRL(r.exposicaoMaxima)} sub={`pico no mês ${r.mesPico}`} negativo />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-[#0F1923] border border-[#C9A961]/10 p-4 rounded-lg">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">VGV de referência</p>
            <Linha label="VGV bruto (mix de produtos)" valor={fmtBRL(r.vgvGross)} />
            <Linha label="VGV líquido" valor={fmtBRL(r.vgvNet)} sub="após comissões, despesas e impostos" />
          </div>
          <div className="bg-[#0F1923] border border-[#C9A961]/10 p-4 rounded-lg">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Custos</p>
            <Linha label="Infraestrutura (c/ BDI)" valor={fmtBRL(r.custoInfra)} />
            <Linha label="Pré-venda (capital próprio, hoje)" valor={fmtBRL(r.custosPreVenda)} />
            <Linha label="Durante vendas (com receita)" valor={fmtBRL(r.custosDuranteVenda)} />
            <Linha label="Total geral (hoje)" valor={fmtBRL(r.custoTotal)} forte />
            <Linha label="Total nominal (futuro, c/ INCC)" valor={fmtBRL(r.custoTotalNominal)} />
          </div>
          <div className="bg-[#0F1923] border border-[#C9A961]/10 p-4 rounded-lg">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Distribuição de recebíveis</p>
            <Linha label={`Você recebe (${(100 - form.permutaPctVgv).toFixed(0)}%)`} valor={fmtBRL(r.recebiveis.voce)} forte />
            <Linha label={`Terreneiro (${form.permutaPctVgv.toFixed(0)}%)`} valor={fmtBRL(r.recebiveis.terreneiro)} />
            <Linha label="Total a receber" valor={fmtBRL(r.recebiveis.total)} />
            <div className="mt-2 pt-2 border-t border-[#C9A961]/10">
              <Linha label="Break-even" valor={`${r.breakEven.unidadesNecessarias.toLocaleString("pt-BR")} unidades`}
                sub={urb.capacidadeEstimadaUnidades > 0 ? `${((r.breakEven.unidadesNecessarias / urb.capacidadeEstimadaUnidades) * 100).toFixed(1)}% da capacidade` : undefined} />
            </div>
          </div>
        </div>

        {/* Fluxo de caixa acumulado */}
        <div className="bg-[#0F1923] border border-[#C9A961]/10 p-4 rounded-lg">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
            Fluxo de caixa acumulado ({CENARIO_META.find((c) => c.id === cenarioAtivo)?.label})
          </p>
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <AreaChart data={dadosGrafico} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
                <defs>
                  <linearGradient id="saldoGradViab" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#C9A961" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#C9A961" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="mes" tick={{ fontSize: 10, fill: "#9ca3af" }} tickFormatter={(m) => `M${m}`} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} width={80} tickFormatter={(v: number) => `${(v / 1_000_000).toFixed(1)}M`} />
                <Tooltip formatter={(v) => [fmtBRL(Number(v)), "Caixa acumulado"]} labelFormatter={(m) => `Mês ${m}`}
                  contentStyle={{ background: "#0F1923", border: "1px solid rgba(201,169,97,0.3)", fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="saldo" stroke="#C9A961" strokeWidth={2} fill="url(#saldoGradViab)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-gray-500 mt-2">
            Valores por fórmulas determinísticas (VPL a {form.taxaDescontoAnual}% a.a., parcelas indexadas, inadimplência, correção INCC
            da obra e permuta considerados). Estudo preliminar — não substitui projeto executivo nem análise contratual.
            Financiamento bancário/fundo de investidores ainda não modelado nesta versão (mesma limitação da origem no Grupo Santa Fé).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
