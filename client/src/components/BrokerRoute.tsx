import type { ReactNode } from "react";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";

export function BrokerRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: "/login?perfil=corretor",
  });
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && user && user.role !== "corretor") {
      navigate(
        user.role === "admin"
          ? "/admin"
          : user.role === "cliente"
            ? "/portal"
            : "/"
      );
    }
  }, [loading, navigate, user]);

  if (loading)
    return (
      <div className="min-h-screen grid place-items-center bg-[#1A2332] text-[#C9A961]">
        Verificando acesso...
      </div>
    );
  if (!user || user.role !== "corretor") return null;
  return <>{children}</>;
}
