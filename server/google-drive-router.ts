import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { requireRole } from "./_core/rbac.js";
import { protectedProcedure, router } from "./_core/trpc.js";
import { origemDaRequisicao } from "../shared/google-drive-oauth.js";
import { desconectarOAuth, estadoOAuth, salvarCredencialOAuth } from "./google-drive-oauth.js";
import { diagnosticarDrive } from "./drive-documents.js";

// Configurações → Google Drive (só administrador). O JSON do cliente OAuth chega
// aqui, é validado e guardado criptografado; o arquivo nunca é devolvido à tela.
const origem = (req: { get(nome: string): string | undefined }) => origemDaRequisicao(req.get("x-forwarded-host") ?? req.get("host"));

export const googleDriveRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    requireRole(ctx, ["admin"]);
    return estadoOAuth(origem(ctx.req));
  }),
  salvarCredencial: protectedProcedure.input(z.object({ json: z.string().min(2).max(20_000) })).mutation(async ({ ctx, input }) => {
    requireRole(ctx, ["admin"]);
    try { return await salvarCredencialOAuth(input.json, ctx.user!.id, origem(ctx.req)); }
    catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "JSON inválido" }); }
  }),
  desconectar: protectedProcedure.mutation(async ({ ctx }) => {
    requireRole(ctx, ["admin"]);
    await desconectarOAuth(ctx.user!.id);
    return { success: true };
  }),
  testar: protectedProcedure.mutation(async ({ ctx }) => {
    requireRole(ctx, ["admin"]);
    return diagnosticarDrive();
  }),
});
