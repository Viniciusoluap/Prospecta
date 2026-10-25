// LOTE B (25/10): Configurações › Integrações — um lugar só para as chaves do Asaas, da Pluggy
// e do WhatsApp (Evolution). Cada bloco mostra o que está salvo (só os 4 últimos caracteres),
// testa com a mensagem real do serviço e troca a chave validando antes de salvar.
// Só admin: o router "integracoes" não está no mapa de módulos do colaborador (_core/trpc.ts).
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc.js";
import { ambienteDaChaveAsaas, chaveAsaasCentral, type AsaasEnvironment, type ChaveAsaasCentral } from "./_core/asaas.js";
import { fetchAsaasSaldo } from "./_core/asaas-extrato.js";
import { autenticarPluggyDetalhado, mensagemRecusaPluggy } from "./_core/pluggy.js";
import { estadoInstancia, normalizarUrlEvolution, testarEvolution, type EvolutionConfig } from "./_core/evolution.js";
import { decryptSecret, encryptSecret } from "./_core/secret-vault.js";
import { whatsappEvolutionSettings } from "../drizzle/schema.js";
import * as db from "./db.js";
import { conexaoParaPapel, configEvolution } from "./whatsapp-router.js";

type Fonte = "env" | "banco";
export type EstadoWhatsapp = "conectado" | "aguardando_qr" | "desconectado" | "sem_conexao";

export type IntegracoesDeps = {
  lerAsaas: () => Promise<ChaveAsaasCentral | null>;
  /** Há chave salva no banco (mesmo que a variável de ambiente esteja em uso)? */
  asaasSalvaNoBanco: () => Promise<boolean>;
  lerWebhookAsaas: () => Promise<{ token: string; fonte: Fonte } | null>;
  salvarAsaas: (dados: { apiKeyEncrypted?: string; environment?: AsaasEnvironment; webhookTokenEncrypted?: string }) => Promise<void>;
  lerPluggy: () => Promise<{ clientId: string; clientSecret: string } | null>;
  salvarPluggy: (dados: { clientIdEncrypted: string; clientSecretEncrypted: string }) => Promise<void>;
  lerEvolution: () => Promise<(EvolutionConfig & { fonte: Fonte }) | null>;
  salvarEvolution: (dados: { url: string; apiKeyEncrypted: string }) => Promise<void>;
  estadoWhatsapp: (user: { id: number; role: string }, config: EvolutionConfig) => Promise<EstadoWhatsapp>;
  encrypt: (valor: string) => string;
  fetchImpl: typeof fetch;
};

const SITE = () => (process.env.PUBLIC_SITE_URL || "https://www.prospectaconstrucoes.com").replace(/\/+$/, "");
export const URL_WEBHOOK_ASAAS = () => `${SITE()}/api/asaas/webhook`;

/** "…1234" — nunca devolve a chave; chaves curtas demais não mostram nada. */
export function finalDaChave(valor: string | null | undefined): string | null {
  const v = (valor ?? "").trim();
  if (!v) return null;
  return v.length >= 8 ? `…${v.slice(-4)}` : "…";
}

const mensagemDe = (e: unknown, padrao: string) => (e instanceof Error && e.message ? e.message : padrao);

