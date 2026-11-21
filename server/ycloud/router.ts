// EPIC-027 C7 (20/11/2026) — router tRPC "whatsappOficial": cartão de Integrações (chave, teste, avisos de entrega, interruptor e
// tetos), modelos, prévia, criação e envio das campanhas pela API oficial (YCloud) e painel.
// SÓ ADMINISTRADOR POR PAPEL: `adminProcedure` confere o módulo (o colaborador com o módulo WhatsApp passaria); aqui vale o papel.
// Nenhuma resposta leva a chave, o segredo ou telefones de destinatários (só mascarados).
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc.js";
import { ErroYcloud, criarEndpointYcloud, listarNumerosYcloud, semSegredo } from "../_core/ycloud.js";
import { MAX_DESTINATARIOS_CAMPANHA, ROTULO_QUALIDADE, ROTULO_STATUS_NUMERO } from "../../shared/whatsapp/ycloud.js";
import {
  RecusaYcloud, criarCampanha, detalheCampanha, enviarLote, mudarCampanha, painelCampanhas, prepararCampanha, previaParaTela,
  registrarOptoutPeloPainel, situacaoParaDisparo, totalOptout, usadosNas24h, vagasDoDia,
} from "./campanhas.js";
import {
  CHAVE_SEGREDO_YCLOUD, EVENTOS_YCLOUD, atualizarConfigYcloud, auditarYcloud, chaveYcloud, depsYcloud, finalDoSegredo, gravarChaveYcloud, gravarSegredoWebhookYcloud,
  lerConfigYcloud, normalizarChaveYcloud, normalizarSegredoWebhook, segredoWebhookYcloud, urlWebhookYcloud,
} from "./config.js";
import { conferirNumeroYcloud, escolherNumeroDaEmpresa, modelosDaConta } from "./conta.js";
import * as db from "../db.js";

const soAdmin = adminProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador usa a API oficial do WhatsApp." });
  return next();
});

/** Erro para a tela: nunca com a chave/segredo; sem detalhe interno. */
async function erroParaTela(e: unknown, padrao: string): Promise<TRPCError> {
  if (e instanceof TRPCError) return e;
  const chave = await chaveYcloud().catch(() => null);
  const segredo = await segredoWebhookYcloud().catch(() => null);
  const msg = e instanceof RecusaYcloud || e instanceof ErroYcloud || (e instanceof Error && /^(Nenhuma|Chave|Segredo|Cole|Configuração)/.test(e.message)) ? e.message : padrao;
  return new TRPCError({ code: "BAD_REQUEST", message: semSegredo(msg, chave, segredo) });
}
async function tentar<T>(fn: () => Promise<T>, padrao: string): Promise<T> {
  try { return await fn(); } catch (e) { throw await erroParaTela(e, padrao); }
}

const variavelSchema = z.discriminatedUnion("fonte", [
  z.object({ fonte: z.literal("primeiro_nome") }).strict(),
  z.object({ fonte: z.literal("nome_completo") }).strict(),
  z.object({ fonte: z.literal("fixo"), texto: z.string().max(1024) }).strict(),
]);
const entradaSchema = z.object({
  nome: z.string().trim().min(2, "Dê um nome à campanha.").max(120),
  modelo: z.object({ nome: z.string().trim().min(1).max(512).regex(/^[a-z0-9_]+$/, "Nome de modelo inválido."), idioma: z.string().trim().min(2).max(20).regex(/^[A-Za-z_-]+$/) }).strict(),
  variaveis: z.record(z.string().regex(/^(corpo|cabecalho)\.\d{1,2}$/), variavelSchema).refine(v => Object.keys(v).length <= 30, "Variáveis demais."),
  leadIds: z.array(z.number().int().positive()).min(1, "Escolha ao menos um destinatário.").max(MAX_DESTINATARIOS_CAMPANHA),
}).strict();
const campanhaIdSchema = z.object({ campanhaId: z.number().int().positive() }).strict();

/** O estado guardado (sem consultar a YCloud): o cartão abre rápido e nada sai do servidor além do mascarado. */
async function status() {
  const [cfg, chave, segredo] = await Promise.all([lerConfigYcloud(), chaveYcloud(), segredoWebhookYcloud()]);
  const usados = await usadosNas24h(depsYcloud().agora());
  const vagas = vagasDoDia(cfg, cfg.limiteDiario ?? Number.POSITIVE_INFINITY, usados);
  return {
    configurado: Boolean(chave), final: finalDoSegredo(chave),
    ligado: cfg.ligado, tetoDia: cfg.tetoDia, tetoCampanha: cfg.tetoCampanha, janelaRepeticaoDias: cfg.janelaRepeticaoDias,
    precoEstimado: cfg.precoEstimado !== null ? Number(cfg.precoEstimado) : null, moeda: cfg.moeda,
    conferencia: cfg.conferidoEm ? {
      numero: cfg.numeroApi, nomeVerificado: cfg.nomeVerificado, status: cfg.statusNumero,
      statusRotulo: cfg.statusNumero ? (ROTULO_STATUS_NUMERO[cfg.statusNumero] ?? cfg.statusNumero) : null,
      qualidade: cfg.qualidade, qualidadeRotulo: cfg.qualidade ? (ROTULO_QUALIDADE[cfg.qualidade] ?? cfg.qualidade) : null,
      tier: cfg.limiteTier, limiteDiario: cfg.limiteDiario, numeroConfere: cfg.numeroConfere, conferidoEm: cfg.conferidoEm,
    } : null,
    usados24h: usados, restanteHoje: Number.isFinite(vagas.restante) ? vagas.restante : null,
    avisos: { configurado: Boolean(segredo), final: finalDoSegredo(segredo), endpointId: cfg.webhookEndpointId, status: cfg.webhookStatus, url: urlWebhookYcloud(), eventos: [...EVENTOS_YCLOUD] },
    optout: await totalOptout(),
  };
}

