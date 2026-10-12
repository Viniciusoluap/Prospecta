import { describe, it, expect } from "vitest";
import { parseNumeroBR } from "../shared/numero-br";

describe("parseNumeroBR", () => {
  it("converte número BR com milhar e decimal (vírgula)", () => {
    expect(parseNumeroBR("1.234,56")).toBe(1234.56);
  });

  it("converte número BR sem milhar, só com vírgula decimal", () => {
    expect(parseNumeroBR("1234,56")).toBe(1234.56);
  });

  it("converte número já em formato ponto decimal (ex.: vindo do banco)", () => {
    expect(parseNumeroBR("1234.56")).toBe(1234.56);
  });

  it("converte inteiro sem separador", () => {
    expect(parseNumeroBR("1234")).toBe(1234);
  });

  it("converte negativo no padrão BR", () => {
    expect(parseNumeroBR("-1.234,56")).toBe(-1234.56);
  });

  it("converte milhar grande com múltiplos pontos", () => {
    expect(parseNumeroBR("1.234.567,89")).toBe(1234567.89);
  });

  it("retorna 0 para string vazia", () => {
    expect(parseNumeroBR("")).toBe(0);
  });

  it("retorna 0 para string só com espaços", () => {
    expect(parseNumeroBR("   ")).toBe(0);
  });

  it("retorna 0 para texto não numérico", () => {
    expect(parseNumeroBR("abc")).toBe(0);
  });

  it("retorna 0 para null/undefined", () => {
    expect(parseNumeroBR(null)).toBe(0);
    expect(parseNumeroBR(undefined)).toBe(0);
  });

  it("repassa number finito como está", () => {
    expect(parseNumeroBR(42.5)).toBe(42.5);
  });

  it("retorna 0 para NaN/Infinity numéricos", () => {
    expect(parseNumeroBR(NaN)).toBe(0);
    expect(parseNumeroBR(Infinity)).toBe(0);
  });

  it("trata zero digitado corretamente (não deve virar inválido)", () => {
    expect(parseNumeroBR("0")).toBe(0);
    expect(parseNumeroBR("0,00")).toBe(0);
  });
});
