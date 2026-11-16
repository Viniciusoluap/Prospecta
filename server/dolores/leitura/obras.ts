// EPIC-025 (Dolores, etapa 1) — obras e medições. SOMENTE LEITURA.
// Medições = o ciclo da tela de Medições (construction_progress_history: registrada → solicitada ao banco → recebida),
// mais as medições do cadastro antigo (obra_measurements). Situação da obra pelos rótulos de shared/obra-status.ts.
import { and, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  constructionProgressHistory, constructionProjects, constructionStages, leads, obraMeasurements, obraMovimentos, users,
} from "../../../drizzle/schema.js";
import { diaDoPrazo, isoFortaleza, paginar, reais, truncar } from "../../../shared/dolores/formato.js";
import { DIAS_PARADO_PADRAO, maisRecente, situacaoDoPrazo } from "../../../shared/dolores/regras.js";
import { rotuloTipoMedicao } from "../../../shared/medicao-caixa.js";
import { obraStatusLabel } from "../../../shared/obra-status.js";
import { MAX_LINHAS_LIDAS, db, idPositivo, paginacao, type Resultado } from "./comum.js";

type Ctx = { agora: Date };
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const STATUS_ENCERRADOS_OBRA = new Set(["completed", "cancelled", "distrato"]);

/** Obras com o que a análise precisa (usado também pela consulta de atrasos). */
export async function carregarObras(agora: Date, diasParado = DIAS_PARADO_PADRAO) {
  const empreiteiro = alias(users, "empreiteiro");
  const responsavelCrm = alias(users, "responsavel_crm");
  const linhas = await db().select({
    o: {
      id: constructionProjects.id, title: constructionProjects.title, city: constructionProjects.city, status: constructionProjects.status,
      progress: constructionProjects.progress, progressMeasuredPct: constructionProjects.progressMeasuredPct,
      startDate: constructionProjects.startDate, estimatedEndDate: constructionProjects.estimatedEndDate, constructionDays: constructionProjects.constructionDays,
      actualEndDate: constructionProjects.actualEndDate, contractValue: constructionProjects.contractValue, vgv: constructionProjects.vgv,
      mcmvClientName: constructionProjects.mcmvClientName, leadId: constructionProjects.leadId, notes: constructionProjects.notes,
      updatedAt: constructionProjects.updatedAt,
    },
    cliente: leads.name, empreiteiro: empreiteiro.name, responsavelCrm: responsavelCrm.name,
  }).from(constructionProjects)
    .leftJoin(leads, and(eq(leads.id, constructionProjects.leadId), isNull(leads.deletedAt))) // excluído do CRM: sem nome nem responsável
    .leftJoin(empreiteiro, eq(empreiteiro.id, constructionProjects.contractorUserId))
    .leftJoin(responsavelCrm, eq(responsavelCrm.id, leads.responsibleUserId))
    .orderBy(desc(constructionProjects.updatedAt)).limit(MAX_LINHAS_LIDAS);
  if (!linhas.length) return [];
  const ids = linhas.map(l => l.o.id);
  const [etapas, movimentos, medicoes] = await Promise.all([
    db().select({ projectId: constructionStages.projectId, name: constructionStages.name, status: constructionStages.status, orderIndex: constructionStages.orderIndex, updatedAt: constructionStages.updatedAt })
      .from(constructionStages).where(inArray(constructionStages.projectId, ids)),
    db().select({ projectId: obraMovimentos.projectId, ultima: max(obraMovimentos.createdAt) }).from(obraMovimentos)
      .where(inArray(obraMovimentos.projectId, ids)).groupBy(obraMovimentos.projectId),
    db().select({
      projectId: constructionProgressHistory.projectId, ultima: max(constructionProgressHistory.createdAt),
      solicitadas: sql<number>`count(*) filter (where ${constructionProgressHistory.requestedAt} is not null and ${constructionProgressHistory.receivedAt} is null)`.mapWith(Number),
      recebidas: sql<number>`count(*) filter (where ${constructionProgressHistory.receivedAt} is not null)`.mapWith(Number),
    }).from(constructionProgressHistory).where(inArray(constructionProgressHistory.projectId, ids)).groupBy(constructionProgressHistory.projectId),
  ]);
  const movPor = new Map(movimentos.map(m => [m.projectId, m.ultima]));
  const medPor = new Map(medicoes.map(m => [m.projectId, m]));
  return linhas.map(({ o, cliente, empreiteiro: nomeEmpreiteiro, responsavelCrm: nomeResponsavel }) => {
    const minhas = etapas.filter(e => e.projectId === o.id).sort((a, b) => a.orderIndex - b.orderIndex);
    const atual = minhas.find(e => e.status === "in_progress") ?? minhas.find(e => e.status === "pending") ?? null;
    const encerrada = STATUS_ENCERRADOS_OBRA.has(o.status);
    const previsao = o.estimatedEndDate
      ?? (o.startDate && o.constructionDays ? new Date(o.startDate.getTime() + o.constructionDays * 86_400_000) : null);
    const med = medPor.get(o.id);
    const ultimaMovimentacao = maisRecente([o.updatedAt, movPor.get(o.id), med?.ultima, ...minhas.map(e => e.updatedAt)]);
    const s = situacaoDoPrazo({ encerrado: encerrada, prazo: diaDoPrazo(previsao), ultimaMovimentacao, agora, diasParado });
    return {
      id: o.id, obra: truncar(o.title, 160), cliente: cliente ?? o.mcmvClientName ?? null, leadId: o.leadId, cidade: o.city,
      situacao: obraStatusLabel(o.status), encerrada,
      progressoPct: o.progressMeasuredPct !== null ? Math.round(Number(o.progressMeasuredPct) * 100) / 100 : o.progress,
      origemDoProgresso: o.progressMeasuredPct !== null ? "medido (PCI)" : "informado",
      etapaAtual: atual?.name ?? null, empreiteiro: nomeEmpreiteiro ?? null, responsavelNoCrm: nomeResponsavel ?? null,
      inicio: diaDoPrazo(o.startDate), previsaoDeTermino: diaDoPrazo(previsao),
      origemDaPrevisao: o.estimatedEndDate ? "previsão cadastrada" : previsao ? "início + prazo de obra (dias)" : null,
      terminoReal: diaDoPrazo(o.actualEndDate),
      atrasada: s.atrasado, diasDeAtraso: s.diasDeAtraso, ultimaMovimentacao: isoFortaleza(ultimaMovimentacao),
      diasSemMovimentacao: s.diasSemMovimentacao, parada: s.parado,
      medicoesAguardandoBanco: med?.solicitadas ?? 0, medicoesRecebidas: med?.recebidas ?? 0,
      moeda: "BRL", orcamentoPrevisto: reais(o.contractValue), vgv: reais(o.vgv),
      observacoes: truncar(o.notes, 200),
    };
  });
}

