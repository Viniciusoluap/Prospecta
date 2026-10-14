import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  avaliacoes, constructionProjects, financiamentoChecklistItems, financiamentos,
  leadActivities, leadServices, leads, operationalProjects, regularizacoes,
} from "../drizzle/schema.js";
import { FINANCIAMENTO_CHECKLIST_PADRAO } from "../shared/financiamento.js";
import { LEAD_SERVICE_MODULE, LEAD_SERVICE_TYPES, serviceTypeFromTrelloFields, type LeadServiceType } from "../shared/lead-services.js";
import { leadContact, leadFullAddress } from "../shared/lead-snapshot.js";
import { selectProcessReference } from "../shared/service-reconciliation.js";
import { tipoProjetoDoServico } from "../shared/obra-crm.js";
import { adminProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";
import { excluirDefinitivo } from "./exclusao-definitiva.js";

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
  // Projetos e Regularizações nascem automaticamente do serviço (materializePending);
  // o índice único impede que duas aberturas simultâneas do módulo criem dois registros
  // para o mesmo serviço. Duplicatas anteriores são desfeitas antes de criar o índice.
  for (const table of AUTO_RECORD_TABLES) {
    await database.execute(sql.raw(dedupeLeadServiceLinksSql(table)));
    await database.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS "${table}_lead_service_id_unique" ON "${table}" ("lead_service_id")`));
  }
  // Lote 3 — Financiamentos originados exclusivamente no CRM: o registro nasce
  // só com os dados do lead (ensureFinanciamentoRecord, mesmo padrão de obras);
  // imóvel/tipo/banco deixam de ser obrigatórios e passam a ser preenchidos na
  // edição operacional. Índice único por lead_service_id garante idempotência.
  await database.execute(sql.raw(`ALTER TABLE "financiamentos" ALTER COLUMN "imovel" DROP NOT NULL`));
  await database.execute(sql.raw(`ALTER TABLE "financiamentos" ALTER COLUMN "tipo" DROP NOT NULL`));
  await database.execute(sql.raw(`ALTER TABLE "financiamentos" ALTER COLUMN "banco" DROP NOT NULL`));
  await database.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS "financiamentos_lead_service_id_unique" ON "financiamentos" ("lead_service_id")`));
}

const AUTO_RECORD_TABLES = ["operational_projects", "regularizacoes"] as const;

/**
 * Mantém um único registro por lead_service_id: preserva o referenciado pelo
 * serviço (operational_record_id) ou, sem referência, o mais antigo. Os demais
 * só perdem o lead_service_id (continuam no módulo, com o lead_id intacto).
 */
function dedupeLeadServiceLinksSql(table: (typeof AUTO_RECORD_TABLES)[number]) {
  return `UPDATE "${table}" AS r SET "lead_service_id" = NULL
    FROM (
      SELECT t."lead_service_id" AS sid,
        COALESCE(MAX(CASE WHEN t."id" = s."operational_record_id" THEN t."id" END), MIN(t."id")) AS keep_id
      FROM "${table}" t LEFT JOIN "lead_services" s ON s."id" = t."lead_service_id"
      WHERE t."lead_service_id" IS NOT NULL
      GROUP BY t."lead_service_id" HAVING COUNT(*) > 1
    ) d
    WHERE r."lead_service_id" = d.sid AND r."id" <> d.keep_id`;
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: unknown } | null;
  return candidate?.code === "23505" || (candidate?.cause != null && isUniqueViolation(candidate.cause));
}

const isWorksService = (serviceType: string) => serviceType === "obra_cliente" || serviceType === "vistoria_medicao";

/** Financiamento habitacional e consórcio caem no mesmo módulo "financiamentos" (ver LEAD_SERVICE_MODULE). */
const isFinanciamentoService = (serviceType: string) =>
  serviceType === "financiamento_habitacional" || serviceType === "consorcio";

const operationalTables = {
  regularizacoes: "regularizacoes",
  financiamentos: "financiamentos",
  projetos: "operational_projects",
  avaliacoes: "avaliacoes",
} as const;

/** Tabelas que aceitam vínculo por lead_service_id, inclusive Obras. */
const linkableTables = { ...operationalTables, obras: "construction_projects" } as const;
export type LinkableModule = keyof typeof linkableTables;

