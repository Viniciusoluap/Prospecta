import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  constructionPhotos,
  constructionProgressHistory,
  constructionProgressItems,
  constructionProjects,
  leads,
  users,
} from "../drizzle/schema.js";
import {
  calcularProgresso,
  mesclarComPadrao,
  type ItemProgressoEntrada,
} from "../shared/financeiro/progresso.js";
import { LIMITE_LEGENDA } from "../shared/obra-fotos.js";
import { montarDetalheObra } from "../shared/financeiro/detalhe-obra.js";
import { baseDaMedicao, estimarMedicoes, situacaoDaMedicao } from "../shared/financeiro/medicoes.js";
import { centavosDe } from "../shared/financeiro/obra.js";
import { adminProcedure, router } from "./_core/trpc.js";
import { getDb, getObraDadosCrm } from "./db.js";
import { calcularResumoObra } from "./obra-financeiro-router.js";

// EPIC-020 Lote 4 — Progresso por incidência (27), fotos (28) e dados do
// relatório executivo (29). O Progresso Geral nunca é digitado: é sempre a soma
// das execuções ponderadas, calculada por shared/financeiro/progresso.ts.

const percentual4 = z.string().trim().regex(/^\d{1,3}(\.\d{1,4})?$/, "Percentual inválido (até 4 casas decimais)");
const projectIdInput = z.object({ projectId: z.number().int().positive() });
const medicaoIdInput = z.object({ medicaoId: z.number().int().positive() });
const itensMedicao = z.array(z.object({ chave: z.string().trim().min(1).max(40), incidencia: percentual4, execucao: percentual4 })).length(20);

async function medicaoOuErro(medicaoId: number) {
  const [m] = await getDb().select().from(constructionProgressHistory).where(eq(constructionProgressHistory.id, medicaoId)).limit(1);
  if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Medição não encontrada" });
  return m;
}

async function ehUltimaMedicao(projectId: number, medicaoId: number) {
  const [ultima] = await getDb().select({ id: constructionProgressHistory.id }).from(constructionProgressHistory)
    .where(eq(constructionProgressHistory.projectId, projectId))
    .orderBy(desc(constructionProgressHistory.createdAt), desc(constructionProgressHistory.id)).limit(1);
  return ultima?.id === medicaoId;
}

/** Grava a medição vigente da obra (itens + progresso). `null` = obra sem medição. */
async function aplicarMedicaoVigente(projectId: number, itens: { chave: string; incidencia: string; execucao: string }[] | null, userId: number, agora: Date) {
  const db = getDb();
  if (!itens) {
    await db.batch([
      db.delete(constructionProgressItems).where(eq(constructionProgressItems.projectId, projectId)),
      db.update(constructionProjects).set({ progressMeasuredPct: null, progress: 0, updatedAt: agora }).where(eq(constructionProjects.id, projectId)),
    ]);
    return;
  }
  const calculo = calcularProgresso(itens);
  await db.batch([
    db.delete(constructionProgressItems).where(eq(constructionProgressItems.projectId, projectId)),
    db.insert(constructionProgressItems).values(itens.map((i) => ({
      projectId, serviceKey: i.chave, incidencePct: i.incidencia, executionPct: i.execucao, updatedBy: userId, updatedAt: agora,
    }))),
    db.update(constructionProjects).set({
      progressMeasuredPct: calculo.progresso.toFixed(6),
      progress: Math.round(calculo.progresso),
      updatedAt: agora,
    }).where(eq(constructionProjects.id, projectId)),
  ]);
}

async function obraOuErro(projectId: number) {
  const [obra] = await getDb().select().from(constructionProjects).where(eq(constructionProjects.id, projectId)).limit(1);
  if (!obra) throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada" });
  return obra;
}

const solicitante = alias(users, "medicao_solicitante");
const recebedor = alias(users, "medicao_recebedor");

