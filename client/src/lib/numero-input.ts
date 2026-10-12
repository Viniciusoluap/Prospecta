// Lógica pura (sem React) por trás de `CurrencyInput`/`PercentInput`:
// formata um número para o buffer de texto editável (padrão brasileiro,
// vírgula decimal) e decide, a cada tecla, qual par (texto, número) o
// campo deve assumir. Extraída dos componentes para ficar testável sem
// precisar montar um `<input>` real (não há infraestrutura de teste de
// componente React neste repositório).
//
// O parsing em si (texto -> number) é feito por `parseNumeroBR`
// (`@shared/numero-br`); este módulo cuida só da formatação de exibição
// e da pequena máquina de estado do campo (texto digitado + número já
// convertido, e o que acontece no blur).

import { parseNumeroBR } from "@shared/numero-br";

/**
 * Formata um número para o buffer de texto de um campo editável, no
 * padrão brasileiro (vírgula decimal, sem separador de milhar — o milhar
 * só é adicionado na exibição somente-leitura, nunca enquanto o campo
 * está em edição, para não conflitar com a posição do cursor).
 *
 * `0` e valores não finitos (`NaN`, vindos de um campo ainda vazio)
 * retornam string vazia, para o campo nascer vazio em vez de "0,00".
 */
export function formatarNumeroParaEdicao(
  valor: number | null | undefined,
  opcoes: { minimumFractionDigits?: number; maximumFractionDigits?: number } = {}
): string {
  if (valor == null || !Number.isFinite(valor) || valor === 0) return "";
  const { minimumFractionDigits = 2, maximumFractionDigits = 2 } = opcoes;
  return valor.toLocaleString("pt-BR", {
    useGrouping: false,
    minimumFractionDigits,
    maximumFractionDigits,
  });
}

/**
 * Resultado de uma edição: o texto a manter no buffer (exatamente o que
 * o usuário digitou, sem reformatar) e o número já convertido (para o
 * estado "de verdade" do formulário).
 */
export function aplicarDigitacao(valorTexto: string): { texto: string; numero: number } {
  return { texto: valorTexto, numero: parseNumeroBR(valorTexto) };
}

/**
 * No blur, reformata o buffer a partir do número já convertido — limpa
 * digitação intermediária/inválida ("1,2,3", "abc") sem alterar o valor
 * numérico do formulário.
 */
export function reformatarAoSairDoCampo(
  numero: number,
  opcoes?: { minimumFractionDigits?: number; maximumFractionDigits?: number }
): string {
  return formatarNumeroParaEdicao(numero, opcoes);
}
