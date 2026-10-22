import { describe, expect, it } from "vitest";
import {
  agendaDay,
  selectAgendaEntries,
  type AgendaEntry,
} from "../shared/agenda-unificada";

const today = "2026-10-22";
const lead = (day: string): AgendaEntry => ({ kind: "lead", day, sortAt: day });
const task = (day: string, active = true): AgendaEntry => ({
  kind: "task",
  day,
  sortAt: day ? `${day}T10:00` : "",
  active,
});

describe("agenda unificada", () => {
  it("shows all nine cards on their selected date", () => {
    const entries = [
      ...Array.from({ length: 9 }, () => lead(today)),
      lead("2026-10-23"),
    ];
    expect(
      selectAgendaEntries(entries, "data_selecionada", today, today)
    ).toHaveLength(9);
  });
  it("lists four cards and a task, with the same source used for calendar counts", () => {
    const day = "2026-10-30";
    const entries = [
      ...Array.from({ length: 4 }, () => lead(day)),
      task(day),
      task("2026-10-29"),
    ];
    const selected = selectAgendaEntries(
      entries,
      "data_selecionada",
      day,
      today
    );
    expect(selected.map(entry => entry.kind)).toEqual([
      "lead",
      "lead",
      "lead",
      "lead",
      "task",
    ]);
  });
  it("includes appointments alongside leads/tasks and excludes inactive tasks consistently", () => {
    const entries: AgendaEntry[] = [
      lead(today),
      task(today),
      task(today, false),
      { kind: "appointment", day: today, sortAt: `${today}T09:00` },
    ];
    expect(
      selectAgendaEntries(entries, "data_selecionada", today, today).map(
        entry => entry.kind
      )
    ).toEqual(["lead", "appointment", "task"]);
  });
  it("shows all tasks including undated/completed only in the explicit task view", () => {
    const entries = [
      task(today),
      task("2026-12-01"),
      task(""),
      task(today, false),
      lead(today),
    ];
    expect(
      selectAgendaEntries(entries, "data_selecionada", today, today)
    ).toHaveLength(2);
    expect(
      selectAgendaEntries(entries, "todas_tarefas", today, today)
    ).toHaveLength(4);
    expect(
      selectAgendaEntries(entries, "data_selecionada", "2026-12-01", today)
    ).toHaveLength(1);
  });
  it("treats overdue/today/future as separate lead-only views across months", () => {
    const entries = [
      lead("2026-09-30"),
      lead(today),
      lead("2026-11-01"),
      task(today),
    ];
    expect(
      selectAgendaEntries(entries, "leads_vencidos", today, today).map(
        entry => entry.day
      )
    ).toEqual(["2026-09-30"]);
    expect(
      selectAgendaEntries(entries, "leads_do_dia", today, today).map(
        entry => entry.day
      )
    ).toEqual([today]);
    expect(
      selectAgendaEntries(entries, "leads_a_vencer", today, today).map(
        entry => entry.day
      )
    ).toEqual(["2026-11-01"]);
  });
  it("preserves date-only values and uses local date fields for timestamp values", () => {
    expect(agendaDay(today)).toBe(today);
    expect(agendaDay(new Date(2026, 9, 22, 23, 59))).toBe(today);
    expect(agendaDay(null)).toBe("");
    expect(agendaDay("invalid")).toBe("");
  });
});
