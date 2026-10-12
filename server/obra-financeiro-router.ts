import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  bpoLancamentos,
  brokerProfiles,
  constructionProjects,
  investidores,
  leads,
  obraInvestidores,
  obraMovimentos,
  obraMovimentosHistorico,
  users,
} from "../drizzle/schema.js";
import { calcularObra, centavosDe, reaisDeCentavos, type EntradasObra } from "../shared/financeiro/obra.js";
import { calcularComissaoObra } from "../shared/financeiro/comissao.js";
import { adminProcedure, protectedProcedure, router } from "./_core/trpc.js";
import { getDb } from "./db.js";

// EPIC-020 Lote 2 — Valores da Operação e Custos. Os campos calculados nunca
// são gravados nem aceitos pela API: são derivados a cada leitura pelo motor
// único (shared/financeiro/obra.ts).

const dinheiro = z.string().trim().regex(/^\d{1,13}(\.\d{1,2})?$/, "Valor monetário inválido");
const percentual = z.string().trim().regex(/^\d{1,3}(\.\d{1,6})?$/, "Percentual inválido")
  .refine((v) => Number(v) <= 100, "O percentual deve estar entre 0% e 100%");
const percentualComissao = z.string().trim().regex(/^\d{1,3}(\.\d{1,4})?$/, "Percentual de comissão inválido (até 4 casas decimais)")
  .refine((v) => Number(v) <= 100, "O percentual deve estar entre 0% e 100%");
const taxaMensal = z.string().trim().regex(/^\d{1,3}(\.\d{1,4})?$/, "Taxa mensal inválida (até 4 casas decimais)");
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");

const NATUREZAS = ["entrada", "recebimento_cef", "pagamento"] as const;
const CATEGORIAS = ["terreno", "comissao", "empreiteiro", "fornecedor", "outros"] as const;

const MENSAGENS_BANCO: Record<string, string> = {
  BPO_ALOCACAO_EXCEDIDA: "Este lançamento do BPO já está totalmente alocado (ou o valor ultrapassa o disponível).",
  BPO_LANCAMENTO_NAO_PAGO: "Só lançamentos do BPO já pagos/recebidos podem ser vinculados.",
  BPO_NATUREZA_INCOMPATIVEL: "Pagamentos usam despesas do BPO; recebimentos usam receitas do BPO.",
  BPO_LANCAMENTO_INEXISTENTE: "Lançamento do BPO não encontrado.",
  MOVIMENTO_NAO_PODE_SER_APAGADO: "Movimentos não são apagados: cancele para preservar o histórico.",
};

function traduzirErroBanco(err: unknown): never {
  const texto = err instanceof Error ? err.message : String(err);
  const codigo = Object.keys(MENSAGENS_BANCO).find((c) => texto.includes(c));
  if (codigo) {
    const detalhe = codigo === "BPO_ALOCACAO_EXCEDIDA" ? texto.match(/disponível R\$ ([\d.-]+)/)?.[1] : undefined;
    throw new TRPCError({ code: "BAD_REQUEST", message: detalhe ? `${MENSAGENS_BANCO[codigo]} Disponível: R$ ${detalhe}.` : MENSAGENS_BANCO[codigo] });
  }
  throw err;
}

const paraData = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function carregarObra(projectId: number) {
  const db = getDb();
  const [obra] = await db.select().from(constructionProjects).where(eq(constructionProjects.id, projectId)).limit(1);
  if (!obra) throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada" });
  return obra;
}

/** Corretor da obra vem do lead no CRM (item 24), com a regra padrão de comissão. */
export async function corretorDaObra(leadId: number | null) {
  if (!leadId) return null;
  const [linha] = await getDb()
    .select({ id: users.id, nome: users.name, percentualPadrao: brokerProfiles.defaultCommissionPct })
    .from(leads)
    .innerJoin(users, eq(users.id, leads.brokerId))
    .leftJoin(brokerProfiles, eq(brokerProfiles.userId, users.id))
    .where(eq(leads.id, leadId))
    .limit(1);
  return linha ? { id: linha.id, nome: linha.nome ?? "Corretor", percentualPadrao: linha.percentualPadrao } : null;
}

