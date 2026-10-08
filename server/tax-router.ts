import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  financialTransactions,
  retProjects,
  taxObligations,
  taxProfiles,
} from "../drizzle/schema.js";
import { adminProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";

let schemaInitialization: Promise<void> | undefined;

async function initializeTaxSchema() {
  const database = getDb();
  await database.execute(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS "tax_profiles" (
      "id" serial PRIMARY KEY NOT NULL,
      "company_name" varchar(255) NOT NULL,
      "cnpj" varchar(20),
      "regime" varchar(40) NOT NULL,
      "estimated_rate" numeric(7,4) DEFAULT '0' NOT NULL,
      "effective_from" timestamp NOT NULL,
      "effective_to" timestamp,
      "notes" text,
      "is_active" boolean DEFAULT true NOT NULL,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )
  `)
  );
  await database.execute(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS "tax_obligations" (
      "id" serial PRIMARY KEY NOT NULL,
      "profile_id" integer REFERENCES "tax_profiles"("id") ON DELETE set null,
      "name" varchar(255) NOT NULL,
      "competency" varchar(7) NOT NULL,
      "due_date" timestamp NOT NULL,
      "estimated_amount" numeric(15,2) DEFAULT '0' NOT NULL,
      "status" varchar(30) DEFAULT 'pending' NOT NULL,
      "paid_at" timestamp,
      "notes" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )
  `)
  );
  await database.execute(
    sql.raw(`
    CREATE TABLE IF NOT EXISTS "ret_projects" (
      "id" serial PRIMARY KEY NOT NULL,
      "profile_id" integer REFERENCES "tax_profiles"("id") ON DELETE set null,
      "name" varchar(255) NOT NULL,
      "cnpj" varchar(20),
      "registration_number" varchar(120),
      "affected_assets" boolean DEFAULT false NOT NULL,
      "status" varchar(30) DEFAULT 'analysis' NOT NULL,
      "ret_rate" numeric(7,4) DEFAULT '4' NOT NULL,
      "effective_from" timestamp,
      "effective_to" timestamp,
      "notes" text,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )
  `)
  );
}

export async function ensureTaxSchema() {
  if (!schemaInitialization) {
    schemaInitialization = initializeTaxSchema().catch(error => {
      schemaInitialization = undefined;
      throw error;
    });
  }
  return schemaInitialization;
}

const regime = z.enum([
  "simples_nacional",
  "lucro_presumido",
  "lucro_real",
  "ret",
  "outro",
]);

export const taxRouter = router({
  overview: adminProcedure
    .input(
      z
        .object({
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      await ensureTaxSchema();
      const database = getDb();
      const from = input?.from ?? new Date(new Date().getFullYear(), 0, 1);
      const to = input?.to ?? new Date();
      const movements = await database
        .select()
        .from(financialTransactions)
        .where(
          and(
            eq(financialTransactions.status, "paid"),
            gte(financialTransactions.paidAt, from),
            lte(financialTransactions.paidAt, to)
          )
        );
      const [profile] = await database
        .select()
        .from(taxProfiles)
        .where(eq(taxProfiles.isActive, true))
        .orderBy(desc(taxProfiles.effectiveFrom))
        .limit(1);
      const obligations = await database
        .select()
        .from(taxObligations)
        .orderBy(taxObligations.dueDate);
      const rets = await database
        .select()
        .from(retProjects)
        .orderBy(desc(retProjects.createdAt));
      const revenue = movements
        .filter(item => item.type === "income" || item.type === "commission")
        .reduce((total, item) => total + Number(item.amount), 0);
      const rate = Number(profile?.estimatedRate || 0);
      const estimatedTax = revenue * (rate / 100);
      const overdue = obligations.filter(
        item => item.status === "pending" && new Date(item.dueDate) < new Date()
      );
      const suggestions: string[] = [];
      if (!profile)
        suggestions.push(
          "Cadastre o regime e a alíquota estimada antes de projetar tributos."
        );
      if (profile && rate <= 0)
        suggestions.push(
          "Defina uma alíquota estimada validada pela contabilidade."
        );
      if (rets.some(item => item.status === "analysis")) {
        suggestions.push(
          "Existem empreendimentos em análise para RET; valide afetação, elegibilidade e adesão."
        );
      }
      if (overdue.length)
        suggestions.push(
          `${overdue.length} obrigação(ões) tributária(s) está(ão) vencida(s).`
        );
      if (!rets.length)
        suggestions.push(
          "Avalie com o contador se algum empreendimento pode usar RET."
        );
      return {
        from,
        to,
        profile: profile ?? null,
        revenue,
        rate,
        estimatedTax,
        obligations,
        rets,
        overdue: overdue.length,
        suggestions,
      };
    }),

  profiles: router({
    list: adminProcedure.query(async () => {
      await ensureTaxSchema();
      return getDb()
        .select()
        .from(taxProfiles)
        .orderBy(desc(taxProfiles.effectiveFrom));
    }),
    create: adminProcedure
      .input(
        z.object({
          companyName: z.string().trim().min(2).max(255),
          cnpj: z.string().trim().max(20).optional(),
          regime,
          estimatedRate: z.number().min(0).max(100),
          effectiveFrom: z.coerce.date(),
          notes: z.string().max(5000).optional(),
        })
      )
      .mutation(async ({ input }) => {
        await ensureTaxSchema();
        const database = getDb();
        await database
          .update(taxProfiles)
          .set({ isActive: false, updatedAt: new Date() });
        const [created] = await database
          .insert(taxProfiles)
          .values({
            ...input,
            cnpj: input.cnpj || null,
            estimatedRate: input.estimatedRate.toString(),
            notes: input.notes || null,
            isActive: true,
          })
          .returning();
        return created;
      }),
  }),

  obligations: router({
    create: adminProcedure
      .input(
        z.object({
          profileId: z.number().int().positive().optional(),
          name: z.string().trim().min(2).max(255),
          competency: z.string().regex(/^\d{4}-\d{2}$/),
          dueDate: z.coerce.date(),
          estimatedAmount: z.number().min(0),
          notes: z.string().max(5000).optional(),
        })
      )
      .mutation(async ({ input }) => {
        await ensureTaxSchema();
        const [created] = await getDb()
          .insert(taxObligations)
          .values({
            ...input,
            estimatedAmount: input.estimatedAmount.toString(),
            notes: input.notes || null,
          })
          .returning();
        return created;
      }),
    markPaid: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await ensureTaxSchema();
        const [updated] = await getDb()
          .update(taxObligations)
          .set({
            status: "paid",
            paidAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(taxObligations.id, input.id))
          .returning();
        return updated;
      }),
  }),

  ret: router({
    create: adminProcedure
      .input(
        z.object({
          profileId: z.number().int().positive().optional(),
          name: z.string().trim().min(2).max(255),
          cnpj: z.string().trim().max(20).optional(),
          registrationNumber: z.string().trim().max(120).optional(),
          affectedAssets: z.boolean().default(false),
          status: z.enum(["analysis", "eligible", "active", "inactive"]),
          retRate: z.number().min(0).max(100),
          effectiveFrom: z.coerce.date().optional(),
          notes: z.string().max(5000).optional(),
        })
      )
      .mutation(async ({ input }) => {
        await ensureTaxSchema();
        const [created] = await getDb()
          .insert(retProjects)
          .values({
            ...input,
            cnpj: input.cnpj || null,
            registrationNumber: input.registrationNumber || null,
            retRate: input.retRate.toString(),
            notes: input.notes || null,
          })
          .returning();
        return created;
      }),
  }),
});
