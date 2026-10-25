// BPO Financeiro — clientes, lançamentos e DRE (saiu de routers.ts no pedido de 25/10 noite).
// Itens 9, 10 e 11: cliente ligado ao lead do CRM (ou cadastro livre), totais por cliente,
// "+ Lançamento" só Cobrança/Despesa com categoria e DRE também por categoria.
import { TRPCError } from "@trpc/server";
import { and, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc.js";
import { requireModule } from "./_core/rbac.js";
import * as db from "./db.js";
import { bankTransactions, bpoClients, bpoLancamentos, leads } from "../drizzle/schema.js";
import {
  CATEGORIAS_BPO,
  TRANSFERENCIA_INTERNA,
  dreDasCategorias,
  dreDosLancamentos,
  normalizarTitular,
  resumoPorCliente,
} from "../shared/financeiro/bpo-extrato.js";
import { aplicarClassificacaoEmLote, lancamentosComTitular } from "./bpo-extrato.js";

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
    d.select({ clienteId: bpoLancamentos.clienteId, tipo: bpoLancamentos.tipo, valor: bpoLancamentos.valor, pago: bpoLancamentos.pago, categoria: bpoLancamentos.categoria })
      .from(bpoLancamentos).where(isNotNull(bpoLancamentos.clienteId)),
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

export const lancamentoBpoSchema = z.object({
  // Item 11: Cobrança grava o tipo "receita" (o mesmo das entradas do extrato).
  tipo: z.enum(["cobranca", "despesa"]),
  categoria: z.enum(CATEGORIAS_MANUAIS, { message: "Escolha a categoria." }),
  clienteId: z.number().int().positive().nullable().optional(),
  clienteNomeLivre: z.string().trim().max(255).optional().nullable(),
  descricao: z.string().trim().min(1).max(500),
  valor: z.number().positive(),
  vencimento: z.union([z.string(), z.date()]),
  competencia: z.string().regex(/^\d{4}-\d{2}$/, "Competência no formato AAAA-MM"),
  centroCustos: z.string().trim().max(100).optional().nullable(),
});

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
    list: adminProcedure.query(() => lancamentosComTitular()),

    create: adminProcedure.input(lancamentoBpoSchema).mutation(async ({ input }) => {
      if (input.clienteId) {
        const [c] = await db.getDb().select({ id: bpoClients.id }).from(bpoClients).where(eq(bpoClients.id, input.clienteId)).limit(1);
        if (!c) throw new TRPCError({ code: "NOT_FOUND", message: "Cliente BPO não encontrado." });
      }
      const [criado] = await db.getDb().insert(bpoLancamentos).values({
        clienteId: input.clienteId ?? null,
        clienteNomeLivre: input.clienteId ? null : input.clienteNomeLivre || null,
        tipo: input.tipo === "cobranca" ? "receita" : "despesa",
        categoria: input.categoria,
        descricao: input.descricao,
        valor: input.valor.toFixed(2),
        vencimento: new Date(input.vencimento),
        competencia: input.competencia,
        centroCustos: input.centroCustos || null,
      }).returning();
      return criado;
    }),

    marcarPago: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      await db.marcarBpoLancamentoPago(input.id);
      return { success: true };
    }),
  }),

  // LOTE C (25/10): inclui os lançamentos gerados pelo extrato bancário (transferência
  // interna não gera lançamento, então não entra). Regra em shared/financeiro/bpo-extrato.ts.
  dre: adminProcedure.query(async () => dreDosLancamentos(await db.getAllBpoLancamentos())),
  /** Pedido de 25/10 (noite): DRE por categoria (transferência interna fora). */
  dreCategorias: adminProcedure.query(async () => dreDasCategorias(await db.getAllBpoLancamentos())),
});