export const entradaListarObras = z.object({
  situacao: z.enum(["ativas", "atrasadas", "paradas", "todas"]).default("ativas").describe("ativas = não concluídas, canceladas ou em distrato."),
  busca: z.string().trim().min(2).max(120).optional().describe("Parte do nome da obra ou do cliente."),
  diasParado: z.number().int().min(1).max(365).default(DIAS_PARADO_PADRAO),
  ...paginacao,
}).strict();

export async function listarObras(args: z.infer<typeof entradaListarObras>, { agora }: Ctx): Promise<Resultado> {
  const todas = await carregarObras(agora, args.diasParado);
  const filtradas = todas.filter(o => {
    if (args.situacao !== "todas" && o.encerrada) return false;
    if (args.situacao === "atrasadas" && !o.atrasada) return false;
    if (args.situacao === "paradas" && !o.parada) return false;
    if (args.busca && !sem(`${o.obra ?? ""} ${o.cliente ?? ""}`).includes(sem(args.busca))) return false;
    return true;
  }).sort((a, b) => Number(b.atrasada) - Number(a.atrasada) || (b.diasDeAtraso ?? 0) - (a.diasDeAtraso ?? 0) || a.id - b.id);
  const pagina = paginar(filtradas, args.pagina, args.limite);
  const ativas = todas.filter(o => !o.encerrada);
  const totais = { obras: todas.length, ativas: ativas.length, atrasadas: ativas.filter(o => o.atrasada).length, paradas: ativas.filter(o => o.parada).length, semPrevisao: ativas.filter(o => !o.previsaoDeTermino).length };
  return {
    dados: { criterios: { atrasada: "previsão de término anterior a hoje e obra não concluída/cancelada/distrato", parada: `sem movimentação há ${args.diasParado} dias ou mais` }, totais, ...pagina },
    resumo: { encontradas: filtradas.length, devolvidas: pagina.itens.length, ...totais },
  };
}

