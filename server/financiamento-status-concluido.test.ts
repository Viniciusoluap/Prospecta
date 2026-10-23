import { describe, expect, it } from "vitest";
import { FINANCIAMENTO_STATUS, FINANCIAMENTO_STATUS_LABELS } from "../shared/financiamento.js";

describe("financiamento concluído", () => {
  it("exibe o status legado liberado como Concluído e mantém sua chave persistida", () => {
    expect(FINANCIAMENTO_STATUS).toContain("liberado");
    expect(FINANCIAMENTO_STATUS_LABELS.liberado).toBe("Concluído");
  });
});