/** Serviço CRM criado quando um registro nasce no módulo sem demanda prévia no lead. */
const DEFAULT_SERVICE_FOR_MODULE: Record<LinkableModule, LeadServiceType> = {
  regularizacoes: "regularizacao",
  financiamentos: "financiamento_habitacional",
  projetos: "projeto_tecnico",
  avaliacoes: "avaliacao",
  obras: "obra_cliente",
};

/** Módulos cujo registro operacional nasce automaticamente ao vincular o lead (EPIC-017). */
const AUTO_RECORD_MODULES = ["projetos", "regularizacoes"] as const;
type AutoRecordModule = (typeof AUTO_RECORD_MODULES)[number];
const isAutoRecordModule = (module: string | null): module is AutoRecordModule =>
  (AUTO_RECORD_MODULES as readonly string[]).includes(module ?? "");

/**
 * Ao salvar dados completos no módulo, conecta o registro à demanda CRM
 * inequívoca do lead: a que já aponta para este registro ou a única demanda
 * ainda sem registro. Demandas já atendidas por outro registro não contam —
 * um lead pode ter mais de uma avaliação/financiamento/obra.
 */
export async function attachCompletedProcess(module: LinkableModule, leadId: number | null, recordId: number) {
  if (leadId == null) return "no_lead" as const;
  const database = getDb();
  const services = await database.select().from(leadServices).where(and(
    eq(leadServices.leadId, leadId), eq(leadServices.operationalModule, module),
    ne(leadServices.status, "cancelled"),
  ));
  const free = services.filter(candidate => !candidate.operationalRecordId);
  const service = services.find(candidate => candidate.operationalRecordId === recordId) ??
    (free.length === 1 ? free[0] : undefined);
  if (!service) {
    if (free.length > 1) return "ambiguous" as const;
    return services.length ? "already_linked" as const : "no_service" as const;
  }
  const table = linkableTables[module];
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

/**
 * Registro criado no próprio módulo a partir de um lead (ex.: Nova avaliação,
 * Novo financiamento, Nova obra): conecta à demanda CRM pendente ou, quando o
 * lead não tem demanda pendente (nenhuma, ou todas já atendidas por outros
 * registros), cria o serviço já vinculado — assim o card "Serviços do cliente"
 * do lead sempre reflete o processo real, inclusive a segunda avaliação.
 */
export async function linkRecordToLead(module: LinkableModule, leadId: number | null, recordId: number) {
  const attached = await attachCompletedProcess(module, leadId, recordId);
  if (attached !== "no_service" && attached !== "already_linked" || leadId == null) return attached;
  const database = getDb();
  const [service] = await database.insert(leadServices).values({
    leadId,
    serviceType: DEFAULT_SERVICE_FOR_MODULE[module],
    status: "active",
    operationalModule: module,
    operationalRecordId: recordId,
  }).returning();
  const table = linkableTables[module];
  await database.execute(sql`
    UPDATE ${sql.raw(`"${table}"`)} SET lead_service_id = ${service.id}
    WHERE id = ${recordId} AND lead_id = ${leadId} AND lead_service_id IS NULL
  `);
  return "service_created" as const;
}

/**
 * Projetos e Regularizações: o vínculo com o lead cria o registro real com os
 * dados cadastrais migrados do CRM. Dados técnicos (engenheiro, tipo, valores)
 * não são presumidos — ficam vazios até o profissional completar no módulo.
 */
async function ensureLinkedRecord(service: typeof leadServices.$inferSelect, lead: typeof leads.$inferSelect) {
  const reconciled = await reconcileExistingProcess(service);
  if (reconciled.state !== "awaiting_configuration" || !isAutoRecordModule(service.operationalModule) ||
    service.status === "cancelled" || service.status === "completed")
    return reconciled;
  // Garante o índice único por lead_service_id antes de inserir.
  await ensureLeadServicesSchema();
  const database = getDb();
  const contact = leadContact(lead);
  // Duas chamadas simultâneas (ex.: dois administradores abrindo o módulo)
  // podem passar juntas pela reconciliação. O índice único em lead_service_id
  // faz o segundo insert não gravar nada; nesse caso reutilizamos o registro
  // criado pela outra chamada em vez de duplicar o processo.
  let inserted: { id: number } | undefined;
  let existing: { id: number } | undefined;
  if (service.operationalModule === "projetos") {
    [inserted] = await database.insert(operationalProjects).values({
      name: service.title || `Projeto técnico — ${contact.name}`,
      types: "[]",
      status: "orcamento",
      clientName: contact.name,
      clientPhone: contact.phone,
      engineer: "",
      value: "0",
      paidValue: "0",
      leadId: lead.id,
      leadServiceId: service.id,
      description: service.description || "",
    }).onConflictDoNothing().returning({ id: operationalProjects.id });
    if (!inserted) [existing] = await database.select({ id: operationalProjects.id }).from(operationalProjects)
      .where(eq(operationalProjects.leadServiceId, service.id)).limit(1);
  } else {
    [inserted] = await database.insert(regularizacoes).values({
      clientName: contact.name,
      clientPhone: contact.phone || null,
      type: "",
      status: "em_analise",
      address: leadFullAddress(lead),
      responsible: "",
      leadId: lead.id,
      leadServiceId: service.id,
      description: service.description || "",
    }).onConflictDoNothing().returning({ id: regularizacoes.id });
    if (!inserted) [existing] = await database.select({ id: regularizacoes.id }).from(regularizacoes)
      .where(eq(regularizacoes.leadServiceId, service.id)).limit(1);
  }
  const record = inserted ?? existing;
  if (!record) return { service, state: "conflict" as const };
  const recordId = record.id;
  const [updated] = await database.update(leadServices).set({
    operationalRecordId: recordId, status: "active", updatedAt: new Date(),
  }).where(eq(leadServices.id, service.id)).returning();
  return { service: updated, state: inserted ? "created" as const : "already_linked" as const };
}

/**
 * Módulos cujas demandas antigas (sem registro) são convertidas ao abrir a fila.
 * Pedido A7 (13/10/2026): financiamentos vinculados antes da criação automática
 * (Lote 3, 11/10) ficavam presos em "Aguardando início", sem caminho para operar.
 */
export const MATERIALIZE_MODULES = [...AUTO_RECORD_MODULES, "financiamentos"] as const;
export type MaterializeModule = (typeof MATERIALIZE_MODULES)[number];

/** Converte demandas antigas ainda sem registro (criadas antes do EPIC-017). */
export async function materializePendingServices(module: MaterializeModule) {
  const database = getDb();
  const pending = await database.select({ service: leadServices, lead: leads })
    .from(leadServices).innerJoin(leads, eq(leads.id, leadServices.leadId))
    .where(and(eq(leadServices.operationalModule, module), ne(leadServices.status, "cancelled"),
      sql`${leadServices.operationalRecordId} IS NULL`));
  const results: Array<{ serviceId: number; state: string }> = [];
  for (const { service, lead } of pending) {
    if (module === "financiamentos") {
      // Mesmo caminho do vínculo novo: reaproveita financiamento órfão inequívoco
      // do lead; senão cria o registro mínimo com os dados do lead e o checklist.
      const result = await ensureFinanciamentoRecord(service, lead);
      results.push({ serviceId: service.id, state: result.workState });
      continue;
    }
    const result = await ensureLinkedRecord(service, lead);
    results.push({ serviceId: service.id, state: result.state });
  }
  return results;
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
    address: leadFullAddress(lead) || null,
    city: lead.city || null,
    state: lead.state || null,
    projectType: tipoProjetoDoServico(service.serviceType),
    status: "planning",
    progress: 0,
    notes: service.description || lead.notes || null,
  }).returning();
  const [updated] = await database.update(leadServices).set({
    operationalModule: "obras", operationalRecordId: work.id, status: "active", updatedAt: new Date(),
  }).where(eq(leadServices.id, service.id)).returning();
  return { service: updated, workState: "created" as const };
}

