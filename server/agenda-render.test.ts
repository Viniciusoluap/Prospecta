import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  role: "admin",
  visits: [] as any[],
  leads: [] as any[],
  tasks: [] as any[],
  taskQuery: vi.fn(),
  leadQuery: vi.fn(),
}));
const response = (rows: any[]) => ({ data: rows, isLoading: false, error: null, refetch: vi.fn() });
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: data.role } }) }));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => React.createElement("a", { href, ...props }, children),
}));
vi.mock("@/lib/trpc", () => ({ trpc: {
  agenda: {
    list: { useQuery: () => response(data.visits) },
    cardDeadlines: { useQuery: (...args: any[]) => { data.leadQuery(...args); return response(data.leads); } },
    options: { useQuery: () => ({ data: { brokers: [], responsibles: [], leads: [], properties: [] } }) },
    create: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    update: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    delete: { useMutation: () => ({ mutateAsync: vi.fn() }) },
  },
  tasks: { list: { useQuery: (...args: any[]) => { data.taskQuery(...args); return response(data.tasks); } } },
} }));

import AdminAgenda from "../client/src/pages/admin/AdminAgenda";

function htmlForToday(day: string) {
  vi.setSystemTime(new Date(`${day}T12:00:00Z`));
  return renderToStaticMarkup(React.createElement(AdminAgenda, { embedded: true }));
}

describe("agenda renderizada: registros abaixo do calendário", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    data.role = "admin";
    data.visits = [];
    data.leads = [];
    data.tasks = [];
    vi.clearAllMocks();
    // The app's TSX is transformed with the classic runtime by this Vitest config.
    (globalThis as any).React = React;
  });
  afterEach(() => vi.useRealTimers());

  it("mostra os nove leads como linhas reais, sem mensagem vazia nem bloco redundante", () => {
    data.leads = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, name: `Cliente único ${i + 1}`, cardDueDate: "2026-10-22" }));
    const html = htmlForToday("2026-10-22");
    const tbody = html.split("<tbody")[1] || "";
    expect((tbody.match(/<tr/g) || []).length).toBe(9);
    for (let i = 1; i <= 9; i++) expect(tbody).toContain(`Cliente único ${i}`);
    expect(html).toContain("9 leads");
    expect(html).not.toContain("Nenhum registro encontrado");
    expect(html).not.toContain('aria-label="Vencimentos dos cards"');
    expect(html).not.toContain("Prazos de tarefas");
    expect(html).not.toContain("Mostrar todos os dias na lista");
  });

  it("reúne quatro leads, tarefa e agendamento do dia, mantendo ações e excluindo tarefa sem prazo", () => {
    data.leads = Array.from({ length: 4 }, (_, i) => ({ id: i + 1, name: `Lead de outubro ${i + 1}`, cardDueDate: "2026-10-30" }));
    data.tasks = [
      { id: 1, title: "Tarefa visível do dia", dueAt: new Date("2026-10-30T12:00:00Z"), status: "pending", assignedTo: "Colaborador" },
      { id: 2, title: "Tarefa sem prazo escondida", dueAt: null, status: "pending", assignedTo: "Colaborador" },
      { id: 3, title: "Tarefa de outro dia escondida", dueAt: new Date("2026-10-29T12:00:00Z"), status: "pending", assignedTo: "Colaborador" },
    ];
    data.visits = [{ visit: { id: 1, clientName: "Visita visível do dia", scheduledAt: new Date("2026-10-30T15:00:00Z"), status: "agendada", visitType: "obra" }, leadName: null, brokerName: "Corretor", propertyTitle: "Imóvel" }];
    const html = htmlForToday("2026-10-30");
    const tbody = html.split("<tbody")[1] || "";
    expect((tbody.match(/<tr/g) || []).length).toBe(6);
    expect(tbody).toContain("Tarefa visível do dia");
    expect(tbody).toContain("Visita visível do dia");
    expect(tbody).toContain("Abrir lead");
    expect(tbody).toContain("Abrir tarefa");
    expect(tbody).toContain("Detalhes / editar");
    expect(tbody).toContain("Excluir");
    expect(tbody).not.toContain("Tarefa sem prazo escondida");
    expect(tbody).not.toContain("Tarefa de outro dia escondida");
    expect(html).toContain("4 leads");
    expect(html).toContain("1 tarefa");
    expect(html).not.toContain("Nenhum registro encontrado");
  });

  it("não mostra tarefas ou leads internos ao corretor e desabilita suas consultas", () => {
    data.role = "corretor";
    data.leads = [{ id: 1, name: "Lead interno", cardDueDate: "2026-10-22" }];
    data.tasks = [{ id: 1, title: "Tarefa interna", dueAt: new Date("2026-10-22T12:00:00Z"), status: "pending" }];
    const html = htmlForToday("2026-10-22");
    expect(html).not.toContain("Lead interno");
    expect(html).not.toContain("Tarefa interna");
    expect(html).not.toContain("Todas as tarefas");
    expect(data.taskQuery).toHaveBeenCalledWith(undefined, { enabled: false });
    expect(data.leadQuery).toHaveBeenCalledWith(undefined, { enabled: false });
  });
});
