import { describe, it, expect } from "vitest";
import {
  indiceFaixa,
  declividadeGrade,
  declividadeMedia,
  distribuicaoDeclividade,
  celulaEmMetros,
  FAIXAS_DECLIVIDADE,
} from "../shared/geo/relevo";

describe("indiceFaixa", () => {
  it("classifica declividade plana (0-5%)", () => {
    expect(FAIXAS_DECLIVIDADE[indiceFaixa(2)].chave).toBe("plano");
  });
  it("classifica declividade íngreme (18-25%)", () => {
    expect(FAIXAS_DECLIVIDADE[indiceFaixa(20)].chave).toBe("ingreme");
  });
  it("classifica declividade inviável (>25%)", () => {
    expect(FAIXAS_DECLIVIDADE[indiceFaixa(50)].chave).toBe("inviavel");
  });
});

describe("declividadeGrade", () => {
  it("retorna zero em um terreno completamente plano", () => {
    const grid = { ncols: 3, nrows: 3, z: [[10, 10, 10], [10, 10, 10], [10, 10, 10]], min: 10, max: 10 };
    const slopes = declividadeGrade(grid, 10, 10);
    for (const linha of slopes) for (const s of linha) expect(s).toBeCloseTo(0, 6);
  });

  it("detecta declividade positiva em uma rampa constante", () => {
    const grid = { ncols: 3, nrows: 3, z: [[0, 10, 20], [0, 10, 20], [0, 10, 20]], min: 0, max: 20 };
    const slopes = declividadeGrade(grid, 10, 10);
    expect(slopes[1][1]).toBeGreaterThan(0);
  });
});

describe("declividadeMedia e distribuicaoDeclividade", () => {
  it("calcula a média corretamente", () => {
    expect(declividadeMedia([[0, 10], [20, 30]])).toBeCloseTo(15, 6);
  });
  it("retorna zero para grade vazia", () => {
    expect(declividadeMedia([])).toBe(0);
  });
  it("distribui 100% das células em faixas somando 1", () => {
    const dist = distribuicaoDeclividade([[2, 8], [15, 40]]);
    const somaPct = dist.reduce((acc, f) => acc + f.pct, 0);
    expect(somaPct).toBeCloseTo(1, 6);
    const somaCelulas = dist.reduce((acc, f) => acc + f.celulas, 0);
    expect(somaCelulas).toBe(4);
  });
});

describe("celulaEmMetros", () => {
  it("converte graus em metros considerando a latitude", () => {
    const { x, y } = celulaEmMetros(0.001, 0.001, -5.5);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeCloseTo(111.132, 1);
  });
});
