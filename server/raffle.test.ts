import { describe, expect, it } from "vitest";
import {
  RAFFLE_NUMBER_SPACE,
  assignTicketNumbers,
  calculateUtefBonus,
  calculateUtefTotal,
  computeDrawCapacity,
  extractLotteryTargetNumber,
  pickWinningNumber,
} from "../shared/raffle";

describe("calculateUtefBonus", () => {
  it("não dá bônus abaixo de 1000 UTEFs", () => {
    expect(calculateUtefBonus(999)).toBe(0);
    expect(calculateUtefBonus(1)).toBe(0);
    expect(calculateUtefBonus(0)).toBe(0);
  });

  it("dá 10% de bônus a partir de 1000 UTEFs, arredondado para baixo", () => {
    expect(calculateUtefBonus(1000)).toBe(100);
    expect(calculateUtefBonus(1500)).toBe(150);
    expect(calculateUtefBonus(1005)).toBe(100); // 100.5 -> floor
  });

  it("calculateUtefTotal soma bônus ao principal, usando a mesma função", () => {
    expect(calculateUtefTotal(999)).toEqual({ bonus: 0, total: 999 });
    expect(calculateUtefTotal(2000)).toEqual({ bonus: 200, total: 2200 });
  });
});

describe("computeDrawCapacity", () => {
  it("calcula capacidade como targetAmount / ticketPrice", () => {
    expect(computeDrawCapacity(100_000, 10)).toBe(10_000);
  });

  it("nunca excede o espaço de números (100000)", () => {
    expect(computeDrawCapacity(10_000_000_000, 1)).toBe(RAFFLE_NUMBER_SPACE);
  });

  it("usa o espaço completo se ticketPrice for zero/inválido", () => {
    expect(computeDrawCapacity(100_000, 0)).toBe(RAFFLE_NUMBER_SPACE);
  });
});

describe("assignTicketNumbers", () => {
  it("atribui números sequenciais proporcionais à quantidade comprada", () => {
    expect(assignTicketNumbers(0, 1, 100)).toEqual([0]);
    expect(assignTicketNumbers(0, 5, 100)).toEqual([0, 1, 2, 3, 4]);
    // Quem compra 100 bilhetes recebe 100 números distintos - não apenas 1 número
    // com um multiplicador implícito, que era o bug original (fairness).
    expect(assignTicketNumbers(50, 100, 1000)).toHaveLength(100);
    expect(assignTicketNumbers(50, 100, 1000)).toEqual(
      Array.from({ length: 100 }, (_, i) => 50 + i),
    );
  });

  it("retorna null se excederia a capacidade do sorteio", () => {
    expect(assignTicketNumbers(95, 10, 100)).toBeNull();
    expect(assignTicketNumbers(100, 1, 100)).toBeNull();
  });

  it("permite exatamente até a capacidade (sem ultrapassar)", () => {
    expect(assignTicketNumbers(90, 10, 100)).toEqual(
      Array.from({ length: 10 }, (_, i) => 90 + i),
    );
  });
});

describe("extractLotteryTargetNumber", () => {
  it("extrai os 5 últimos dígitos do resultado da Loteria Federal", () => {
    expect(extractLotteryTargetNumber("12345")).toBe(12345);
    expect(extractLotteryTargetNumber("9876543210")).toBe(43210);
  });

  it("ignora caracteres não numéricos antes de extrair", () => {
    expect(extractLotteryTargetNumber("1º prêmio: 00042")).toBe(42);
  });

  it("retorna null se não houver ao menos 5 dígitos", () => {
    expect(extractLotteryTargetNumber("123")).toBeNull();
    expect(extractLotteryTargetNumber("")).toBeNull();
  });
});

describe("pickWinningNumber", () => {
  it("retorna o próprio número-alvo se ele foi vendido", () => {
    expect(pickWinningNumber([10, 50, 99], 50)).toBe(50);
  });

  it("retorna o número vendido imediatamente anterior, se o alvo não existir", () => {
    // Regra pública: "vence o bilhete com numeração imediatamente anterior"
    expect(pickWinningNumber([10, 50, 99], 51)).toBe(50);
    expect(pickWinningNumber([10, 50, 99], 60)).toBe(50);
  });

  it("busca cíclica: se o alvo for menor que todos os vendidos, dá a volta pelo topo do espaço", () => {
    expect(pickWinningNumber([99998, 99999], 5)).toBe(99999);
  });

  it("com um único número vendido, ele sempre ganha, seja qual for o alvo", () => {
    expect(pickWinningNumber([42], 0)).toBe(42);
    expect(pickWinningNumber([42], 99999)).toBe(42);
  });

  it("retorna null se não houver nenhum número vendido", () => {
    expect(pickWinningNumber([], 123)).toBeNull();
  });

  it("chance proporcional: mais números vendidos por um comprador aumentam a chance dele ganhar", () => {
    // Comprador A tem 1 número (500), comprador B tem 100 números (1000..1099).
    // Qualquer alvo dentro de [1000,1099] cai com B; qualquer alvo == 500 cai com A.
    // Isso é o que corrige o bug original (seleção por linha ignorava quantity).
    const bNumbers = Array.from({ length: 100 }, (_, i) => 1000 + i);
    const allSold = [500, ...bNumbers];
    expect(pickWinningNumber(allSold, 500)).toBe(500);
    expect(pickWinningNumber(allSold, 1050)).toBe(1050);
  });
});
