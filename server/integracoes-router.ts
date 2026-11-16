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
import { verificarWebhookAsaas } from "../shared/asaas-webhook-recovery.js";
import { removerTokenMapbox, salvarTokenMapbox, tokenMapbox } from "./_core/geo/mapbox-config.js";
import { verificarTokenMapbox } from "../shared/geo/mapbox-token.js";
import {
  anthropicPainelDepsPadrao, conferirModelosDasFuncoes, mascararChaveAnthropic, modelosAnthropicPainel, removerAnthropicPainel,
  salvarChaveAnthropicPainel, gravarModeloDaFuncao, validarModeloDaFuncao, salvarModeloPreferencialAnthropic, statusAnthropicPainel, statusModelosPorFuncao,
  testarAnthropicPainel, type AnthropicPainelDeps,
} from "./_core/anthropic-painel.js";
import { FUNCOES_ANTHROPIC } from "../shared/funcoes-anthropic.js";
import { doloresWhatsappConfig } from "../drizzle/schema-dolores-whatsapp.js";
import { eq } from "drizzle-orm";

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
  /** EPIC-024 S-10: só cadastro da chave da Anthropic (não ativa a IA em nenhuma função). */
  anthropic?: AnthropicPainelDeps;
  /**
   * EPIC-024 S-11: o que cada função usa como queda quando não tem modelo escolhido no painel — só nomes de modelo.
   * Dolores: o campo antigo `dolores_whatsapp_config.modelo` (limpo quando o admin escolhe o modelo dela no painel);
   * Maquete: o modelo das configurações da maquete.
   */
  modelosAntigos?: {
    lerAnteriorDolores: () => Promise<string | null>;
    limparAnteriorDolores: (userId: number) => Promise<void>;
    /** Devolve o valor antigo ao cartão da Dolores quando a gravação do modelo dela falha depois de limpá-lo (achado 6). */
    restaurarAnteriorDolores: (userId: number, modelo: string) => Promise<void>;
    padraoMaquete: () => Promise<string | null>;
  };
};

const modelosAntigosPadrao: NonNullable<IntegracoesDeps["modelosAntigos"]> = {
  lerAnteriorDolores: async () => {
    const [c] = await db.getDb().select({ modelo: doloresWhatsappConfig.modelo }).from(doloresWhatsappConfig).where(eq(doloresWhatsappConfig.id, 1)).limit(1);
    return c?.modelo?.trim() || null;
  },
  limparAnteriorDolores: async userId => {
    await db.getDb().update(doloresWhatsappConfig).set({ modelo: null, atualizadoEm: new Date(), atualizadoPor: userId }).where(eq(doloresWhatsappConfig.id, 1));
  },
  restaurarAnteriorDolores: async (userId, modelo) => {
    await db.getDb().update(doloresWhatsappConfig).set({ modelo, atualizadoEm: new Date(), atualizadoPor: userId }).where(eq(doloresWhatsappConfig.id, 1));
  },
  padraoMaquete: async () => (await (await import("./maquete-3d/base.js")).carregarConfig()).modeloIA || null,
};

