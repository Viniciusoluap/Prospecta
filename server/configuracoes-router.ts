import { randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, count, eq, gt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { users } from "../drizzle/schema.js";
import { ADMIN_MODULES, normalizePermissions } from "../shared/admin-permissions.js";
import { tokenPrimeiroAcessoAindaValido } from "../shared/session.js";
import { hashPassword } from "./_core/auth-utils.js";
import { adminProcedure, publicProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";

const managedRole = z.enum(["admin", "corretor", "colaborador", "cliente"]);
const permissionsSchema = z.array(z.enum(ADMIN_MODULES)).max(ADMIN_MODULES.length);

const PRIMEIRO_ACESSO_VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;
const SITE_URL = "https://www.prospectaconstrucoes.com";

// Gera um token de primeiro acesso/redefinição de senha (7 dias) e envia o email para
// o usuário definir a própria senha — ela nunca passa pelo admin. Não lança se o envio
// falhar (fica registrado em email_logs com status "failed"); quem chama decide se
// avisa o admin.
async function enviarLinkDefinicaoSenha(
  userId: number,
  name: string,
  email: string,
  novoUsuario: boolean,
): Promise<boolean> {
  const token = randomBytes(32).toString("hex");
  const expiraEm = new Date(Date.now() + PRIMEIRO_ACESSO_VALIDADE_MS);
  await getDb().update(users).set({
    tokenPrimeiroAcesso: token,
    tokenPrimeiroAcessoExpiraEm: expiraEm,
    updatedAt: new Date(),
  }).where(eq(users.id, userId));

  const { sendEmail, primeiroAcessoTemplate } = await import("./_core/email-smtp.js");
  const template = primeiroAcessoTemplate({ name, link: `${SITE_URL}/definir-senha/${token}`, novoUsuario });
  return sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
    recipientName: name,
    templateType: "primeiro_acesso",
  });
}

async function ensureAnotherAdmin(userId: number) {
  const [result] = await getDb().select({ total: count() }).from(users)
    .where(and(eq(users.role, "admin"), eq(users.active, true), ne(users.id, userId)));
  if (!result?.total) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "O sistema precisa manter ao menos um administrador ativo" });
  }
}