export async function calcularResumoObra(projectId: number) {
  const db = getDb();
  const obra = await carregarObra(projectId);
  const [movimentos, participacoes, historico] = await Promise.all([
    db.select({
      mov: obraMovimentos,
      bpoDescricao: bpoLancamentos.descricao,
      bpoValor: bpoLancamentos.valor,
      bpoPago: bpoLancamentos.pago,
    }).from(obraMovimentos)
      .leftJoin(bpoLancamentos, eq(bpoLancamentos.id, obraMovimentos.bpoLancamentoId))
      .where(eq(obraMovimentos.projectId, projectId))
      .orderBy(asc(obraMovimentos.data), asc(obraMovimentos.id)),
    db.select({ participacao: obraInvestidores, nome: investidores.nome })
      .from(obraInvestidores)
      .innerJoin(investidores, eq(investidores.id, obraInvestidores.investidorId))
      .where(eq(obraInvestidores.projectId, projectId))
      .orderBy(asc(investidores.nome)),
    db.select().from(obraMovimentosHistorico)
      .innerJoin(obraMovimentos, eq(obraMovimentos.id, obraMovimentosHistorico.movimentoId))
      .where(eq(obraMovimentos.projectId, projectId))
      .orderBy(asc(obraMovimentosHistorico.id)),
  ]);
  const corretor = await corretorDaObra(obra.leadId);
  const pagoComissao = movimentos
    .filter((m) => m.mov.status === "confirmado" && m.mov.natureza === "pagamento" && m.mov.categoria === "comissao")
    .reduce((acc, m) => acc + centavosDe(m.mov.valor)!, 0);
  // Item 32: com corretor e regra cadastrada, a comissão é VGV × % (fonte única);
  // sem regra, preserva o valor informado antes (condição contratual existente).
  const comissao = calcularComissaoObra({ corretor, vgvCentavos: centavosDe(obra.vgv), percentualObra: obra.commissionPct, pagoCentavos: pagoComissao });
  const [empreiteiro] = obra.contractorUserId
    ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, obra.contractorUserId)).limit(1)
    : [];

  const entradas: EntradasObra = {
    vgv: centavosDe(obra.vgv),
    financiamento: centavosDe(obra.financedAmount),
    fgts: centavosDe(obra.fgtsAmount),
    subsidio: centavosDe(obra.subsidyAmount),
    custoTerreno: centavosDe(obra.lotCost),
    comissao: comissao.valorCentavos ?? centavosDe(obra.commissionAmount),
    orcamentoPrevisto: centavosDe(obra.contractValue),
    taxaMensalPct: obra.installmentRate,
    parcelas: obra.installmentQty,
    dataInicio: paraData(obra.startDate),
    dataTerminoPrevista: paraData(obra.estimatedEndDate),
    investidores: participacoes.map((p) => ({ id: p.participacao.investidorId, percentual: p.participacao.percentual })),
    percentualEmpreiteiro: obra.contractorUserId ? obra.contractorSharePct : null,
    movimentos: movimentos.map((m) => ({ natureza: m.mov.natureza, valorCentavos: centavosDe(m.mov.valor)!, status: m.mov.status })),
  };
  const calculo = calcularObra(entradas);
  const alertasBpo = movimentos
    .filter((m) => m.mov.status === "confirmado" && m.mov.bpoLancamentoId && m.bpoPago === false)
    .map((m) => `O lançamento do BPO vinculado a "${m.mov.descricao}" deixou de estar pago. Revise o movimento.`);

  return {
    obra: {
      id: obra.id,
      title: obra.title,
      tipoContratoLegado: obra.contractType,
    },
    valores: {
      vgv: obra.vgv,
      financiamento: obra.financedAmount,
      fgts: obra.fgtsAmount,
      subsidio: obra.subsidyAmount,
      custoTerreno: obra.lotCost,
      comissao: obra.commissionAmount,
      orcamentoPrevisto: obra.contractValue,
      taxaMensalPct: obra.installmentRate,
      parcelas: obra.installmentQty,
      dataInicio: entradas.dataInicio,
      dataTerminoPrevista: entradas.dataTerminoPrevista,
      percentualEmpreiteiro: obra.contractorSharePct,
      comissaoPercentual: obra.commissionPct,
    },
    corretor,
    comissaoCalculada: comissao,
    empreiteiro: empreiteiro ?? null,
    investidores: participacoes.map((p, i) => ({
      investidorId: p.participacao.investidorId,
      nome: p.nome,
      percentual: p.participacao.percentual,
      lucro: calculo.investidores[i]?.lucro,
    })),
    movimentos: movimentos.map((m) => ({
      ...m.mov,
      bpo: m.mov.bpoLancamentoId ? { descricao: m.bpoDescricao, valor: m.bpoValor, pago: m.bpoPago } : null,
    })),
    historico: historico.map((h) => h.obra_movimentos_historico),
    calculo: { ...calculo, alertas: [...calculo.alertas, ...alertasBpo] },
  };
}

