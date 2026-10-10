import type { ReactNode } from "react";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";

const isClientRole = (role?: string) => role === "cliente" || role === "user";

export function PortalRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: "/login?perfil=cliente",
  });
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && user && !isClientRole(user.role))
      navigate(
        user.role === "admin"
          ? "/admin"
          : user.role === "corretor"
            ? "/corretor"
            : "/"
      );
  }, [loading, navigate, user]);

  if (loading)
    return (
      <div className="min-h-screen grid place-items-center bg-[#1A2332] text-[#C9A961]">
        Verificando acesso...
      </div>
    );
  if (!user || !isClientRole(user.role)) return null;
  return <>{children}</>;
}