const defaultDeps: IntegracoesDeps = {
  lerAsaas: chaveAsaasCentral,
  asaasSalvaNoBanco: async () => Boolean((await db.getPaymentSetting())?.asaasApiKeyEncrypted),
  lerWebhookAsaas: async () => {
    if (process.env.ASAAS_WEBHOOK_TOKEN) return { token: process.env.ASAAS_WEBHOOK_TOKEN, fonte: "env" };
    const s = await db.getPaymentSetting();
    if (!s?.asaasWebhookTokenEncrypted) return null;
    return { token: decryptSecret(s.asaasWebhookTokenEncrypted), fonte: "banco" };
  },
  salvarAsaas: async ({ apiKeyEncrypted, environment, webhookTokenEncrypted }) => {
    const atual = await db.getPaymentSetting();
    if (!atual && !apiKeyEncrypted) throw new Error("Informe primeiro a chave de API do Asaas.");
    await db.savePaymentSetting({
      provider: "asaas",
      asaasApiKeyEncrypted: apiKeyEncrypted ?? atual!.asaasApiKeyEncrypted,
      asaasEnvironment: environment ?? atual?.asaasEnvironment ?? "sandbox",
      ...(webhookTokenEncrypted !== undefined ? { asaasWebhookTokenEncrypted: webhookTokenEncrypted } : {}),
      isActive: true,
    });
  },
  lerPluggy: async () => {
    const s = await db.getPluggySetting();
    if (!s?.isActive) return null;
    return { clientId: decryptSecret(s.clientIdEncrypted), clientSecret: decryptSecret(s.clientSecretEncrypted) };
  },
  salvarPluggy: dados => db.savePluggySetting({ ...dados, isActive: true }),
  lerEvolution: configEvolution,
  salvarEvolution: async ({ url, apiKeyEncrypted }) => {
    const valores = { url, apiKeyEncrypted, updatedAt: new Date() };
    await db.getDb().insert(whatsappEvolutionSettings).values({ id: 1, ...valores })
      .onConflictDoUpdate({ target: whatsappEvolutionSettings.id, set: valores });
  },
  estadoWhatsapp: async (user, config) => {
    const conn = await conexaoParaPapel(user.id, user.role);
    if (!conn || conn.provider !== "evolution" || !conn.instancia) return "sem_conexao";
    const estado = await estadoInstancia(config, conn.instancia);
    return estado === "open" ? "conectado" : estado === "connecting" ? "aguardando_qr" : "desconectado";
  },
  encrypt: encryptSecret,
  fetchImpl: (...args) => fetch(...args),
};

const ROTULO_ESTADO: Record<EstadoWhatsapp, string> = {
  conectado: "WhatsApp conectado.",
  aguardando_qr: "WhatsApp aguardando a leitura do QR code (Central WhatsApp).",
  desconectado: "WhatsApp desconectado — gere o QR code na Central WhatsApp.",
  sem_conexao: "Nenhum WhatsApp conectado ainda — gere o QR code na Central WhatsApp.",
};