export const entradaListarMedicoes = z.object({
  obraId: idPositivo.optional().describe("Id da obra; sem ele, todas as obras."),
  situacao: z.enum(["aguardando_banco", "recebidas", "todas"]).default("todas")
    .describe("aguardando_banco = solicitada ao banco e ainda não recebida; recebidas = paga pelo banco."),
  ...paginacao,
}).strict();

export async function listarMedicoes(args: z.infer<typeof entradaListarMedicoes>): Promise<Resultado> {
  const filtroObra = args.obraId ? eq(constructionProgressHistory.projectId, args.obraId) : undefined;
  const [ciclo, antigas] = await Promise.all([
    db().select({
      id: constructionProgressHistory.id, projectId: constructionProgressHistory.projectId, obra: constructionProjects.title,
      progressPct: constructionProgressHistory.progressPct, tipo: constructionProgressHistory.measurementType,
      createdAt: constructionProgressHistory.createdAt, requestedAt: constructionProgressHistory.requestedAt,
      requestEmailStatus: constructionProgressHistory.requestEmailStatus, receivedAt: constructionProgressHistory.receivedAt,
    }).from(constructionProgressHistory).innerJoin(constructionProjects, eq(constructionProjects.id, constructionProgressHistory.projectId))
      .where(filtroObra).orderBy(desc(constructionProgressHistory.createdAt)).limit(MAX_LINHAS_LIDAS),
    db().select({ id: obraMeasurements.id, projectId: obraMeasurements.projectId, obra: constructionProjects.title, data: obraMeasurements.measurementDate,
      valor: obraMeasurements.value, status: obraMeasurements.status })
      .from(obraMeasurements).innerJoin(constructionProjects, eq(constructionProjects.id, obraMeasurements.projectId))
      .where(args.obraId ? eq(obraMeasurements.projectId, args.obraId) : undefined).orderBy(desc(obraMeasurements.measurementDate)).limit(MAX_LINHAS_LIDAS),
  ]);
  const situacaoCiclo = (m: (typeof ciclo)[number]) => m.receivedAt ? "recebida" : m.requestedAt ? "aguardando o banco" : "registrada (não solicitada)";
  const escolhidas = ciclo.filter(m => args.situacao === "todas" || (args.situacao === "recebidas" ? !!m.receivedAt : !!m.requestedAt && !m.receivedAt));
  const pagina = paginar(escolhidas.map(m => ({
    id: m.id, obraId: m.projectId, obra: truncar(m.obra, 160), tipo: rotuloTipoMedicao(m.tipo), progressoMedidoPct: reais(m.progressPct),
    situacao: situacaoCiclo(m), registradaEm: isoFortaleza(m.createdAt), solicitadaEm: isoFortaleza(m.requestedAt),
    emailDaSolicitacao: m.requestEmailStatus, recebidaEm: isoFortaleza(m.receivedAt),
  })), args.pagina, args.limite);
  const ROTULO_ANTIGA: Record<string, string> = { pending: "pendente", approved: "aprovada", paid: "paga" };
  return {
    dados: {
      totais: { medicoes: ciclo.length, aguardandoBanco: ciclo.filter(m => m.requestedAt && !m.receivedAt).length, recebidas: ciclo.filter(m => m.receivedAt).length },
      ...pagina,
      medicoesDoCadastroAntigo: args.situacao === "todas" ? antigas.slice(0, 20).map(m => ({ id: m.id, obraId: m.projectId, obra: truncar(m.obra, 160), data: diaDoPrazo(m.data), moeda: "BRL", valor: reais(m.valor), situacao: ROTULO_ANTIGA[m.status] ?? m.status })) : [],
    },
    resumo: { encontradas: escolhidas.length, devolvidas: pagina.itens.length, antigas: antigas.length },
  };
}
