import { ReactNode, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";

interface ProtectedRouteProps {
  children: ReactNode;
}

/**
 * Componente que protege rotas que exigem autenticação.
 * Redireciona para login do Manus OAuth se usuário não estiver autenticado.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { loading, isAuthenticated, user } = useAuth();

  // Log para debug
  console.log("[ProtectedRoute] Estado:", { loading, isAuthenticated, user });

  // Redirecionamento manual - não confiar apenas no useAuth
  useEffect(() => {
    console.log("[ProtectedRoute] useEffect:", {
      loading,
      isAuthenticated,
      user,
    });

    // Se não está carregando E não está autenticado, redireciona
    if (!loading && !isAuthenticated) {
      console.log("[ProtectedRoute] REDIRECIONANDO para login");
      const loginUrl = `https://api.manus.im/oauth/authorize?app_id=${import.meta.env.VITE_APP_ID}`;
      window.location.href = loginUrl;
    }
  }, [loading, isAuthenticated, user]);

  // Mostra loading enquanto verifica autenticação
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1A2332]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#C9A961]"></div>
          <p className="mt-4 text-gray-400">Verificando autenticação...</p>
        </div>
      </div>
    );
  }

  // Se não está autenticado, mostra tela de redirecionamento
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#1A2332]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#C9A961]"></div>
          <p className="mt-4 text-gray-400">Redirecionando para login...</p>
        </div>
      </div>
    );
  }

  // Se passou pela verificação, renderiza o conteúdo protegido
  return <>{children}</>;
}
