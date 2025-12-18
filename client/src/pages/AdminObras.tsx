import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Building2, Calendar, DollarSign, Loader2, Plus, User } from "lucide-react";
import { Link, useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { useEffect } from "react";

export default function AdminObras() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  const { data: projects, isLoading, error } = trpc.construction.allProjects.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
  });

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

  const statusColors = {
    planning: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    in_progress: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    paused: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    completed: "bg-green-500/20 text-green-300 border-green-500/30",
    cancelled: "bg-red-500/20 text-red-300 border-red-500/30",
  };

  const statusLabels = {
    planning: "Planejamento",
    in_progress: "Em Andamento",
    paused: "Pausada",
    completed: "Concluída",
    cancelled: "Cancelada",
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      {/* Header */}
      <div className="border-b border-[#C9A961]/20 bg-[#1A2332]/80 backdrop-blur-sm">
        <div className="container py-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-[#C9A961] mb-2">Painel Admin - Obras</h1>
              <p className="text-gray-400">Gerencie todas as obras do sistema</p>
            </div>
            <Link href="/admin/obras/nova">
              <Button className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] gap-2">
                <Plus className="h-5 w-5" />
                Nova Obra
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#C9A961]" />
          </div>
        ) : error ? (
          <Card className="bg-red-500/10 border-red-500/30">
            <CardContent className="pt-6">
              <p className="text-red-300">Erro ao carregar obras: {error.message}</p>
            </CardContent>
          </Card>
        ) : !projects || projects.length === 0 ? (
          <Card className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm">
            <CardContent className="pt-6 text-center py-12">
              <Building2 className="h-16 w-16 text-[#C9A961]/50 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-[#C9A961] mb-2">Nenhuma obra cadastrada</h3>
              <p className="text-gray-400 mb-6">Comece criando a primeira obra do sistema.</p>
              <Link href="/admin/obras/nova">
                <Button className="bg-[#C9A961] hover:bg-[#B8985A] text-[#1A2332] gap-2">
                  <Plus className="h-5 w-5" />
                  Criar Primeira Obra
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6">
            {projects.map((project) => (
              <Card key={project.id} className="bg-[#1A2332]/60 border-[#C9A961]/20 backdrop-blur-sm hover:border-[#C9A961]/40 transition-all">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-[#C9A961] text-xl mb-2">{project.title}</CardTitle>
                      <CardDescription className="text-gray-400">
                        {project.address || "Endereço não informado"}
                      </CardDescription>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-sm border ${statusColors[project.status]}`}>
                      {statusLabels[project.status]}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                    <div className="flex items-center gap-2 text-gray-300">
                      <User className="h-4 w-4 text-[#C9A961]" />
                      <span className="text-sm">Cliente ID: {project.userId}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-300">
                      <Building2 className="h-4 w-4 text-[#C9A961]" />
                      <span className="text-sm">{project.projectType || "Tipo não definido"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-300">
                      <Calendar className="h-4 w-4 text-[#C9A961]" />
                      <span className="text-sm">
                        {project.startDate ? new Date(project.startDate).toLocaleDateString("pt-BR") : "Sem data"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-300">
                      <DollarSign className="h-4 w-4 text-[#C9A961]" />
                      <span className="text-sm">
                        {project.estimatedCost
                          ? `R$ ${(project.estimatedCost / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                          : "Sem orçamento"}
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-400">Progresso</span>
                      <span className="text-sm font-semibold text-[#C9A961]">{project.progress}%</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2">
                      <div
                        className="bg-gradient-to-r from-[#C9A961] to-[#FFD700] h-2 rounded-full transition-all"
                        style={{ width: `${project.progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Link href={`/admin/obras/editar/${project.id}`} className="flex-1">
                      <Button variant="outline" className="w-full border-[#C9A961] text-[#C9A961] hover:bg-[#C9A961]/10">
                        Editar Obra
                      </Button>
                    </Link>
                    <Link href={`/obras/${project.id}`}>
                      <Button variant="ghost" className="text-gray-300 hover:text-[#C9A961]">
                        Ver Detalhes
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
