import { and, avg, count, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import {
  imoveis, leads, financiamentos, avaliacoes, financialTransactions, brokerCommissions,
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
        comissoes,
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

      const corretorMap = new Map<string, number>();
      for (const c of comissoes) {
        const pago = Number(c.installment1Paid ?? 0) + Number(c.installment2Paid ?? 0) +
          Number(c.installment3Paid ?? 0) + Number(c.installment4Paid ?? 0);
        corretorMap.set(c.brokerName, (corretorMap.get(c.brokerName) ?? 0) + pago);
      }
      const corretorRanking = Array.from(corretorMap.entries())
        .map(([nome, totalPago]) => ({ nome, totalPago }))
        .sort((a, b) => b.totalPago - a.totalPago)
        .slice(0, 5);

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
    const rows = await database.select().from(brokerCommissions).orderBy(brokerCommissions.createdAt);
    return rows.map((r) => ({
      data: r.createdAt.toISOString().slice(0, 10),
      corretor: r.brokerName,
      cliente: r.clientName,
      valorTotal: Number(r.totalCommission),
      pago: Number(r.installment1Paid ?? 0) + Number(r.installment2Paid ?? 0) +
        Number(r.installment3Paid ?? 0) + Number(r.installment4Paid ?? 0),
    }));
  }),
});
