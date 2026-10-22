import { incidenciaPciParaTexto } from "../shared/pci-upload.js";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
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
  datasAlvaraDasMedicoes,
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

import { invalidarAnexosMedicao } from "./medicao-email-estado.js";
import { solicitarComAnexos, DESTINO_MEDICOES } from "./medicao-solicitacao.js";
import { sendEmail, adminNotificationTemplate } from "./_core/email-smtp.js";

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

/**
 * Lê o histórico depois de adquirir a trava; nunca restaura um predecessor lido antes da transação.
 * `condicao` (avaliada dentro do batch): só reaplica quando a medição vigente mudou — editar ou
 * excluir uma medição antiga não pode desfazer incidências vinculadas depois (igual ao Santa Fé).
 */
function sincronizarMedicaoVigente(projectId: number, userId: number, condicao: SQL = sql`TRUE`) {
  const db = getDb();
  return [
    db.execute(sql`DELETE FROM construction_progress_items WHERE project_id = ${projectId} AND (${condicao})`),
    db.execute(sql`INSERT INTO construction_progress_items(project_id, service_key, incidence_pct, execution_pct, updated_by, updated_at)
      SELECT ${projectId}, item->>'chave', (item->>'incidencia')::numeric, (item->>'execucao')::numeric, ${userId}, now()
      FROM (SELECT items FROM construction_progress_history WHERE project_id = ${projectId} ORDER BY created_at DESC, id DESC LIMIT 1) h,
      LATERAL jsonb_array_elements(h.items) item WHERE (${condicao})`),
    db.execute(sql`UPDATE construction_projects SET
      progress_measured_pct = (SELECT progress_pct FROM construction_progress_history WHERE project_id = ${projectId} ORDER BY created_at DESC, id DESC LIMIT 1),
      progress = COALESCE((SELECT round(progress_pct)::integer FROM construction_progress_history WHERE project_id = ${projectId} ORDER BY created_at DESC, id DESC LIMIT 1), 0), updated_at = now()
      WHERE id = ${projectId} AND (${condicao})`),
  ] as const;
}
/** A medição editada é a mais recente da obra (avaliado depois da trava). */
const ehVigente = (projectId: number, medicaoId: number) =>
  sql`(SELECT id FROM construction_progress_history WHERE project_id = ${projectId} ORDER BY created_at DESC, id DESC LIMIT 1) = ${medicaoId}`;
/** Nenhuma medição restante é posterior à excluída, isto é, a excluída era a vigente. */
const eraVigente = (projectId: number, criadaEm: string, medicaoId: number) =>
  sql`NOT EXISTS (SELECT 1 FROM construction_progress_history WHERE project_id = ${projectId} AND (created_at, id) > (${criadaEm}::timestamp, ${medicaoId}))`;
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
      emailStatus: constructionProgressHistory.requestEmailStatus,
      emailTentativaEm: constructionProgressHistory.requestEmailAttemptAt,
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
  const [fotosMedicao, [pci], fotosLegadas, datasSalvas] = await Promise.all([
    ids.length
      ? db.select({ id: constructionPhotos.id, medicaoId: constructionPhotos.progressHistoryId, imageUrl: constructionPhotos.imageUrl, caption: constructionPhotos.caption, includeInReport: constructionPhotos.includeInReport })
          .from(constructionPhotos).where(inArray(constructionPhotos.progressHistoryId, ids)).orderBy(asc(constructionPhotos.id))
      : Promise.resolve([]),
    db.select({
      fileName: constructionPci.fileName,
      uploadedAt: constructionPci.uploadedAt,
      linkedAt: constructionPci.linkedAt,
      parsed: constructionPci.parsed,
    }).from(constructionPci).where(eq(constructionPci.projectId, projectId)).limit(1),
    db.select({ id: constructionPhotos.id, imageUrl: constructionPhotos.imageUrl, caption: constructionPhotos.caption, includeInReport: constructionPhotos.includeInReport }).from(constructionPhotos).where(and(eq(constructionPhotos.projectId, projectId), isNull(constructionPhotos.progressHistoryId))),
    // A lista visível limita 100 medições; a data preenchida uma vez deve
    // continuar disponível mesmo quando a primeira PLS sair dessa janela.
    db.select({ dadosCaixa: constructionProgressHistory.caixaData })
      .from(constructionProgressHistory)
      .where(and(eq(constructionProgressHistory.projectId, projectId), eq(constructionProgressHistory.measurementType, "pls")))
      .orderBy(desc(constructionProgressHistory.createdAt), desc(constructionProgressHistory.id)),
  ]);
  const dadosPci = (pci?.parsed ?? null) as DadosPci | null;
  const datasAlvara = datasAlvaraDasMedicoes(
    datasSalvas.map(m => ({ pls: (m.dadosCaixa as DadosMedicaoCaixa | null)?.pls })),
    { alvaraEmissao: dadosPci?.alvaraEmissao, alvaraVigencia: dadosPci?.alvaraVigencia },
  );
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
    fotosLegadas,
    historico: historico.map((h) => ({
      ...h,
      emailPodeReenviar: ["failed", "pending"].includes(h.emailStatus ?? "") || (h.emailStatus === "sending" && !!h.emailTentativaEm && Date.now() - h.emailTentativaEm.getTime() > 120_000),
      itens: h.itens.map((i) => ({ ...i, incidencia: normalizarPercentual(i.incidencia) })),
      progresso: Number(h.progresso),
      somaIncidencia: Number(h.somaIncidencia),
      situacao: situacaoDaMedicao(h),
      estimativa: estimativas.get(h.id)!,
      tipo: (ehTipoMedicao(h.tipo) ? h.tipo : "pls") as TipoMedicao,
      dadosCaixa: (h.dadosCaixa ?? null) as DadosMedicaoCaixa | null,
      fotos: fotosMedicao.filter((f) => f.medicaoId === h.id).map(({ id, imageUrl, caption, includeInReport }) => ({ id, imageUrl, caption, includeInReport })),
    })),
    pci: pci && dadosPci
      ? {
          arquivo: pci.fileName,
          enviadaEm: pci.uploadedAt,
          vinculadaEm: pci.linkedAt,
          formato: dadosPci.formato,
          incidencias: dadosPci.incidencias.map((v) => incidenciaPciParaTexto(v)),
          proponente: dadosPci.identificacao?.proponente ?? "",
          contrato: dadosPci.contrato,
          prazoMeses: dadosPci.prazoMeses,
          dataContratacao: dadosPci.dataContratacao,
        }
      : null,
    /** Datas do último preenchimento salvo na obra; PCI como reserva por campo. */
    plsPadrao: dadosPlsPadrao({
      ...datasAlvara,
      seloCasaAzul: dadosPci?.seloCasaAzul ?? false,
    }),
  };
}

