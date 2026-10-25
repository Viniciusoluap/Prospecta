import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { leads, users, whatsappConnections, whatsappEvolutionSettings, whatsappMessages } from "../drizzle/schema.js";
import { enviarWhatsappBusiness, normalizarStatusWebhook } from "./_core/whatsapp-business.js";
import { decryptSecret, encryptSecret, segredoEmTextoPuro } from "./_core/secret-vault.js";
import {
  enviarTextoEvolution, estadoInstancia, gerarQrCode, numeroConectado, removerInstancia, testarEvolution,
  type EvolutionConfig,
} from "./_core/evolution.js";
import { requireModule } from "./_core/rbac.js";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";

/** Dono da conexão: o colaborador usa (e configura) a conexão da empresa, que é a do admin. */
async function donoDaConexao(userId: number, role: string): Promise<number | null> {
  if (role !== "colaborador") return userId;
  const [admin] = await getDb().select({ id: users.id }).from(users).where(eq(users.role, "admin")).orderBy(users.id).limit(1);
  return admin?.id ?? null;
}

async function conexaoParaPapel(userId: number, role: string) {
  const dono = await donoDaConexao(userId, role);
  if (!dono) return null;
  const [conn] = await getDb().select().from(whatsappConnections).where(eq(whatsappConnections.userId, dono)).limit(1);
  return conn ?? null;
}

/** Servidor da Evolution (QR code): o salvo pela tela tem precedência; variáveis de ambiente são o reserva. */
export async function configEvolution(): Promise<EvolutionConfig | null> {
  const db = getDb();
  const [s] = await db.select().from(whatsappEvolutionSettings).where(eq(whatsappEvolutionSettings.id, 1)).limit(1);
  if (s) {
    const apiKey = decryptSecret(s.apiKeyEncrypted);
    if (segredoEmTextoPuro(s.apiKeyEncrypted)) {
      await db.update(whatsappEvolutionSettings).set({ apiKeyEncrypted: encryptSecret(apiKey) }).where(eq(whatsappEvolutionSettings.id, 1));
    }
    return { url: s.url, apiKey };
  }
  const url = process.env.EVOLUTION_API_URL, apiKey = process.env.EVOLUTION_API_KEY;
  return url && apiKey ? { url, apiKey } : null;
}

async function exigirEvolution(): Promise<EvolutionConfig> {
  const c = await configEvolution();
  if (!c) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe primeiro o endereço e a chave do servidor da Evolution (Railway)." });
  return c;
}

const erroEvolution = (e: unknown) =>
  e instanceof TRPCError ? e : new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Falha na Evolution." });

