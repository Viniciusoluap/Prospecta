import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { TerrenoTopografia } from "@/components/incorporacao/TerrenoTopografia";
import { EstudoMercado } from "@/components/incorporacao/EstudoMercado";
import { EstudoMassa } from "@/components/incorporacao/EstudoMassa";
import { OrcamentoNegociacao } from "@/components/incorporacao/OrcamentoNegociacao";
import { BusinessPlan } from "@/components/incorporacao/BusinessPlan";
import { ProjetistasAprovacao } from "@/components/incorporacao/ProjetistasAprovacao";
import { RegistroOrcamentoPreliminar } from "@/components/incorporacao/RegistroOrcamentoPreliminar";
import { LancamentoMarketing } from "@/components/incorporacao/LancamentoMarketing";
import { LancamentoImobiliario } from "@/components/incorporacao/LancamentoImobiliario";
import { ObraExecutiva } from "@/components/incorporacao/ObraExecutiva";
import { AtendimentoRelatorio } from "@/components/incorporacao/AtendimentoRelatorio";
import { ViabilidadeEconomica } from "@/components/incorporacao/ViabilidadeEconomica";

const STATUS_OPTIONS = [
  { value: "in_study", label: "Em estudo" },
  { value: "unfeasible", label: "Inviável" },
  { value: "in_progress", label: "Em andamento" },
  { value: "completed", label: "Concluído" },
];

const MODULOS = [
  ["dados", "Dados Gerais"], ["terreno", "Terreno e Topografia"],
  ["mercado", "Inteligência de Mercado"], ["massa", "Estudo de Massa Generativa"],
  ["orcamento", "Orçamento e Negociação"], ["business", "Business/Investidores"],
  ["projeto", "Projeto Aprovado"], ["registro", "Registro e Orçamento"],
  ["lancamento", "Planejamento do Lançamento"], ["unidades", "Unidades à Venda"],
  ["obra", "Obra Executiva"], ["relatorio", "Atendimento e Relatório"],
  ["viabilidade", "Viabilidade Econômica"],
] as const;

