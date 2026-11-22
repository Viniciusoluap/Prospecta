import { TRPCError } from "@trpc/server";
import { and, eq, isNull, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { incorporationStudies, incorporationUnits, incorporationUnitEvents, leads } from "../drizzle/schema.js";
import { chaveUnidade, vendasLegadas } from "../shared/incorporacao/unidades.js";
import { requireModule } from "./_core/rbac.js";
import { protectedProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";

import { obterCenarioPrincipal, sincronizarUnidadesCenario } from "./incorporacao-unidades-cenario.js";

const studyId = z.number().int().positive();
const price = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).refine((v) => Number(v) > 0);

async function study(id: number) {
  const [record] = await getDb().select({ id: incorporationStudies.id, type: incorporationStudies.incorporationType, legacy: incorporationStudies.realEstateLaunchJson })
    .from(incorporationStudies).where(eq(incorporationStudies.id, id));
  if (!record) throw new TRPCError({ code: "NOT_FOUND" });
  return record;
}

async function pendingLegacy(id: number) {
  const legacy = vendasLegadas((await study(id)).legacy);
  if (legacy.invalido) return { ...legacy, pending: [] as typeof legacy.vendas };
  const rows = await getDb().select({ legacyId: incorporationUnitEvents.legacySaleId })
    .from(incorporationUnitEvents).innerJoin(incorporationUnits, eq(incorporationUnitEvents.unitId, incorporationUnits.id))
    .where(eq(incorporationUnits.studyId, id));
  const reconciled = new Set(rows.map((r) => r.legacyId).filter(Boolean));
  return { ...legacy, pending: legacy.vendas.filter((v) => !reconciled.has(v.id)) };
}

function conflict(): never { throw new TRPCError({ code: "CONFLICT", message: "Estado da unidade alterado por outra operação. Atualize a lista." }); }

/** Exclusão lógica e auditoria são atômicas, inclusive para todo o inventário. */
async function excluirUnidades(estudoId: number, actor: number, unidadeId?: number) {
  const result = await getDb().execute(sql`WITH changed AS (
      UPDATE incorporation_units u SET deleted_at = now(), updated_at = now() WHERE u.study_id = ${estudoId}
      ${unidadeId === undefined ? sql`` : sql`AND u.id = ${unidadeId}`}
      AND deleted_at IS NULL AND status = 'disponivel'
      AND COALESCE((
        SELECT e.previous_status = 'vendida' AND e.next_status = 'disponivel'
        FROM incorporation_unit_events e WHERE e.unit_id = u.id
          AND (e.next_status IN ('vendida', 'reservada') OR (e.previous_status = 'vendida' AND e.next_status = 'disponivel'))
        ORDER BY e.id DESC LIMIT 1
      ), true)
      RETURNING id, status
    ), audit AS (
      INSERT INTO incorporation_unit_events(unit_id, previous_status, next_status, performed_by_user_id)
      SELECT id, status, 'excluida', ${actor} FROM changed RETURNING id
    ) SELECT count(*)::int AS excluidas FROM audit`);
  return { excluidas: Number(result.rows[0]?.excluidas ?? 0) };
}

export const incorporationUnitsRouter = router({
  clients: protectedProcedure.input(z.object({ query: z.string().max(120).optional() }).optional()).query(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao"); requireModule(ctx, "crm");
    return getDb().select({ id: leads.id, nome: leads.name, telefone: leads.phone, valorNegociado: leads.negotiatedValue }).from(leads)
      .where(and(isNull(leads.deletedAt), input?.query ? ilike(leads.name, `%${input.query}%`) : undefined)).orderBy(leads.name).limit(200);
  }),
  synchronize: protectedProcedure.input(z.object({ studyId })).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    return sincronizarUnidadesCenario(input.studyId, ctx.user.id, true);
  }),
  edit: protectedProcedure.input(z.object({ studyId, unitId: studyId, status: z.enum(["disponivel", "reservada", "vendida"]), buyer: z.string().trim().max(255).nullable(), buyerLeadId: studyId.nullable(), salePrice: price.nullable(), expectedRevision: z.number().int().nonnegative() })).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao"); await study(input.studyId);
    const legacy = await pendingLegacy(input.studyId);
    if (legacy.invalido || legacy.pending.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Concilie as vendas históricas antes de alterar o inventário." });
    let buyer = input.buyer;
    if (input.buyerLeadId) {
      requireModule(ctx, "crm");
      const [l] = await getDb().select({ name: leads.name }).from(leads).where(and(eq(leads.id, input.buyerLeadId), isNull(leads.deletedAt)));
      if (!l) throw new TRPCError({ code: "BAD_REQUEST", message: "Cliente do CRM não encontrado." });
      buyer = l.name;
    }
    if (input.status === "vendida" && (!buyer || !input.salePrice)) throw new TRPCError({ code: "BAD_REQUEST", message: "Informe comprador e valor para vender." });
    const r = await getDb().execute(sql`WITH anterior AS MATERIALIZED (
      SELECT * FROM incorporation_units WHERE id = ${input.unitId} AND study_id = ${input.studyId} AND deleted_at IS NULL
        AND revision = ${input.expectedRevision}
        AND (status <> 'vendida' OR ${input.status} = 'vendida') FOR UPDATE
    ), changed AS (
      UPDATE incorporation_units u SET status = ${input.status}, buyer = ${buyer}, buyer_lead_id = ${input.buyerLeadId},
        sale_price = ${input.salePrice}::numeric, updated_at = now() FROM anterior a WHERE u.id = a.id RETURNING u.id
    ), audit AS (
      INSERT INTO incorporation_unit_events(unit_id, previous_status, next_status, buyer, sale_price, performed_by_user_id)
      SELECT c.id, a.status, ${input.status}, ${buyer}, ${input.salePrice}::numeric, ${ctx.user.id} FROM changed c JOIN anterior a ON a.id = c.id RETURNING id
    ) SELECT id FROM audit`);
    if (!r.rows.length) throw new TRPCError({ code: "CONFLICT", message: "Atualize a unidade. Para liberar uma unidade vendida, use Cancelar venda." });
    return { success: true };
  }),
  cancelSale: protectedProcedure.input(z.object({ studyId, unitId: studyId, expectedRevision: z.number().int().nonnegative() })).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    const legacy = await pendingLegacy(input.studyId);
    if (legacy.invalido || legacy.pending.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Concilie as vendas históricas antes de cancelar." });
    const result = await getDb().execute(sql`WITH anterior AS MATERIALIZED (
      SELECT id, buyer, sale_price FROM incorporation_units WHERE id = ${input.unitId}
        AND study_id = ${input.studyId} AND deleted_at IS NULL AND status = 'vendida'
        AND revision = ${input.expectedRevision} FOR UPDATE
    ), changed AS (
      UPDATE incorporation_units u SET status = 'disponivel', buyer = NULL, buyer_lead_id = NULL,
        sale_price = NULL, updated_at = now()
      FROM anterior a WHERE u.id = a.id RETURNING u.id
    )
    INSERT INTO incorporation_unit_events(unit_id, previous_status, next_status, buyer, sale_price, performed_by_user_id)
    SELECT a.id, 'vendida', 'disponivel', a.buyer, a.sale_price, ${ctx.user.id}
    FROM anterior a JOIN changed c ON c.id = a.id RETURNING id`);
    if (!result.rows.length) conflict();
    return { success: true };
  }),
  delete: protectedProcedure.input(z.object({ studyId, unitId: studyId })).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao"); await study(input.studyId);
    const { excluidas } = await excluirUnidades(input.studyId, ctx.user.id, input.unitId);
    if (!excluidas) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Exclusão bloqueada: há reserva, venda ou histórico comercial. Cancele a venda ou revise os vínculos antes de excluir." });
    return { success: true };
  }),
  deleteAll: protectedProcedure.input(z.object({ studyId })).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    const legacy = await pendingLegacy(input.studyId);
    if (legacy.invalido || legacy.pending.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Concilie as vendas históricas antes de excluir em lote." });
    return excluirUnidades(input.studyId, ctx.user.id);
  }),
  temUnidades: protectedProcedure.input(z.object({ studyId })).query(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    const [unidade] = await getDb().select({ id: incorporationUnits.id }).from(incorporationUnits)
      .where(and(eq(incorporationUnits.studyId, input.studyId), isNull(incorporationUnits.deletedAt)))
      .limit(1);
    return !!unidade;
  }),
  list: protectedProcedure.input(z.object({ studyId })).query(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    const [units, legacy, cenario] = await Promise.all([
      getDb().select().from(incorporationUnits).where(and(eq(incorporationUnits.studyId, input.studyId), isNull(incorporationUnits.deletedAt))).orderBy(incorporationUnits.code),
      pendingLegacy(input.studyId),
      obterCenarioPrincipal(input.studyId),
    ]);
    return { units, totalCenario: cenario?.lotes.length ?? null, legacyPending: legacy.pending, legacyInvalid: legacy.invalido };
  }),
  create: protectedProcedure.input(z.object({ studyId, code: z.string().trim().min(1).max(120), kind: z.string().trim().min(1).max(40) })).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao"); await study(input.studyId);
    const codeKey = chaveUnidade(input.code);
    if (!codeKey || codeKey.length > 120) throw new TRPCError({ code: "BAD_REQUEST" });
    const rows = await getDb().execute(sql`WITH created AS (
      INSERT INTO incorporation_units (study_id, code, code_key, kind) VALUES (${input.studyId}, ${input.code.trim()}, ${codeKey}, ${input.kind.trim()})
      ON CONFLICT (study_id, code_key) DO NOTHING RETURNING id
    ), audit AS (
      INSERT INTO incorporation_unit_events (unit_id, next_status, performed_by_user_id)
      SELECT id, 'disponivel', ${ctx.user.id} FROM created RETURNING id
    ) SELECT id FROM audit`);
    if (!rows.rows.length) throw new TRPCError({ code: "CONFLICT", message: `Já existe uma unidade com o código "${input.code.trim()}" neste estudo.` });
    return { success: true };
  }),
  transition: protectedProcedure.input(z.object({ studyId, unitId: studyId, action: z.enum(["reservar", "vender", "liberar"]), buyer: z.string().trim().max(255).optional(), salePrice: price.optional() })).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    const legacy = await pendingLegacy(input.studyId);
    if (legacy.invalido || legacy.pending.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Concilie as vendas históricas antes de alterar o inventário." });
    if (input.action === "vender" && (!input.buyer?.trim() || !input.salePrice)) throw new TRPCError({ code: "BAD_REQUEST", message: "Comprador e valor são obrigatórios" });
    const expected = input.action === "reservar" ? ["disponivel"] : input.action === "vender" ? ["disponivel", "reservada"] : ["reservada"];
    const next = input.action === "reservar" ? "reservada" : input.action === "vender" ? "vendida" : "disponivel";
    const rows = await getDb().execute(sql`WITH changed AS (
      UPDATE incorporation_units SET status = ${next}, buyer = ${input.action === "vender" ? input.buyer!.trim() : null},
        sale_price = ${input.action === "vender" ? input.salePrice! : null}, updated_at = now()
      WHERE id = ${input.unitId} AND study_id = ${input.studyId} AND deleted_at IS NULL AND status IN (${sql.join(expected.map((v) => sql`${v}`), sql`, `)})
      RETURNING id, status, buyer, sale_price
    ), audit AS (
      INSERT INTO incorporation_unit_events (unit_id, previous_status, next_status, buyer, sale_price, performed_by_user_id)
      SELECT id, (SELECT old.status FROM incorporation_units old WHERE old.id = changed.id), status, buyer, sale_price, ${ctx.user.id} FROM changed RETURNING id
    ) SELECT id FROM audit`);
    if (!rows.rows.length) conflict();
    return { success: true };
  }),
  reconcile: protectedProcedure.input(z.object({ studyId, saleId: z.string().min(1).max(120), kind: z.string().trim().min(1).max(40) })).mutation(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    const legacy = await pendingLegacy(input.studyId);
    if (legacy.invalido) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Vendas históricas ambíguas: revise os dados originais." });
    const sale = legacy.pending.find((v) => v.id === input.saleId);
    if (!sale) conflict();
    const key = chaveUnidade(sale.unidade);
    const rows = await getDb().execute(sql`WITH changed AS (
      INSERT INTO incorporation_units (study_id, code, code_key, kind, status, buyer, sale_price)
      VALUES (${input.studyId}, ${sale.unidade}, ${key}, ${input.kind.trim()}, 'vendida', ${sale.comprador}, ${sale.valorVenda.toFixed(2)})
      ON CONFLICT (study_id, code_key) DO UPDATE SET status = 'vendida', buyer = EXCLUDED.buyer,
        sale_price = EXCLUDED.sale_price, updated_at = now()
      WHERE incorporation_units.status = 'disponivel' RETURNING id
    ), audit AS (
      INSERT INTO incorporation_unit_events (unit_id, previous_status, next_status, buyer, sale_price, legacy_sale_id, performed_by_user_id)
      SELECT id, 'disponivel', 'vendida', ${sale.comprador}, ${sale.valorVenda.toFixed(2)}, ${sale.id}, ${ctx.user.id} FROM changed
      ON CONFLICT DO NOTHING RETURNING id
    ) SELECT id FROM audit`);
    if (!rows.rows.length) conflict();
    return { success: true };
  }),
});
