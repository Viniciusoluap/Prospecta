import { TRPCError } from "@trpc/server";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  constructionPhotos,
  constructionProgressHistory,
  constructionProgressItems,
  constructionProjects,
  users,
} from "../drizzle/schema.js";
import {
  calcularProgresso,
  mesclarComPadrao,
  type ItemProgressoEntrada,
} from "../shared/financeiro/progresso.js";
import { LIMITE_LEGENDA } from "../shared/obra-fotos.js";
import { adminProcedure, router } from "./_core/trpc.js";
import { getDb, getObraDadosCrm } from "./db.js";
import { calcularResumoObra } from "./obra-financeiro-router.js";

// EPIC-020 Lote 4 — Progresso por incidência (27), fotos (28) e dados do
// relatório executivo (29). O Progresso Geral nunca é digitado: é sempre a soma
// das execuções ponderadas, calculada por shared/financeiro/progresso.ts.

const percentual4 = z.string().trim().regex(/^\d{1,3}(\.\d{1,4})?$/, "Percentual inválido (até 4 casas decimais)");
const projectIdInput = z.object({ projectId: z.number().int().positive() });

async function obraOuErro(projectId: number) {
  const [obra] = await getDb().select().from(constructionProjects).where(eq(constructionProjects.id, projectId)).limit(1);
  if (!obra) throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada" });
  return obra;
}

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
    }).from(constructionProgressHistory)
      .leftJoin(users, eq(users.id, constructionProgressHistory.createdBy))
      .where(eq(constructionProgressHistory.projectId, projectId))
      .orderBy(desc(constructionProgressHistory.createdAt), desc(constructionProgressHistory.id))
      .limit(100),
  ]);
  const itens: ItemProgressoEntrada[] = mesclarComPadrao(
    salvos.map((s) => ({ chave: s.serviceKey, incidencia: s.incidencePct, execucao: s.executionPct }))
  );
  return {
    itens: itens.map((i) => ({ chave: i.chave, incidencia: String(i.incidencia), execucao: String(i.execucao) })),
    calculo: calcularProgresso(itens),
    medido: salvos.length > 0,
    /** Valor antigo digitado à mão (só exibido enquanto não houver medição). */
    progressoLegado: obra.progress,
    historico: historico.map((h) => ({ ...h, progresso: Number(h.progresso), somaIncidencia: Number(h.somaIncidencia) })),
  };
}

export const obraProgressoRouter = router({
  obter: adminProcedure.input(projectIdInput).query(({ input }) => carregarProgresso(input.projectId)),

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
    const notas = (obra.notes ?? "").replace(/\n__MCMV_META__:[\s\S]+$/, "");
    return {
      info: {
        titulo: obra.title,
        tipo: crm.projectType,
        cliente: crm.clientName ?? obra.mcmvClientName,
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