/** adminProcedure confere o MÓDULO; para escolher o modelo de cada função vale o PAPEL: só admin. */
const adminPorPapel = adminProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador escolhe o modelo de cada função." });
  return next();
});

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
  const anthropic = () => deps.anthropic ?? anthropicPainelDepsPadrao;
  const antigos = () => deps.modelosAntigos ?? modelosAntigosPadrao;
  /** Quedas de cada função quando não há modelo escolhido no painel (só nomes de modelo). */
  async function quedasDasFuncoes() {
    const a = antigos();
    const [anteriorDolores, padraoMaquete] = await Promise.all([a.lerAnteriorDolores().catch(() => null), a.padraoMaquete().catch(() => null)]);
    return { anteriorDolores, padraoMaquete };
  }
  async function webhookAsaas(recuperar: boolean) {
    const [asaas, webhook] = await Promise.all([deps.lerAsaas(), deps.lerWebhookAsaas()]);
    if (!asaas || !webhook) throw new TRPCError({ code: "BAD_REQUEST", message: "Configure a chave de API e o token do webhook antes de verificar a sincronização." });
    return verificarWebhookAsaas({ apiKey: asaas.apiKey, token: webhook.token,
      environment: ambienteDaChaveAsaas(asaas.apiKey), canonicalUrl: URL_WEBHOOK_ASAAS(),
      legacyName: "SiteProspecta", legacyHosts: ["prospectaconstrucoes.manus.space", "prospectaconstrucoes.com", "site-prospecta.vercel.app", "site-prospecta-viniciusoluaps-projects.vercel.app", "site-prospecta-git-main-viniciusoluaps-projects.vercel.app"],
    }, recuperar, deps.fetchImpl);
  }
  return router({
    verificarWebhookAsaas: adminProcedure.query(() => webhookAsaas(false)),
    recuperarWebhookAsaas: adminProcedure.mutation(() => webhookAsaas(true)),
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

    /** Mapbox (opcional, 11/11): token PÚBLICO para o satélite do mapa do terreno. Sem ele, Esri. */
    statusMapbox: adminProcedure.query(async () => {
      const t = await tokenMapbox().catch(() => null);
      return { configurado: Boolean(t), final: finalDaChave(t?.token), fonte: t?.fonte ?? null };
    }),
    testarMapbox: adminProcedure.query(async () => {
      const t = await tokenMapbox().catch(() => null);
      if (!t) return { ok: true, mensagem: "Sem token do Mapbox — o mapa do terreno usa o satélite da Esri (funciona sem configurar nada)." };
      return verificarTokenMapbox(t.token, deps.fetchImpl);
    }),
    salvarMapbox: adminProcedure
      .input(z.object({ token: z.string().trim().min(1, "Cole o token público do Mapbox (pk.)") }))
      .mutation(async ({ input }) => {
        try { return { success: true as const, ...(await salvarTokenMapbox(input.token)) }; }
        catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: mensagemDe(e, "Não foi possível salvar.") }); }
      }),
    removerMapbox: adminProcedure.mutation(async () => { await removerTokenMapbox(); return { success: true as const }; }),

    // EPIC-024 S-10: Anthropic — só guardar a chave, testar (quando o admin pedir), listar modelos e guardar a
    // preferência. Nada aqui liga a IA: a chave do painel nunca vai para ENV.anthropicApiKey.
    statusAnthropic: adminProcedure.query(() => statusAnthropicPainel(anthropic())),
    testarAnthropic: adminProcedure.mutation(() => testarAnthropicPainel(anthropic())),
    salvarAnthropic: adminProcedure
      .input(z.object({ apiKey: z.string().trim().min(1, "Cole a chave de API da Anthropic.") }))
      .mutation(async ({ input }) => {
        try { return { success: true as const, ...(await salvarChaveAnthropicPainel(input.apiKey, anthropic())) }; }
        catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: mascararChaveAnthropic(mensagemDe(e, "Chave da Anthropic não aceita.")) }); }
      }),
    removerAnthropic: adminProcedure.mutation(async () => { await removerAnthropicPainel(anthropic()); return { success: true as const }; }),
    modelosAnthropic: adminProcedure.mutation(async () => {
      try {
        const modelos = await modelosAnthropicPainel(anthropic());
        // S-11: modelo escolhido para uma função que sumiu da conta é limpo (cai para o preferencial), com aviso no painel
        await conferirModelosDasFuncoes(modelos, anthropic()).catch(() => undefined);
        return modelos;
      }
      catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: mascararChaveAnthropic(mensagemDe(e, "Não foi possível listar os modelos.")) }); }
    }),
    salvarModeloAnthropic: adminProcedure
      .input(z.object({ modelo: z.string().trim().min(1, "Escolha um modelo.").max(200) }))
      .mutation(async ({ input }) => {
        try { return { success: true as const, modelo: await salvarModeloPreferencialAnthropic(input.modelo, anthropic()) }; }
        catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: mascararChaveAnthropic(mensagemDe(e, "Não foi possível salvar o modelo.")) }); }
      }),
    // EPIC-024 S-11: modelo por função. Só nomes de modelo; nada chama a IA para a função nem liga nada.
    modelosPorFuncaoAnthropic: adminPorPapel.query(async () => statusModelosPorFuncao(await quedasDasFuncoes(), anthropic())),
    salvarModeloFuncaoAnthropic: adminPorPapel
      .input(z.object({ funcao: z.enum(FUNCOES_ANTHROPIC), modelo: z.string().trim().max(200) }).strict())
      .mutation(async ({ ctx, input }) => {
        let modelo;
        try { modelo = await validarModeloDaFuncao(input.funcao, input.modelo, anthropic()); }
        catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: mascararChaveAnthropic(mensagemDe(e, "Não foi possível salvar o modelo da função.")) }); }
        // QA S-11 achado 6: tudo ou nada. Na Dolores, a fonte do modelo passa a ser este painel e o campo antigo do cartão
        // dela é descartado ANTES de gravar; se descartar falhar, nada é gravado; se gravar falhar, o antigo volta.
        const a = antigos();
        let anterior: string | null = null;
        if (input.funcao === "dolores_whatsapp") {
          try {
            anterior = await a.lerAnteriorDolores();
            if (anterior) await a.limparAnteriorDolores(ctx.user.id);
          } catch {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível descartar o modelo antigo do cartão da Dolores. Nada foi alterado: tente de novo em instantes." });
          }
        }
        try { await gravarModeloDaFuncao(input.funcao, modelo, anthropic()); }
        catch {
          const restaurado = anterior ? await a.restaurarAnteriorDolores(ctx.user.id, anterior).then(() => true, () => false) : true;
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: restaurado
            ? "Não foi possível salvar o modelo da função. Nada foi alterado: tente de novo em instantes."
            : `Não foi possível salvar o modelo da função, e o modelo antigo do cartão da Dolores (${anterior}) não pôde ser devolvido: ela passa a usar o preferencial. Tente salvar de novo.` });
        }
        return { success: true as const, modelo, ...(await statusModelosPorFuncao(await quedasDasFuncoes(), anthropic())) };
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