async function exigirEmpreiteiro(id: number | null) {
  if (id === null) return;
  const db = getDb();
  const [u] = await db.select({ role: users.role, active: users.active }).from(users).where(eq(users.id, id)).limit(1);
  if (!u || u.role !== "empreiteiro" || !u.active)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Selecione um empreiteiro cadastrado e ativo." });
}

export const obraFinanceiroRouter = router({
  resumo: adminProcedure.input(z.object({ projectId: z.number().int().positive() })).query(({ input }) => calcularResumoObra(input.projectId)),

  salvarValores: adminProcedure.input(z.object({
    projectId: z.number().int().positive(),
    vgv: dinheiro.nullable(),
    financiamento: dinheiro.nullable(),
    fgts: dinheiro.nullable(),
    subsidio: dinheiro.nullable(),
    custoTerreno: dinheiro.nullable(),
    comissao: dinheiro.nullable(),
    comissaoPercentual: percentualComissao.nullable().optional(),
    orcamentoPrevisto: dinheiro.nullable(),
    taxaMensalPct: taxaMensal.nullable(),
    parcelas: z.number().int().min(0).max(600).nullable(),
    empreiteiroId: z.number().int().positive().nullable(),
    percentualEmpreiteiro: percentual.nullable(),
  })).mutation(async ({ input }) => {
    const obra = await carregarObra(input.projectId);
    await exigirEmpreiteiro(input.empreiteiroId);
    const pctComissao = input.comissaoPercentual === undefined ? obra.commissionPct : input.comissaoPercentual;
    // Com corretor + regra + VGV, o valor da comissão é sempre o calculado.
    const calculada = calcularComissaoObra({
      corretor: await corretorDaObra(obra.leadId),
      vgvCentavos: centavosDe(input.vgv),
      percentualObra: pctComissao,
      pagoCentavos: 0,
    });
    await getDb().update(constructionProjects).set({
      vgv: input.vgv,
      financedAmount: input.financiamento,
      fgtsAmount: input.fgts,
      subsidyAmount: input.subsidio,
      lotCost: input.custoTerreno,
      commissionAmount: calculada.valorCentavos !== null ? reaisDeCentavos(calculada.valorCentavos) : input.comissao,
      commissionPct: pctComissao,
      contractValue: input.orcamentoPrevisto,
      installmentRate: input.taxaMensalPct,
      installmentQty: input.parcelas,
      contractorUserId: input.empreiteiroId,
      contractorSharePct: input.empreiteiroId ? input.percentualEmpreiteiro : null,
      updatedAt: new Date(),
    }).where(eq(constructionProjects.id, input.projectId));
    return { success: true };
  }),

  listarInvestidores: adminProcedure.query(() =>
    getDb().select().from(investidores).where(eq(investidores.ativo, true)).orderBy(asc(investidores.nome))),

  criarInvestidor: adminProcedure.input(z.object({
    nome: z.string().trim().min(2).max(255),
    documento: z.string().trim().max(20).optional(),
    telefone: z.string().trim().max(30).optional(),
    email: z.string().trim().email().max(320).optional().or(z.literal("")),
  })).mutation(async ({ input }) => {
    const [criado] = await getDb().insert(investidores).values({
      nome: input.nome,
      documento: input.documento || null,
      telefone: input.telefone || null,
      email: input.email || null,
    }).returning();
    return criado;
  }),

  definirInvestidores: adminProcedure.input(z.object({
    projectId: z.number().int().positive(),
    participacoes: z.array(z.object({ investidorId: z.number().int().positive(), percentual })).max(50),
  })).mutation(async ({ input }) => {
    await carregarObra(input.projectId);
    const ids = input.participacoes.map((p) => p.investidorId);
    if (new Set(ids).size !== ids.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Investidor repetido na mesma obra." });
    const soma = input.participacoes.reduce((acc, p) => acc + Math.round(Number(p.percentual) * 1e6), 0);
    if (soma > 100 * 1e6) throw new TRPCError({ code: "BAD_REQUEST", message: "A soma das participações dos investidores não pode passar de 100%." });
    const db = getDb();
    if (ids.length) {
      const ativos = await db.select({ id: investidores.id }).from(investidores).where(and(inArray(investidores.id, ids), eq(investidores.ativo, true)));
      if (ativos.length !== ids.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Investidor inexistente ou inativo." });
    }
    const remover = db.delete(obraInvestidores).where(eq(obraInvestidores.projectId, input.projectId));
    if (ids.length) {
      await db.batch([remover, db.insert(obraInvestidores).values(input.participacoes.map((p) => ({ projectId: input.projectId, investidorId: p.investidorId, percentual: p.percentual })))]);
    } else {
      await remover;
    }
    return { success: true };
  }),

  listarEmpreiteiros: adminProcedure.query(() =>
    getDb().select({ id: users.id, name: users.name, email: users.email }).from(users)
      .where(and(eq(users.role, "empreiteiro"), eq(users.active, true))).orderBy(asc(users.name))),

  bpoDisponiveis: adminProcedure.input(z.object({ natureza: z.enum(NATUREZAS) })).query(async ({ input }) => {
    const db = getDb();
    const alocado = sql<string>`COALESCE((SELECT SUM(${obraMovimentos.valor}) FROM ${obraMovimentos} WHERE ${obraMovimentos.bpoLancamentoId} = ${bpoLancamentos.id} AND ${obraMovimentos.status} = 'confirmado'), 0)`;
    const tipoOk = input.natureza === "pagamento" ? eq(bpoLancamentos.tipo, "despesa") : sql`${bpoLancamentos.tipo} <> 'despesa'`;
    const linhas = await db.select({
      id: bpoLancamentos.id,
      descricao: bpoLancamentos.descricao,
      valor: bpoLancamentos.valor,
      pagoEm: bpoLancamentos.pagoEm,
      competencia: bpoLancamentos.competencia,
      alocado,
    }).from(bpoLancamentos).where(and(eq(bpoLancamentos.pago, true), tipoOk)).orderBy(asc(bpoLancamentos.vencimento));
    return linhas
      .map((l) => ({ ...l, disponivelCentavos: centavosDe(l.valor)! - centavosDe(l.alocado)! }))
      .filter((l) => l.disponivelCentavos > 0);
  }),

  adicionarMovimento: adminProcedure.input(z.object({
    projectId: z.number().int().positive(),
    natureza: z.enum(NATUREZAS),
    categoria: z.enum(CATEGORIAS).optional(),
    descricao: z.string().trim().min(2).max(255),
    valor: dinheiro.refine((v) => Number(v) > 0, "O valor deve ser maior que zero"),
    data: dataIso,
    observacao: z.string().trim().max(2000).optional(),
    bpoLancamentoId: z.number().int().positive().optional(),
  })).mutation(async ({ input, ctx }) => {
    await carregarObra(input.projectId);
    if ((input.natureza === "pagamento") !== !!input.categoria)
      throw new TRPCError({ code: "BAD_REQUEST", message: input.natureza === "pagamento" ? "Informe a categoria do pagamento." : "Recebimentos não têm categoria." });
    try {
      const [criado] = await getDb().insert(obraMovimentos).values({
        projectId: input.projectId,
        natureza: input.natureza,
        categoria: input.natureza === "pagamento" ? input.categoria! : null,
        descricao: input.descricao,
        valor: input.valor,
        data: input.data,
        observacao: input.observacao || null,
        origem: input.bpoLancamentoId ? "bpo" : "manual",
        bpoLancamentoId: input.bpoLancamentoId ?? null,
        criadoPor: ctx.user.id,
      }).returning();
      return criado;
    } catch (err) {
      traduzirErroBanco(err);
    }
  }),

  editarMovimento: adminProcedure.input(z.object({
    id: z.number().int().positive(),
    descricao: z.string().trim().min(2).max(255),
    valor: dinheiro.refine((v) => Number(v) > 0, "O valor deve ser maior que zero"),
    data: dataIso,
    observacao: z.string().trim().max(2000).optional(),
  })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const [atual] = await db.select().from(obraMovimentos).where(eq(obraMovimentos.id, input.id)).limit(1);
    if (!atual) throw new TRPCError({ code: "NOT_FOUND", message: "Movimento não encontrado" });
    if (atual.status !== "confirmado") throw new TRPCError({ code: "BAD_REQUEST", message: "Reative o movimento antes de editar." });
    if (atual.origem === "bpo" && centavosDe(atual.valor) !== centavosDe(input.valor))
      throw new TRPCError({ code: "BAD_REQUEST", message: "O valor de um movimento do BPO só muda no próprio BPO: desvincule e vincule novamente." });
    try {
      await db.update(obraMovimentos).set({
        descricao: input.descricao,
        valor: input.valor,
        data: input.data,
        observacao: input.observacao || null,
        atualizadoPor: ctx.user.id,
      }).where(eq(obraMovimentos.id, input.id));
    } catch (err) {
      traduzirErroBanco(err);
    }
    return { success: true };
  }),

  cancelarMovimento: adminProcedure.input(z.object({
    id: z.number().int().positive(),
    motivo: z.string().trim().min(3, "Informe o motivo do cancelamento").max(500),
  })).mutation(async ({ input, ctx }) => {
    const [alterado] = await getDb().update(obraMovimentos)
      .set({ status: "cancelado", motivoCancelamento: input.motivo, atualizadoPor: ctx.user.id })
      .where(and(eq(obraMovimentos.id, input.id), eq(obraMovimentos.status, "confirmado")))
      .returning({ id: obraMovimentos.id });
    if (!alterado) throw new TRPCError({ code: "BAD_REQUEST", message: "Movimento inexistente ou já cancelado." });
    return { success: true };
  }),

  reativarMovimento: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
    try {
      const [alterado] = await getDb().update(obraMovimentos)
        .set({ status: "confirmado", motivoCancelamento: null, atualizadoPor: ctx.user.id })
        .where(and(eq(obraMovimentos.id, input.id), eq(obraMovimentos.status, "cancelado")))
        .returning({ id: obraMovimentos.id });
      if (!alterado) throw new TRPCError({ code: "BAD_REQUEST", message: "Movimento inexistente ou já confirmado." });
    } catch (err) {
      traduzirErroBanco(err);
    }
    return { success: true };
  }),
});

// Acesso do Empreiteiro (17.2 / 22): somente as próprias obras e o próprio
// lucro; nenhum dado de investidor, cliente ou da empresa, nenhuma edição.
export const empreiteiroRouter = router({
  minhasObras: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "empreiteiro") throw new TRPCError({ code: "FORBIDDEN", message: "Acesso exclusivo de empreiteiros." });
    const obras = await getDb().select({ id: constructionProjects.id }).from(constructionProjects)
      .where(eq(constructionProjects.contractorUserId, ctx.user.id));
    const resultado = [];
    for (const { id } of obras) {
      const r = await calcularResumoObra(id);
      const [obra] = await getDb().select({
        title: constructionProjects.title,
        address: constructionProjects.address,
        city: constructionProjects.city,
        progress: constructionProjects.progress,
      }).from(constructionProjects).where(eq(constructionProjects.id, id)).limit(1);
      resultado.push({
        id,
        title: obra.title,
        address: obra.address,
        city: obra.city,
        progress: obra.progress,
        percentualEmpreiteiro: r.valores.percentualEmpreiteiro,
        lucroEmpreiteiro: r.calculo.lucroEmpreiteiro,
      });
    }
    return resultado;
  }),
});
