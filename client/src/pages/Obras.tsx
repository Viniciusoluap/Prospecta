import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import {
  HardHat,
  Plus,
  Calendar,
  MapPin,
  TrendingUp,
  Eye,
  AlertCircle,
  ArrowLeft,
} from "lucide-react";
import { Link, useLocation } from "wouter";
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

export default function Obras() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  const { data: projects, isLoading } = trpc.construction.myProjects.useQuery(
    undefined,
    {
      enabled: isAuthenticated,
    }
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
          <p className="text-white">Carregando suas obras...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1A2332] to-[#0F1419]">
      {/* Header */}
      <div className="bg-[#1A2332] border-b border-[#C9A961]/20">
        <div className="container mx-auto px-4 py-8">
          <Button
            variant="ghost"
            className="text-[#C9A961] hover:text-[#B89851] hover:bg-[#C9A961]/10 mb-4"
            onClick={() => setLocation("/")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar para Início
          </Button>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-[#C9A961] flex items-center gap-3">
                <HardHat className="h-8 w-8" />
                Minhas Obras
              </h1>
              <p className="text-gray-400 mt-2">
                Acompanhe o progresso de suas construções em tempo real
              </p>
            </div>
            <Button
              size="lg"
              className="bg-[#C9A961] hover:bg-[#B89851] text-[#1A2332] font-semibold"
              onClick={() => setLocation("/obras/nova")}
            >
              <Plus className="mr-2 h-5 w-5" />
              Nova Obra
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-8">
        {!projects || projects.length === 0 ? (
          // Empty State
          <Card className="bg-white/5 border-[#C9A961]/20 backdrop-blur-sm">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="w-20 h-20 rounded-full bg-[#C9A961]/10 flex items-center justify-center mb-6">
                <HardHat className="h-10 w-10 text-[#C9A961]" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">
                Nenhuma obra cadastrada
              </h3>
              <p className="text-gray-400 text-center max-w-md mb-6">
                Você ainda não possui obras em andamento. Comece cadastrando sua
                primeira construção!
              </p>
              <Button
                size="lg"
                className="bg-[#C9A961] hover:bg-[#B89851] text-[#1A2332] font-semibold"
                onClick={() => setLocation("/obras/nova")}
              >
                <Plus className="mr-2 h-5 w-5" />
                Cadastrar Primeira Obra
              </Button>
            </CardContent>
          </Card>
        ) : (
          // Projects Grid
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map(project => (
              <Card
                key={project.id}
                className="bg-white/5 border-[#C9A961]/20 backdrop-blur-sm hover:bg-white/10 transition-all cursor-pointer group"
                onClick={() => setLocation(`/obras/${project.id}`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between mb-2">
                    <CardTitle className="text-xl text-white group-hover:text-[#C9A961] transition-colors">
                      {project.title}
                    </CardTitle>
                    <Badge
                      className={`${statusColors[project.status]} text-white border-0`}
                    >
                      {statusLabels[project.status]}
                    </Badge>
                  </div>
                  {project.address && (
                    <CardDescription className="flex items-center gap-2 text-gray-400">
                      <MapPin className="h-4 w-4" />
                      {project.address}
                    </CardDescription>
                  )}
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Progress */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-400">Progresso</span>
                      <span className="text-sm font-semibold text-[#C9A961]">
                        {project.progress}%
                      </span>
                    </div>
                    <Progress value={project.progress} className="h-2" />
                  </div>

                  {/* Info Grid */}
                  <div className="grid grid-cols-2 gap-4 pt-2">
                    {project.projectType && (
                      <div>
                        <p className="text-xs text-gray-500">Tipo</p>
                        <p className="text-sm text-white font-medium">
                          {project.projectType}
                        </p>
                      </div>
                    )}
                    {project.totalArea && (
                      <div>
                        <p className="text-xs text-gray-500">Área</p>
                        <p className="text-sm text-white font-medium">
                          {project.totalArea}m²
                        </p>
                      </div>
                    )}
                    {project.startDate && (
                      <div>
                        <p className="text-xs text-gray-500">Início</p>
                        <p className="text-sm text-white font-medium flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(project.startDate).toLocaleDateString(
                            "pt-BR"
                          )}
                        </p>
                      </div>
                    )}
                    {project.constructionCost && (
                      <div>
                        <p className="text-xs text-gray-500">Orçamento</p>
                        <p className="text-sm text-white font-medium">
                          {new Intl.NumberFormat("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          }).format(parseFloat(project.constructionCost))}
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>

                <CardFooter className="border-t border-[#C9A961]/10 pt-4">
                  <Button
                    variant="ghost"
                    className="w-full text-[#C9A961] hover:text-[#B89851] hover:bg-[#C9A961]/10"
                    onClick={e => {
                      e.stopPropagation();
                      setLocation(`/obras/${project.id}`);
                    }}
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    Ver Detalhes
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}

        {/* Info Banner */}
        {projects && projects.length > 0 && (
          <Card className="mt-8 bg-[#C9A961]/10 border-[#C9A961]/30 backdrop-blur-sm">
            <CardContent className="flex items-start gap-4 py-6">
              <AlertCircle className="h-6 w-6 text-[#C9A961] flex-shrink-0 mt-1" />
              <div>
                <h4 className="text-white font-semibold mb-1">
                  Acompanhamento em Tempo Real
                </h4>
                <p className="text-gray-300 text-sm">
                  Receba atualizações automáticas sobre o progresso da sua obra.
                  Fotos, relatórios e medições são adicionados pela equipe de
                  construção regularmente.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
