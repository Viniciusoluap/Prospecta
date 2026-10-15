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
import { lerPercentualDigitado } from "@shared/financeiro/obra";

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
  opcoes: { minimumFractionDigits?: number; maximumFractionDigits?: number; agrupar?: boolean } = {}
): string {
  if (valor == null || !Number.isFinite(valor) || valor === 0) return "";
  const { minimumFractionDigits = 2, maximumFractionDigits = 2, agrupar = false } = opcoes;
  return valor.toLocaleString("pt-BR", {
    useGrouping: agrupar,
    minimumFractionDigits,
    maximumFractionDigits,
  });
}

/**
 * Resultado de uma edição: o texto a manter no buffer (exatamente o que
 * o usuário digitou, sem reformatar) e o número já convertido (para o
 * estado "de verdade" do formulário).
 */
export function aplicarDigitacao(valorTexto: string, opcoes: { percentual?: boolean } = {}): { texto: string; numero: number } {
  // Percentual: ponto é decimal ("2.345" = 2,345%); dinheiro: ponto é milhar.
  if (opcoes.percentual) return { texto: valorTexto, numero: lerPercentualDigitado(valorTexto) ?? 0 };
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

/**
 * Pedido de 15/10 — dinheiro sempre no padrão "1.000.000,00": a máscara põe os
 * pontos de milhar enquanto a pessoa digita ("180000" -> "180.000"). Ponto
 * digitado é milhar (já está no texto formatado); vírgula é decimal (máx. 2
 * casas); um ponto digitado no fim vira vírgula (teclado sem vírgula).
 */
export function mascararDinheiro(valorTexto: string): { texto: string; numero: number } {
  let bruto = valorTexto.replace(/[^\d.,]/g, "");
  if (bruto.endsWith(".") && !bruto.includes(",")) bruto = `${bruto.slice(0, -1)},`;
  const virgula = bruto.indexOf(",");
  const inteiroBruto = (virgula >= 0 ? bruto.slice(0, virgula) : bruto).replace(/\D/g, "");
  const decimais = virgula >= 0 ? bruto.slice(virgula + 1).replace(/\D/g, "").slice(0, 2) : "";
  const inteiro = inteiroBruto.replace(/^0+(?=\d)/, "");
  if (!inteiro && virgula < 0) return { texto: "", numero: 0 };
  const agrupado = (inteiro || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const texto = virgula >= 0 ? `${agrupado},${decimais}` : agrupado;
  return { texto, numero: Number(`${inteiro || "0"}.${decimais || "0"}`) };
}

/** Posição do cursor no texto mascarado: mesma quantidade de dígitos/vírgula à esquerda. */
export function cursorAposMascara(textoDigitado: string, cursor: number, textoMascarado: string): number {
  const alvo = textoDigitado.slice(0, cursor).replace(/[^\d,]/g, "").length;
  if (alvo === 0) return 0;
  let vistos = 0;
  for (let i = 0; i < textoMascarado.length; i++) {
    if (/[\d,]/.test(textoMascarado[i]) && ++vistos === alvo) return i + 1;
  }
  return textoMascarado.length;
}
