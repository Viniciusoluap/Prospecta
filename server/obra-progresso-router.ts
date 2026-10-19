import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  constructionPci,
  constructionPciVersions,
  constructionPhotos,
  constructionProgressHistory,
  constructionProgressItems,
  constructionProjects,
  leads,
  users,
} from "../drizzle/schema.js";
import {
  calcularProgresso,
  SERVICOS_PROGRESSO,
  mesclarComPadrao,
  type ItemProgressoEntrada,
} from "../shared/financeiro/progresso.js";
import { LIMITE_LEGENDA } from "../shared/obra-fotos.js";
import { montarDetalheObra } from "../shared/financeiro/detalhe-obra.js";
import { baseDaMedicao, estimarMedicoes, situacaoDaMedicao } from "../shared/financeiro/medicoes.js";
import { centavosDe } from "../shared/financeiro/obra.js";
import {
  dadosPlsPadrao,
  incidenciasCorrespondem,
  ehTipoMedicao,
  normalizarDadosMedicao,
  validarDadosMedicao,
  type DadosMedicaoCaixa,
  type TipoMedicao,
} from "../shared/medicao-caixa.js";
import type { DadosPci } from "./caixa/pci.js";
import { adminProcedure, router } from "./_core/trpc.js";
import { getDb, getObraDadosCrm } from "./db.js";
import { calcularResumoObra } from "./obra-financeiro-router.js";

// EPIC-020 Lote 4 — Progresso por incidência (27), fotos (28) e dados do
// relatório executivo (29). O Progresso Geral nunca é digitado: é sempre a soma
// das execuções ponderadas, calculada por shared/financeiro/progresso.ts.

const percentual4 = z.string().trim().regex(/^\d{1,3}(\.\d{1,4})?$/, "Percentual inválido (até 4 casas decimais)");
// Pedido de 18/10: a incidência vinculada da PCI chega com até 15 casas.
const percentualIncidencia = z.string().trim().regex(/^\d{1,3}(\.\d{1,15})?$/, "Incidência inválida");
const projectIdInput = z.object({ projectId: z.number().int().positive() });
const medicaoIdInput = z.object({ medicaoId: z.number().int().positive() });
const itensMedicao = z.array(z.object({ chave: z.string().trim().min(1).max(40), incidencia: percentualIncidencia, execucao: percentual4 })).length(20);
const tipoMedicao = z.enum(["pls", "repactuacao", "alteracao"]);

/** "3.100001699200050" (numeric do banco) → "3.10000169920005". */
export function normalizarPercentual(v: string | number): string {
  const t = String(v);
  return t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t;
}

/** Tipo + campos da CAIXA validados (ou erro 400). */
function dadosCaixaValidados(tipo: TipoMedicao, entrada: unknown): DadosMedicaoCaixa {
  const dados = normalizarDadosMedicao(tipo, entrada);
  const erros = validarDadosMedicao(tipo, dados);
  if (erros.length) throw new TRPCError({ code: "BAD_REQUEST", message: erros.join(" ") });
  return dados;
}

async function medicaoOuErro(medicaoId: number) {
  const [m] = await getDb().select().from(constructionProgressHistory).where(eq(constructionProgressHistory.id, medicaoId)).limit(1);
  if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Medição não encontrada" });
  return m;
}

