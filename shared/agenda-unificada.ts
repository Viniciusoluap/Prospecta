export type AgendaView =
  | "data_selecionada"
  | "leads_vencidos"
  | "leads_do_dia"
  | "leads_a_vencer"
  | "todas_tarefas";

export interface AgendaEntry {
  kind: "lead" | "task" | "appointment";
  day: string;
  sortAt: string;
  active?: boolean;
}

/** Date-only CRM deadlines must never shift when interpreted in another timezone. */
export function agendaDay(value: Date | string | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function selectAgendaEntries<T extends AgendaEntry>(
  entries: T[],
  view: AgendaView,
  selectedDay: string,
  today: string
): T[] {
  return entries
    .filter(entry => {
      if (view === "todas_tarefas") return entry.kind === "task";
      if (view === "data_selecionada")
        return (
          entry.day === selectedDay &&
          (entry.kind !== "task" || entry.active !== false)
        );
      if (entry.kind !== "lead" || !entry.day) return false;
      if (view === "leads_vencidos") return entry.day < today;
      if (view === "leads_do_dia") return entry.day === today;
      return entry.day > today;
    })
    .sort((a, b) => (a.sortAt || "9999").localeCompare(b.sortAt || "9999"));
}
