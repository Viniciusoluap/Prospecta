import { describe, it, expect } from "vitest";
import {
  formatarNumeroParaEdicao,
  aplicarDigitacao,
  reformatarAoSairDoCampo,
} from "../client/src/lib/numero-input";

describe("formatarNumeroParaEdicao", () => {
  it("formata um decimal com vírgula, sem separador de milhar", () => {
    expect(formatarNumeroParaEdicao(1234.56)).toBe("1234,56");
  });

  it("formata um inteiro completando 2 casas decimais por padrão", () => {
    expect(formatarNumeroParaEdicao(10)).toBe("10,00");
  });

  it("respeita minimumFractionDigits/maximumFractionDigits customizados", () => {
    expect(formatarNumeroParaEdicao(0.5, { minimumFractionDigits: 0, maximumFractionDigits: 4 })).toBe("0,5");
    expect(formatarNumeroParaEdicao(1.23456, { minimumFractionDigits: 0, maximumFractionDigits: 4 })).toBe("1,2346");
  });

  it("retorna string vazia para zero (campo nasce vazio, mostra placeholder)", () => {
    expect(formatarNumeroParaEdicao(0)).toBe("");
  });

  it("retorna string vazia para null/undefined/NaN", () => {
    expect(formatarNumeroParaEdicao(null)).toBe("");
    expect(formatarNumeroParaEdicao(undefined)).toBe("");
    expect(formatarNumeroParaEdicao(NaN)).toBe("");
  });

  it("formata negativos corretamente", () => {
    expect(formatarNumeroParaEdicao(-42.5)).toBe("-42,50");
  });
});

describe("aplicarDigitacao", () => {
  it("mantém o texto exatamente como digitado (sem reformatar)", () => {
    const r = aplicarDigitacao("1.234,5");
    expect(r.texto).toBe("1.234,5");
    expect(r.numero).toBe(1234.5);
  });

  it("converte vírgula decimal simples", () => {
    const r = aplicarDigitacao("9,5");
    expect(r.texto).toBe("9,5");
    expect(r.numero).toBe(9.5);
  });

  it("digitação intermediária inválida ainda preserva o texto, número vira 0", () => {
    const r = aplicarDigitacao("abc");
    expect(r.texto).toBe("abc");
    expect(r.numero).toBe(0);
  });

  it("campo vazio -> texto vazio, número 0", () => {
    const r = aplicarDigitacao("");
    expect(r.texto).toBe("");
    expect(r.numero).toBe(0);
  });

  it("vírgula sozinha (dígito ainda sendo completado) não derruba o campo", () => {
    const r = aplicarDigitacao("0,");
    expect(r.texto).toBe("0,");
    expect(r.numero).toBe(0);
  });
});

describe("reformatarAoSairDoCampo", () => {
  it("reformata o número já convertido, descartando o texto intermediário", () => {
    expect(reformatarAoSairDoCampo(1234.5)).toBe("1234,50");
  });

  it("zero reformata para string vazia (mesma regra de formatarNumeroParaEdicao)", () => {
    expect(reformatarAoSairDoCampo(0)).toBe("");
  });

  it("repassa opções de casas decimais", () => {
    expect(reformatarAoSairDoCampo(0.0575, { minimumFractionDigits: 0, maximumFractionDigits: 4 })).toBe("0,0575");
  });
});

describe("aplicarDigitacao — campos de percentual (D-01)", () => {
  it("percentual: ponto é decimal; dinheiro: ponto é milhar", async () => {
    const { aplicarDigitacao } = await import("../client/src/lib/numero-input");
    expect(aplicarDigitacao("2.345", { percentual: true }).numero).toBe(2.345);
    expect(aplicarDigitacao("2,5", { percentual: true }).numero).toBe(2.5);
    expect(aplicarDigitacao("2.345").numero).toBe(2345);
  });
});

// Pedido de 15/10: dinheiro com pontos de milhar já durante a digitação.
import { cursorAposMascara, mascararDinheiro } from "../client/src/lib/numero-input";
describe("mascararDinheiro", () => {
  it("põe os pontos de milhar enquanto digita", () => {
    expect(mascararDinheiro("180000")).toEqual({ texto: "180.000", numero: 180000 });
    expect(mascararDinheiro("1.000.0005")).toEqual({ texto: "10.000.005", numero: 10000005 });
    expect(mascararDinheiro("1000000,5")).toEqual({ texto: "1.000.000,5", numero: 1000000.5 });
    expect(mascararDinheiro("1.000.000,999")).toEqual({ texto: "1.000.000,99", numero: 1000000.99 });
  });
  it("ponto no fim vira vírgula; zeros à esquerda e letras somem", () => {
    expect(mascararDinheiro("1.500.")).toEqual({ texto: "1.500,", numero: 1500 });
    expect(mascararDinheiro("00R$ 12a")).toEqual({ texto: "12", numero: 12 });
    expect(mascararDinheiro(",5")).toEqual({ texto: "0,5", numero: 0.5 });
    expect(mascararDinheiro("")).toEqual({ texto: "", numero: 0 });
  });
  it("blur exibe com milhar e duas casas", () => {
    expect(formatarNumeroParaEdicao(1000000, { agrupar: true })).toBe("1.000.000,00");
  });
  it("cursor fica depois do mesmo dígito", () => {
    expect(cursorAposMascara("1800005", 7, "1.800.005")).toBe(9);
    expect(cursorAposMascara("1.80X0.000", 4, "180.000")).toBe(3);
  });
});
