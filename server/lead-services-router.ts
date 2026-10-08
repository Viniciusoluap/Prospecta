import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { constructionProjects, leadServices, leads } from "../drizzle/schema.js";
import { LEAD_SERVICE_MODULE, LEAD_SERVICE_TYPES, serviceTypeFromTrelloFields } from "../shared/lead-services.js";
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
  const originList = value.match(/(?:lista(?: de origem)?|lista original(?: do trello)?|origem da lista)\s*:\s*([^\n|—]+)/i)?.[1]?.trim();
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
  if (!isWorksService(service.serviceType)) return { service, workState: "not_applicable" as const };

  const [existingWork] = await database.select({ id: constructionProjects.id })
    .from(constructionProjects)
    .where(eq(constructionProjects.leadServiceId, service.id))
    .limit(1);
  if (existingWork) {
    const [updated] = await database.update(leadServices).set({
      operationalModule: "obras", operationalRecordId: existingWork.id, status: "active", updatedAt: new Date(),
    }).where(eq(leadServices.id, service.id)).returning();
    return { service: updated, workState: "already_linked" as const };
  }

  // Versões anteriores podiam gravar operational_record_id sem ligar a obra
  // pela FK. Só confiamos no ID se a obra realmente existir e estiver livre.
  if (service.operationalRecordId) {
    const [legacyWork] = await database.select({
      id: constructionProjects.id,
      leadServiceId: constructionProjects.leadServiceId,
    }).from(constructionProjects)
      .where(eq(constructionProjects.id, service.operationalRecordId))
      .limit(1);
    if (legacyWork && (!legacyWork.leadServiceId || legacyWork.leadServiceId === service.id)) {
      await database.update(constructionProjects).set({
        leadId: lead.id,
        leadServiceId: service.id,
        updatedAt: new Date(),
      }).where(eq(constructionProjects.id, legacyWork.id));
      const [updated] = await database.update(leadServices).set({
        operationalModule: "obras", operationalRecordId: legacyWork.id, status: "active", updatedAt: new Date(),
      }).where(eq(leadServices.id, service.id)).returning();
      return { service: updated, workState: "relinked" as const };
    }
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
  return { service: updated, workState: "created" as const };
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
    const [lead] = await getDb().select().from(leads).where(eq(leads.id, updated.leadId)).limit(1);
    if (!lead) throw new Error("Lead do serviço não encontrado");
    return (await ensureOperationalRecord(updated, lead)).service;
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
    const database = getDb();
    const [service] = await database.select().from(leadServices).where(eq(leadServices.id, input.id)).limit(1);
    if (!service) throw new Error("Serviço não encontrado");
    if (service.operationalModule === "obras" && service.operationalRecordId) {
      await database.update(constructionProjects).set({ leadServiceId: null, updatedAt: new Date() })
        .where(eq(constructionProjects.id, service.operationalRecordId));
    }
    const [updated] = await database.update(leadServices).set({
      operationalRecordId: null, status: "active", updatedAt: new Date(),
    }).where(eq(leadServices.id, input.id)).returning();
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
    let servicesCreated = 0;
    let servicesReclassified = 0;
    let worksCreated = 0;
    let worksRelinked = 0;
    let alreadySynchronized = 0;
    let ignored = 0;
    const errors: Array<{ leadId: number; message: string }> = [];
    for (const lead of migrated) {
      try {
        const meta = sourceMetadata(lead.notes);
        if (!meta.sourceCardUrl) { ignored++; continue; }
        const inferredType = serviceTypeFromTrelloFields({
          title: lead.name,
          originList: meta.originList,
          description: lead.notes,
        });
        const [existing] = await database.select().from(leadServices)
          .where(eq(leadServices.sourceCardUrl, meta.sourceCardUrl)).limit(1);
        let service = existing;
        if (service) {
          if (inferredType !== "outro" && service.serviceType !== inferredType) {
            [service] = await database.update(leadServices).set({
              serviceType: inferredType,
              operationalModule: LEAD_SERVICE_MODULE[inferredType],
              originList: meta.originList || service.originList,
              updatedAt: new Date(),
            }).where(eq(leadServices.id, service.id)).returning();
            servicesReclassified++;
          }
        } else {
          const result = await createLeadServiceWithAutomation({
            leadId: lead.id, serviceType: inferredType, title: lead.name, originList: meta.originList,
            sourceCardUrl: meta.sourceCardUrl, dueAt: meta.dueAt, description: lead.notes || "",
          });
          service = result.service;
          servicesCreated++;
          if (result.workState === "created") worksCreated++;
          else if (result.workState === "relinked") worksRelinked++;
          else if (result.workState === "already_linked") alreadySynchronized++;
          continue;
        }

        const result = await ensureOperationalRecord(service, lead);
        if (result.workState === "created") worksCreated++;
        else if (result.workState === "relinked") worksRelinked++;
        else if (result.workState === "already_linked") alreadySynchronized++;
        else ignored++;
      } catch (error) {
        errors.push({ leadId: lead.id, message: error instanceof Error ? error.message : "Erro desconhecido" });
      }
    }
    return {
      servicesCreated,
      servicesReclassified,
      worksCreated,
      worksRelinked,
      alreadySynchronized,
      ignored,
      errors,
      total: migrated.length,
    };
  }),
});
