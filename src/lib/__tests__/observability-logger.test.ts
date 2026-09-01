import { afterEach, describe, expect, it, vi } from "vitest";
import { logOperationalError, requestId } from "@/lib/observability/logger";

afterEach(() => vi.restoreAllMocks());

describe("observabilidade operacional", () => {
  it("reaproveita o identificador recebido", () => {
    const request = new Request("https://prospectaconstrucoes.com", {
      headers: { "x-request-id": "req-123" },
    });
    expect(requestId(request)).toBe("req-123");
  });

  it("gera JSON estruturado sem registrar a mensagem interna do erro", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logOperationalError("payment.failed", new Error("segredo-na-mensagem"), {
      correlationId: "req-123",
    });
    const entry = String(spy.mock.calls[0]?.[0]);
    expect(JSON.parse(entry)).toMatchObject({
      level: "error",
      event: "payment.failed",
      errorName: "Error",
      correlationId: "req-123",
    });
    expect(entry).not.toContain("segredo-na-mensagem");
  });
});
