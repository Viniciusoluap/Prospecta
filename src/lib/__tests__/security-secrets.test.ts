import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { secretsMatch, verifyHmacSha256 } from "@/lib/security/secrets";

describe("secretsMatch", () => {
  it("aceita somente o segredo idêntico", () => {
    expect(secretsMatch("token-seguro", "token-seguro")).toBe(true);
    expect(secretsMatch("token-alterado", "token-seguro")).toBe(false);
  });

  it("rejeita valor ausente ou com tamanho diferente", () => {
    expect(secretsMatch(null, "token-seguro")).toBe(false);
    expect(secretsMatch("curto", "token-seguro")).toBe(false);
  });
});

describe("verifyHmacSha256", () => {
  it("valida a assinatura do corpo sem aceitar alterações", () => {
    const signature = createHmac("sha256", "segredo").update("payload").digest("hex");
    expect(verifyHmacSha256("payload", signature, "segredo")).toBe(true);
    expect(verifyHmacSha256("payload-alterado", signature, "segredo")).toBe(false);
  });
});