export const whatsappRouter = router({
  minhaConexao: adminProcedure.query(async ({ ctx }) => {
    const conn = await conexaoParaPapel(ctx.user.id, ctx.user.role);
    if (!conn) return null;
    return { id: conn.id, numero: conn.numero, status: conn.status, provider: conn.provider };
  }),

  // ── Pedido de 25/10: conexão por QR code (Evolution API) ──
  evolutionStatus: adminProcedure.query(async () => {
    const [s] = await getDb().select({ url: whatsappEvolutionSettings.url }).from(whatsappEvolutionSettings).limit(1);
    return { configurado: Boolean(s) || Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY), url: s?.url ?? null };
  }),

  salvarEvolution: protectedProcedure
    .input(z.object({ url: z.string().trim().url("Endereço inválido (comece com https://)"), apiKey: z.string().trim().min(8) }))
    .mutation(async ({ ctx, input }) => {
      requireModule(ctx, "whatsapp");
      if (ctx.user.role === "corretor") throw new TRPCError({ code: "FORBIDDEN", message: "Só a equipe configura o servidor." });
      try { await testarEvolution(input); } catch (e) { throw erroEvolution(e); }
      const db = getDb();
      const valores = { url: input.url.replace(/\/+$/, ""), apiKeyEncrypted: encryptSecret(input.apiKey), updatedAt: new Date() };
      await db.insert(whatsappEvolutionSettings).values({ id: 1, ...valores })
        .onConflictDoUpdate({ target: whatsappEvolutionSettings.id, set: valores });
      return { success: true };
    }),

  /** Gera (ou renova) o QR code da conexão do usuário — a da empresa para admin/colaborador. */
  conectarQr: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.role !== "corretor") requireModule(ctx, "whatsapp");
    const dono = await donoDaConexao(ctx.user.id, ctx.user.role);
    if (!dono) throw new TRPCError({ code: "BAD_REQUEST", message: "Nenhum administrador para guardar a conexão da empresa" });
    const c = await exigirEvolution();
    const instancia = `prospecta-u${dono}`;
    try {
      const r = await gerarQrCode(c, instancia);
      const status = r.estado === "open" ? "conectado" : "aguardando_qr";
      const numero = r.estado === "open" ? await numeroConectado(c, instancia).catch(() => null) : null;
      const db = getDb();
      const [existing] = await db.select({ id: whatsappConnections.id }).from(whatsappConnections).where(eq(whatsappConnections.userId, dono)).limit(1);
      const dados = { provider: "evolution", instancia, status, tokenEncrypted: null, phoneNumberId: null, ...(numero ? { numero } : {}), updatedAt: new Date() };
      if (existing) await db.update(whatsappConnections).set(dados).where(eq(whatsappConnections.id, existing.id));
      else await db.insert(whatsappConnections).values({ userId: dono, ...dados });
      return { qrCode: r.qrCode, status };
    } catch (e) { throw erroEvolution(e); }
  }),

  /** Consultado a cada poucos segundos enquanto o QR está na tela. */
  statusQr: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "corretor") requireModule(ctx, "whatsapp");
    const conn = await conexaoParaPapel(ctx.user.id, ctx.user.role);
    if (!conn || conn.provider !== "evolution" || !conn.instancia) return { status: conn?.status ?? "desconectado", numero: conn?.numero ?? null };
    const c = await configEvolution();
    if (!c) return { status: conn.status, numero: conn.numero };
    const estado = await estadoInstancia(c, conn.instancia).catch(() => null);
    if (!estado) return { status: conn.status, numero: conn.numero };
    const status = estado === "open" ? "conectado" : estado === "connecting" ? "aguardando_qr" : "desconectado";
    let numero = conn.numero;
    if (status !== conn.status || (status === "conectado" && !numero)) {
      if (status === "conectado") numero = (await numeroConectado(c, conn.instancia).catch(() => null)) ?? numero;
      await getDb().update(whatsappConnections).set({ status, numero, updatedAt: new Date() }).where(eq(whatsappConnections.id, conn.id));
    }
    return { status, numero };
  }),

  conexoesCorretores: protectedProcedure.query(async ({ ctx }) => {
    requireModule(ctx, "whatsapp");
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
    if (ctx.user.role === "admin" || ctx.user.role === "colaborador") {
      return db.select().from(whatsappMessages).orderBy(desc(whatsappMessages.createdAt)).limit(100);
    }
    const conn = await conexaoParaPapel(ctx.user.id, ctx.user.role);
    if (!conn) return [];
    return db.select().from(whatsappMessages).where(eq(whatsappMessages.connectionId, conn.id)).orderBy(desc(whatsappMessages.createdAt)).limit(100);
  }),

  salvarConexao: protectedProcedure
    .input(z.object({ token: z.string().min(1), phoneNumberId: z.string().min(1), numero: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "corretor") requireModule(ctx, "whatsapp");
      const dono = await donoDaConexao(ctx.user.id, ctx.user.role);
      if (!dono) throw new TRPCError({ code: "BAD_REQUEST", message: "Nenhum administrador para guardar a conexão da empresa" });
      const db = getDb();
      const tokenEncrypted = encryptSecret(input.token);
      const [existing] = await db.select({ id: whatsappConnections.id }).from(whatsappConnections).where(eq(whatsappConnections.userId, dono)).limit(1);
      if (existing) {
        await db.update(whatsappConnections)
          .set({ provider: "business", tokenEncrypted, phoneNumberId: input.phoneNumberId, numero: input.numero, status: "conectado", updatedAt: new Date() })
          .where(eq(whatsappConnections.id, existing.id));
      } else {
        await db.insert(whatsappConnections).values({
          userId: dono, provider: "business", tokenEncrypted,
          phoneNumberId: input.phoneNumberId, numero: input.numero, status: "conectado",
        });
      }
      return { success: true };
    }),

  desconectar: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.role !== "corretor") requireModule(ctx, "whatsapp");
    const dono = await donoDaConexao(ctx.user.id, ctx.user.role);
    if (!dono) return { success: true };
    const [conn] = await getDb().select().from(whatsappConnections).where(eq(whatsappConnections.userId, dono)).limit(1);
    if (conn?.provider === "evolution" && conn.instancia) {
      const c = await configEvolution();
      if (c) await removerInstancia(c, conn.instancia);
    }
    await getDb().delete(whatsappConnections).where(eq(whatsappConnections.userId, dono));
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
        return { success: false, error: "Nenhuma conexão WhatsApp ativa", enviadas: 0, falhas: 0 };
      }
      const porQr = conn.provider === "evolution";
      const evolution = porQr ? await configEvolution() : null;
      if (porQr && (!evolution || !conn.instancia)) {
        return { success: false, error: "Servidor da Evolution (QR code) não configurado", enviadas: 0, falhas: 0 };
      }
      if (!porQr && (!conn.tokenEncrypted || !conn.phoneNumberId)) {
        return { success: false, error: "Credenciais da Business API não configuradas", enviadas: 0, falhas: 0 };
      }
      const enviarUm = (telefone: string) => porQr
        ? enviarTextoEvolution(evolution!, conn.instancia!, telefone, input.mensagem)
        : enviarWhatsappBusiness(decryptSecret(conn.tokenEncrypted!), conn.phoneNumberId!, telefone, input.mensagem);
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
          const externalId = await enviarUm(dest.telefone ?? "");
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
