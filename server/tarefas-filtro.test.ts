import { describe, expect, it } from "vitest";
import { passaFiltroTarefa, tarefaAtrasada, tarefaDoDia, type FiltroStatusTarefa } from "../shared/tarefas-filtro";

const agora = new Date(2026, 10, 11, 16, 0); // 11/11/2026 16:00 (hora local)
const T = {
  atrasada: { status: "pending", dueAt: new Date(2026, 10, 10, 9, 0) },
  atrasadaHoje: { status: "in_progress", dueAt: new Date(2026, 10, 11, 9, 0) },
  hojeMaisTarde: { status: "pending", dueAt: new Date(2026, 10, 11, 18, 0) },
  futura: { status: "pending", dueAt: new Date(2026, 10, 25, 9, 0) },
  semPrazo: { status: "pending", dueAt: null },
  concluidaVencida: { status: "done", dueAt: new Date(2026, 10, 1, 9, 0) },
  cancelada: { status: "cancelled", dueAt: new Date(2026, 10, 1, 9, 0) },
};
const filtrar = (f: FiltroStatusTarefa) => Object.entries(T).filter(([, t]) => passaFiltroTarefa(t, f, agora)).map(([k]) => k);

describe("Filtro das Tarefas e SLA", () => {
  it("atrasada é automática: prazo vencido e tarefa aberta", () => {
    expect(tarefaAtrasada(T.atrasada, agora)).toBe(true);
    expect(tarefaAtrasada(T.atrasadaHoje, agora)).toBe(true);
    expect(tarefaAtrasada(T.hojeMaisTarde, agora)).toBe(false);
    expect(tarefaAtrasada(T.concluidaVencida, agora)).toBe(false);
    expect(tarefaAtrasada(T.cancelada, agora)).toBe(false);
    expect(tarefaDoDia(T.hojeMaisTarde, agora)).toBe(true);
  });
  it("padrão: só atrasadas e as do dia — sem futuras, sem prazo e sem concluídas", () => {
    expect(filtrar("atrasadas_e_hoje")).toEqual(["atrasada", "atrasadaHoje", "hojeMaisTarde"]);
  });
  it("Atrasadas, por status e Todas", () => {
    expect(filtrar("overdue")).toEqual(["atrasada", "atrasadaHoje"]);
    expect(filtrar("pending")).toEqual(["atrasada", "hojeMaisTarde", "futura", "semPrazo"]);
    expect(filtrar("done")).toEqual(["concluidaVencida"]);
    expect(filtrar("all")).toHaveLength(7);
  });
});
