import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  brokerCommissions,
  brokerProfiles,
  imoveis,
  leads,
  operationalCommissions as commissions,
  operationalProjects as projects,
  portalVisits as visits,
  users,
} from "../drizzle/schema.js";
import {
  brokerInput,
  commissionInput,
  commissionPaidAt,
  projectInput,
  validCoordinates,
  visitInput,
} from "../shared/operacional.js";
import { adminProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";

const idInput = z.object({ id: z.number().int().positive() });
function found<T>(row: T | undefined): T {
  if (!row)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Registro não encontrado",
    });
  return row;
}
async function brokerExists(id: number | null) {
  if (id !== null)
    found(
      (
        await getDb()
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, id), eq(users.role, "corretor")))
          .limit(1)
      )[0]
    );
}
async function leadExists(id: number | null) {
  if (id !== null)
    return found(
      (
        await getDb()
          .select({ name: leads.name, phone: leads.phone })
          .from(leads)
          .where(eq(leads.id, id))
          .limit(1)
      )[0]
    );
  return null;
}
const brokerFields = {
  id: users.id,
  name: users.name,
  email: users.email,
  phone: users.phone,
  creci: users.creci,
  active: users.active,
  avatar: users.avatarUrl,
  specialties: brokerProfiles.specialties,
  notes: brokerProfiles.notes,
};
async function options() {
  const db = getDb();
  const [leadOptions, properties, brokers] = await Promise.all([
    db
      .select({ id: leads.id, name: leads.name })
      .from(leads)
      .orderBy(asc(leads.name)),
    db
      .select({ id: imoveis.id, name: imoveis.titulo })
      .from(imoveis)
      .orderBy(asc(imoveis.titulo)),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.role, "corretor"))
      .orderBy(asc(users.name)),
  ]);
  return { leads: leadOptions, properties, brokers };
}

async function visitValues(input: z.infer<typeof visitInput>) {
  const lead = await leadExists(input.leadId);
  await brokerExists(input.brokerId);
  if (input.propertyId !== null)
    found(
      (
        await getDb()
          .select({ id: imoveis.id })
          .from(imoveis)
          .where(eq(imoveis.id, input.propertyId))
          .limit(1)
      )[0]
    );
  return {
    ...input,
    clientName: lead?.name ?? input.clientName,
    clientPhone: lead?.phone ?? input.clientPhone,
    updatedAt: new Date(),
  };
}
export const agendaRouter = router({
  options: adminProcedure.query(options),
  list: adminProcedure.query(async () =>
    getDb()
      .select({
        visit: visits,
        leadName: leads.name,
        brokerName: users.name,
        propertyTitle: imoveis.titulo,
      })
      .from(visits)
      .leftJoin(leads, eq(visits.leadId, leads.id))
      .leftJoin(users, eq(visits.brokerId, users.id))
      .leftJoin(imoveis, eq(visits.propertyId, imoveis.id))
      .orderBy(asc(visits.scheduledAt))
  ),
  create: adminProcedure.input(visitInput).mutation(async ({ input }) =>
    found(
      (
        await getDb()
          .insert(visits)
          .values(await visitValues(input))
          .returning()
      )[0]
    )
  ),
  update: adminProcedure
    .input(z.object({ id: z.number().int().positive(), data: visitInput }))
    .mutation(async ({ input }) =>
      found(
        (
          await getDb()
            .update(visits)
            .set(await visitValues(input.data))
            .where(eq(visits.id, input.id))
            .returning()
        )[0]
      )
    ),
  delete: adminProcedure
    .input(idInput)
    .mutation(async ({ input }) =>
      found(
        (
          await getDb()
            .delete(visits)
            .where(eq(visits.id, input.id))
            .returning({ id: visits.id })
        )[0]
      )
    ),
});

