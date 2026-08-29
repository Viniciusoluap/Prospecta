import { describe, expect, it } from "vitest";
import { isValidStripeKey } from "./_core/stripe";

describe("Stripe key format validation", () => {
  it.each([undefined, "", "invalid", "pk_test_wrong_kind"])(
    "rejeita secret inválida: %s",
    key => {
      expect(isValidStripeKey(key, "secret")).toBe(false);
    }
  );
  it.each(["sk_test_fictitious", "sk_live_fictitious"])(
    "aceita formato de secret: %s",
    key => {
      expect(isValidStripeKey(key, "secret")).toBe(true);
    }
  );
  it.each([undefined, "", "invalid", "sk_test_wrong_kind"])(
    "rejeita publishable inválida: %s",
    key => {
      expect(isValidStripeKey(key, "publishable")).toBe(false);
    }
  );
  it.each(["pk_test_fictitious", "pk_live_fictitious"])(
    "aceita formato publishable: %s",
    key => {
      expect(isValidStripeKey(key, "publishable")).toBe(true);
    }
  );
});
