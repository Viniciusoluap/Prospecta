import { TRPCError } from "@trpc/server";
import { parsePermissions, type AdminModule } from "../../shared/admin-permissions.js";

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

/**
 * Pedido de 17/10/2026: o colaborador faz tudo o que o admin faz nos módulos que
 * o admin liberou. `modulos` vazio = qualquer admin ou colaborador ativo (telas
 * comuns do painel). O admin passa sempre; os demais perfis, nunca.
 */
export function requireModule(
  ctx: { user: { role: string; permissions?: string | null; active?: boolean | null } },
  modulos: AdminModule | readonly AdminModule[],
  message = "Sem permissão para este módulo"
): void {
  if (!podeUsarModulo(ctx.user, modulos)) throw new TRPCError({ code: "FORBIDDEN", message });
}

export function podeUsarModulo(
  user: { role: string; permissions?: string | null; active?: boolean | null },
  modulos: AdminModule | readonly AdminModule[]
): boolean {
  if (user.active === false) return false;
  if (user.role === "admin") return true;
  if (user.role !== "colaborador") return false;
  const lista: readonly AdminModule[] = typeof modulos === "string" ? [modulos] : modulos;
  if (lista.length === 0) return true;
  const permissoes = parsePermissions(user.permissions);
  return lista.some((m) => permissoes.includes(m));
}
