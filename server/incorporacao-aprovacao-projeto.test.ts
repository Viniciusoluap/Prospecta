import { describe, it, expect } from "vitest";
import { resumoAprovacaoProjeto, projetoTotalmenteAprovadoDoJson, type ProcessoAprovacao } from "../shared/incorporacao/aprovacao-projeto";

function processo(overrides: Partial<ProcessoAprovacao> = {}): ProcessoAprovacao {
  return { id: "1", orgao: "Prefeitura (projeto arquitetônico)", status: "nao_protocolado", ...overrides };
}

describe("resumoAprovacaoProjeto", () => {
  const hoje = new Date("2026-06-01");

  it("conta protocolados como todos que não estão em 'nao_protocolado'", () => {
    const r = resumoAprovacaoProjeto([processo({ status: "protocolado" }), processo({ status: "nao_protocolado" })], hoje);
    expect(r.protocolados).toBe(1);
  });

  it("lista processos com exigência separadamente", () => {
    const r = resumoAprovacaoProjeto([processo({ status: "exigencia" }), processo({ status: "aprovado" })], hoje);
    expect(r.comExigencia).toHaveLength(1);
  });

  it("calcula o percentual aprovado", () => {
    const r = resumoAprovacaoProjeto([processo({ status: "aprovado" }), processo({ status: "em_analise" })], hoje);
    expect(r.pctAprovado).toBe(50);
  });

  it("identifica atrasados por prazo previsto vencido, exceto os já aprovados", () => {
    const r = resumoAprovacaoProjeto([
      processo({ id: "a", prazoPrevisto: "2026-01-01", status: "protocolado" }),
      processo({ id: "b", prazoPrevisto: "2026-01-01", status: "aprovado" }),
      processo({ id: "c", prazoPrevisto: "2026-12-01", status: "protocolado" }),
    ], hoje);
    expect(r.atrasados.map((p) => p.id)).toEqual(["a"]);
  });
});

describe("projetoTotalmenteAprovadoDoJson", () => {
  it("retorna false para JSON nulo/inválido/vazio", () => {
    expect(projetoTotalmenteAprovadoDoJson(null)).toBe(false);
    expect(projetoTotalmenteAprovadoDoJson("{invalid")).toBe(false);
    expect(projetoTotalmenteAprovadoDoJson(JSON.stringify({ processos: [] }))).toBe(false);
  });
  it("retorna true somente quando todos os processos estão aprovados", () => {
    const todos = JSON.stringify({ processos: [processo({ status: "aprovado" })] });
    expect(projetoTotalmenteAprovadoDoJson(todos)).toBe(true);
    const parcial = JSON.stringify({ processos: [processo({ status: "aprovado" }), processo({ status: "protocolado" })] });
    expect(projetoTotalmenteAprovadoDoJson(parcial)).toBe(false);
  });
});
