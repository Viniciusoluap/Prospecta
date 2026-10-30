import { describe, expect, it } from "vitest";
import { CABECALHO_CSV_COMISSOES, montarCsvComissoes, nomeArquivoCsvComissoes } from "../shared/comissoes-csv";

// Gêmeo de `web/src/lib/__tests__/comissoes-exportacao-csv.test.ts` do Santa Fé.
describe("CSV de comissões", () => {
  it("monta cabeçalho, BOM e valores no padrão 1.234,56", () => {
    const csv = montarCsvComissoes([
      { origem: "operacional", data: "2026-10-01", corretor: "Ana", referencia: "Casa 1", valorTotal: 12345.6, pago: 12345.6, status: "paga" },
      { origem: "operacional", data: "2026-10-02", corretor: "Empresa", referencia: null, valorTotal: 1000000, pago: 0, status: "pendente" },
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    const linhas = csv.slice(1).split("\n");
    expect(linhas[0]).toBe(CABECALHO_CSV_COMISSOES);
    expect(linhas[1]).toBe("operacional;2026-10-01;Ana;Casa 1;12.345,60;12.345,60;paga");
    expect(linhas[2]).toBe("operacional;2026-10-02;Empresa;;1.000.000,00;0,00;pendente");
  });

  it("põe entre aspas campos com ponto e vírgula ou aspas", () => {
    const csv = montarCsvComissoes([
      { origem: "operacional", data: "2026-10-01", corretor: 'João "JJ"', referencia: "Lote 1; Quadra 2", valorTotal: 1, pago: 0, status: "pendente" },
    ]);
    expect(csv.split("\n")[1]).toBe('operacional;2026-10-01;"João ""JJ""";"Lote 1; Quadra 2";1,00;0,00;pendente');
  });

  it("nome do arquivo com a data", () => {
    expect(nomeArquivoCsvComissoes(new Date("2026-10-30T12:00:00Z"))).toBe("comissoes-2026-10-30.csv");
  });
});
