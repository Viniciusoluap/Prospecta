import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Building2, Loader2, Plus } from "lucide-react";
import { Link, useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { useEffect } from "react";
import { ListaObras } from "@/components/obra/ListaObras";
import { LinkedServiceQueue } from "./admin/LinkedServiceQueue";

export default function AdminObras() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  const { data: projects, isLoading, error, refetch } = trpc.construction.allProjects.useQuery(undefined, {
    enabled: isAuthenticated && (user?.role === "admin" || user?.role === "colaborador"),
  });
  const excluirObra = trpc.construction.deleteProject.useMutation();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      window.location.href = getLoginUrl();
    }
  }, [authLoading, isAuthenticated]);

  useEffect(() => {
    if (!authLoading && isAuthenticated && !(user?.role === "admin" || user?.role === "colaborador")) {
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

  if (!(user?.role === "admin" || user?.role === "colaborador")) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2332] via-[#2C3E50] to-[#1A2332]">
      {/* Header */}
      <div className="border-b border-[#C9A961]/20 bg-[#1A2332]/80 backdrop-blur-sm">
        <div className="container py-8">
          <div className="flex items-center justify-between">
            <div>
              <Link href="/admin">
                <Button variant="ghost" size="sm" className="mb-2 text-gray-300 hover:text-white">
                  Voltar ao Painel Administrativo
                </Button>
              </Link>
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
        <div className="mb-6"><LinkedServiceQueue module="obras" title="Obras" /></div>
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
            <ListaObras projects={projects}
              caminhoEditar={(id) => `/admin/obras/editar/${id}`}
              caminhoDetalhes={(id) => `/admin/obras/${id}`}
              onExcluir={async (p) => { await excluirObra.mutateAsync({ projectId: p.id }); await refetch(); }} />
        )}
      </div>
    </div>
  );
}
