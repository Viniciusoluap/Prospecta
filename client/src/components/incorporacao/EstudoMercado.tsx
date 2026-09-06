import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { TrendingUp, Sparkles, Loader2, Plus, Trash2, Scale, ClipboardList } from "lucide-react";
import {
  calcularPrecificacaoPorComparaveis,
  type AtributoComparavel,
  type Comparavel,
} from "@shared/incorporacao/precificacao";
import {
  resumoPesquisaPrimaria,
  ITENS_CONDOMINIO,
  type Entrevistado,
  type FaixaEtaria,
  type FaixaRenda,
  type ItemCondominio,
  type NivelImportancia,
  type TipoImovel,
} from "@shared/incorporacao/pesquisa-primaria";

interface CidadeResearch {
  populacao: number; crescimentoAnualPct: number; pibPerCapita: number;
  principaisAtividades: string[]; rendaMediaMensal: number;
  deficitHabitacional: string; resumo: string;
}
interface MercadoStudy {
  precoM2Lote: number; precoM2Casa: number; precoM2Apartamento: number;
  velocidadeVendas: string;
  demandaPorProduto: { produto: string; demanda: string; publico: string }[];
  concorrentes: { nome: string; produto: string; faixaPreco: string }[];
  comparaveis: { descricao: string; preco: number; area: number; precoPorM2: number }[];
  oportunidades: string; riscos: string;
}

