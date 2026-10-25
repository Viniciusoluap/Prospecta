import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { financiamentos, leadServices, leads, users, whatsappConnections, whatsappEvolutionSettings, whatsappMessages } from "../drizzle/schema.js";
import { listaPorExtenso, preencherTemplate, primeiroNome } from "../shared/whatsapp/variaveis.js";
import { rotulo } from "../shared/rotulos.js";
import { enviarWhatsappBusiness, normalizarStatusWebhook } from "./_core/whatsapp-business.js";
import { decryptSecret, encryptSecret, segredoEmTextoPuro } from "./_core/secret-vault.js";
import {
  enviarTextoEvolution, estadoInstancia, gerarQrCode, mesmoTelefone, normalizarUrlEvolution, numeroConectado, registrarWebhookEvolution, removerInstancia,
  type EvolutionConfig,
} from "./_core/evolution.js";
import { requireModule } from "./_core/rbac.js";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";
import { URL_WEBHOOK_EVOLUTION, segredoWebhookEvolution } from "./whatsapp-evolution-webhook.js";

/** Dono da conexão: o colaborador usa (e configura) a conexão da empresa, que é a do admin. */
async function donoDaConexao(userId: number, role: string): Promise<number | null> {
  if (role !== "colaborador") return userId;
  const [admin] = await getDb().select({ id: users.id }).from(users).where(eq(users.role, "admin")).orderBy(users.id).limit(1);
  return admin?.id ?? null;
}

export async function conexaoParaPapel(userId: number, role: string) {
  const dono = await donoDaConexao(userId, role);
  if (!dono) return null;
  const [conn] = await getDb().select().from(whatsappConnections).where(eq(whatsappConnections.userId, dono)).limit(1);
  return conn ?? null;
}

/** Servidor da Evolution (QR code): o salvo pela tela tem precedência; variáveis de ambiente são o reserva. */
export async function configEvolution(): Promise<(EvolutionConfig & { fonte: "banco" | "env" }) | null> {
  const db = getDb();
  const [s] = await db.select().from(whatsappEvolutionSettings).where(eq(whatsappEvolutionSettings.id, 1)).limit(1);
  if (s) {
    const apiKey = decryptSecret(s.apiKeyEncrypted);
    if (segredoEmTextoPuro(s.apiKeyEncrypted)) {
      await db.update(whatsappEvolutionSettings).set({ apiKeyEncrypted: encryptSecret(apiKey) }).where(eq(whatsappEvolutionSettings.id, 1));
    }
    return { url: normalizarUrlEvolution(s.url), apiKey, fonte: "banco" };
  }
  const url = process.env.EVOLUTION_API_URL, apiKey = process.env.EVOLUTION_API_KEY;
  return url && apiKey ? { url: normalizarUrlEvolution(url), apiKey, fonte: "env" } : null;
}

async function exigirEvolution(): Promise<EvolutionConfig> {
  const c = await configEvolution();
  if (!c) throw new TRPCError({ code: "BAD_REQUEST", message: "Servidor do WhatsApp não configurado: informe o endereço e a chave em Configurações › Integrações." });
  return c;
}

const erroEvolution = (e: unknown) =>
  e instanceof TRPCError ? e : new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Falha na Evolution." });

const BANCOS: Record<string, string> = { caixa: "Caixa", bb: "Banco do Brasil", bradesco: "Bradesco", itau: "Itaú", santander: "Santander" };

/**
 * Pedido de 25/10: valores das variáveis dos templates para cada lead ({{nome}}, {{servico}}, {{corretor}},
 * {{imovel}}, {{banco}}, {{endereco}}); {{horario}}/{{documentos}} e o que faltar vêm de `extras` (preenchidos na tela).
 */
