// EPIC-025 (Dolores, etapa 1) — tarefas abertas e atrasadas por responsável. SOMENTE LEITURA.
// "Atrasada" = `tarefaAtrasada` (shared/tarefas-filtro.ts), a mesma regra da tela de Tarefas.
import { and, desc, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { leads, tasks } from "../../../drizzle/schema.js";
import { diaFortaleza, isoFortaleza, paginar, truncar } from "../../../shared/dolores/formato.js";
import { responsavelDaTarefa } from "../../../shared/dolores/regras.js";
import { tarefaAtrasada } from "../../../shared/tarefas-filtro.js";
import { MAX_LINHAS_LIDAS, PRIORIDADE, SITUACAO_TAREFA, db, paginacao, tarefaAberta, type Resultado } from "./comum.js";

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const VINCULO: Record<string, string> = { lead: "cliente", obra: "obra", budget: "orçamento", financial: "financeiro", general: "geral" };

export const entradaListarTarefas = z.object({
  situacao: z.enum(["abertas", "atrasadas", "concluidas", "todas"]).default("abertas").describe("abertas = pendentes ou em andamento."),
  responsavel: z.string().trim().min(1).max(100).optional().describe("Parte do nome do responsável."),
  ...paginacao,
}).strict();

export async function listarTarefas(args: z.infer<typeof entradaListarTarefas>, { agora }: { agora: Date }): Promise<Resultado> {
  const campos = {
    id: tasks.id, title: tasks.title, status: tasks.status, priority: tasks.priority, assignedTo: tasks.assignedTo, dueAt: tasks.dueAt,
    relatedType: tasks.relatedType, relatedId: tasks.relatedId, completedAt: tasks.completedAt, createdAt: tasks.createdAt,
  };
  // Abertas sempre (totais por responsável); encerradas só quando pedidas, das mais recentes.
  const [abertasLidas, encerradas] = await Promise.all([
    db().select(campos).from(tasks).where(inArray(tasks.status, ["pending", "in_progress"])).orderBy(desc(tasks.createdAt)).limit(MAX_LINHAS_LIDAS),
    args.situacao === "concluidas" || args.situacao === "todas"
      ? db().select(campos).from(tasks).where(inArray(tasks.status, ["done", "cancelled"])).orderBy(desc(tasks.createdAt)).limit(MAX_LINHAS_LIDAS)
      : Promise.resolve([]),
  ]);
  const linhas = [...abertasLidas, ...encerradas];
  const leadIds = Array.from(new Set(linhas.filter(t => t.relatedType === "lead" && t.relatedId).map(t => t.relatedId!)));
  const nomes = leadIds.length ? new Map((await db().select({ id: leads.id, name: leads.name }).from(leads).where(and(inArray(leads.id, leadIds), isNull(leads.deletedAt)))).map(l => [l.id, l.name])) : new Map<number, string>();

  const todas = linhas.map(t => ({ ...t, responsavel: responsavelDaTarefa(t.assignedTo), atrasada: tarefaAtrasada(t, agora), aberta: tarefaAberta(t.status) }));
  const filtradas = todas.filter(t => {
    if (args.situacao === "abertas" && !t.aberta) return false;
    if (args.situacao === "atrasadas" && !t.atrasada) return false;
    if (args.situacao === "concluidas" && t.status !== "done") return false;
    if (args.responsavel && !sem(t.responsavel).includes(sem(args.responsavel))) return false;
    return true;
  }).sort((a, b) => Number(b.atrasada) - Number(a.atrasada)
    || (a.dueAt ? a.dueAt.getTime() : Infinity) - (b.dueAt ? b.dueAt.getTime() : Infinity) || a.id - b.id);

  const porResponsavel = new Map<string, { abertas: number; atrasadas: number }>();
  for (const t of todas.filter(x => x.aberta)) {
    const r = porResponsavel.get(t.responsavel) ?? { abertas: 0, atrasadas: 0 };
    r.abertas++; if (t.atrasada) r.atrasadas++;
    porResponsavel.set(t.responsavel, r);
  }
  const pagina = paginar(filtradas.map(t => ({
    id: t.id, tarefa: truncar(t.title, 160), situacao: SITUACAO_TAREFA[t.status] ?? t.status, prioridade: PRIORIDADE[t.priority] ?? t.priority,
    responsavel: t.responsavel, prazo: isoFortaleza(t.dueAt), diaDoPrazo: diaFortaleza(t.dueAt), atrasada: t.atrasada,
    vinculo: t.relatedType ? VINCULO[t.relatedType] ?? t.relatedType : null,
    // cliente excluído do CRM: a tarefa fica, sem o nome nem o id dele
    cliente: t.relatedType === "lead" && t.relatedId ? nomes.get(t.relatedId) ?? null : null,
    leadId: t.relatedType === "lead" && t.relatedId && nomes.has(t.relatedId) ? t.relatedId : null,
    clienteExcluidoDoCrm: t.relatedType === "lead" && !!t.relatedId && !nomes.has(t.relatedId),
    concluidaEm: isoFortaleza(t.completedAt),
  })), args.pagina, args.limite);
  const totais = { abertas: todas.filter(t => t.aberta).length, atrasadas: todas.filter(t => t.atrasada).length, semPrazo: todas.filter(t => t.aberta && !t.dueAt).length };
  return {
    dados: {
      criterio: "atrasada = pendente ou em andamento com prazo anterior a agora (regra da tela de Tarefas)",
      totais, porResponsavel: Array.from(porResponsavel, ([responsavel, r]) => ({ responsavel, ...r })).sort((a, b) => b.atrasadas - a.atrasadas || b.abertas - a.abertas),
      ...pagina,
    },
    resumo: { encontradas: filtradas.length, devolvidas: pagina.itens.length, ...totais },
  };
}
