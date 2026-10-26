import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";
import {
  bpoLancamentos,
  regularizacaoDocuments,
  regularizacaoEtapas,
  regularizacaoItensFinanceiros,
  regularizacaoRecebimentos,
  regularizacoes,
  users,
} from "../drizzle/schema.js";
import { centavosDe } from "../shared/financeiro/obra.js";
import { indicadoresRegularizacao } from "../shared/financeiro/indicadores-regularizacao.js";
import {
  GRUPOS_FINANCEIROS,
  LIMITE_NOME_ETAPA,
  LIMITE_NOME_ITEM,
  LIMITE_OBSERVACAO_ETAPA,
  STATUS_PROCESSO,
  calcularFinanceiroRegularizacao,
  mensagemErroRegularizacao,
  progressoDasEtapas,
  reordenarEtapas,
} from "../shared/financeiro/regularizacao.js";
import { adminProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";
import { attachCompletedProcess } from "./lead-services-router.js";
import { excluirDefinitivo } from "./exclusao-definitiva.js";

// EPIC-020 Lote 6 — Regularização. Status do Processo (30) independente das
// Etapas do Processo; tabela financeira por processo (31) com recebimentos
// manuais ou do BPO. "Valor Pago" e os "Documentos" antigos saíram da tela e
// da API; os dados continuam no banco.

const statusSchema = z.enum(STATUS_PROCESSO);
const dinheiro = z.string().trim().regex(/^\d{1,13}(\.\d{1,2})?$/, "Valor monetário inválido");
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
const idSchema = z.number().int().positive();

const regularizacaoFields = z.object({
  clientName: z.string().trim().min(2).max(255),
  clientPhone: z.string().trim().max(30).nullable().optional(),
  type: z.string().trim().min(2).max(120),
  status: statusSchema.optional(),
  address: z.string().trim().min(3),
  registration: z.string().trim().max(120).nullable().optional(),
  registryOffice: z.string().trim().max(255).nullable().optional(),
  responsible: z.string().trim().min(2).max(120),
  leadId: z.number().int().positive().nullable().optional(),
  serviceValue: z.number().min(0).optional(),
  expectedEndAt: z.date().nullable().optional(),
  description: z.string().optional(),
  notes: z.string().nullable().optional(),
});

function erroDoBanco(err: unknown): never {
  const mensagem = mensagemErroRegularizacao(err);
  if (mensagem) throw new TRPCError({ code: "BAD_REQUEST", message: mensagem });
  throw err;
}

async function assertRegularizacaoExists(id: number) {
  const [record] = await getDb()
    .select({ id: regularizacoes.id })
    .from(regularizacoes)
    .where(eq(regularizacoes.id, id))
    .limit(1);

  if (!record) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Regularização não encontrada" });
  }
}

/** Etapas, tabela financeira e recebimentos de um processo (tudo calculado na leitura). */
export async function carregarProcesso(id: number) {
  const db = getDb();
  const [etapas, itens, recebimentos] = await Promise.all([
    db.select().from(regularizacaoEtapas).where(eq(regularizacaoEtapas.regularizacaoId, id))
      .orderBy(asc(regularizacaoEtapas.ordem), asc(regularizacaoEtapas.id)),
    db.select().from(regularizacaoItensFinanceiros).where(eq(regularizacaoItensFinanceiros.regularizacaoId, id)),
    db.select({
      rec: regularizacaoRecebimentos,
      bpoDescricao: bpoLancamentos.descricao,
      autor: users.name,
    }).from(regularizacaoRecebimentos)
      .leftJoin(bpoLancamentos, eq(bpoLancamentos.id, regularizacaoRecebimentos.bpoLancamentoId))
      .leftJoin(users, eq(users.id, regularizacaoRecebimentos.criadoPor))
      .where(eq(regularizacaoRecebimentos.regularizacaoId, id))
      .orderBy(desc(regularizacaoRecebimentos.data), desc(regularizacaoRecebimentos.id)),
  ]);
  const financeiro = calcularFinanceiroRegularizacao(
    itens.map((i) => ({ id: i.id, nome: i.nome, grupo: i.grupo, ordem: i.ordem, previsto: i.previsto })),
    recebimentos.map((r) => ({ itemId: r.rec.itemId, valor: r.rec.valor, status: r.rec.status })),
  );
  const nomeItem = new Map(itens.map((i) => [i.id, i.nome]));
  return {
    etapas,
    progressoEtapas: progressoDasEtapas(etapas),
    financeiro,
    itensComRecebimento: Array.from(new Set(recebimentos.map((r) => r.rec.itemId))),
    recebimentos: recebimentos.map((r) => ({
      ...r.rec,
      item: nomeItem.get(r.rec.itemId) ?? "",
      bpoDescricao: r.bpoDescricao,
      autor: r.autor,
    })),
  };
}