async function valoresDosLeads(ids: number[], remetente: string | null) {
  const db = getDb();
  if (!ids.length) return new Map<number, Record<string, string>>();
  const [rows, servs, fins] = await Promise.all([
    db.select({ id: leads.id, nome: leads.name, endereco: leads.address, corretor: users.name })
      .from(leads).leftJoin(users, eq(users.id, leads.brokerId)).where(inArray(leads.id, ids)),
    db.select({ leadId: leadServices.leadId, tipo: leadServices.serviceType, titulo: leadServices.title })
      .from(leadServices).where(inArray(leadServices.leadId, ids)),
    db.select({ leadId: financiamentos.leadId, imovel: financiamentos.imovel, banco: financiamentos.banco, bancoOutro: financiamentos.bancoOutro })
      .from(financiamentos).where(inArray(financiamentos.leadId, ids)).orderBy(desc(financiamentos.id)),
  ]);
  const out = new Map<number, Record<string, string>>();
  for (const r of rows) {
    const fin = fins.find(f => f.leadId === r.id);
    out.set(r.id, {
      nome: primeiroNome(r.nome),
      servico: listaPorExtenso(servs.filter(sv => sv.leadId === r.id).map(sv => rotulo(sv.tipo))),
      corretor: r.corretor ?? remetente ?? "",
      imovel: fin?.imovel ?? "",
      banco: fin?.bancoOutro || (fin?.banco ? (BANCOS[fin.banco] ?? rotulo(fin.banco)) : ""),
      endereco: r.endereco ?? "",
    });
  }
  return out;
}

const extrasSchema = z.record(z.string(), z.string().max(500)).optional();

