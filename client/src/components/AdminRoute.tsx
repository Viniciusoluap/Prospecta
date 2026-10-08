import { ReactNode, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import {
  AdminModule,
  parsePermissions,
} from "../../../shared/admin-permissions";

interface AdminRouteProps {
  children: ReactNode;
  module?: AdminModule;
  modules?: AdminModule[];
  allowStaffHome?: boolean;
}

/**
 * Componente que protege rotas administrativas.
 * Requer autenticação E role === 'admin'.
 * Redireciona para login se não autenticado, ou para home se não for admin.
 */
export function AdminRoute({
  children,
  module,
  modules,
  allowStaffHome = false,
}: AdminRouteProps) {
  // Usa opção redirectOnUnauthenticated para redirecionar automaticamente se não autenticado
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true });
  const [, setLocation] = useLocation();

  useEffect(() => {
    const staff = user?.role === "corretor" || user?.role === "colaborador";
    const permissions = parsePermissions(user?.permissions);
    const allowedModules = modules ?? (module ? [module] : []);
    const allowed =
      user?.role === "admin" ||
      (staff &&
        (allowStaffHome ||
          allowedModules.some(item => permissions.includes(item))));
    if (!loading && user && !allowed) {
      setLocation(staff ? "/admin/acesso" : "/");
    }
  }, [allowStaffHome, loading, module, modules, user, setLocation]);

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

  const staff = user?.role === "corretor" || user?.role === "colaborador";
  const permissions = parsePermissions(user?.permissions);
  const allowedModules = modules ?? (module ? [module] : []);
  const allowed =
    user?.role === "admin" ||
    (staff &&
      (allowStaffHome ||
        allowedModules.some(item => permissions.includes(item))));
  if (!user || !allowed) {
    return null;
  }

  // Se autenticado E é admin, renderiza o conteúdo protegido
  return <>{children}</>;
}
