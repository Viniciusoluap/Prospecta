import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { constructionProjects, leadActivities, leadServices, leads } from "../drizzle/schema.js";
import { LEAD_SERVICE_MODULE, LEAD_SERVICE_TYPES, serviceTypeFromTrelloFields } from "../shared/lead-services.js";
import { selectProcessReference } from "../shared/service-reconciliation.js";
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
  await database.execute(sql.raw(`ALTER TABLE "lead_services" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(120)`));
  await database.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS "lead_services_idempotency_key_unique" ON "lead_services" ("idempotency_key")`));
  await database.execute(sql.raw(`ALTER TABLE "regularizacoes" ADD COLUMN IF NOT EXISTS "lead_service_id" integer REFERENCES "lead_services"("id") ON DELETE set null`));
  await database.execute(sql.raw(`ALTER TABLE "financiamentos" ADD COLUMN IF NOT EXISTS "lead_service_id" integer REFERENCES "lead_services"("id") ON DELETE set null`));
  await database.execute(sql.raw(`ALTER TABLE "operational_projects" ADD COLUMN IF NOT EXISTS "lead_service_id" integer REFERENCES "lead_services"("id") ON DELETE set null`));
  await database.execute(sql.raw(`ALTER TABLE "construction_projects" ADD COLUMN IF NOT EXISTS "lead_id" integer REFERENCES "leads"("id") ON DELETE set null`));
  await database.execute(sql.raw(`ALTER TABLE "construction_projects" ADD COLUMN IF NOT EXISTS "lead_service_id" integer REFERENCES "lead_services"("id") ON DELETE set null`));
  await database.execute(sql.raw(`ALTER TABLE "construction_projects" ALTER COLUMN "user_id" DROP NOT NULL`));
  await database.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS "construction_projects_lead_service_id_unique" ON "construction_projects" ("lead_service_id")`));
}

const isWorksService = (serviceType: string) => serviceType === "obra_cliente" || serviceType === "vistoria_medicao";

const operationalTables = {
  regularizacoes: "regularizacoes",
  financiamentos: "financiamentos",
  projetos: "operational_projects",
} as const;

/** Ao salvar dados completos no módulo, conecta uma única demanda CRM inequívoca. */
export async function attachCompletedProcess(module: keyof typeof operationalTables, leadId: number | null, recordId: number) {
  if (leadId == null) return "no_lead" as const;
  const database = getDb();
  const services = await database.select().from(leadServices).where(and(
    eq(leadServices.leadId, leadId), eq(leadServices.operationalModule, module),
    ne(leadServices.status, "cancelled"),
  ));
  if (services.length !== 1) return services.length ? "ambiguous" as const : "no_service" as const;
  const service = services[0];
  if (service.operationalRecordId && service.operationalRecordId !== recordId) return "already_linked" as const;
  const table = operationalTables[module];
  const patched = await database.execute(sql`
    UPDATE ${sql.raw(`"${table}"`)} SET lead_service_id = ${service.id}
    WHERE id = ${recordId} AND lead_id = ${leadId}
      AND (lead_service_id IS NULL OR lead_service_id = ${service.id}) RETURNING id
  `);
  if (!patched.rows.length) return "conflict" as const;
  await database.update(leadServices).set({ operationalRecordId: recordId, updatedAt: new Date() })
    .where(eq(leadServices.id, service.id));
  return "linked" as const;
}

