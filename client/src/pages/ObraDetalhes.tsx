import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import {
  HardHat,
  ArrowLeft,
  Calendar,
  MapPin,
  DollarSign,
  CheckCircle2,
  Clock,
  Image as ImageIcon,
  FileText,
  TrendingUp,
} from "lucide-react";
import { Link, useParams, useLocation } from "wouter";
import { getLoginUrl } from "@/const";

const statusColors: Record<string, string> = {
  planning: "bg-blue-500",
  in_progress: "bg-green-500",
  paused: "bg-yellow-500",
  completed: "bg-purple-500",
  cancelled: "bg-red-500",
  alvara: "bg-cyan-500",
  art: "bg-indigo-500",
  assinatura_cef: "bg-orange-500",
  vistoria_cef: "bg-teal-500",
  laudo_ok: "bg-emerald-500",
  cartorio: "bg-violet-500",
  casa_pronta: "bg-green-600",
  disponivel: "bg-lime-500",
  reavaliar: "bg-amber-500",
  distrato: "bg-rose-500",
};

const statusLabels: Record<string, string> = {
  planning: "Planejamento",
  in_progress: "Em Andamento",
  paused: "Pausada",
  completed: "Concluída",
  cancelled: "Cancelada",
  alvara: "Alvará",
  art: "ART",
  assinatura_cef: "Assinatura CEF",
  vistoria_cef: "Vistoria CEF",
  laudo_ok: "Laudo OK",
  cartorio: "Cartório",
  casa_pronta: "Casa Pronta",
  disponivel: "Disponível",
  reavaliar: "Reavaliar",
  distrato: "Distrato",
};

const stageStatusColors = {
  pending: "bg-gray-500",
  in_progress: "bg-blue-500",
  completed: "bg-green-500",
};

const stageStatusLabels = {
  pending: "Pendente",
  in_progress: "Em Andamento",
  completed: "Concluída",
};

