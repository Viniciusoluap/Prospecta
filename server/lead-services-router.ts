import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { leadServices, leads } from "../drizzle/schema.js";
import { LEAD_SERVICE_MODULE, LEAD_SERVICE_TYPES, serviceTypeFromTrelloText } from "../shared/lead-services.js";
import { adminProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";

const serviceInput = z.object({
  leadId: z.number().int().positive(),
  serviceType: z.enum(LEAD_SERVICE_TYPES),
  title: z.string().trim().min(2).max(255).optional(),
  status: z.enum(["awaiting_data", "active", "paused", "completed", "cancelled"]).optional(),
  originList: z.string().trim().max(255).optional(),
  sourceCardUrl: z.string().url().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  description: z.string().max(10000).optional(),
});

function sourceMetadata(notes: string | null) {
  const value = notes || "";
  const sourceCardUrl = value.match(/https:\/\/trello\.com\/c\/[^\s)]+/i)?.[0];
  const dueAtText = value.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)?.[0];
  const originList = value.match(/(?:lista(?: de origem)?|origem)\s*:\s*([^\n]+)/i)?.[1]?.trim();
  return { sourceCardUrl, dueAt: dueAtText ? new Date(dueAtText) : null, originList };
}

export const leadServicesRouter = router({
  listByLead: adminProcedure.input(z.object({ leadId: z.number().int().positive() })).query(async ({ input }) =>
    getDb().select().from(leadServices).where(eq(leadServices.leadId, input.leadId)).orderBy(desc(leadServices.createdAt))
  ),

  create: adminProcedure.input(serviceInput).mutation(async ({ input }) => {
    const database = getDb();
    const [lead] = await database.select({ id: leads.id }).from(leads).where(eq(leads.id, input.leadId)).limit(1);
    if (!lead) throw new Error("Lead não encontrado");
    const [created] = await database.insert(leadServices).values({
      ...input,
      title: input.title || undefined,
      status: input.status || "awaiting_data",
      operationalModule: LEAD_SERVICE_MODULE[input.serviceType],
    }).returning();
    return created;
  }),

  update: adminProcedure.input(serviceInput.partial().extend({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    const { id, serviceType, ...data } = input;
    const [updated] = await getDb().update(leadServices).set({
      ...data,
      ...(serviceType ? { serviceType, operationalModule: LEAD_SERVICE_MODULE[serviceType] } : {}),
      updatedAt: new Date(),
    }).where(eq(leadServices.id, id)).returning();
    if (!updated) throw new Error("Serviço não encontrado");
    return updated;
  }),

  linkProcess: adminProcedure.input(z.object({
    id: z.number().int().positive(),
    operationalModule: z.string().trim().min(2).max(80),
    operationalRecordId: z.number().int().positive(),
  })).mutation(async ({ input }) => {
    const [updated] = await getDb().update(leadServices).set({
      operationalModule: input.operationalModule,
      operationalRecordId: input.operationalRecordId,
      status: "active",
      updatedAt: new Date(),
    }).where(eq(leadServices.id, input.id)).returning();
    if (!updated) throw new Error("Serviço não encontrado");
    return updated;
  }),

  backfillFromTrello: adminProcedure.mutation(async () => {
    const database = getDb();
    const migrated = await database.select().from(leads).where(sql`${leads.notes} like '%trello.com/c/%'`);
    let created = 0;
    let skipped = 0;
    for (const lead of migrated) {
      const meta = sourceMetadata(lead.notes);
      if (!meta.sourceCardUrl) { skipped++; continue; }
      const [existing] = await database.select({ id: leadServices.id }).from(leadServices)
        .where(eq(leadServices.sourceCardUrl, meta.sourceCardUrl)).limit(1);
      if (existing) { skipped++; continue; }
      const serviceType = serviceTypeFromTrelloText(`${lead.name}\n${lead.notes || ""}`);
      await database.insert(leadServices).values({
        leadId: lead.id,
        serviceType,
        status: "awaiting_data",
        title: lead.name,
        originList: meta.originList || null,
        sourceCardUrl: meta.sourceCardUrl,
        dueAt: meta.dueAt,
        description: lead.notes || "",
        operationalModule: LEAD_SERVICE_MODULE[serviceType],
      });
      created++;
    }
    return { created, skipped, total: migrated.length };
  }),
});
