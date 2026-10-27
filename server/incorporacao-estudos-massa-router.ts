// Estudos de massa salvos (Lote 2, correção 11 · AD-04).
//
// Cada estudo salvo é uma linha própria (nome, versão, parâmetros, cenários,
// poligonal de referência, cenário escolhido, indicadores, quadro de áreas,
// autor, data, exclusão lógica). O estudo PRINCIPAL é espelhado nas colunas
// legadas do estudo de incorporação (mass_scenarios_json, selected_scenario_id,
// product_mix_json) para Viabilidade/Orçamento/Relatório continuarem lendo de lá.
//
// `obterCenarioPrincipal(studyId)` é a consulta do cenário principal (lotes e
// quadro de áreas) usada pelas ondas seguintes (unidades, viabilidade, orçamento).
import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { incorporationMassStudies, incorporationStudies, incorporationUnits, users } from "../drizzle/schema.js";
import type { CenarioMassa, ParametrosMassa } from "../shared/incorporacao/massa.js";
import {
  cenarioEscolhido, cenarioPrincipalDe, indicadoresDoCenario, mixDoCenario, motivoBloqueioExclusao,
  proximaVersao, quadroAreasDoCenario, validarNomeEstudo, type CenarioPrincipal, type EstudoMassaSalvo,
} from "../shared/incorporacao/estudos-massa.js";
import { requireModule } from "./_core/rbac.js";
import { protectedProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";

const id = z.number().int().positive();
const LIMITE_JSON = 8 * 1024 * 1024;

type Linha = typeof incorporationMassStudies.$inferSelect & { autorNome: string | null };

function parse<T>(json: string | null): T | null {
  if (!json) return null;
  try { return JSON.parse(json) as T; } catch { return null; }
}

function paraEstudoSalvo(l: Linha, completo: boolean): EstudoMassaSalvo {
  return {
    id: String(l.id),
    nome: l.name,
    versao: l.version,
    origemId: l.previousId ? String(l.previousId) : null,
    principal: l.isPrincipal,
    parametros: completo ? parse<ParametrosMassa>(l.paramsJson) : null,
    cenarios: completo ? parse<CenarioMassa[]>(l.scenariosJson) ?? [] : [],
    poligonalReferencia: completo ? l.referencePolygon : null,
    cenarioEscolhidoId: l.selectedScenarioId,
    indicadores: parse(l.indicatorsJson),
    quadroAreas: parse(l.areasJson),
    autorNome: l.autorNome,
    criadoEm: l.createdAt.toISOString(),
    atualizadoEm: l.updatedAt.toISOString(),
  };
}

async function estudo(studyId: number) {
  const [r] = await getDb().select({
    id: incorporationStudies.id, geojson: incorporationStudies.geojson, areaM2: incorporationStudies.areaM2,
    massScenariosJson: incorporationStudies.massScenariosJson, selectedScenarioId: incorporationStudies.selectedScenarioId,
    semKml: incorporationStudies.semKml, looseLotsJson: incorporationStudies.looseLotsJson,
    parameterizedBudgetJson: incorporationStudies.parameterizedBudgetJson, lottingJson: incorporationStudies.lottingJson,
    feasibilityJson: incorporationStudies.feasibilityJson,
  }).from(incorporationStudies).where(eq(incorporationStudies.id, studyId));
  if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Estudo não encontrado." });
  return r;
}

const selecao = {
  id: incorporationMassStudies.id, studyId: incorporationMassStudies.studyId, name: incorporationMassStudies.name,
  version: incorporationMassStudies.version, previousId: incorporationMassStudies.previousId,
  paramsJson: incorporationMassStudies.paramsJson, scenariosJson: incorporationMassStudies.scenariosJson,
  referencePolygon: incorporationMassStudies.referencePolygon, selectedScenarioId: incorporationMassStudies.selectedScenarioId,
  indicatorsJson: incorporationMassStudies.indicatorsJson, areasJson: incorporationMassStudies.areasJson,
  isPrincipal: incorporationMassStudies.isPrincipal, createdByUserId: incorporationMassStudies.createdByUserId,
  createdAt: incorporationMassStudies.createdAt, updatedAt: incorporationMassStudies.updatedAt,
  deletedAt: incorporationMassStudies.deletedAt, deletedByUserId: incorporationMassStudies.deletedByUserId,
  autorNome: users.name,
};

async function linhas(studyId: number): Promise<Linha[]> {
  return getDb().select(selecao).from(incorporationMassStudies)
    .leftJoin(users, eq(users.id, incorporationMassStudies.createdByUserId))
    .where(and(eq(incorporationMassStudies.studyId, studyId), isNull(incorporationMassStudies.deletedAt)))
    .orderBy(asc(incorporationMassStudies.name), asc(incorporationMassStudies.version));
}

async function linha(studyId: number, massId: number): Promise<Linha> {
  const [r] = await getDb().select(selecao).from(incorporationMassStudies)
    .leftJoin(users, eq(users.id, incorporationMassStudies.createdByUserId))
    .where(and(eq(incorporationMassStudies.id, massId), eq(incorporationMassStudies.studyId, studyId), isNull(incorporationMassStudies.deletedAt)));
  if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Estudo salvo não encontrado (pode ter sido excluído)." });
  return r;
}

/** Estudos anteriores à tabela: o conteúdo das colunas legadas vira o 1º estudo salvo (principal). */
async function importarLegado(e: Awaited<ReturnType<typeof estudo>>) {
  const legado = parse<{ params?: unknown; cenarios?: unknown }>(e.massScenariosJson);
  if (!legado || !Array.isArray(legado.cenarios) || legado.cenarios.length === 0) return;
  const cenarios = legado.cenarios as CenarioMassa[];
  const params = (legado.params ?? null) as ParametrosMassa | null;
  const c = cenarioEscolhido(cenarios, e.selectedScenarioId);
  // INSERT condicional num único comando: chamadas concorrentes não duplicam a importação.
  await getDb().execute(sql`INSERT INTO incorporation_mass_studies
      (study_id, name, version, params_json, scenarios_json, reference_polygon, selected_scenario_id, indicators_json, areas_json, is_principal)
    SELECT ${e.id}, 'Estudo anterior (importado)', 1, ${params ? JSON.stringify(params) : null}, ${JSON.stringify(cenarios)},
      ${e.geojson}, ${c?.id ?? null}, ${JSON.stringify(indicadoresDoCenario(c))},
      ${c ? JSON.stringify(quadroAreasDoCenario(c, params, Number(e.areaM2) || 0)) : null}, true
    WHERE NOT EXISTS (SELECT 1 FROM incorporation_mass_studies m WHERE m.study_id = ${e.id})`);
}

function derivados(paramsJson: string | null, scenariosJson: string, escolhidoId: string | null, areaBrutaM2: number) {
  const cenarios = parse<CenarioMassa[]>(scenariosJson);
  if (!Array.isArray(cenarios) || cenarios.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Gere ao menos um cenário antes de salvar." });
  const params = parse<ParametrosMassa>(paramsJson);
  const c = cenarioEscolhido(cenarios, escolhidoId)!;
  return {
    cenarios, params, cenario: c,
    selectedScenarioId: c.id,
    indicatorsJson: JSON.stringify(indicadoresDoCenario(c)),
    areasJson: JSON.stringify(quadroAreasDoCenario(c, params, areaBrutaM2)),
  };
}

/** Marca o principal e espelha nas colunas legadas — um único comando SQL. */
async function marcarPrincipal(studyId: number, massId: number) {
  const l = await linha(studyId, massId);
  const cenarios = parse<CenarioMassa[]>(l.scenariosJson) ?? [];
  const params = parse<ParametrosMassa>(l.paramsJson);
  const c = cenarioEscolhido(cenarios, l.selectedScenarioId);
  const massa = JSON.stringify({ params, cenarios });
  const mix = c && params ? JSON.stringify(mixDoCenario(c, params.precoM2Lote)) : null;
  const r = await getDb().execute(sql`WITH alvo AS (
      SELECT id FROM incorporation_mass_studies WHERE id = ${massId} AND study_id = ${studyId} AND deleted_at IS NULL
    ), troca AS (
      UPDATE incorporation_mass_studies SET is_principal = (id = ${massId}), updated_at = CASE WHEN id = ${massId} OR is_principal THEN now() ELSE updated_at END
      WHERE study_id = ${studyId} AND deleted_at IS NULL AND (is_principal OR id = ${massId}) AND EXISTS (SELECT 1 FROM alvo)
      RETURNING id
    ), espelho AS (
      UPDATE incorporation_studies SET mass_scenarios_json = ${massa}, selected_scenario_id = ${c?.id ?? null},
        product_mix_json = COALESCE(${mix}, product_mix_json), updated_at = now()
      WHERE id = ${studyId} AND EXISTS (SELECT 1 FROM alvo) RETURNING id
    ) SELECT (SELECT count(*) FROM espelho) AS n`);
  if (!Number((r.rows[0] as { n?: unknown } | undefined)?.n)) throw new TRPCError({ code: "CONFLICT", message: "O estudo salvo foi excluído por outra operação. Atualize a lista." });
}

function conflitoVersao(e: unknown): never {
  const msg = e instanceof Error ? e.message : "";
  if (/incorporation_mass_studies_name_version_idx|duplicate key/i.test(msg)) {
    throw new TRPCError({ code: "CONFLICT", message: "Já existe um estudo salvo com este nome e versão. Atualize a lista e tente de novo." });
  }
  throw e;
}

export async function obterCenarioPrincipal(studyId: number): Promise<CenarioPrincipal | null> {
  const e = await estudo(studyId);
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

const json = z.string().max(LIMITE_JSON);

export const incorporationMassStudiesRouter = router({
  list: protectedProcedure.input(z.object({ studyId: id })).query(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    await importarLegado(await estudo(input.studyId));
    return (await linhas(input.studyId)).map((l) => paraEstudoSalvo(l, false));
  }),

  get: protectedProcedure.input(z.object({ studyId: id, id })).query(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    return paraEstudoSalvo(await linha(input.studyId, input.id), true);
  }),

  /** novo = versão 1 de um nome novo · nova_versao = cópia versionada · atualizar = edita no lugar. */
  save: protectedProcedure.input(z.object({
    studyId: id,
    mode: z.enum(["novo", "nova_versao", "atualizar"]),
    id: id.optional(),
    name: z.string().trim().min(1).max(120),
    paramsJson: json.nullable(),
    scenariosJson: json.min(2),
    selectedScenarioId: z.string().max(120).nullable(),
    makePrincipal: z.boolean().default(false),
  })).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    const erroNome = validarNomeEstudo(input.name);
    if (erroNome) throw new TRPCError({ code: "BAD_REQUEST", message: erroNome });
    const e = await estudo(input.studyId);
    const d = derivados(input.paramsJson, input.scenariosJson, input.selectedScenarioId, Number(e.areaM2) || 0);
    const db = getDb();
    let massId: number;
    let principal = input.makePrincipal;
    if (input.mode === "atualizar") {
      if (!input.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Estudo salvo não informado." });
      const atual = await linha(input.studyId, input.id);
      principal = principal || atual.isPrincipal;
      try {
        await db.update(incorporationMassStudies).set({
          name: input.name.trim(), paramsJson: input.paramsJson, scenariosJson: input.scenariosJson,
          referencePolygon: e.geojson, selectedScenarioId: d.selectedScenarioId, indicatorsJson: d.indicatorsJson,
          areasJson: d.areasJson, updatedAt: new Date(),
        }).where(and(eq(incorporationMassStudies.id, input.id), isNull(incorporationMassStudies.deletedAt)));
      } catch (err) { conflitoVersao(err); }
      massId = input.id;
    } else {
      const todas = await db.select({ nome: incorporationMassStudies.name, versao: incorporationMassStudies.version, principal: incorporationMassStudies.isPrincipal, deletedAt: incorporationMassStudies.deletedAt })
        .from(incorporationMassStudies).where(eq(incorporationMassStudies.studyId, input.studyId));
      let previousId: number | null = null;
      if (input.mode === "nova_versao") {
        if (!input.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Estudo de origem não informado." });
        previousId = (await linha(input.studyId, input.id)).id;
      }
      // o primeiro estudo salvo vira principal automaticamente
      if (!todas.some((t) => t.principal && !t.deletedAt)) principal = true;
      try {
        const [nova] = await db.insert(incorporationMassStudies).values({
          studyId: input.studyId, name: input.name.trim(), version: proximaVersao(todas, input.name), previousId,
          paramsJson: input.paramsJson, scenariosJson: input.scenariosJson, referencePolygon: e.geojson,
          selectedScenarioId: d.selectedScenarioId, indicatorsJson: d.indicatorsJson, areasJson: d.areasJson,
          createdByUserId: ctx.user.id,
        }).returning({ id: incorporationMassStudies.id });
        massId = nova.id;
      } catch (err) { conflitoVersao(err); }
    }
    if (principal) await marcarPrincipal(input.studyId, massId);
    return paraEstudoSalvo(await linha(input.studyId, massId), false);
  }),

  setPrincipal: protectedProcedure.input(z.object({ studyId: id, id })).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    await marcarPrincipal(input.studyId, input.id);
    return { success: true };
  }),

  delete: protectedProcedure.input(z.object({ studyId: id, id })).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    const alvo = await linha(input.studyId, input.id);
    const e = await estudo(input.studyId);
    if (alvo.isPrincipal) {
      const [u] = await getDb().select({ n: sql<number>`count(*)::int` }).from(incorporationUnits).where(eq(incorporationUnits.studyId, input.studyId));
      const motivo = motivoBloqueioExclusao(true, {
        unidades: u?.n ?? 0,
        orcamento: !!e.parameterizedBudgetJson?.trim(),
        viabilidade: !!e.lottingJson?.trim() || !!e.feasibilityJson?.trim(),
      });
      if (motivo) throw new TRPCError({ code: "PRECONDITION_FAILED", message: motivo });
    }
    // Exclusão lógica; se era o principal (sem dependentes), o espelho legado é limpo
    // no mesmo comando — os demais estudos salvos e a geometria do terreno ficam.
    const r = await getDb().execute(sql`WITH apagado AS (
        UPDATE incorporation_mass_studies SET deleted_at = now(), deleted_by_user_id = ${ctx.user.id}, is_principal = false, updated_at = now()
        WHERE id = ${input.id} AND study_id = ${input.studyId} AND deleted_at IS NULL RETURNING id, ${alvo.isPrincipal}::boolean AS era_principal
      ), espelho AS (
        UPDATE incorporation_studies SET mass_scenarios_json = NULL, selected_scenario_id = NULL, updated_at = now()
        WHERE id = ${input.studyId} AND EXISTS (SELECT 1 FROM apagado WHERE era_principal) RETURNING id
      ) SELECT (SELECT count(*) FROM apagado) AS n`);
    if (!Number((r.rows[0] as { n?: unknown } | undefined)?.n)) throw new TRPCError({ code: "CONFLICT", message: "O estudo já havia sido excluído." });
    return { success: true };
  }),

  /** Cenário principal do estudo (lotes + quadro de áreas) — base das ondas 12, 15 e 20. */
  principal: protectedProcedure.input(z.object({ studyId: id })).query(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    return obterCenarioPrincipal(input.studyId);
  }),
});
