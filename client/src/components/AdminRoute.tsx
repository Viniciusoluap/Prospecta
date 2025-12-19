import { ReactNode, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";

interface AdminRouteProps {
  children: ReactNode;
}

/**
 * Componente que protege rotas administrativas.
 * Requer autenticação E role === 'admin'.
 * Redireciona para login se não autenticado, ou para home se não for admin.
 */
export function AdminRoute({ children }: AdminRouteProps) {
  // Usa opção redirectOnUnauthenticated para redirecionar automaticamente se não autenticado
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true });
  const [, setLocation] = useLocation();

  useEffect(() => {
    // Se terminou de carregar e tem usuário, verifica se é admin
    if (!loading && user && user.role !== "admin") {
      setLocation("/");
    }
  }, [loading, user, setLocation]);

  // Mostra loading enquanto verifica autenticação
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1A2332]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#C9A961]"></div>
          <p className="mt-4 text-gray-400">Verificando permissões...</p>
        </div>
      </div>
    );
  }

  // Se não é admin, não renderiza nada (redirecionamento acontece no useEffect)
  if (!user || user.role !== "admin") {
    return null;
  }

  // Se autenticado E é admin, renderiza o conteúdo protegido
  return <>{children}</>;
}