export const obraProgressoRouter = router({
  galeria: adminProcedure.input(projectIdInput).query(async ({ input }) => {
    const [fotos, medicoes] = await Promise.all([
      getDb().select({ id: constructionPhotos.id, medicaoId: constructionPhotos.progressHistoryId, url: constructionPhotos.imageUrl, legenda: constructionPhotos.caption })
        .from(constructionPhotos).where(eq(constructionPhotos.projectId, input.projectId)).orderBy(asc(constructionPhotos.id)),
      getDb().select({ id: constructionProgressHistory.id, progresso: constructionProgressHistory.progressPct, criadoEm: constructionProgressHistory.createdAt })
        .from(constructionProgressHistory).where(eq(constructionProgressHistory.projectId, input.projectId)),
    ]);
    return { fotos, medicoes: medicoes.map(m => ({ ...m, progresso: Number(m.progresso) })) };
  }),

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
    const atual = await medicaoOuErro(input.medicaoId);
    const obra = await obraOuErro(atual.projectId);
    const db = getDb();
    let tentativa = new Date();
    const titulo = `Solicitação de medição — ${obra.title || `Obra ${obra.id}`}`.slice(0, 255);
    const mensagem = `${atual.measurementType.toUpperCase()} · ${Number(atual.progressPct).toLocaleString("pt-BR")}% acumulado · ${ctx.user.name || "Usuário"}. Destino do PDF e XLS: ${DESTINO_MEDICOES}. Consulte o estado do envio na medição.`;
    try {
      const resultado = await solicitarComAnexos({
        gerar: async formato => {
          const { gerarArquivoMedicao } = await import("./routes/obra-medicao-caixa.js");
          return gerarArquivoMedicao(atual, obra.title, formato);
        },
        reservar: async () => {
          tentativa = new Date();
          const [reserva] = await db.batch([
            db.update(constructionProgressHistory).set({
              requestedAt: sql`COALESCE(${constructionProgressHistory.requestedAt}, ${tentativa})`,
              requestedBy: sql`COALESCE(${constructionProgressHistory.requestedBy}, ${ctx.user.id})`,
              requestEmailStatus: "sending", requestEmailAttemptAt: tentativa,
            }).where(and(eq(constructionProgressHistory.id, atual.id), sql`${constructionProgressHistory.updatedAt} IS NOT DISTINCT FROM ${atual.updatedAt?.toISOString() ?? null}`, sql`(${constructionProgressHistory.requestedAt} IS NULL OR ${constructionProgressHistory.requestEmailStatus} IN ('failed', 'pending') OR (${constructionProgressHistory.requestEmailStatus} = 'sending' AND ${constructionProgressHistory.requestEmailAttemptAt} < ${new Date(tentativa.getTime() - 120_000)}))`)).returning({ id: constructionProgressHistory.id }),
            db.execute(sql`INSERT INTO user_notifications(user_id, title, message, type, related_id, action_url)
              SELECT u.id, ${titulo}, ${mensagem}, 'construction_update', ${atual.id}, ${`/admin/obras/editar/${obra.id}`}
              FROM users u WHERE u.role = 'admin' AND u.active = true
              AND EXISTS(SELECT 1 FROM construction_progress_history h WHERE h.id = ${atual.id} AND h.request_email_attempt_at = ${tentativa})
              AND NOT EXISTS(SELECT 1 FROM user_notifications n WHERE n.user_id = u.id AND n.related_id = ${atual.id} AND n.type = 'construction_update' AND n.title LIKE 'Solicitação de medição — %')`),
            db.execute(sql`UPDATE user_notifications SET is_read = false, read_at = NULL, message = ${`Versão atualizada. ${mensagem}`}
              WHERE related_id = ${atual.id} AND type = 'construction_update' AND title LIKE 'Solicitação de medição — %'
              AND user_id IN (SELECT id FROM users WHERE role = 'admin' AND active = true)
              AND ${atual.requestEmailStatus === "pending"}
              AND EXISTS(SELECT 1 FROM construction_progress_history h WHERE h.id = ${atual.id} AND h.request_email_attempt_at = ${tentativa})`),
          ]);
          return reserva.length > 0;
        },
        enviar: attachments => sendEmail({ to: DESTINO_MEDICOES, templateType: "admin_notification", attachments,
          ...adminNotificationTemplate({ titulo, linhas: [{ label: "Obra", valor: obra.title || String(obra.id) }, { label: "Tipo", valor: atual.measurementType }, { label: "Progresso acumulado", valor: `${Number(atual.progressPct)}%` }, { label: "Solicitante", valor: ctx.user.name || "Usuário" }] }) }),
        concluir: async enviado => { await db.update(constructionProgressHistory).set({ requestEmailStatus: enviado ? "sent" : "failed" })
          .where(and(eq(constructionProgressHistory.id, atual.id), eq(constructionProgressHistory.requestEmailAttemptAt, tentativa), eq(constructionProgressHistory.requestEmailStatus, "sending"))); },
      });
      return { success: true, ...resultado };
    } catch (e) { throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Erro ao solicitar medição." }); }
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
      requestEmailStatus: sql`CASE WHEN ${constructionProgressHistory.requestedAt} IS NOT NULL THEN 'pending' ELSE ${constructionProgressHistory.requestEmailStatus} END`,
      updatedAt: agora,
      updatedBy: ctx.user.id,
      measurementType: tipo,
      ...(dadosCaixa !== undefined ? { caixaData: dadosCaixa } : {}),
    }).where(eq(constructionProgressHistory.id, input.medicaoId));
    await db.batch([travarObra(atual.projectId), atualizarHistorico, ...sincronizarMedicaoVigente(atual.projectId, ctx.user.id, ehVigente(atual.projectId, input.medicaoId))]);
    return { progresso: calculo.progresso };
  }),

  excluirMedicao: adminProcedure.input(medicaoIdInput).mutation(async ({ input, ctx }) => {
    const atual = await medicaoOuErro(input.medicaoId);
    const db = getDb();
    // Data com microssegundos, como está no banco (o Date do JS perde a precisão).
    const r = await db.execute(sql`SELECT created_at::text AS criada FROM construction_progress_history WHERE id = ${input.medicaoId}`);
    const criadaEm = (r as unknown as { rows: { criada: string }[] }).rows[0]?.criada;
    if (!criadaEm) throw new TRPCError({ code: "NOT_FOUND", message: "Medição não encontrada" });
    await db.batch([
      travarObra(atual.projectId),
      db.delete(constructionProgressHistory).where(eq(constructionProgressHistory.id, input.medicaoId)),
      ...sincronizarMedicaoVigente(atual.projectId, ctx.user.id, eraVigente(atual.projectId, criadaEm, input.medicaoId)),
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
      incidencia: incidenciaPciParaTexto(dados.incidencias[k] ?? 0),
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
    const db = getDb();
    const [foto] = await db.select().from(constructionPhotos).where(eq(constructionPhotos.id, input.photoId)).limit(1);
    if (!foto) throw new TRPCError({ code: "NOT_FOUND", message: "Foto não encontrada" });
    await db.batch([
      db.update(constructionPhotos).set({ caption: input.caption || null, includeInReport: input.includeInReport }).where(eq(constructionPhotos.id, input.photoId)),
      ...(foto.progressHistoryId ? [invalidarAnexosMedicao(foto.progressHistoryId)] : []),
    ]);
    return { success: true };
  }),

  excluirFoto: adminProcedure.input(z.object({ photoId: z.number().int().positive() })).mutation(async ({ input }) => {
    const db = getDb();
    const [foto] = await db.select().from(constructionPhotos).where(eq(constructionPhotos.id, input.photoId)).limit(1);
    if (!foto) throw new TRPCError({ code: "NOT_FOUND", message: "Foto não encontrada" });
    await db.batch([
      db.delete(constructionPhotos).where(eq(constructionPhotos.id, input.photoId)),
      ...(foto.progressHistoryId ? [invalidarAnexosMedicao(foto.progressHistoryId)] : []),
    ]);
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
