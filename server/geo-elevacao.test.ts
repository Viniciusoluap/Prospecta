import { describe, it, expect } from "vitest";
import { parseAAIGrid } from "./_core/geo/elevacao";

const AAIGRID_EXEMPLO = `ncols 3
nrows 2
xllcorner -47.5
yllcorner -5.52
cellsize 0.001
NODATA_value -9999
100 110 120
90 -9999 130
`;

describe("parseAAIGrid", () => {
  it("faz o parse do cabeçalho e da matriz de elevação", () => {
    const grid = parseAAIGrid(AAIGRID_EXEMPLO);
    expect(grid.ncols).toBe(3);
    expect(grid.nrows).toBe(2);
    expect(grid.west).toBe(-47.5);
    expect(grid.south).toBe(-5.52);
    expect(grid.z).toEqual([[100, 110, 120], [90, 0, 130]]);
  });

  it("substitui NODATA por zero e calcula min/max ignorando o buraco", () => {
    const grid = parseAAIGrid(AAIGRID_EXEMPLO);
    expect(grid.min).toBe(0);
    expect(grid.max).toBe(130);
  });

  it("lança erro para um cabeçalho inválido", () => {
    expect(() => parseAAIGrid("linha sem cabecalho valido\n1 2 3")).toThrow(/Cabeçalho AAIGrid inválido/);
  });
});
