import { TRPCError } from "@trpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { incorporationMassStudies, incorporationStudies } from "../drizzle/schema.js";
import { cenarioPrincipalDe, type CenarioPrincipal } from "../shared/incorporacao/estudos-massa.js";
import { unidadesDoCenario } from "../shared/incorporacao/unidades.js";
import { getDb } from "./db.js";

export async function obterCenarioPrincipal(studyId: number): Promise<CenarioPrincipal | null> {
  const [e] = await getDb().select({
    massScenariosJson: incorporationStudies.massScenariosJson, selectedScenarioId: incorporationStudies.selectedScenarioId,
    semKml: incorporationStudies.semKml, looseLotsJson: incorporationStudies.looseLotsJson, areaM2: incorporationStudies.areaM2,
  }).from(incorporationStudies).where(eq(incorporationStudies.id, studyId));
  if (!e) throw new TRPCError({ code: "NOT_FOUND", message: "Estudo não encontrado." });
  const [p] = await getDb().select({
    id: incorporationMassStudies.id, name: incorporationMassStudies.name, version: incorporationMassStudies.version,
    paramsJson: incorporationMassStudies.paramsJson, scenariosJson: incorporationMassStudies.scenariosJson,
    selectedScenarioId: incorporationMassStudies.selectedScenarioId,
  }).from(incorporationMassStudies)
    .where(and(eq(incorporationMassStudies.studyId, studyId), eq(incorporationMassStudies.isPrincipal, true), isNull(incorporationMassStudies.deletedAt)))
    .limit(1);
  return cenarioPrincipalDe({
    principal: p ? { id: String(p.id), nome: p.name, versao: p.version, parametrosJson: p.paramsJson, cenariosJson: p.scenariosJson, cenarioEscolhidoId: p.selectedScenarioId } : null,
    massaCenariosJson: e.massScenariosJson,
    cenarioEscolhidoId: e.selectedScenarioId,
    semKml: e.semKml,
    lotesAvulsosJson: e.looseLotsJson,
    areaBrutaM2: Number(e.areaM2) || 0,
  });
}

/** Chamado após gravar/selecionar cenário; insert e eventos no mesmo comando. */
export async function sincronizarUnidadesCenario(studyId: number, actor: number) {
  const c = await obterCenarioPrincipal(studyId);
  const rows = unidadesDoCenario(c);
  const totalCenario = c ? rows.length : null;
  if (!rows.length) return { geradas: 0, totalCenario };
  const r = await getDb().execute(sql`WITH fonte AS (
    SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS f(codigo text, chave text, origem text, cenario text, valor text)
  ), changed AS (
    INSERT INTO incorporation_units(study_id, code, code_key, kind, source_key, scenario_id, sale_price)
    SELECT ${studyId}, codigo, chave, 'lote', origem, cenario, valor::numeric FROM fonte
    ON CONFLICT (study_id, code_key) DO UPDATE SET scenario_id = EXCLUDED.scenario_id,
      source_key = COALESCE(incorporation_units.source_key, EXCLUDED.source_key), updated_at = now()
    WHERE incorporation_units.deleted_at IS NULL AND incorporation_units.status = 'disponivel'
      AND incorporation_units.scenario_id IS DISTINCT FROM EXCLUDED.scenario_id
    RETURNING id, status
  ), audit AS (
    INSERT INTO incorporation_unit_events(unit_id, next_status, performed_by_user_id)
    SELECT id, status, ${actor} FROM changed RETURNING id
  ) SELECT count(*)::int AS n FROM audit`);
  return { geradas: Number(r.rows[0]?.n ?? 0), totalCenario };
}
