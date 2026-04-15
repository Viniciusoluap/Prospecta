import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, Building2, DollarSign, FileText, Image, Loader2, Save, Upload, X, Download, BarChart3 } from "lucide-react";
import { Link, useLocation, useParams } from "wouter";
import { getLoginUrl } from "@/const";
import { useEffect, useState } from "react";
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
    onSuccess: () => {
      toast.success("Obra atualizada com sucesso!");
      refetch();
    },
    onError: (error) => {
      toast.error(`Erro ao atualizar obra: ${error.message}`);
    },
  });

  // Form state - Aba 1: Informações Básicas
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  const [projectType, setProjectType] = useState("");
  const [totalArea, setTotalArea] = useState("");
  const [status, setStatus] = useState<string>("planning");
  const [startDate, setStartDate] = useState("");
  const [estimatedEndDate, setEstimatedEndDate] = useState("");
  const [actualEndDate, setActualEndDate] = useState("");
  const [notes, setNotes] = useState("");

  // Form state - Aba 2: Valores e Custos
  const [contractValue, setContractValue] = useState("");
  const [contractType, setContractType] = useState("");
  const [contractorPayment, setContractorPayment] = useState("");
  const [materialCost, setMaterialCost] = useState("");
  const [lotCost, setLotCost] = useState("");
  const [commissionCost, setCommissionCost] = useState("");
  const [extrasCost, setExtrasCost] = useState("");
  const [maintenanceCost, setMaintenanceCost] = useState("");
  const [insuranceCost, setInsuranceCost] = useState("");
  const [balanceAmount, setBalanceAmount] = useState("");

  // Campos MCMV/CEF adicionais
  const [vgv, setVgv] = useState("");
  const [financedAmount, setFinancedAmount] = useState("");
  const [fgtsAmount, setFgtsAmount] = useState("");
  const [subsidyAmount, setSubsidyAmount] = useState("");
  const [downPaymentTotal, setDownPaymentTotal] = useState("");
  const [downPaymentPaid, setDownPaymentPaid] = useState("");
  const [plsPercentage, setPlsPercentage] = useState("");
  const [cefReceivedAmount, setCefReceivedAmount] = useState("");
  const [constructionSpent, setConstructionSpent] = useState("");
  const [brokerName, setBrokerName] = useState("");
  const [brokerPaid, setBrokerPaid] = useState("false");
  const [constructionCost, setConstructionCost] = useState("");
  const [estimatedProfit, setEstimatedProfit] = useState("");
  const [investorProfit, setInvestorProfit] = useState("");
  const [prospectaProfit, setProspectaProfit] = useState("");
  const [proSoluto, setProSoluto] = useState("");
  const [installmentRate, setInstallmentRate] = useState("");
  const [installmentQty, setInstallmentQty] = useState("");
  const [installmentValue, setInstallmentValue] = useState("");
  const [constructionDays, setConstructionDays] = useState("");
  const [clientName, setClientName] = useState("");
  const [cefTitle, setCefTitle] = useState("");
  const [cefBranch, setCefBranch] = useState("");

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
      setProjectType(project.projectType || "");
      setTotalArea(project.totalArea?.toString() || "");
      setStatus(project.status);
      setStartDate(project.startDate ? new Date(project.startDate).toISOString().split("T")[0] : "");
      setEstimatedEndDate(project.estimatedEndDate ? new Date(project.estimatedEndDate).toISOString().split("T")[0] : "");
      setActualEndDate(project.actualEndDate ? new Date(project.actualEndDate).toISOString().split("T")[0] : "");
      setNotes((project.notes || "").replace(/\n__MCMV_META__:[\s\S]+$/, ""));
      setProgress(project.progress?.toString() || "0");

      // Valores financeiros
      setContractValue(project.contractValue || "");
      setContractType(project.contractType || "");
      setContractorPayment((project as any).contractorPayment || "");
      setMaterialCost((project as any).materialCost || "");
      setLotCost(project.lotCost || "");
      setCommissionCost((project as any).commissionCost || "");
      setExtrasCost((project as any).extrasCost || "");
      setMaintenanceCost((project as any).maintenanceCost || "");
      setInsuranceCost((project as any).insuranceCost || "");
      setBalanceAmount((project as any).balanceAmount || "");

      // Campos MCMV adicionais (stored appended to notes field)
      const notesRaw = project.notes || "";
      const metaMatch = notesRaw.match(/\n__MCMV_META__:([\s\S]+)$/);
      let meta: Record<string, string> = {};
      if (metaMatch) {
        try { meta = JSON.parse(metaMatch[1]); } catch {}
      }
      setVgv(project.vgv || meta.vgv || "");
      setFinancedAmount(project.financedAmount || meta.financedAmount || "");
      setFgtsAmount(project.fgtsAmount || meta.fgtsAmount || "");
      setSubsidyAmount(project.subsidyAmount || meta.subsidyAmount || "");
      setDownPaymentTotal(project.downPaymentTotal || meta.downPaymentTotal || "");
      setDownPaymentPaid(project.downPaymentPaid || meta.downPaymentPaid || "");
      setPlsPercentage(meta.plsPercentage || "");
      setCefReceivedAmount(meta.cefReceivedAmount || "");
      setConstructionSpent(meta.constructionSpent || "");
      setBrokerName(meta.brokerName || "");
      setBrokerPaid(meta.brokerPaid || "false");
      setConstructionCost(meta.constructionCost || "");
      setEstimatedProfit(meta.estimatedProfit || "");
      setInvestorProfit(meta.investorProfit || "");
      setProspectaProfit(meta.prospectaProfit || "");
      setProSoluto(meta.proSoluto || "");
      setInstallmentRate(meta.installmentRate || "");
      setInstallmentQty(meta.installmentQty || "");
      setInstallmentValue(meta.installmentValue || "");
      setConstructionDays(meta.constructionDays || "");
      setClientName(meta.clientName || "");
      setCefTitle(meta.cefTitle || "");
      setCefBranch(meta.cefBranch || "");
    }
  }, [project]);

  const handleSave = () => {
    const updates: any = {
      projectId,
      title,
      address,
      projectType,
      totalArea: totalArea ? parseInt(totalArea) : undefined,
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      estimatedEndDate: estimatedEndDate ? new Date(estimatedEndDate) : undefined,
      actualEndDate: actualEndDate ? new Date(actualEndDate) : undefined,
      notes,
      progress: parseInt(progress),
    };

    // Adicionar valores financeiros (decimal - sem conversão)
    if (contractValue) updates.contractValue = parseFloat(contractValue);
    if (contractType) updates.contractType = contractType;
    if (contractorPayment) updates.contractorPayment = parseFloat(contractorPayment);
    if (materialCost) updates.materialCost = parseFloat(materialCost);
    if (lotCost) updates.lotCost = parseFloat(lotCost);
    if (commissionCost) updates.commissionCost = parseFloat(commissionCost);
    if (extrasCost) updates.extrasCost = parseFloat(extrasCost);
    if (maintenanceCost) updates.maintenanceCost = parseFloat(maintenanceCost);
    if (insuranceCost) updates.insuranceCost = parseFloat(insuranceCost);
    if (balanceAmount) updates.balanceAmount = parseFloat(balanceAmount);

    // Save MCMV/CEF metadata in notes field as JSON-like suffix
    const mcmvMeta = {
      vgv, financedAmount, fgtsAmount, subsidyAmount, downPaymentTotal, downPaymentPaid,
      plsPercentage, cefReceivedAmount, constructionSpent, brokerName, brokerPaid,
      constructionCost, estimatedProfit, investorProfit, prospectaProfit,
      proSoluto, installmentRate, installmentQty, installmentValue,
      constructionDays, clientName, cefTitle, cefBranch,
    };
    // Store MCMV data appended to notes as a parseable marker
    const mcmvTag = `\n__MCMV_META__:${JSON.stringify(mcmvMeta)}`;
    const baseNotes = notes.replace(/\n__MCMV_META__:[\s\S]*$/, "");
    updates.notes = baseNotes.replace(/\n__MCMV_META__:[\s\S]*$/, "") ? baseNotes + mcmvTag : mcmvTag;

    updateMutation.mutate(updates);
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
            <div className="flex items-center gap-3">
              <Link href={`/admin/obras/${projectId}/medicoes`}>
                <Button variant="outline" className="border-[#C9A961]/40 text-[#C9A961] hover:bg-[#C9A961]/10 gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Ver Medições
                </Button>
              </Link>
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] gap-2"
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="h-5 w-5" />
                  Salvar Alterações
                </>
              )}
            </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-6 bg-[#1A2332]/60 border border-[#C9A961]/20">
            <TabsTrigger value="info" className="data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332]">
              <Building2 className="h-4 w-4 mr-1" />
              <span className="hidden md:inline">Informações</span>
            </TabsTrigger>
            <TabsTrigger value="mcmv" className="data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332]">
              <DollarSign className="h-4 w-4 mr-1" />
              <span className="hidden md:inline">MCMV/CEF</span>
            </TabsTrigger>
            <TabsTrigger value="valores" className="data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332]">
              <DollarSign className="h-4 w-4 mr-1" />
              <span className="hidden md:inline">Custos</span>
            </TabsTrigger>
            <TabsTrigger value="progresso" className="data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332]">
              <FileText className="h-4 w-4 mr-1" />
              <span className="hidden md:inline">Progresso</span>
            </TabsTrigger>
            <TabsTrigger value="fotos" className="data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332]">
              <Image className="h-4 w-4 mr-1" />
              <span className="hidden md:inline">Fotos</span>
            </TabsTrigger>
            <TabsTrigger value="relatorios" className="data-[state=active]:bg-[#C9A961] data-[state=active]:text-[#1A2332]">
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
                      value={projectType}
                      onChange={(e) => setProjectType(e.target.value)}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                      placeholder="Ex: Casa 47m²"
                    />
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
                      type="number"
                      value={totalArea}
                      onChange={(e) => setTotalArea(e.target.value)}
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
                        {/* Status legados */}
                        <SelectItem value="planning">Planejamento</SelectItem>
                        <SelectItem value="in_progress">Em Andamento</SelectItem>
                        <SelectItem value="paused">Pausada</SelectItem>
                        <SelectItem value="completed">Concluída</SelectItem>
                        <SelectItem value="cancelled">Cancelada</SelectItem>
                        {/* Etapas do processo CEF/MCMV */}
                        <SelectItem value="atendimento">Atendimento</SelectItem>
                        <SelectItem value="aprovacao">Aprovação</SelectItem>
                        <SelectItem value="proposta">Proposta</SelectItem>
                        <SelectItem value="contrato_prospecta">Contrato Prospecta</SelectItem>
                        <SelectItem value="documentos">Documentos</SelectItem>
                        <SelectItem value="vistoria_cef">Vistoria CEF</SelectItem>
                        <SelectItem value="laudo_cef">Laudo CEF</SelectItem>
                        <SelectItem value="assinaturas_fichas">Assinaturas Fichas</SelectItem>
                        <SelectItem value="conformidade_cef">Conformidade CEF</SelectItem>
                        <SelectItem value="assinatura_contrato_cef">Assinatura Contrato CEF</SelectItem>
                        <SelectItem value="cartorio">Cartório</SelectItem>
                        <SelectItem value="itbi">ITBI</SelectItem>
                        <SelectItem value="segunda_conformidade">Segunda Conformidade</SelectItem>
                        <SelectItem value="cef_libera_obra">CEF Libera Obra</SelectItem>
                        <SelectItem value="medicoes">Medições</SelectItem>
                        <SelectItem value="entrega">Entrega</SelectItem>
                        <SelectItem value="cno_cnd">CNO/CND</SelectItem>
                        <SelectItem value="habite_se">Habite-se</SelectItem>
                        <SelectItem value="averbacao">Averbação</SelectItem>
                        <SelectItem value="concluido">Concluído</SelectItem>
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

          {/* ABA MCMV/CEF */}
          <TabsContent value="mcmv" className="mt-6">
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-[#C9A961]">Dados MCMV / Caixa Econômica Federal</CardTitle>
                <CardDescription className="text-gray-400">
                  Campos específicos do programa Minha Casa Minha Vida e CEF
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Identificação CEF */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label className="text-gray-300">Nome do Cliente</Label>
                    <Input value={clientName} onChange={(e) => setClientName(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Nome do beneficiário" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">Título CF (CEF)</Label>
                    <Input value={cefTitle} onChange={(e) => setCefTitle(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Número do título" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">Escritório CF (Agência CEF)</Label>
                    <Input value={cefBranch} onChange={(e) => setCefBranch(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Agência CEF" />
                  </div>
                </div>

                {/* Valores CEF */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-gray-300">VGV - Valor Global de Venda (R$)</Label>
                    <Input type="number" step="0.01" value={vgv} onChange={(e) => setVgv(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Ex: 153000.00" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">Valor Financiado CEF (R$)</Label>
                    <Input type="number" step="0.01" value={financedAmount} onChange={(e) => setFinancedAmount(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Ex: 137700.00" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label className="text-gray-300">FGTS (R$)</Label>
                    <Input type="number" step="0.01" value={fgtsAmount} onChange={(e) => setFgtsAmount(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Ex: 21850.00" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">Subsídio (R$)</Label>
                    <Input type="number" step="0.01" value={subsidyAmount} onChange={(e) => setSubsidyAmount(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Ex: 55000.00" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">Valor Recebido CEF (R$)</Label>
                    <Input type="number" step="0.01" value={cefReceivedAmount} onChange={(e) => setCefReceivedAmount(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Valor já recebido da CEF" />
                  </div>
                </div>

                {/* Entrada */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-gray-300">Entrada Total (R$)</Label>
                    <Input type="number" step="0.01" value={downPaymentTotal} onChange={(e) => setDownPaymentTotal(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Valor total de entrada" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">Entrada Paga (R$)</Label>
                    <Input type="number" step="0.01" value={downPaymentPaid} onChange={(e) => setDownPaymentPaid(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Quanto já foi pago" />
                  </div>
                </div>

                {/* Custos Construção */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-gray-300">Custo Construção (R$)</Label>
                    <Input type="number" step="0.01" value={constructionCost} onChange={(e) => setConstructionCost(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Ex: 85000.00" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">Gasto Obra Realizado (R$)</Label>
                    <Input type="number" step="0.01" value={constructionSpent} onChange={(e) => setConstructionSpent(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Quanto já foi gasto" />
                  </div>
                </div>

                {/* Lucros */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label className="text-gray-300">Lucro Estimado (R$)</Label>
                    <Input type="number" step="0.01" value={estimatedProfit} onChange={(e) => setEstimatedProfit(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Lucro estimado total" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">Lucro Investidor (R$)</Label>
                    <Input type="number" step="0.01" value={investorProfit} onChange={(e) => setInvestorProfit(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Parcela do investidor" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">Lucro Prospecta (R$)</Label>
                    <Input type="number" step="0.01" value={prospectaProfit} onChange={(e) => setProspectaProfit(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Parcela da Prospecta" />
                  </div>
                </div>

                {/* Corretor */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-gray-300">Nome do Corretor</Label>
                    <Input value={brokerName} onChange={(e) => setBrokerName(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Nome do corretor responsável" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">Corretor Pago?</Label>
                    <Select value={brokerPaid} onValueChange={setBrokerPaid}>
                      <SelectTrigger className="bg-[#2C3E50] border-[#C9A961]/30 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="false">Não</SelectItem>
                        <SelectItem value="true">Sim</SelectItem>
                        <SelectItem value="partial">Parcial</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Pro-Soluto / Parcelas */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div className="space-y-2">
                    <Label className="text-gray-300">Pro-Soluto</Label>
                    <Input value={proSoluto} onChange={(e) => setProSoluto(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Tipo de parcelamento" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">Taxa (%)</Label>
                    <Input type="number" step="0.01" value={installmentRate} onChange={(e) => setInstallmentRate(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Taxa mensal" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">Qtd Parcelas</Label>
                    <Input type="number" value={installmentQty} onChange={(e) => setInstallmentQty(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Ex: 12" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">Valor Parcela (R$)</Label>
                    <Input type="number" step="0.01" value={installmentValue} onChange={(e) => setInstallmentValue(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Valor de cada parcela" />
                  </div>
                </div>

                {/* Dias de Obra e PLS% */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-gray-300">Dias de Obra (prazo)</Label>
                    <Input type="number" value={constructionDays} onChange={(e) => setConstructionDays(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Ex: 90" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">PLS% (% Recebido)</Label>
                    <Input type="number" step="0.01" value={plsPercentage} onChange={(e) => setPlsPercentage(e.target.value)} className="bg-[#2C3E50] border-[#C9A961]/30 text-white" placeholder="Ex: 30.00" />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    onClick={handleSave}
                    disabled={updateMutation.isPending}
                    className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] gap-2"
                  >
                    {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Salvar
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ABA 2: VALORES E CUSTOS */}
          <TabsContent value="valores" className="mt-6">
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-[#C9A961]">Valores e Custos</CardTitle>
                <CardDescription className="text-gray-400">
                  Informações financeiras detalhadas da obra
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="contractValue" className="text-gray-300">Valor Total do Contrato (R$)</Label>
                    <Input
                      id="contractValue"
                      type="number"
                      step="0.01"
                      value={contractValue}
                      onChange={(e) => setContractValue(e.target.value)}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                      placeholder="Ex: 180000.00"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="contractType" className="text-gray-300">Tipo de Contrato</Label>
                    <Input
                      id="contractType"
                      value={contractType}
                      onChange={(e) => setContractType(e.target.value)}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                      placeholder="Ex: Empreitada Global"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="contractorPayment" className="text-gray-300">Pagamento Empreiteiro (R$)</Label>
                    <Input
                      id="contractorPayment"
                      type="number"
                      step="0.01"
                      value={contractorPayment}
                      onChange={(e) => setContractorPayment(e.target.value)}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                      placeholder="Ex: 50000.00"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="materialCost" className="text-gray-300">Custo de Material (R$)</Label>
                    <Input
                      id="materialCost"
                      type="number"
                      step="0.01"
                      value={materialCost}
                      onChange={(e) => setMaterialCost(e.target.value)}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                      placeholder="Ex: 80000.00"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="lotCost" className="text-gray-300">Custo do Lote/Terreno (R$)</Label>
                    <Input
                      id="lotCost"
                      type="number"
                      step="0.01"
                      value={lotCost}
                      onChange={(e) => setLotCost(e.target.value)}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                      placeholder="Ex: 30000.00"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="commissionCost" className="text-gray-300">Comissão (R$)</Label>
                    <Input
                      id="commissionCost"
                      type="number"
                      step="0.01"
                      value={commissionCost}
                      onChange={(e) => setCommissionCost(e.target.value)}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                      placeholder="Ex: 5000.00"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="extrasCost" className="text-gray-300">Custos Extras (R$)</Label>
                    <Input
                      id="extrasCost"
                      type="number"
                      step="0.01"
                      value={extrasCost}
                      onChange={(e) => setExtrasCost(e.target.value)}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                      placeholder="Ex: 3000.00"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="maintenanceCost" className="text-gray-300">Manutenção (R$)</Label>
                    <Input
                      id="maintenanceCost"
                      type="number"
                      step="0.01"
                      value={maintenanceCost}
                      onChange={(e) => setMaintenanceCost(e.target.value)}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                      placeholder="Ex: 2000.00"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="insuranceCost" className="text-gray-300">Seguro (R$)</Label>
                    <Input
                      id="insuranceCost"
                      type="number"
                      step="0.01"
                      value={insuranceCost}
                      onChange={(e) => setInsuranceCost(e.target.value)}
                      className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                      placeholder="Ex: 1500.00"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="balanceAmount" className="text-gray-300">Saldo Restante (R$)</Label>
                  <Input
                    id="balanceAmount"
                    type="number"
                    step="0.01"
                    value={balanceAmount}
                    onChange={(e) => setBalanceAmount(e.target.value)}
                    className="bg-[#2C3E50] border-[#C9A961]/30 text-white"
                    placeholder="Ex: 8500.00"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ABA 3: PROGRESSO */}
          <TabsContent value="progresso" className="mt-6">
            <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-[#C9A961]">Medições e Progresso</CardTitle>
                <CardDescription className="text-gray-400">
                  Acompanhamento do andamento da obra
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
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
                  <p className="text-gray-400 text-sm mb-4">
                    As etapas individuais podem ser gerenciadas na seção de detalhes da obra.
                  </p>
                  {project.stages && project.stages.length > 0 ? (
                    <div className="space-y-3">
                      {project.stages.map((stage) => (
                        <div key={stage.id} className="flex items-center justify-between p-3 bg-[#2C3E50] rounded-lg border border-[#C9A961]/20">
                          <div>
                            <p className="font-medium text-white">{stage.name}</p>
                            <p className="text-sm text-gray-400">{stage.description || "Sem descrição"}</p>
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
                    <p className="text-gray-400 text-center py-8">Nenhuma etapa cadastrada ainda.</p>
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
                            doc.text(`Tipo: ${project.projectType || "N/A"}`, 20, 60);
                            doc.text(`Área Total: ${project.totalArea || "N/A"} m²`, 20, 70);
                            doc.text(`Status: ${project.status}`, 20, 80);
                            doc.text(`Progresso: ${project.progress}%`, 20, 90);
                            
                            // Valores
                            doc.text("Valores Financeiros:", 20, 110);
                            doc.text(`Valor do Contrato: R$ ${project.contractValue || "0"}`, 20, 120);
                            doc.text(`Custo de Material: R$ ${(project as any).materialCost || "0"}`, 20, 130);
                            doc.text(`Custo do Lote: R$ ${project.lotCost || "0"}`, 20, 140);
                            doc.text(`Saldo: R$ ${(project as any).balanceAmount || "0"}`, 20, 150);
                            
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
                              ["Tipo", project.projectType || "N/A"],
                              ["Área Total (m²)", project.totalArea || "N/A"],
                              ["Status", project.status],
                              ["Progresso (%)", project.progress],
                              [""],
                              ["Valores Financeiros (R$)"],
                              ["Valor do Contrato", parseFloat(project.contractValue || "0")],
                              ["Tipo de Contrato", project.contractType || "N/A"],
                              ["Pagamento Empreiteiro", parseFloat((project as any).contractorPayment || "0")],
                              ["Custo de Material", parseFloat((project as any).materialCost || "0")],
                              ["Custo do Lote", parseFloat(project.lotCost || "0")],
                              ["Comissão", parseFloat((project as any).commissionCost || "0")],
                              ["Extras", parseFloat((project as any).extrasCost || "0")],
                              ["Manutenção", parseFloat((project as any).maintenanceCost || "0")],
                              ["Seguro", parseFloat((project as any).insuranceCost || "0")],
                              ["Saldo", parseFloat((project as any).balanceAmount || "0")],
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
      </div>
    </div>
  );
}
