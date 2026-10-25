import type { RelatorioObra } from "@shared/relatorio-obra";

/** As abas são montadas do mesmo objeto que alimenta o PDF. Dados ausentes
 * permanecem explicitamente identificados, sem estimativas adicionais. */
export function linhasExcelRelatorio(relatorio: RelatorioObra) {
  return relatorio.secoes.map((secao) => {
    const linhas: (string | number)[][] = [[relatorio.titulo], [relatorio.subtitulo], [], [secao.titulo], ["Campo", "Valor"]];
    for (const campo of secao.campos) linhas.push([campo.rotulo, campo.valor]);
    for (const tabela of secao.tabelas) {
      linhas.push([], [tabela.titulo], tabela.colunas);
      if (tabela.linhas.length) linhas.push(...tabela.linhas);
      else linhas.push([tabela.vazio]);
    }
    for (const grafico of secao.graficos) {
      linhas.push([], [grafico.titulo, grafico.unidade], ["Indicador", "Valor", "Rótulo"]);
      linhas.push(...grafico.itens.map(i => [i.rotulo, i.valor, i.texto] as (string | number)[]));
    }
    return { nome: secao.titulo.slice(0, 31).replace(/[\\/?*\[\]:]/g, " "), linhas };
  });
}

export async function gerarExcelRelatorioObra(
  relatorio: RelatorioObra,
  fotos: { url: string; legenda: string | null; data: string | Date }[],
  nomeArquivo: string,
) {
  const XLSX = await import("xlsx");
  const livro = XLSX.utils.book_new();
  for (const aba of linhasExcelRelatorio(relatorio)) {
    const planilha = XLSX.utils.aoa_to_sheet(aba.linhas);
    planilha["!cols"] = [{ wch: 44 }, { wch: 38 }, { wch: 35 }, { wch: 30 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(livro, planilha, aba.nome);
  }
  const referencias = XLSX.utils.aoa_to_sheet([
    ["Foto", "Legenda", "Data", "Referência"],
    ...fotos.map((f, i) => [i + 1, f.legenda || "Sem legenda", new Date(f.data).toLocaleDateString("pt-BR"), f.url]),
  ]);
  referencias["!cols"] = [{ wch: 10 }, { wch: 42 }, { wch: 16 }, { wch: 70 }];
  if (fotos.length) referencias["!autofilter"] = { ref: `A1:D${fotos.length + 1}` };
  XLSX.utils.book_append_sheet(livro, referencias, "Referências das fotos");
  XLSX.writeFile(livro, nomeArquivo);
}
