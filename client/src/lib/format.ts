// Formatação central de moeda/percentual para EXIBIÇÃO (somente leitura),
// no padrão brasileiro. Não confundir com `formatCurrency(cents)` em
// `client/src/const.ts`, que é de outro domínio (sorteios/UTEF, valor em
// centavos) e não deve ser alterado por este lote.
//
// Para campos EDITÁVEIS, use `CurrencyInput`/`PercentInput`
// (`@/components/ui/currency-input` e `@/components/ui/percent-input`),
// que cuidam do buffer de texto + `parseNumeroBR` durante a digitação.
// Estas funções aqui só formatam um número já pronto para mostrar.

/**
 * Formata um valor em reais (não em centavos) como moeda brasileira.
 * Ex.: `formatCurrency(1234.5)` -> "R$ 1.234,50".
 */
export function formatCurrency(valorEmReais: number): string {
  const numero = Number.isFinite(valorEmReais) ? valorEmReais : 0;
  return numero.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/**
 * Formata um percentual para exibição. `valor` é o número já na escala
 * percentual (ex.: `6` para "6%", não `0.06`) — a mesma convenção usada
 * pelos campos editáveis desta família (`PercentInput`). Quem já guarda
 * o percentual como fração 0-1 (ex.: parâmetros urbanísticos) deve
 * multiplicar por 100 antes de chamar esta função.
 */
export function formatPercent(valor: number, maximumFractionDigits = 2): string {
  const numero = Number.isFinite(valor) ? valor : 0;
  // Padrão numérico global (lote 3): sempre 2 casas ("6,00%"), salvo quem
  // pede menos casas explicitamente.
  const minimumFractionDigits = Math.min(2, maximumFractionDigits);
  return `${numero.toLocaleString("pt-BR", { minimumFractionDigits, maximumFractionDigits })}%`;
}

/**
 * Formata uma área em m² para exibição, sempre com 2 casas decimais
 * (decisão do dono de 30/10/2026): `formatArea(1234.5)` -> "1.234,50 m²".
 * Só exibição — não arredonda nada que vá para cálculo. Gêmeo de
 * `formatArea` do Santa Fé (`web/src/lib/utils.ts`).
 */
export function formatArea(valorM2: number): string {
  const numero = Number.isFinite(valorM2) ? valorM2 : 0;
  return `${numero.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
}
