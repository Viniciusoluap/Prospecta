import { describe, expect, it } from "vitest";
import { Buffer } from "buffer";
import { contratoInputSchema } from "../shared/juridico";
import { isValidContractPdf } from "./juridico-router";

describe("Jurídico", () => {
  const valid = {
    type: "compra_venda" as const,
    partyA: "Prospecta Construções",
    partyB: "Cliente Teste",
    value: 250_000,
    status: "rascunho" as const,
    signatureStatus: "pendente" as const,
  };

  it("valida o contrato completo", () => {
    expect(contratoInputSchema.parse(valid).value).toBe(250_000);
  });

  it("recusa valor negativo", () => {
    expect(() => contratoInputSchema.parse({ ...valid, value: -1 })).toThrow();
  });

  it("aceita apenas PDF válido dentro do limite", () => {
    expect(isValidContractPdf(Buffer.from("%PDF-1.7 contrato"))).toBe(true);
    expect(isValidContractPdf(Buffer.from("arquivo inválido"))).toBe(false);
  });
});
