import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { PercentInput } from "@/components/ui/percent-input";
import { formatarNumeroParaEdicao, aplicarDigitacao } from "@/lib/numero-input";
import { NumeroInput } from "@/components/ui/numero-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Building2, DollarSign, FileText, Image, Loader2, Save, BarChart3 } from "lucide-react";
import { Link, useLocation, useParams } from "wouter";
import { getLoginUrl } from "@/const";
import { useEffect, useMemo, useState } from "react";
import { ProgressoObraAba } from "@/components/obra/ProgressoObraAba";
import { FotosObraAba } from "@/components/obra/FotosObraAba";
import { PciObra } from "@/components/obra/MedicaoCaixa";
import { RelatorioObraBotao } from "@/components/obra/RelatorioObraBotao";
import { CustosAba, ValoresOperacaoAba, calcularAoVivo, formInicial, type FormFinanceiro } from "@/components/obra/FinanceiroObra";
import { OBRA_STATUS_SELECIONAVEIS, obraStatusLabel } from "@shared/obra-status";
import { toast } from "sonner";
import { CampoLocalizacao } from "@/components/CampoLocalizacao";

const ABAS_OBRA = [
  { valor: "info", rotulo: "Informações", Icone: Building2 },
  { valor: "mcmv", rotulo: "Valores da Operação", Icone: DollarSign },
  { valor: "valores", rotulo: "Custos", Icone: DollarSign },
  { valor: "progresso", rotulo: "Progresso", Icone: FileText },
  { valor: "fotos", rotulo: "Fotos", Icone: Image },
  { valor: "relatorios", rotulo: "Relatórios", Icone: FileText },
] as const;

/**
 * Pedido de 15/10: o empreiteiro usa este mesmo painel nas obras vinculadas a ele.
 * Informações, Valores da Operação e Custos previstos ficam só leitura; Pagamentos,
 * Progresso, Fotos e Relatórios funcionam como no admin. O servidor confere o vínculo
 * (server/obra-acesso.ts).
 */
