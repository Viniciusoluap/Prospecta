import { describe, expect, it } from "vitest";
import {
  asaasValueToCents,
  calculatePurchasedUtefs,
  normalizeAsaasWebhookEvent,
  parseTicketPurchaseReference,
  parseUtefPurchaseReference,
} from "@/lib/legacy/ecossistema-ledger";

describe("webhooks do ecossistema", () => {
  it("normaliza apenas os eventos financeiros suportados", () => {
    expect(normalizeAsaasWebhookEvent("PAYMENT_CONFIRMED")).toBe("confirmed");
    expect(normalizeAsaasWebhookEvent("PAYMENT_RECEIVED")).toBe("confirmed");
    expect(normalizeAsaasWebhookEvent("PAYMENT_REFUNDED")).toBe("refunded");
    expect(normalizeAsaasWebhookEvent("PAYMENT_OVERDUE")).toBeNull();
  });

  it("aceita somente referências internas de bilhete e UTEF", () => {
    expect(parseTicketPurchaseReference("ticket_purchase_42")).toBe(42);
    expect(parseTicketPurchaseReference("ticket_purchase_42_extra")).toBeNull();
    expect(parseTicketPurchaseReference(42 as never)).toBeNull();
    expect(parseUtefPurchaseReference("utef_purchase_7_aeb5cc52-7722-42e1-a2b1-1a2b3c4d5e6f")).toBe(7);
    expect(parseUtefPurchaseReference("utef_purchase_zero_token")).toBeNull();
  });

  it("converte o valor do Asaas em centavos sem arredondar valores inválidos", () => {
    expect(asaasValueToCents(123.45)).toBe(12_345);
    expect(() => asaasValueToCents(0)).toThrow("Valor de pagamento inválido");
    expect(() => asaasValueToCents(1.234)).toThrow("duas casas decimais");
  });

  it("calcula o bônus UTEF somente para compras elegíveis", () => {
    expect(calculatePurchasedUtefs(999)).toEqual({ base: 999, bonus: 0, total: 999 });
    expect(calculatePurchasedUtefs(1_000)).toEqual({ base: 1_000, bonus: 100, total: 1_100 });
    expect(() => calculatePurchasedUtefs(100.5)).toThrow("Quantidade de UTEFs inválida");
  });
});
