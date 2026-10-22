import { describe, expect, it } from "vitest";
import { compareCardDueDates, todayInImperatriz, validateCardDueDate } from "./lead-card-deadline-schema.js";

describe("vencimentos individuais dos cards", () => {
  it("ordena vencidos, hoje, futuros e sem data, sem misturar cards", () => {
    const cards = [
      { id: 1, cardDueDate: null }, { id: 2, cardDueDate: "2026-10-23" },
      { id: 3, cardDueDate: "2026-10-21" }, { id: 4, cardDueDate: "2026-10-22" },
    ];
    expect(cards.sort(compareCardDueDates).map(card => card.id)).toEqual([3, 4, 2, 1]);
  });
  it("usa o dia de Imperatriz no limite UTC e recusa datas inexistentes", () => {
    expect(todayInImperatriz(new Date("2026-10-22T02:59:59Z"))).toBe("2026-10-21");
    expect(todayInImperatriz(new Date("2026-10-22T03:00:00Z"))).toBe("2026-10-22");
    expect(() => validateCardDueDate("2026-02-30")).toThrow();
    expect(validateCardDueDate(null)).toBeNull();
  });
});
