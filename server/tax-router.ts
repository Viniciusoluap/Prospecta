import { isNull, and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  bpoLancamentos,
  financialTransactions,
  retProjects,
  taxObligations,
  taxProfiles,
} from "../drizzle/schema.js";
import { TRPCError } from "@trpc/server";
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

/**
 * Receita realizada da Contabilidade: transações financeiras pagas (venda/comissão) +
 * lançamentos pagos do BPO que não são despesa (LOTE C, 25/10: inclui as entradas do
 * extrato bancário; transferência interna não gera lançamento, logo não entra).
 */
export function receitaRealizada(
  transacoes: { type: string; amount: string | number }[],
  lancamentosBpo: { tipo: string; valor: string | number }[] = [],
) {
  const centavos = (v: string | number) => Math.round(Number(v) * 100);
  const financeiro = transacoes
    .filter(item => item.type === "income" || item.type === "commission")
    .reduce((total, item) => total + centavos(item.amount), 0);
  const bpo = lancamentosBpo.filter(l => l.tipo !== "despesa").reduce((total, l) => total + centavos(l.valor), 0);
  return { total: (financeiro + bpo) / 100, financeiro: financeiro / 100, bpo: bpo / 100 };
}

/**
 * Linhas da "Receita realizada" (mesma fonte do cartão da aba). EPIC-029 S-2: o relatório "Notas × receita do mês" usa
 * EXATAMENTE estas linhas, para fechar com o cartão sem número divergente.
 */
