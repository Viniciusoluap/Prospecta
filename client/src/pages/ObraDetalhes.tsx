import { useAuth } from "@/_core/hooks/useAuth";
import { formatarPercentual, progressoDaObra } from "@shared/financeiro/progresso";
import { obraStatusLabel } from "@shared/obra-status";
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
  aprovacao: "bg-sky-500",
  contrato_prospecta: "bg-amber-600",
  laudo_cef: "bg-emerald-600",
  conformidade_cef: "bg-teal-600",
};

const ETAPA_COR = { concluida: "bg-green-500", em_andamento: "bg-[#C9A961]", pendente: "bg-gray-500" } as const;
const exibirIndicador = (i: { ok: true; centavos: number } | { ok: false; motivo: string }) =>
  i.ok ? (i.centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : i.motivo;

/** `empreiteiro` (pedido de 15/10): a mesma página do admin, aberta pelo portal do empreiteiro. */
export default function ObraDetalhes({ admin: adminProp = false, empreiteiro = false }: { admin?: boolean; empreiteiro?: boolean }) {
  const admin = adminProp || empreiteiro;
  const { id } = useParams<{ id: string }>();
  const { loading: authLoading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const projectId = Number(id);
  const backTo = empreiteiro ? "/empreiteiro" : admin ? "/admin/obras" : "/obras";
  const backLabel = admin && !empreiteiro ? "Voltar para Obras" : "Voltar para Minhas Obras";
  const editarEm = empreiteiro ? "/empreiteiro/obras/editar" : "/admin/obras/editar";

  const { data: project, isLoading, error } = trpc.construction.getProjectDetails.useQuery(
    { projectId },
    { enabled: isAuthenticated && Number.isInteger(projectId) && projectId > 0 }
  );
  // Etapas, resumo financeiro e estatísticas: os mesmos números do editor da obra.
  const { data: detalhe } = trpc.obraProgresso.detalhe.useQuery(
    { projectId },
    { enabled: admin && isAuthenticated && Number.isInteger(projectId) && projectId > 0 }
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
            <p className="text-gray-400 mb-6">{error ? "Não foi possível carregar esta obra." : "Esta obra não existe ou você não tem permissão para acessá-la."}</p>
            <Button onClick={() => setLocation(backTo)} className="bg-[#C9A961] hover:bg-[#B89851] text-[#1A2332]">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {backLabel}
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
            onClick={() => setLocation(backTo)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {backLabel}
          </Button>

          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold text-white">{project.title}</h1>
                <Badge className={`${statusColors[project.status]} text-white border-0`}>
                  {obraStatusLabel(project.status)}
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
          {admin && (
            <Link href={`${editarEm}/${project.id}`}>
              <Button variant="outline" className="mt-4 border-[#C9A961] text-[#C9A961] hover:bg-[#C9A961]/10">
                Editar Obra
              </Button>
            </Link>
          )}

          {/* Progress Bar */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">Progresso Geral</span>
              <span className="text-lg font-bold text-[#C9A961]">{formatarPercentual(progressoDaObra(project.progressMeasuredPct, project.progress))}</span>
            </div>
            <Progress value={progressoDaObra(project.progressMeasuredPct, project.progress)} className="h-3" />
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
                    {!detalhe || detalhe.etapas.length === 0 ? (
                      <div className="text-center py-8 text-gray-400">
                        <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p>{detalhe ? "Nenhuma etapa com incidência no acompanhamento do progresso" : "Carregando etapas…"}</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {detalhe.etapas.map((etapa, index) => (
                          <div key={etapa.chave} className={`rounded-lg border p-3 ${etapa.situacao === "em_andamento" ? "border-[#C9A961]/60 bg-[#C9A961]/5" : "border-[#C9A961]/15"}`}>
                            <div className="flex items-center justify-between gap-3 mb-2">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${ETAPA_COR[etapa.situacao]}`}>
                                  {etapa.situacao === "concluida" ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                                </span>
                                <div className="min-w-0">
                                  <p className="text-white font-semibold truncate">{etapa.nome}</p>
                                  <p className="text-xs text-gray-400">Incidência {formatarPercentual(etapa.incidencia)} · {formatarPercentual(etapa.execucaoObra)} da obra</p>
                                </div>
                              </div>
                              <span className="text-sm font-bold text-[#C9A961] shrink-0">{formatarPercentual(etapa.execucao)}</span>
                            </div>
                            <Progress value={etapa.execucao} className="h-2" />
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
              <CardContent className="space-y-3">
                {!detalhe ? <p className="text-sm text-gray-400">Carregando…</p> : ([
                  ["Orçamento Previsto", exibirIndicador(detalhe.financeiro.orcamentoPrevisto)],
                  ["Valor a Receber do Banco", exibirIndicador(detalhe.financeiro.receberBanco)],
                  ["PLS Real (%)", detalhe.financeiro.plsReal.ok ? formatarPercentual(detalhe.financeiro.plsReal.percentual) : detalhe.financeiro.plsReal.motivo],
                  ["Gasto Obra Realizado", exibirIndicador(detalhe.financeiro.gastoObraRealizado)],
                  ["Saldo Restante", exibirIndicador(detalhe.financeiro.saldoRestante)],
                ] as const).map(([rotulo, valor]) => (
                  <div key={rotulo} className="flex items-start justify-between gap-3 border-b border-white/5 pb-2 last:border-0">
                    <span className="text-sm text-gray-400">{rotulo}</span>
                    <span className="text-right text-sm font-semibold text-white">{valor}</span>
                  </div>
                ))}
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
                  <span className="text-white font-semibold">{detalhe?.estatisticas.totalEtapas ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">Etapas Concluídas</span>
                  <span className="text-white font-semibold">{detalhe?.estatisticas.etapasConcluidas ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">Total de Fotos</span>
                  <span className="text-white font-semibold">{detalhe?.estatisticas.totalFotos ?? project.photos?.length ?? 0}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
