// 10 implementações, item 03 — exclusão definitiva (mesma regra do Santa Fé:
// Grupo-Santa-Fe/web/src/lib/crm/excluir-servico.ts).
// Remove o registro e o que só existe por causa dele; o lead/cliente fica.
// Com guarda obrigatória (financeiro, medição, comissão paga, unidade vendida)
// nada é apagado e a mensagem orienta a cancelar.

import { TRPCError } from "@trpc/server";
import { and, count, eq, inArray, ne, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  avaliacoes, constructionPhotos, constructionProjects, constructionStages, financiamentoChecklistItems,
  financiamentos, incorporationRegistrationDocuments, incorporationStudies, incorporationUnitEvents, incorporationUnits,
  leadServices, obraFees, obraInvestidores, obraMeasurements, obraMovimentos, operationalCommissions,
  operationalProjects, regularizacaoDocuments, regularizacaoRecebimentos, regularizacoes,
} from "../drizzle/schema.js";
import { motivoBloqueioExclusao, type DependenciasExclusao, type ModuloExclusao } from "../shared/exclusao.js";
import { podeAdministrarSeguranca } from "../shared/perfis-acesso.js";
import { getDb } from "./db.js";

type Db = ReturnType<typeof getDb>;

async function contar(db: Db, tabela: PgTable, onde: SQL | undefined): Promise<number> {
  const [r] = await db.select({ n: count() }).from(tabela).where(onde);
  return Number(r?.n ?? 0);
}

async function dependencias(db: Db, modulo: ModuloExclusao, id: number): Promise<{ deps: DependenciasExclusao; leadServiceId: number | null } | null> {
  switch (modulo) {
    case "obra": {
      const [obra] = await db.select({ leadServiceId: constructionProjects.leadServiceId }).from(constructionProjects).where(eq(constructionProjects.id, id)).limit(1);
      if (!obra) return null;
      const [movimentosFinanceiros, investidores, medicoes, comissoes] = await Promise.all([
        contar(db, obraMovimentos, eq(obraMovimentos.projectId, id)),
        contar(db, obraInvestidores, eq(obraInvestidores.projectId, id)),
        contar(db, obraMeasurements, eq(obraMeasurements.projectId, id)),
        contar(db, operationalCommissions, eq(operationalCommissions.constructionProjectId, id)),
      ]);
      return { deps: { movimentosFinanceiros, investidores, medicoes, comissoes }, leadServiceId: obra.leadServiceId };
    }
    case "financiamento": {
      const [fin] = await db.select({ leadServiceId: financiamentos.leadServiceId }).from(financiamentos).where(eq(financiamentos.id, id)).limit(1);
      return fin ? { deps: {}, leadServiceId: fin.leadServiceId } : null;
    }
    case "regularizacao": {
      const [reg] = await db.select({ leadServiceId: regularizacoes.leadServiceId }).from(regularizacoes).where(eq(regularizacoes.id, id)).limit(1);
      if (!reg) return null;
      return { deps: { recebimentos: await contar(db, regularizacaoRecebimentos, eq(regularizacaoRecebimentos.regularizacaoId, id)) }, leadServiceId: reg.leadServiceId };
    }
    case "projeto": {
      const [p] = await db.select({ leadServiceId: operationalProjects.leadServiceId, paidValue: operationalProjects.paidValue }).from(operationalProjects).where(eq(operationalProjects.id, id)).limit(1);
      return p ? { deps: { valorPago: Number(p.paidValue ?? 0) }, leadServiceId: p.leadServiceId } : null;
    }
    case "avaliacao": {
      const [a] = await db.select({ leadServiceId: avaliacoes.leadServiceId }).from(avaliacoes).where(eq(avaliacoes.id, id)).limit(1);
      return a ? { deps: {}, leadServiceId: a.leadServiceId } : null;
    }
    case "estudo": {
      const [e] = await db.select({ id: incorporationStudies.id }).from(incorporationStudies).where(eq(incorporationStudies.id, id)).limit(1);
      if (!e) return null;
      return { deps: { unidadesComercializadas: await contar(db, incorporationUnits, and(eq(incorporationUnits.studyId, id), ne(incorporationUnits.status, "disponivel"))) }, leadServiceId: null };
    }
    case "comissao": {
      const [c] = await db.select({ status: operationalCommissions.status }).from(operationalCommissions).where(eq(operationalCommissions.id, id)).limit(1);
      return c ? { deps: { comissaoPaga: c.status === "paga" }, leadServiceId: null } : null;
    }
  }
}

