import { TRPCError } from "@trpc/server";

export type Role = "admin" | "corretor" | "colaborador" | "cliente";

export const STAFF_ROLES: Role[] = ["admin", "corretor", "colaborador"];

export function hasRole(role: string | undefined, allowed: Role[]): boolean {
  return !!role && allowed.includes(role as Role);
}

export function requireRole(
  ctx: { user: { role: string } },
  allowed: Role[],
  message = "Acesso negado"
): void {
  if (!hasRole(ctx.user.role, allowed)) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
}
