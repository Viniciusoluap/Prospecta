import { projectChecklist } from "../shared/projeto-documentos.js";
import { PROJECT_TYPE_LABELS } from "../shared/operacional.js";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  brokerProfiles,
  constructionPci,
  constructionProjects,
  imoveis,
  leads,
  obraMovimentos,
  operationalCommissions as commissions,
  operationalProjects as projects,
  portalVisits as visits,
  projectRevisionRequests as revisoes,
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
import { coordenadasDaPci, enderecoCompleto, vgvDaObra as vgvDaObraCompartilhado } from "../shared/obra-localizacao.js";
import { centavosDe } from "../shared/financeiro/obra.js";
// Lote 2, correção 04: lista de engenheiros enriquecida com o perfil (CREA).
import { listarEngenheiros } from "./usuario-documentos.js";
import { adminProcedure, router } from "./_core/trpc.js";
import { createNotification, getDb } from "./db.js";
import { sendEmail } from "./_core/email-smtp.js";
import {
  emailPedidoRevisao,
  lerEntregas,
  mensagemPedidoSalvo,
  validarPedidoRevisao,
  type SituacaoCanal,
} from "../shared/projeto-revisao.js";
import { attachCompletedProcess } from "./lead-services-router.js";
import { excluirDefinitivo } from "./exclusao-definitiva.js";
import { refletirProjetoNoEstudo, removerProcessoDoEstudo, vinculoDoProjeto } from "./projeto-incorporacao-sync.js";

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
/**
 * Item 10 (18/10) — "Agendamento de visita" no painel do lead: grava na mesma
 * tabela da Agenda, mas é ação do CRM (revisão do Codex no PR #133: quem tem só
 * CRM agenda pelo lead, como no Santa Fé). Sempre preso a um lead existente.
 */
export async function opcoesDaVisitaDoLead() {
  const { brokers, responsibles } = await options();
  return { brokers, responsibles };
}
export async function agendarVisitaDoLead(input: z.infer<typeof visitInput> & { leadId: number }) {
  return found((await getDb().insert(visits).values(await visitValues(input)).returning())[0]);
}

/** Item 06: corretor só vê e altera as próprias visitas; o vínculo vem da sessão. */
function corretorDaSessao(user: { id: number; role: string }): number | null {
  return user.role === "corretor" ? user.id : null;
}

async function visitaDoCorretor(id: number, corretorId: number | null) {
  if (corretorId === null) return;
  const [v] = await getDb().select({ brokerId: visits.brokerId }).from(visits).where(eq(visits.id, id)).limit(1);
  if (!v || v.brokerId !== corretorId) throw new TRPCError({ code: "NOT_FOUND", message: "Registro não encontrado" });
}

/**
 * Revisão do Codex (PR #111): o corretor só agenda visita para lead da própria
 * carteira — senão poderia informar o id de outro lead e receber nome/telefone
 * do cliente de outro corretor copiados para a visita.
 */
async function leadDoCorretor(leadId: number | null, corretorId: number | null) {
  if (corretorId === null || leadId === null) return;
  const [l] = await getDb().select({ id: leads.id }).from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.brokerId, corretorId), isNull(leads.deletedAt))).limit(1);
  if (!l) throw new TRPCError({ code: "NOT_FOUND", message: "Lead não encontrado na sua carteira" });
}