export default function ObraDetalhes() {
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  const { data: project, isLoading } = trpc.construction.getProjectDetails.useQuery(
    { projectId: parseInt(id!) },
    { enabled: isAuthenticated && !!id }
  );

  // Redirect para login se não autenticado
  if (!authLoading && !isAuthenticated) {
    window.location.href = getLoginUrl();
    return null;
  }

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#1A2332] to-[#0F1419] flex items-center justify-center">
        <div className="text-center">
          <HardHat className="h-12 w-12 text-[#C9A961] animate-pulse mx-auto mb-4" />
          <p className="text-white">Carregando detalhes da obra...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#1A2332] to-[#0F1419] flex items-center justify-center">
        <Card className="bg-white/5 border-[#C9A961]/20 backdrop-blur-sm max-w-md">
          <CardContent className="text-center py-12">
            <HardHat className="h-16 w-16 text-gray-500 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">Obra não encontrada</h3>
            <p className="text-gray-400 mb-6">Esta obra não existe ou você não tem permissão para acessá-la.</p>
            <Button onClick={() => setLocation("/obras")} className="bg-[#C9A961] hover:bg-[#B89851] text-[#1A2332]">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar para Minhas Obras
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1A2332] to-[#0F1419]">
      {/* Header */}
      <div className="bg-[#1A2332] border-b border-[#C9A961]/20">
        <div className="container mx-auto px-4 py-6">
          <Button
            variant="ghost"
            className="text-[#C9A961] hover:text-[#B89851] hover:bg-[#C9A961]/10 mb-4"
            onClick={() => setLocation("/obras")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar para Minhas Obras
          </Button>

          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold text-white">{project.title}</h1>
                <Badge className={`${statusColors[project.status]} text-white border-0`}>
                  {statusLabels[project.status]}
                </Badge>
              </div>
              {project.address && (
                <p className="text-gray-400 flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  {project.address}
                </p>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">Progresso Geral</span>
              <span className="text-lg font-bold text-[#C9A961]">{project.progress}%</span>
            </div>
            <Progress value={project.progress} className="h-3" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            <Tabs defaultValue="timeline" className="w-full">
              <TabsList className="grid w-full grid-cols-3 bg-white/5">
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
                <TabsTrigger value="photos">Fotos ({project.photos?.length || 0})</TabsTrigger>
                <TabsTrigger value="info">Informações</TabsTrigger>
              </TabsList>

              {/* Timeline Tab */}
              <TabsContent value="timeline" className="space-y-4">
                <Card className="bg-white/5 border-[#C9A961]/20 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                      <Clock className="h-5 w-5 text-[#C9A961]" />
                      Etapas da Obra
                    </CardTitle>
                    <CardDescription className="text-gray-400">
                      Acompanhe o progresso de cada etapa da construção
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!project.stages || project.stages.length === 0 ? (
                      <div className="text-center py-8 text-gray-400">
                        <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p>Nenhuma etapa cadastrada ainda</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {project.stages.map((stage, index) => (
                          <div key={stage.id} className="flex gap-4">
                            {/* Timeline Line */}
                            <div className="flex flex-col items-center">
                              <div
                                className={`w-10 h-10 rounded-full ${stageStatusColors[stage.status]} flex items-center justify-center flex-shrink-0`}
                              >
                                {stage.status === "completed" ? (
                                  <CheckCircle2 className="h-5 w-5 text-white" />
                                ) : (
                                  <span className="text-white font-semibold">{index + 1}</span>
                                )}
                              </div>
                              {index < project.stages.length - 1 && (
                                <div className="w-0.5 h-full bg-[#C9A961]/20 mt-2" />
                              )}
                            </div>

                            {/* Stage Content */}
                            <div className="flex-1 pb-6">
                              <div className="flex items-start justify-between mb-2">
                                <div>
                                  <h4 className="text-white font-semibold">{stage.name}</h4>
                                  {stage.description && (
                                    <p className="text-sm text-gray-400 mt-1">{stage.description}</p>
                                  )}
                                </div>
                                <Badge className={`${stageStatusColors[stage.status]} text-white border-0 ml-2`}>
                                  {stageStatusLabels[stage.status]}
                                </Badge>
                              </div>

                              <div className="flex flex-wrap gap-4 mt-3 text-sm">
                                {stage.startDate && (
                                  <span className="text-gray-400 flex items-center gap-1">
                                    <Calendar className="h-4 w-4" />
                                    Início: {new Date(stage.startDate).toLocaleDateString("pt-BR")}
                                  </span>
                                )}
                                {stage.endDate && (
                                  <span className="text-gray-400 flex items-center gap-1">
                                    <Calendar className="h-4 w-4" />
                                    Fim: {new Date(stage.endDate).toLocaleDateString("pt-BR")}
                                  </span>
                                )}
                                {stage.actualCost && (
                                  <span className="text-gray-400 flex items-center gap-1">
                                    <DollarSign className="h-4 w-4" />
                                    {new Intl.NumberFormat("pt-BR", {
                                      style: "currency",
                                      currency: "BRL",
                                    }).format(stage.actualCost)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Photos Tab */}
              <TabsContent value="photos" className="space-y-4">
                <Card className="bg-white/5 border-[#C9A961]/20 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                      <ImageIcon className="h-5 w-5 text-[#C9A961]" />
                      Galeria de Fotos
                    </CardTitle>
                    <CardDescription className="text-gray-400">
                      Registro fotográfico do progresso da obra
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {!project.photos || project.photos.length === 0 ? (
                      <div className="text-center py-12 text-gray-400">
                        <ImageIcon className="h-16 w-16 mx-auto mb-4 opacity-50" />
                        <p>Nenhuma foto adicionada ainda</p>
                        <p className="text-sm mt-2">As fotos serão adicionadas pela equipe de construção</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {project.photos.map((photo) => (
                          <div
                            key={photo.id}
                            className="relative aspect-square rounded-lg overflow-hidden bg-white/5 group cursor-pointer"
                          >
                            <img
                              src={photo.imageUrl}
                              alt={photo.caption || "Foto da obra"}
                              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                              <div className="absolute bottom-0 left-0 right-0 p-3">
                                {photo.caption && <p className="text-white text-sm font-medium">{photo.caption}</p>}
                                <p className="text-gray-300 text-xs mt-1">
                                  {new Date(photo.takenAt).toLocaleDateString("pt-BR")}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Info Tab */}
              <TabsContent value="info" className="space-y-4">
                <Card className="bg-white/5 border-[#C9A961]/20 backdrop-blur-sm">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                      <FileText className="h-5 w-5 text-[#C9A961]" />
                      Informações Detalhadas
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                      {project.projectType && (
                        <div>
                          <p className="text-sm text-gray-500 mb-1">Tipo de Projeto</p>
                          <p className="text-white font-medium">{project.projectType}</p>
                        </div>
                      )}
                      {project.totalArea && (
                        <div>
                          <p className="text-sm text-gray-500 mb-1">Área Total</p>
                          <p className="text-white font-medium">{project.totalArea}m²</p>
                        </div>
                      )}
                      {project.startDate && (
                        <div>
                          <p className="text-sm text-gray-500 mb-1">Data de Início</p>
                          <p className="text-white font-medium">
                            {new Date(project.startDate).toLocaleDateString("pt-BR")}
                          </p>
                        </div>
                      )}
                      {project.estimatedEndDate && (
                        <div>
                          <p className="text-sm text-gray-500 mb-1">Previsão de Término</p>
                          <p className="text-white font-medium">
                            {new Date(project.estimatedEndDate).toLocaleDateString("pt-BR")}
                          </p>
                        </div>
                      )}
                    </div>

                    {project.notes && (
                      <div>
                        <p className="text-sm text-gray-500 mb-2">Observações</p>
                        <p className="text-white bg-white/5 p-4 rounded-lg border border-[#C9A961]/10">
                          {project.notes}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Financial Summary */}
            <Card className="bg-white/5 border-[#C9A961]/20 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-[#C9A961]" />
                  Resumo Financeiro
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {project.constructionCost && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Orçamento Previsto</p>
                    <p className="text-2xl font-bold text-white">
                      {new Intl.NumberFormat("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      }).format(parseFloat(project.constructionCost))}
                    </p>
                  </div>
                )}
                {project.constructionSpent && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Custo Atual</p>
                    <p className="text-xl font-semibold text-[#C9A961]">
                      {new Intl.NumberFormat("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      }).format(parseFloat(project.constructionSpent))}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick Stats */}
            <Card className="bg-white/5 border-[#C9A961]/20 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-[#C9A961]" />
                  Estatísticas
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">Total de Etapas</span>
                  <span className="text-white font-semibold">{project.stages?.length || 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">Etapas Concluídas</span>
                  <span className="text-white font-semibold">
                    {project.stages?.filter((s) => s.status === "completed").length || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">Total de Fotos</span>
                  <span className="text-white font-semibold">{project.photos?.length || 0}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
