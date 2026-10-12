import { describe, it, expect } from "vitest";
import { formatCurrency, formatPercent } from "../client/src/lib/format";

// `Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })` usa
// espaço não separável (U+00A0) entre "R$" e o número — mesmo comportamento
// de `moeda()` em AdminFinanciamentos.tsx, só reaproveitado aqui.
const NBSP = " ";

describe("formatCurrency", () => {
  it("formata um valor em reais como moeda BRL", () => {
    expect(formatCurrency(1234.5)).toBe(`R$${NBSP}1.234,50`);
  });

  it("formata zero", () => {
    expect(formatCurrency(0)).toBe(`R$${NBSP}0,00`);
  });

  it("formata negativos", () => {
    expect(formatCurrency(-50)).toBe(`-R$${NBSP}50,00`);
  });

  it("trata NaN/Infinity como zero (nunca lança nem imprime 'NaN')", () => {
    expect(formatCurrency(NaN)).toBe(`R$${NBSP}0,00`);
    expect(formatCurrency(Infinity)).toBe(`R$${NBSP}0,00`);
  });

  it("não deve ser confundido com o formatCurrency(cents) de const.ts — recebe reais, não centavos", () => {
    // 1 real inteiro, não 1 centavo.
    expect(formatCurrency(1)).toBe(`R$${NBSP}1,00`);
  });
});

describe("formatPercent", () => {
  it("formata um percentual já na escala percentual (6 -> '6%')", () => {
    expect(formatPercent(6)).toBe("6%");
  });

  it("formata com casas decimais quando houver", () => {
    expect(formatPercent(9.5)).toBe("9,5%");
  });

  it("respeita maximumFractionDigits customizado", () => {
    expect(formatPercent(9.5555, 1)).toBe("9,6%");
  });

  it("trata NaN/Infinity como zero", () => {
    expect(formatPercent(NaN)).toBe("0%");
    expect(formatPercent(Infinity)).toBe("0%");
  });

  it("formata zero", () => {
    expect(formatPercent(0)).toBe("0%");
  });
});