async function etapaOuErro(id: number) {
  const [etapa] = await getDb().select().from(regularizacaoEtapas).where(eq(regularizacaoEtapas.id, id)).limit(1);
  if (!etapa) throw new TRPCError({ code: "NOT_FOUND", message: "Etapa não encontrada" });
  return etapa;
}

const etapaCampos = {
  nome: z.string().trim().min(2, "Informe o nome da etapa.").max(LIMITE_NOME_ETAPA),
  progresso: z.number().int().min(0).max(100),
  observacoes: z.string().trim().max(LIMITE_OBSERVACAO_ETAPA).nullable().optional(),
};

const itemCampos = {
  nome: z.string().trim().min(2, "Informe o nome do item.").max(LIMITE_NOME_ITEM),
  grupo: z.enum(GRUPOS_FINANCEIROS),
  previsto: dinheiro,
};

/**
 * Pedido de 25/10 (noite), item 7: cada processo da lista vem com o Total geral (previsto) da
 * tabela financeira — soma do previsto de todos os itens, mesmo valor da linha "Total geral".
 * Uma consulta só (junção com os itens, agrupada por processo).
 */
export async function listarProcessos(status?: string) {
  return getDb()
    .select({ ...getTableColumns(regularizacoes), totalPrevisto: sql<string>`coalesce(sum(${regularizacaoItensFinanceiros.previsto}), 0)` })
    .from(regularizacoes)
    .leftJoin(regularizacaoItensFinanceiros, eq(regularizacaoItensFinanceiros.regularizacaoId, regularizacoes.id))
    .where(status ? eq(regularizacoes.status, status) : undefined)
    .groupBy(regularizacoes.id)
    .orderBy(desc(regularizacoes.updatedAt));
}

