import { describe, expect, it } from "vitest";
import { linhasExcelRelatorio } from "../client/src/lib/relatorio-obra-xlsx";
import type { RelatorioObra } from "../shared/relatorio-obra";

describe("Excel do relatório executivo", () => {
  it("inclui cada campo, tabela e indicador do objeto que alimenta o PDF", () => {
    const relatorio: RelatorioObra = {
      titulo: "Obra teste", subtitulo: "Prospecta",
      secoes: [{
        id: "operacao", titulo: "Operação",
        campos: [{ rotulo: "Lucro", valor: "R$ 1.234,56" }],
        tabelas: [{ titulo: "Pagamentos", colunas: ["Data", "Valor"], linhas: [["25/10/2026", "R$ 100,00"]], vazio: "Sem pagamentos" }],
        graficos: [{ titulo: "Progresso", unidade: "percentual", itens: [{ rotulo: "Obra", valor: 50, texto: "50%" }] }],
      }],
    };
    const abas = linhasExcelRelatorio(relatorio);
    expect(abas).toHaveLength(1);
    const texto = JSON.stringify(abas[0].linhas);
    for (const valor of ["Lucro", "R$ 1.234,56", "Pagamentos", "25/10/2026", "R$ 100,00", "Progresso", "50%"]) {
      expect(texto).toContain(valor);
    }
  });
});
