import { describe, expect, it } from "vitest";
import {
  FINANCIAMENTO_CHECKLIST_PADRAO,
  FINANCIAMENTO_STATUS,
  financiamentoInputSchema,
  financiamentoUpdateSchema,
} from "../shared/financiamento";

const valido = {
  clienteNome: "Maria da Silva",
  clienteTel: "(99) 99999-9999",
  clienteEmail: "maria@example.com",
  imovel: "Casa 12 — Residencial Prospecta",
  tipo: "mcmv" as const,
  banco: "caixa" as const,
  valorImovel: 300_000,
  valorFinanciado: 240_000,
  entrada: 60_000,
  taxa: 5.5,
  prazo: 360,
};

describe("financiamentoInputSchema", () => {
  it("aceita um processo válido", () => {
    expect(financiamentoInputSchema.parse(valido).clienteNome).toBe("Maria da Silva");
  });

  it("recusa financiamento superior ao valor do imóvel", () => {
    expect(() => financiamentoInputSchema.parse({ ...valido, valorFinanciado: 310_000 })).toThrow(
      "O valor financiado não pode superar o valor do imóvel",
    );
  });

  it("mantém o fluxo completo e o checklist da origem", () => {
    expect(FINANCIAMENTO_STATUS).toHaveLength(8);
    expect(FINANCIAMENTO_CHECKLIST_PADRAO).toHaveLength(15);
    expect(new Set(FINANCIAMENTO_CHECKLIST_PADRAO.map((item) => item.grupo))).toEqual(
      new Set(["Comprador", "Imóvel", "Banco"]),
    );
  });

  it("permite atualização parcial sem exigir os dois valores", () => {
    expect(financiamentoUpdateSchema.parse({ protocolo: "CEF-123" })).toEqual({ protocolo: "CEF-123" });
  });
});