export const whatsappOficialRouter = router({
  status: soAdmin.query(() => tentar(status, "Não consegui ler a configuração da API oficial.")),

  /** Testar: GET /whatsapp/phoneNumbers com a chave salva. O número da conta é o da própria empresa (não é dado de cliente). */
  testar: soAdmin.mutation(() => tentar(async () => {
    const c = await conferirNumeroYcloud();
    return { ...c, numero: c.numero, limiteDiario: Number.isFinite(c.limiteDiario) ? c.limiteDiario : null };
  }, "A YCloud não respondeu.")),

  salvarChave: soAdmin.input(z.object({ apiKey: z.string().max(300) }).strict()).mutation(({ ctx, input }) => tentar(async () => {
    const chave = normalizarChaveYcloud(input.apiKey);
    // valida na YCloud ANTES de salvar (e já confere o número)
    const numeros = await listarNumerosYcloud({ apiKey: chave, fetchImpl: depsYcloud().fetch });
    await gravarChaveYcloud(chave);
    const empresa = await depsYcloud().numeroDaEmpresa().catch(() => null);
    const c = escolherNumeroDaEmpresa(numeros, empresa);
    await atualizarConfigYcloud({
      numeroApi: c.numero, wabaId: c.wabaId, nomeVerificado: c.nomeVerificado?.slice(0, 255) ?? null, statusNumero: c.status, qualidade: c.qualidade,
      limiteTier: c.tier, limiteDiario: Number.isFinite(c.limiteDiario) ? c.limiteDiario : null, numeroConfere: c.numeroConfere,
      conferidoEm: depsYcloud().agora(), ...(c.numeroConfere ? {} : { ligado: false }),
    }, ctx.user.id);
    await auditarYcloud({ acao: "chave_salva", usuarioId: ctx.user.id });
    return { success: true as const, final: finalDoSegredo(chave), numeroConfere: c.numeroConfere, aviso: c.aviso };
  }, "Chave da YCloud não aceita.")),

  removerChave: soAdmin.mutation(({ ctx }) => tentar(async () => {
    await db.saveDashboardSetting(CHAVE_SEGREDO_YCLOUD, "");
    await atualizarConfigYcloud({ ligado: false, numeroConfere: false }, ctx.user.id);
    await auditarYcloud({ acao: "chave_removida", usuarioId: ctx.user.id });
    return { success: true as const };
  }, "Não foi possível remover a chave.")),

  /** "Ativar avisos de entrega": cria o endpoint na YCloud (POST /webhookEndpoints) e guarda o segredo cifrado. URL fixa do servidor. */
  ativarAvisos: soAdmin.mutation(({ ctx }) => tentar(async () => {
    const chave = await chaveYcloud();
    if (!chave) throw new RecusaYcloud("Salve a chave da YCloud antes.");
    const cfg = await lerConfigYcloud();
    if (cfg.webhookEndpointId && await segredoWebhookYcloud()) return { success: true as const, jaAtivo: true, precisaSegredo: false };
    const ep = await criarEndpointYcloud({ apiKey: chave, fetchImpl: depsYcloud().fetch }, urlWebhookYcloud(), EVENTOS_YCLOUD);
    const segredo = typeof ep?.secret === "string" && ep.secret.trim() ? ep.secret.trim() : null;
    if (segredo) await gravarSegredoWebhookYcloud(segredo);
    await atualizarConfigYcloud({ webhookEndpointId: typeof ep?.id === "string" ? ep.id.slice(0, 80) : null, webhookStatus: typeof ep?.status === "string" ? ep.status.slice(0, 20) : null }, ctx.user.id);
    await auditarYcloud({ acao: "avisos_ativados", usuarioId: ctx.user.id, detalhe: segredo ? "segredo recebido" : "sem segredo na resposta" });
    return { success: true as const, jaAtivo: false, precisaSegredo: !segredo };
  }, "Não consegui ativar os avisos de entrega.")),

  /** Segredo digitado pelo dono (quando o endpoint foi criado no painel da YCloud). */
  salvarSegredoAvisos: soAdmin.input(z.object({ segredo: z.string().max(300) }).strict()).mutation(({ ctx, input }) => tentar(async () => {
    await gravarSegredoWebhookYcloud(normalizarSegredoWebhook(input.segredo));
    await auditarYcloud({ acao: "segredo_avisos_salvo", usuarioId: ctx.user.id });
    return { success: true as const };
  }, "Não foi possível salvar o segredo.")),

  salvarConfig: soAdmin.input(z.object({
    ligado: z.boolean().optional(),
    tetoDia: z.number().int().min(1).max(100_000).optional(),
    tetoCampanha: z.number().int().min(1).max(MAX_DESTINATARIOS_CAMPANHA).optional(),
    janelaRepeticaoDias: z.number().int().min(0).max(90).optional(),
    precoEstimado: z.number().min(0).max(100).nullable().optional(),
    moeda: z.string().regex(/^[A-Z]{3}$/).optional(),
  }).strict()).mutation(({ ctx, input }) => tentar(async () => {
    if (input.ligado === true) {
      if (!(await chaveYcloud())) throw new RecusaYcloud("Salve a chave da YCloud antes de ligar.");
      if (!(await segredoWebhookYcloud())) throw new RecusaYcloud("Ative os avisos de entrega antes de ligar (sem eles não dá para saber o que foi entregue).");
      const c = await conferirNumeroYcloud();
      if (!c.numeroConfere) throw new RecusaYcloud(c.aviso ?? "O número da API não é o da empresa: não dá para ligar.");
    }
    await atualizarConfigYcloud({
      ...(input.ligado !== undefined ? { ligado: input.ligado } : {}),
      ...(input.tetoDia !== undefined ? { tetoDia: input.tetoDia } : {}),
      ...(input.tetoCampanha !== undefined ? { tetoCampanha: input.tetoCampanha } : {}),
      ...(input.janelaRepeticaoDias !== undefined ? { janelaRepeticaoDias: input.janelaRepeticaoDias } : {}),
      ...(input.precoEstimado !== undefined ? { precoEstimado: input.precoEstimado === null ? null : input.precoEstimado.toFixed(4) } : {}),
      ...(input.moeda !== undefined ? { moeda: input.moeda } : {}),
    }, ctx.user.id);
    await auditarYcloud({ acao: input.ligado === true ? "disparos_ligados" : input.ligado === false ? "disparos_desligados" : "config_salva", usuarioId: ctx.user.id });
    return { success: true as const };
  }, "Não foi possível salvar.")),

  /** Modelos da conta (sob demanda: consulta a YCloud). */
  modelos: soAdmin.mutation(() => tentar(modelosDaConta, "Não consegui listar os modelos.")),

  /** Prévia: contagens, vagas do dia, custo estimado e exemplos. Não cria nada. */
  previa: soAdmin.input(entradaSchema).mutation(({ input }) => tentar(async () => {
    const s = await situacaoParaDisparo();
    if (!s.ok) throw new RecusaYcloud(s.motivo ?? "Disparo indisponível.");
    return previaParaTela(await prepararCampanha(input, s), randomUUID());
  }, "Não consegui montar a prévia.")),

  /** Confirma com a CONTAGEM vista na prévia (se mudou, recusa). Cria a campanha; o envio começa com `enviarLote`. */
  criarCampanha: soAdmin.input(entradaSchema.extend({
    confirmarQuantidade: z.number().int().positive(),
    /** devolvida pela prévia; a mesma chave duas vezes = a MESMA campanha (duas abas, clique duplo, reenvio do pedido) */
    chaveConfirmacao: z.string().regex(/^[A-Za-z0-9-]{16,64}$/, "Veja a prévia de novo antes de confirmar."),
  }).strict())
    .mutation(({ ctx, input }) => tentar(async () => {
      const { confirmarQuantidade, chaveConfirmacao, ...entrada } = input;
      return criarCampanha(entrada, confirmarQuantidade, chaveConfirmacao, ctx.user.id);
    }, "Não consegui criar a campanha.")),

  /** Um lote (cabe em 60 s). A tela chama de novo enquanto houver fila; se a função encerrar, "Continuar" retoma de onde parou. */
  enviarLote: soAdmin.input(campanhaIdSchema).mutation(({ ctx, input }) => tentar(() => enviarLote(input.campanhaId, ctx.user.id), "Falha no envio do lote.")),

  mudarCampanha: soAdmin.input(campanhaIdSchema.extend({ acao: z.enum(["pausar", "continuar", "cancelar"]) }).strict())
    .mutation(({ ctx, input }) => tentar(async () => { await mudarCampanha(input.campanhaId, input.acao, ctx.user.id); return { success: true as const }; }, "Não foi possível alterar a campanha.")),

  campanhas: soAdmin.query(() => tentar(painelCampanhas, "Não consegui ler as campanhas.")),
  detalheCampanha: soAdmin.input(campanhaIdSchema).query(({ input }) => tentar(() => detalheCampanha(input.campanhaId), "Não consegui ler a campanha.")),

  registrarOptout: soAdmin.input(z.union([
    z.object({ leadId: z.number().int().positive() }).strict(),
    z.object({ envioId: z.number().int().positive() }).strict(),
  ])).mutation(({ ctx, input }) => tentar(() => registrarOptoutPeloPainel(input, ctx.user.id), "Não foi possível registrar o pedido de não receber.")),
});
