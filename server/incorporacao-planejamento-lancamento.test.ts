import { describe, it, expect } from "vitest";
import { resumoPlanejamentoLancamento, planejamentoLancamentoCompletoDoJson, MARCOS_PADRAO_LANCAMENTO, type MarcoLancamento } from "../shared/incorporacao/planejamento-lancamento";

function marco(overrides: Partial<MarcoLancamento> = {}): MarcoLancamento {
  return { id: "1", nome: "Marco", status: "pendente", ...overrides };
}

describe("MARCOS_PADRAO_LANCAMENTO", () => {
  it("tem 8 marcos padrão", () => {
    expect(MARCOS_PADRAO_LANCAMENTO).toHaveLength(8);
  });
});

describe("resumoPlanejamentoLancamento", () => {
  const hoje = new Date("2026-06-01");

  it("calcula o percentual concluído", () => {
    const r = resumoPlanejamentoLancamento([marco({ status: "concluido" }), marco({ status: "pendente" })], hoje);
    expect(r.pctConcluido).toBe(50);
  });

  it("identifica atrasados por data prevista vencida, exceto os concluídos", () => {
    const r = resumoPlanejamentoLancamento([
      marco({ id: "a", dataPrevista: "2026-01-01", status: "em_andamento" }),
      marco({ id: "b", dataPrevista: "2026-01-01", status: "concluido" }),
    ], hoje);
    expect(r.atrasados.map((m) => m.id)).toEqual(["a"]);
  });
});

describe("planejamentoLancamentoCompletoDoJson", () => {
  it("retorna false para JSON nulo/inválido/vazio", () => {
    expect(planejamentoLancamentoCompletoDoJson(null)).toBe(false);
    expect(planejamentoLancamentoCompletoDoJson("{invalid")).toBe(false);
    expect(planejamentoLancamentoCompletoDoJson(JSON.stringify({ marcos: [] }))).toBe(false);
  });
  it("retorna true somente quando todos os marcos estão concluídos", () => {
    const todos = JSON.stringify({ marcos: [marco({ status: "concluido" })] });
    expect(planejamentoLancamentoCompletoDoJson(todos)).toBe(true);
  });
});
