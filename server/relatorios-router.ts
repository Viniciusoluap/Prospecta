import { and, count, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import {
  imoveis, leads, financiamentos, financialTransactions,
  operationalCommissions, users, bpoLancamentos,
  constructionProjects, obraMovimentos, incorporationUnits,
} from "../drizzle/schema.js";
import { LEAD_PIPELINE_KEYS, LEAD_PIPELINE_STAGES } from "../shared/lead-pipeline.js";
import {
  chaveData, funilDeLeads, indicadoresDeObras, noPeriodo, numerosDeObra,
  rankingDeCorretores, unidadesDisponiveis, type Periodo,
} from "../shared/financeiro/relatorios-indicadores.js";
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
 * O relatório operacional lê `operational_commissions`. As funções puras de
 * interpretação do formato antigo permanecem para testes históricos; a tabela
 * broker_commissions está vazia e deixou de ser consultada no Lote 7.
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

export type DreMensalLinha = { mes: string; receitas: number; despesas: number; resultado: number };

/**
 * DRE mensal dos Relatórios: transações financeiras pagas + lançamentos pagos do BPO
 * (LOTE C, 25/10: inclui os gerados pelo extrato bancário; transferência interna não gera
 * lançamento). Somas em centavos para não acumular erro de arredondamento.
 */
export function montarDreMensal(
  transacoes: { competency: string | null; paidAt: Date | null; type: string; amount: string | number }[],
  lancamentosBpo: { competencia: string; tipo: string; valor: string | number }[] = [],
): DreMensalLinha[] {
  const mapa = new Map<string, { receitas: number; despesas: number }>();
  const somar = (mes: string, receita: boolean, valor: string | number) => {
    const e = mapa.get(mes) ?? { receitas: 0, despesas: 0 };
    const centavos = Math.round(Number(valor) * 100);
    if (receita) e.receitas += centavos; else e.despesas += centavos;
    mapa.set(mes, e);
  };
  for (const t of transacoes) {
    const mes = t.competency ?? (t.paidAt ? t.paidAt.toISOString().slice(0, 7) : "sem-competencia");
    somar(mes, t.type === "income" || t.type === "commission", t.amount);
  }
  for (const l of lancamentosBpo) somar(l.competencia, l.tipo !== "despesa", l.valor);
  return Array.from(mapa.entries())
    .map(([mes, v]) => ({ mes, receitas: v.receitas / 100, despesas: v.despesas / 100, resultado: (v.receitas - v.despesas) / 100 }))
    .sort((a, b) => a.mes.localeCompare(b.mes));
}

export const relatoriosRouter = router({
  overview: adminProcedure
    .input(z.object({ from: z.string().optional(), to: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const database = getDb();
      const from = input?.from ? new Date(input.from) : monthsAgo(11);
      const to = input?.to ? new Date(input.to) : new Date();

      const periodo: Periodo = { de: chaveData(from)!, ate: chaveData(to)! };

      const [
        totalImoveis,
        leadsAtivos,
        totalFinanciamentos,
        obras,
        pagamentosComissaoObra,
        comissoesCadastradas,
        unidadesIncorporacao,
        imoveisCatalogo,
        pontosDeObra,
        transacoesPagas,
        lancamentosBpoPagos,
      ] = await Promise.all([
        database.select({ n: count() }).from(imoveis).then((r) => r[0]?.n ?? 0),
        // 18.2: só leads ativos (excluídos ficam fora); etapa pela regra do CRM.
        database
          .select({ stage: leads.stage, pendente: leads.stageClassificationPending, createdAt: leads.createdAt })
          .from(leads)
          .where(isNull(leads.deletedAt)),
        database.select({ n: count() }).from(financiamentos).then((r) => r[0]?.n ?? 0),
        // 14 / 18.1: obras com o VGV simulado do lead (regra de vgvDaObra).
        database
          .select({
            id: constructionProjects.id,
            status: constructionProjects.status,
            dataInicio: constructionProjects.startDate,
            criadoEm: constructionProjects.createdAt,
            leadId: constructionProjects.leadId,
            vgvLead: leads.simulationValue,
            vgv: constructionProjects.vgv,
            financiamento: constructionProjects.financedAmount,
            fgts: constructionProjects.fgtsAmount,
            subsidio: constructionProjects.subsidyAmount,
          })
          .from(constructionProjects)
          .leftJoin(leads, eq(leads.id, constructionProjects.leadId)),
        // 18.3: pagamentos de comissão confirmados das obras → corretor do lead da obra.
        database
          .select({
            obraId: obraMovimentos.projectId,
            corretorId: leads.brokerId,
            corretor: users.name,
            valor: obraMovimentos.valor,
            data: obraMovimentos.data,
          })
          .from(obraMovimentos)
          .innerJoin(constructionProjects, eq(constructionProjects.id, obraMovimentos.projectId))
          .leftJoin(leads, eq(leads.id, constructionProjects.leadId))
          .leftJoin(users, eq(users.id, leads.brokerId))
          .where(and(
            eq(obraMovimentos.natureza, "pagamento"),
            eq(obraMovimentos.categoria, "comissao"),
            eq(obraMovimentos.status, "confirmado"),
          )),
        database
          .select({
            obraId: operationalCommissions.constructionProjectId,
            corretorId: operationalCommissions.brokerId,
            corretor: users.name,
            valor: operationalCommissions.amount,
            status: operationalCommissions.status,
            pagoEm: operationalCommissions.paidAt,
          })
          .from(operationalCommissions)
          .leftJoin(users, eq(operationalCommissions.brokerId, users.id))
          .where(eq(operationalCommissions.beneficiary, "corretor")),
        // 18.4: estoque atual (sem período).
        database.select({ status: incorporationUnits.status, deletedAt: incorporationUnits.deletedAt }).from(incorporationUnits),
        database.select({ id: imoveis.id, status: imoveis.status, reviewStatus: imoveis.reviewStatus }).from(imoveis),
        database.select({ imovelId: constructionProjects.imovelId }).from(constructionProjects).where(isNotNull(constructionProjects.imovelId)),
        database.select().from(financialTransactions).where(
          and(
            eq(financialTransactions.status, "paid"),
            gte(financialTransactions.paidAt, from),
            lte(financialTransactions.paidAt, to),
          ),
        ),
        database
          .select({ competencia: bpoLancamentos.competencia, tipo: bpoLancamentos.tipo, valor: bpoLancamentos.valor })
          .from(bpoLancamentos)
          .where(and(eq(bpoLancamentos.pago, true), gte(bpoLancamentos.pagoEm, from), lte(bpoLancamentos.pagoEm, to))),
      ]);

      const dreMensal = montarDreMensal(transacoesPagas, lancamentosBpoPagos);
      const totalReceitas = dreMensal.reduce((s, m) => s + m.receitas, 0);
      const totalDespesas = dreMensal.reduce((s, m) => s + m.despesas, 0);

      const vgvObras = indicadoresDeObras(obras, periodo);
      const chavesPipeline = new Set<string>(LEAD_PIPELINE_KEYS);
      const funil = funilDeLeads(
        LEAD_PIPELINE_STAGES,
        leadsAtivos
          .filter((l) => noPeriodo(l.createdAt, periodo))
          .map((l) => ({ etapa: !l.pendente && chavesPipeline.has(l.stage) ? l.stage : null })),
      );
      const pontos = new Set(pontosDeObra.map((p) => p.imovelId));
      const unidades = unidadesDisponiveis(
        unidadesIncorporacao.map((u) => ({ status: u.status, excluida: u.deletedAt !== null })),
        imoveisCatalogo.map((i) => ({ status: i.status, aprovado: i.reviewStatus === "approved", pontoDeObra: pontos.has(i.id) })),
      );

      return {
        from: from.toISOString(),
        to: to.toISOString(),
        totalImoveis,
        totalLeads: funil.total,
        totalFinanciamentos,
        vgvObras,
        numerosDeObra: numerosDeObra(vgvObras),
        funilLeads: funil,
        unidadesDisponiveis: unidades,
        dreMensal,
        totalReceitas,
        totalDespesas,
        resultado: totalReceitas - totalDespesas,
        ticketMedio: vgvObras.ticketMedio,
        corretorRanking: rankingDeCorretores(pagamentosComissaoObra, comissoesCadastradas, periodo),
      };
    }),

  exportComissoesCsv: adminProcedure.query(async () => {
    const database = getDb();
    const novasRows = await database
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
        .orderBy(operationalCommissions.dueDate);
    return buildComissoesExportNovas(novasRows);
  }),
});
