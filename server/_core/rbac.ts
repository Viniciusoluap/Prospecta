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

/**
 * Módulo do painel de cada destino de serviço do CRM (`operationalModule`) e de
 * cada exclusão definitiva. Revisão do Codex no PR #130: o que o serviço cria,
 * altera ou exclui em outro módulo exige a permissão daquele módulo.
 */
export const MODULO_DO_DESTINO: Readonly<Record<string, AdminModule>> = {
  obras: "obras", obra: "obras",
  projetos: "projetos", projeto: "projetos",
  regularizacoes: "regularizacao", regularizacao: "regularizacao",
  financiamentos: "financiamentos", financiamento: "financiamentos",
  avaliacoes: "avaliacoes", avaliacao: "avaliacoes",
  comissoes: "comissoes", comissao: "comissoes",
  tarefas: "agenda",
  juridico: "juridico",
  bpo_financeiro: "bpo",
  estudo: "incorporacao",
};

/** Exige o módulo do destino (sem módulo conhecido, basta o acesso já checado). */
export function requireModuloDoDestino(
  ctx: { user: { role: string; permissions?: string | null; active?: boolean | null } },
  destino: string | null | undefined
): void {
  const modulo = MODULO_DO_DESTINO[destino ?? ""];
  if (modulo) requireModule(ctx, modulo);
}

/**
 * Operações em lote (importação do Trello, reconciliação) podem criar ou
 * reclassificar serviço para qualquer destino: exigem o CRM e todos os módulos
 * de destino do mapa acima.
 */
export function requireTodosOsModulosDeServico(
  ctx: { user: { role: string; permissions?: string | null; active?: boolean | null } }
): void {
  for (const m of Array.from(new Set<AdminModule>(["crm", ...Object.values(MODULO_DO_DESTINO)]))) requireModule(ctx, m);
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
