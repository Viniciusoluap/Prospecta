import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '../../shared/const.js';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context.js";
import { parsePermissions, type AdminModule } from "../../shared/admin-permissions.js";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
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

const procedureModules: Record<string, AdminModule> = {
  construction: "obras", budgetRequests: "projetos", analytics: "dashboard", emails: "dashboard",
  leads: "crm", tasks: "dashboard", brokerCommissions: "corretores", obraMedicoes: "obras",
  financialTransactions: "contabilidade", bpo: "bpo", pluggySettings: "banco", bancario: "banco",
  imoveis: "imoveis", avaliacoes: "avaliacoes", agregador: "agregador", incorporacao: "projetos",
  regularizacao: "regularizacao", portal: "crm", whatsapp: "whatsapp", financiamentos: "financiamentos",
  juridico: "juridico",
};

export function canAccessAdminProcedure(user: { role: string; permissions?: string | null }, path: string): boolean {
  if (user.role === "admin") return true;
  if (user.role !== "corretor" && user.role !== "colaborador") return false;
  const requiredModule = procedureModules[path.split(".")[0]];
  return !!requiredModule && parsePermissions(user.permissions).includes(requiredModule);
}

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    if (!canAccessAdminProcedure(ctx.user, opts.path)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para este módulo" });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