/** Exclusões do módulo, em ordem (executadas num único batch = transação no Neon). */
function apagar(db: Db, modulo: ModuloExclusao, id: number) {
  switch (modulo) {
    case "obra": return [
      db.delete(constructionPhotos).where(eq(constructionPhotos.projectId, id)), // bytes saem em cascata
      db.delete(constructionStages).where(eq(constructionStages.projectId, id)),
      db.delete(obraFees).where(eq(obraFees.projectId, id)),
      db.delete(constructionProjects).where(eq(constructionProjects.id, id)), // progresso sai em cascata
    ];
    case "financiamento": return [
      db.delete(financiamentoChecklistItems).where(eq(financiamentoChecklistItems.financiamentoId, id)),
      db.delete(financiamentos).where(eq(financiamentos.id, id)),
    ];
    case "regularizacao": return [
      db.delete(regularizacaoDocuments).where(eq(regularizacaoDocuments.regularizacaoId, id)),
      db.delete(regularizacoes).where(eq(regularizacoes.id, id)), // etapas e itens saem em cascata
    ];
    case "projeto": return [db.delete(operationalProjects).where(eq(operationalProjects.id, id))];
    case "avaliacao": return [db.delete(avaliacoes).where(eq(avaliacoes.id, id))];
    case "estudo": return [
      db.delete(incorporationUnitEvents).where(inArray(incorporationUnitEvents.unitId,
        db.select({ id: incorporationUnits.id }).from(incorporationUnits).where(eq(incorporationUnits.studyId, id)))),
      db.delete(incorporationUnits).where(eq(incorporationUnits.studyId, id)),
      db.delete(incorporationRegistrationDocuments).where(eq(incorporationRegistrationDocuments.studyId, id)), // bytes no banco saem em cascata
      db.delete(incorporationStudies).where(eq(incorporationStudies.id, id)),
    ];
    case "comissao": return [db.delete(operationalCommissions).where(eq(operationalCommissions.id, id))];
  }
}

/**
 * Exclui definitivamente. Lança BAD_REQUEST com a explicação quando a exclusão
 * é impedida. Registro inexistente (já excluído) não é erro.
 */
export async function excluirDefinitivo(modulo: ModuloExclusao, id: number, ator: { role: string; active?: boolean | null }): Promise<{ excluido: boolean }> {
  // Item 06: exclusão definitiva é ação de segurança — só admin ativo (como no Santa Fé).
  if (!podeAdministrarSeguranca({ perfil: ator.role, ativo: ator.active ?? true }))
    throw new TRPCError({ code: "FORBIDDEN", message: "Somente o administrador pode excluir definitivamente. Use \"Cancelar\"." });
  const db = getDb();
  const info = await dependencias(db, modulo, id);
  if (!info) return { excluido: false };
  const bloqueio = motivoBloqueioExclusao(modulo, info.deps);
  if (bloqueio) throw new TRPCError({ code: "BAD_REQUEST", message: bloqueio });
  const passos = apagar(db, modulo, id);
  // O serviço do CRM existia só para este registro; o lead e seus documentos ficam
  // (documentos do serviço passam ao "CRM geral" pelo ON DELETE SET NULL).
  const comServico = info.leadServiceId
    ? [...passos, db.delete(leadServices).where(eq(leadServices.id, info.leadServiceId))]
    : passos;
  try {
    await db.batch(comServico as unknown as Parameters<Db["batch"]>[0]);
  } catch (error) {
    // Corrida com um lançamento novo: as FKs RESTRICT do financeiro impedem a exclusão.
    const texto = error instanceof Error ? error.message : String(error);
    if (/foreign key|violates|MOVIMENTO_NAO_PODE|RECEBIMENTO_NAO_PODE/i.test(texto))
      throw new TRPCError({ code: "BAD_REQUEST", message: "O registro ganhou vínculos financeiros durante a exclusão. Atualize a página; use \"Cancelar\" para manter o histórico." });
    throw error;
  }
  return { excluido: true };
}

