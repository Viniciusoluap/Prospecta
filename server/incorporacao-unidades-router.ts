import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { incorporationStudies, incorporationUnits, incorporationUnitEvents } from "../drizzle/schema.js";
import { chaveUnidade, vendasLegadas } from "../shared/incorporacao/unidades.js";
import { requireModule } from "./_core/rbac.js";
import { protectedProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";

const studyId = z.number().int().positive();
const price = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).refine((v) => Number(v) > 0);

async function study(id: number) {
  const [record] = await getDb().select({ id: incorporationStudies.id, type: incorporationStudies.incorporationType, legacy: incorporationStudies.realEstateLaunchJson })
    .from(incorporationStudies).where(eq(incorporationStudies.id, id));
  if (!record) throw new TRPCError({ code: "NOT_FOUND" });
  if (record.type !== "desmembramento_simples") throw new TRPCError({ code: "BAD_REQUEST", message: "Inventário exclusivo de Desmembramento Simples" });
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

export const incorporationUnitsRouter = router({
  list: protectedProcedure.input(z.object({ studyId })).query(async ({ ctx, input }) => {
    requireModule(ctx, "incorporacao");
    const [units, legacy] = await Promise.all([
      getDb().select().from(incorporationUnits).where(eq(incorporationUnits.studyId, input.studyId)).orderBy(incorporationUnits.code),
      pendingLegacy(input.studyId),
    ]);
    return { units, legacyPending: legacy.pending, legacyInvalid: legacy.invalido };
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
      WHERE id = ${input.unitId} AND study_id = ${input.studyId} AND status IN (${sql.join(expected.map((v) => sql`${v}`), sql`, `)})
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
