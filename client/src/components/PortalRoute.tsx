import type { ReactNode } from "react";
import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";

export function PortalRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true, redirectPath: "/login" });
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && user && user.role !== "cliente") navigate(user.role === "admin" ? "/admin" : "/");
  }, [loading, navigate, user]);

  if (loading) return <div className="min-h-screen grid place-items-center bg-[#1A2332] text-[#C9A961]">Verificando acesso...</div>;
  if (!user || user.role !== "cliente") return null;
  return <>{children}</>;
}
