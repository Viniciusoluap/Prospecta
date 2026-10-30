import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formatArea } from "../client/src/lib/format";

// Lote 4 (decisão do dono de 30/10/2026): toda área da Incorporação aparece
// como "1.234,56 m²" (2 casas). Gêmeo de
// `web/src/lib/__tests__/incorporacao-area-formato.test.ts` do Santa Fé.

const DIR_ABAS = join(__dirname, "../client/src/components/incorporacao/estudo");
const ARQUIVOS = [
  ...readdirSync(DIR_ABAS).filter((f) => /\.tsx?$/.test(f)).map((f) => join(DIR_ABAS, f)),
  join(DIR_ABAS, "compat/pdf-loteamento.ts"),
];

describe("formato de área na Incorporação", () => {
  it("formatArea usa 2 casas e separador pt-BR", () => {
    expect(formatArea(1234.5)).toBe("1.234,50 m²");
    expect(formatArea(1234.567)).toBe("1.234,57 m²");
    expect(formatArea(360)).toBe("360,00 m²");
    expect(formatArea(Number.NaN)).toBe("0,00 m²");
  });

  it("nenhuma tela/PDF da Incorporação monta 'm²' sem passar por formatArea", () => {
    const ofensores: string[] = [];
    for (const arquivo of ARQUIVOS) {
      const linhas = readFileSync(arquivo, "utf8").split("\n");
      linhas.forEach((linha, i) => {
        if (/\}\s?m²/.test(linha)) ofensores.push(`${arquivo}:${i + 1}`);
        if (/Math\.round\([^)]*M2[^)]*\)\.toLocaleString/.test(linha)) ofensores.push(`${arquivo}:${i + 1}`);
      });
    }
    expect(ofensores).toEqual([]);
  });
});