export const corretoresRouter = router({
  list: adminProcedure.query(async () =>
    getDb()
      .select(brokerFields)
      .from(users)
      .leftJoin(brokerProfiles, eq(users.id, brokerProfiles.userId))
      .where(eq(users.role, "corretor"))
      .orderBy(asc(users.name))
  ),
  getById: adminProcedure.input(idInput).query(async ({ input }) =>
    found(
      (
        await getDb()
          .select(brokerFields)
          .from(users)
          .leftJoin(brokerProfiles, eq(users.id, brokerProfiles.userId))
          .where(and(eq(users.id, input.id), eq(users.role, "corretor")))
          .limit(1)
      )[0]
    )
  ),
  create: adminProcedure.input(brokerInput).mutation(async ({ input }) => {
    const db = getDb();
    const email = input.email.toLowerCase();
    if (
      (
        await db
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.email}) = ${email}`)
          .limit(1)
      ).length
    )
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "E-mail já cadastrado; gerencie o usuário existente nas Configurações",
      });
    // One statement: profile and user are created atomically; no credential or role escalation.
    const result = await db.execute(
      sql`WITH created AS (INSERT INTO users ("openId", name, email, phone, creci, active, "avatarUrl", role, permissions) VALUES (${`broker:${email}`}, ${input.name}, ${email}, ${input.phone}, ${input.creci}, ${input.active}, ${input.avatar || null}, 'corretor', '[]') RETURNING id) INSERT INTO broker_profiles (user_id, specialties, notes) SELECT id, ${JSON.stringify(input.specialties)}, ${input.notes} FROM created RETURNING user_id`
    );
    return { id: Number(result.rows[0].user_id) };
  }),
  update: adminProcedure
    .input(z.object({ id: z.number().int().positive(), data: brokerInput }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.id === input.id && !input.data.active)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Não desative seu próprio acesso",
        });
      const db = getDb();
      const data = input.data;
      const email = data.email.toLowerCase();
      await brokerExists(input.id);
      if (
        (
          await db
            .select({ id: users.id })
            .from(users)
            .where(
              and(sql`lower(${users.email}) = ${email}`, ne(users.id, input.id))
            )
            .limit(1)
        ).length
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "E-mail já cadastrado",
        });
      // Directory permissions must not modify login identifiers, roles, passwords or module grants.
      const current = found(
        (
          await db
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, input.id))
        )[0]
      );
      if (current.email !== email)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "O e-mail de acesso não pode ser alterado pelo cadastro de corretores",
        });
      await db.batch([
        db
          .update(users)
          .set({
            name: data.name,
            phone: data.phone,
            creci: data.creci,
            active: data.active,
            avatarUrl: data.avatar || null,
            updatedAt: new Date(),
          })
          .where(and(eq(users.id, input.id), eq(users.role, "corretor"))),
        db
          .insert(brokerProfiles)
          .values({
            userId: input.id,
            specialties: JSON.stringify(data.specialties),
            notes: data.notes,
          })
          .onConflictDoUpdate({
            target: brokerProfiles.userId,
            set: {
              specialties: JSON.stringify(data.specialties),
              notes: data.notes,
            },
          }),
      ]);
      return { id: input.id };
    }),
  delete: adminProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    if (ctx.user.role !== "admin")
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Somente administrador pode excluir corretores",
      });
    if (ctx.user.id === input.id)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Não exclua seu próprio acesso",
      });
    return found(
      (
        await getDb()
          .delete(users)
          .where(and(eq(users.id, input.id), eq(users.role, "corretor")))
          .returning({ id: users.id })
      )[0]
    );
  }),
});

export const comissoesRouter = router({
  options: adminProcedure.query(async () => (await options()).brokers),
  list: adminProcedure.query(async () =>
    getDb()
      .select({ commission: commissions, brokerName: users.name })
      .from(commissions)
      .leftJoin(users, eq(commissions.brokerId, users.id))
      .orderBy(asc(commissions.dueDate))
  ),
  legacy: adminProcedure.query(async () =>
    getDb()
      .select()
      .from(brokerCommissions)
      .orderBy(desc(brokerCommissions.createdAt))
  ),
  create: adminProcedure.input(commissionInput).mutation(async ({ input }) => {
    const brokerId = input.beneficiary === "empresa" ? null : input.brokerId;
    await brokerExists(brokerId);
    return found(
      (
        await getDb()
          .insert(commissions)
          .values({
            ...input,
            brokerId,
            amount: input.amount.toFixed(2),
            percent: input.percent.toFixed(2),
            paidAt: commissionPaidAt(input.status),
          })
          .returning()
      )[0]
    );
  }),
  update: adminProcedure
    .input(z.object({ id: z.number().int().positive(), data: commissionInput }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const d = input.data;
      const brokerId = d.beneficiary === "empresa" ? null : d.brokerId;
      await brokerExists(brokerId);
      const previous = found(
        (
          await db
            .select()
            .from(commissions)
            .where(eq(commissions.id, input.id))
            .limit(1)
        )[0]
      );
      return found(
        (
          await db
            .update(commissions)
            .set({
              ...d,
              brokerId,
              amount: d.amount.toFixed(2),
              percent: d.percent.toFixed(2),
              paidAt: commissionPaidAt(d.status, previous.paidAt),
              updatedAt: new Date(),
            })
            .where(eq(commissions.id, input.id))
            .returning()
        )[0]
      );
    }),
  delete: adminProcedure
    .input(idInput)
    .mutation(async ({ input }) =>
      found(
        (
          await getDb()
            .delete(commissions)
            .where(eq(commissions.id, input.id))
            .returning({ id: commissions.id })
        )[0]
      )
    ),
});

function projectValues(d: z.infer<typeof projectInput>) {
  return {
    ...d,
    types: JSON.stringify(d.types),
    checklist: JSON.stringify(d.checklist),
    files: JSON.stringify(d.files),
    value: d.value.toFixed(2),
    paidValue: d.paidValue.toFixed(2),
    updatedAt: new Date(),
  };
}
export const projetosRouter = router({
  options: adminProcedure.query(async () => (await options()).leads),
  list: adminProcedure.query(async () =>
    getDb().select().from(projects).orderBy(desc(projects.updatedAt))
  ),
  getById: adminProcedure
    .input(idInput)
    .query(async ({ input }) =>
      found(
        (
          await getDb()
            .select()
            .from(projects)
            .where(eq(projects.id, input.id))
            .limit(1)
        )[0]
      )
    ),
  create: adminProcedure.input(projectInput).mutation(async ({ input }) => {
    await leadExists(input.leadId);
    return found(
      (
        await getDb().insert(projects).values(projectValues(input)).returning()
      )[0]
    );
  }),
  update: adminProcedure
    .input(z.object({ id: z.number().int().positive(), data: projectInput }))
    .mutation(async ({ input }) => {
      await leadExists(input.data.leadId);
      return found(
        (
          await getDb()
            .update(projects)
            .set(projectValues(input.data))
            .where(eq(projects.id, input.id))
            .returning()
        )[0]
      );
    }),
  delete: adminProcedure
    .input(idInput)
    .mutation(async ({ input }) =>
      found(
        (
          await getDb()
            .delete(projects)
            .where(eq(projects.id, input.id))
            .returning({ id: projects.id })
        )[0]
      )
    ),
});

export const mapaRouter = router({
  list: adminProcedure.query(async () => {
    const properties = await getDb()
      .select({
        id: imoveis.id,
        title: imoveis.titulo,
        status: imoveis.status,
        type: imoveis.tipo,
        city: imoveis.cidade,
        neighborhood: imoveis.bairro,
        price: imoveis.preco,
        latitude: imoveis.latitude,
        longitude: imoveis.longitude,
        slug: imoveis.slug,
      })
      .from(imoveis)
      .where(and(ne(imoveis.status, "vendido"), ne(imoveis.status, "alugado")))
      .orderBy(asc(imoveis.titulo));
    return properties.map(p => ({
      ...p,
      hasCoordinates: validCoordinates(p.latitude, p.longitude),
    }));
  }),
});
