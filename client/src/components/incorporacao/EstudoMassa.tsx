import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Building2, Grid3x3, LayoutGrid, Loader2, Plus, Trash2, Trophy, AlertTriangle } from "lucide-react";
import {
  calcularPotencial,
  PARAMETROS_DEFAULT,
  type ParametrosUrbanisticos,
} from "@shared/incorporacao/urbanismo";
import { calcularQuadroAreas, type ItemQuadroAreas } from "@shared/incorporacao/quadro-areas";
import { gerarCenariosMassa, type ParametrosMassa, type CenarioMassa } from "@shared/incorporacao/massa";
import { MapaMassa } from "./MapaMassa";
import type { Feature, Polygon } from "geojson";

const cardCls = "bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm";
const inputCls = "bg-[#2C3E50] border-[#C9A961]/30 text-white";

function fmtM2(v: number) {
  return `${Math.round(v).toLocaleString("pt-BR")} m²`;
}
function fmtPct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}
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

export function EstudoMassa({ estudoId, geojson, areaM2, latitude, longitude, urbanParametersJson, potentialJson, massScenariosJson, selectedScenarioId, areasBoardJson }: {
  estudoId: number;
  geojson: string | null;
  areaM2: string;
  latitude: string | null;
  longitude: string | null;
  urbanParametersJson: string | null;
  potentialJson: string | null;
  massScenariosJson: string | null;
  selectedScenarioId: string | null;
  areasBoardJson: string | null;
}) {
  const temTerreno = !!geojson && !!latitude && !!longitude;
  const areaTerrenoM2 = parseFloat(areaM2) || 0;

  return (
    <div className="space-y-6">
      <UrbanismoPotencial estudoId={estudoId} areaTerrenoM2={areaTerrenoM2} urbanParametersJson={urbanParametersJson} potentialJson={potentialJson} />
      <MassaGenerativa
        estudoId={estudoId}
        geojson={geojson}
        temTerreno={temTerreno}
        latitude={latitude}
        longitude={longitude}
        massScenariosJson={massScenariosJson}
        selectedScenarioId={selectedScenarioId}
        urbanParametersJson={urbanParametersJson}
      />
      <QuadroDeAreas estudoId={estudoId} areaTerrenoM2={areaTerrenoM2} urbanParametersJson={urbanParametersJson} areasBoardJson={areasBoardJson} />
    </div>
  );
}