export const configuracoesRouter = router({
  listUsers: adminProcedure.query(async () => getDb().select({
    id: users.id,
    name: users.name,
    email: users.email,
    phone: users.phone,
    creci: users.creci,
    role: users.role,
    active: users.active,
    permissions: users.permissions,
    lastSignedIn: users.lastSignedIn,
    createdAt: users.createdAt,
  }).from(users).orderBy(users.name)),

  // A senha inicial nunca é digitada pelo admin: cria a conta com um hash placeholder
  // inutilizável (ninguém consegue logar com ele) e manda um email pro próprio usuário
  // definir a senha real pelo link de primeiro acesso.
  createUser: adminProcedure.input(z.object({
    name: z.string().trim().min(2).max(255),
    email: z.string().trim().email().max(320),
    role: managedRole,
    phone: z.string().trim().max(20).optional().nullable(),
    creci: z.string().trim().max(40).optional().nullable(),
    permissions: permissionsSchema.default([]),
  })).mutation(async ({ input }) => {
    const db = getDb();
    const email = input.email.toLowerCase();
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "E-mail já cadastrado" });
    const [created] = await db.insert(users).values({
      openId: `admin:${email}`,
      name: input.name,
      email,
      passwordHash: hashPassword(randomBytes(32).toString("hex")),
      role: input.role,
      phone: input.phone || null,
      creci: input.creci || null,
      permissions: JSON.stringify(normalizePermissions(input.permissions)),
      loginMethod: "password",
      active: true,
    }).returning({ id: users.id });
    const emailEnviado = await enviarLinkDefinicaoSenha(created.id, input.name, email, true);
    return { ...created, emailEnviado };
  }),

  updateUser: adminProcedure.input(z.object({
    id: z.number().int().positive(),
    name: z.string().trim().min(2).max(255),
    role: managedRole,
    phone: z.string().trim().max(20).optional().nullable(),
    creci: z.string().trim().max(40).optional().nullable(),
    active: z.boolean(),
    permissions: permissionsSchema,
  })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const [current] = await db.select().from(users).where(eq(users.id, input.id)).limit(1);
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });
    if (input.id === ctx.user.id && (!input.active || input.role !== "admin")) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Você não pode remover seu próprio acesso administrativo" });
    }
    if (current.role === "admin" && current.active && (input.role !== "admin" || !input.active)) await ensureAnotherAdmin(input.id);
    const [updated] = await db.update(users).set({
      name: input.name,
      role: input.role,
      phone: input.phone || null,
      creci: input.creci || null,
      active: input.active,
      permissions: JSON.stringify(normalizePermissions(input.permissions)),
      updatedAt: new Date(),
    }).where(eq(users.id, input.id)).returning({ id: users.id });
    return updated;
  }),

  // O admin não digita mais a nova senha de outra pessoa: dispara um link de
  // redefinição por email, e o próprio usuário define a senha real. sessionVersion é
  // incrementado na hora (não só quando o link é usado) - qualquer sessão JWT já
  // emitida para este usuário (ex: alguém com acesso indevido) é invalidada
  // imediatamente, sem esperar o reset ser concluído - ver _core/context.ts / shared/session.ts.
  resetPassword: adminProcedure.input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const [current] = await getDb().select({ id: users.id, name: users.name, email: users.email })
        .from(users).where(eq(users.id, input.id)).limit(1);
      if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });
      if (!current.email) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Usuário sem email cadastrado - não é possível enviar o link" });

      await getDb().update(users).set({
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date(),
      }).where(eq(users.id, input.id));

      const emailEnviado = await enviarLinkDefinicaoSenha(current.id, current.name ?? "", current.email, false);
      return { id: current.id, emailEnviado };
    }),

  deleteUser: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    if (input.id === ctx.user.id) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Você não pode excluir sua própria conta" });
    const db = getDb();
    const [current] = await db.select().from(users).where(eq(users.id, input.id)).limit(1);
    if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });
    if (current.role === "admin" && current.active) await ensureAnotherAdmin(input.id);
    await db.delete(users).where(eq(users.id, input.id));
    return { success: true } as const;
  }),
});

// Router público (sem autenticação) para a página /definir-senha/:token — o usuário
// define a própria senha a partir do link enviado por email, sem nunca passar pelo
// admin. Mantido junto de configuracoesRouter porque compartilha a lógica de token.
export const primeiroAcessoRouter = router({
  validarToken: publicProcedure.input(z.object({ token: z.string().min(1) })).query(async ({ input }) => {
    const [usuario] = await getDb().select({ name: users.name, expiraEm: users.tokenPrimeiroAcessoExpiraEm })
      .from(users).where(eq(users.tokenPrimeiroAcesso, input.token)).limit(1);
    const valido = tokenPrimeiroAcessoAindaValido(usuario?.expiraEm);
    return { valido, nome: valido ? usuario!.name : null };
  }),

  definirSenha: publicProcedure.input(z.object({
    token: z.string().min(1),
    novaSenha: z.string().min(8).max(128),
  })).mutation(async ({ input }) => {
    const db = getDb();
    const [usuario] = await db.select({ id: users.id, expiraEm: users.tokenPrimeiroAcessoExpiraEm })
      .from(users).where(eq(users.tokenPrimeiroAcesso, input.token)).limit(1);
    if (!usuario || !tokenPrimeiroAcessoAindaValido(usuario.expiraEm)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Link inválido ou expirado" });
    }
    // Reivindica o token com guarda atômica (token ainda bate E ainda não expirou) —
    // evita reuso em corrida (duas abas enviando o mesmo link ao mesmo tempo).
    const [claimed] = await db.update(users).set({
      passwordHash: hashPassword(input.novaSenha),
      tokenPrimeiroAcesso: null,
      tokenPrimeiroAcessoExpiraEm: null,
      sessionVersion: sql`${users.sessionVersion} + 1`,
      updatedAt: new Date(),
    }).where(and(eq(users.id, usuario.id), eq(users.tokenPrimeiroAcesso, input.token), gt(users.tokenPrimeiroAcessoExpiraEm, new Date())))
      .returning({ id: users.id });
    if (!claimed) throw new TRPCError({ code: "BAD_REQUEST", message: "Link inválido ou expirado" });
    return { success: true } as const;
  }),
});
