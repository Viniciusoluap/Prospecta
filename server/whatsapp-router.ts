import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { leads, users, whatsappConnections, whatsappMessages } from "../drizzle/schema.js";
import { enviarWhatsappBusiness, normalizarStatusWebhook } from "./_core/whatsapp-business.js";
import { decryptSecret, encryptSecret } from "./_core/secret-vault.js";
import { requireRole } from "./_core/rbac.js";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc.js";
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
  minhaConexao: adminProcedure.query(async ({ ctx }) => {
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

  // Item 06: corretor só vê os próprios leads.
  leadsParaEnvio: adminProcedure.query(async ({ ctx }) => {
    const q = getDb().select({ id: leads.id, name: leads.name, phone: leads.phone }).from(leads);
    return (ctx.user.role === "corretor" ? q.where(eq(leads.brokerId, ctx.user.id)) : q).orderBy(desc(leads.createdAt));
  }),

  historico: adminProcedure.query(async ({ ctx }) => {
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

  enviar: adminProcedure
    .input(z.object({
      mensagem: z.string().trim().min(1).max(4096),
      destinatarios: z.array(z.object({ id: z.number(), nome: z.string(), telefone: z.string() })).min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const conn = await conexaoParaPapel(ctx.user.id, ctx.user.role);
      if (!conn || conn.status !== "conectado") {
        return { success: false, error: "Nenhuma conexão WhatsApp Business ativa", enviadas: 0, falhas: 0 };
      }
      if (!conn.tokenEncrypted || !conn.phoneNumberId) {
        return { success: false, error: "Credenciais da Business API não configuradas", enviadas: 0, falhas: 0 };
      }
      const token = decryptSecret(conn.tokenEncrypted);
      // Item 06 + revisão do Codex (PR #111): nome e telefone vêm sempre do
      // cadastro do lead, nunca do corpo da requisição (como no Santa Fé); o
      // corretor só envia para os próprios leads.
      const ids = Array.from(new Set(input.destinatarios.map((d) => d.id)));
      const ehCorretor = ctx.user.role === "corretor";
      const cadastrados = await db.select({ id: leads.id, nome: leads.name, telefone: leads.phone }).from(leads)
        .where(and(inArray(leads.id, ids), isNull(leads.deletedAt), ehCorretor ? eq(leads.brokerId, ctx.user.id) : undefined));
      if (ehCorretor && cadastrados.length !== ids.length) return { success: false, error: "Destinatário fora dos seus leads", enviadas: 0, falhas: 0 };
      const destinatarios = cadastrados;
      if (destinatarios.length === 0) return { success: false, error: "Nenhum destinatário válido (lead inexistente ou não pertence a você)", enviadas: 0, falhas: 0 };

      let enviadas = 0;
      let falhas = 0;
      for (const dest of destinatarios) {
        try {
          const externalId = await enviarWhatsappBusiness(token, conn.phoneNumberId, dest.telefone ?? "", input.mensagem);
          await db.insert(whatsappMessages).values({
            connectionId: conn.id, leadId: dest.id, destinatario: dest.telefone ?? "", nomeDestinatario: dest.nome,
            mensagem: input.mensagem, externalId, status: externalId ? "enviada" : "falhou",
          });
          if (externalId) enviadas++; else falhas++;
        } catch {
          await db.insert(whatsappMessages).values({
            connectionId: conn.id, leadId: dest.id, destinatario: dest.telefone ?? "", nomeDestinatario: dest.nome,
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
