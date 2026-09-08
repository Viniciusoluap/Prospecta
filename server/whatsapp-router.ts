import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { leads, users, whatsappConnections, whatsappMessages } from "../drizzle/schema.js";
import { enviarWhatsappBusiness, normalizarStatusWebhook } from "./_core/whatsapp-business.js";
import { decryptSecret, encryptSecret } from "./_core/secret-vault.js";
import { requireRole, STAFF_ROLES } from "./_core/rbac.js";
import { protectedProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";

async function conexaoParaPapel(userId: number, role: string) {
  const db = getDb();
  if (role === "colaborador") {
    const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
    if (!admin) return null;
    const [conn] = await db.select().from(whatsappConnections).where(eq(whatsappConnections.userId, admin.id)).limit(1);
    return conn ?? null;
  }
  const [conn] = await db.select().from(whatsappConnections).where(eq(whatsappConnections.userId, userId)).limit(1);
  return conn ?? null;
}

export const whatsappRouter = router({
  minhaConexao: protectedProcedure.query(async ({ ctx }) => {
    requireRole(ctx, STAFF_ROLES);
    const conn = await conexaoParaPapel(ctx.user.id, ctx.user.role);
    if (!conn) return null;
    return { id: conn.id, numero: conn.numero, status: conn.status };
  }),

  conexoesCorretores: protectedProcedure.query(async ({ ctx }) => {
    requireRole(ctx, ["admin"]);
    const db = getDb();
    const corretores = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "corretor"));
    if (corretores.length === 0) return [];
    const conns = await db.select().from(whatsappConnections).where(inArray(whatsappConnections.userId, corretores.map((c) => c.id)));
    return corretores.map((c) => {
      const conn = conns.find((x) => x.userId === c.id);
      return { userId: c.id, nome: c.name ?? "(sem nome)", numero: conn?.numero ?? null, status: conn?.status ?? "desconectado" };
    });
  }),

  leadsParaEnvio: protectedProcedure.query(async ({ ctx }) => {
    requireRole(ctx, STAFF_ROLES);
    return getDb().select({ id: leads.id, name: leads.name, phone: leads.phone }).from(leads).orderBy(desc(leads.createdAt));
  }),

  historico: protectedProcedure.query(async ({ ctx }) => {
    requireRole(ctx, STAFF_ROLES);
    const db = getDb();
    if (ctx.user.role === "admin") {
      return db.select().from(whatsappMessages).orderBy(desc(whatsappMessages.createdAt)).limit(100);
    }
    const conn = await conexaoParaPapel(ctx.user.id, ctx.user.role);
    if (!conn) return [];
    return db.select().from(whatsappMessages).where(eq(whatsappMessages.connectionId, conn.id)).orderBy(desc(whatsappMessages.createdAt)).limit(100);
  }),

  salvarConexao: protectedProcedure
    .input(z.object({ token: z.string().min(1), phoneNumberId: z.string().min(1), numero: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["admin", "corretor"]);
      const db = getDb();
      const tokenEncrypted = encryptSecret(input.token);
      const [existing] = await db.select({ id: whatsappConnections.id }).from(whatsappConnections).where(eq(whatsappConnections.userId, ctx.user.id)).limit(1);
      if (existing) {
        await db.update(whatsappConnections)
          .set({ provider: "business", tokenEncrypted, phoneNumberId: input.phoneNumberId, numero: input.numero, status: "conectado", updatedAt: new Date() })
          .where(eq(whatsappConnections.id, existing.id));
      } else {
        await db.insert(whatsappConnections).values({
          userId: ctx.user.id, provider: "business", tokenEncrypted,
          phoneNumberId: input.phoneNumberId, numero: input.numero, status: "conectado",
        });
      }
      return { success: true };
    }),

  desconectar: protectedProcedure.mutation(async ({ ctx }) => {
    requireRole(ctx, ["admin", "corretor"]);
    await getDb().delete(whatsappConnections).where(eq(whatsappConnections.userId, ctx.user.id));
    return { success: true };
  }),

  enviar: protectedProcedure
    .input(z.object({
      mensagem: z.string().trim().min(1).max(4096),
      destinatarios: z.array(z.object({ id: z.number(), nome: z.string(), telefone: z.string() })).min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, STAFF_ROLES);
      const db = getDb();
      const conn = await conexaoParaPapel(ctx.user.id, ctx.user.role);
      if (!conn || conn.status !== "conectado") {
        return { success: false, error: "Nenhuma conexão WhatsApp Business ativa", enviadas: 0, falhas: 0 };
      }
      if (!conn.tokenEncrypted || !conn.phoneNumberId) {
        return { success: false, error: "Credenciais da Business API não configuradas", enviadas: 0, falhas: 0 };
      }
      const token = decryptSecret(conn.tokenEncrypted);

      let enviadas = 0;
      let falhas = 0;
      for (const dest of input.destinatarios) {
        try {
          const externalId = await enviarWhatsappBusiness(token, conn.phoneNumberId, dest.telefone, input.mensagem);
          await db.insert(whatsappMessages).values({
            connectionId: conn.id, leadId: dest.id, destinatario: dest.telefone, nomeDestinatario: dest.nome,
            mensagem: input.mensagem, externalId, status: externalId ? "enviada" : "falhou",
          });
          if (externalId) enviadas++; else falhas++;
        } catch {
          await db.insert(whatsappMessages).values({
            connectionId: conn.id, leadId: dest.id, destinatario: dest.telefone, nomeDestinatario: dest.nome,
            mensagem: input.mensagem, status: "falhou", erroMsg: "Erro ao enviar",
          });
          falhas++;
        }
      }
      return { success: true, enviadas, falhas };
    }),
});

/** Aplica um evento de status recebido do webhook do WhatsApp Business a uma mensagem existente. */
export async function aplicarStatusWebhook(externalId: string, rawStatus: string | undefined): Promise<void> {
  const status = normalizarStatusWebhook(rawStatus);
  await getDb().update(whatsappMessages).set({ status, updatedAt: new Date() }).where(eq(whatsappMessages.externalId, externalId));
}
