import { and, avg, count, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import {
  imoveis, leads, financiamentos, avaliacoes, financialTransactions, brokerCommissions,
  operationalCommissions, users,
} from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { adminProcedure, router } from "./_core/trpc.js";

function monthsAgo(n: number): Date {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Comissões de corretores vivem em duas fontes desde a Etapa 4: `broker_commissions`
 * (legado, congelado, parcelas sem status explícito) e `operational_commissions`
 * (novo, CRUD ativo, status explícito). Nenhuma migra dados para a outra — os
 * relatórios precisam ler as duas e somar sem duplicar, já que são tabelas
 * disjuntas (nenhum registro existe nas duas ao mesmo tempo).
 */
export type ComissaoLegadoRow = {
  brokerName: string;
  installment1Paid: string | null;
  installment2Paid: string | null;
  installment3Paid: string | null;
  installment4Paid: string | null;
};

export type ComissaoNovaRankingRow = {
  brokerName: string | null;
  amount: string;
  status: string;
};

function pagoLegado(c: ComissaoLegadoRow): number {
  return Number(c.installment1Paid ?? 0) + Number(c.installment2Paid ?? 0) +
    Number(c.installment3Paid ?? 0) + Number(c.installment4Paid ?? 0);
}

/**
 * Regra de inclusão do histórico (S-11 / C1): legado não tem campo `status`,
 * então "pago" é a soma real das parcelas pagas (pode ser parcial). O modelo
 * novo só conta como pago quando `status === "paga"` — pendente/aprovada/cancelada
 * nunca entram no total pago, mas continuam existindo como registros (visíveis
 * na exportação, ver `buildComissoesExportNovas`).
 */
export function buildCorretorRanking(
  legado: ComissaoLegadoRow[],
  novas: ComissaoNovaRankingRow[],
  limit = 5,
): { nome: string; totalPago: number }[] {
  const corretorMap = new Map<string, number>();
  for (const c of legado) {
    corretorMap.set(c.brokerName, (corretorMap.get(c.brokerName) ?? 0) + pagoLegado(c));
  }
  for (const c of novas) {
    if (c.status !== "paga") continue;
    const nome = c.brokerName ?? "Corretor sem cadastro";
    corretorMap.set(nome, (corretorMap.get(nome) ?? 0) + Number(c.amount));
  }
  return Array.from(corretorMap.entries())
    .map(([nome, totalPago]) => ({ nome, totalPago }))
    .sort((a, b) => b.totalPago - a.totalPago)
    .slice(0, limit);
}

export type ComissaoExportRow = {
  origem: "legado" | "operacional";
  data: string;
  corretor: string;
  referencia: string | null;
  valorTotal: number;
  pago: number;
  status: string;
};

export type ComissaoLegadoFullRow = ComissaoLegadoRow & {
  createdAt: Date;
  clientName: string;
  totalCommission: string;
};

/** Sem `status` no legado: inferido a partir da comparação entre pago e total. */
function statusLegado(pago: number, valorTotal: number): string {
  if (valorTotal > 0 && pago >= valorTotal) return "pago";
  if (pago > 0) return "pago parcial";
  return "pendente";
}

export function buildComissoesExportLegado(rows: ComissaoLegadoFullRow[]): ComissaoExportRow[] {
  return rows.map((r) => {
    const pago = pagoLegado(r);
    const valorTotal = Number(r.totalCommission);
    return {
      origem: "legado",
      data: r.createdAt.toISOString().slice(0, 10),
      corretor: r.brokerName,
      referencia: r.clientName,
      valorTotal,
      pago,
      status: statusLegado(pago, valorTotal),
    };
  });
}

export type ComissaoNovaFullRow = {
  brokerName: string | null;
  beneficiary: string;
  property: string;
  amount: string;
  status: string;
  dueDate: Date;
  paidAt: Date | null;
};

export function buildComissoesExportNovas(rows: ComissaoNovaFullRow[]): ComissaoExportRow[] {
  return rows.map((r) => {
    const valorTotal = Number(r.amount);
    const corretor = r.brokerName ?? (r.beneficiary === "empresa" ? "Empresa" : "Corretor sem cadastro");
    return {
      origem: "operacional",
      data: (r.paidAt ?? r.dueDate).toISOString().slice(0, 10),
      corretor,
      referencia: r.property,
      valorTotal,
      pago: r.status === "paga" ? valorTotal : 0,
      status: r.status,
    };
  });
}

export const relatoriosRouter = router({
  overview: adminProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const database = getDb();
      const from = input?.from ? new Date(input.from) : monthsAgo(11);
      const to = input?.to ? new Date(input.to) : new Date();

      const [
        totalImoveis,
        imoveisPorTipo,
        totalLeads,
        leadsPorStage,
        totalFinanciamentos,
        avaliacoesAgg,
        avaliacoesPorStatus,
        transacoesPagas,
        comissoesLegado,
        comissoesNovas,
      ] = await Promise.all([
        database.select({ n: count() }).from(imoveis).then((r) => r[0]?.n ?? 0),
        database.select({ tipo: imoveis.tipo, n: count() }).from(imoveis).groupBy(imoveis.tipo),
        database.select({ n: count() }).from(leads).then((r) => r[0]?.n ?? 0),
        database.select({ stage: leads.stage, n: count() }).from(leads).groupBy(leads.stage),
        database.select({ n: count() }).from(financiamentos).then((r) => r[0]?.n ?? 0),
        database.select({ n: count(), media: avg(avaliacoes.valorEstimado) }).from(avaliacoes).then((r) => r[0]),
        database.select({ status: avaliacoes.status, n: count() }).from(avaliacoes).groupBy(avaliacoes.status),
        database.select().from(financialTransactions).where(
          and(
            eq(financialTransactions.status, "paid"),
            gte(financialTransactions.paidAt, from),
            lte(financialTransactions.paidAt, to),
          ),
        ),
        database.select().from(brokerCommissions),
        database
          .select({
            brokerName: users.name,
            amount: operationalCommissions.amount,
            status: operationalCommissions.status,
          })
          .from(operationalCommissions)
          .leftJoin(users, eq(operationalCommissions.brokerId, users.id))
          .where(eq(operationalCommissions.beneficiary, "corretor")),
      ]);

      const dreMap = new Map<string, { receitas: number; despesas: number }>();
      for (const t of transacoesPagas) {
        const mes = t.competency ?? (t.paidAt ? t.paidAt.toISOString().slice(0, 7) : "sem-competencia");
        const entry = dreMap.get(mes) ?? { receitas: 0, despesas: 0 };
        const valor = Number(t.amount);
        if (t.type === "income" || t.type === "commission") entry.receitas += valor;
        else entry.despesas += valor;
        dreMap.set(mes, entry);
      }
      const dreMensal = Array.from(dreMap.entries())
        .map(([mes, v]) => ({ mes, ...v, resultado: v.receitas - v.despesas }))
        .sort((a, b) => a.mes.localeCompare(b.mes));

      const totalReceitas = dreMensal.reduce((s, m) => s + m.receitas, 0);
      const totalDespesas = dreMensal.reduce((s, m) => s + m.despesas, 0);
      const vendasNoPeriodo = transacoesPagas.filter((t) => t.type === "income" || t.type === "commission").length;
      const ticketMedio = vendasNoPeriodo > 0 ? Math.round(totalReceitas / vendasNoPeriodo) : 0;

      const corretorRanking = buildCorretorRanking(comissoesLegado, comissoesNovas);

      return {
        from: from.toISOString(),
        to: to.toISOString(),
        totalImoveis,
        imoveisPorTipo,
        totalLeads,
        leadsPorStage,
        totalFinanciamentos,
        avaliacoes: {
          total: avaliacoesAgg?.n ?? 0,
          mediaValorEstimado: avaliacoesAgg?.media ? Number(avaliacoesAgg.media) : null,
          porStatus: avaliacoesPorStatus,
        },
        dreMensal,
        totalReceitas,
        totalDespesas,
        resultado: totalReceitas - totalDespesas,
        ticketMedio,
        corretorRanking,
      };
    }),

  exportComissoesCsv: adminProcedure.query(async () => {
    const database = getDb();
    const [legadoRows, novasRows] = await Promise.all([
      database.select().from(brokerCommissions).orderBy(brokerCommissions.createdAt),
      database
        .select({
          brokerName: users.name,
          beneficiary: operationalCommissions.beneficiary,
          property: operationalCommissions.property,
          amount: operationalCommissions.amount,
          status: operationalCommissions.status,
          dueDate: operationalCommissions.dueDate,
          paidAt: operationalCommissions.paidAt,
        })
        .from(operationalCommissions)
        .leftJoin(users, eq(operationalCommissions.brokerId, users.id))
        .orderBy(operationalCommissions.dueDate),
    ]);
    return [
      ...buildComissoesExportLegado(legadoRows),
      ...buildComissoesExportNovas(novasRows),
    ];
  }),
});
