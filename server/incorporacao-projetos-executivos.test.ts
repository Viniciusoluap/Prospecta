import { describe, it, expect } from "vitest";
import { resumoProjetosExecutivos, projetosExecutivosTodosLiberadosDoJson, type ProjetoExecutivo } from "../shared/incorporacao/projetos-executivos";

function projeto(overrides: Partial<ProjetoExecutivo> = {}): ProjetoExecutivo {
  return { id: "1", disciplina: "Arquitetura Executiva", status: "nao_iniciado", ...overrides };
}

describe("resumoProjetosExecutivos", () => {
  it("conta apenas os liberados para obra", () => {
    const r = resumoProjetosExecutivos([projeto({ status: "liberado_para_obra" }), projeto({ status: "em_revisao" })]);
    expect(r.liberados).toBe(1);
    expect(r.pctLiberado).toBe(50);
  });
  it("retorna zero para lista vazia", () => {
    expect(resumoProjetosExecutivos([]).pctLiberado).toBe(0);
  });
});

describe("projetosExecutivosTodosLiberadosDoJson", () => {
  it("retorna false para JSON nulo/inválido/vazio", () => {
    expect(projetosExecutivosTodosLiberadosDoJson(null)).toBe(false);
    expect(projetosExecutivosTodosLiberadosDoJson("{invalid")).toBe(false);
    expect(projetosExecutivosTodosLiberadosDoJson(JSON.stringify({ projetos: [] }))).toBe(false);
  });
  it("retorna true somente quando todos estão liberados", () => {
    const todos = JSON.stringify({ projetos: [projeto({ status: "liberado_para_obra" })] });
    expect(projetosExecutivosTodosLiberadosDoJson(todos)).toBe(true);
  });
});
