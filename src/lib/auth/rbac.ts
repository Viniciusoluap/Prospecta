import { redirect } from "next/navigation";
import type { Session } from "next-auth";

export type Role = "admin" | "corretor" | "colaborador" | "cliente";

export const ADMIN_ONLY_PATHS = [
  "/admin/corretores",
  "/admin/obras",
  "/admin/projetos",
  "/admin/regularizacao",
  "/admin/relatorios",
  "/admin/feeds",
  "/admin/contratos",
  "/admin/configuracoes",
  "/admin/agregador",
] as const;

export function getSessionRole(session: Session | null): Role | null {
  if (!session) return null;
  const role = (session.user as { role?: string })?.role;
  return role === "admin" || role === "corretor" || role === "colaborador" || role === "cliente"
    ? role
    : null;
}

export function hasRole(session: Session | null, ...roles: Role[]): boolean {
  const role = getSessionRole(session);
  if (!role) return false;
  return roles.includes(role);
}

export function requirePageRole(session: Session | null, ...roles: Role[]): void {
  if (!hasRole(session, ...roles)) {
    redirect("/admin");
  }
}

export function requireActionRole(session: Session | null, ...roles: Role[]): void {
  if (!session) throw new Error("Não autorizado");
  if (!hasRole(session, ...roles)) throw new Error("Não autorizado");
}

export function canAccessAdminPath(session: Session | null, pathname: string): boolean {
  const role = getSessionRole(session);
  if (!role || role === "cliente") return false;
  if (ADMIN_ONLY_PATHS.some((path) => pathname.startsWith(path))) return role === "admin";
  return true;
}

export function apiRoleError(session: Session | null, ...roles: Role[]): Response | null {
  if (!session) return Response.json({ error: "Não autorizado." }, { status: 401 });
  if (!hasRole(session, ...roles)) {
    return Response.json({ error: "Acesso negado." }, { status: 403 });
  }
  return null;
}
