// EPIC-027 C7 (20/11/2026) — router tRPC "whatsappOficial": cartão de Integrações (chave, teste, avisos de entrega, interruptor e
// tetos), modelos, prévia, criação e envio das campanhas pela API oficial (YCloud) e painel.
// C7.1 (21/11/2026) — DOIS níveis, conferidos aqui por PAPEL + MÓDULO (decisão do dono: "eu ou colaborador se estiver marcado
// WhatsApp pra ele"):
// - OPERAR campanha (`operar`): admin ativo OU colaborador ativo com o módulo WhatsApp — prontidão, modelos, prévia, confirmar,
//   lotes, pausar/continuar/cancelar, painel, falhas (telefone mascarado) e "não enviar mais".
// - ADMINISTRAR a integração (`soAdmin`): só admin por papel — chave, testar, avisos de entrega (segredo), interruptor, tetos,
//   janela, preço, estado completo (`status`) e auditoria.
// `whatsappOficial` NÃO está no mapa de módulos de `adminProcedure` (o corretor passa em `whatsapp.*`, aqui nunca).
// Nenhuma resposta leva a chave, o segredo ou telefones de destinatários (só mascarados); a do colaborador nem "terminando em…".
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc.js";
import { parsePermissions } from "../../shared/admin-permissions.js";
import { ErroYcloud, criarEndpointYcloud, listarNumerosYcloud, semSegredo } from "../_core/ycloud.js";
import {
  MAX_DESTINATARIOS_CAMPANHA, ROTULO_QUALIDADE, ROTULO_STATUS_NUMERO, podeAdministrarIntegracaoOficial, podeOperarCampanhaOficial,
} from "../../shared/whatsapp/ycloud.js";
import {
  RecusaYcloud, criarCampanha, detalheCampanha, enviarLote, mudarCampanha, painelCampanhas, prepararCampanha, previaParaTela,
  registrarOptoutPeloPainel, situacaoParaDisparo, totalOptout, usadosNas24h, vagasDoDia,
} from "./campanhas.js";
import {
  CHAVE_SEGREDO_YCLOUD, EVENTOS_YCLOUD, atualizarConfigYcloud, auditarYcloud, chaveYcloud, depsYcloud, finalDoSegredo, gravarChaveYcloud, gravarSegredoWebhookYcloud,
  lerConfigYcloud, listarAuditoriaYcloud, normalizarChaveYcloud, type AutorYcloud, normalizarSegredoWebhook, segredoWebhookYcloud, urlWebhookYcloud,
} from "./config.js";
import { conferirNumeroYcloud, escolherNumeroDaEmpresa, modelosDaConta } from "./conta.js";
import * as db from "../db.js";

/** Administrar a integração: só admin ativo, por papel (o módulo não basta). */
const soAdmin = adminProcedure.use(({ ctx, next }) => {
  if (!podeAdministrarIntegracaoOficial({ perfil: ctx.user.role, ativo: ctx.user.active ?? true })) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador configura a API oficial do WhatsApp." });
  }
  return next();
});
/** Operar campanha: admin ativo ou colaborador ativo com o módulo WhatsApp. Corretor, cliente, empreiteiro e inativo, nunca. */
const operar = protectedProcedure.use(({ ctx, next }) => {
  const u = ctx.user;
  if (!podeOperarCampanhaOficial({ perfil: u.role, ativo: u.active ?? true, permissoes: parsePermissions(u.permissions) })) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Campanha pela API oficial: só o administrador ou colaborador com o módulo WhatsApp." });
  }
  return next();
});
const autorDe = (u: { id: number; role: string }): AutorYcloud => ({ id: u.id, papel: u.role });

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

/**
 * C7.1 — o que quem OPERA vê: só se dá para disparar, em linguagem simples (sem chave, segredo, "terminando em…", número ou tier).
 * Lê o estado guardado (rápido); a conferência na YCloud acontece de novo na prévia, na confirmação e em cada lote.
 */
async function prontidao() {
  const [cfg, chave, segredo] = await Promise.all([lerConfigYcloud(), chaveYcloud(), segredoWebhookYcloud()]);
  const usados = await usadosNas24h(depsYcloud().agora());
  const vagas = vagasDoDia(cfg, cfg.limiteDiario ?? Number.POSITIVE_INFINITY, usados);
  const restanteHoje = Number.isFinite(vagas.restante) ? vagas.restante : null;
  const motivo = !chave || !segredo ? "A API oficial ainda não foi configurada pelo administrador."
    : !cfg.ligado ? "Os disparos pela API oficial estão desligados pelo administrador."
    : !cfg.numeroConfere ? "O número da API oficial não confere com o número da empresa: os disparos ficam bloqueados até o administrador resolver."
    : restanteHoje === 0 ? "O limite de envios de hoje já foi usado. Amanhã o limite volta."
    : null;
  return { pronta: motivo === null, motivo, ligado: cfg.ligado, numeroConfere: cfg.numeroConfere, restanteHoje, tetoCampanha: cfg.tetoCampanha, janelaRepeticaoDias: cfg.janelaRepeticaoDias };
}

