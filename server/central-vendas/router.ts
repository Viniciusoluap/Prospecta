// Central de Vendas (12/11/2026) — router tRPC `centralVendas` (módulo CRM). Configurações, produtos,
// checklists, sequências, campanhas, templates, auditoria e fila: só administrador. Operador (colaborador) vê só
// os próprios atendimentos. A decisão da análise exige admin ou analista marcado na Central.
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import { z } from "zod";
import { leads, users, whatsappConnections, whatsappTemplates } from "../../drizzle/schema.js";
import {
  centralVendasCampanhas, centralVendasChecklists, centralVendasEventos, centralVendasFila, centralVendasLeads,
  centralVendasProdutos, centralVendasSequencias,
} from "../../drizzle/schema-central-vendas.js";
import {
  DECISOES_ANALISE, TIPOS_SEQUENCIA, configParaTela, configSchema, itemChecklistSchema, lerItensChecklist, lerPassos,
  passoSequenciaSchema, STATUS_ATENDIMENTO,
} from "../../shared/central-vendas/config.js";
import { calcularIndicadores, csvCentral, filtrar, type LinhaIndicador } from "../../shared/central-vendas/indicadores.js";
import { ROTULOS_MOTIVO, linkCampanha, slug } from "../../shared/central-vendas/regras.js";
import { CATEGORIA_TEMPLATES_CENTRAL, TEMPLATES_CENTRAL } from "../../shared/central-vendas/templates.js";
import { VARIAVEIS_TEMPLATE_PERMITIDAS } from "../../shared/whatsapp/templates.js";
import { adminProcedure, router } from "../_core/trpc.js";
import { DecisaoInvalida, podeDecidir, registrarDecisao } from "./analise.js";
import { agora, carregarConfig, cifrar, db, registrarEvento, salvarConfig } from "./base.js";
import { rotinaSeNecessario, executarRotinaCentralVendas } from "./rotina.js";

type Ctx = { user: { id: number; role: string } };
const ehAdmin = (ctx: Ctx) => ctx.user.role === "admin";
function exigirAdmin(ctx: Ctx) {
  if (!ehAdmin(ctx)) throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador altera a Central de Vendas." });
}

const filtrosSchema = z.object({
  de: z.string().date().optional().nullable(), ate: z.string().date().optional().nullable(),
  operadorId: z.number().int().positive().optional().nullable(), produtoId: z.number().int().positive().optional().nullable(),
  origem: z.string().max(100).optional().nullable(),
}).default({});

async function linhasIndicador(): Promise<LinhaIndicador[]> {
  const rows = await db().select({ cv: centralVendasLeads, nome: leads.name, canal: leads.sourceChannel }).from(centralVendasLeads)
    .innerJoin(leads, eq(leads.id, centralVendasLeads.leadId)).where(isNull(leads.deletedAt));
  return rows.map(({ cv, nome, canal }) => ({
    leadId: cv.leadId, nome, criadoEm: cv.createdAt, origem: canal ?? cv.origem, campanha: cv.campanha, produtoId: cv.produtoId,
    operadorId: cv.operadorId, primeiraMensagemEm: cv.primeiraMensagemEm, primeiraRespostaEm: cv.primeiraRespostaEm,
    qualificadoEm: cv.qualificadoEm, docsCompletosEm: cv.docsCompletosEm, enviadoAnaliseEm: cv.enviadoAnaliseEm, decisaoEm: cv.decisaoEm,
    statusAtendimento: cv.statusAtendimento, statusDocumental: cv.statusDocumental, statusAnalise: cv.statusAnalise,
  }));
}

/** Datas do filtro no fuso de Fortaleza (início e fim do dia). */
function filtrosEfetivos(ctx: Ctx, f: z.infer<typeof filtrosSchema>) {
  return {
    de: f.de ? new Date(`${f.de}T00:00:00-03:00`) : null, ate: f.ate ? new Date(`${f.ate}T23:59:59.999-03:00`) : null,
    // Operador vê só os próprios atendimentos.
    operadorId: ehAdmin(ctx) ? f.operadorId ?? null : ctx.user.id, produtoId: f.produtoId ?? null, origem: f.origem ?? null,
  };
}

async function nomes() {
  const [us, ps] = await Promise.all([
    db().select({ id: users.id, nome: users.name }).from(users).where(inArray(users.role, ["admin", "colaborador"])),
    db().select({ id: centralVendasProdutos.id, nome: centralVendasProdutos.nome }).from(centralVendasProdutos),
  ]);
  return { operadores: new Map(us.map(u => [u.id, u.nome ?? `Usuário #${u.id}`])), produtos: new Map(ps.map(p => [p.id, p.nome])) };
}

