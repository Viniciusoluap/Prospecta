// Exclusão definitiva (item 03 + pedido A6; mesma regra do Santa Fé:
// Grupo-Santa-Fe/web/src/lib/crm/excluir-servico.ts).
// Remove o registro e tudo o que só existe por causa dele (lançamentos,
// medições, comissões, aportes, unidades); o lead/cliente fica.

import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import {
  avaliacoes, constructionPhotos, constructionProjects, constructionStages, financiamentoChecklistItems,
  financiamentos, incorporationRegistrationDocuments, incorporationStudies, incorporationUnitEvents, incorporationUnits,
  leadServices, obraFees, obraMeasurements, obraMovimentos, operationalCommissions,
  operationalProjects, regularizacaoDocuments, regularizacaoRecebimentos, regularizacoes,
} from "../drizzle/schema.js";
import type { ModuloExclusao } from "../shared/exclusao.js";
import { getDb } from "./db.js";
import { lixeiraDaEntidade, lixeiraDoArquivo, lixeiraDoProjeto } from "./drive-organizacao.js";
import { MODULO_DO_DESTINO, podeUsarModulo } from "./_core/rbac.js";

type Db = ReturnType<typeof getDb>;

/** Serviço do CRM do registro; null quando o registro não existe (já excluído). */
async function servicoVinculado(db: Db, modulo: ModuloExclusao, id: number): Promise<{ leadServiceId: number | null } | null> {
  switch (modulo) {
    case "obra": {
      const [r] = await db.select({ leadServiceId: constructionProjects.leadServiceId }).from(constructionProjects).where(eq(constructionProjects.id, id)).limit(1);
      return r ?? null;
    }
    case "financiamento": {
      const [r] = await db.select({ leadServiceId: financiamentos.leadServiceId }).from(financiamentos).where(eq(financiamentos.id, id)).limit(1);
      return r ?? null;
    }
    case "regularizacao": {
      const [r] = await db.select({ leadServiceId: regularizacoes.leadServiceId }).from(regularizacoes).where(eq(regularizacoes.id, id)).limit(1);
      return r ?? null;
    }
    case "projeto": {
      const [r] = await db.select({ leadServiceId: operationalProjects.leadServiceId }).from(operationalProjects).where(eq(operationalProjects.id, id)).limit(1);
      return r ?? null;
    }
    case "avaliacao": {
      const [r] = await db.select({ leadServiceId: avaliacoes.leadServiceId }).from(avaliacoes).where(eq(avaliacoes.id, id)).limit(1);
      return r ?? null;
    }
    case "estudo": {
      const [r] = await db.select({ id: incorporationStudies.id }).from(incorporationStudies).where(eq(incorporationStudies.id, id)).limit(1);
      return r ? { leadServiceId: null } : null;
    }
    case "comissao": {
      const [r] = await db.select({ id: operationalCommissions.id }).from(operationalCommissions).where(eq(operationalCommissions.id, id)).limit(1);
      return r ? { leadServiceId: null } : null;
    }
  }
}

/** Arquivos no Drive que só existem por causa do registro e ficam fora da pasta da entidade (pasta do cliente). */
async function arquivosNoDrive(db: Db, modulo: ModuloExclusao, id: number): Promise<string[]> {
  if (modulo === "financiamento") {
    const r = await db.select({ f: financiamentoChecklistItems.documentoDriveFileId }).from(financiamentoChecklistItems).where(eq(financiamentoChecklistItems.financiamentoId, id));
    return r.flatMap((x) => (x.f ? [x.f] : []));
  }
  if (modulo === "regularizacao") {
    const r = await db.select({ f: regularizacaoDocuments.driveFileId }).from(regularizacaoDocuments).where(eq(regularizacaoDocuments.regularizacaoId, id));
    return r.flatMap((x) => (x.f ? [x.f] : []));
  }
  return [];
}

/** Exclusões do módulo, em ordem (executadas num único batch = transação no Neon). */
function apagar(db: Db, modulo: ModuloExclusao, id: number) {
  switch (modulo) {
    case "obra": return [
      // Pedido A6: os lançamentos e registros da obra saem junto (histórico em cascata).
      db.delete(obraMovimentos).where(eq(obraMovimentos.projectId, id)),
      db.delete(obraMeasurements).where(eq(obraMeasurements.projectId, id)),
      db.delete(operationalCommissions).where(eq(operationalCommissions.constructionProjectId, id)),
      db.delete(constructionPhotos).where(eq(constructionPhotos.projectId, id)), // bytes saem em cascata
      db.delete(constructionStages).where(eq(constructionStages.projectId, id)),
      db.delete(obraFees).where(eq(obraFees.projectId, id)),
      db.delete(constructionProjects).where(eq(constructionProjects.id, id)), // progresso e aportes saem em cascata
    ];
    case "financiamento": return [
      db.delete(financiamentoChecklistItems).where(eq(financiamentoChecklistItems.financiamentoId, id)),
      db.delete(financiamentos).where(eq(financiamentos.id, id)),
    ];
    case "regularizacao": return [
      db.delete(regularizacaoRecebimentos).where(eq(regularizacaoRecebimentos.regularizacaoId, id)),
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
 * Exclui definitivamente o registro e tudo o que só existe por causa dele.
 * Registro inexistente (já excluído) não é erro.
 */
export async function excluirDefinitivo(modulo: ModuloExclusao, id: number, ator: { role: string; active?: boolean | null; permissions?: string | null }): Promise<{ excluido: boolean }> {
  // Pedido de 17/10/2026: o colaborador faz tudo o que o admin faz nos módulos
  // liberados — inclusive excluir —, sempre conferindo o módulo do registro.
  if (!podeUsarModulo(ator, MODULO_DO_DESTINO[modulo]))
    throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para excluir neste módulo." });
  const db = getDb();
  const info = await servicoVinculado(db, modulo, id);
  if (!info) return { excluido: false };
  const arquivos = await arquivosNoDrive(db, modulo, id);
  const passos = apagar(db, modulo, id);
  // O serviço do CRM existia só para este registro; o lead e seus documentos ficam
  // (documentos do serviço passam ao "CRM geral" pelo ON DELETE SET NULL).
  const comServico = info.leadServiceId
    ? [...passos, db.delete(leadServices).where(eq(leadServices.id, info.leadServiceId))]
    : passos;
  await db.batch(comServico as unknown as Parameters<Db["batch"]>[0]);
  // Pedido de 29/10: o banco primeiro; depois a lixeira do Drive (nunca bloqueia a exclusão).
  if (modulo === "obra") await lixeiraDaEntidade("obra", id);
  if (modulo === "estudo") await lixeiraDaEntidade("incorporacao", id);
  if (modulo === "projeto") await lixeiraDoProjeto(id); // portfólio "projeto-<id>"
  for (const arquivo of arquivos) await lixeiraDoArquivo(arquivo);
  return { excluido: true };
}
