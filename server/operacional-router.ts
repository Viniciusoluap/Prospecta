import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  brokerProfiles,
  constructionProjects,
  imoveis,
  leads,
  obraMovimentos,
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
import { calcularComissaoObra } from "../shared/financeiro/comissao.js";
import { centavosDe } from "../shared/financeiro/obra.js";
import { adminProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";
import { attachCompletedProcess } from "./lead-services-router.js";
import { excluirDefinitivo } from "./exclusao-definitiva.js";

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
// Responsável (colaborador administrativo) distinto do corretor que conduz a
// visita: carregado do banco, restrito a administradores/colaboradores ativos.
const ASSIGNABLE_ROLES = ["admin", "colaborador"] as const;
async function responsibleExists(id: number | null) {
  if (id === null) return null;
  return found(
    (
      await getDb()
        .select({ name: users.name })
        .from(users)
        .where(
          and(eq(users.id, id), inArray(users.role, ASSIGNABLE_ROLES), eq(users.active, true))
        )
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
          .where(and(eq(leads.id, id), isNull(leads.deletedAt), ne(leads.stage, "rejected")))
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
  defaultCommissionPct: brokerProfiles.defaultCommissionPct,
};
async function options() {
  const db = getDb();
  const [leadOptions, properties, brokers, responsibles] = await Promise.all([
    // Exclui leads excluídos (soft delete) e rejeitados — não aparecem em seletores.
    db
      .select({ id: leads.id, name: leads.name })
      .from(leads)
      .where(and(isNull(leads.deletedAt), ne(leads.stage, "rejected")))
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
    // Responsáveis: apenas administradores e colaboradores ativos, do banco.
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(inArray(users.role, ASSIGNABLE_ROLES), eq(users.active, true)))
      .orderBy(asc(users.name)),
  ]);
  return { leads: leadOptions, properties, brokers, responsibles };
}

async function visitValues(input: z.infer<typeof visitInput>) {
  const lead = await leadExists(input.leadId);
  await brokerExists(input.brokerId);
  const responsible = await responsibleExists(input.responsibleId);
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
  const { responsibleId, ...rest } = input;
  return {
    ...rest,
    clientName: lead?.name ?? input.clientName,
    clientPhone: lead?.phone ?? input.clientPhone,
    responsibleName: responsible?.name ?? null,
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
      sql`WITH created AS (INSERT INTO users ("openId", name, email, phone, creci, active, "avatarUrl", role, permissions) VALUES (${`broker:${email}`}, ${input.name}, ${email}, ${input.phone}, ${input.creci}, ${input.active}, ${input.avatar || null}, 'corretor', '[]') RETURNING id) INSERT INTO broker_profiles (user_id, specialties, notes, default_commission_pct) SELECT id, ${JSON.stringify(input.specialties ?? [])}, ${input.notes}, ${input.defaultCommissionPct || null} FROM created RETURNING user_id`
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
      // Foto e especialidades não são mais editadas pela tela (EPIC-018);
      // quando ausentes no payload, os valores gravados são preservados.
      const specialties =
        data.specialties === undefined
          ? undefined
          : JSON.stringify(data.specialties);
      await db.batch([
        db
          .update(users)
          .set({
            name: data.name,
            phone: data.phone,
            creci: data.creci,
            active: data.active,
            ...(data.avatar === undefined
              ? {}
              : { avatarUrl: data.avatar || null }),
            updatedAt: new Date(),
          })
          .where(and(eq(users.id, input.id), eq(users.role, "corretor"))),
        db
          .insert(brokerProfiles)
          .values({
            userId: input.id,
            specialties: specialties ?? "[]",
            notes: data.notes,
            defaultCommissionPct: data.defaultCommissionPct || null,
          })
          .onConflictDoUpdate({
            target: brokerProfiles.userId,
            set: {
              ...(specialties === undefined ? {} : { specialties }),
              notes: data.notes,
              ...(data.defaultCommissionPct === undefined ? {} : { defaultCommissionPct: data.defaultCommissionPct || null }),
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

/**
 * EPIC-018 (stories 2.3–2.5): o negócio da comissão aponta para um imóvel ou
 * uma obra cadastrados. O título é gravado em `property` para histórico.
 */
async function commissionTarget(input: z.infer<typeof commissionInput>) {
  const db = getDb();
  if (input.businessType === "obra") {
    const obra = found(
      (
        await db
          .select({ id: constructionProjects.id, title: constructionProjects.title })
          .from(constructionProjects)
          .where(eq(constructionProjects.id, input.constructionProjectId!))
          .limit(1)
      )[0]
    );
    return { propertyId: null, constructionProjectId: obra.id, property: obra.title };
  }
  const imovel = found(
    (
      await db
        .select({ id: imoveis.id, title: imoveis.titulo })
        .from(imoveis)
        .where(eq(imoveis.id, input.propertyId!))
        .limit(1)
    )[0]
  );
  return { propertyId: imovel.id, constructionProjectId: null, property: imovel.title };
}

/**
 * EPIC-020 Lote 3 (item 32): toda obra cujo lead tem corretor aparece aqui,
 * inclusive as antigas. A lista é derivada a cada leitura (obra + CRM +
 * pagamentos de categoria "comissão"), então não existe registro duplicado
 * para sincronizar. Comissões cadastradas à mão para a mesma obra são
 * mostradas lado a lado e as divergências sinalizadas — nunca sobrescritas.
 */
export async function listarComissoesDeObras() {
  const db = getDb();
  const pago = sql<string>`COALESCE((SELECT SUM(${obraMovimentos.valor}) FROM ${obraMovimentos} WHERE ${obraMovimentos.projectId} = ${constructionProjects.id} AND ${obraMovimentos.natureza} = 'pagamento' AND ${obraMovimentos.categoria} = 'comissao' AND ${obraMovimentos.status} = 'confirmado'), 0)`;
  const [obras, manuais] = await Promise.all([
    db
      .select({
        obraId: constructionProjects.id,
        obra: constructionProjects.title,
        status: constructionProjects.status,
        vgv: constructionProjects.vgv,
        percentualObra: constructionProjects.commissionPct,
        leadId: leads.id,
        cliente: leads.name,
        corretorId: users.id,
        corretor: users.name,
        percentualCorretor: brokerProfiles.defaultCommissionPct,
        pago,
      })
      .from(constructionProjects)
      .innerJoin(leads, eq(leads.id, constructionProjects.leadId))
      .innerJoin(users, eq(users.id, leads.brokerId))
      .leftJoin(brokerProfiles, eq(brokerProfiles.userId, users.id))
      .orderBy(asc(users.name), asc(constructionProjects.title)),
    db
      .select({ id: commissions.id, obraId: commissions.constructionProjectId, brokerId: commissions.brokerId, amount: commissions.amount, percent: commissions.percent, status: commissions.status })
      .from(commissions)
      .where(sql`${commissions.constructionProjectId} IS NOT NULL`),
  ]);
  return obras.map(o => {
    const calculo = calcularComissaoObra({
      corretor: { id: o.corretorId, nome: o.corretor ?? "Corretor", percentualPadrao: o.percentualCorretor },
      vgvCentavos: centavosDe(o.vgv),
      percentualObra: o.percentualObra,
      pagoCentavos: centavosDe(o.pago) ?? 0,
    });
    const registrosManuais = manuais.filter(m => m.obraId === o.obraId);
    const alertas = [...calculo.alertas];
    for (const m of registrosManuais) {
      if (m.brokerId !== o.corretorId) alertas.push(`Comissão manual #${m.id} está em nome de outro corretor.`);
      if (calculo.valorCentavos !== null && centavosDe(m.amount) !== calculo.valorCentavos)
        alertas.push(`Comissão manual #${m.id} tem valor diferente do calculado (preservada; revise).`);
    }
    return { ...o, calculo, registrosManuais, alertas };
  });
}

export const comissoesRouter = router({
  obras: adminProcedure.query(() => listarComissoesDeObras()),
  options: adminProcedure.query(async () => (await options()).brokers),
  /** Corretores, imóveis e obras realmente cadastrados para o formulário. */
  formOptions: adminProcedure.query(async () => {
    const db = getDb();
    const [brokers, properties, obras] = await Promise.all([
      db
        .select({ id: users.id, name: users.name, active: users.active })
        .from(users)
        .where(eq(users.role, "corretor"))
        .orderBy(asc(users.name)),
      db
        .select({ id: imoveis.id, name: imoveis.titulo, value: imoveis.preco, status: imoveis.status })
        .from(imoveis)
        .orderBy(asc(imoveis.titulo)),
      db
        .select({
          id: constructionProjects.id,
          name: constructionProjects.title,
          contractValue: constructionProjects.contractValue,
          vgv: constructionProjects.vgv,
        })
        .from(constructionProjects)
        .orderBy(asc(constructionProjects.title)),
    ]);
    return {
      brokers,
      properties,
      // Base da comissão de obra é o VGV (item 32); contract_value agora é o
      // Orçamento Previsto (Lote 2) e não serve de base.
      obras: obras.map(({ contractValue: _orcamento, vgv, ...obra }) => ({
        ...obra,
        value: vgv,
      })),
    };
  }),
  list: adminProcedure.query(async () =>
    getDb()
      .select({ commission: commissions, brokerName: users.name })
      .from(commissions)
      .leftJoin(users, eq(commissions.brokerId, users.id))
      .orderBy(asc(commissions.dueDate))
  ),
  // Compatibilidade para clientes antigos; a tabela legada estava vazia.
  legacy: adminProcedure.query(() => []),
  create: adminProcedure.input(commissionInput).mutation(async ({ input }) => {
    const brokerId = input.beneficiary === "empresa" ? null : input.brokerId;
    await brokerExists(brokerId);
    const target = await commissionTarget(input);
    return found(
      (
        await getDb()
          .insert(commissions)
          .values({
            ...input,
            ...target,
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
      const target = await commissionTarget(d);
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
              ...target,
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
  /** Item 03: comissão paga é registro contábil e não é excluída. */
  delete: adminProcedure
    .input(idInput)
    .mutation(async ({ input }) => {
      const { excluido } = await excluirDefinitivo("comissao", input.id);
      if (!excluido) throw new TRPCError({ code: "NOT_FOUND", message: "Registro não encontrado" });
      return { id: input.id };
    }),
});

function projectValues(
  d: z.infer<typeof projectInput>,
  lead: { name: string; phone: string } | null = null
) {
  return {
    ...d,
    // EPIC-017: com lead vinculado, cliente e telefone seguem o CRM.
    ...(lead ? { clientName: lead.name, clientPhone: lead.phone ?? "" } : {}),
    types: JSON.stringify(d.types),
    checklist: JSON.stringify(d.checklist),
    files: JSON.stringify(d.files),
    value: d.value.toFixed(2),
    paidValue: d.paidValue.toFixed(2),
    updatedAt: new Date(),
  };
}
/**
 * Item 07: engenheiro responsável = colaborador (ou admin) ativo, por ID; o nome
 * exibido vem do cadastro. Texto livre só permanece em registro anterior sem vínculo.
 */
async function resolverEngenheiro(d: z.infer<typeof projectInput>, anterior: string | null = null) {
  if (d.engineerUserId) {
    const [u] = await getDb().select({ id: users.id, name: users.name, role: users.role, active: users.active })
      .from(users).where(eq(users.id, d.engineerUserId)).limit(1);
    if (!u || !u.active || !["colaborador", "admin"].includes(u.role))
      throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha um colaborador ativo como engenheiro responsável." });
    return { engineerUserId: u.id, engineer: u.name ?? "" };
  }
  const legado = d.engineer.trim();
  if (anterior && legado && legado === anterior.trim()) return { engineerUserId: null, engineer: legado };
  throw new TRPCError({ code: "BAD_REQUEST", message: "Escolha o engenheiro responsável entre os colaboradores cadastrados." });
}

export const projetosRouter = router({
  options: adminProcedure.query(async () => (await options()).leads),
  /** Colaboradores (e admins) ativos que podem ser engenheiro responsável. */
  engenheiros: adminProcedure.query(async () =>
    getDb().select({ id: users.id, name: users.name, role: users.role }).from(users)
      .where(and(eq(users.active, true), inArray(users.role, ["colaborador", "admin"])))
      .orderBy(asc(users.name))
  ),
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
    const lead = await leadExists(input.leadId);
    const engenheiro = await resolverEngenheiro(input);
    const created = found(
      (
        await getDb()
          .insert(projects)
          .values({ ...projectValues(input, lead), ...engenheiro })
          .returning()
      )[0]
    );
    await attachCompletedProcess("projetos", created.leadId, created.id);
    return created;
  }),
  update: adminProcedure
    .input(z.object({ id: z.number().int().positive(), data: projectInput }))
    .mutation(async ({ input }) => {
      const lead = await leadExists(input.data.leadId);
      const [atual] = await getDb().select({ engineer: projects.engineer }).from(projects).where(eq(projects.id, input.id)).limit(1);
      if (!atual) throw new TRPCError({ code: "NOT_FOUND", message: "Registro não encontrado" });
      const engenheiro = await resolverEngenheiro(input.data, atual.engineer);
      return found(
        (
          await getDb()
            .update(projects)
            .set({ ...projectValues(input.data, lead), ...engenheiro })
            .where(eq(projects.id, input.id))
            .returning()
        )[0]
      );
    }),
  /** Item 03: exclusão definitiva (bloqueada com pagamento registrado). */
  delete: adminProcedure
    .input(idInput)
    .mutation(async ({ input }) => {
      const { excluido } = await excluirDefinitivo("projeto", input.id);
      if (!excluido) throw new TRPCError({ code: "NOT_FOUND", message: "Registro não encontrado" });
      return { id: input.id };
    }),
  /** Item 03: cancelar mantém o registro e o histórico. */
  cancel: adminProcedure.input(idInput).mutation(async ({ input }) =>
    found((await getDb().update(projects).set({ status: "cancelado", updatedAt: new Date() })
      .where(eq(projects.id, input.id)).returning({ id: projects.id }))[0])),
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