async function exigirLeadVisivel(ctx: Ctx, leadId: number) {
  const [cv] = await db().select({ operadorId: centralVendasLeads.operadorId }).from(centralVendasLeads).where(eq(centralVendasLeads.leadId, leadId)).limit(1);
  if (!cv) throw new TRPCError({ code: "NOT_FOUND", message: "Atendimento não encontrado na Central." });
  if (!ehAdmin(ctx) && cv.operadorId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "Atendimento de outro operador." });
}

const variaveisOk = new Set<string>(VARIAVEIS_TEMPLATE_PERMITIDAS);

async function conexaoAtiva() {
  const [c] = await db().select({ numero: whatsappConnections.numero }).from(whatsappConnections)
    .where(and(eq(whatsappConnections.provider, "evolution"), eq(whatsappConnections.status, "conectado"))).orderBy(whatsappConnections.id).limit(1);
  return c ?? null;
}

export const centralVendasRouter = router({
  painel: adminProcedure.input(filtrosSchema).query(async ({ ctx, input }) => {
    await rotinaSeNecessario().catch(() => null); // SLA e fila em dia ao abrir o painel
    const f = filtrosEfetivos(ctx, input);
    const todas = await linhasIndicador();
    const n = await nomes();
    const ind = calcularIndicadores(todas, f);
    return {
      indicadores: { ...ind, atendimentosPorOperador: ind.atendimentosPorOperador.map(o => ({ ...o, nome: n.operadores.get(o.operadorId) ?? `Usuário #${o.operadorId}` })) },
      opcoes: {
        operadores: ehAdmin(ctx) ? Array.from(new Set(todas.map(t => t.operadorId).filter((x): x is number => x != null))).map(id => ({ id, nome: n.operadores.get(id) ?? `Usuário #${id}` })) : [],
        produtos: Array.from(n.produtos.entries()).map(([id, nome]) => ({ id, nome })),
        origens: Array.from(new Set(todas.map(t => t.origem ?? "sem origem"))).sort(),
      },
      ativo: (await carregarConfig()).ativo,
      admin: ehAdmin(ctx),
    };
  }),

  exportarCsv: adminProcedure.input(filtrosSchema).mutation(async ({ ctx, input }) => {
    const linhas = filtrar(await linhasIndicador(), filtrosEfetivos(ctx, input)).sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());
    return { csv: csvCentral(linhas, await nomes()), total: linhas.length };
  }),

  atendimentos: adminProcedure.input(z.object({ status: z.enum(STATUS_ATENDIMENTO).optional(), analise: z.string().max(20).optional() }).default({})).query(async ({ ctx, input }) => {
    const decide = await podeDecidir(ctx.user.id);
    // Operador vê os próprios; analista vê também os que aguardam a decisão dele.
    const visiveis = ehAdmin(ctx) ? undefined : or(eq(centralVendasLeads.operadorId, ctx.user.id),
      decide ? inArray(centralVendasLeads.statusAnalise, ["em_analise", "pendente"]) : undefined);
    const rows = await db().select({ cv: centralVendasLeads, nome: leads.name, cidade: leads.city, canal: leads.sourceChannel, operador: users.name })
      .from(centralVendasLeads).innerJoin(leads, eq(leads.id, centralVendasLeads.leadId)).leftJoin(users, eq(users.id, centralVendasLeads.operadorId))
      .where(and(isNull(leads.deletedAt), visiveis,
        input.status ? eq(centralVendasLeads.statusAtendimento, input.status) : undefined,
        input.analise ? eq(centralVendasLeads.statusAnalise, input.analise) : undefined))
      .orderBy(desc(centralVendasLeads.updatedAt)).limit(300);
    return rows.map(({ cv, nome, cidade, canal, operador }) => ({
      leadId: cv.leadId, nome, cidade, origem: canal ?? cv.origem, campanha: cv.campanha, operador, operadorId: cv.operadorId,
      statusAtendimento: cv.statusAtendimento, statusDocumental: cv.statusDocumental, statusAnalise: cv.statusAnalise,
      motivo: cv.motivoTransferencia ? ROTULOS_MOTIVO[cv.motivoTransferencia as keyof typeof ROTULOS_MOTIVO] ?? cv.motivoTransferencia : null,
      resumo: cv.resumoTransferencia, pendencias: cv.pendenciasAnalise, optOut: cv.optOut, atualizadoEm: cv.updatedAt,
      podeDecidir: decide && (cv.statusAnalise === "em_analise" || cv.statusAnalise === "pendente"),
    }));
  }),

  registrarDecisao: adminProcedure.input(z.object({
    leadId: z.number().int().positive(), decisao: z.enum(DECISOES_ANALISE), pendencias: z.string().max(2000).optional(), motivoInterno: z.string().max(2000).optional(),
  })).mutation(async ({ ctx, input }) => {
    try { return await registrarDecisao({ ...input, userId: ctx.user.id }); }
    catch (e) { if (e instanceof DecisaoInvalida) throw new TRPCError({ code: "BAD_REQUEST", message: e.message }); throw e; }
  }),

  encerrar: adminProcedure.input(z.object({ leadId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await exigirLeadVisivel(ctx, input.leadId);
    await db().update(centralVendasLeads).set({ statusAtendimento: "encerrado", updatedAt: agora() }).where(eq(centralVendasLeads.leadId, input.leadId));
    await registrarEvento({ tipo: "encerrado", leadId: input.leadId, origem: "humano", payload: { por: ctx.user.id } });
    return { ok: true };
  }),

  /** Volta a permitir mensagens automáticas (opt-out) — decisão humana, registrada. */
  reativarAutomacao: adminProcedure.input(z.object({ leadId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await exigirLeadVisivel(ctx, input.leadId);
    await db().update(centralVendasLeads).set({ optOut: false, optOutEm: null, updatedAt: agora() }).where(eq(centralVendasLeads.leadId, input.leadId));
    await registrarEvento({ tipo: "opt_out_removido", leadId: input.leadId, origem: "humano", payload: { por: ctx.user.id } });
    return { ok: true };
  }),

  // ── Configurações (só admin) ──

  configuracao: adminProcedure.query(async ({ ctx }) => {
    exigirAdmin(ctx);
    const c = await carregarConfig();
    const pessoas = await db().select({ id: users.id, nome: users.name, role: users.role }).from(users)
      .where(and(eq(users.active, true), inArray(users.role, ["admin", "colaborador"]))).orderBy(users.name);
    const conn = await conexaoAtiva();
    return { config: configParaTela(c), pessoas, numeroConexao: conn?.numero ?? null };
  }),

  salvarConfiguracao: adminProcedure.input(configSchema.omit({ segredos: true })).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx);
    const atual = await carregarConfig();
    if (input.intervaloMaxSeg < input.intervaloMinSeg) throw new TRPCError({ code: "BAD_REQUEST", message: "O intervalo máximo precisa ser maior que o mínimo." });
    await salvarConfig({ ...input, segredos: atual.segredos }, ctx.user.id);
    await registrarEvento({ tipo: "configuracao_alterada", origem: "humano", payload: { por: ctx.user.id, ativo: input.ativo, modoTeste: input.modoTeste, logyca: input.logyca.ativo } });
    return { ok: true };
  }),

  /** Gera um token de entrada novo (site ou Logyca). É mostrado uma única vez; fica cifrado no banco. */
  gerarToken: adminProcedure.input(z.object({ nome: z.enum(["tokenSite", "tokenLogycaEntrada"]) })).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx);
    const token = randomBytes(24).toString("base64url");
    const c = await carregarConfig();
    await salvarConfig({ ...c, segredos: { ...c.segredos, [input.nome]: cifrar(token) } }, ctx.user.id);
    await registrarEvento({ tipo: "token_gerado", origem: "humano", payload: { nome: input.nome, por: ctx.user.id } });
    return { token };
  }),

  /** Token de envio da Logyca ou chave própria da IA: entram cifrados e nunca voltam para a tela. */
  definirSegredo: adminProcedure.input(z.object({ nome: z.enum(["tokenLogycaEnvio", "chaveAnthropic"]), valor: z.string().trim().max(500) })).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx);
    const c = await carregarConfig();
    const segredos = { ...c.segredos };
    if (input.valor) segredos[input.nome] = cifrar(input.valor); else delete segredos[input.nome];
    await salvarConfig({ ...c, segredos }, ctx.user.id);
    await registrarEvento({ tipo: input.valor ? "segredo_definido" : "segredo_removido", origem: "humano", payload: { nome: input.nome, por: ctx.user.id } });
    return { ok: true };
  }),

  // ── Base de produtos/empreendimentos (a IA só fala o que está aqui) ──

  produtos: adminProcedure.query(async () => db().select().from(centralVendasProdutos).orderBy(desc(centralVendasProdutos.ativo), centralVendasProdutos.nome)),

  salvarProduto: adminProcedure.input(z.object({
    id: z.number().int().positive().optional(), nome: z.string().trim().min(2).max(160), slug: z.string().trim().max(80).optional(),
    tipo: z.enum(["empreendimento", "produto"]), descricao: z.string().max(4000).default(""), cidade: z.string().trim().max(100).optional().nullable(),
    precoMin: z.number().min(0).max(1e10).optional().nullable(), precoMax: z.number().min(0).max(1e10).optional().nullable(),
    requisitos: z.string().max(4000).default(""), condicoes: z.string().max(4000).default(""),
    checklistId: z.number().int().positive().optional().nullable(), ativo: z.boolean().default(true),
  })).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx);
    const dados = {
      nome: input.nome, slug: slug(input.slug || input.nome), tipo: input.tipo, descricao: input.descricao, cidade: input.cidade || null,
      precoMin: input.precoMin != null ? input.precoMin.toFixed(2) : null, precoMax: input.precoMax != null ? input.precoMax.toFixed(2) : null,
      requisitos: input.requisitos, condicoes: input.condicoes, checklistId: input.checklistId ?? null, ativo: input.ativo, updatedAt: agora(),
    };
    if (!dados.slug) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe um código (letras e números)." });
    try {
      if (input.id) await db().update(centralVendasProdutos).set(dados).where(eq(centralVendasProdutos.id, input.id));
      else await db().insert(centralVendasProdutos).values(dados);
    } catch { throw new TRPCError({ code: "CONFLICT", message: "Já existe um produto com esse código." }); }
    return { ok: true };
  }),

  // ── Checklists por produto/modalidade ──

  checklists: adminProcedure.query(async () => (await db().select().from(centralVendasChecklists).orderBy(centralVendasChecklists.nome))
    .map(c => ({ ...c, itens: lerItensChecklist(c.documentos) }))),

  salvarChecklist: adminProcedure.input(z.object({
    id: z.number().int().positive().optional(), nome: z.string().trim().min(2).max(120), slug: z.string().trim().max(60).optional(),
    itens: z.array(itemChecklistSchema).min(1).max(40), ativo: z.boolean().default(true),
  })).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx);
    if (new Set(input.itens.map(i => i.chave)).size !== input.itens.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Cada documento precisa de uma chave diferente." });
    const dados = { nome: input.nome, slug: slug(input.slug || input.nome), documentos: JSON.stringify(input.itens), ativo: input.ativo, updatedAt: agora() };
    try {
      if (input.id) await db().update(centralVendasChecklists).set(dados).where(eq(centralVendasChecklists.id, input.id));
      else await db().insert(centralVendasChecklists).values(dados);
    } catch { throw new TRPCError({ code: "CONFLICT", message: "Já existe um checklist com esse código." }); }
    return { ok: true };
  }),

  // ── Sequências (follow-up, sem resposta, reativação) ──

  sequencias: adminProcedure.query(async () => (await db().select().from(centralVendasSequencias).orderBy(centralVendasSequencias.tipo))
    .map(s => ({ ...s, passosLista: lerPassos(s.passos) }))),

  salvarSequencia: adminProcedure.input(z.object({
    id: z.number().int().positive().optional(), tipo: z.enum(TIPOS_SEQUENCIA), nome: z.string().trim().min(2).max(120),
    passos: z.array(passoSequenciaSchema).min(1).max(10), ativo: z.boolean().default(true),
  })).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx);
    const dados = { tipo: input.tipo, nome: input.nome, passos: JSON.stringify(input.passos), ativo: input.ativo, updatedAt: agora() };
    if (input.id) await db().update(centralVendasSequencias).set(dados).where(eq(centralVendasSequencias.id, input.id));
    else await db().insert(centralVendasSequencias).values(dados);
    return { ok: true };
  }),

  // ── Campanhas e gerador de links wa.me ──

  campanhas: adminProcedure.query(async () => {
    const c = await carregarConfig();
    const conn = await conexaoAtiva();
    const numero = c.numeroCampanhas || conn?.numero || "";
    const rows = await db().select().from(centralVendasCampanhas).orderBy(desc(centralVendasCampanhas.createdAt));
    return { numero, campanhas: rows.map(r => ({ ...r, link: numero ? linkCampanha(numero, r.codigo) : null })) };
  }),

  criarCampanha: adminProcedure.input(z.object({ canal: z.string().trim().min(2).max(60), nome: z.string().trim().min(2).max(160), produtoId: z.number().int().positive().optional().nullable() })).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx);
    const [p] = input.produtoId ? await db().select({ slug: centralVendasProdutos.slug }).from(centralVendasProdutos).where(eq(centralVendasProdutos.id, input.produtoId)).limit(1) : [];
    const base = slug([input.canal, p?.slug].filter(Boolean).join("-")) || "campanha";
    const existentes = new Set((await db().select({ c: centralVendasCampanhas.codigo }).from(centralVendasCampanhas).where(like(centralVendasCampanhas.codigo, `${base}%`))).map(r => r.c));
    let codigo = base;
    for (let i = 2; existentes.has(codigo); i++) codigo = `${base}-${i}`;
    await db().insert(centralVendasCampanhas).values({ codigo, canal: slug(input.canal), nome: input.nome, produtoId: input.produtoId ?? null });
    return { codigo };
  }),

  // ── Templates (whatsapp_templates, slug cv-*) ──

  templates: adminProcedure.query(async () => {
    const rows = await db().select().from(whatsappTemplates).where(like(whatsappTemplates.slug, "cv-%"));
    return TEMPLATES_CENTRAL.map(t => {
      const r = rows.find(x => x.slug === t.slug);
      return { slug: t.slug, nome: t.nome, conteudo: r?.conteudo ?? t.conteudo, personalizado: Boolean(r), ativo: r?.ativo ?? true };
    });
  }),

  salvarTemplate: adminProcedure.input(z.object({ slug: z.string().regex(/^cv-[a-z0-9-]+$/), conteudo: z.string().trim().min(2).max(4096) })).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx);
    const t = TEMPLATES_CENTRAL.find(x => x.slug === input.slug);
    if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Template da Central não encontrado." });
    const invalidas = Array.from(input.conteudo.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)).map(m => m[1].toLowerCase()).filter(v => !variaveisOk.has(v));
    if (invalidas.length) throw new TRPCError({ code: "BAD_REQUEST", message: `Variáveis inválidas: ${Array.from(new Set(invalidas)).map(v => `{{${v}}}`).join(", ")}.` });
    await db().insert(whatsappTemplates).values({ slug: t.slug, nome: t.nome, categoria: CATEGORIA_TEMPLATES_CENTRAL, conteudo: input.conteudo, criadoPorId: ctx.user.id, atualizadoPorId: ctx.user.id })
      .onConflictDoUpdate({ target: whatsappTemplates.slug, set: { conteudo: input.conteudo, ativo: true, atualizadoPorId: ctx.user.id, updatedAt: agora() } });
    return { ok: true };
  }),

  // ── Auditoria e fila ──

  auditoria: adminProcedure.input(z.object({ leadId: z.number().int().positive().optional() }).default({})).query(async ({ ctx, input }) => {
    exigirAdmin(ctx);
    const [eventos, fila] = await Promise.all([
      db().select().from(centralVendasEventos).where(input.leadId ? eq(centralVendasEventos.leadId, input.leadId) : undefined).orderBy(desc(centralVendasEventos.id)).limit(200),
      db().select({ id: centralVendasFila.id, tipo: centralVendasFila.tipo, leadId: centralVendasFila.leadId, status: centralVendasFila.status, tentativas: centralVendasFila.tentativas,
        proxima: centralVendasFila.proximaTentativaEm, erro: centralVendasFila.ultimoErro, proativa: centralVendasFila.proativa, criadoEm: centralVendasFila.createdAt })
        .from(centralVendasFila).where(input.leadId ? eq(centralVendasFila.leadId, input.leadId) : undefined).orderBy(desc(centralVendasFila.id)).limit(200),
    ]);
    return { eventos, fila };
  }),

  /** Recoloca na fila um item "falhou" ou "incerto" (decisão humana: "incerto" pode já ter saído). */
  reprocessar: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    exigirAdmin(ctx);
    const r = await db().update(centralVendasFila).set({ status: "pendente", tentativas: 0, proximaTentativaEm: agora(), updatedAt: agora() })
      .where(and(eq(centralVendasFila.id, input.id), inArray(centralVendasFila.status, ["falhou", "incerto"]))).returning({ id: centralVendasFila.id, leadId: centralVendasFila.leadId });
    if (!r.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Só itens com falha ou incertos podem ser reprocessados." });
    await registrarEvento({ tipo: "reprocessamento_manual", leadId: r[0].leadId, origem: "humano", payload: { job: input.id, por: ctx.user.id } });
    return { ok: true };
  }),

  executarRotina: adminProcedure.mutation(async ({ ctx }) => {
    exigirAdmin(ctx);
    return executarRotinaCentralVendas({ limiteMs: 20_000 });
  }),
});
