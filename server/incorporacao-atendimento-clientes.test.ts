import { describe, it, expect } from "vitest";
import { resumoAtendimentoClientes, atendimentoTodosConcluidosDoJson, type ChamadoAtendimento } from "../shared/incorporacao/atendimento-clientes";

function chamado(overrides: Partial<ChamadoAtendimento> = {}): ChamadoAtendimento {
  return { id: "1", cliente: "Cliente", tipo: "Repasse Bancário", status: "aberto", ...overrides };
}

describe("resumoAtendimentoClientes", () => {
  it("conta chamados por status", () => {
    const r = resumoAtendimentoClientes([
      chamado({ status: "aberto" }),
      chamado({ status: "em_andamento" }),
      chamado({ status: "concluido" }),
      chamado({ status: "concluido" }),
    ]);
    expect(r.total).toBe(4);
    expect(r.abertos).toBe(1);
    expect(r.emAndamento).toBe(1);
    expect(r.concluidos).toBe(2);
    expect(r.pctConcluido).toBe(50);
  });

  it("retorna zero para lista vazia", () => {
    expect(resumoAtendimentoClientes([]).pctConcluido).toBe(0);
  });
});

describe("atendimentoTodosConcluidosDoJson", () => {
  it("retorna false para JSON nulo/inválido/vazio", () => {
    expect(atendimentoTodosConcluidosDoJson(null)).toBe(false);
    expect(atendimentoTodosConcluidosDoJson("{invalid")).toBe(false);
    expect(atendimentoTodosConcluidosDoJson(JSON.stringify({ chamados: [] }))).toBe(false);
  });
  it("retorna true somente quando todos os chamados estão concluídos", () => {
    const todos = JSON.stringify({ chamados: [chamado({ status: "concluido" })] });
    expect(atendimentoTodosConcluidosDoJson(todos)).toBe(true);
    const parcial = JSON.stringify({ chamados: [chamado({ status: "concluido" }), chamado({ status: "aberto" })] });
    expect(atendimentoTodosConcluidosDoJson(parcial)).toBe(false);
  });
});