function formatCurrency(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

const cardCls = "bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm";

export function EstudoMercado({ estudoId, city, state, cityResearchJson, marketStudyJson, comparablePricingJson, primaryResearchJson }: {
  estudoId: number;
  city: string;
  state: string;
  cityResearchJson: string | null;
  marketStudyJson: string | null;
  comparablePricingJson: string | null;
  primaryResearchJson: string | null;
}) {
  const utils = trpc.useUtils();
  const [cidade, setCidade] = useState<CidadeResearch | null>(cityResearchJson ? JSON.parse(cityResearchJson) : null);
  const [mercado, setMercado] = useState<MercadoStudy | null>(marketStudyJson ? JSON.parse(marketStudyJson) : null);

  const pesquisarMutation = trpc.incorporacao.pesquisarMercado.useMutation({
    onSuccess: (data) => {
      setCidade(data.cidade);
      setMercado(data.mercado);
      toast.success("Pesquisa de mercado concluída!");
      utils.incorporacao.getById.invalidate({ id: estudoId });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <Card className={cardCls}>
        <CardHeader>
          <CardTitle className="text-white text-lg flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-[#C9A961]" /> Inteligência de Mercado
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={() => pesquisarMutation.mutate({ id: estudoId, municipio: city, estado: state })}
              disabled={pesquisarMutation.isPending}
              className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
              {pesquisarMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              {pesquisarMutation.isPending ? "Pesquisando (até 1 min)..." : cidade ? "Refazer pesquisa (IA)" : "Pesquisar cidade + mercado (IA)"}
            </Button>
            <span className="text-xs text-gray-500">IBGE, prefeitura e portais imobiliários de {city}/{state}</span>
          </div>
          <p className="text-[10px] text-gray-500">
            A pesquisa por IA depende de <code>ANTHROPIC_API_KEY</code> e da flag <code>INCORPORACAO_IA_ATIVA=1</code> no ambiente
            (desativada por padrão para não gerar custo de API sem intenção). Enquanto isso, use a precificação por comparáveis
            e a pesquisa primária abaixo, que funcionam com dados informados manualmente.
          </p>

          {cidade && (
            <div className="border border-[#C9A961]/10 rounded-lg p-4 space-y-3 bg-[#0F1923]">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Dado label="População" valor={cidade.populacao ? cidade.populacao.toLocaleString("pt-BR") : "—"} />
                <Dado label="Crescimento anual" valor={cidade.crescimentoAnualPct ? `${cidade.crescimentoAnualPct}%` : "—"} />
                <Dado label="PIB per capita" valor={cidade.pibPerCapita ? formatCurrency(cidade.pibPerCapita) : "—"} />
                <Dado label="Renda média" valor={cidade.rendaMediaMensal ? formatCurrency(cidade.rendaMediaMensal) : "—"} />
              </div>
              {cidade.resumo && <p className="text-sm text-gray-300 leading-relaxed">{cidade.resumo}</p>}
            </div>
          )}

          {mercado && (
            <div className="grid grid-cols-3 gap-3">
              <Dado label="m² Lote" valor={mercado.precoM2Lote ? formatCurrency(mercado.precoM2Lote) : "—"} />
              <Dado label="m² Casa" valor={mercado.precoM2Casa ? formatCurrency(mercado.precoM2Casa) : "—"} />
              <Dado label="m² Apartamento" valor={mercado.precoM2Apartamento ? formatCurrency(mercado.precoM2Apartamento) : "—"} />
            </div>
          )}

          {!cidade && !pesquisarMutation.isPending && (
            <div className="border border-dashed border-[#C9A961]/30 rounded-lg p-8 text-center">
              <TrendingUp className="h-8 w-8 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 font-medium">Pesquisa ainda não realizada</p>
            </div>
          )}
        </CardContent>
      </Card>

      <PrecificacaoComparaveis estudoId={estudoId} comparablePricingJson={comparablePricingJson} />
      <PesquisaPrimaria estudoId={estudoId} primaryResearchJson={primaryResearchJson} />
    </div>
  );
}

function Dado({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{label}</p>
      <p className="font-black text-white">{valor}</p>
    </div>
  );
}

interface DadosPrecificacao {
  atributos: AtributoComparavel[];
  notasNovo: number[];
  comparaveis: Comparavel[];
}

function defaultsPrecificacao(): DadosPrecificacao {
  return {
    atributos: [
      { nome: "Localização", peso: 3 },
      { nome: "Lazer e amenidades", peso: 2 },
      { nome: "Padrão construtivo", peso: 2 },
    ],
    notasNovo: [3, 3, 3],
    comparaveis: [],
  };
}

function PrecificacaoComparaveis({ estudoId, comparablePricingJson }: { estudoId: number; comparablePricingJson: string | null }) {
  const utils = trpc.useUtils();
  const [dados, setDados] = useState<DadosPrecificacao>(() => {
    if (comparablePricingJson) {
      try {
        const salvo = JSON.parse(comparablePricingJson) as Partial<DadosPrecificacao>;
        if (salvo.atributos?.length) return { ...defaultsPrecificacao(), ...salvo };
      } catch { /* JSON corrompido -> defaults */ }
    }
    return defaultsPrecificacao();
  });

  const saveMutation = trpc.incorporacao.savePrecificacao.useMutation({
    onSuccess: () => { toast.success("Precificação salva!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const resultado = useMemo(
    () => calcularPrecificacaoPorComparaveis(dados.atributos, dados.notasNovo, dados.comparaveis),
    [dados]
  );

  function addAtributo() {
    setDados((d) => ({
      atributos: [...d.atributos, { nome: "Novo atributo", peso: 1 }],
      notasNovo: [...d.notasNovo, 1],
      comparaveis: d.comparaveis.map((c) => ({ ...c, notas: [...c.notas, 1] })),
    }));
  }
  function removerAtributo(i: number) {
    setDados((d) => ({
      atributos: d.atributos.filter((_, j) => j !== i),
      notasNovo: d.notasNovo.filter((_, j) => j !== i),
      comparaveis: d.comparaveis.map((c) => ({ ...c, notas: c.notas.filter((_, j) => j !== i) })),
    }));
  }
  function updAtributo(i: number, campo: "nome" | "peso", valor: string) {
    setDados((d) => {
      const atributos = [...d.atributos];
      atributos[i] = { ...atributos[i], [campo]: campo === "nome" ? valor : parseFloat(valor) || 0 };
      return { ...d, atributos };
    });
  }
  function updNotaNovo(i: number, valor: string) {
    setDados((d) => {
      const notasNovo = [...d.notasNovo];
      notasNovo[i] = parseFloat(valor) || 0;
      return { ...d, notasNovo };
    });
  }
  function addComparavel() {
    setDados((d) => ({ ...d, comparaveis: [...d.comparaveis, { nome: "", precoM2: null, notas: d.atributos.map(() => 1) }] }));
  }
  function removerComparavel(i: number) {
    setDados((d) => ({ ...d, comparaveis: d.comparaveis.filter((_, j) => j !== i) }));
  }
  function updComparavel(i: number, campo: "nome" | "precoM2", valor: string) {
    setDados((d) => {
      const comparaveis = [...d.comparaveis];
      comparaveis[i] = { ...comparaveis[i], [campo]: campo === "nome" ? valor : (parseFloat(valor) || null) };
      return { ...d, comparaveis };
    });
  }
  function updNotaComparavel(i: number, atributoIdx: number, valor: string) {
    setDados((d) => {
      const comparaveis = [...d.comparaveis];
      const notas = [...comparaveis[i].notas];
      notas[atributoIdx] = parseFloat(valor) || 0;
      comparaveis[i] = { ...comparaveis[i], notas };
      return { ...d, comparaveis };
    });
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <Scale className="h-5 w-5 text-[#C9A961]" /> Precificação por comparáveis ponderados
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-2xl">
          Dê um peso (0–3) para o que mais importa na decisão de compra, uma nota (0–3) para o seu empreendimento e para
          cada concorrente com preço/m² conhecido. O preço sugerido escala o preço médio dos concorrentes pela proporção
          entre as notas ponderadas.
        </p>

        <div className="space-y-1.5">
          {dados.atributos.map((a, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <Input value={a.nome} onChange={(e) => updAtributo(i, "nome", e.target.value)}
                className="col-span-6 bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Ex.: Localização" />
              <Input type="number" min={0} max={3} step={0.5} value={a.peso}
                onChange={(e) => updAtributo(i, "peso", e.target.value)} className="col-span-2 bg-[#2C3E50] border-[#C9A961]/30 text-white" />
              <Input type="number" min={0} max={3} step={0.5} value={dados.notasNovo[i] ?? 0}
                onChange={(e) => updNotaNovo(i, e.target.value)} className="col-span-3 bg-[#2C3E50] border-[#C9A961]/30 text-white" />
              <button type="button" onClick={() => removerAtributo(i)} className="col-span-1 text-gray-500 hover:text-red-400 flex justify-center">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addAtributo} className="flex items-center gap-1 text-xs font-bold text-[#C9A961]">
          <Plus className="h-3.5 w-3.5" /> Adicionar atributo
        </button>

        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Concorrentes</p>
          <div className="overflow-x-auto">
            <table className="text-xs min-w-[480px] w-full">
              <tbody>
                {dados.comparaveis.map((c, i) => (
                  <tr key={i}>
                    <td className="px-1 py-1 w-40"><Input value={c.nome} onChange={(e) => updComparavel(i, "nome", e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Concorrente" /></td>
                    <td className="px-1 py-1 w-28"><Input type="number" value={c.precoM2 ?? ""} onChange={(e) => updComparavel(i, "precoM2", e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="R$/m²" /></td>
                    {dados.atributos.map((_, ai) => (
                      <td key={ai} className="px-1 py-1 w-20">
                        <Input type="number" min={0} max={3} step={0.5} value={c.notas[ai] ?? 0}
                          onChange={(e) => updNotaComparavel(i, ai, e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white text-center" />
                      </td>
                    ))}
                    <td className="px-1 py-1">
                      <button type="button" onClick={() => removerComparavel(i)} className="text-gray-500 hover:text-red-400 flex justify-center"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={addComparavel} className="mt-2 flex items-center gap-1 text-xs font-bold text-[#C9A961]">
            <Plus className="h-3.5 w-3.5" /> Adicionar concorrente
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-[#C9A961]/10">
          <Dado label="Preço sugerido/m²" valor={resultado.precoSugeridoM2 > 0 ? formatCurrency(resultado.precoSugeridoM2) : "—"} />
          <Dado label="Nota ponderada — você" valor={resultado.notaPonderadaNovo.toFixed(2)} />
          <Dado label="Nota ponderada média — mercado" valor={resultado.notaPonderadaMediaComparaveis.toFixed(2)} />
          <Dado label="Concorrentes válidos" valor={String(resultado.comparaveisValidos)} />
        </div>

        <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify(dados) })}
          disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
          {saveMutation.isPending ? "Salvando..." : "Salvar precificação"}
        </Button>
      </CardContent>
    </Card>
  );
}

const TIPOS: { value: TipoImovel; label: string }[] = [
  { value: "apartamento", label: "Apartamento" },
  { value: "casa_condominio", label: "Casa em condomínio" },
  { value: "casa_rua_aberta", label: "Casa em rua aberta" },
  { value: "lote", label: "Lote" },
];
const FAIXAS_ETARIAS: FaixaEtaria[] = ["18-25", "26-35", "36-45", "46-55", "56+"];
const FAIXAS_RENDA: { value: FaixaRenda; label: string }[] = [
  { value: "ate_2sm", label: "Até 2 SM" },
  { value: "2_4sm", label: "2 a 4 SM" },
  { value: "4_8sm", label: "4 a 8 SM" },
  { value: "8_15sm", label: "8 a 15 SM" },
  { value: "acima_15sm", label: "Acima de 15 SM" },
];
const NIVEIS: { value: NivelImportancia; label: string }[] = [
  { value: "importante_paga_mais", label: "Importante, paga mais" },
  { value: "decisivo_sem_pagar_mais", label: "Decisivo, não paga mais" },
  { value: "pouco_importante", label: "Pouco importante" },
];

function novoEntrevistado(): Entrevistado {
  return {
    id: Math.random().toString(36).slice(2),
    nome: "", faixaEtaria: "", faixaRenda: "",
    temImovelProprio: false, interesseComprar12Meses: true, tiposInteresse: [],
    notaApartamento: 0, notaCasaCondominio: 0, notaCasaRuaAberta: 0,
    tamanhoIdealM2: 0, quartosNecessarios: 0, itensImportancia: {},
  };
}

function PesquisaPrimaria({ estudoId, primaryResearchJson }: { estudoId: number; primaryResearchJson: string | null }) {
  const utils = trpc.useUtils();
  const [entrevistados, setEntrevistados] = useState<Entrevistado[]>(() => {
    if (primaryResearchJson) {
      try {
        const salvo = JSON.parse(primaryResearchJson) as { entrevistados?: Entrevistado[] };
        return salvo.entrevistados ?? [];
      } catch { /* JSON corrompido -> vazio */ }
    }
    return [];
  });
  const [aberto, setAberto] = useState(false);

  const saveMutation = trpc.incorporacao.savePesquisaPrimaria.useMutation({
    onSuccess: () => { toast.success("Pesquisa primária salva!"); utils.incorporacao.getById.invalidate({ id: estudoId }); },
    onError: (e) => toast.error(e.message),
  });

  const resumo = useMemo(() => resumoPesquisaPrimaria(entrevistados), [entrevistados]);

  function addEntrevistado() { setEntrevistados((e) => [...e, novoEntrevistado()]); setAberto(true); }
  function removerEntrevistado(id: string) { setEntrevistados((e) => e.filter((x) => x.id !== id)); }
  function upd<K extends keyof Entrevistado>(id: string, campo: K, valor: Entrevistado[K]) {
    setEntrevistados((es) => es.map((e) => (e.id === id ? { ...e, [campo]: valor } : e)));
  }
  function toggleTipo(id: string, tipo: TipoImovel) {
    setEntrevistados((es) => es.map((e) => {
      if (e.id !== id) return e;
      const tem = e.tiposInteresse.includes(tipo);
      return { ...e, tiposInteresse: tem ? e.tiposInteresse.filter((t) => t !== tipo) : [...e.tiposInteresse, tipo] };
    }));
  }
  function updItem(id: string, item: ItemCondominio, nivel: NivelImportancia | "") {
    setEntrevistados((es) => es.map((e) => {
      if (e.id !== id) return e;
      const itens = { ...e.itensImportancia };
      if (nivel === "") delete itens[item];
      else itens[item] = nivel;
      return { ...e, itensImportancia: itens };
    }));
  }

  return (
    <Card className={cardCls}>
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-[#C9A961]" /> Pesquisa Primária com Compradores {entrevistados.length > 0 && `(${entrevistados.length})`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-400 max-w-xl">
          Questionário de perfil e interesse aplicado a potenciais compradores — complementa a pesquisa de mercado por IA
          com dados reais de campo.
        </p>

        {entrevistados.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Dado label="Entrevistados" valor={String(resumo.totalEntrevistados)} />
            <Dado label="Interesse em comprar (12m)" valor={`${resumo.pctInteresseComprar12Meses}%`} />
            <Dado label="Tamanho ideal médio" valor={`${resumo.tamanhoIdealMedioM2} m²`} />
            <Dado label="Quartos mais pedidos" valor={resumo.quartosModaNecessarios ? String(resumo.quartosModaNecessarios) : "—"} />
          </div>
        )}

        {aberto && (
          <div className="space-y-3">
            {entrevistados.map((e) => (
              <div key={e.id} className="border border-[#C9A961]/10 rounded-lg p-3 space-y-2 bg-[#0F1923]">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Input value={e.nome} onChange={(ev) => upd(e.id, "nome", ev.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Nome do entrevistado" />
                  <Input value={e.contato ?? ""} onChange={(ev) => upd(e.id, "contato", ev.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Telefone/e-mail" />
                  <select value={e.faixaEtaria} onChange={(ev) => upd(e.id, "faixaEtaria", ev.target.value as FaixaEtaria)} className="bg-[#2C3E50] border border-[#C9A961]/30 text-white rounded-md px-2 text-sm">
                    <option value="">Faixa etária</option>
                    {FAIXAS_ETARIAS.map((f) => <option key={f} value={f}>{f} anos</option>)}
                  </select>
                  <select value={e.faixaRenda} onChange={(ev) => upd(e.id, "faixaRenda", ev.target.value as FaixaRenda)} className="bg-[#2C3E50] border border-[#C9A961]/30 text-white rounded-md px-2 text-sm">
                    <option value="">Faixa de renda</option>
                    {FAIXAS_RENDA.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-center">
                  <label className="flex items-center gap-1.5 text-xs text-gray-400">
                    <input type="checkbox" checked={e.temImovelProprio} onChange={(ev) => upd(e.id, "temImovelProprio", ev.target.checked)} /> Tem imóvel próprio
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-400">
                    <input type="checkbox" checked={e.interesseComprar12Meses} onChange={(ev) => upd(e.id, "interesseComprar12Meses", ev.target.checked)} /> Interesse em comprar (12m)
                  </label>
                  <Input type="number" value={e.tamanhoIdealM2 || ""} onChange={(ev) => upd(e.id, "tamanhoIdealM2", parseFloat(ev.target.value) || 0)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Tamanho ideal (m²)" />
                  <Input type="number" value={e.quartosNecessarios || ""} onChange={(ev) => upd(e.id, "quartosNecessarios", parseFloat(ev.target.value) || 0)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Quartos necessários" />
                </div>

                <div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Tipos de imóvel de interesse</p>
                  <div className="flex flex-wrap gap-3">
                    {TIPOS.map((t) => (
                      <label key={t.value} className="flex items-center gap-1.5 text-xs text-gray-400">
                        <input type="checkbox" checked={e.tiposInteresse.includes(t.value)} onChange={() => toggleTipo(e.id, t.value)} /> {t.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Importância dos itens de condomínio</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {ITENS_CONDOMINIO.map((item) => (
                      <div key={item} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-28 shrink-0">{item}</span>
                        <select value={e.itensImportancia[item] ?? ""} onChange={(ev) => updItem(e.id, item, ev.target.value as NivelImportancia | "")}
                          className="bg-[#2C3E50] border border-[#C9A961]/30 text-white rounded-md px-2 text-xs flex-1">
                          <option value="">—</option>
                          {NIVEIS.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end">
                  <button type="button" onClick={() => removerEntrevistado(e.id)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-400">
                    <Trash2 className="h-3.5 w-3.5" /> Remover entrevistado
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={addEntrevistado} className="flex items-center gap-1 text-xs font-bold text-[#C9A961]">
            <Plus className="h-3.5 w-3.5" /> Adicionar entrevistado
          </button>
          {entrevistados.length > 0 && !aberto && (
            <button type="button" onClick={() => setAberto(true)} className="text-xs text-gray-400 hover:text-white">Ver entrevistados</button>
          )}
          <Button onClick={() => saveMutation.mutate({ id: estudoId, dataJson: JSON.stringify({ entrevistados }) })}
            disabled={saveMutation.isPending} className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold ml-auto">
            {saveMutation.isPending ? "Salvando..." : "Salvar pesquisa"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
