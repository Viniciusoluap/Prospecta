import { describe, it, expect } from "vitest";
import { normalizarNumero, normalizarStatusWebhook } from "./_core/whatsapp-business";
import { WHATSAPP_TEMPLATES } from "../shared/whatsapp/templates";

describe("normalizarNumero", () => {
  it("mantém números que já têm o DDI 55", () => {
    expect(normalizarNumero("5594999999999")).toBe("5594999999999");
  });
  it("adiciona o DDI 55 quando ausente", () => {
    expect(normalizarNumero("94999999999")).toBe("5594999999999");
  });
  it("remove caracteres não numéricos antes de normalizar", () => {
    expect(normalizarNumero("+55 (94) 99999-9999")).toBe("5594999999999");
  });
});

describe("normalizarStatusWebhook", () => {
  it("mapeia delivery_ack/delivered para entregue", () => {
    expect(normalizarStatusWebhook("delivery_ack")).toBe("entregue");
    expect(normalizarStatusWebhook("delivered")).toBe("entregue");
  });
  it("mapeia read para lida", () => {
    expect(normalizarStatusWebhook("read")).toBe("lida");
  });
  it("mapeia failed/error para falhou", () => {
    expect(normalizarStatusWebhook("failed")).toBe("falhou");
    expect(normalizarStatusWebhook("error")).toBe("falhou");
  });
  it("usa 'enviada' como padrão para status desconhecido ou ausente", () => {
    expect(normalizarStatusWebhook("sent")).toBe("enviada");
    expect(normalizarStatusWebhook(undefined)).toBe("enviada");
  });
});

describe("WHATSAPP_TEMPLATES", () => {
  it("tem os 6 templates fixos da origem, cada um com corpo não vazio", () => {
    expect(WHATSAPP_TEMPLATES).toHaveLength(6);
    for (const t of WHATSAPP_TEMPLATES) {
      expect(t.body.length).toBeGreaterThan(0);
      expect(t.id).toBeTruthy();
    }
  });
});
