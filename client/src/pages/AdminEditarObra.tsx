import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { PercentInput } from "@/components/ui/percent-input";
import { formatarNumeroParaEdicao, aplicarDigitacao } from "@/lib/numero-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Building2, DollarSign, FileText, Image, Loader2, Save, Upload, X, Download, BarChart3 } from "lucide-react";
import { Link, useLocation, useParams } from "wouter";
import { getLoginUrl } from "@/const";
import { useEffect, useMemo, useState } from "react";
import { CustosAba, ValoresOperacaoAba, calcularAoVivo, formInicial, type FormFinanceiro } from "@/components/obra/FinanceiroObra";
import { OBRA_STATUS_SELECIONAVEIS, isObraStatusSelecionavel, obraStatusLabel } from "@shared/obra-status";
import { toast } from "sonner";

export default function AdminEditarObra() {
  const { id } = useParams<{ id: string }>();
  const projectId = parseInt(id || "0");
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("info");

  const { data: project, isLoading, refetch } = trpc.construction.getProjectDetails.useQuery(
    { projectId },
    { enabled: isAuthenticated && user?.role === "admin" && !!projectId }
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
  const [totalAreaTexto, setTotalAreaTexto] = useState("");
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
  const resumoQuery = trpc.obraFinanceiro.resumo.useQuery({ projectId }, { enabled: isAuthenticated && user?.role === "admin" && !!projectId });
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

  // Form state - Aba 3: Progresso
  const [progress, setProgress] = useState("0");

  // Form state - Aba 4: Fotos
  const [uploading, setUploading] = useState(false);
  const [photoCaption, setPhotoCaption] = useState("");

  const uploadPhotoMutation = trpc.construction.uploadPhoto.useMutation({
    onSuccess: () => {
      toast.success("Foto enviada com sucesso!");
      setPhotoCaption("");
      refetch();
    },
    onError: (error) => {
      toast.error(`Erro ao enviar foto: ${error.message}`);
    },
  });

  const deletePhotoMutation = trpc.construction.deletePhoto.useMutation({
    onSuccess: () => {
      toast.success("Foto removida com sucesso!");
      refetch();
    },
    onError: (error) => {
      toast.error(`Erro ao remover foto: ${error.message}`);
    },
  });

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Por favor, selecione uma imagem válida");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("A imagem deve ter no máximo 5MB");
      return;
    }

    setUploading(true);

    try {
      // Converter para base64 para enviar ao backend
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        
        // Enviar para backend que fará upload no S3
        const response = await fetch("/api/upload-photo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            image: base64,
            filename: file.name,
            projectId 
          }),
        });

        if (!response.ok) throw new Error("Erro ao fazer upload");

        const { url } = await response.json();

        // Salvar no banco
        await uploadPhotoMutation.mutateAsync({
          projectId,
          imageUrl: url,
          caption: photoCaption || undefined,
          takenAt: new Date(),
        });

        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Erro ao fazer upload:", error);
      toast.error("Erro ao fazer upload da foto");
      setUploading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      window.location.href = getLoginUrl();
    }
  }, [authLoading, isAuthenticated]);

  useEffect(() => {
    if (!authLoading && isAuthenticated && user?.role !== "admin") {
      setLocation("/");
    }
  }, [authLoading, isAuthenticated, user, setLocation]);

  useEffect(() => {
    if (project) {
      setTitle(project.title || "");
      setAddress(project.address || "");
      setTotalArea(project.totalArea?.toString() || "");
      setTotalAreaTexto(project.totalArea ? formatarNumeroParaEdicao(Number(project.totalArea), { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : "");
      setStatus(project.status);
      setStartDate(project.startDate ? new Date(project.startDate).toISOString().split("T")[0] : "");
      setEstimatedEndDate(project.estimatedEndDate ? new Date(project.estimatedEndDate).toISOString().split("T")[0] : "");
      setActualEndDate(project.actualEndDate ? new Date(project.actualEndDate).toISOString().split("T")[0] : "");
      const historicalNotes = project.notes || "";
      const legacyMatch = historicalNotes.match(/\n__MCMV_META__:[\s\S]+$/);
      setLegacyMcmvSuffix(legacyMatch?.[0] ?? "");
      setNotes(historicalNotes.replace(/\n__MCMV_META__:[\s\S]+$/, ""));
      setProgress(project.progress?.toString() || "0");

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
      progress: parseInt(progress),
    };
    setSalvando(true);
    try {
      await updateMutation.mutateAsync(updates);
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
        <Loader2 className="h-8 w-8 animate-spin text-[#C9A961]" />
      </div>
    );
  }

  if (user?.role !== "admin") {
    return null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
        <Loader2 className="h-8 w-8 animate-spin text-[#C9A961]" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
        <Card className="bg-[#1A2332]/60 border-[#C9A961]/20">
          <CardContent className="pt-6">
            <p className="text-gray-300">Obra não encontrada.</p>
            <Link href="/admin/obras">
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
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      {/* Header */}
      <div className="border-b border-[#C9A961]/20 bg-[#1A2332]/80 backdrop-blur-sm">
        <div className="container py-8">
          <div className="flex items-center gap-4 mb-4">
            <Link href="/admin/obras">
              <Button variant="ghost" size="sm" className="text-[#C9A961] hover:text-[#FFD700]">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Voltar
              </Button>
            </Link>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-[#C9A961] mb-2">Editar Obra</h1>
              <p className="text-gray-400">{project.title}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-6 bg-[#1A2332]/60 border border-[#C9A961]/20 h-auto min-h-10">
            <TabsTrigger value="info" className="text-gray-200 hover:text-white focus-visible:ring-[#C9A961] data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332]">
              <Building2 className="h-4 w-4 mr-1" />
              <span className="hidden md:inline">Informações</span>
            </TabsTrigger>
            <TabsTrigger value="mcmv" className="text-gray-200 hover:text-white focus-visible:ring-[#C9A961] data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332]">
              <DollarSign className="h-4 w-4 mr-1" />
              <span className="hidden md:inline">Valores da Operação</span>
            </TabsTrigger>
            <TabsTrigger value="valores" className="text-gray-200 hover:text-white focus-visible:ring-[#C9A961] data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332]">
              <DollarSign className="h-4 w-4 mr-1" />
              <span className="hidden md:inline">Custos</span>
            </TabsTrigger>
            <TabsTrigger value="progresso" className="text-gray-200 hover:text-white focus-visible:ring-[#C9A961] data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332]">
              <FileText className="h-4 w-4 mr-1" />
              <span className="hidden md:inline">Progresso</span>
            </TabsTrigger>
            <TabsTrigger value="fotos" className="text-gray-200 hover:text-white focus-visible:ring-[#C9A961] data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332]">
              <Image className="h-4 w-4 mr-1" />
              <span className="hidden md:inline">Fotos</span>
            </TabsTrigger>
            <TabsTrigger value="relatorios" className="text-gray-200 hover:text-white focus-visible:ring-[#C9A961] data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332]">
              <FileText className="h-4 w-4 mr-1" />
              <span className="hidden md:inline">Relatórios</span>
            </TabsTrigger>
          </TabsList>

          {/* ABA 1: INFORMAÇÕES BÁSICAS */}
          <TabsContent value="info" className="mt-6">
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="totalArea" className="text-gray-300">Área Total (m²)</Label>
                    <Input
                      id="totalArea"
                      type="text"
                      inputMode="decimal"
                      value={totalAreaTexto}
                      onChange={(e) => {
                        const { texto, numero } = aplicarDigitacao(e.target.value);
                        setTotalAreaTexto(texto);
                        setTotalArea(numero ? String(numero) : "");
                      }}
                      onBlur={() => setTotalAreaTexto(totalArea ? formatarNumeroParaEdicao(Number(totalArea), { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : "")}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                      placeholder="Ex: 47"
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
                        {!isObraStatusSelecionavel(project.status) && (
                          <SelectItem value={project.status} disabled>
                            {obraStatusLabel(project.status)} (classificação antiga — mantida até ser trocada)
                          </SelectItem>
                        )}
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
          </TabsContent>

          {/* ABA VALORES DA OPERAÇÃO */}
          <TabsContent value="mcmv" className="mt-6 space-y-6">
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
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
          </TabsContent>

          {/* ABA CUSTOS */}
          <TabsContent value="valores" className="mt-6">
            {resumo && formFin && calculo ? (
              <CustosAba projectId={projectId} resumo={resumo} form={formFin} setForm={setFormFin} calculo={calculo} corretor={project.crm.brokerName} onMudou={() => resumoQuery.refetch()} />
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-[#C9A961]" />
            )}
          </TabsContent>

          <TabsContent value="progresso" className="mt-6">
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-[#C9A961]">Medições e Progresso</CardTitle>
                <CardDescription className="text-gray-400">
                  Acompanhamento do andamento da obra
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <Link href={`/admin/obras/${projectId}/medicoes`}>
                  <Button variant="outline" className="border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10 gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Ver Medições
                  </Button>
                </Link>
                <div className="space-y-2">
                  <Label htmlFor="progress" className="text-gray-300">Progresso Geral (%)</Label>
                  <div className="flex items-center gap-4">
                    <Input
                      id="progress"
                      type="number"
                      min="0"
                      max="100"
                      value={progress}
                      onChange={(e) => setProgress(e.target.value)}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white max-w-[120px]"
                    />
                    <div className="flex-1">
                      <div className="w-full bg-gray-700 rounded-full h-4">
                        <div
                          className="bg-gradient-to-r from-[#C9A961] to-[#FFD700] h-4 rounded-full transition-all flex items-center justify-center text-xs font-semibold text-[#1A2332]"
                          style={{ width: `${progress}%` }}
                        >
                          {progress}%
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-[#C9A961]/20 pt-6">
                  <h3 className="text-lg font-semibold text-[#C9A961] mb-4">Etapas da Obra</h3>
                  <p className="text-gray-300 text-sm mb-4">
                    As etapas individuais podem ser gerenciadas na seção de detalhes da obra.
                  </p>
                  {project.stages && project.stages.length > 0 ? (
                    <div className="space-y-3">
                      {project.stages.map((stage) => (
                        <div key={stage.id} className="flex items-center justify-between p-3 bg-[#2C3E50] rounded-lg border border-[#C9A961]/20">
                          <div>
                            <p className="font-medium text-white">{stage.name}</p>
                            <p className="text-sm text-gray-300">{stage.description || "Sem descrição"}</p>
                          </div>
                          <span className={`px-3 py-1 rounded-full text-sm ${
                            stage.status === "completed" ? "bg-green-500/20 text-green-300" :
                            stage.status === "in_progress" ? "bg-yellow-500/20 text-yellow-300" :
                            "bg-gray-500/20 text-gray-300"
                          }`}>
                            {stage.status === "completed" ? "Concluída" :
                             stage.status === "in_progress" ? "Em Andamento" :
                             "Pendente"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-300 text-center py-8">Nenhuma etapa cadastrada ainda.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ABA 4: FOTOS */}
          <TabsContent value="fotos" className="mt-6">
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-[#C9A961]">Galeria de Fotos</CardTitle>
                <CardDescription className="text-gray-400">
                  Fotos do progresso da obra
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Upload de Foto */}
                <div className="border-2 border-dashed border-[#C9A961]/30 rounded-lg p-6 bg-[#1A2332]/40">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="photo-caption" className="text-gray-300">Legenda (opcional)</Label>
                      <Input
                        id="photo-caption"
                        placeholder="Ex: Fundação concluída"
                        value={photoCaption}
                        onChange={(e) => setPhotoCaption(e.target.value)}
                        className="bg-[#1A2332]/60 border-[#C9A961]/20 text-white"
                      />
                    </div>
                    <div className="flex items-center justify-center">
                      <label htmlFor="photo-upload" className="cursor-pointer">
                        <div className="flex flex-col items-center gap-2 px-6 py-4 bg-[#C9A961]/10 hover:bg-[#C9A961]/20 rounded-lg border border-[#C9A961]/30 transition-colors">
                          {uploading ? (
                            <>
                              <Loader2 className="h-8 w-8 text-[#C9A961] animate-spin" />
                              <span className="text-sm text-gray-300">Enviando...</span>
                            </>
                          ) : (
                            <>
                              <Upload className="h-8 w-8 text-[#C9A961]" />
                              <span className="text-sm text-gray-300">Clique para selecionar foto</span>
                              <span className="text-xs text-gray-500">PNG, JPG até 5MB</span>
                            </>
                          )}
                        </div>
                        <input
                          id="photo-upload"
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handlePhotoUpload}
                          disabled={uploading}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                {/* Galeria de Fotos */}
                {project?.photos && project.photos.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {project.photos.map((photo) => (
                      <div key={photo.id} className="relative group aspect-square rounded-lg overflow-hidden border border-[#C9A961]/20 bg-[#1A2332]/40">
                        <img
                          src={photo.imageUrl}
                          alt={photo.caption || "Foto da obra"}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                          {photo.caption && (
                            <p className="text-white text-xs text-center line-clamp-2">{photo.caption}</p>
                          )}
                          <p className="text-gray-400 text-xs">
                            {new Date(photo.takenAt).toLocaleDateString("pt-BR")}
                          </p>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => deletePhotoMutation.mutate({ photoId: photo.id })}
                            disabled={deletePhotoMutation.isPending}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-center py-8">
                    Nenhuma foto enviada ainda. Faça o upload da primeira foto acima.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ABA 5: RELATÓRIOS */}
          <TabsContent value="relatorios" className="mt-6">
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-[#C9A961]">Relatórios</CardTitle>
                <CardDescription className="text-gray-400">
                  Gerar relatórios da obra em diferentes formatos
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Relatório PDF */}
                  <Card className="bg-[#1A2332]/40 border-[#C9A961]/20">
                    <CardHeader>
                      <CardTitle className="text-[#C9A961] text-lg">Relatório PDF</CardTitle>
                      <CardDescription className="text-gray-400">
                        Relatório completo com todas as informações da obra
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button
                        onClick={() => {
                          if (!project) return;
                          import("jspdf").then(({ default: jsPDF }) => {
                            const doc = new jsPDF();
                            
                            // Título
                            doc.setFontSize(20);
                            doc.text("Relatório da Obra", 105, 20, { align: "center" });
                            
                            // Informações Básicas
                            doc.setFontSize(12);
                            doc.text(`Título: ${project.title}`, 20, 40);
                            doc.text(`Endereço: ${project.address || "N/A"}`, 20, 50);
                            doc.text(`Tipo: ${project.crm.projectType || "N/A"}`, 20, 60);
                            doc.text(`Área Total: ${project.totalArea || "N/A"} m²`, 20, 70);
                            doc.text(`Status: ${project.status}`, 20, 80);
                            doc.text(`Progresso: ${project.progress}%`, 20, 90);
                            
                            // Valores (relatório completo é reconstruído no Lote 4)
                            const fmt = (i?: { ok: boolean; centavos?: number; motivo?: string }) =>
                              i?.ok ? (i.centavos! / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "não disponível";
                            doc.text("Valores Financeiros:", 20, 110);
                            doc.text(`Orçamento Previsto: ${fmt(calculo?.custoConstrucao)}`, 20, 120);
                            doc.text(`Total Gasto na Obra: ${fmt(calculo?.totalGasto)}`, 20, 130);
                            doc.text(`Saldo Restante: ${fmt(calculo?.saldoRestante)}`, 20, 140);
                            doc.text(`Lucro Estimado: ${fmt(calculo?.lucroEstimado)}`, 20, 150);
                            
                            // Salvar
                            doc.save(`relatorio-${project.title.replace(/\s+/g, "-")}.pdf`);
                            toast.success("Relatório PDF gerado com sucesso!");
                          });
                        }}
                        className="w-full bg-[#C9A961] hover:bg-[#B8935A] text-[#1A2332]"
                        disabled={!project}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Baixar PDF
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Relatório Excel */}
                  <Card className="bg-[#1A2332]/40 border-[#C9A961]/20">
                    <CardHeader>
                      <CardTitle className="text-[#C9A961] text-lg">Planilha Excel</CardTitle>
                      <CardDescription className="text-gray-400">
                        Planilha detalhada com todos os custos e medições
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button
                        onClick={() => {
                          if (!project) return;
                          import("xlsx").then((XLSX) => {
                            // Criar dados da planilha
                            const data = [
                              ["RELATÓRIO DA OBRA"],
                              [""],
                              ["Informações Básicas"],
                              ["Título", project.title],
                              ["Endereço", project.address || "N/A"],
                              ["Tipo", project.crm.projectType || "N/A"],
                              ["Área Total (m²)", project.totalArea || "N/A"],
                              ["Status", project.status],
                              ["Progresso (%)", project.progress],
                              [""],
                              ["Valores Financeiros (R$)"],
                              ...([
                                ["VGV", calculo ? formFin?.vgv : null],
                                ["Orçamento Previsto", formFin?.orcamentoPrevisto],
                                ["Custo do Terreno", formFin?.custoTerreno],
                                ["Comissão", formFin?.comissao],
                              ] as [string, string | null | undefined][]).map(([k, v]) => [k, v == null ? "não informado" : Number(v)]),
                              ...([
                                ["Entrada Total", calculo?.entradaTotal],
                                ["Entrada Paga", calculo?.entradaPaga],
                                ["Recebido CEF", calculo?.recebidoCef],
                                ["Total Gasto na Obra", calculo?.totalGasto],
                                ["Saldo Restante", calculo?.saldoRestante],
                                ["Lucro Estimado", calculo?.lucroEstimado],
                              ] as const).map(([k, i]) => [k, i?.ok ? i.centavos / 100 : "não disponível"]),
                            ];
                            
                            const ws = XLSX.utils.aoa_to_sheet(data);
                            const wb = XLSX.utils.book_new();
                            XLSX.utils.book_append_sheet(wb, ws, "Relatório");
                            XLSX.writeFile(wb, `relatorio-${project.title.replace(/\s+/g, "-")}.xlsx`);
                            toast.success("Planilha Excel gerada com sucesso!");
                          });
                        }}
                        className="w-full bg-[#C9A961] hover:bg-[#B8935A] text-[#1A2332]"
                        disabled={!project}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Baixar Excel
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                {/* Informações sobre os relatórios */}
                <div className="bg-[#1A2332]/40 border border-[#C9A961]/20 rounded-lg p-4">
                  <h4 className="text-[#C9A961] font-semibold mb-2">Sobre os Relatórios</h4>
                  <ul className="text-gray-400 text-sm space-y-1">
                    <li>• <strong>PDF:</strong> Relatório visual completo, ideal para apresentações e impressão</li>
                    <li>• <strong>Excel:</strong> Planilha editável com todos os dados, ideal para análises financeiras</li>
                    <li>• Os relatórios incluem informações básicas, valores financeiros e progresso da obra</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="mt-6 flex justify-end">
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
        </div>
      </div>
    </div>
  );
}