export async function carregarProgresso(projectId: number) {
  const db = getDb();
  const obra = await obraOuErro(projectId);
  const [salvos, historico] = await Promise.all([
    db.select().from(constructionProgressItems).where(eq(constructionProgressItems.projectId, projectId)),
    db.select({
      id: constructionProgressHistory.id,
      progresso: constructionProgressHistory.progressPct,
      somaIncidencia: constructionProgressHistory.incidenceTotalPct,
      criadoEm: constructionProgressHistory.createdAt,
      autor: users.name,
      itens: constructionProgressHistory.items,
      solicitadaEm: constructionProgressHistory.requestedAt,
      solicitadaPor: solicitante.name,
      recebidaEm: constructionProgressHistory.receivedAt,
      recebidaPor: recebedor.name,
      editadaEm: constructionProgressHistory.updatedAt,
    }).from(constructionProgressHistory)
      .leftJoin(users, eq(users.id, constructionProgressHistory.createdBy))
      .leftJoin(solicitante, eq(solicitante.id, constructionProgressHistory.requestedBy))
      .leftJoin(recebedor, eq(recebedor.id, constructionProgressHistory.receivedBy))
      .where(eq(constructionProgressHistory.projectId, projectId))
      .orderBy(desc(constructionProgressHistory.createdAt), desc(constructionProgressHistory.id))
      .limit(100),
  ]);
  const itens: ItemProgressoEntrada[] = mesclarComPadrao(
    salvos.map((s) => ({ chave: s.serviceKey, incidencia: s.incidencePct, execucao: s.executionPct }))
  );
  // Pedido de 18/10: valor estimado de cada medição (Y × avanço da medição).
  const base = baseDaMedicao({
    financiamento: centavosDe(obra.financedAmount),
    fgts: centavosDe(obra.fgtsAmount),
    subsidio: centavosDe(obra.subsidyAmount),
    custoTerreno: centavosDe(obra.lotCost),
  });
  const estimativas = estimarMedicoes(historico.map((h) => ({ id: h.id, progresso: Number(h.progresso), criadoEm: h.criadoEm })), base);
  return {
    itens: itens.map((i) => ({ chave: i.chave, incidencia: String(i.incidencia), execucao: String(i.execucao) })),
    calculo: calcularProgresso(itens),
    medido: salvos.length > 0,
    /** Valor antigo digitado à mão (só exibido enquanto não houver medição). */
    progressoLegado: obra.progress,
    baseMedicao: base,
    historico: historico.map((h) => ({
      ...h,
      progresso: Number(h.progresso),
      somaIncidencia: Number(h.somaIncidencia),
      situacao: situacaoDaMedicao(h),
      estimativa: estimativas.get(h.id)!,
    })),
  };
}

