import { formatarNumero } from "./numero-mascara.js";

// Exportação CSV de comissões (Relatórios). Mesma regra no Santa Fé
// (`web/src/lib/comissoes/exportacao-csv.ts`): separador ";", BOM UTF-8 para o
// Excel abrir com acentos, valores no padrão 1.234,56 e campos com ";", aspas
// ou quebra de linha entre aspas (senão a linha "quebra" no Excel).

export type ComissaoCsvLinha = {
  origem: string;
  data: string;
  corretor: string;
  referencia: string | null;
  valorTotal: number;
  pago: number;
  status: string;
};

export const CABECALHO_CSV_COMISSOES = "Origem;Data;Corretor;Referência;Valor Total;Pago;Status";

export function campoCsv(valor: string): string {
  return /[;"\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

export function montarCsvComissoes(linhas: ComissaoCsvLinha[]): string {
  const corpo = linhas.map((r) =>
    [
      campoCsv(r.origem),
      campoCsv(r.data),
      campoCsv(r.corretor),
      campoCsv(r.referencia ?? ""),
      formatarNumero(r.valorTotal, { casas: 2 }),
      formatarNumero(r.pago, { casas: 2 }),
      campoCsv(r.status),
    ].join(";"),
  );
  return "﻿" + [CABECALHO_CSV_COMISSOES, ...corpo].join("\n");
}

export function nomeArquivoCsvComissoes(hoje = new Date()): string {
  return `comissoes-${hoje.toISOString().slice(0, 10)}.csv`;
}
