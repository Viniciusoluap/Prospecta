import { eq, sql } from "drizzle-orm";
import { incorporationStudies } from "../drizzle/schema.js";
import { cenarioPrincipalDe } from "../shared/incorporacao/estudos-massa.js";
import { unidadesDoCenario } from "../shared/incorporacao/unidades.js";
import { getDb } from "./db.js";

/** Chamado após gravar/selecionar cenário; insert e eventos no mesmo comando. */
export async function sincronizarUnidadesCenario(studyId: number, actor: number) {
  const [s] = await getDb().select().from(incorporationStudies).where(eq(incorporationStudies.id, studyId));
  if (!s) throw new Error("Estudo não encontrado.");
  const c = cenarioPrincipalDe({ massaCenariosJson: s.massScenariosJson, cenarioEscolhidoId: s.selectedScenarioId,
    areaBrutaM2: Number(s.areaM2) || 0, semKml: s.semKml, lotesAvulsosJson: s.looseLotsJson });
  const rows = unidadesDoCenario(c);
  if (!rows.length) return { geradas: 0 };
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
  return { geradas: Number(r.rows[0]?.n ?? 0) };
}