/** Lê o histórico depois de adquirir a trava; nunca restaura um predecessor lido antes da transação. */
function sincronizarMedicaoVigente(projectId: number, userId: number) {
  const db = getDb();
  return [
    db.execute(sql`DELETE FROM construction_progress_items WHERE project_id = ${projectId}`),
    db.execute(sql`INSERT INTO construction_progress_items(project_id, service_key, incidence_pct, execution_pct, updated_by, updated_at)
      SELECT ${projectId}, item->>'chave', (item->>'incidencia')::numeric, (item->>'execucao')::numeric, ${userId}, now()
      FROM (SELECT items FROM construction_progress_history WHERE project_id = ${projectId} ORDER BY created_at DESC, id DESC LIMIT 1) h,
      LATERAL jsonb_array_elements(h.items) item`),
    db.execute(sql`UPDATE construction_projects SET
      progress_measured_pct = (SELECT progress_pct FROM construction_progress_history WHERE project_id = ${projectId} ORDER BY created_at DESC, id DESC LIMIT 1),
      progress = COALESCE((SELECT round(progress_pct)::integer FROM construction_progress_history WHERE project_id = ${projectId} ORDER BY created_at DESC, id DESC LIMIT 1), 0), updated_at = now()
      WHERE id = ${projectId}`),
  ] as const;
}
const travarObra = (id: number) => getDb().execute(sql`SELECT id FROM construction_projects WHERE id = ${id} FOR UPDATE`);
async function versaoPciParaMedicao(projectId: number, itens: { chave: string; incidencia: string }[], versionId?: number | null) {
  const db = getDb();
  if (versionId) {
    const [v] = await db.select().from(constructionPciVersions).where(eq(constructionPciVersions.id, versionId)).limit(1);
    if (!v || v.projectId !== projectId || !incidenciasCorrespondem(itens, SERVICOS_PROGRESSO.map(s => s.chave), (v.parsed as DadosPci).incidencias)) throw new TRPCError({ code: "BAD_REQUEST", message: "As incidências devem corresponder à PCI desta medição." });
    return versionId;
  }
  const [pci] = await db.select().from(constructionPci).where(eq(constructionPci.projectId, projectId)).limit(1);
  if (!pci) return null;
  if (!pci.linkedAt || !pci.versionId || !incidenciasCorrespondem(itens, SERVICOS_PROGRESSO.map(s => s.chave), (pci.parsed as DadosPci).incidencias)) throw new TRPCError({ code: "BAD_REQUEST", message: "Vincule a PCI e use as incidências da planilha antes de salvar." });
  return pci.versionId;
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
  const [salvos, janelaHistorico] = await Promise.all([
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
      tipo: constructionProgressHistory.measurementType,
      dadosCaixa: constructionProgressHistory.caixaData,
    }).from(constructionProgressHistory)
      .leftJoin(users, eq(users.id, constructionProgressHistory.createdBy))
      .leftJoin(solicitante, eq(solicitante.id, constructionProgressHistory.requestedBy))
      .leftJoin(recebedor, eq(recebedor.id, constructionProgressHistory.receivedBy))
      .where(eq(constructionProgressHistory.projectId, projectId))
      .orderBy(desc(constructionProgressHistory.createdAt), desc(constructionProgressHistory.id))
      .limit(101),
  ]);
  // O 101º registro serve de predecessor ao último exibido, sem inflar seu avanço.
  const historico = janelaHistorico.slice(0, 100);
  const itens: ItemProgressoEntrada[] = mesclarComPadrao(
    salvos.map((s) => ({ chave: s.serviceKey, incidencia: normalizarPercentual(s.incidencePct), execucao: normalizarPercentual(s.executionPct) }))
  );
  // Pedido de 18/10: fotos de cada medição e a PCI da CAIXA vinculada à obra.
  const ids = historico.map((h) => h.id);
  const [fotosMedicao, [pci]] = await Promise.all([
    ids.length
      ? db.select({ id: constructionPhotos.id, medicaoId: constructionPhotos.progressHistoryId, imageUrl: constructionPhotos.imageUrl, caption: constructionPhotos.caption })
          .from(constructionPhotos).where(inArray(constructionPhotos.progressHistoryId, ids)).orderBy(asc(constructionPhotos.id))
      : Promise.resolve([]),
    db.select({
      fileName: constructionPci.fileName,
      uploadedAt: constructionPci.uploadedAt,
      linkedAt: constructionPci.linkedAt,
      parsed: constructionPci.parsed,
    }).from(constructionPci).where(eq(constructionPci.projectId, projectId)).limit(1),
  ]);
  const dadosPci = (pci?.parsed ?? null) as DadosPci | null;
  // Pedido de 18/10: valor estimado de cada medição (Y × avanço da medição).
  const base = baseDaMedicao({
    financiamento: centavosDe(obra.financedAmount),
    fgts: centavosDe(obra.fgtsAmount),
    subsidio: centavosDe(obra.subsidyAmount),
    custoTerreno: centavosDe(obra.lotCost),
  });
  const estimativas = estimarMedicoes(janelaHistorico.map((h) => ({ id: h.id, progresso: Number(h.progresso), criadoEm: h.criadoEm })), base);
  return {
    itens: itens.map((i) => ({ chave: i.chave, incidencia: String(i.incidencia), execucao: String(i.execucao) })),
    calculo: calcularProgresso(itens),
    medido: salvos.length > 0,
    /** Valor antigo digitado à mão (só exibido enquanto não houver medição). */
    progressoLegado: obra.progress,
    baseMedicao: base,
    historico: historico.map((h) => ({
      ...h,
      itens: h.itens.map((i) => ({ ...i, incidencia: normalizarPercentual(i.incidencia) })),
      progresso: Number(h.progresso),
      somaIncidencia: Number(h.somaIncidencia),
      situacao: situacaoDaMedicao(h),
      estimativa: estimativas.get(h.id)!,
      tipo: (ehTipoMedicao(h.tipo) ? h.tipo : "pls") as TipoMedicao,
      dadosCaixa: (h.dadosCaixa ?? null) as DadosMedicaoCaixa | null,
      fotos: fotosMedicao.filter((f) => f.medicaoId === h.id).map(({ id, imageUrl, caption }) => ({ id, imageUrl, caption })),
    })),
    pci: pci && dadosPci
      ? {
          arquivo: pci.fileName,
          enviadaEm: pci.uploadedAt,
          vinculadaEm: pci.linkedAt,
          formato: dadosPci.formato,
          incidencias: dadosPci.incidencias.map((v) => normalizarPercentual(String(v))),
          proponente: dadosPci.identificacao?.proponente ?? "",
          contrato: dadosPci.contrato,
          prazoMeses: dadosPci.prazoMeses,
          dataContratacao: dadosPci.dataContratacao,
        }
      : null,
    /** Valores iniciais dos campos da PLS (alvará e Selo Casa Azul vêm da PCI). */
    plsPadrao: dadosPlsPadrao({
      alvaraEmissao: dadosPci?.alvaraEmissao ?? null,
      alvaraVigencia: dadosPci?.alvaraVigencia ?? null,
      seloCasaAzul: dadosPci?.seloCasaAzul ?? false,
    }),
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
    itens: itensMedicao,
    tipo: tipoMedicao.default("pls"),
    dadosCaixa: z.unknown().optional(),
  })).mutation(async ({ input, ctx }) => {
    await obraOuErro(input.projectId);
    const calculo = calcularProgresso(input.itens);
    if (calculo.erros.length) throw new TRPCError({ code: "BAD_REQUEST", message: calculo.erros.join(" ") });
    const dadosCaixa = input.dadosCaixa === undefined ? null : dadosCaixaValidados(input.tipo, input.dadosCaixa);
    const db = getDb();
    const agora = new Date();
    const pciVersionId = await versaoPciParaMedicao(input.projectId, input.itens);
    const resultado = await db.batch([
      travarObra(input.projectId),
      db.insert(constructionProgressHistory).values({
        projectId: input.projectId,
        progressPct: calculo.progresso.toFixed(6),
        incidenceTotalPct: calculo.somaIncidencia.toFixed(15),
        items: input.itens,
        createdBy: ctx.user.id,
        createdAt: sql`clock_timestamp()`,
        pciVersionId,
        measurementType: input.tipo,
        caixaData: dadosCaixa,
      }).returning({ id: constructionProgressHistory.id }),
      ...sincronizarMedicaoVigente(input.projectId, ctx.user.id),
    ]);
    return { progresso: calculo.progresso, avisos: calculo.avisos, medicaoId: resultado[1][0].id };
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
    tipo: tipoMedicao.optional(),
    dadosCaixa: z.unknown().optional(),
  })).mutation(async ({ input, ctx }) => {
    const atual = await medicaoOuErro(input.medicaoId);
    const calculo = calcularProgresso(input.itens);
    if (calculo.erros.length) throw new TRPCError({ code: "BAD_REQUEST", message: calculo.erros.join(" ") });
    const tipo = input.tipo ?? (ehTipoMedicao(atual.measurementType) ? atual.measurementType : "pls");
    const dadosCaixa = input.dadosCaixa === undefined ? undefined : dadosCaixaValidados(tipo, input.dadosCaixa);
    const db = getDb();
    const agora = new Date();
    const pciVersionId = await versaoPciParaMedicao(atual.projectId, input.itens, atual.pciVersionId);
    const atualizarHistorico = db.update(constructionProgressHistory).set({
      pciVersionId,
      progressPct: calculo.progresso.toFixed(6),
      incidenceTotalPct: calculo.somaIncidencia.toFixed(15),
      items: input.itens,
      updatedAt: agora,
      updatedBy: ctx.user.id,
      measurementType: tipo,
      ...(dadosCaixa !== undefined ? { caixaData: dadosCaixa } : {}),
    }).where(eq(constructionProgressHistory.id, input.medicaoId));
    await db.batch([travarObra(atual.projectId), atualizarHistorico, ...sincronizarMedicaoVigente(atual.projectId, ctx.user.id)]);
    return { progresso: calculo.progresso };
  }),

  excluirMedicao: adminProcedure.input(medicaoIdInput).mutation(async ({ input, ctx }) => {
    const atual = await medicaoOuErro(input.medicaoId);
    const db = getDb();
    await db.batch([
      travarObra(atual.projectId),
      db.delete(constructionProgressHistory).where(eq(constructionProgressHistory.id, input.medicaoId)),
      ...sincronizarMedicaoVigente(atual.projectId, ctx.user.id),
    ]);
    return { success: true };
  }),

  // Pedido de 18/10: as incidências passam a ser exatamente as da PCI enviada
  // (1ª aba, coluna Incidência). A Execução do Item de cada serviço é mantida.
  vincularPci: adminProcedure.input(projectIdInput).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const [pci] = await db.select({ parsed: constructionPci.parsed }).from(constructionPci)
      .where(eq(constructionPci.projectId, input.projectId)).limit(1);
    if (!pci) throw new TRPCError({ code: "BAD_REQUEST", message: "Envie a PCI da obra antes de vincular." });
    const dados = pci.parsed as DadosPci;
    const salvos = await db.select().from(constructionProgressItems).where(eq(constructionProgressItems.projectId, input.projectId));
    const atuais = mesclarComPadrao(salvos.map((s) => ({ chave: s.serviceKey, incidencia: normalizarPercentual(s.incidencePct), execucao: normalizarPercentual(s.executionPct) })));
    const itens = atuais.map((i, k) => ({
      chave: i.chave,
      incidencia: normalizarPercentual(String(dados.incidencias[k] ?? 0)),
      execucao: String(i.execucao ?? "0"),
    }));
    const calculo = calcularProgresso(itens);
    if (calculo.erros.length) throw new TRPCError({ code: "BAD_REQUEST", message: calculo.erros.join(" ") });
    const agora = new Date();
    await db.batch([
      travarObra(input.projectId),
      db.delete(constructionProgressItems).where(eq(constructionProgressItems.projectId, input.projectId)),
      db.insert(constructionProgressItems).values(itens.map((i) => ({
        projectId: input.projectId, serviceKey: i.chave, incidencePct: i.incidencia, executionPct: i.execucao, updatedBy: ctx.user.id, updatedAt: agora,
      }))),
      db.update(constructionPci).set({ linkedAt: agora, linkedBy: ctx.user.id }).where(eq(constructionPci.projectId, input.projectId)),

    ] as never);
    return { somaIncidencia: calculo.somaIncidencia, itens };
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