export function createIntegracoesRouter(deps: IntegracoesDeps = defaultDeps) {
  return router({
    /** O que está salvo em cada serviço — sem nenhum segredo, só os 4 últimos caracteres. */
    status: adminProcedure.query(async () => {
      const [asaas, asaasNoBanco, webhook, pluggy, evolution] = await Promise.all([
        deps.lerAsaas().catch(() => null),
        deps.asaasSalvaNoBanco().catch(() => false),
        deps.lerWebhookAsaas().catch(() => null),
        deps.lerPluggy().catch(() => null),
        deps.lerEvolution().catch(() => null),
      ]);
      return {
        asaas: {
          configurado: Boolean(asaas),
          final: finalDaChave(asaas?.apiKey),
          fonte: asaas?.fonte ?? null,
          ambiente: asaas ? ambienteDaChaveAsaas(asaas.apiKey) : null,
          /** Chave salva na tela, mas ignorada porque ASAAS_API_KEY está definida. */
          salvaNoBancoIgnorada: asaas?.fonte === "env" && asaasNoBanco,
          webhookUrl: URL_WEBHOOK_ASAAS(),
          webhookConfigurado: Boolean(webhook),
          webhookFinal: finalDaChave(webhook?.token),
          webhookFonte: webhook?.fonte ?? null,
        },
        pluggy: {
          configurado: Boolean(pluggy),
          clientIdFinal: finalDaChave(pluggy?.clientId),
          secretFinal: finalDaChave(pluggy?.clientSecret),
        },
        whatsapp: {
          configurado: Boolean(evolution),
          url: evolution?.url ?? null,
          final: finalDaChave(evolution?.apiKey),
          fonte: evolution?.fonte ?? null,
        },
      };
    }),

    /** Testa o serviço com a chave em uso e devolve a mensagem real do serviço. */
    testar: adminProcedure
      .input(z.object({ servico: z.enum(["asaas", "pluggy", "whatsapp"]) }))
      .query(async ({ ctx, input }): Promise<{ ok: boolean; mensagem: string; estado?: EstadoWhatsapp }> => {
        if (input.servico === "asaas") {
          const c = await deps.lerAsaas().catch(e => { throw new TRPCError({ code: "BAD_REQUEST", message: mensagemDe(e, "Configuração do Asaas inválida.") }); });
          if (!c) return { ok: false, mensagem: "Nenhuma chave do Asaas configurada." };
          try {
            const saldo = await fetchAsaasSaldo(c.apiKey, deps.fetchImpl);
            const amb = ambienteDaChaveAsaas(c.apiKey) === "production" ? "produção" : "sandbox";
            return { ok: true, mensagem: `Asaas conectado (${amb}). Saldo: ${saldo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.` };
          } catch (e) { return { ok: false, mensagem: mensagemDe(e, "O Asaas não respondeu.") }; }
        }
        if (input.servico === "pluggy") {
          const c = await deps.lerPluggy().catch(() => null);
          if (!c) return { ok: false, mensagem: "Client ID e Client Secret da Pluggy não configurados." };
          const r = await autenticarPluggyDetalhado(c.clientId, c.clientSecret, deps.fetchImpl);
          return r.ok ? { ok: true, mensagem: "Pluggy conectada." } : { ok: false, mensagem: mensagemRecusaPluggy(r.status, r.mensagem) };
        }
        const c = await deps.lerEvolution().catch(() => null);
        if (!c) return { ok: false, mensagem: "Endereço e chave do servidor da Evolution não configurados." };
        try { await testarEvolution(c, deps.fetchImpl); }
        catch (e) { return { ok: false, mensagem: mensagemDe(e, "A Evolution não respondeu.") }; }
        const estado = await deps.estadoWhatsapp(ctx.user, c).catch(() => null);
        return { ok: true, mensagem: `Servidor da Evolution conectado. ${estado ? ROTULO_ESTADO[estado] : "Estado do WhatsApp indisponível."}`, ...(estado ? { estado } : {}) };
      }),

    salvarAsaas: adminProcedure
      .input(z.object({ apiKey: z.string().trim().optional(), webhookToken: z.string().trim().optional() })
        .refine(v => Boolean(v.apiKey || v.webhookToken), "Cole a nova chave de API ou o novo token do webhook."))
      .mutation(async ({ input }) => {
        let environment: AsaasEnvironment | undefined;
        if (input.apiKey) {
          environment = ambienteDaChaveAsaas(input.apiKey);
          try { await fetchAsaasSaldo(input.apiKey, deps.fetchImpl); }
          catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: mensagemDe(e, "Chave do Asaas não aceita.") }); }
        }
        try {
          await deps.salvarAsaas({
            ...(input.apiKey ? { apiKeyEncrypted: deps.encrypt(input.apiKey), environment } : {}),
            ...(input.webhookToken ? { webhookTokenEncrypted: deps.encrypt(input.webhookToken) } : {}),
          });
        } catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: mensagemDe(e, "Não foi possível salvar.") }); }
        return { success: true as const, ambiente: environment ?? null };
      }),

    salvarPluggy: adminProcedure
      .input(z.object({ clientId: z.string().trim().min(1, "Informe o Client ID"), clientSecret: z.string().trim().min(1, "Informe o Client Secret") }))
      .mutation(async ({ input }) => {
        const r = await autenticarPluggyDetalhado(input.clientId, input.clientSecret, deps.fetchImpl);
        if (!r.ok) throw new TRPCError({ code: "BAD_REQUEST", message: mensagemRecusaPluggy(r.status, r.mensagem) });
        await deps.salvarPluggy({ clientIdEncrypted: deps.encrypt(input.clientId), clientSecretEncrypted: deps.encrypt(input.clientSecret) });
        return { success: true as const };
      }),

    salvarEvolution: adminProcedure
      .input(z.object({ url: z.string().trim().min(4, "Informe o endereço do servidor"), apiKey: z.string().trim().min(8, "Chave muito curta") }))
      .mutation(async ({ input }) => {
        const url = normalizarUrlEvolution(input.url);
        try { new URL(url); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "Endereço inválido." }); }
        try { await testarEvolution({ url, apiKey: input.apiKey }, deps.fetchImpl); }
        catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: mensagemDe(e, "A Evolution não respondeu.") }); }
        await deps.salvarEvolution({ url, apiKeyEncrypted: deps.encrypt(input.apiKey) });
        return { success: true as const, url };
      }),
  });
}

export const integracoesRouter = createIntegracoesRouter();