export default function AdminIncorporacaoDetail() {
  const { id } = useParams<{ id: string }>();
  const utils = trpc.useUtils();

  const { data: estudo, isLoading } = trpc.incorporacao.getById.useQuery({ id: Number(id) });
  const { data: versoes = [] } = trpc.incorporacao.versions.useQuery({ id: Number(id) }, { enabled: !!Number(id) });
  const { data: equipe = [] } = trpc.incorporacao.staff.useQuery();
  const [erroVersao, setErroVersao] = useState("");
  const [moduloAtivo, setModuloAtivo] = useState<(typeof MODULOS)[number][0]>("dados");
  const [alterado, setAlterado] = useState(false);

  useEffect(() => {
    if (!alterado) return;
    const avisar = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [alterado]);

  async function baixarVersao(revision: number) {
    setErroVersao("");
    try {
      const version = await utils.incorporacao.versionSnapshot.fetch({ id: Number(id), revision });
      const url = URL.createObjectURL(new Blob([version.snapshot], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `estudo-${id}-versao-${revision}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) { setErroVersao(e instanceof Error ? e.message : "Falha ao obter a versão"); }
  }

  const [form, setForm] = useState({ name: "", city: "", state: "", address: "", responsible: "", status: "in_study",
    propertyRegistration: "", carRegistration: "", officialZoning: "", zoningSource: "" });

  useEffect(() => {
    if (estudo) {
      setForm({
        name: estudo.name ?? "",
        city: estudo.city ?? "",
        state: estudo.state ?? "",
        address: estudo.address ?? "",
        responsible: estudo.responsible ?? "",
        status: STATUS_OPTIONS.some((option) => option.value === estudo.status) ? estudo.status : "",
        propertyRegistration: estudo.propertyRegistration ?? "",
        carRegistration: estudo.carRegistration ?? "",
        officialZoning: estudo.officialZoning ?? "",
        zoningSource: estudo.zoningSource ?? "",
      });
    }
  }, [estudo]);

  const updateMutation = trpc.incorporacao.update.useMutation({
    onSuccess: () => {
      toast.success("Estudo atualizado!");
      setAlterado(false);
      utils.incorporacao.getById.invalidate({ id: Number(id) });
      utils.incorporacao.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = () => {
    if (!form.status) {
      toast.error("Classifique a situação antiga deste estudo antes de salvar.");
      return;
    }
    updateMutation.mutate({
      id: Number(id),
      name: form.name,
      city: form.city,
      state: form.state || undefined,
      address: form.address || undefined,
      responsible: form.responsible || undefined,
      status: form.status as "in_study" | "unfeasible" | "in_progress" | "completed",
      propertyRegistration: form.propertyRegistration.trim() || null,
      carRegistration: form.carRegistration.trim() || null,
      officialZoning: form.officialZoning.trim() || null,
      zoningSource: form.zoningSource.trim() || null,
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#1A2332] text-white flex items-center justify-center">
        <p className="text-gray-400">Carregando...</p>
      </div>
    );
  }

  if (!estudo) {
    return (
      <div className="min-h-screen bg-[#1A2332] text-white flex items-center justify-center">
        <p className="text-gray-400">Estudo não encontrado.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <div className="bg-[#0F1923] border-b border-[#C9A961]/20 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <Link href="/admin/incorporacao">
            <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-[#C9A961] truncate">{estudo.name}</h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-6" onInputCapture={() => setAlterado(true)} onChangeCapture={() => setAlterado(true)}>
        <nav aria-label="Módulos do estudo" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {MODULOS.map(([idModulo, nome]) => (
            <button key={idModulo} type="button" onClick={() => setModuloAtivo(idModulo)}
              aria-current={moduloAtivo === idModulo ? "page" : undefined}
              className={`min-w-0 rounded-md border px-3 py-3 text-left text-sm font-medium break-words ${moduloAtivo === idModulo ? "border-[#C9A961] bg-[#C9A961] text-[#1A2332]" : "border-[#C9A961]/30 bg-[#0F1923] text-gray-200 hover:border-[#C9A961]"}`}>
              {nome}
            </button>
          ))}
        </nav>
        <div hidden={moduloAtivo !== "dados"} className="space-y-6">
        <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-white text-lg">Dados Gerais</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Label className="text-gray-300">Nome do estudo</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Cidade</Label>
                <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">UF</Label>
                <Input value={form.state} maxLength={2}
                  onChange={(e) => setForm((f) => ({ ...f, state: e.target.value.toUpperCase() }))}
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-gray-300">Endereço do terreno</Label>
                <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Responsável</Label>
                <Input value={form.responsible} onChange={(e) => setForm((f) => ({ ...f, responsible: e.target.value }))}
                  className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
              </div>
              <div>
                <Label className="text-gray-300">Situação</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1">
                    <SelectValue placeholder="Classificar situação antiga" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {([
                ["propertyRegistration", "Matrícula do imóvel"],
                ["carRegistration", "Registro CAR (se aplicável)"],
                ["officialZoning", "Zoneamento oficial"],
                ["zoningSource", "Fonte oficial do zoneamento"],
              ] as const).map(([key, label]) => (
                <div key={key}>
                  <Label className="text-gray-300">{label}</Label>
                  <Input value={form[key]} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="bg-[#2C3E50] border-[#C9A961]/30 text-white mt-1" />
                </div>
              ))}
            </div>
            <Button onClick={handleSave} disabled={updateMutation.isPending}
              className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] font-bold">
              {updateMutation.isPending ? "Salvando..." : "Salvar Alterações"}
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 text-white">
          <CardHeader><CardTitle>Histórico de versões</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-gray-300">Cada alteração salva um retrato. O período anterior à ativação deste histórico não pode ser reconstruído.</p>
            {erroVersao && <p role="alert" className="text-red-300">{erroVersao}</p>}
            {versoes.map((versao) => (
              <div key={versao.revision} className="flex items-center justify-between gap-3 border-t border-white/10 py-2">
                <span>Versão {versao.revision} · {new Date(versao.createdAt).toLocaleString("pt-BR")}</span>
                <Button type="button" variant="outline" onClick={() => baixarVersao(versao.revision)}>Baixar snapshot</Button>
              </div>
            ))}
          </CardContent>
        </Card>
        </div>

        <div hidden={moduloAtivo !== "terreno"}>
        <TerrenoTopografia
          estudoId={estudo.id}
          geojson={estudo.geojson}
          areaM2={estudo.areaM2}
          perimeterM={estudo.perimeterM}
          elevationJson={estudo.elevationJson}
        />
        </div>

        <div hidden={moduloAtivo !== "mercado"}>
        <EstudoMercado
          estudoId={estudo.id}
          city={estudo.city}
          state={estudo.state}
          cityResearchJson={estudo.cityResearchJson}
          marketStudyJson={estudo.marketStudyJson}
          comparablePricingJson={estudo.comparablePricingJson}
          primaryResearchJson={estudo.primaryResearchJson}
        />
        </div>

        <div hidden={moduloAtivo !== "massa"}>
        <EstudoMassa
          estudoId={estudo.id}
          geojson={estudo.geojson}
          areaM2={estudo.areaM2}
          latitude={estudo.latitude}
          longitude={estudo.longitude}
          urbanParametersJson={estudo.urbanParametersJson}
          potentialJson={estudo.potentialJson}
          massScenariosJson={estudo.massScenariosJson}
          selectedScenarioId={estudo.selectedScenarioId}
          areasBoardJson={estudo.areasBoardJson}
        />
        </div>

        <div hidden={moduloAtivo !== "orcamento"}>
        <OrcamentoNegociacao
          estudoId={estudo.id}
          parameterizedBudgetJson={estudo.parameterizedBudgetJson}
          landNegotiationJson={estudo.landNegotiationJson}
        />
        </div>

        <div hidden={moduloAtivo !== "business"}>
        <BusinessPlan estudoId={estudo.id} businessPlanJson={estudo.businessPlanJson} />
        </div>

        <div hidden={moduloAtivo !== "projeto"}>
        <ProjetistasAprovacao
          estudoId={estudo.id}
          designersJson={estudo.designersJson}
          projectApprovalJson={estudo.projectApprovalJson}
        />
        </div>

        <div hidden={moduloAtivo !== "registro"}>
        <RegistroOrcamentoPreliminar
          estudoId={estudo.id}
          incorporationRegistrationJson={estudo.incorporationRegistrationJson}
          preliminaryBudgetJson={estudo.preliminaryBudgetJson}
          parameterizedBudgetJson={estudo.parameterizedBudgetJson}
        />
        </div>

        <div hidden={moduloAtivo !== "lancamento"}>
        <LancamentoMarketing
          estudoId={estudo.id}
          launchPlanJson={estudo.launchPlanJson}
          launchSuppliersJson={estudo.launchSuppliersJson}
          marketingMaterialJson={estudo.marketingMaterialJson}
        />
        </div>

        <div hidden={moduloAtivo !== "unidades"}>
        <LancamentoImobiliario
          estudoId={estudo.id}
          productMixJson={estudo.productMixJson}
          realEstateLaunchJson={estudo.realEstateLaunchJson}
        />
        </div>

        <div hidden={moduloAtivo !== "obra"}>
        <ObraExecutiva
          estudoId={estudo.id}
          executiveProjectsJson={estudo.executiveProjectsJson}
          workBudgetJson={estudo.workBudgetJson}
          physicalFinancialScheduleJson={estudo.physicalFinancialScheduleJson}
          preliminaryBudgetJson={estudo.preliminaryBudgetJson}
        />
        </div>

        <div hidden={moduloAtivo !== "relatorio"}>
        <AtendimentoRelatorio
          estudoId={estudo.id}
          customerServiceJson={estudo.customerServiceJson}
          estudo={{ ...estudo, versionNumber: versoes[0]?.revision ?? null, staff: equipe }}
        />
        </div>

        <div hidden={moduloAtivo !== "viabilidade"}>
        <ViabilidadeEconomica
          estudoId={estudo.id}
          areaM2={estudo.areaM2}
          appAreaM2={estudo.appAreaM2}
          productMixJson={estudo.productMixJson}
          lottingJson={estudo.lottingJson}
        />
        </div>
      </div>
    </div>
  );
}
