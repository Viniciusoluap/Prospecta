// Funcoes puras de integridade financeira e probabilistica do sorteio (UTEF/bilhetes).
// Extraidas para serem testaveis sem banco, seguindo o padrao de shared/operacional.ts.

// Espaco de numeros do sorteio: 00000-99999 (5 digitos), conforme a regra publica em
// client/src/pages/FAQ.tsx: "Os 5 ultimos digitos do 1o premio determinam o numero
// vencedor. Se nao houver bilhete correspondente, vence o bilhete com numeracao
// imediatamente anterior."
export const RAFFLE_NUMBER_SPACE = 100_000;

export function computeDrawCapacity(targetAmount: number, ticketPrice: number): number {
  if (ticketPrice <= 0) return RAFFLE_NUMBER_SPACE;
  return Math.min(RAFFLE_NUMBER_SPACE, Math.floor(targetAmount / ticketPrice));
}

// Atribuicao sequencial e deterministica de numeros individuais para uma compra de
// `quantity` bilhetes, a partir da quantidade ja reservada atomicamente em `ticketsSold`
// (ver server/db.ts reserveDrawCapacity). Retorna null se excederia a capacidade.
export function assignTicketNumbers(
  ticketsSoldBefore: number,
  quantity: number,
  capacity: number,
): number[] | null {
  if (ticketsSoldBefore + quantity > capacity) return null;
  return Array.from({ length: quantity }, (_, i) => ticketsSoldBefore + i);
}

// Extrai os 5 ultimos digitos do resultado da Loteria Federal (1o premio) como o
// numero-alvo do sorteio (0-99999).
export function extractLotteryTargetNumber(lotteryResult: string): number | null {
  const digitsOnly = lotteryResult.replace(/\D/g, "");
  if (digitsOnly.length < 5) return null;
  const last5 = digitsOnly.slice(-5);
  return parseInt(last5, 10);
}

// Busca o numero vencedor: exato, ou o numero vendido imediatamente anterior (ciclico),
// conforme a regra publica. `soldNumbers` deve conter todos os numeros efetivamente
// vendidos (bilhetes confirmados) no sorteio. Retorna null se nao houver nenhum numero
// vendido (sorteio sem bilhetes confirmados nao deveria chegar aqui).
export function pickWinningNumber(soldNumbers: number[], targetNumber: number): number | null {
  if (soldNumbers.length === 0) return null;
  const sold = new Set(soldNumbers);
  for (let offset = 0; offset < RAFFLE_NUMBER_SPACE; offset++) {
    const candidate = ((targetNumber - offset) % RAFFLE_NUMBER_SPACE + RAFFLE_NUMBER_SPACE) % RAFFLE_NUMBER_SPACE;
    if (sold.has(candidate)) return candidate;
  }
  return null;
}

// Bonus UTEF: 10% para compras de 1000 UTEFs ou mais, arredondado para baixo.
// Unica fonte de verdade - usada na pre-visualizacao (ordem) e na liquidacao (credito).
export function calculateUtefBonus(principalAmount: number): number {
  if (principalAmount < 1000) return 0;
  return Math.floor(principalAmount * 0.1);
}

export function calculateUtefTotal(principalAmount: number): { bonus: number; total: number } {
  const bonus = calculateUtefBonus(principalAmount);
  return { bonus, total: principalAmount + bonus };
}