/**
 * Cria o financiamento mínimo (Lote 3 — Financiamentos originados
 * exclusivamente no CRM). Só nome, telefone e e-mail do lead são copiados;
 * imóvel, tipo, banco e os demais dados de crédito nunca são inventados —
 * ficam para a edição operacional, depois que o registro já existe.
 */
async function ensureFinanciamentoRecord(service: typeof leadServices.$inferSelect, lead: typeof leads.$inferSelect) {
  const database = getDb();
  if (!isFinanciamentoService(service.serviceType)) return { service, workState: "not_applicable" as const };

  const [existingFinanciamento] = await database.select({ id: financiamentos.id })
    .from(financiamentos)
    .where(eq(financiamentos.leadServiceId, service.id))
    .limit(1);
  if (existingFinanciamento) {
    const [updated] = await database.update(leadServices).set({
      operationalModule: "financiamentos", operationalRecordId: existingFinanciamento.id, status: "active", updatedAt: new Date(),
    }).where(eq(leadServices.id, service.id)).returning();
    return { service: updated, workState: "already_linked" as const };
  }

  // Versões anteriores podiam gravar operational_record_id sem ligar pela FK.
  // Só confiamos no ID se o financiamento realmente existir e estiver livre.
  if (service.operationalRecordId) {
    const [legacyFinanciamento] = await database.select({
      id: financiamentos.id,
      leadId: financiamentos.leadId,
      leadServiceId: financiamentos.leadServiceId,
    }).from(financiamentos)
      .where(eq(financiamentos.id, service.operationalRecordId))
      .limit(1);
    if (legacyFinanciamento && (legacyFinanciamento.leadId === null || legacyFinanciamento.leadId === lead.id) &&
      (!legacyFinanciamento.leadServiceId || legacyFinanciamento.leadServiceId === service.id)) {
      await database.update(financiamentos).set({
        leadId: lead.id,
        leadServiceId: service.id,
        updatedAt: new Date(),
      }).where(eq(financiamentos.id, legacyFinanciamento.id));
      const [updated] = await database.update(leadServices).set({
        operationalModule: "financiamentos", operationalRecordId: legacyFinanciamento.id, status: "active", updatedAt: new Date(),
      }).where(eq(leadServices.id, service.id)).returning();
      return { service: updated, workState: "relinked" as const };
    }
  }

  // Financiamentos legados (anteriores ao vínculo lead<->serviço) com lead_id
  // inequívoco são reaproveitados; nunca casados por nome, CPF ou telefone.
  const [orphanedFinanciamentos, siblingServices] = await Promise.all([
    database.select({ id: financiamentos.id }).from(financiamentos)
      .where(and(eq(financiamentos.leadId, lead.id), sql`${financiamentos.leadServiceId} IS NULL`)),
    database.select({ id: leadServices.id }).from(leadServices)
      .where(and(eq(leadServices.leadId, lead.id), eq(leadServices.operationalModule, "financiamentos"), ne(leadServices.status, "cancelled"))),
  ]);
  if (orphanedFinanciamentos.length === 1 && siblingServices.length === 1) {
    const [record] = await database.update(financiamentos)
      .set({ leadServiceId: service.id, updatedAt: new Date() })
      .where(and(eq(financiamentos.id, orphanedFinanciamentos[0].id), sql`${financiamentos.leadServiceId} IS NULL`))
      .returning({ id: financiamentos.id });
    if (record) {
      const [updated] = await database.update(leadServices).set({
        operationalRecordId: record.id, operationalModule: "financiamentos", status: "active", updatedAt: new Date(),
      }).where(eq(leadServices.id, service.id)).returning();
      return { service: updated, workState: "relinked" as const };
    }
  }
  if (orphanedFinanciamentos.length > 1 || orphanedFinanciamentos.length && siblingServices.length > 1)
    return { service, workState: "ambiguous" as const };

  const [created] = await database.insert(financiamentos).values({
    leadId: lead.id,
    leadServiceId: service.id,
    clienteNome: lead.name,
    clienteTel: lead.phone,
    clienteEmail: lead.email || null,
  }).returning();
  await database.insert(financiamentoChecklistItems).values(
    FINANCIAMENTO_CHECKLIST_PADRAO.map(item => ({ financiamentoId: created.id, ...item }))
  );
  const [updated] = await database.update(leadServices).set({
    operationalModule: "financiamentos", operationalRecordId: created.id, status: "active", updatedAt: new Date(),
  }).where(eq(leadServices.id, service.id)).returning();
  return { service: updated, workState: "created" as const };
}

