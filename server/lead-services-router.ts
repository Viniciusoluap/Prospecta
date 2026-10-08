import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { constructionProjects, leadServices, leads } from "../drizzle/schema.js";
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

/**
 * A plataforma atual não roda migrations no deploy. Esta inicialização é
 * deliberadamente idempotente e é reutilizada pelos módulos que dependem
 * destes vínculos. A migration Drizzle continua sendo a fonte de
 * rastreabilidade do esquema.
 */
let schemaInitialization: Promise<void> | undefined;

export async function ensureLeadServicesSchema() {
  if (!schemaInitialization) {
    schemaInitialization = initializeLeadServicesSchema().catch(error => {
      schemaInitialization = undefined;
      throw error;
    });
  }
  return schemaInitialization;
}

async function initializeLeadServicesSchema() {
  const database = getDb();
  await database.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "lead_services" (
      "id" serial PRIMARY KEY NOT NULL,
      "lead_id" integer NOT NULL REFERENCES "leads"("id") ON DELETE cascade,
      "service_type" varchar(60) NOT NULL,
      "title" varchar(255),
      "status" varchar(40) DEFAULT 'awaiting_data' NOT NULL,
      "origin_list" varchar(255),
      "source_card_url" text,
      "due_at" timestamp,
      "description" text DEFAULT '' NOT NULL,
      "operational_module" varchar(80),
      "operational_record_id" integer,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )
  `));
  await database.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS "lead_services_source_card_url_unique" ON "lead_services" ("source_card_url")`));
  await database.execute(sql.raw(`ALTER TABLE "regularizacoes" ADD COLUMN IF NOT EXISTS "lead_service_id" integer REFERENCES "lead_services"("id") ON DELETE set null`));
  await database.execute(sql.raw(`ALTER TABLE "financiamentos" ADD COLUMN IF NOT EXISTS "lead_service_id" integer REFERENCES "lead_services"("id") ON DELETE set null`));
  await database.execute(sql.raw(`ALTER TABLE "operational_projects" ADD COLUMN IF NOT EXISTS "lead_service_id" integer REFERENCES "lead_services"("id") ON DELETE set null`));
  await database.execute(sql.raw(`ALTER TABLE "construction_projects" ADD COLUMN IF NOT EXISTS "lead_id" integer REFERENCES "leads"("id") ON DELETE set null`));
  await database.execute(sql.raw(`ALTER TABLE "construction_projects" ADD COLUMN IF NOT EXISTS "lead_service_id" integer REFERENCES "lead_services"("id") ON DELETE set null`));
  await database.execute(sql.raw(`ALTER TABLE "construction_projects" ALTER COLUMN "user_id" DROP NOT NULL`));
  await database.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS "construction_projects_lead_service_id_unique" ON "construction_projects" ("lead_service_id")`));
}

const isWorksService = (serviceType: string) => serviceType === "obra_cliente" || serviceType === "vistoria_medicao";

/** Cria a obra mínima, sem inventar endereço, valores ou dados financeiros. */
async function ensureOperationalRecord(service: typeof leadServices.$inferSelect, lead: typeof leads.$inferSelect) {
  const database = getDb();
  if (!isWorksService(service.serviceType)) return { service, createdWork: false };

  const [existingWork] = await database.select({ id: constructionProjects.id })
    .from(constructionProjects)
    .where(eq(constructionProjects.leadServiceId, service.id))
    .limit(1);
  const workId = existingWork?.id || service.operationalRecordId;
  if (workId) {
    const [updated] = await database.update(leadServices).set({
      operationalModule: "obras", operationalRecordId: workId, status: "active", updatedAt: new Date(),
    }).where(eq(leadServices.id, service.id)).returning();
    return { service: updated, createdWork: false };
  }

  const [work] = await database.insert(constructionProjects).values({
    leadId: lead.id,
    leadServiceId: service.id,
    title: service.title || lead.name,
    city: lead.city || null,
    state: lead.state || null,
    projectType: service.serviceType === "vistoria_medicao" ? "Vistoria e medição" : "Obra / reforma",
    status: "planning",
    progress: 0,
    notes: service.description || lead.notes || null,
  }).returning();
  const [updated] = await database.update(leadServices).set({
    operationalModule: "obras", operationalRecordId: work.id, status: "active", updatedAt: new Date(),
  }).where(eq(leadServices.id, service.id)).returning();
  return { service: updated, createdWork: true };
}

export async function createLeadServiceWithAutomation(input: z.infer<typeof serviceInput>) {
  await ensureLeadServicesSchema();
  const database = getDb();
  const [lead] = await database.select().from(leads).where(eq(leads.id, input.leadId)).limit(1);
  if (!lead) throw new Error("Lead não encontrado");
  const [created] = await database.insert(leadServices).values({
    ...input,
    title: input.title || undefined,
    status: input.status || "active",
    operationalModule: LEAD_SERVICE_MODULE[input.serviceType],
  }).returning();
  return ensureOperationalRecord(created, lead);
}

export const leadServicesRouter = router({
  listByLead: adminProcedure.input(z.object({ leadId: z.number().int().positive() })).query(async ({ input }) =>
    getDb().select().from(leadServices).where(eq(leadServices.leadId, input.leadId)).orderBy(desc(leadServices.createdAt))
  ),

  create: adminProcedure.input(serviceInput).mutation(async ({ input }) =>
    (await createLeadServiceWithAutomation(input)).service
  ),

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

  setStatus: adminProcedure.input(z.object({
    id: z.number().int().positive(),
    status: z.enum(["active", "paused", "completed", "cancelled"]),
  })).mutation(async ({ input }) => {
    const [updated] = await getDb().update(leadServices).set({ status: input.status, updatedAt: new Date() })
      .where(eq(leadServices.id, input.id)).returning();
    if (!updated) throw new Error("Serviço não encontrado");
    return updated;
  }),

  unlinkProcess: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    const [updated] = await getDb().update(leadServices).set({
      operationalRecordId: null, status: "active", updatedAt: new Date(),
    }).where(eq(leadServices.id, input.id)).returning();
    if (!updated) throw new Error("Serviço não encontrado");
    return updated;
  }),

  remove: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    const [removed] = await getDb().delete(leadServices).where(eq(leadServices.id, input.id)).returning();
    if (!removed) throw new Error("Serviço não encontrado");
    return { success: true };
  }),

  backfillFromTrello: adminProcedure.mutation(async () => {
    await ensureLeadServicesSchema();
    const database = getDb();
    const migrated = await database.select().from(leads).where(sql`${leads.notes} like '%trello.com/c/%'`);
    let created = 0;
    let synchronized = 0;
    let worksCreated = 0;
    for (const lead of migrated) {
      const meta = sourceMetadata(lead.notes);
      if (!meta.sourceCardUrl) continue;
      const [existing] = await database.select().from(leadServices)
        .where(eq(leadServices.sourceCardUrl, meta.sourceCardUrl)).limit(1);
      if (existing) {
        const result = await ensureOperationalRecord(existing, lead);
        synchronized++;
        if (result.createdWork) worksCreated++;
        continue;
      }
      const serviceType = serviceTypeFromTrelloText(`${lead.name}\n${lead.notes || ""}`);
      const result = await createLeadServiceWithAutomation({
        leadId: lead.id, serviceType, title: lead.name, originList: meta.originList,
        sourceCardUrl: meta.sourceCardUrl, dueAt: meta.dueAt, description: lead.notes || "",
      });
      created++;
      if (result.createdWork) worksCreated++;
    }
    return { created, synchronized, worksCreated, total: migrated.length };
  }),
});