/** Reassocia somente por chaves persistidas. Nomes, telefone e CPF nunca são usados como chave. */
async function reconcileExistingProcess(service: typeof leadServices.$inferSelect) {
  const module = service.operationalModule as keyof typeof operationalTables;
  const table = operationalTables[module];
  if (!table) return { service, state: "awaiting_configuration" as const };
  const database = getDb();
  const rows = await database.execute(sql`
    SELECT id, lead_id, lead_service_id FROM ${sql.raw(`"${table}"`)}
    WHERE lead_service_id = ${service.id}
       OR (${service.operationalRecordId ? sql`id = ${service.operationalRecordId}` : sql`false`})
       OR (lead_id = ${service.leadId} AND lead_service_id IS NULL)
    ORDER BY id
  `);
  const candidates = rows.rows as Array<{ id: number; lead_id: number | null; lead_service_id: number | null }>;
  const siblingServices = await database.select({ id: leadServices.id }).from(leadServices)
    .where(and(eq(leadServices.leadId, service.leadId), eq(leadServices.operationalModule, module),
      ne(leadServices.status, "cancelled")));
  const selection = selectProcessReference(candidates, service.leadId, service.id,
    service.operationalRecordId, siblingServices.length);
  if (!selection.selected) return { service, state: selection.state };
  const selected = selection.selected;
  const patched = await database.execute(sql`
    UPDATE ${sql.raw(`"${table}"`)} SET lead_id = ${service.leadId}, lead_service_id = ${service.id}
    WHERE id = ${selected.id} AND (lead_id IS NULL OR lead_id = ${service.leadId})
      AND (lead_service_id IS NULL OR lead_service_id = ${service.id}) RETURNING id
  `);
  if (!patched.rows.length) return { service, state: "conflict" as const };
  const [updated] = await database.update(leadServices).set({
    operationalRecordId: selected.id, updatedAt: new Date(),
  }).where(eq(leadServices.id, service.id)).returning();
  return { service: updated, state: selection.state };
}

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
      leadId: constructionProjects.leadId,
      leadServiceId: constructionProjects.leadServiceId,
    }).from(constructionProjects)
      .where(eq(constructionProjects.id, service.operationalRecordId))
      .limit(1);
    if (legacyWork && (legacyWork.leadId === null || legacyWork.leadId === lead.id) &&
      (!legacyWork.leadServiceId || legacyWork.leadServiceId === service.id)) {
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

  // Obras prévias com lead_id inequívoco são reutilizadas; nunca casar por nome.
  const [orphanedWorks, siblingServices] = await Promise.all([
    database.select({ id: constructionProjects.id }).from(constructionProjects)
      .where(and(eq(constructionProjects.leadId, lead.id), sql`${constructionProjects.leadServiceId} IS NULL`)),
    database.select({ id: leadServices.id }).from(leadServices)
      .where(and(eq(leadServices.leadId, lead.id), eq(leadServices.operationalModule, "obras"), ne(leadServices.status, "cancelled"))),
  ]);
  if (orphanedWorks.length === 1 && siblingServices.length === 1) {
    const [work] = await database.update(constructionProjects)
      .set({ leadServiceId: service.id, updatedAt: new Date() })
      .where(and(eq(constructionProjects.id, orphanedWorks[0].id), sql`${constructionProjects.leadServiceId} IS NULL`))
      .returning({ id: constructionProjects.id });
    if (work) {
      const [updated] = await database.update(leadServices).set({
        operationalRecordId: work.id, operationalModule: "obras", status: "active", updatedAt: new Date(),
      }).where(eq(leadServices.id, service.id)).returning();
      return { service: updated, workState: "relinked" as const };
    }
  }
  if (orphanedWorks.length > 1 || orphanedWorks.length && siblingServices.length > 1)
    return { service, workState: "ambiguous" as const };

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
  // Repetir o clique Vincular não multiplica vínculos equivalentes.
  if (!input.sourceCardUrl) {
    const [existing] = await database.select().from(leadServices).where(and(
      eq(leadServices.leadId, input.leadId), eq(leadServices.serviceType, input.serviceType),
      ne(leadServices.status, "cancelled"),
    )).orderBy(desc(leadServices.createdAt)).limit(1);
    if (existing) {
      if (isWorksService(existing.serviceType)) return ensureOperationalRecord(existing, lead);
      const reconciled = await reconcileExistingProcess(existing);
      return { service: reconciled.service, workState: "not_applicable" as const };
    }
  }
  const idempotencyKey = input.sourceCardUrl ? null : `${input.leadId}:${input.serviceType}`;
  const [created] = await database.insert(leadServices).values({
    ...input,
    title: input.title || undefined,
    status: input.status || "awaiting_data",
    operationalModule: LEAD_SERVICE_MODULE[input.serviceType],
    idempotencyKey,
  }).onConflictDoNothing().returning();
  if (!created && idempotencyKey) {
    const [existing] = await database.select().from(leadServices).where(eq(leadServices.idempotencyKey, idempotencyKey)).limit(1);
    if (existing) {
      if (isWorksService(existing.serviceType)) return ensureOperationalRecord(existing, lead);
      const reconciled = await reconcileExistingProcess(existing);
      return { service: reconciled.service, workState: "not_applicable" as const };
    }
  }
  if (!created) throw new Error("Não foi possível criar o vínculo; revise o registro de origem");
  if (isWorksService(created.serviceType)) return ensureOperationalRecord(created, lead);
  const reconciled = await reconcileExistingProcess(created);
  return { service: reconciled.service, workState: "not_applicable" as const };
}