export async function linhasDaReceitaRealizada(database: ReturnType<typeof getDb>, from: Date, to: Date) {
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
  const lancamentosBpo = await database
    .select({ id: bpoLancamentos.id, tipo: bpoLancamentos.tipo, valor: bpoLancamentos.valor, descricao: bpoLancamentos.descricao, pagoEm: bpoLancamentos.pagoEm })
    .from(bpoLancamentos)
    .where(and(isNull(bpoLancamentos.exclusaoLoteBackupId), eq(bpoLancamentos.aClassificar, false), eq(bpoLancamentos.pago, true), gte(bpoLancamentos.pagoEm, from), lte(bpoLancamentos.pagoEm, to)));
  return { movements, lancamentosBpo };
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/** Histórico imutável dos perfis tributários (tabela da migração 0154, gatilho sem UPDATE/DELETE/TRUNCATE). */
async function registrarHistoricoPerfil(
  tx: Tx,
  profileId: number,
  acao: "criado" | "desativado" | "desativado_por_nova_versao",
  antes: unknown,
  depois: unknown,
  usuarioId: number,
) {
  await tx.execute(sql`
    INSERT INTO tax_profiles_historico (profile_id, acao, antes, depois, usuario_id)
    VALUES (${profileId}, ${acao}, ${antes == null ? null : JSON.stringify(antes)}::jsonb, ${JSON.stringify(depois)}::jsonb, ${usuarioId})`);
}

export const taxRouter = router({
  overview: adminProcedure
    .input(
      z
        .object({
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          cnpj: z.string().trim().max(20).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      await ensureTaxSchema();
      const database = getDb();
      const from = input?.from ?? new Date(new Date().getFullYear(), 0, 1);
      const to = input?.to ?? new Date();
      const { movements, lancamentosBpo } = await linhasDaReceitaRealizada(database, from, to);
      // EPIC-029 S-2: filtro "Empresa" (multi-CNPJ) — perfil vigente daquele CNPJ; sem filtro, o ativo mais recente.
      const cnpjFiltro = input?.cnpj ? input.cnpj.toUpperCase().replace(/[^0-9A-Z]/g, "") : "";
      const [profile] = cnpjFiltro
        ? await database
            .select()
            .from(taxProfiles)
            .where(sql`upper(regexp_replace(coalesce(${taxProfiles.cnpj}, ''), '[^0-9A-Za-z]', '', 'g')) = ${cnpjFiltro}`)
            .orderBy(desc(taxProfiles.isActive), desc(taxProfiles.effectiveFrom))
            .limit(1)
        : await database
            .select()
            .from(taxProfiles)
            .where(eq(taxProfiles.isActive, true))
            .orderBy(desc(taxProfiles.effectiveFrom))
            .limit(1);
      // QA S-2 (M3): com o filtro "Empresa", obrigações (e vencidas) só dos perfis daquele CNPJ (todas as versões).
      const idsDaEmpresa = cnpjFiltro
        ? (await database
            .select({ id: taxProfiles.id })
            .from(taxProfiles)
            .where(sql`upper(regexp_replace(coalesce(${taxProfiles.cnpj}, ''), '[^0-9A-Za-z]', '', 'g')) = ${cnpjFiltro}`)).map(p => p.id)
        : null;
      const todasObrigacoes = await database
        .select()
        .from(taxObligations)
        .orderBy(taxObligations.dueDate);
      const obligations = idsDaEmpresa
        ? todasObrigacoes.filter(o => o.profileId != null && idsDaEmpresa.includes(o.profileId))
        : todasObrigacoes;
      const rets = await database
        .select()
        .from(retProjects)
        .orderBy(desc(retProjects.createdAt));
      const receita = receitaRealizada(movements, lancamentosBpo);
      const revenue = receita.total;
      const rate = Number(profile?.estimatedRate || 0);
      // QA S-2 (M3): a receita do BPO não indica a empresa — com o filtro ligado, aplicar a alíquota de UMA empresa sobre a
      // receita de TODAS daria um número errado. Então a estimativa por empresa fica indisponível (null), com o motivo.
      const estimatedTax = cnpjFiltro ? null : revenue * (rate / 100);
      const estimativaIndisponivel = cnpjFiltro
        ? "Estimativa indisponível por empresa (a receita do BPO não indica a empresa)."
        : null;
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
        revenueFinanceiro: receita.financeiro,
        revenueBpo: receita.bpo,
        rate,
        estimatedTax,
        estimativaIndisponivel,
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
      .mutation(async ({ input, ctx }) => {
        await ensureTaxSchema();
        const database = getDb();
        // EPIC-029 S-2 (multi-CNPJ): a versão nova desativa só os perfis da MESMA empresa (mesmo CNPJ; sem CNPJ, os sem
        // CNPJ). Antes desativava todos — com dois CNPJs (ex.: Prospecta e Efficaz) cada um precisa do seu perfil vigente.
        // QA S-2 (M4): com CNPJ, desativa também os perfis ativos SEM CNPJ (a versão antiga, antes de ter CNPJ). Cada
        // desativação e a criação ficam no histórico imutável `tax_profiles_historico` (migração 0154). Nada é apagado.
        const cnpjNovo = (input.cnpj ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
        return database.transaction(async tx => {
          const desativados = await tx
            .update(taxProfiles)
            .set({ isActive: false, updatedAt: new Date() })
            .where(
              and(
                eq(taxProfiles.isActive, true),
                cnpjNovo
                  ? sql`(upper(regexp_replace(coalesce(${taxProfiles.cnpj}, ''), '[^0-9A-Za-z]', '', 'g')) = ${cnpjNovo} OR coalesce(${taxProfiles.cnpj}, '') = '')`
                  : sql`coalesce(${taxProfiles.cnpj}, '') = ''`
              )
            )
            .returning();
          const [created] = await tx
            .insert(taxProfiles)
            .values({
              ...input,
              cnpj: input.cnpj || null,
              estimatedRate: input.estimatedRate.toString(),
              notes: input.notes || null,
              isActive: true,
            })
            .returning();
          for (const d of desativados) {
            await registrarHistoricoPerfil(tx, d.id, "desativado_por_nova_versao", { ...d, isActive: true }, d, ctx.user.id);
          }
          await registrarHistoricoPerfil(tx, created!.id, "criado", null, created, ctx.user.id);
          return created;
        });
      }),
    /** QA S-2 (M4): desativar um perfil (só admin por papel). Não apaga nada; grava no histórico. */
    desativar: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Só o administrador desativa um perfil tributário." });
        }
        await ensureTaxSchema();
        return getDb().transaction(async tx => {
          const [antes] = await tx.select().from(taxProfiles).where(eq(taxProfiles.id, input.id)).limit(1);
          if (!antes) throw new TRPCError({ code: "NOT_FOUND", message: "Perfil tributário não encontrado." });
          if (!antes.isActive) return antes;
          const [depois] = await tx
            .update(taxProfiles)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(taxProfiles.id, input.id))
            .returning();
          await registrarHistoricoPerfil(tx, input.id, "desativado", antes, depois, ctx.user.id);
          return depois;
        });
      }),
    historico: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        const r = await getDb().execute(sql`
          SELECT h.id, h.acao, h.usuario_id, u.name AS usuario_nome, h.criado_em
          FROM tax_profiles_historico h LEFT JOIN users u ON u.id = h.usuario_id
          WHERE h.profile_id = ${input.id} ORDER BY h.id`);
        return ((r as { rows?: Record<string, unknown>[] }).rows ?? []).map(x => ({
          id: Number(x.id), acao: String(x.acao), usuarioId: x.usuario_id == null ? null : Number(x.usuario_id),
          usuarioNome: x.usuario_nome == null ? null : String(x.usuario_nome), quando: x.criado_em,
        }));
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