export const regularizacaoRouter = router({
  indicadores: adminProcedure.query(async () => {
    const db = getDb();
    const [processos, itens, recebimentos] = await Promise.all([
      db.select({ id: regularizacoes.id, status: regularizacoes.status }).from(regularizacoes),
      db.select({ id: regularizacaoItensFinanceiros.id, regularizacaoId: regularizacaoItensFinanceiros.regularizacaoId,
        chavePadrao: regularizacaoItensFinanceiros.chavePadrao, nome: regularizacaoItensFinanceiros.nome,
        previsto: regularizacaoItensFinanceiros.previsto }).from(regularizacaoItensFinanceiros),
      db.select({ id: regularizacaoRecebimentos.id, regularizacaoId: regularizacaoRecebimentos.regularizacaoId,
        itemId: regularizacaoRecebimentos.itemId, valor: regularizacaoRecebimentos.valor,
        status: regularizacaoRecebimentos.status }).from(regularizacaoRecebimentos),
    ]);
    return indicadoresRegularizacao(processos, itens, recebimentos);
  }),
  list: adminProcedure
    .input(z.object({ status: z.string().max(40).optional() }).optional())
    .query(async ({ input }) => listarProcessos(input?.status)),

  get: adminProcedure
    .input(z.object({ id: idSchema }))
    .query(async ({ input }) => {
      const [record] = await getDb()
        .select()
        .from(regularizacoes)
        .where(eq(regularizacoes.id, input.id))
        .limit(1);
      if (!record) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Regularização não encontrada" });
      }
      return { ...record, ...(await carregarProcesso(input.id)) };
    }),

  create: adminProcedure
    .input(regularizacaoFields)
    .mutation(async ({ input }) => {
      const [created] = await getDb()
        .insert(regularizacoes)
        .values({
          ...input,
          serviceValue: input.serviceValue?.toString(),
        })
        .returning();
      await attachCompletedProcess("regularizacoes", created.leadId, created.id);
      return created;
    }),

  update: adminProcedure
    .input(regularizacaoFields.partial().extend({ id: idSchema }))
    .mutation(async ({ input }) => {
      const { id, serviceValue, ...requested } = input;
      // EPIC-017: com lead vinculado, cliente e telefone vêm do CRM e não são
      // sobrescritos pelo módulo (o cadastro do cliente é único).
      const [current] = await getDb()
        .select({ leadId: regularizacoes.leadId })
        .from(regularizacoes)
        .where(eq(regularizacoes.id, id))
        .limit(1);
      const { clientName, clientPhone, leadId, ...fields } = requested;
      const clientFields = current?.leadId
        ? {}
        : { clientName, clientPhone, leadId };
      const [updated] = await getDb()
        .update(regularizacoes)
        .set({
          ...fields,
          ...clientFields,
          ...(serviceValue !== undefined ? { serviceValue: serviceValue.toString() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(regularizacoes.id, id))
        .returning();
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Regularização não encontrada" });
      }
      await attachCompletedProcess("regularizacoes", updated.leadId, updated.id);
      return updated;
    }),

  remove: adminProcedure
    .input(z.object({ id: idSchema }))
    .mutation(async ({ ctx, input }) => {
      // Item 03 + pedido A6: exclusão definitiva, junto com os recebimentos.
      await assertRegularizacaoExists(input.id);
      await excluirDefinitivo("regularizacao", input.id, ctx.user);
      return { success: true };
    }),

  // ── Etapas do Processo (30) ─────────────────────────────────────────
  etapas: router({
    criar: adminProcedure
      .input(z.object({ regularizacaoId: idSchema, ...etapaCampos }))
      .mutation(async ({ input }) => {
        await assertRegularizacaoExists(input.regularizacaoId);
        const [criada] = await getDb().insert(regularizacaoEtapas).values({
          regularizacaoId: input.regularizacaoId,
          nome: input.nome,
          progresso: input.progresso,
          observacoes: input.observacoes || null,
          ordem: sql`COALESCE((SELECT MAX(${regularizacaoEtapas.ordem}) FROM ${regularizacaoEtapas} WHERE ${regularizacaoEtapas.regularizacaoId} = ${input.regularizacaoId}), 0) + 1`,
        }).returning();
        return criada;
      }),

    editar: adminProcedure
      .input(z.object({ id: idSchema, ...etapaCampos }))
      .mutation(async ({ input }) => {
        const [alterada] = await getDb().update(regularizacaoEtapas)
          .set({ nome: input.nome, progresso: input.progresso, observacoes: input.observacoes || null, updatedAt: new Date() })
          .where(eq(regularizacaoEtapas.id, input.id))
          .returning({ id: regularizacaoEtapas.id });
        if (!alterada) throw new TRPCError({ code: "NOT_FOUND", message: "Etapa não encontrada" });
        return { success: true };
      }),

    excluir: adminProcedure
      .input(z.object({ id: idSchema }))
      .mutation(async ({ input }) => {
        const [apagada] = await getDb().delete(regularizacaoEtapas)
          .where(eq(regularizacaoEtapas.id, input.id))
          .returning({ id: regularizacaoEtapas.id });
        if (!apagada) throw new TRPCError({ code: "NOT_FOUND", message: "Etapa não encontrada" });
        return { success: true };
      }),

    mover: adminProcedure
      .input(z.object({ id: idSchema, direcao: z.union([z.literal(-1), z.literal(1)]) }))
      .mutation(async ({ input }) => {
        const etapa = await etapaOuErro(input.id);
        const db = getDb();
        const atuais = await db.select({ id: regularizacaoEtapas.id }).from(regularizacaoEtapas)
          .where(eq(regularizacaoEtapas.regularizacaoId, etapa.regularizacaoId))
          .orderBy(asc(regularizacaoEtapas.ordem), asc(regularizacaoEtapas.id));
        const nova = reordenarEtapas(atuais, input.id, input.direcao);
        const [primeira, ...demais] = nova.map((e, i) =>
          db.update(regularizacaoEtapas).set({ ordem: i + 1 }).where(eq(regularizacaoEtapas.id, e.id)));
        if (primeira) await db.batch([primeira, ...demais]);
        return { success: true };
      }),
  }),

  // ── Tabela financeira (31) ──────────────────────────────────────────
  financeiro: router({
    criarItem: adminProcedure
      .input(z.object({ regularizacaoId: idSchema, ...itemCampos }))
      .mutation(async ({ input }) => {
        await assertRegularizacaoExists(input.regularizacaoId);
        const [criado] = await getDb().insert(regularizacaoItensFinanceiros).values({
          regularizacaoId: input.regularizacaoId,
          nome: input.nome,
          grupo: input.grupo,
          previsto: input.previsto,
          ordem: sql`COALESCE((SELECT MAX(${regularizacaoItensFinanceiros.ordem}) FROM ${regularizacaoItensFinanceiros} WHERE ${regularizacaoItensFinanceiros.regularizacaoId} = ${input.regularizacaoId} AND ${regularizacaoItensFinanceiros.ordem} < 99), 0) + 1`,
        }).returning();
        return criado;
      }),

    editarItem: adminProcedure
      .input(z.object({ id: idSchema, ...itemCampos }))
      .mutation(async ({ input }) => {
        const [alterado] = await getDb().update(regularizacaoItensFinanceiros)
          .set({ nome: input.nome, grupo: input.grupo, previsto: input.previsto, updatedAt: new Date() })
          .where(eq(regularizacaoItensFinanceiros.id, input.id))
          .returning({ id: regularizacaoItensFinanceiros.id });
        if (!alterado) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado" });
        return { success: true };
      }),

    excluirItem: adminProcedure
      .input(z.object({ id: idSchema }))
      .mutation(async ({ input }) => {
        try {
          const [apagado] = await getDb().delete(regularizacaoItensFinanceiros)
            .where(eq(regularizacaoItensFinanceiros.id, input.id))
            .returning({ id: regularizacaoItensFinanceiros.id });
          if (!apagado) throw new TRPCError({ code: "NOT_FOUND", message: "Item não encontrado" });
        } catch (err) {
          erroDoBanco(err);
        }
        return { success: true };
      }),

    /** Receitas do BPO já recebidas e ainda com saldo (descontado o que obras e regularizações já usaram). */
    bpoDisponiveis: adminProcedure.query(async () => {
      const linhas = await getDb().select({
        id: bpoLancamentos.id,
        descricao: bpoLancamentos.descricao,
        valor: bpoLancamentos.valor,
        pagoEm: bpoLancamentos.pagoEm,
        alocado: sql<string>`bpo_valor_alocado(${bpoLancamentos.id}, NULL, NULL)`,
      }).from(bpoLancamentos)
        .where(and(eq(bpoLancamentos.pago, true), sql`${bpoLancamentos.tipo} <> 'despesa'`))
        .orderBy(asc(bpoLancamentos.vencimento));
      return linhas
        .map((l) => ({ ...l, disponivelCentavos: centavosDe(l.valor)! - centavosDe(l.alocado)! }))
        .filter((l) => l.disponivelCentavos > 0);
    }),

    adicionarRecebimento: adminProcedure
      .input(z.object({
        regularizacaoId: idSchema,
        itemId: idSchema,
        valor: dinheiro.refine((v) => Number(v) > 0, "O valor deve ser maior que zero"),
        data: dataIso,
        observacao: z.string().trim().max(2000).optional(),
        bpoLancamentoId: idSchema.optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          const [criado] = await getDb().insert(regularizacaoRecebimentos).values({
            regularizacaoId: input.regularizacaoId,
            itemId: input.itemId,
            valor: input.valor,
            data: input.data,
            observacao: input.observacao || null,
            origem: input.bpoLancamentoId ? "bpo" : "manual",
            bpoLancamentoId: input.bpoLancamentoId ?? null,
            criadoPor: ctx.user.id,
          }).returning();
          return criado;
        } catch (err) {
          if (String(err instanceof Error ? err.message : err).includes("regularizacao_recebimentos_item_fk"))
            throw new TRPCError({ code: "BAD_REQUEST", message: "O item escolhido não pertence a este processo." });
          erroDoBanco(err);
        }
      }),

    /** Pedido A6: excluir apaga o recebimento de vez (e o histórico dele). */
    excluirRecebimento: adminProcedure
      .input(z.object({ id: idSchema }))
      .mutation(async ({ input }) => {
        const [apagado] = await getDb().delete(regularizacaoRecebimentos).where(eq(regularizacaoRecebimentos.id, input.id)).returning({ id: regularizacaoRecebimentos.id });
        if (!apagado) throw new TRPCError({ code: "NOT_FOUND", message: "Recebimento não encontrado (talvez já excluído)." });
        return { success: true };
      }),
  }),
});
