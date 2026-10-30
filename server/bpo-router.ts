// BPO Financeiro — clientes, lançamentos e DRE (saiu de routers.ts no pedido de 25/10 noite).
// Itens 9, 10 e 11: cliente ligado ao lead do CRM (ou cadastro livre), totais por cliente,
// "+ Lançamento" só Cobrança/Despesa com categoria e DRE também por categoria.
import { TRPCError } from "@trpc/server";
import { and, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc.js";
import { requireModule } from "./_core/rbac.js";
import * as db from "./db.js";
import {
  avaliacoes, bankTransactions, bpoClients, bpoLancamentos, constructionProjects,
  financiamentos, imoveis, incorporationStudies, leads, operationalCommissions,
  operationalProjects, regularizacoes, tasks,
} from "../drizzle/schema.js";
import {
  CATEGORIAS_BPO,
  TRANSFERENCIA_INTERNA,
  dreDasCategorias,
  dreDosLancamentos,
  filtrarPorCompetencia,
  normalizarTitular,
  resumoPorCliente,
} from "../shared/financeiro/bpo-extrato.js";
import { aplicarClassificacaoEmLote, lancamentosComTitular } from "./bpo-extrato.js";
import {
  CATEGORIAS_DESPESA_OPERACIONAL, CATEGORIAS_RECEITA_OPERACIONAL,
  validarDetalhesOperacionais,
  catalogoDaCategoria,
  categoriaContabilDaOperacional,
  categoriaSemVinculo,
} from "../shared/financeiro/bpo-operacional.js";
import { SERVICOS_PROGRESSO } from "../shared/financeiro/progresso.js";
import { editarLancamentoAuditavel } from "./bpo-auditoria.js";
import { registrarRecebimento } from "./bpo-recebimentos.js";
import { combinarPagamentos, excluirLancamentosEmLote, previaCombinacao, previaExclusaoLote } from "./bpo-lote.js";
import { mensagemLancamentoCombinado } from "../shared/financeiro/bpo-lote.js";
import { aplicarVinculosEmMassa, previaVinculosEmMassa, sugestoesDoLancamento, vincularLancamentoACliente } from "./bpo-vinculo-cliente.js";

const texto = (max: number) => z.string().trim().max(max).optional().nullable();

export const clienteBpoSchema = z.object({
  leadId: z.number().int().positive().nullable().optional(),
  razaoSocial: texto(255),
  cnpj: texto(20),
  cpf: texto(14),
  responsavel: texto(255),
  email: texto(255),
  telefone: texto(20),
  servicos: z.array(z.string()).default([]),
  honorarios: z.number().min(0).nullable().optional(),
  diaVencimento: z.number().int().min(1).max(31).nullable().optional(),
  dataInicio: z.union([z.string(), z.date()]).nullable().optional(),
  observacoes: z.string().max(5000).optional().nullable(),
});
export type ClienteBpoEntrada = z.infer<typeof clienteBpoSchema>;

type LeadBasico = { id: number; name: string; phone: string | null; email: string | null; cpf: string | null };

const vazio = (s: string | null | undefined) => (s ?? "").trim();

/**
 * Pedido de 25/10 (noite): antes o cadastro exigia honorários, responsável, telefone e data de
 * início (NOT NULL no banco) — quem cadastra cliente de obra ou fornecedor não tem esses dados e o
 * cadastro não saía. Agora só o nome é obrigatório (ou o lead); o resto tem padrão.
 */
export function montarClienteBpo(input: ClienteBpoEntrada, lead: LeadBasico | null) {
  const razaoSocial = vazio(input.razaoSocial) || vazio(lead?.name);
  if (razaoSocial.length < 2) throw new Error("Informe o nome do cliente ou escolha um lead do CRM.");
  const data = input.dataInicio ? new Date(input.dataInicio) : null;
  return {
    razaoSocial: razaoSocial.slice(0, 255),
    cnpj: vazio(input.cnpj) || null,
    cpf: (vazio(input.cpf) || vazio(lead?.cpf)).slice(0, 14) || null,
    responsavel: (vazio(input.responsavel) || razaoSocial).slice(0, 255),
    email: (vazio(input.email) || vazio(lead?.email)).slice(0, 255) || null,
    telefone: (vazio(input.telefone) || vazio(lead?.phone)).slice(0, 20),
    servicos: JSON.stringify(input.servicos ?? []),
    honorarios: (input.honorarios ?? 0).toFixed(2),
    diaVencimento: input.diaVencimento ?? 10,
    dataInicio: data && !Number.isNaN(data.getTime()) ? data : new Date(),
    observacoes: input.observacoes ?? "",
    leadId: lead?.id ?? null,
  };
}

async function leadBasico(id: number): Promise<LeadBasico | null> {
  const [l] = await db.getDb()
    .select({ id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, cpf: leads.cpf })
    .from(leads).where(and(eq(leads.id, id), isNull(leads.deletedAt))).limit(1);
  return l ?? null;
}

/** Vincula ao cliente novo as movimentações do mesmo titular que ainda estão sem cliente. */
async function vincularMovimentacoesDoCliente(clienteId: number, nomes: (string | null | undefined)[]) {
  const alvos = new Set(nomes.map(normalizarTitular).filter(n => n.length >= 3));
  if (!alvos.size) return 0;
  const candidatas = await db.getDb()
    .select({ id: bankTransactions.id, titular: bankTransactions.titular })
    .from(bankTransactions)
    .where(and(isNotNull(bankTransactions.titular), isNull(bankTransactions.bpoClienteId)));
  const ids = candidatas.filter(c => alvos.has(normalizarTitular(c.titular))).map(c => c.id);
  return aplicarClassificacaoEmLote(ids, { bpoClienteId: clienteId });
}

/** Clientes com total recebido e em aberto (cobranças pagas e não pagas). */
export async function clientesComTotais() {
  const d = db.getDb();
  const [clientes, lancs] = await Promise.all([
    d.select({ cliente: bpoClients, nomeLead: leads.name }).from(bpoClients)
      .leftJoin(leads, eq(leads.id, bpoClients.leadId)).orderBy(bpoClients.razaoSocial),
    d.select({ clienteId: bpoLancamentos.clienteId, tipo: bpoLancamentos.tipo, valor: bpoLancamentos.valor, valorRecebido: bpoLancamentos.valorRecebido, pago: bpoLancamentos.pago, categoria: bpoLancamentos.categoria })
      .from(bpoLancamentos).where(and(isNotNull(bpoLancamentos.clienteId), isNull(bpoLancamentos.combinadaEmId))),
  ]);
  const totais = resumoPorCliente(lancs);
  return clientes.map(({ cliente, nomeLead }) => ({
    ...cliente,
    nomeLead,
    totalRecebido: totais.get(cliente.id)?.recebido ?? 0,
    totalEmAberto: totais.get(cliente.id)?.emAberto ?? 0,
  }));
}

/** Para a tela do lead: quanto o cliente já pagou e o que está em aberto (clientes BPO ligados ao lead). */
export async function resumoBpoDoLead(leadId: number) {
  const d = db.getDb();
  const clientes = await d.select({ id: bpoClients.id, razaoSocial: bpoClients.razaoSocial }).from(bpoClients).where(eq(bpoClients.leadId, leadId));
  if (!clientes.length) return { clientes: [], totalRecebido: 0, totalEmAberto: 0, lancamentos: [] };
  const ids = clientes.map(c => c.id);
  const lancs = (await lancamentosComTitular()).filter(l => l.clienteId != null && ids.includes(l.clienteId));
  let recebido = 0, emAberto = 0;
  for (const t of Array.from(resumoPorCliente(lancs).values())) { recebido += Math.round(t.recebido * 100); emAberto += Math.round(t.emAberto * 100); }
  return { clientes, totalRecebido: recebido / 100, totalEmAberto: emAberto / 100, lancamentos: lancs };
}

const CATEGORIAS_MANUAIS = CATEGORIAS_BPO.filter(c => c !== TRANSFERENCIA_INTERNA) as [string, ...string[]];

export type VinculoOperacional = { id: string; rotulo: string; clienteNome: string | null; href: string; leadId?: string | null };

/** Catálogo real dos módulos; rótulo é só apresentação, o vínculo é sempre pelo ID. */
export async function catalogoVinculosOperacionais() {
  const d = db.getDb();
  const [obras, regs, comissoes, projetos, avals, propriedades, incorporacoes, financs, tarefasLista] = await Promise.all([
    d.select({ id: constructionProjects.id, rotulo: constructionProjects.title, clienteNome: leads.name, leadId: constructionProjects.leadId }).from(constructionProjects).leftJoin(leads, eq(leads.id, constructionProjects.leadId)),
    d.select({ id: regularizacoes.id, rotulo: regularizacoes.type, clienteNome: regularizacoes.clientName, leadId: regularizacoes.leadId }).from(regularizacoes),
    d.select({ id: operationalCommissions.id, rotulo: operationalCommissions.property }).from(operationalCommissions),
    d.select({ id: operationalProjects.id, rotulo: operationalProjects.name, clienteNome: operationalProjects.clientName, leadId: operationalProjects.leadId }).from(operationalProjects),
    d.select({ id: avaliacoes.id, rotulo: avaliacoes.numero, clienteNome: avaliacoes.clienteNome, leadId: avaliacoes.leadId }).from(avaliacoes),
    d.select({ id: imoveis.id, rotulo: imoveis.titulo }).from(imoveis),
    d.select({ id: incorporationStudies.id, rotulo: incorporationStudies.name }).from(incorporationStudies),
    d.select({ id: financiamentos.id, rotulo: financiamentos.clienteNome, clienteNome: financiamentos.clienteNome, leadId: financiamentos.leadId }).from(financiamentos),
    d.select({ id: tasks.id, rotulo: tasks.title }).from(tasks),
  ]);
  const map = <T extends { id: number; rotulo: string }>(xs: T[], base: string): VinculoOperacional[] => xs.map(x => ({
    id: String(x.id), rotulo: x.rotulo, clienteNome: "clienteNome" in x ? String(x.clienteNome ?? "") || null : null, href: `${base}/${x.id}`,
    // Lote 3, item 17: lead do registro operacional (sinal "ID interno" para vincular cliente).
    leadId: "leadId" in x && x.leadId != null ? String(x.leadId) : null,
  }));
  return {
    obras: map(obras, "/admin/obras"), regularizacoes: map(regs, "/admin/regularizacoes"),
    comissoes: map(comissoes, "/admin/comissoes"), projetos: map(projetos, "/admin/projetos"),
    avaliacoes: map(avals, "/admin/avaliacoes"), imoveis: map(propriedades, "/admin/imoveis"),
    incorporacao: map(incorporacoes, "/admin/incorporacao"), financiamentos: map(financs, "/admin/financiamentos"),
    tarefas_agenda: map(tarefasLista, "/admin/tarefas"),
    etapasObra: SERVICOS_PROGRESSO.map(({ chave, nome }) => ({ chave, nome })),
  };
}

export const lancamentoBpoSchema = z.object({
  requestKey: z.string().uuid(),
  // Item 11: Cobrança grava o tipo "receita" (o mesmo das entradas do extrato).
  tipo: z.enum(["cobranca", "despesa"]),
  // Item 12 (lote 3): a classificação contábil saiu da tela; quando não vier, o servidor deriva
  // da Categoria Operacional (categoriaContabilDaOperacional).
  categoria: z.enum(CATEGORIAS_MANUAIS, { message: "Escolha a categoria." }).optional(),
  clienteId: z.number().int().positive().nullable().optional(),
  clienteNomeLivre: z.string().trim().max(255).optional().nullable(),
  descricao: z.string().trim().min(1).max(500),
  valor: z.number().positive(),
  vencimento: z.union([z.string(), z.date()]),
  competencia: z.string().regex(/^\d{4}-\d{2}$/, "Competência no formato AAAA-MM"),
  centroCustos: z.string().trim().max(100).optional().nullable(),
  categoriaOperacional: z.string().trim().max(40),
  vinculoOperacionalId: z.string().trim().max(80).optional().nullable(),
  tipoDespesaObra: z.string().trim().max(30).optional().nullable(),
  etapaObra: z.string().trim().max(80).optional().nullable(),
});

/**
 * Item 12: sem classificação contábil na tela, a edição mantém a `categoria` gravada (extrato,
 * Asaas e lançamentos antigos preservam o histórico) e só recalcula pela Categoria Operacional quando
 * ela (ou o tipo da despesa de obra) muda, ou quando o lançamento ainda não tinha categoria.
 */
export function categoriaNaEdicao(
  tipo: "cobranca" | "despesa",
  antes: { categoria: string | null; categoriaOperacional: string | null; tipoDespesaObra: string | null },
  depois: { categoriaOperacional?: string | null; tipoDespesaObra?: string | null },
): string {
  const op = depois.categoriaOperacional || null;
  const mudou = op !== (antes.categoriaOperacional || null) || (depois.tipoDespesaObra || null) !== (antes.tipoDespesaObra || null);
  if (op && (mudou || !antes.categoria)) return categoriaContabilDaOperacional(tipo, op, depois.tipoDespesaObra);
  return antes.categoria || categoriaContabilDaOperacional(tipo, op, depois.tipoDespesaObra);
}

const entradaLoteSchema = z.object({
  aba: z.enum(["cobrancas", "despesas"]),
  modo: z.enum(["selecionados", "tudo"]),
  ids: z.array(z.number().int().positive()).max(5000).optional(),
  filtros: z.object({
    busca: z.string().max(200).nullish(), clienteId: z.union([z.string(), z.number()]).nullish(),
    mes: z.string().regex(/^\d{2}$/).nullish(), ano: z.string().regex(/^\d{4}$/).nullish(),
    status: z.enum(["todas", "pendentes", "pagas", "vencidas", "parciais"]).nullish(),
    tipo: z.enum(["todos", "honorario", "reembolso", "outros"]).nullish(),
    categoriaOperacional: z.string().max(40).nullish(), vinculoOperacionalId: z.string().max(80).nullish(),
  }).optional(),
});

const filtroDreSchema = z.object({
  mes: z.string().regex(/^(0[1-9]|1[0-2])$/).nullish(),
  ano: z.string().regex(/^\d{4}$/).nullish(),
}).optional();

export const bpoRouter = router({
  clientes: router({
    list: adminProcedure.query(() => clientesComTotais()),

    /** Busca de lead do CRM por nome ou telefone (formulário do cliente BPO). */
    buscarLeads: adminProcedure.input(z.object({ q: z.string().trim().min(2).max(100) })).query(async ({ input }) => {
      const digitos = input.q.replace(/\D/g, "");
      const filtros = [ilike(leads.name, `%${input.q}%`)];
      if (digitos.length >= 4) filtros.push(sql`regexp_replace(${leads.phone}, '\\D', '', 'g') like ${`%${digitos}%`}`);
      return db.getDb()
        .select({ id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, cpf: leads.cpf })
        .from(leads).where(and(isNull(leads.deletedAt), or(...filtros))).orderBy(leads.name).limit(20);
    }),

    create: protectedProcedure.input(clienteBpoSchema).mutation(async ({ input, ctx }) => {
      requireModule(ctx, "bpo");
      const lead = input.leadId ? await leadBasico(input.leadId) : null;
      if (input.leadId && !lead) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado." });
      let valores;
      try { valores = montarClienteBpo(input, lead); }
      catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Dados inválidos." }); }
      const [criado] = await db.getDb().insert(bpoClients).values(valores).returning();
      const vinculadas = await vincularMovimentacoesDoCliente(criado.id, [criado.razaoSocial, lead?.name]).catch(() => 0);
      return { ...criado, vinculadas };
    }),

    /** Importação idempotente: leadId estável; dados financeiros nunca são sobrescritos. */
    importarCrm: adminProcedure.mutation(async () => db.getDb().transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bpo_importar_clientes_crm'))`);
      const [crm, existentes] = await Promise.all([
        tx.select({ id: leads.id, name: leads.name, phone: leads.phone, email: leads.email, cpf: leads.cpf }).from(leads).where(isNull(leads.deletedAt)),
        tx.select().from(bpoClients),
      ]);
      const porLead = new Map(existentes.map(c => [c.leadId!, c]));
      let inseridos = 0, atualizados = 0, inalterados = 0;
      for (const lead of crm) {
        const documento = (lead.cpf ?? "").replace(/\D/g, "");
        const candidatos = documento.length >= 11 ? existentes.filter(c => (c.cpf ?? c.cnpj ?? "").replace(/\D/g, "") === documento) : [];
        if (!porLead.has(lead.id) && candidatos.length > 1) throw new TRPCError({ code: "CONFLICT", message: "Há cadastros BPO duplicados com o mesmo documento. Revise-os antes de importar." });
        if (!porLead.has(lead.id) && candidatos[0]?.leadId && candidatos[0].leadId !== lead.id) throw new TRPCError({ code: "CONFLICT", message: "O documento do CRM já pertence a outro cliente importado. Revise os cadastros duplicados no CRM." });
        const atual = porLead.get(lead.id) ?? candidatos[0];
        if (!atual) {
          const [novo] = await tx.insert(bpoClients).values(montarClienteBpo({ servicos: [] }, lead)).returning();
          existentes.push(novo);
          inseridos++;
          continue;
        }
        const dados = { leadId: lead.id, razaoSocial: lead.name, cpf: lead.cpf || null, email: lead.email || null, telefone: lead.phone || "", updatedAt: new Date() };
        if (atual.leadId !== lead.id || atual.razaoSocial !== dados.razaoSocial || atual.cpf !== dados.cpf || atual.email !== dados.email || atual.telefone !== dados.telefone) {
          await tx.update(bpoClients).set(dados).where(eq(bpoClients.id, atual.id)); atualizados++;
          atual.leadId = lead.id;
        } else inalterados++;
      }
      return { elegiveis: crm.length, inseridos, atualizados, inalterados };
    })),

    updateStatus: protectedProcedure
      .input(z.object({ id: z.number(), status: z.enum(["ativo", "pausado", "encerrado"]) }))
      .mutation(async ({ input, ctx }) => {
        requireModule(ctx, "bpo");
        await db.updateBpoClientStatus(input.id, input.status);
        return { success: true };
      }),

    /** Item 10: resumo para a tela do lead (o orquestrador liga no AdminLeadDetail). */
    resumoPorLead: adminProcedure.input(z.object({ leadId: z.number().int().positive() })).query(({ input }) => resumoBpoDoLead(input.leadId)),
  }),

  lancamentos: router({
    receber: adminProcedure.input(z.object({ id: z.number().int().positive(), requestKey: z.string().uuid(), valor: z.number().positive(), recebidoEm: z.string().date(), observacoes: z.string().trim().max(1000).optional() })).mutation(async ({ input, ctx }) => {
      const [l] = await db.getDb().select({ combinadaEmId: bpoLancamentos.combinadaEmId }).from(bpoLancamentos).where(eq(bpoLancamentos.id, input.id)).limit(1);
      if (l?.combinadaEmId) throw new TRPCError({ code: "BAD_REQUEST", message: mensagemLancamentoCombinado(l.combinadaEmId) });
      return registrarRecebimento({ ...input, recebidoEm: new Date(`${input.recebidoEm}T12:00:00Z`) }, ctx.user.id);
    }),
    list: adminProcedure.query(() => lancamentosComTitular()),

    catalogoOperacional: adminProcedure.query(() => catalogoVinculosOperacionais()),

    // Lote 3, item 17: "Cadastro livre" → cliente do CRM (sugestão por prioridade + confirmação).
    sugestoesCliente: adminProcedure.input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => sugestoesDoLancamento(input.id, await catalogoVinculosOperacionais())),
    vincularCliente: adminProcedure.input(z.object({
      id: z.number().int().positive(), version: z.number().int().positive(),
      clienteId: z.number().int().positive().nullable().optional(), leadId: z.number().int().positive().nullable().optional(),
      motivo: z.string().trim().min(3).max(500).default("confirmado na edição do lançamento"),
    })).mutation(async ({ input, ctx }) => {
      try { return await vincularLancamentoACliente(input, ctx.user.id); }
      catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Falha ao vincular." }); }
    }),
    // Lote 3, item 16: seleção em lote — excluir (selecionados ou aba inteira com filtros) e combinar.
    previaExclusao: adminProcedure.input(entradaLoteSchema).query(({ input }) => previaExclusaoLote(input)),
    excluirLote: adminProcedure.input(entradaLoteSchema.extend({ confirmacao: z.string() })).mutation(async ({ input, ctx }) => {
      try { return await excluirLancamentosEmLote(input, ctx.user.id); }
      catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Falha ao excluir." }); }
    }),
    previaCombinacao: adminProcedure.input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(200) })).query(({ input }) => previaCombinacao(input.ids)),
    combinar: adminProcedure.input(z.object({ ids: z.array(z.number().int().positive()).min(2).max(200), requestKey: z.string().uuid() })).mutation(async ({ input, ctx }) => {
      try { return await combinarPagamentos(input, ctx.user.id); }
      catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Falha ao combinar." }); }
    }),
    previaVinculos: adminProcedure.query(async () => previaVinculosEmMassa(await catalogoVinculosOperacionais())),
    aplicarVinculos: adminProcedure.input(z.object({ itens: z.array(z.object({
      id: z.number().int().positive(), version: z.number().int().positive(),
      clienteId: z.number().int().positive().nullable().optional(), leadId: z.number().int().positive().nullable().optional(),
    })).min(1).max(500) })).mutation(({ input, ctx }) => aplicarVinculosEmMassa(input.itens, ctx.user.id)),

    create: adminProcedure.input(lancamentoBpoSchema).mutation(async ({ input }) => {
      try { validarDetalhesOperacionais(input); }
      catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Vínculo operacional inválido." }); }
      let vinculo: VinculoOperacional | null = null;
      if (!categoriaSemVinculo(input.categoriaOperacional)) {
        const catalogo = await catalogoVinculosOperacionais();
        const opcoes = catalogo[catalogoDaCategoria(input.tipo, input.categoriaOperacional) as keyof typeof catalogo];
        vinculo = Array.isArray(opcoes) ? (opcoes as VinculoOperacional[]).find(o => o.id === input.vinculoOperacionalId) ?? null : null;
        if (!vinculo) throw new TRPCError({ code: "NOT_FOUND", message: "Registro operacional não encontrado." });
      }
      if (input.clienteId) {
        const [c] = await db.getDb().select({ id: bpoClients.id }).from(bpoClients).where(eq(bpoClients.id, input.clienteId)).limit(1);
        if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente BPO não encontrado." });
      }
      const [criado] = await db.getDb().insert(bpoLancamentos).values({
        clienteId: input.clienteId ?? null,
        clienteNomeLivre: input.clienteId ? null : input.clienteNomeLivre || null,
        tipo: input.tipo === "cobranca" ? "receita" : "despesa",
        categoria: input.categoria ?? categoriaContabilDaOperacional(input.tipo, input.categoriaOperacional, input.tipoDespesaObra),
        descricao: input.descricao,
        valor: input.valor.toFixed(2),
        vencimento: new Date(input.vencimento),
        competencia: input.competencia,
        centroCustos: input.centroCustos || null,
        categoriaOperacional: input.categoriaOperacional,
        vinculoOperacionalId: vinculo ? input.vinculoOperacionalId : null,
        vinculoOperacionalRotulo: vinculo?.rotulo ?? null,
        tipoDespesaObra: input.tipoDespesaObra || null,
        etapaObra: input.etapaObra || null,
        requestKey: input.requestKey,
      }).onConflictDoNothing({ target: bpoLancamentos.requestKey }).returning();
      if (criado) return criado;
      const [anterior] = await db.getDb().select().from(bpoLancamentos).where(eq(bpoLancamentos.requestKey, input.requestKey)).limit(1);
      if (!anterior || anterior.valor !== input.valor.toFixed(2) || anterior.descricao !== input.descricao || (anterior.vinculoOperacionalId ?? null) !== (input.vinculoOperacionalId || null)) throw new TRPCError({ code: "CONFLICT", message: "Chave de envio já utilizada para outro lançamento." });
      return anterior;
    }),

    marcarPago: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const [l] = await db.getDb().select().from(bpoLancamentos).where(eq(bpoLancamentos.id, input.id)).limit(1);
      if (!l) throw new TRPCError({ code: "NOT_FOUND" });
      if (l.combinadaEmId) throw new TRPCError({ code: "BAD_REQUEST", message: mensagemLancamentoCombinado(l.combinadaEmId) });
      if (!l.pago && l.tipo !== "despesa" && !l.asaasPaymentId && !l.bankTransactionId) {
        await registrarRecebimento({ id: l.id, requestKey: `quitar-${l.id}-${l.version}`, valor: Number(l.valor) - Number(l.valorRecebido), recebidoEm: new Date() }, ctx.user.id);
        return { success: true };
      }
      await db.marcarBpoLancamentoPago(input.id);
      return { success: true };
    }),

    editar: adminProcedure.input(z.object({
      id: z.number().int().positive(), version: z.number().int().positive(), motivo: z.string().trim().min(3).max(500),
      descricao: z.string().trim().min(1).max(500), valor: z.number().positive(), categoria: z.enum(CATEGORIAS_MANUAIS).optional(),
      clienteId: z.number().int().positive().nullable().optional(), clienteNomeLivre: texto(255),
      vencimento: z.union([z.string(), z.date()]), competencia: z.string().regex(/^\d{4}-\d{2}$/),
      // Item 12: centro de custos saiu da tela; ausente = mantém o valor gravado.
      centroCustos: texto(100), observacoes: z.string().max(5000).optional().nullable(),
      categoriaOperacional: texto(40), vinculoOperacionalId: texto(80), tipoDespesaObra: texto(30), etapaObra: texto(80),
    })).mutation(async ({ input, ctx }) => {
      const [antes] = await db.getDb().select().from(bpoLancamentos).where(eq(bpoLancamentos.id, input.id)).limit(1);
      if (!antes) throw new TRPCError({ code: "NOT_FOUND" });
      if (antes.combinadaEmId) throw new TRPCError({ code: "BAD_REQUEST", message: mensagemLancamentoCombinado(antes.combinadaEmId) });
      let rotulo: string | null = null;
      const tipo = antes.tipo === "despesa" ? "despesa" : "cobranca";
      if (input.categoriaOperacional && categoriaSemVinculo(input.categoriaOperacional)) {
        validarDetalhesOperacionais({ ...input, tipo, categoriaOperacional: input.categoriaOperacional });
      } else if (input.categoriaOperacional) {
        validarDetalhesOperacionais({ ...input, tipo, categoriaOperacional: input.categoriaOperacional });
        const catalogo = await catalogoVinculosOperacionais();
        const opcoes = catalogo[catalogoDaCategoria(tipo, input.categoriaOperacional) as keyof typeof catalogo] as VinculoOperacional[];
        const registro = opcoes?.find(o => o.id === input.vinculoOperacionalId);
        if (!registro) throw new TRPCError({ code: "BAD_REQUEST", message: "Registro operacional não encontrado." });
        rotulo = registro.rotulo;
      } else if (input.vinculoOperacionalId) throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione a categoria operacional." });
      const categoria = input.categoria ?? categoriaNaEdicao(tipo, antes, input);
      return editarLancamentoAuditavel({ ...input, categoria, vinculoOperacionalRotulo: rotulo, vencimento: new Date(input.vencimento) }, ctx.user.id);
    }),
  }),

  // LOTE C (25/10): inclui os lançamentos gerados pelo extrato bancário (transferência
  // interna não gera lançamento, então não entra). Regra em shared/financeiro/bpo-extrato.ts.
  // Lote 3, item 15: filtros Mês/Ano por competência (vazio = todos), nas duas visões do DRE.
  dre: adminProcedure.input(filtroDreSchema).query(async ({ input }) => dreDosLancamentos(filtrarPorCompetencia(await db.getAllBpoLancamentos(), input))),
  /** Pedido de 25/10 (noite): DRE por categoria (transferência interna fora). */
  dreCategorias: adminProcedure.input(filtroDreSchema).query(async ({ input }) => dreDasCategorias(filtrarPorCompetencia(await db.getAllBpoLancamentos(), input))),
  /** Anos com lançamento (opções do filtro de Ano do DRE). */
  dreAnos: adminProcedure.query(async () => Array.from(new Set((await db.getAllBpoLancamentos()).map(l => l.competencia.slice(0, 4)).filter(a => /^\d{4}$/.test(a)))).sort().reverse()),
});