export const whatsappOficialRouter = router({
  // ── ADMINISTRAR (só admin por papel) ──
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
    await auditarYcloud({ acao: "chave_salva", usuarioId: ctx.user.id, papel: ctx.user.role });
    return { success: true as const, final: finalDoSegredo(chave), numeroConfere: c.numeroConfere, aviso: c.aviso };
  }, "Chave da YCloud não aceita.")),

  removerChave: soAdmin.mutation(({ ctx }) => tentar(async () => {
    await db.saveDashboardSetting(CHAVE_SEGREDO_YCLOUD, "");
    await atualizarConfigYcloud({ ligado: false, numeroConfere: false }, ctx.user.id);
    await auditarYcloud({ acao: "chave_removida", usuarioId: ctx.user.id, papel: ctx.user.role });
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
    await auditarYcloud({ acao: "avisos_ativados", usuarioId: ctx.user.id, papel: ctx.user.role, detalhe: segredo ? "segredo recebido" : "sem segredo na resposta" });
    return { success: true as const, jaAtivo: false, precisaSegredo: !segredo };
  }, "Não consegui ativar os avisos de entrega.")),

  /** Segredo digitado pelo dono (quando o endpoint foi criado no painel da YCloud). */
  salvarSegredoAvisos: soAdmin.input(z.object({ segredo: z.string().max(300) }).strict()).mutation(({ ctx, input }) => tentar(async () => {
    await gravarSegredoWebhookYcloud(normalizarSegredoWebhook(input.segredo));
    await auditarYcloud({ acao: "segredo_avisos_salvo", usuarioId: ctx.user.id, papel: ctx.user.role });
    return { success: true as const };
  }, "Não foi possível salvar o segredo.")),

  salvarConfig: soAdmin.input(z.object({
    ligado: z.boolean().optional(),
    tetoDia: z.number().int().min(1).max(100_000).optional(),
    tetoCampanha: z.number().int().min(1).max(MAX_DESTINATARIOS_CAMPANHA).optional(),
    janelaRepeticaoDias: z.number().int().min(1, "Mínimo 1 dia: a mesma pessoa nunca recebe o mesmo modelo duas vezes no mesmo dia.").max(90).optional(),
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
    await auditarYcloud({ acao: input.ligado === true ? "disparos_ligados" : input.ligado === false ? "disparos_desligados" : "config_salva", usuarioId: ctx.user.id, papel: ctx.user.role });
    return { success: true as const };
  }, "Não foi possível salvar.")),

  /** Auditoria completa: quem fez o quê (nome e papel), sem telefone nem segredo. */
  auditoria: soAdmin.query(() => tentar(() => listarAuditoriaYcloud(), "Não consegui ler a auditoria.")),

  // ── OPERAR (admin ou colaborador com o módulo WhatsApp) ──

  /** Se dá para disparar agora, em linguagem simples (nunca a chave, o segredo nem o número). */
  prontidao: operar.query(() => tentar(prontidao, "Não consegui ler a situação da API oficial.")),

  /** Modelos da conta (sob demanda: consulta a YCloud). */
  modelos: operar.mutation(() => tentar(modelosDaConta, "Não consegui listar os modelos.")),

  /** Prévia: contagens, vagas do dia, custo estimado e exemplos. Não cria nada. */
  previa: operar.input(entradaSchema).mutation(({ input }) => tentar(async () => {
    const s = await situacaoParaDisparo();
    if (!s.ok) throw new RecusaYcloud(s.motivo ?? "Disparo indisponível.");
    return previaParaTela(await prepararCampanha(input, s), randomUUID());
  }, "Não consegui montar a prévia.")),

  /** Confirma com a CONTAGEM vista na prévia (se mudou, recusa). Cria a campanha; o envio começa com `enviarLote`. */
  criarCampanha: operar.input(entradaSchema.extend({
    confirmarQuantidade: z.number().int().positive(),
    /** devolvida pela prévia; a mesma chave duas vezes = a MESMA campanha (duas abas, clique duplo, reenvio do pedido) */
    chaveConfirmacao: z.string().regex(/^[A-Za-z0-9-]{16,64}$/, "Veja a prévia de novo antes de confirmar."),
  }).strict())
    .mutation(({ ctx, input }) => tentar(async () => {
      const { confirmarQuantidade, chaveConfirmacao, ...entrada } = input;
      return criarCampanha(entrada, confirmarQuantidade, chaveConfirmacao, autorDe(ctx.user));
    }, "Não consegui criar a campanha.")),

  /** Um lote (cabe em 60 s). A tela chama de novo enquanto houver fila; se a função encerrar, "Continuar" retoma de onde parou. */
  enviarLote: operar.input(campanhaIdSchema).mutation(({ ctx, input }) => tentar(() => enviarLote(input.campanhaId, autorDe(ctx.user)), "Falha no envio do lote.")),

  mudarCampanha: operar.input(campanhaIdSchema.extend({ acao: z.enum(["pausar", "continuar", "cancelar"]) }).strict())
    .mutation(({ ctx, input }) => tentar(async () => { await mudarCampanha(input.campanhaId, input.acao, autorDe(ctx.user)); return { success: true as const }; }, "Não foi possível alterar a campanha.")),

  campanhas: operar.query(() => tentar(painelCampanhas, "Não consegui ler as campanhas.")),
  detalheCampanha: operar.input(campanhaIdSchema).query(({ input }) => tentar(() => detalheCampanha(input.campanhaId), "Não consegui ler a campanha.")),

  registrarOptout: operar.input(z.union([
    z.object({ leadId: z.number().int().positive() }).strict(),
    z.object({ envioId: z.number().int().positive() }).strict(),
  ])).mutation(({ ctx, input }) => tentar(() => registrarOptoutPeloPainel(input, autorDe(ctx.user)), "Não foi possível registrar o pedido de não receber.")),
});
