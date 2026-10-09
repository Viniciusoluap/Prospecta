import { TRPCError } from "@trpc/server";

export type Role = "admin" | "corretor" | "colaborador" | "cliente" | "user";

export const STAFF_ROLES: Role[] = ["admin", "corretor", "colaborador"];

export function hasRole(role: string | undefined, allowed: Role[]): boolean {
  // "user" era o perfil de cliente nas contas antigas. A migração de dados
  // o converte para "cliente", mas esta compatibilidade evita interrupção de
  // acesso durante a publicação da versão.
  const normalizedRole = role === "user" ? "cliente" : role;
  return !!normalizedRole && allowed.includes(normalizedRole as Role);
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
