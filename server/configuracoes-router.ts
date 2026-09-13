import { TRPCError } from "@trpc/server";
import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { users } from "../drizzle/schema.js";
import { ADMIN_MODULES, normalizePermissions } from "../shared/admin-permissions.js";
import { hashPassword } from "./_core/auth-utils.js";
import { adminProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";

const managedRole = z.enum(["admin", "corretor", "colaborador", "cliente"]);
const permissionsSchema = z.array(z.enum(ADMIN_MODULES)).max(ADMIN_MODULES.length);

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

  createUser: adminProcedure.input(z.object({
    name: z.string().trim().min(2).max(255),
    email: z.string().trim().email().max(320),
    password: z.string().min(8).max(128),
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
      passwordHash: hashPassword(input.password),
      role: input.role,
      phone: input.phone || null,
      creci: input.creci || null,
      permissions: JSON.stringify(normalizePermissions(input.permissions)),
      loginMethod: "password",
      active: true,
    }).returning({ id: users.id });
    return created;
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

  resetPassword: adminProcedure.input(z.object({ id: z.number().int().positive(), password: z.string().min(8).max(128) }))
    .mutation(async ({ input }) => {
      const [updated] = await getDb().update(users).set({ passwordHash: hashPassword(input.password), updatedAt: new Date() })
        .where(eq(users.id, input.id)).returning({ id: users.id });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Usuário não encontrado" });
      return updated;
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
