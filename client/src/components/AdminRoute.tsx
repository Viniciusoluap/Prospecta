import { ReactNode, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import {
  AdminModule,
  parsePermissions,
} from "../../../shared/admin-permissions";

/** Item 06: corretor usa no painel só Agenda e WhatsApp (o resto fica no Portal do Corretor). */
const MODULOS_PAINEL_CORRETOR: readonly string[] = ["agenda", "whatsapp"];

function podeAbrir(user: { role?: string; permissions?: string | null; active?: boolean | null } | null | undefined, modulos: readonly string[], allowStaffHome: boolean) {
  if (!user || user.active === false) return false;
  if (user.role === "admin") return true;
  if (user.role === "corretor") return modulos.some((m) => MODULOS_PAINEL_CORRETOR.includes(m));
  if (user.role !== "colaborador") return false;
  const permissions = parsePermissions(user.permissions);
  return allowStaffHome || modulos.some((m) => permissions.includes(m as AdminModule));
}

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
    const allowed = podeAbrir(user, modules ?? (module ? [module] : []), allowStaffHome);
    if (!loading && user && !allowed) {
      // Cada perfil volta para a própria área (item 02).
      setLocation(
        user.role === "colaborador" ? "/admin/acesso"
          : user.role === "corretor" ? "/corretor"
          : user.role === "empreiteiro" ? "/empreiteiro"
          : user.role === "cliente" || user.role === "user" ? "/portal" : "/",
      );
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

  const allowed = podeAbrir(user, modules ?? (module ? [module] : []), allowStaffHome);
  if (!user || !allowed) {
    return null;
  }

  // Se autenticado E é admin, renderiza o conteúdo protegido
  return <>{children}</>;
}