export default function AdminEditarObra({ modo = "admin" }: { modo?: "admin" | "empreiteiro" }) {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id || "0");
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const ehEmpreiteiro = modo === "empreiteiro";
  // O colaborador com o módulo Obras usa o painel como o admin (pedido de 17/10/2026).
  const papelOk = ehEmpreiteiro ? user?.role === "empreiteiro" : user?.role === "admin" || user?.role === "colaborador";
  const voltarPara = ehEmpreiteiro ? "/empreiteiro" : "/admin/obras";
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("info");
  const [versaoProgresso, setVersaoProgresso] = useState(0);

  const { data: project, isLoading, refetch } = trpc.construction.getProjectDetails.useQuery(
    { projectId },
    { enabled: isAuthenticated && papelOk && !!projectId }
  );

  const updateMutation = trpc.construction.updateProject.useMutation({
    onSuccess: () => refetch(),
  });

  // Form state - Aba 1: Informações Básicas
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  const [totalArea, setTotalArea] = useState("");
  // Buffers de texto dos campos "medida"/contagem — mesmo motivo do
  // `EstudoMassa.tsx` (Lote 5): sem eles, o <Input> ficaria vinculado
  // diretamente ao número já parseado e cada tecla apagaria a vírgula
  // decimal digitada. Campos de dinheiro/percentual usam
  // `CurrencyInput`/`PercentInput`, que já cuidam do próprio buffer.
  const [status, setStatus] = useState<string>("planning");
  const [startDate, setStartDate] = useState("");
  const [estimatedEndDate, setEstimatedEndDate] = useState("");
  const [actualEndDate, setActualEndDate] = useState("");
  const [notes, setNotes] = useState("");

  // Valores que a tela antiga gravava como JSON em `notes`: preservados como
  // estão (só o Escritório CF continua editável); os financeiros migraram
  // para colunas e movimentos (Lote 2).
  const [meta, setMeta] = useState<Record<string, string> | null>(null);
  const [legacyMcmvSuffix, setLegacyMcmvSuffix] = useState("");
  const [cefBranch, setCefBranch] = useState("");

  // Valores da Operação e Custos (Lote 2)
  // Lote 23/10, etapa 3: "Localização exata" guardada no imóvel vinculado (Mapa Operacional).
  const localizacaoQuery = trpc.obraLocalizacao.obter.useQuery({ projectId }, { enabled: isAuthenticated && papelOk && !!projectId });
  const salvarLocalizacao = trpc.obraLocalizacao.salvar.useMutation();
  const [localizacaoResolvendo, setLocalizacaoResolvendo] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  // A PCI vinculada preenche o formulário sem gravar em massa; o usuário
  // confirma o ponto ao salvar a obra. Um ponto já salvo sempre prevalece.
  useEffect(() => { setCoords(localizacaoQuery.data?.coords ?? localizacaoQuery.data?.pontoPci ?? null); }, [localizacaoQuery.data]);
  const coordsAlteradas = JSON.stringify(coords) !== JSON.stringify(localizacaoQuery.data?.coords ?? null);
  const resumoQuery = trpc.obraFinanceiro.resumo.useQuery({ projectId }, { enabled: isAuthenticated && papelOk && !!projectId });
  const resumo = resumoQuery.data;
  const [formFin, setFormFin] = useState<FormFinanceiro | null>(null);
  useEffect(() => {
    if (resumo && !formFin) setFormFin(formInicial(resumo));
  }, [resumo, formFin]);
  const calculo = useMemo(
    () => (resumo && formFin ? calcularAoVivo(formFin, resumo, { inicio: startDate, termino: estimatedEndDate }) : null),
    [resumo, formFin, startDate, estimatedEndDate]
  );
  const salvarValores = trpc.obraFinanceiro.salvarValores.useMutation();
  const definirInvestidores = trpc.obraFinanceiro.definirInvestidores.useMutation();
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      window.location.href = getLoginUrl();
    }
  }, [authLoading, isAuthenticated]);

  useEffect(() => {
    if (!authLoading && isAuthenticated && !papelOk) {
      setLocation("/");
    }
  }, [authLoading, isAuthenticated, user, setLocation, papelOk]);

  useEffect(() => {
    if (project) {
      setTitle(project.title || "");
      setAddress(project.address || "");
      setTotalArea(project.totalArea?.toString() || "");
      setStatus(project.status);
      setStartDate(project.startDate ? new Date(project.startDate).toISOString().split("T")[0] : "");
      setEstimatedEndDate(project.estimatedEndDate ? new Date(project.estimatedEndDate).toISOString().split("T")[0] : "");
      setActualEndDate(project.actualEndDate ? new Date(project.actualEndDate).toISOString().split("T")[0] : "");
      const historicalNotes = project.notes || "";
      const legacyMatch = historicalNotes.match(/\n__MCMV_META__:[\s\S]+$/);
      setLegacyMcmvSuffix(legacyMatch?.[0] ?? "");
      setNotes(historicalNotes.replace(/\n__MCMV_META__:[\s\S]+$/, ""));

      const metaMatch = (project.notes || "").match(/\n__MCMV_META__:([\s\S]+)$/);
      let metaLida: Record<string, string> | null = null;
      if (metaMatch) {
        try { metaLida = JSON.parse(metaMatch[1]); } catch { metaLida = null; }
      }
      setMeta(metaLida);
      setCefBranch(project.cefBranch ?? metaLida?.cefBranch ?? "");
    }
  }, [project]);

  const handleSave = async () => {
    if (localizacaoResolvendo) {
      toast.error("Aguarde: a localização ainda está sendo lida do link do mapa.");
      return;
    }
    const updates = {
      projectId,
      title,
      address,
      totalArea: totalArea ? parseInt(totalArea) : undefined,
      status: status as never,
      startDate: startDate ? new Date(startDate) : undefined,
      estimatedEndDate: estimatedEndDate ? new Date(estimatedEndDate) : undefined,
      actualEndDate: actualEndDate ? new Date(actualEndDate) : undefined,
      notes: notes + legacyMcmvSuffix,
      cefBranch: cefBranch.trim() || null,
    };
    setSalvando(true);
    try {
      await updateMutation.mutateAsync(updates);
      if (!ehEmpreiteiro && localizacaoQuery.data && coordsAlteradas) {
        const r = await salvarLocalizacao.mutateAsync({ projectId, coords });
        if (r.criado) toast.success("Localização salva: imóvel da obra criado (não publicado) e exibido no Mapa Operacional.");
        await localizacaoQuery.refetch();
      }
      if (formFin) {
        await salvarValores.mutateAsync({
          projectId,
          vgv: formFin.vgv,
          financiamento: formFin.financiamento,
          fgts: formFin.fgts,
          subsidio: formFin.subsidio,
          custoTerreno: formFin.custoTerreno,
          comissao: formFin.comissao,
          comissaoPercentual: formFin.comissaoPercentual,
          orcamentoPrevisto: formFin.orcamentoPrevisto,
          taxaMensalPct: formFin.taxaMensalPct,
          parcelas: formFin.parcelas,
          empreiteiroId: formFin.empreiteiroId,
          percentualEmpreiteiro: formFin.percentualEmpreiteiro,
          incluirProSolutoBaseEmpreiteiro: formFin.incluirProSolutoBaseEmpreiteiro,
        });
        await definirInvestidores.mutateAsync({
          projectId,
          participacoes: formFin.investidores.map((i) => ({ investidorId: i.investidorId, percentual: i.percentual })),
        });
      }
      await resumoQuery.refetch();
      toast.success("Obra salva.");
    } catch (error) {
      toast.error(`Erro ao salvar: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSalvando(false);
    }
  };

  if (authLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332] text-gray-100">
        <Loader2 className="h-8 w-8 animate-spin text-[#C9A961]" />
      </div>
    );
  }

  if (!papelOk) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332] text-gray-100">
        <Loader2 className="h-8 w-8 animate-spin text-[#C9A961]" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332] text-gray-100">
        <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 text-gray-100">
          <CardContent className="pt-6">
            <p className="text-gray-300">Obra não encontrada.</p>
            <Link href={voltarPara}>
              <Button className="mt-4 bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332]">
                Voltar para Lista
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332] text-gray-100">
      {/* Header */}
      <div className="border-b border-[#C9A961]/20 bg-[#1A2332]/80 backdrop-blur-sm">
        <div className="container py-8">
          <div className="flex items-center gap-4 mb-4">
            <Link href={voltarPara}>
              <Button variant="ghost" size="sm" className="text-[#C9A961] hover:text-[#FFD700]">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Voltar
              </Button>
            </Link>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-[#C9A961] mb-2">Editar Obra</h1>
              {ehEmpreiteiro && <p className="text-xs text-gray-400 mb-1">Informações, Valores da Operação e Custos previstos são definidos pela empresa (somente leitura).</p>}
              <p className="text-gray-400">{project.title}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* Abas em grade responsiva (2 → 3 → 6 colunas); o rótulo quebra dentro da
              própria aba em vez de invadir a vizinha (pedido A2, 13/10/2026). */}
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 border border-[#C9A961]/20 bg-[#1A2332]/60 p-1 sm:grid-cols-3 xl:grid-cols-6 text-gray-100">
            {ABAS_OBRA.map(({ valor, rotulo, Icone }) => (
              <TabsTrigger
                key={valor}
                value={valor}
                className="h-auto min-h-10 min-w-0 whitespace-normal px-2 py-2 text-center leading-tight text-gray-200 hover:text-white focus-visible:ring-[#C9A961] data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332]"
              >
                <Icone className="h-4 w-4" aria-hidden />
                <span className="min-w-0 break-words">{rotulo}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ABA 1: INFORMAÇÕES BÁSICAS */}
          <TabsContent value="info" className="mt-6">
            <fieldset disabled={ehEmpreiteiro} className="contents">
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm text-gray-100">
              <CardHeader>
                <CardTitle className="text-[#C9A961]">Informações Básicas</CardTitle>
                <CardDescription className="text-gray-400">
                  Dados gerais da obra
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="title" className="text-gray-300">Título da Obra *</Label>
                    <Input
                      id="title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                      placeholder="Ex: Casa do Sr. João"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="projectType" className="text-gray-300">Tipo de Projeto</Label>
                    <Input
                      id="projectType"
                      value={project.crm.projectType ?? "—"}
                      readOnly
                      aria-readonly="true"
                      className="bg-[#2C3E50]/50 border-[#C9A961]/20 text-gray-300 cursor-not-allowed"
                    />
                    <p className="text-xs text-gray-400">
                      {project.crm.projectTypeOrigem === "crm"
                        ? "Definido pelo serviço vinculado no CRM. Para alterar, edite o lead."
                        : "Obra sem serviço do CRM vinculado: valor antigo preservado. Vincule pelo CRM para regularizar."}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address" className="text-gray-300">Endereço Completo</Label>
                  <Textarea
                    id="address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                    placeholder="Rua, número, bairro, cidade, estado"
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-gray-300">Localização exata</Label>
                  {localizacaoQuery.isError ? (
                    <p className="text-xs text-red-300" role="alert">Não foi possível carregar a localização da obra.</p>
                  ) : (
                    <CampoLocalizacao coords={coords} onChange={setCoords} onResolvendo={setLocalizacaoResolvendo} />
                  )}
                  <p className="text-xs text-gray-400">
                    {localizacaoQuery.data?.imovelId && localizacaoQuery.data.coords
                      ? `Ponto guardado no imóvel vinculado "${localizacaoQuery.data.imovelTitulo}" (aparece no Mapa Operacional).`
                      : localizacaoQuery.data?.pontoPci
                        ? `Ponto preenchido da PCI da CAIXA: ${localizacaoQuery.data.pontoPci.lat.toFixed(6)}, ${localizacaoQuery.data.pontoPci.lng.toFixed(6)}. Confira e salve para vincular ao cadastro da obra.`
                        : localizacaoQuery.data?.imovelId
                          ? `O imóvel vinculado "${localizacaoQuery.data.imovelTitulo}" ainda não tem ponto. Cole a localização acima e salve para aparecer no Mapa Operacional.`
                          : "Ao salvar, o ponto cria um imóvel vinculado à obra, não publicado no site, e aparece no Mapa Operacional."}
                    {coordsAlteradas && " Alteração ainda não salva."}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="totalArea" className="text-gray-300">Área Total (m²)</Label>
                    <NumeroInput
                      id="totalArea"
                      sufixo="m²"
                      negativo={false}
                      value={totalArea ? Number(totalArea) : null}
                      onChange={(numero) => setTotalArea(numero ? String(numero) : "")}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                      placeholder="Ex: 47,00"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="status" className="text-gray-300">Status da Obra *</Label>
                    <Select value={status} onValueChange={(value: any) => setStatus(value)}>
                      <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OBRA_STATUS_SELECIONAVEIS.map((valor) => (
                          <SelectItem key={valor} value={valor}>{obraStatusLabel(valor)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="startDate" className="text-gray-300">Data de Início</Label>
                    <Input
                      id="startDate"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="estimatedEndDate" className="text-gray-300">Previsão de Término</Label>
                    <Input
                      id="estimatedEndDate"
                      type="date"
                      value={estimatedEndDate}
                      onChange={(e) => setEstimatedEndDate(e.target.value)}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="actualEndDate" className="text-gray-300">Data Real de Término</Label>
                    <Input
                      id="actualEndDate"
                      type="date"
                      value={actualEndDate}
                      onChange={(e) => setActualEndDate(e.target.value)}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes" className="text-gray-300">Observações</Label>
                  <Textarea
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                    placeholder="Anotações gerais sobre a obra"
                    rows={4}
                  />
                </div>
              </CardContent>
            </Card>
            </fieldset>
          </TabsContent>

          {/* ABA VALORES DA OPERAÇÃO */}
          <TabsContent value="mcmv" className="mt-6 space-y-6">
            <fieldset disabled={ehEmpreiteiro} className="contents">
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm text-gray-100">
              <CardHeader>
                <CardTitle className="text-[#C9A961]">Valores da Operação</CardTitle>
                <CardDescription className="text-gray-400">
                  Valores financeiros da operação (MCMV / Caixa Econômica Federal). Campos "automático" são calculados e não podem ser editados.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label className="text-gray-300">Nome do Cliente</Label>
                  <Input value={project.crm.clientName ?? project.mcmvClientName ?? meta?.clientName ?? ""} readOnly aria-readonly="true" className="bg-[#2C3E50]/50 border-[#C9A961]/20 text-gray-300 cursor-not-allowed" />
                  <p className="text-xs text-gray-400">
                    {project.crm.vinculada
                      ? "Vem do lead vinculado no CRM. Para alterar, edite o lead."
                      : "Obra sem lead vinculado: nome antigo preservado. Vincule pelo CRM para regularizar."}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-300">Escritório CF (Agência CEF)</Label>
                  <Input value={cefBranch} onChange={(e) => setCefBranch(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Agência CEF" />
                </div>
                {project.crm.brokerName && (
                  <div className="space-y-2">
                    <Label className="text-gray-300">Nome do Corretor</Label>
                    <Input value={project.crm.brokerName} readOnly aria-readonly="true" className="bg-[#2C3E50]/50 border-[#C9A961]/20 text-gray-300 cursor-not-allowed" />
                    <p className="text-xs text-gray-400">Corretor vinculado ao lead no CRM.</p>
                  </div>
                )}
              </CardContent>
            </Card>
            {resumo && formFin && calculo ? (
              <ValoresOperacaoAba projectId={projectId} resumo={resumo} form={formFin} setForm={setFormFin} calculo={calculo} nomeEmpresa="Prospecta" onMudou={() => resumoQuery.refetch()} />
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-[#C9A961]" />
            )}
            </fieldset>
          </TabsContent>

          {/* ABA CUSTOS */}
          <TabsContent value="valores" className="mt-6">
            {resumo && formFin && calculo ? (
              <CustosAba projectId={projectId} resumo={resumo} form={formFin} setForm={setFormFin} calculo={calculo} corretor={project.crm.brokerName} onMudou={() => resumoQuery.refetch()} modoEmpreiteiro={ehEmpreiteiro} />
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-[#C9A961]" />
            )}
          </TabsContent>

          <TabsContent value="progresso" className="mt-6 space-y-4">
            {/* Pedido de 18/10: PCI da CAIXA ao lado de "Ver Medições da CEF". */}
            <div className="flex flex-wrap items-center gap-2">
              {!ehEmpreiteiro && (
                <Link href={`/admin/obras/${projectId}/medicoes`}>
                  <Button variant="outline" className="border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10 gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Ver Medições da CEF
                  </Button>
                </Link>
              )}
              <PciObra projectId={projectId} onVinculoAlterado={() => setVersaoProgresso(v => v + 1)} />
            </div>
            <ProgressoObraAba key={versaoProgresso} projectId={projectId} onFotosMudaram={() => refetch()} />
          </TabsContent>

          {/* ABA 4: FOTOS */}
          <TabsContent value="fotos" className="mt-6">
            <FotosObraAba projectId={projectId} />
          </TabsContent>

          {/* ABA 5: RELATÓRIOS */}
          <TabsContent value="relatorios" className="mt-6">
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm text-gray-100">
              <CardHeader>
                <CardTitle className="text-[#C9A961]">Relatórios</CardTitle>
                <CardDescription className="text-gray-400">
                  Gerar relatórios da obra em diferentes formatos
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <Card className="bg-[#1A2332]/40 border-[#C9A961]/20 text-gray-100">
                    <CardHeader>
                      <CardTitle className="text-[#C9A961] text-lg">Relatório executivo · PDF e Excel</CardTitle>
                      <CardDescription className="text-gray-400">
                        Os dois formatos usam as mesmas informações, valores, custos, progresso e referências das fotos.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <RelatorioObraBotao projectId={projectId} />
                    </CardContent>
                  </Card>

                </div>

                {/* Informações sobre os relatórios */}
                <div className="bg-[#1A2332]/40 border border-[#C9A961]/20 rounded-lg p-4">
                  <h4 className="text-[#C9A961] font-semibold mb-2">Sobre os Relatórios</h4>
                  <ul className="text-gray-400 text-sm space-y-1">
                    <li>• <strong>PDF:</strong> Relatório visual completo, ideal para apresentações e impressão</li>
                    <li>• <strong>Excel:</strong> Planilha editável com todos os dados, ideal para análises financeiras</li>
                    <li>• Ambos usam somente dados reais da obra; campos sem informação aparecem como "Não informado"</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Salvar grava Informações e Valores: o empreiteiro não altera esses dados. */}
        {!ehEmpreiteiro && <div className="mt-6 flex justify-end">
          <Button
            onClick={handleSave}
            disabled={salvando}
            className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] gap-2"
          >
            {salvando ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="h-5 w-5" />
                Salvar
              </>
            )}
          </Button>
        </div>}
      </div>
    </div>
  );
}