export const leadServicesRouter = router({
  listForModule: adminProcedure.input(z.object({
    module: z.enum(["obras", "tarefas", "regularizacoes", "comissoes", "projetos", "avaliacoes", "financiamentos"]),
  })).query(async ({ input }) => getDb().select({ service: leadServices, lead: leads })
    .from(leadServices).innerJoin(leads, eq(leads.id, leadServices.leadId))
    .where(and(eq(leadServices.operationalModule, input.module), ne(leadServices.status, "cancelled")))
    .orderBy(desc(leadServices.createdAt))),

  /** Revisão idempotente dos vínculos antigos; resultados ambíguos ficam intocados. */
  reconcile: adminProcedure.input(z.object({ dryRun: z.boolean().default(true) })).mutation(async ({ input, ctx }) => {
    const database = getDb();
    const services = await database.select().from(leadServices).orderBy(leadServices.id);
    const results: Array<{ serviceId: number; leadId: number; module: string | null; state: string }> = [];
    for (const service of services) {
      if (!service.operationalModule || !Object.hasOwn(operationalTables, service.operationalModule)) continue;
      if (input.dryRun) {
        results.push({ serviceId: service.id, leadId: service.leadId, module: service.operationalModule,
          state: service.operationalRecordId ? "review_existing_reference" : "review_unconfigured" });
        continue;
      }
      const result = await reconcileExistingProcess(service);
      results.push({ serviceId: service.id, leadId: service.leadId, module: service.operationalModule, state: result.state });
      if (["relinked", "conflict", "ambiguous"].includes(result.state)) {
        await database.insert(leadActivities).values({
          leadId: service.leadId, type: "note",
          description: `Reconciliação do serviço ${service.id}: ${result.state}`,
          performedBy: ctx.user.name || `admin:${ctx.user.id}`,
          metadata: JSON.stringify({ serviceId: service.id, module: service.operationalModule,
            operationalRecordId: result.service.operationalRecordId, state: result.state }),
        });
      }
    }
    return { dryRun: input.dryRun, results };
  }),
  listByLead: adminProcedure.input(z.object({ leadId: z.number().int().positive() })).query(async ({ input }) =>
    getDb().select().from(leadServices).where(eq(leadServices.leadId, input.leadId)).orderBy(desc(leadServices.createdAt))
  ),

  create: adminProcedure.input(serviceInput).mutation(async ({ input }) =>
    (await createLeadServiceWithAutomation(input)).service
  ),

  update: adminProcedure.input(serviceInput.partial().extend({ id: z.number().int().positive() })).mutation(async ({ input }) => {
    const { id, serviceType, ...data } = input;
    const [previous] = await getDb().select().from(leadServices).where(eq(leadServices.id, id)).limit(1);
    if (!previous) throw new Error("Serviço não encontrado");
    if (data.leadId && data.leadId !== previous.leadId) throw new Error("A identidade do lead não pode ser alterada neste vínculo");
    const [updated] = await getDb().update(leadServices).set({
      ...data,
      ...(serviceType ? { serviceType, operationalModule: LEAD_SERVICE_MODULE[serviceType] } : {}),
      ...(serviceType && previous.idempotencyKey ? { idempotencyKey: `${previous.leadId}:${serviceType}` } : {}),
      ...(data.status === "cancelled" ? { idempotencyKey: null } : {}),
      updatedAt: new Date(),
    }).where(eq(leadServices.id, id)).returning();
    if (!updated) throw new Error("Serviço não encontrado");
    const [lead] = await getDb().select().from(leads).where(eq(leads.id, updated.leadId)).limit(1);
    if (!lead) throw new Error("Lead do serviço não encontrado");
    if (isWorksService(updated.serviceType)) return (await ensureOperationalRecord(updated, lead)).service;
    return (await reconcileExistingProcess(updated)).service;
  }),

  linkProcess: adminProcedure.input(z.object({
    id: z.number().int().positive(),
    operationalModule: z.enum(["obras", "regularizacoes", "financiamentos", "projetos"]),
    operationalRecordId: z.number().int().positive(),
  })).mutation(async ({ input }) => {
    const database = getDb();
    const [service] = await database.select().from(leadServices).where(eq(leadServices.id, input.id)).limit(1);
    if (!service || LEAD_SERVICE_MODULE[service.serviceType as keyof typeof LEAD_SERVICE_MODULE] !== input.operationalModule)
      throw new Error("Serviço incompatível com o módulo informado");
    const table = input.operationalModule === "obras" ? "construction_projects" : operationalTables[input.operationalModule];
    const reference = await database.execute(sql`
      SELECT lead_id, lead_service_id FROM ${sql.raw(`"${table}"`)} WHERE id = ${input.operationalRecordId}
    `);
    const target = reference.rows[0] as { lead_id: number | null; lead_service_id: number | null } | undefined;
    if (!target || target.lead_id !== null && target.lead_id !== service.leadId ||
      target.lead_service_id !== null && target.lead_service_id !== service.id)
      throw new Error("O registro operacional não corresponde ao cliente ou já está vinculado");
    const patched = await database.execute(sql`
      UPDATE ${sql.raw(`"${table}"`)} SET lead_id = ${service.leadId}, lead_service_id = ${service.id}
      WHERE id = ${input.operationalRecordId}
        AND (lead_id IS NULL OR lead_id = ${service.leadId})
        AND (lead_service_id IS NULL OR lead_service_id = ${service.id})
      RETURNING id
    `);
    if (!patched.rows.length) throw new Error("O processo foi vinculado por outra operação; revise o vínculo");
    const [updated] = await database.update(leadServices).set({
      operationalRecordId: input.operationalRecordId, updatedAt: new Date(),
    }).where(eq(leadServices.id, service.id)).returning();
    return updated;
  }),

  setStatus: adminProcedure.input(z.object({
    id: z.number().int().positive(),
    status: z.enum(["active", "paused", "completed", "cancelled"]),
  })).mutation(async ({ input }) => {
    const [updated] = await getDb().update(leadServices).set({
      status: input.status, ...(input.status === "cancelled" ? { idempotencyKey: null } : {}), updatedAt: new Date(),
    })
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