export const agendaRouter = router({
  cardDeadlines: adminProcedure.query(async ({ ctx }) => {
    const corretorId = corretorDaSessao(ctx.user);
    const responsavelLead = alias(users, "responsavel_lead_agenda");
    return getDb().select({ id: leads.id, name: leads.name, cardDueDate: leads.cardDueDate, responsibleName: responsavelLead.name })
      .from(leads).leftJoin(responsavelLead, eq(leads.responsibleUserId, responsavelLead.id))
      .where(and(isNull(leads.deletedAt), ne(leads.stage, "finalized"),
        sql`${leads.cardDueDate} IS NOT NULL`,
        ...(corretorId === null ? [] : [eq(leads.brokerId, corretorId)])))
      .orderBy(asc(leads.cardDueDate));
  }),
  options: adminProcedure.query(async ({ ctx }) => {
    const corretorId = corretorDaSessao(ctx.user);
    if (corretorId === null) return options();
    // Corretor: só os próprios leads e ele mesmo como corretor.
    const db = getDb();
    const [leadOptions, properties, eu] = await Promise.all([
      db.select({ id: leads.id, name: leads.name }).from(leads)
        .where(and(isNull(leads.deletedAt), ne(leads.stage, "rejected"), eq(leads.brokerId, corretorId))).orderBy(asc(leads.name)),
      db.select({ id: imoveis.id, name: imoveis.titulo }).from(imoveis).orderBy(asc(imoveis.titulo)),
      db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, corretorId)),
    ]);
    return { leads: leadOptions, properties, brokers: eu, responsibles: [] };
  }),
  list: adminProcedure.query(async ({ ctx }) => {
    const corretorId = corretorDaSessao(ctx.user);
    const responsavelLead = alias(users, "responsavel_lead_visita");
    return getDb()
      .select({
        visit: visits,
        leadName: leads.name,
        brokerName: users.name,
        leadResponsibleName: responsavelLead.name,
        propertyTitle: imoveis.titulo,
      })
      .from(visits)
      .leftJoin(leads, eq(visits.leadId, leads.id))
      .leftJoin(responsavelLead, eq(leads.responsibleUserId, responsavelLead.id))
      .leftJoin(users, eq(visits.brokerId, users.id))
      .leftJoin(imoveis, eq(visits.propertyId, imoveis.id))
      .where(corretorId === null ? undefined : eq(visits.brokerId, corretorId))
      .orderBy(asc(visits.scheduledAt));
  }),
  create: adminProcedure.input(visitInput).mutation(async ({ ctx, input }) => {
    const corretorId = corretorDaSessao(ctx.user);
    const dados = corretorId === null ? input : { ...input, brokerId: corretorId, responsibleId: null };
    await leadDoCorretor(dados.leadId, corretorId);
    return found(
      (
        await getDb()
          .insert(visits)
          .values(await visitValues(dados))
          .returning()
      )[0]
    );
  }),
  update: adminProcedure
    .input(z.object({ id: z.number().int().positive(), data: visitInput }))
    .mutation(async ({ ctx, input }) => {
      const corretorId = corretorDaSessao(ctx.user);
      await visitaDoCorretor(input.id, corretorId);
      const dados = corretorId === null ? input.data : { ...input.data, brokerId: corretorId, responsibleId: null };
      await leadDoCorretor(dados.leadId, corretorId);
      return found(
        (
          await getDb()
            .update(visits)
            .set(await visitValues(dados))
            .where(eq(visits.id, input.id))
            .returning()
        )[0]
      );
    }),
  delete: adminProcedure
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      await visitaDoCorretor(input.id, corretorDaSessao(ctx.user));
      return found(
        (
          await getDb()
            .delete(visits)
            .where(eq(visits.id, input.id))
            .returning({ id: visits.id })
        )[0]
      );
    }),
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
export async function listarComissoesDeObras(somenteCorretorId?: number) {
  const db = getDb();
  const pago = sql<string>`COALESCE((SELECT SUM(${obraMovimentos.valor}) FROM ${obraMovimentos} WHERE ${obraMovimentos.projectId} = ${constructionProjects.id} AND ${obraMovimentos.natureza} = 'pagamento' AND ${obraMovimentos.categoria} = 'comissao' AND ${obraMovimentos.status} = 'confirmado'), 0)`;
  const [obras, manuais] = await Promise.all([
    db
      .select({
        obraId: constructionProjects.id,
        obra: constructionProjects.title,
        status: constructionProjects.status,
        // VGV da obra com lead = VGV simulado do CRM (base da comissão).
        vgv: leads.simulationValue,
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
      .where(somenteCorretorId === undefined ? undefined : eq(leads.brokerId, somenteCorretorId))
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
          vgv: sql<string | null>`CASE WHEN ${constructionProjects.leadId} IS NULL THEN ${constructionProjects.vgv} ELSE ${leads.simulationValue} END`,
        })
        .from(constructionProjects)
        .leftJoin(leads, eq(leads.id, constructionProjects.leadId))
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
  /** Item 03 + pedido A6: exclusão definitiva (inclusive comissão paga). */
  delete: adminProcedure
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      const { excluido } = await excluirDefinitivo("comissao", input.id, ctx.user);
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
    checklist: JSON.stringify(projectChecklist(d.types, d.checklist, PROJECT_TYPE_LABELS)),
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
  /** Colaboradores (e admins) ativos que podem ser engenheiro responsável, com o perfil Engenheiro (CREA) quando houver. */
  engenheiros: adminProcedure.query(async () => listarEngenheiros()),
  list: adminProcedure.query(async () => {
    const [lista, pendentes] = await Promise.all([
      getDb().select().from(projects).orderBy(desc(projects.updatedAt)),
      getDb().select({ projectId: revisoes.projectId, total: sql<number>`count(*)::int` })
        .from(revisoes).where(eq(revisoes.status, "pendente")).groupBy(revisoes.projectId),
    ]);
    const porProjeto = new Map(pendentes.map(item => [item.projectId, item.total]));
    return lista.map(projeto => ({ ...projeto, pendingRevisionCount: porProjeto.get(projeto.id) ?? 0 }))
      .sort((a, b) => Number(b.pendingRevisionCount > 0) - Number(a.pendingRevisionCount > 0));
  }),
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
      const salvo = found(
        (
          await getDb()
            .update(projects)
            .set({ ...projectValues(input.data, lead), ...engenheiro, files: sql`${projects.files}` })
            .where(eq(projects.id, input.id))
            .returning()
        )[0]
      );
      // Correção 07: projeto vindo da Incorporação devolve os dados compartilhados ao processo.
      await refletirProjetoNoEstudo(salvo.id);
      return salvo;
    }),
  /** Lote 23/10, etapa 2C: histórico de pedidos de revisão e entregas do projeto. */
  revisoes: adminProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const rows = await getDb().select().from(revisoes)
        .where(eq(revisoes.projectId, input.projectId))
        .orderBy(desc(revisoes.createdAt), desc(revisoes.id));
      return rows.map(r => ({ ...r, deliveries: lerEntregas(r.deliveries) }));
    }),
  /**
   * Etapa 2C: salva o pedido (autor, data, estado) e avisa o colaborador vinculado
   * por notificação interna e e-mail. Cada canal registra a situação real — nunca
   * "enviado" quando não houve destinatário ou o envio falhou.
   */
  solicitarRevisao: adminProcedure
    .input(z.object({ projectId: z.number().int().positive(), texto: z.string() }))
    .mutation(async ({ ctx, input }) => {
      let texto: string;
      try { texto = validarPedidoRevisao(input.texto); }
      catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: (e as Error).message }); }
      const projeto = found((await getDb().select().from(projects).where(eq(projects.id, input.projectId)).limit(1))[0]);
      const [colaborador] = projeto.engineerUserId
        ? await getDb().select({ id: users.id, name: users.name, email: users.email, active: users.active })
          .from(users).where(eq(users.id, projeto.engineerUserId)).limit(1)
        : [];
      const destinatario = colaborador?.active ? colaborador : null;
      const autor = ctx.user.name || ctx.user.email || `Usuário ${ctx.user.id}`;
      const [pedido] = await getDb().transaction(async tx => {
        await tx.execute(sql`SELECT id FROM operational_projects WHERE id = ${projeto.id} FOR UPDATE`);
        const [jaPendente] = await tx.select({ id: revisoes.id }).from(revisoes)
          .where(and(eq(revisoes.projectId, projeto.id), eq(revisoes.status, "pendente"))).limit(1);
        const inserido = await tx.insert(revisoes).values({
          projectId: projeto.id,
          requestedByUserId: ctx.user.id,
          requestedByName: autor,
          requestText: texto,
          status: "pendente",
          previousProjectStatus: jaPendente ? null : projeto.status,
          engineerUserId: destinatario?.id ?? null,
          notificationStatus: "sem_destinatario",
          emailStatus: "sem_destinatario",
        }).returning();
        await tx.update(projects).set({ status: "revisao", updatedAt: new Date() }).where(eq(projects.id, projeto.id));
        return inserido;
      });
      const link = `/admin/projetos?projeto=${projeto.id}`;
      let notificacao: SituacaoCanal = "sem_destinatario";
      let email: SituacaoCanal = "sem_destinatario";
      if (destinatario) {
        try {
          await createNotification({ userId: destinatario.id, title: `Revisão solicitada — ${projeto.name}`, message: `${autor}: ${texto.slice(0, 400)}`, type: "system", relatedId: projeto.id, actionUrl: link });
          notificacao = "enviado";
        } catch (e) {
          console.error("[projetos.solicitarRevisao] notificação", e);
          notificacao = "falhou";
        }
        const para = destinatario.email?.trim();
        if (para) {
          const origem = process.env.SITE_URL || "https://www.prospectaconstrucoes.com";
          const msg = emailPedidoRevisao({ projeto: projeto.name, cliente: projeto.clientName, autor, texto, link: `${origem}${link}` });
          const ok = await sendEmail({ to: para, recipientName: destinatario.name ?? undefined, subject: msg.subject, html: msg.html, templateType: "admin_notification", metadata: { projectId: projeto.id, revisionId: pedido.id, kind: "project_revision" } }).catch(() => false);
          email = ok ? "enviado" : "falhou";
        }
      }
      await getDb().update(revisoes).set({ notificationStatus: notificacao, emailStatus: email, updatedAt: new Date() }).where(eq(revisoes.id, pedido.id));
      return { id: pedido.id, notificacao, email, mensagem: mensagemPedidoSalvo(notificacao, email) };
    }),
  /** Item 03 + pedido A6: exclusão definitiva. */
  delete: adminProcedure
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      const vinculo = await vinculoDoProjeto(input.id);
      const { excluido } = await excluirDefinitivo("projeto", input.id, ctx.user);
      if (!excluido) throw new TRPCError({ code: "NOT_FOUND", message: "Registro não encontrado" });
      // Correção 07: o processo de aprovação correspondente sai do Projeto Aprovado.
      if (vinculo) await removerProcessoDoEstudo(vinculo);
      return { id: input.id };
    }),
});

