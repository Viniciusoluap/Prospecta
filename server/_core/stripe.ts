import Stripe from "stripe";
import { ENV } from "./env";

// Lazy initialization — avoids crashing the server if key is not set
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!ENV.stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    _stripe = new Stripe(ENV.stripeSecretKey, {
      apiVersion: "2025-10-29.clover",
      typescript: true,
    });
  }
  return _stripe;
}

// Keep named export for backwards compatibility — throws only when used
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return (getStripe() as any)[prop];
  },
});

export type StripeKeyKind = "secret" | "publishable";
export function isValidStripeKey(
  key: string | undefined,
  kind: StripeKeyKind
): boolean {
  if (!key) return false;
  const prefix = kind === "secret" ? "sk" : "pk";
  return new RegExp(`^${prefix}_(test|live)_[A-Za-z0-9_]+$`).test(key);
}
