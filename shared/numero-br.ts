// Parsing de números digitados no padrão brasileiro (vírgula como separador
// decimal, ponto como separador de milhar — ex.: "1.234,56"). Usado pelos
// formulários que aceitam entrada manual de área, preço e parâmetros
// urbanísticos/de massa, evitando que `parseFloat`/`Number()` quebrem (vendo
// "1.234,56" como NaN) e zerem silenciosamente o parâmetro digitado.
//
// Função pura, sem I/O — testável isoladamente.

/**
 * Converte um texto no padrão numérico brasileiro para `number`.
 *
 * Aceita:
 *  - "1.234,56" (milhar com ponto, decimal com vírgula) -> 1234.56
 *  - "1234,56"  (sem milhar, decimal com vírgula)        -> 1234.56
 *  - "1234.56"  (decimal já em ponto, ex.: valor vindo do banco) -> 1234.56
 *  - "1.000"    (só ponto = milhar)                       -> 1000
 *  - "1234"     (inteiro)                                 -> 1234
 *  - "-1.234,56" (negativo)                                -> -1234.56
 *
 * Entrada vazia, nula, ou não numérica resulta em 0 (nunca `NaN`), para que
 * o formulário sempre tenha um número válido para calcular.
 */
export function parseNumeroBR(valor: string | number | null | undefined): number {
  if (valor == null) return 0;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;

  const texto = valor.trim();
  if (texto === "") return 0;

  const temVirgula = texto.includes(",");
  const temPonto = texto.includes(".");

  let normalizado = texto;
  if (temVirgula && temPonto) {
    // Padrão BR com milhar: "1.234,56" -> remove os pontos (milhar) e troca a vírgula pelo ponto decimal.
    normalizado = texto.replace(/\./g, "").replace(",", ".");
  } else if (temVirgula) {
    // Só vírgula: é o separador decimal. "1234,56" -> "1234.56"
    normalizado = texto.replace(",", ".");
  } else if (temPonto) {
    // Só ponto: no padrão BR o ponto é separador de milhar ("1.000" -> 1000;
    // "1.234.567" -> 1234567). Exceção (mesma regra do Grupo Santa Fé): UM
    // ponto seguido de 1–2 dígitos é decimal — formato de valor vindo do banco
    // ("1234.56").
    const pontos = texto.match(/\./g)!.length;
    const ultimoTrecho = texto.slice(texto.lastIndexOf(".") + 1);
    const decimalDoBanco = pontos === 1 && ultimoTrecho.length >= 1 && ultimoTrecho.length <= 2;
    if (!decimalDoBanco) normalizado = texto.replace(/\./g, "");
  }

  const n = parseFloat(normalizado);
  return Number.isFinite(n) ? n : 0;
}