export const mapaRouter = router({
  /**
   * Imóveis disponíveis/reservados + obras com ponto conhecido (pedido de 23/10).
   * Imóvel vinculado a uma obra mostra o VGV (simulado do lead, se houver) e o endereço da obra e, se não tiver
   * coordenadas, o ponto da PCI da CAIXA. Obra sem imóvel na lista entra com o ponto
   * da PCI (identificação), sem criar imóvel. Coordenada ilegível não é inventada.
   */
  list: adminProcedure.query(async () => {
    const db = getDb();
    const [lista, obras, pcis] = await Promise.all([
      db.select({
        id: imoveis.id, title: imoveis.titulo, status: imoveis.status, type: imoveis.tipo,
        address: imoveis.endereco, city: imoveis.cidade, neighborhood: imoveis.bairro, state: imoveis.estado,
        price: imoveis.preco, latitude: imoveis.latitude, longitude: imoveis.longitude, slug: imoveis.slug,
      }).from(imoveis)
        .where(and(ne(imoveis.status, "vendido"), ne(imoveis.status, "alugado")))
        .orderBy(asc(imoveis.titulo)),
      db.select({
        id: constructionProjects.id, title: constructionProjects.title, address: constructionProjects.address,
        city: constructionProjects.city, state: constructionProjects.state, vgv: constructionProjects.vgv,
        imovelId: constructionProjects.imovelId, leadId: constructionProjects.leadId, simulationValue: leads.simulationValue,
      }).from(constructionProjects).leftJoin(leads, eq(leads.id, constructionProjects.leadId)),
      db.select({ projectId: constructionPci.projectId, parsed: constructionPci.parsed }).from(constructionPci),
    ]);
    // Mesma regra do financeiro da obra (carregarObra): obra do CRM usa o VGV simulado do lead;
    // obra sem lead usa o VGV digitado. Valor aprovado é financiamento, não VGV.
    const vgvDaObra = (o: (typeof obras)[number]) => vgvDaObraCompartilhado(o); // mesma regra da lista de imóveis
    const obraDoImovel = new Map(obras.filter(o => o.imovelId).map(o => [o.imovelId!, o]));
    const pciDaObra = new Map(pcis.map(p => [p.projectId, (p.parsed as { identificacao?: { latitude?: unknown; longitude?: unknown } } | null)?.identificacao]));
    const pontoPciDaObra = (obraId: number) => {
      const id = pciDaObra.get(obraId);
      return id ? coordenadasDaPci(id.latitude, id.longitude) : null;
    };
    const pontosImoveis = lista.map(p => {
      const obra = obraDoImovel.get(p.id);
      // Imóvel vinculado sem coordenadas usa o ponto da PCI da obra (sem gravar nada).
      const pci = obra && !validCoordinates(p.latitude, p.longitude) ? pontoPciDaObra(obra.id) : null;
      const latitude = pci ? pci.lat.toFixed(7) : p.latitude;
      const longitude = pci ? pci.lng.toFixed(7) : p.longitude;
      return {
        key: `imovel-${p.id}`,
        id: p.id,
        kind: "imovel" as const,
        obraId: obra?.id ?? null,
        title: p.title,
        status: p.status,
        type: p.type,
        city: p.city,
        neighborhood: p.neighborhood,
        address: enderecoCompleto(obra ? [obra.address, obra.city, obra.state] : [p.address, p.neighborhood, p.city, p.state]),
        price: obra ? vgvDaObra(obra) : p.price,
        latitude,
        longitude,
        slug: p.slug,
        hasCoordinates: validCoordinates(latitude, longitude),
      };
    });
    // Obra sem imóvel na lista (sem vínculo, ou imóvel vendido/alugado) entra pelo ponto da PCI.
    const imoveisListados = new Set(lista.map(p => p.id));
    const pontosObras = obras.filter(o => !o.imovelId || !imoveisListados.has(o.imovelId)).flatMap(o => {
      const ponto = pontoPciDaObra(o.id);
      if (!ponto) return [];
      return [{
        key: `obra-${o.id}`,
        id: o.id,
        kind: "obra" as const,
        obraId: o.id,
        title: `Obra — ${o.title}`,
        status: "obra",
        type: "obra",
        city: o.city,
        neighborhood: null,
        address: enderecoCompleto([o.address, o.city, o.state]),
        price: vgvDaObra(o),
        latitude: ponto.lat.toFixed(7),
        longitude: ponto.lng.toFixed(7),
        slug: null,
        hasCoordinates: true,
      }];
    });
    return [...pontosImoveis, ...pontosObras];
  }),
});

