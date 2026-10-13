import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "../../shared/const.js";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { mensagemValidacao } from "../../shared/erro-validacao.js";
import { podeAcessarAlgum } from "../../shared/perfis-acesso.js";
import type { TrpcContext } from "./context.js";
import {
  parsePermissions,
  type AdminModule,
} from "../../shared/admin-permissions.js";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  // Item 07: erros de validação chegam ao usuário como frase, nunca como JSON técnico.
  errorFormatter({ shape, error }) {
    if (error.code === "BAD_REQUEST" && error.cause instanceof ZodError) {
      return { ...shape, message: mensagemValidacao(error.cause.issues as never) };
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

const procedureModules: Record<string, AdminModule | AdminModule[]> = {
  construction: "obras",
  budgetRequests: "projetos",
  analytics: "dashboard",
  emails: "dashboard",
  leads: "crm",
  tasks: ["dashboard", "agenda"],
  brokerCommissions: "comissoes",
  obraMedicoes: "obras",
  financialTransactions: ["bpo", "contabilidade"],
  bpo: ["bpo", "contabilidade", "relatorios"],
  pluggySettings: "banco",
  bancario: "banco",
  imoveis: ["imoveis", "agregador"],
  avaliacoes: "avaliacoes",
  agregador: ["imoveis", "agregador"],
  incorporacao: "projetos",
  regularizacao: "regularizacao",
  portal: "crm",
  whatsapp: "whatsapp",
  financiamentos: "financiamentos",
  juridico: "juridico",
  relatorios: ["bpo", "contabilidade", "relatorios"],
  tax: ["bpo", "contabilidade", "relatorios"],
  agenda: ["agenda", "dashboard"],
  corretores: "corretores",
  comissoes: "comissoes",
  projetos: "projetos",
  mapa: "mapa",
};

/**
 * Item 06 (regra comum em shared/perfis-acesso.ts): admin tudo; colaborador só os
 * módulos liberados; corretor, no painel, só Agenda e WhatsApp com os próprios
 * registros (Imóveis e Minhas Comissões ficam no Portal do Corretor, já
 * restrito a ele); cliente, empreiteiro e contas inativas, nada.
 */
const ROUTERS_DO_CORRETOR = new Set(["agenda", "whatsapp"]);

export function canAccessAdminProcedure(
  user: { role: string; permissions?: string | null; active?: boolean | null },
  path: string
): boolean {
  const acesso = { perfil: user.role, ativo: user.active ?? true, permissoes: parsePermissions(user.permissions) };
  if (!acesso.ativo) return false;
  const routerName = path.split(".")[0];
  if (user.role === "admin") return true;
  if (user.role === "corretor") return ROUTERS_DO_CORRETOR.has(routerName);
  if (user.role !== "colaborador") return false;
  const requiredModule = procedureModules[routerName];
  const requiredModules = Array.isArray(requiredModule)
    ? requiredModule
    : requiredModule
      ? [requiredModule]
      : [];
  return podeAcessarAlgum(acesso, requiredModules);
}

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    if (!canAccessAdminProcedure(ctx.user, opts.path)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Sem permissão para este módulo",
      });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  })
);
