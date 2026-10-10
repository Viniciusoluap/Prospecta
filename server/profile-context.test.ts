import { describe, expect, it } from "vitest";
import {
  requireBrokerContext,
  requireClientContext,
  isActiveFinancingStatus,
} from "./profile-context";

const user = (
  overrides: Partial<{
    id: number;
    role: string;
    active: boolean;
    leadId: number | null;
  }> = {}
) =>
  ({
    id: 10,
    role: "cliente",
    active: true,
    leadId: 22,
    ...overrides,
  }) as any;

describe("profile access context", () => {
  it("derives client scope only from the authenticated user", () => {
    expect(requireClientContext(user())).toEqual({ userId: 10, leadId: 22 });
  });

  it("blocks clients without a persisted lead link", () => {
    expect(() => requireClientContext(user({ leadId: null }))).toThrow(
      "ainda não vinculado"
    );
  });

  it("does not let a requested portal elevate the stored role", () => {
    expect(() => requireClientContext(user({ role: "corretor" }))).toThrow(
      "não possui perfil de cliente"
    );
    expect(() => requireBrokerContext(user({ role: "cliente" }))).toThrow(
      "não possui perfil de corretor"
    );
  });

  it("uses the authenticated user id as broker scope", () => {
    expect(
      requireBrokerContext(user({ role: "corretor", leadId: null }))
    ).toEqual({ userId: 10, brokerId: 10 });
  });

  it("recognizes only in-progress financing statuses as active", () => {
    expect(isActiveFinancingStatus("analise_banco")).toBe(true);
    expect(isActiveFinancingStatus("liberado")).toBe(false);
    expect(isActiveFinancingStatus("cancelado")).toBe(false);
  });
});
