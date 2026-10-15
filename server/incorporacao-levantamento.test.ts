import { describe, expect, it } from "vitest";
import { levantamentoValido } from "./incorporacao-documents-router";

describe("Levantamento topográfico (paridade com o Santa Fé: CSV, TXT, XYZ, DXF)", () => {
  const texto = Buffer.from("x,y,z\n1,2,3\n");
  it("aceita as extensões do Santa Fé", () => {
    for (const nome of ["pontos.csv", "PONTOS.TXT", "nuvem.xyz", "planta.dxf"]) expect(levantamentoValido(nome, texto)).toBe(true);
  });
  it("recusa outras extensões, arquivo vazio e binário", () => {
    expect(levantamentoValido("foto.png", texto)).toBe(false);
    expect(levantamentoValido("pontos.csv", Buffer.alloc(0))).toBe(false);
    expect(levantamentoValido("pontos.csv", Buffer.from([0x50, 0x00, 0x41]))).toBe(false);
  });
});