function UrbanismoPotencial({ estudoId, areaTerrenoM2, urbanParametersJson, potentialJson }: {
  estudoId: number; areaTerrenoM2: number; urbanParametersJson: string | null; potentialJson: string | null;
}) {
  const utils = trpc.useUtils();
  const [params, setParams] = useState<ParametrosUrbanisticos>(() =>
    urbanParametersJson ? { ...PARAMETROS_DEFAULT, ...JSON.parse(urbanParametersJson) } : PARAMETROS_DEFAULT
  );
  const [areaMediaUnidade, setAreaMediaUnidade] = useState<number | undefined>(() => {
    if (!potentialJson) return undefined;
    try { return JSON.parse(potentialJson).areaMediaUnidadeM2; } catch { return undefined; }
  });

  const saveMutation = trpc.incorporacao.saveUrbanismo.useMutation({
    onSuccess: () => { toast.success("Parâmetros urbanísticos salvos!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const potencial = useMemo(() => calcularPotencial(areaTerrenoM2, params, areaMediaUnidade), [areaTerrenoM2, params, areaMediaUnidade]);

  function upd<K extends keyof ParametrosUrbanisticos>(k: K, valor: string) {
    setParams((p) => ({ ...p, [k]: k === "zona" ? (valor as ParametrosUrbanisticos[K]) : ((parseFloat(valor) || 0) as ParametrosUrbanisticos[K]) }));
  }

  const campos: { k: keyof ParametrosUrbanisticos; label: string; step?: string }[] = [
    { k: "taxaOcupacao", label: "Taxa de ocupação (0-1)", step: "0.01" },
    { k: "coefAproveitamento", label: "Coef. de aproveitamento" },
    { k: "loteMinimoM2", label: "Lote mínimo (m²)" },
    { k: "testadaMinimaM", label: "Testada mínima (m)" },
    { k: "gabaritoPavimentos", label: "Gabarito (pavimentos)" },
    { k: "recuoFrontalM", label: "Recuo frontal (m)" },
    { k: "recuoLateralM", label: "Recuo lateral (m)" },
    { k: "recuoFundosM", label: "Recuo de fundos (m)" },
    { k: "percentInstitucional", label: "% institucional (0-1)", step: "0.01" },
    { k: "percentAreaVerde", label: "% área verde (0-1)", step: "0.01" },
    { k: "percentViario", label: "% viário (0-1)", step: "0.01" },
    { k: "vagasPorUnidade", label: "Vagas por unidade" },
  ];

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <Building2 className="h-5 w-5 text-[#C9A961]" /> Parâmetros Urbanísticos e Potencial Construtivo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Zona / Plano Diretor</label>
          <Input value={params.zona} onChange={(e) => upd("zona", e.target.value)} className={`${inputCls} max-w-xs`} placeholder="Ex.: ZR-2" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {campos.map((c) => (
            <div key={c.k}>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">{c.label}</label>
              <Input type="number" step={c.step ?? "1"} value={params[c.k] as number} onChange={(e) => upd(c.k, e.target.value)} className={inputCls} />
            </div>
          ))}
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Área média/unidade (m², opcional)</label>
            <Input type="number" value={areaMediaUnidade ?? ""} onChange={(e) => setAreaMediaUnidade(parseFloat(e.target.value) || undefined)} className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-[#C9A961]/10">
          <Metric label="Área edificável máxima" valor={fmtM2(potencial.areaEdificavelMaxM2)} destaque />
          <Metric label="Projeção máx. (térreo)" valor={fmtM2(potencial.projecaoMaxTerreoM2)} />
          <Metric label="Área loteável líquida" valor={fmtM2(potencial.areaLoteavelLiquidaM2)} />
          <Metric label="Área de doação" valor={fmtM2(potencial.areaDoacaoM2)} />
          <Metric label="Lotes máximos" valor={String(potencial.lotesMax)} />
          <Metric label="Unidades máx. (vertical)" valor={potencial.unidadesMaxVertical != null ? String(potencial.unidadesMaxVertical) : "—"} />
          <Metric label="Vagas exigidas" valor={potencial.vagasExigidas != null ? String(potencial.vagasExigidas) : "—"} />
        </div>

        <Button
          onClick={() => saveMutation.mutate({
            id: estudoId,
            parametrosJson: JSON.stringify(params),
            potencialJson: areaMediaUnidade ? JSON.stringify({ areaMediaUnidadeM2: areaMediaUnidade }) : undefined,
          })}
          disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
          {saveMutation.isPending ? "Salvando..." : "Salvar parâmetros urbanísticos"}
        </Button>
      </CardContent>
    </Card>
  );
}

function MassaGenerativa({ estudoId, geojson, temTerreno, latitude, longitude, massScenariosJson, selectedScenarioId, urbanParametersJson }: {
  estudoId: number; geojson: string | null; temTerreno: boolean; latitude: string | null; longitude: string | null;
  massScenariosJson: string | null; selectedScenarioId: string | null; urbanParametersJson: string | null;
}) {
  const utils = trpc.useUtils();
  const urb = urbanParametersJson ? (JSON.parse(urbanParametersJson) as Partial<ParametrosUrbanisticos>) : null;

  const [params, setParams] = useState<ParametrosMassa>(() => {
    const salvo = massScenariosJson ? JSON.parse(massScenariosJson) : null;
    return (
      salvo?.params ?? {
        larguraViaM: 12,
        testadaLoteM: urb?.testadaMinimaM ?? 10,
        profundidadeLoteM: 25,
        loteMinimoM2: urb?.loteMinimoM2 ?? 250,
        comprimentoMaxQuadraM: 120,
        percentInstitucional: urb?.percentInstitucional ?? 0.05,
        percentAreaVerde: urb?.percentAreaVerde ?? 0.1,
        precoM2Lote: 500,
      }
    );
  });
  const [cenarios, setCenarios] = useState<CenarioMassa[]>(() => {
    const salvo = massScenariosJson ? JSON.parse(massScenariosJson) : null;
    return salvo?.cenarios ?? [];
  });
  const [selecionado, setSelecionado] = useState<string | null>(selectedScenarioId);
  const [gerando, setGerando] = useState(false);

  const saveMutation = trpc.incorporacao.saveMassa.useMutation({
    onSuccess: () => { toast.success("Cenários salvos!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  function upd<K extends keyof ParametrosMassa>(k: K, valor: string) {
    setParams((p) => ({ ...p, [k]: parseFloat(valor) || 0 }));
  }

  function gerar() {
    if (!geojson || !latitude || !longitude) return;
    setGerando(true);
    setTimeout(() => {
      try {
        const feature = JSON.parse(geojson) as Feature<Polygon>;
        const anel = feature.geometry.coordinates[0];
        const novos = gerarCenariosMassa(
          anel,
          [parseFloat(longitude), parseFloat(latitude)],
          params,
          { populacao: 14, geracoes: 12, seed: Date.now() % 100000, nCenarios: 3 }
        );
        setCenarios(novos);
        setSelecionado(novos[0]?.id ?? null);
      } finally {
        setGerando(false);
      }
    }, 30);
  }

  const cenarioAtivo = cenarios.find((c) => c.id === selecionado) ?? cenarios[0];

  const campos: { k: keyof ParametrosMassa; label: string; step?: string }[] = [
    { k: "testadaLoteM", label: "Testada do lote (m)", step: "0.5" },
    { k: "profundidadeLoteM", label: "Profundidade (m)" },
    { k: "loteMinimoM2", label: "Lote mínimo (m²)" },
    { k: "larguraViaM", label: "Largura da via (m)" },
    { k: "comprimentoMaxQuadraM", label: "Quadra máx. (m)" },
    { k: "precoM2Lote", label: "Preço lote (R$/m²)" },
    { k: "percentInstitucional", label: "% institucional (0-1)", step: "0.01" },
    { k: "percentAreaVerde", label: "% área verde (0-1)", step: "0.01" },
  ];

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <Grid3x3 className="h-5 w-5 text-[#C9A961]" /> Estudo de Massa Generativo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!temTerreno && <p className="text-xs text-gray-500">Envie o KML do terreno (aba Terreno) antes de gerar o estudo de massa.</p>}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {campos.map((c) => (
            <div key={c.k}>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">{c.label}</label>
              <Input type="number" step={c.step ?? "1"} value={params[c.k]} onChange={(e) => upd(c.k, e.target.value)} className={inputCls} />
            </div>
          ))}
        </div>

        <Button onClick={gerar} disabled={gerando || !temTerreno} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
          {gerando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Grid3x3 className="h-4 w-4 mr-2" />}
          {gerando ? "Otimizando cenários (algoritmo genético)..." : "Gerar cenários otimizados"}
        </Button>

        {cenarios.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {cenarios.map((c, i) => {
                const ativo = c.id === selecionado;
                return (
                  <button key={c.id} type="button" onClick={() => setSelecionado(c.id)}
                    className={`text-left rounded-lg p-4 border transition-colors ${ativo ? "border-[#C9A961] bg-[#C9A961]/10" : "border-[#C9A961]/10 bg-[#0F1923] hover:border-[#C9A961]/30"}`}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-black text-white uppercase flex items-center gap-1">
                        {i === 0 && <Trophy className="h-3.5 w-3.5 text-[#C9A961]" />} Cenário {i + 1}
                      </p>
                      <span className="text-[10px] text-gray-500">malha {c.anguloVia}°</span>
                    </div>
                    <p className="font-black text-white text-xl leading-none mb-1">{c.kpis.lotesVendaveis} lotes</p>
                    <p className="text-[11px] text-gray-400">
                      {c.kpis.areaVendavelM2.toLocaleString("pt-BR")} m² vendáveis · {(c.kpis.aproveitamento * 100).toFixed(0)}% aproveitamento
                    </p>
                    <p className="text-sm font-bold text-[#C9A961] mt-1">VGV {fmtBRL(c.kpis.vgv)}</p>
                    <p className="text-[10px] text-gray-500 mt-1">lote {c.testadaLoteM}×{c.profundidadeLoteM}m · via {c.larguraViaM}m</p>
                  </button>
                );
              })}
            </div>

            {cenarioAtivo && geojson && (
              <div className="rounded-lg overflow-hidden border border-[#C9A961]/10 p-1 bg-[#0F1923]">
                <MapaMassa geojson={geojson} lotes={cenarioAtivo.lotes} />
                <p className="text-[10px] text-gray-500 p-2">
                  Dourado = lotes vendáveis · Verde = doação (institucional/área verde). Estudo de aproveitamento — não substitui projeto urbanístico aprovado.
                </p>
              </div>
            )}

            <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify({ params, cenarios }), selectedScenarioId: selecionado })}
              disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
              {saveMutation.isPending ? "Salvando..." : "Salvar cenários"}
            </Button>
          </>
        )}

        {cenarios.length === 0 && !gerando && temTerreno && (
          <div className="border border-dashed border-[#C9A961]/30 rounded-lg p-8 text-center">
            <Grid3x3 className="h-8 w-8 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 font-medium">Nenhum cenário gerado</p>
            <p className="text-gray-500 text-sm mt-1">O motor testa dezenas de malhas viárias e dimensões de lote e devolve as 3 melhores por VGV.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function defaultsQuadro(coeficiente: number): { coeficienteAproveitamento: number; itens: ItemQuadroAreas[] } {
  return {
    coeficienteAproveitamento: coeficiente,
    itens: [{ pavimento: "Torre padrão", areaConstCobertaM2: 0, areaConstDescobertaM2: 0, areaUrbanizadaM2: 0, areaDescontarM2: 0, areaComputavelM2: 0, areaPrivativaM2: 0 }],
  };
}

function QuadroDeAreas({ estudoId, areaTerrenoM2, urbanParametersJson, areasBoardJson }: {
  estudoId: number; areaTerrenoM2: number; urbanParametersJson: string | null; areasBoardJson: string | null;
}) {
  const utils = trpc.useUtils();
  const coeficienteLegado = urbanParametersJson ? (JSON.parse(urbanParametersJson).coefAproveitamento ?? 1) : 1;

  const [dados, setDados] = useState<{ coeficienteAproveitamento: number; itens: ItemQuadroAreas[] }>(() => {
    if (areasBoardJson) {
      try {
        const salvo = JSON.parse(areasBoardJson) as Partial<{ coeficienteAproveitamento: number; itens: ItemQuadroAreas[] }>;
        if (salvo.itens?.length) return { ...defaultsQuadro(coeficienteLegado), ...salvo };
      } catch { /* JSON corrompido -> defaults */ }
    }
    return defaultsQuadro(coeficienteLegado);
  });

  const saveMutation = trpc.incorporacao.saveAreasBoard.useMutation({
    onSuccess: () => { toast.success("Quadro de áreas salvo!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const resultado = useMemo(() => calcularQuadroAreas(dados.itens, areaTerrenoM2, dados.coeficienteAproveitamento), [dados, areaTerrenoM2]);

  function addItem() {
    setDados((d) => ({ ...d, itens: [...d.itens, { pavimento: "Novo pavimento", areaConstCobertaM2: 0, areaConstDescobertaM2: 0, areaUrbanizadaM2: 0, areaDescontarM2: 0, areaComputavelM2: 0, areaPrivativaM2: 0 }] }));
  }
  function removerItem(i: number) {
    setDados((d) => ({ ...d, itens: d.itens.filter((_, j) => j !== i) }));
  }
  function updItem(i: number, campo: keyof ItemQuadroAreas, valor: string) {
    setDados((d) => {
      const itens = [...d.itens];
      itens[i] = { ...itens[i], [campo]: campo === "pavimento" ? valor : (parseFloat(valor) || 0) };
      return { ...d, itens };
    });
  }

  const COLS: { campo: keyof ItemQuadroAreas; label: string }[] = [
    { campo: "areaConstCobertaM2", label: "Const. coberta" },
    { campo: "areaConstDescobertaM2", label: "Const. descoberta" },
    { campo: "areaUrbanizadaM2", label: "Urbanizada" },
    { campo: "areaDescontarM2", label: "A descontar" },
    { campo: "areaComputavelM2", label: "Computável" },
    { campo: "areaPrivativaM2", label: "Privativa (APV)" },
  ];

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <LayoutGrid className="h-5 w-5 text-[#C9A961]" /> Quadro de Áreas (NBR 12721)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">
          Um pavimento por linha. A área computável de cada pavimento é lançada por julgamento legal/municipal
          (nem sempre coincide com a área construída) — use as colunas de referência para decidir.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Metric label="Área do terreno" valor={fmtM2(areaTerrenoM2)} />
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Coeficiente de aproveitamento (CA)</label>
            <Input type="number" step={0.05} value={dados.coeficienteAproveitamento} onChange={(e) => setDados((d) => ({ ...d, coeficienteAproveitamento: parseFloat(e.target.value) || 0 }))} className={inputCls} />
          </div>
          <Metric label="Área computável máxima" valor={fmtM2(resultado.areaComputavelMaximaM2)} />
        </div>

        <div className="overflow-x-auto">
          <table className="text-xs min-w-[720px] w-full">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-40">Pavimento</th>
                {COLS.map((c) => <th key={c.campo} className="text-left text-[10px] font-bold text-gray-500 uppercase tracking-wide px-1 pb-1 w-24">{c.label}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {dados.itens.map((it, i) => (
                <tr key={i}>
                  <td className="px-1 py-1"><Input value={it.pavimento} onChange={(e) => updItem(i, "pavimento", e.target.value)} className={inputCls} placeholder="Ex.: Torre A" /></td>
                  {COLS.map((c) => (
                    <td key={c.campo} className="px-1 py-1">
                      <Input type="number" value={(it[c.campo] as number) || ""} onChange={(e) => updItem(i, c.campo, e.target.value)} className={`${inputCls} text-right`} />
                    </td>
                  ))}
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

        {resultado.excedeCoeficiente && (
          <div className="bg-red-950/40 border border-red-900/50 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">
              A área computável total ({fmtM2(resultado.areaComputavelTotalM2)}) excede a área computável máxima permitida pelo
              coeficiente de aproveitamento ({fmtM2(resultado.areaComputavelMaximaM2)}). Revise o mix ou confirme o coeficiente com a prefeitura.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Área const. coberta (ACC)" valor={fmtM2(resultado.areaConstCobertaTotalM2)} />
          <Metric label="Área const. total (ACT)" valor={fmtM2(resultado.areaConstTotalM2)} />
          <Metric label="Área privativa (APV)" valor={fmtM2(resultado.areaPrivativaTotalM2)} destaque />
          <Metric label="Área computável total" valor={fmtM2(resultado.areaComputavelTotalM2)} />
          <Metric label="Eficiência (APV/ACC)" valor={fmtPct(resultado.indiceApvAcc)} />
          <Metric label="Aproveitamento do coeficiente" valor={fmtPct(resultado.aproveitamentoPct)} negativo={resultado.excedeCoeficiente} />
        </div>

        <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify(dados) })}
          disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
          {saveMutation.isPending ? "Salvando..." : "Salvar quadro de áreas"}
        </Button>
      </CardContent>
    </Card>
  );
}
