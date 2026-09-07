import { describe, it, expect } from "vitest";
import { calcularPrecificacaoPorComparaveis, comparavelValido, type AtributoComparavel, type Comparavel } from "../shared/incorporacao/precificacao";

const atributos: AtributoComparavel[] = [
  { nome: "Localização", peso: 3 },
  { nome: "Lazer", peso: 1 },
];

describe("comparavelValido", () => {
  it("é inválido sem preço", () => {
    const c: Comparavel = { nome: "A", precoM2: null, notas: [3, 3] };
    expect(comparavelValido(c, 2)).toBe(false);
  });
  it("é inválido com número de notas diferente do número de atributos", () => {
    const c: Comparavel = { nome: "A", precoM2: 1000, notas: [3] };
    expect(comparavelValido(c, 2)).toBe(false);
  });
  it("é válido com preço e todas as notas positivas", () => {
    const c: Comparavel = { nome: "A", precoM2: 1000, notas: [3, 2] };
    expect(comparavelValido(c, 2)).toBe(true);
  });
});

describe("calcularPrecificacaoPorComparaveis", () => {
  it("retorna zero sem comparáveis válidos", () => {
    const r = calcularPrecificacaoPorComparaveis(atributos, [3, 3], []);
    expect(r.precoSugeridoM2).toBe(0);
    expect(r.comparaveisValidos).toBe(0);
  });

  it("sugere o mesmo preço do comparável quando as notas ponderadas são iguais", () => {
    const comparaveis: Comparavel[] = [{ nome: "Concorrente", precoM2: 2000, notas: [3, 3] }];
    const r = calcularPrecificacaoPorComparaveis(atributos, [3, 3], comparaveis);
    expect(r.precoSugeridoM2).toBeCloseTo(2000, 6);
    expect(r.comparaveisValidos).toBe(1);
  });

  it("escala o preço proporcionalmente quando a nota do novo empreendimento é maior", () => {
    const comparaveis: Comparavel[] = [{ nome: "Concorrente", precoM2: 1000, notas: [1, 1] }];
    const r = calcularPrecificacaoPorComparaveis(atributos, [3, 3], comparaveis);
    expect(r.precoSugeridoM2).toBeGreaterThan(1000);
  });

  it("lista comparáveis incompletos sem quebrar o cálculo", () => {
    const comparaveis: Comparavel[] = [
      { nome: "Completo", precoM2: 1000, notas: [2, 2] },
      { nome: "Incompleto", precoM2: null, notas: [2, 2] },
    ];
    const r = calcularPrecificacaoPorComparaveis(atributos, [2, 2], comparaveis);
    expect(r.comparaveisValidos).toBe(1);
    expect(r.comparaveisIncompletos).toEqual(["Incompleto"]);
  });
});
