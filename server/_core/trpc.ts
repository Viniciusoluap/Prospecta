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

/**
 * Módulo exigido do colaborador em cada router (pedido de 17/10/2026). Lista
 * vazia = tela comum do painel, aberta a qualquer colaborador ativo. Router fora
 * do mapa (integração bancária, configurações de pagamento, usuários e acessos,
 * Google Drive) é só do admin.
 */
const procedureModules: Record<string, AdminModule | AdminModule[]> = {
  draws: "sorteios",
  products: "sorteios",
  construction: "obras",
  obraMedicoes: "obras",
  obraFinanceiro: "obras",
  obraProgresso: "obras",
  budgetRequests: "projetos",
  analytics: [],
  emails: [],
  leads: "crm",
  portal: "crm",
  leadServices: "crm",
  leadDocuments: "crm",
  tasks: "agenda",
  agenda: "agenda",
  brokerCommissions: "comissoes",
  comissoes: "comissoes",
  financialTransactions: "bpo",
  bpo: "bpo",
  relatorios: "bpo",
  tax: "bpo",
  imoveis: "imoveis",
  agregador: "imoveis",
  avaliacoes: "avaliacoes",
  incorporacao: "incorporacao",
  regularizacao: "regularizacao",
  whatsapp: "whatsapp",
  financiamentos: "financiamentos",
  juridico: "juridico",
  corretores: "corretores",
  projetos: "projetos",
  mapa: "mapa",
};

/** A fila de serviços do CRM aparece dentro de cada módulo operacional. */
const MODULOS_DA_FILA_DO_CRM: AdminModule[] = [
  "crm", "obras", "agenda", "regularizacao", "comissoes", "projetos", "avaliacoes", "financiamentos",
];
const procedimentoModules: Record<string, AdminModule[]> = {
  "leadServices.listForModule": MODULOS_DA_FILA_DO_CRM,
  "leadServices.materializePending": MODULOS_DA_FILA_DO_CRM,
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
  const requiredModule = procedimentoModules[path] ?? procedureModules[routerName];
  if (requiredModule === undefined) return false;
  const requiredModules = Array.isArray(requiredModule) ? requiredModule : [requiredModule];
  return requiredModules.length === 0 || podeAcessarAlgum(acesso, requiredModules);
}

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    // Portal do Empreiteiro (15/10): procedimentos de obra liberados só nas obras dele.
    const empreiteiroLiberado =
      ctx.user.role === "empreiteiro" && (ctx.user.active ?? true) &&
      (await (await import("../obra-acesso.js")).autorizarEmpreiteiro(ctx.user.id, opts.path, await opts.getRawInput()));

    if (!empreiteiroLiberado && !canAccessAdminProcedure(ctx.user, opts.path)) {
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
