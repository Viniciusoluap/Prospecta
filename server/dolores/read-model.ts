import * as db from "../db";

export const PROSPECTA_DOLORES_SOURCE = {
  system: "prospecta",
  companyCode: "PRS",
  canonicalDatabase: "Neon: SiteProspecta",
  territories: ["Maranhão", "Imperatriz e adjacências", "Pará — histórico AuditX"],
  mode: "read_only" as const,
};

export interface ProspectaDoloresSnapshot {
  source: typeof PROSPECTA_DOLORES_SOURCE;
  capturedAt: string;
  domains: {
    crm: { leads: number; hotLeads: number; approvedLeads: number; rejectedLeads: number };
    works: { total: number; active: number; completed: number; byStatus: unknown[] };
    tasks: { total: number; pending: number; inProgress: number; done: number };
    lots: { total: number };
    investors: { total: number };
    brokers: { total: number };
    partners: { total: number };
    financial: { totalTransactions: number };
  };
}

/**
 * Modelo de leitura para a Dolores 9A.
 * Retorna métricas agregadas; não transporta PII nem executa mutações.
 */
export async function getProspectaDoloresSnapshot(): Promise<ProspectaDoloresSnapshot> {
  const [leadStats, workStats, workByStatus, tasks, lots, investors, brokers, partners, financial] = await Promise.all([
    db.getLeadStats(),
    db.getAnalyticsStats(),
    db.getProjectsByStatus(),
    db.getAllTasks(),
    db.getAllLots(),
    db.getAllInvestors(),
    db.getAllBrokerCommissions(),
    db.getAllPartnerDistributions(),
    db.getAllFinancialTransactions(),
  ]);

  const taskStatus = tasks.reduce(
    (result, task) => {
      if (task.status === "pending") result.pending += 1;
      if (task.status === "in_progress") result.inProgress += 1;
      if (task.status === "done") result.done += 1;
      return result;
    },
    { pending: 0, inProgress: 0, done: 0 },
  );

  return {
    source: PROSPECTA_DOLORES_SOURCE,
    capturedAt: new Date().toISOString(),
    domains: {
      crm: {
        leads: Number(leadStats.total ?? 0),
        hotLeads: Number(leadStats.hot ?? 0),
        approvedLeads: Number(leadStats.approved ?? 0),
        rejectedLeads: Number(leadStats.rejected ?? 0),
      },
      works: {
        total: Number(workStats.projects?.total ?? 0),
        active: Number(workStats.projects?.active ?? 0),
        completed: Number(workStats.projects?.completed ?? 0),
        byStatus: workByStatus,
      },
      tasks: {
        total: tasks.length,
        ...taskStatus,
      },
      lots: { total: lots.length },
      investors: { total: investors.length },
      brokers: { total: brokers.length },
      partners: { total: partners.length },
      financial: { totalTransactions: financial.length },
    },
  };
}
