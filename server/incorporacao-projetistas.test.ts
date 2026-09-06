import { describe, it, expect } from "vitest";
import { resumoProjetistas, projetistasCompatibilizadosDoJson, type Projetista } from "../shared/incorporacao/projetistas";

function projetista(overrides: Partial<Projetista> = {}): Projetista {
  return { id: "1", disciplina: "Arquitetura", empresaOuProfissional: "Fulano", status: "nao_contratado", ...overrides };
}

describe("resumoProjetistas", () => {
  const hoje = new Date("2026-06-01");

  it("conta contratados como todos que não estão em 'nao_contratado'", () => {
    const r = resumoProjetistas([projetista({ status: "contratado" }), projetista({ status: "nao_contratado" })], hoje);
    expect(r.contratados).toBe(1);
  });

  it("conta entregues incluindo compatibilizados", () => {
    const r = resumoProjetistas([projetista({ status: "entregue" }), projetista({ status: "compatibilizado" })], hoje);
    expect(r.entregues).toBe(2);
  });

  it("calcula o percentual de compatibilizados", () => {
    const r = resumoProjetistas([projetista({ status: "compatibilizado" }), projetista({ status: "contratado" })], hoje);
    expect(r.pctCompatibilizado).toBe(50);
  });

  it("identifica atrasados por prazo de entrega vencido, exceto os já entregues/compatibilizados", () => {
    const r = resumoProjetistas([
      projetista({ id: "a", prazoEntrega: "2026-01-01", status: "contratado" }),
      projetista({ id: "b", prazoEntrega: "2026-01-01", status: "entregue" }),
      projetista({ id: "c", prazoEntrega: "2026-12-01", status: "contratado" }),
    ], hoje);
    expect(r.atrasados.map((p) => p.id)).toEqual(["a"]);
  });
});

describe("projetistasCompatibilizadosDoJson", () => {
  it("retorna false para JSON nulo/inválido/vazio", () => {
    expect(projetistasCompatibilizadosDoJson(null)).toBe(false);
    expect(projetistasCompatibilizadosDoJson("{invalid")).toBe(false);
    expect(projetistasCompatibilizadosDoJson(JSON.stringify({ projetistas: [] }))).toBe(false);
  });
  it("retorna true somente quando todos estão compatibilizados", () => {
    const todos = JSON.stringify({ projetistas: [projetista({ status: "compatibilizado" })] });
    expect(projetistasCompatibilizadosDoJson(todos)).toBe(true);
    const parcial = JSON.stringify({ projetistas: [projetista({ status: "compatibilizado" }), projetista({ status: "contratado" })] });
    expect(projetistasCompatibilizadosDoJson(parcial)).toBe(false);
  });
});