export const whatsappRouter = router({
  /** Prévia por destinatário: mensagem final e variáveis que ainda faltam. */
  previaEnvio: adminProcedure
    .input(z.object({ mensagem: z.string().max(4096), ids: z.array(z.number()).max(200), extras: extrasSchema }))
    .query(async ({ ctx, input }) => {
      const valores = await valoresDosLeads(input.ids, ctx.user.name ?? null);
      return input.ids.map(id => {
        const v = { ...(valores.get(id) ?? {}), ...Object.fromEntries(Object.entries(input.extras ?? {}).filter(([, x]) => x.trim())) };
        return { id, ...preencherTemplate(input.mensagem, v) };
      });
    }),

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

  // LOTE B (25/10): endereço e chave da Evolution são salvos só em Configurações › Integrações (integracoes.salvarEvolution).

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
      if (status === "conectado") {
        numero = (await numeroConectado(c, conn.instancia).catch(() => null)) ?? numero;
        await registrarWebhookEvolution(c, conn.instancia, URL_WEBHOOK_EVOLUTION(), segredoWebhookEvolution()).catch(() => undefined);
      }
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
      return db.select().from(whatsappMessages).where(eq(whatsappMessages.direcao, "saida")).orderBy(desc(whatsappMessages.createdAt)).limit(100);
    }
    const conn = await conexaoParaPapel(ctx.user.id, ctx.user.role);
    if (!conn) return [];
    return db.select().from(whatsappMessages).where(and(eq(whatsappMessages.connectionId, conn.id), eq(whatsappMessages.direcao, "saida"))).orderBy(desc(whatsappMessages.createdAt)).limit(100);
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
      extras: extrasSchema,
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
      const enviarUm = (telefone: string, texto: string) => porQr
        ? enviarTextoEvolution(evolution!, conn.instancia!, telefone, texto)
        : enviarWhatsappBusiness(decryptSecret(conn.tokenEncrypted!), conn.phoneNumberId!, telefone, texto);
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
      // Pedido de 25/10: cada destinatário recebe o template já preenchido; nada sai com {{…}}.
      const valores = await valoresDosLeads(destinatarios.map(d => d.id), ctx.user.name ?? null);
      const extras = Object.fromEntries(Object.entries(input.extras ?? {}).filter(([, x]) => x.trim()));
      const textos = new Map(destinatarios.map(d => [d.id, preencherTemplate(input.mensagem, { ...(valores.get(d.id) ?? {}), ...extras })]));
      const pendentes = destinatarios.filter(d => textos.get(d.id)!.faltando.length);
      if (pendentes.length) {
        const nomes = Array.from(new Set(pendentes.flatMap(d => textos.get(d.id)!.faltando))).map(n => `{{${n}}}`).join(", ");
        return { success: false, error: `Preencha ${nomes} antes de enviar (${pendentes.length} destinatário(s) sem esse dado).`, enviadas: 0, falhas: 0 };
      }
      for (const dest of destinatarios) {
        const texto = textos.get(dest.id)!.texto;
        try {
          const externalId = await enviarUm(dest.telefone ?? "", texto);
          await db.insert(whatsappMessages).values({
            connectionId: conn.id, leadId: dest.id, destinatario: dest.telefone ?? "", nomeDestinatario: dest.nome,
            mensagem: texto, externalId, status: externalId ? "enviada" : "falhou",
          });
          if (externalId) enviadas++; else falhas++;
        } catch {
          await db.insert(whatsappMessages).values({
            connectionId: conn.id, leadId: dest.id, destinatario: dest.telefone ?? "", nomeDestinatario: dest.nome,
            mensagem: texto, status: "falhou", erroMsg: "Erro ao enviar",
          });
          falhas++;
        }
      }
      return { success: true, enviadas, falhas };
    }),

  // ── Pedido de 25/10: Conversas (receber e responder) ──
  /** Garante que a Evolution avise o sistema das mensagens (idempotente). */
  ativarAvisos: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.role !== "corretor") requireModule(ctx, "whatsapp");
    const conn = await conexaoParaPapel(ctx.user.id, ctx.user.role);
    if (!conn || conn.provider !== "evolution" || !conn.instancia) return { ok: false, mensagem: "Conversas funcionam com a conexão por QR code." };
    const c = await exigirEvolution();
    try { await registrarWebhookEvolution(c, conn.instancia, URL_WEBHOOK_EVOLUTION(), segredoWebhookEvolution()); }
    catch (e) { throw erroEvolution(e); }
    return { ok: true, mensagem: "Recebimento de mensagens ativo." };
  }),

  conversas: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "corretor") requireModule(ctx, "whatsapp");
    const conn = await conexaoParaPapel(ctx.user.id, ctx.user.role);
    if (!conn) return [];
    const msgs = await getDb().select().from(whatsappMessages).where(eq(whatsappMessages.connectionId, conn.id)).orderBy(desc(whatsappMessages.createdAt)).limit(2000);
    const grupos: { numero: string; nome: string | null; leadId: number | null; ultima: string; quando: Date; naoLidas: number }[] = [];
    for (const m of msgs) {
      let g = grupos.find(x => mesmoTelefone(x.numero, m.destinatario));
      if (!g) { g = { numero: m.destinatario.replace(/\D/g, ""), nome: m.nomeDestinatario, leadId: m.leadId, ultima: m.mensagem, quando: m.createdAt, naoLidas: 0 }; grupos.push(g); }
      if (!g.nome && m.nomeDestinatario) g.nome = m.nomeDestinatario;
      if (!g.leadId && m.leadId) g.leadId = m.leadId;
      if (m.direcao === "entrada" && !m.lida) g.naoLidas++;
    }
    // Corretor vê só conversas dos próprios leads ou sem lead.
    if (ctx.user.role === "corretor") {
      const meus = new Set((await getDb().select({ id: leads.id }).from(leads).where(eq(leads.brokerId, ctx.user.id))).map(l => l.id));
      return grupos.filter(g => !g.leadId || meus.has(g.leadId));
    }
    return grupos;
  }),

  mensagensConversa: protectedProcedure.input(z.object({ numero: z.string().min(8).max(20) })).query(async ({ ctx, input }) => {
    if (ctx.user.role !== "corretor") requireModule(ctx, "whatsapp");
    const conn = await conexaoParaPapel(ctx.user.id, ctx.user.role);
    if (!conn) return [];
    const db = getDb();
    const todas = await db.select().from(whatsappMessages).where(eq(whatsappMessages.connectionId, conn.id)).orderBy(desc(whatsappMessages.createdAt)).limit(3000);
    const da = todas.filter(m => mesmoTelefone(m.destinatario, input.numero)).reverse();
    // Corretor não abre conversa de lead de outro corretor (mesma regra do Santa Fé).
    if (ctx.user.role === "corretor") {
      const leadId = da.find(m => m.leadId)?.leadId;
      if (leadId) {
        const [l] = await db.select({ brokerId: leads.brokerId }).from(leads).where(eq(leads.id, leadId)).limit(1);
        if (l && l.brokerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Conversa de outro corretor." });
      }
    }
    const naoLidas = da.filter(m => m.direcao === "entrada" && !m.lida).map(m => m.id);
    if (naoLidas.length) await db.update(whatsappMessages).set({ lida: true }).where(inArray(whatsappMessages.id, naoLidas));
    return da.map(m => ({ id: m.id, direcao: m.direcao, mensagem: m.mensagem, status: m.status, quando: m.createdAt }));
  }),

  /** Contato novo da conversa vira lead (nome do WhatsApp + telefone) e as mensagens passam a apontar para ele. */
  criarLeadDaConversa: protectedProcedure.input(z.object({ numero: z.string().min(8).max(20), nome: z.string().trim().max(255).optional() })).mutation(async ({ ctx, input }) => {
    if (ctx.user.role !== "corretor") requireModule(ctx, "whatsapp");
    const conn = await conexaoParaPapel(ctx.user.id, ctx.user.role);
    if (!conn) throw new TRPCError({ code: "BAD_REQUEST", message: "WhatsApp não está conectado." });
    const db = getDb();
    const d = input.numero.replace(/\D/g, "").replace(/^55/, "");
    const [lead] = await db.insert(leads).values({
      name: input.nome || `WhatsApp ${d}`, phone: d,
      ...(ctx.user.role === "corretor" ? { brokerId: ctx.user.id } : {}),
    }).returning({ id: leads.id });
    const msgs = await db.select({ id: whatsappMessages.id, destinatario: whatsappMessages.destinatario }).from(whatsappMessages).where(eq(whatsappMessages.connectionId, conn.id));
    const ids = msgs.filter(m => mesmoTelefone(m.destinatario, input.numero)).map(m => m.id);
    if (ids.length) await db.update(whatsappMessages).set({ leadId: lead.id }).where(inArray(whatsappMessages.id, ids));
    return { leadId: lead.id };
  }),

  responder: protectedProcedure.input(z.object({ numero: z.string().min(8).max(20), texto: z.string().trim().min(1).max(4096) })).mutation(async ({ ctx, input }) => {
    if (ctx.user.role !== "corretor") requireModule(ctx, "whatsapp");
    const conn = await conexaoParaPapel(ctx.user.id, ctx.user.role);
    if (!conn || conn.status !== "conectado") throw new TRPCError({ code: "BAD_REQUEST", message: "WhatsApp não está conectado." });
    const db = getDb();
    const todos = await db.select({ id: leads.id, nome: leads.name, phone: leads.phone, brokerId: leads.brokerId }).from(leads);
    const lead = todos.find(l => mesmoTelefone(l.phone, input.numero));
    if (ctx.user.role === "corretor" && lead && lead.brokerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Conversa de outro corretor." });
    let externalId: string | null = null;
    if (conn.provider === "evolution" && conn.instancia) {
      externalId = await enviarTextoEvolution(await exigirEvolution(), conn.instancia, input.numero, input.texto);
    } else if (conn.tokenEncrypted && conn.phoneNumberId) {
      externalId = await enviarWhatsappBusiness(decryptSecret(conn.tokenEncrypted), conn.phoneNumberId, input.numero, input.texto);
    }
    await db.insert(whatsappMessages).values({
      connectionId: conn.id, leadId: lead?.id ?? null, destinatario: input.numero.replace(/\D/g, ""), nomeDestinatario: lead?.nome ?? null,
      mensagem: input.texto, externalId, status: externalId ? "enviada" : "falhou", direcao: "saida", lida: true,
    });
    if (!externalId) throw new TRPCError({ code: "BAD_REQUEST", message: "O WhatsApp não aceitou a mensagem. Confira a conexão." });
    return { ok: true };
  }),
});

/** Aplica um evento de status recebido do webhook do WhatsApp Business a uma mensagem existente. */
export async function aplicarStatusWebhook(externalId: string, rawStatus: string | undefined): Promise<void> {
  const status = normalizarStatusWebhook(rawStatus);
  await getDb().update(whatsappMessages).set({ status, updatedAt: new Date() }).where(eq(whatsappMessages.externalId, externalId));
}
