// Filtro de status das Tarefas e SLA (pedido de 11/11).
// "Atrasada" é automática: prazo vencido e tarefa não concluída/cancelada.
// Abertura padrão: só o que exige ação agora — atrasadas e as que vencem hoje
// (pendentes ou em andamento). Futuras e concluídas só aparecem pelo filtro.
// Gêmeo da regra da Agenda do Grupo Santa Fé (paridade).

export type FiltroStatusTarefa = "atrasadas_e_hoje" | "all" | "overdue" | "pending" | "in_progress" | "done";

export const OPCOES_FILTRO_TAREFA: { value: FiltroStatusTarefa; label: string }[] = [
  { value: "atrasadas_e_hoje", label: "Atrasadas e do dia" },
  { value: "overdue", label: "Atrasadas" },
  { value: "pending", label: "Pendentes" },
  { value: "in_progress", label: "Em andamento" },
  { value: "done", label: "Concluídas" },
  { value: "all", label: "Todas" },
];

type TarefaFiltro = { status: string; dueAt?: Date | string | null };

const encerrada = (t: TarefaFiltro) => t.status === "done" || t.status === "cancelled";
const diaLocal = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** Prazo vencido e tarefa ainda aberta. */
export function tarefaAtrasada(t: TarefaFiltro, agora = new Date()): boolean {
  if (!t.dueAt || encerrada(t)) return false;
  const prazo = new Date(t.dueAt);
  return !Number.isNaN(prazo.getTime()) && prazo < agora;
}

/** Aberta e com prazo hoje (ainda não vencido). */
export function tarefaDoDia(t: TarefaFiltro, agora = new Date()): boolean {
  if (!t.dueAt || encerrada(t)) return false;
  const prazo = new Date(t.dueAt);
  return !Number.isNaN(prazo.getTime()) && diaLocal(prazo) === diaLocal(agora) && prazo >= agora;
}

export function passaFiltroTarefa(t: TarefaFiltro, filtro: FiltroStatusTarefa, agora = new Date()): boolean {
  switch (filtro) {
    case "all": return true;
    case "overdue": return tarefaAtrasada(t, agora);
    case "atrasadas_e_hoje": return tarefaAtrasada(t, agora) || tarefaDoDia(t, agora);
    default: return t.status === filtro;
  }
}