/** Único ponto de decisão: cada módulo que precisa nascer sozinho do vínculo tem sua regra aqui. */
async function ensureOperationalArtifact(service: typeof leadServices.$inferSelect, lead: typeof leads.$inferSelect) {
  if (isWorksService(service.serviceType)) return ensureOperationalRecord(service, lead);
  if (isFinanciamentoService(service.serviceType)) return ensureFinanciamentoRecord(service, lead);
  const reconciled = await ensureLinkedRecord(service, lead);
  return { service: reconciled.service, workState: "not_applicable" as const };
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
    if (existing) return ensureOperationalArtifact(existing, lead);
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
    if (existing) return ensureOperationalArtifact(existing, lead);
  }
  if (!created) throw new Error("Não foi possível criar o vínculo; revise o registro de origem");
  return ensureOperationalArtifact(created, lead);
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
  /** Cria os registros reais das demandas antigas que ainda aguardam configuração. */
  materializePending: adminProcedure.input(z.object({
    module: z.enum(MATERIALIZE_MODULES),
  })).mutation(async ({ input }) => {
    await ensureLeadServicesSchema();
    const results = await materializePendingServices(input.module);
    return { created: results.filter(result => result.state === "created").length, results };
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
    return (await ensureOperationalArtifact(updated, lead)).service;
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
    `).catch(error => {
      // Índice único por lead_service_id (Obras, Projetos, Regularização).
      if (isUniqueViolation(error)) throw new Error("Este serviço já possui outro processo vinculado neste módulo");
      throw error;
    });
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
    const module = service.operationalModule as LinkableModule | null;
    // Limpa lead_service_id do registro operacional dos dois lados — obras,
    // projetos e regularizações têm índice único em lead_service_id, então
    // deixar o valor antigo preso impediria vincular um registro substituto.
    if (module && module in linkableTables && service.operationalRecordId) {
      const table = linkableTables[module];
      await database.execute(sql`
        UPDATE ${sql.raw(`"${table}"`)} SET lead_service_id = NULL
        WHERE id = ${service.operationalRecordId} AND lead_service_id = ${service.id}
      `);
    }
    const [updated] = await database.update(leadServices).set({
      operationalRecordId: null, status: "active", updatedAt: new Date(),
    }).where(eq(leadServices.id, input.id)).returning();
    return updated;
  }),

  // Item 03: excluir o serviço exclui também o registro operacional que só existe
  // por causa dele (obra, financiamento, projeto, regularização ou avaliação),
  // com as mesmas proteções da exclusão definitiva. O lead permanece.
  remove: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const database = getDb();
    const vinculados = await Promise.all([
      database.select({ id: constructionProjects.id }).from(constructionProjects).where(eq(constructionProjects.leadServiceId, input.id)).then(r => r.map(x => ["obra", x.id] as const)),
      database.select({ id: financiamentos.id }).from(financiamentos).where(eq(financiamentos.leadServiceId, input.id)).then(r => r.map(x => ["financiamento", x.id] as const)),
      database.select({ id: operationalProjects.id }).from(operationalProjects).where(eq(operationalProjects.leadServiceId, input.id)).then(r => r.map(x => ["projeto", x.id] as const)),
      database.select({ id: regularizacoes.id }).from(regularizacoes).where(eq(regularizacoes.leadServiceId, input.id)).then(r => r.map(x => ["regularizacao", x.id] as const)),
      database.select({ id: avaliacoes.id }).from(avaliacoes).where(eq(avaliacoes.leadServiceId, input.id)).then(r => r.map(x => ["avaliacao", x.id] as const)),
    ]).then(listas => listas.flat());
    if (vinculados.length > 1) throw new TRPCError({ code: "BAD_REQUEST", message: "Este serviço tem mais de um registro operacional vinculado; exclua-os pelos módulos." });
    if (vinculados.length === 1) {
      const [modulo, recordId] = vinculados[0];
      await excluirDefinitivo(modulo, recordId, ctx.user);
      return { success: true };
    }
    const [removed] = await database.delete(leadServices).where(eq(leadServices.id, input.id)).returning();
    if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: "Serviço não encontrado" });
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

        const result = await ensureOperationalArtifact(service, lead);
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
