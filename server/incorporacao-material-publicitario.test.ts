import { describe, it, expect } from "vitest";
import { resumoMaterialPublicitario, materialPublicitarioAprovadoDoJson, type PecaPublicitaria } from "../shared/incorporacao/material-publicitario";

function peca(overrides: Partial<PecaPublicitaria> = {}): PecaPublicitaria {
  return { id: "1", tipo: "Site", nome: "Peça", status: "em_producao", ...overrides };
}

describe("resumoMaterialPublicitario", () => {
  it("calcula o percentual aprovado", () => {
    const r = resumoMaterialPublicitario([peca({ status: "aprovado" }), peca({ status: "em_producao" })]);
    expect(r.pctAprovado).toBe(50);
  });
  it("conta peças em aprovação separadamente", () => {
    const r = resumoMaterialPublicitario([peca({ status: "em_aprovacao" }), peca({ status: "aprovado" })]);
    expect(r.emAprovacao).toBe(1);
  });
});

describe("materialPublicitarioAprovadoDoJson", () => {
  it("retorna false para JSON nulo/inválido/vazio", () => {
    expect(materialPublicitarioAprovadoDoJson(null)).toBe(false);
    expect(materialPublicitarioAprovadoDoJson("{invalid")).toBe(false);
    expect(materialPublicitarioAprovadoDoJson(JSON.stringify({ pecas: [] }))).toBe(false);
  });
  it("retorna true somente quando todas as peças estão aprovadas", () => {
    const todas = JSON.stringify({ pecas: [peca({ status: "aprovado" })] });
    expect(materialPublicitarioAprovadoDoJson(todas)).toBe(true);
    const parcial = JSON.stringify({ pecas: [peca({ status: "aprovado" }), peca({ status: "reprovado" })] });
    expect(materialPublicitarioAprovadoDoJson(parcial)).toBe(false);
  });
});

it("soma orçamento de todas as peças sem depender da aprovação e preserva dados legados", () => {
  const lista = [peca({ valorOrcado: 100.15 }), peca({ status: "aprovado", valorOrcado: 200.25 }), peca({ status: "reprovado", valorOrcado: 50.10 }), peca({ status: "em_aprovacao" })];
  expect(resumoMaterialPublicitario(lista)).toMatchObject({ valorTotalOrcado: 350.50, aprovadas: 1, emAprovacao: 1 });
  expect(resumoMaterialPublicitario(lista.slice(1)).valorTotalOrcado).toBe(250.35);
  expect(resumoMaterialPublicitario([peca({ valorOrcado: -1 }), peca({ valorOrcado: NaN })]).valorTotalOrcado).toBe(0);
});