export const obraProgressoRouter = router({
  obter: adminProcedure.input(projectIdInput).query(({ input }) => carregarProgresso(input.projectId)),

  /** Tela de detalhes: etapas, resumo financeiro e estatísticas iguais ao editor da obra. */
  detalhe: adminProcedure.input(projectIdInput).query(async ({ input }) => {
    const [progresso, resumo, [fotos]] = await Promise.all([
      carregarProgresso(input.projectId),
      calcularResumoObra(input.projectId),
      getDb().select({ total: count() }).from(constructionPhotos).where(eq(constructionPhotos.projectId, input.projectId)),
    ]);
    return montarDetalheObra(progresso.calculo, resumo.calculo, Number(fotos?.total ?? 0));
  }),

  salvar: adminProcedure.input(z.object({
    projectId: z.number().int().positive(),
    itens: z.array(z.object({ chave: z.string().trim().min(1).max(40), incidencia: percentual4, execucao: percentual4 })).length(20),
  })).mutation(async ({ input, ctx }) => {
    await obraOuErro(input.projectId);
    const calculo = calcularProgresso(input.itens);
    if (calculo.erros.length) throw new TRPCError({ code: "BAD_REQUEST", message: calculo.erros.join(" ") });
    const db = getDb();
    const agora = new Date();
    await db.batch([
      db.delete(constructionProgressItems).where(eq(constructionProgressItems.projectId, input.projectId)),
      db.insert(constructionProgressItems).values(input.itens.map((i) => ({
        projectId: input.projectId,
        serviceKey: i.chave,
        incidencePct: i.incidencia,
        executionPct: i.execucao,
        updatedBy: ctx.user.id,
        updatedAt: agora,
      }))),
      db.update(constructionProjects).set({
        progressMeasuredPct: calculo.progresso.toFixed(6),
        progress: Math.round(calculo.progresso),
        updatedAt: agora,
      }).where(eq(constructionProjects.id, input.projectId)),
      db.insert(constructionProgressHistory).values({
        projectId: input.projectId,
        progressPct: calculo.progresso.toFixed(6),
        incidenceTotalPct: calculo.somaIncidencia.toFixed(4),
        items: input.itens,
        createdBy: ctx.user.id,
        createdAt: agora,
      }),
    ]);
    return { progresso: calculo.progresso, avisos: calculo.avisos };
  }),

  // Pedido de 18/10: ciclo da medição (solicitar ao banco, confirmar recebimento),
  // edição e exclusão. Admin, colaborador com Obras e o empreiteiro da obra.
  solicitarMedicao: adminProcedure.input(medicaoIdInput).mutation(async ({ input, ctx }) => {
    await medicaoOuErro(input.medicaoId);
    const [m] = await getDb().update(constructionProgressHistory)
      .set({ requestedAt: new Date(), requestedBy: ctx.user.id })
      .where(and(eq(constructionProgressHistory.id, input.medicaoId), isNull(constructionProgressHistory.requestedAt)))
      .returning({ id: constructionProgressHistory.id });
    if (!m) throw new TRPCError({ code: "CONFLICT", message: "Esta medição já foi solicitada." });
    return { success: true };
  }),

  confirmarRecebimento: adminProcedure.input(medicaoIdInput).mutation(async ({ input, ctx }) => {
    const atual = await medicaoOuErro(input.medicaoId);
    if (!atual.requestedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Solicite a medição antes de confirmar o recebimento." });
    const [m] = await getDb().update(constructionProgressHistory)
      .set({ receivedAt: new Date(), receivedBy: ctx.user.id })
      .where(and(eq(constructionProgressHistory.id, input.medicaoId), isNull(constructionProgressHistory.receivedAt)))
      .returning({ id: constructionProgressHistory.id });
    if (!m) throw new TRPCError({ code: "CONFLICT", message: "O recebimento desta medição já foi confirmado." });
    return { success: true };
  }),

  editarMedicao: adminProcedure.input(z.object({
    medicaoId: z.number().int().positive(),
    itens: itensMedicao,
  })).mutation(async ({ input, ctx }) => {
    const atual = await medicaoOuErro(input.medicaoId);
    const calculo = calcularProgresso(input.itens);
    if (calculo.erros.length) throw new TRPCError({ code: "BAD_REQUEST", message: calculo.erros.join(" ") });
    const db = getDb();
    const agora = new Date();
    await db.update(constructionProgressHistory).set({
      progressPct: calculo.progresso.toFixed(6),
      incidenceTotalPct: calculo.somaIncidencia.toFixed(4),
      items: input.itens,
      updatedAt: agora,
      updatedBy: ctx.user.id,
    }).where(eq(constructionProgressHistory.id, input.medicaoId));
    // A mais recente é a medição vigente: o progresso da obra acompanha.
    if (await ehUltimaMedicao(atual.projectId, input.medicaoId)) await aplicarMedicaoVigente(atual.projectId, input.itens, ctx.user.id, agora);
    return { progresso: calculo.progresso };
  }),

  excluirMedicao: adminProcedure.input(medicaoIdInput).mutation(async ({ input, ctx }) => {
    const atual = await medicaoOuErro(input.medicaoId);
    const eraUltima = await ehUltimaMedicao(atual.projectId, input.medicaoId);
    const db = getDb();
    await db.delete(constructionProgressHistory).where(eq(constructionProgressHistory.id, input.medicaoId));
    if (eraUltima) {
      // A obra volta para a medição anterior (ou fica sem medição).
      const [anterior] = await db.select({ itens: constructionProgressHistory.items }).from(constructionProgressHistory)
        .where(eq(constructionProgressHistory.projectId, atual.projectId))
        .orderBy(desc(constructionProgressHistory.createdAt), desc(constructionProgressHistory.id)).limit(1);
      await aplicarMedicaoVigente(atual.projectId, anterior?.itens ?? null, ctx.user.id, new Date());
    }
    return { success: true };
  }),

  atualizarFoto: adminProcedure.input(z.object({
    photoId: z.number().int().positive(),
    caption: z.string().trim().max(LIMITE_LEGENDA).nullable(),
    includeInReport: z.boolean(),
  })).mutation(async ({ input }) => {
    const [alterada] = await getDb().update(constructionPhotos)
      .set({ caption: input.caption || null, includeInReport: input.includeInReport })
      .where(eq(constructionPhotos.id, input.photoId))
      .returning({ id: constructionPhotos.id });
    if (!alterada) throw new TRPCError({ code: "NOT_FOUND", message: "Foto não encontrada" });
    return { success: true };
  }),

  excluirFoto: adminProcedure.input(z.object({ photoId: z.number().int().positive() })).mutation(async ({ input }) => {
    // Os bytes saem junto (ON DELETE CASCADE em construction_photo_files).
    const [apagada] = await getDb().delete(constructionPhotos)
      .where(eq(constructionPhotos.id, input.photoId))
      .returning({ id: constructionPhotos.id });
    if (!apagada) throw new TRPCError({ code: "NOT_FOUND", message: "Foto não encontrada" });
    return { success: true };
  }),

  /** Tudo o que o relatório executivo (item 29) precisa, numa leitura só. */
  relatorio: adminProcedure.input(projectIdInput).query(async ({ input }) => {
    const obra = await obraOuErro(input.projectId);
    const [crm, resumo, progresso, fotos] = await Promise.all([
      getObraDadosCrm(obra),
      calcularResumoObra(input.projectId),
      carregarProgresso(input.projectId),
      getDb().select({
        id: constructionPhotos.id,
        imageUrl: constructionPhotos.imageUrl,
        caption: constructionPhotos.caption,
        takenAt: constructionPhotos.takenAt,
        includeInReport: constructionPhotos.includeInReport,
      }).from(constructionPhotos)
        .where(eq(constructionPhotos.projectId, input.projectId))
        .orderBy(asc(constructionPhotos.takenAt), asc(constructionPhotos.id)),
    ]);
    const [contato] = obra.leadId
      ? await getDb().select({ telefone: leads.phone, email: leads.email }).from(leads).where(eq(leads.id, obra.leadId)).limit(1)
      : [];
    const notas = (obra.notes ?? "").replace(/\n__MCMV_META__:[\s\S]+$/, "");
    return {
      info: {
        titulo: obra.title,
        tipo: crm.projectType,
        cliente: crm.clientName ?? obra.mcmvClientName,
        telefoneCliente: contato?.telefone ?? null,
        emailCliente: contato?.email ?? null,
        corretor: crm.brokerName,
        endereco: [obra.address, obra.city, obra.state].filter(Boolean).join(" — ") || null,
        area: obra.totalArea,
        status: obra.status,
        escritorioCef: obra.cefBranch,
        dataInicio: obra.startDate,
        previsaoTermino: obra.estimatedEndDate,
        terminoReal: obra.actualEndDate,
        observacoes: notas.trim() || null,
      },
      resumo,
      progresso,
      fotos: fotos.filter((f) => f.includeInReport),
    };
  }),
});
