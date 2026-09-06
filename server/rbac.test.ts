import { describe, it, expect } from "vitest";
import { hasRole, requireRole, STAFF_ROLES } from "./_core/rbac";
import { TRPCError } from "@trpc/server";

describe("hasRole", () => {
  it("returns true when role is in the allowed list", () => {
    expect(hasRole("admin", ["admin"])).toBe(true);
    expect(hasRole("corretor", STAFF_ROLES)).toBe(true);
  });

  it("returns false when role is not in the allowed list", () => {
    expect(hasRole("cliente", STAFF_ROLES)).toBe(false);
    expect(hasRole("admin", ["corretor"])).toBe(false);
  });

  it("returns false for undefined role", () => {
    expect(hasRole(undefined, ["admin"])).toBe(false);
  });
});

describe("requireRole", () => {
  it("does not throw when the user has an allowed role", () => {
    expect(() => requireRole({ user: { role: "admin" } }, ["admin"])).not.toThrow();
    expect(() => requireRole({ user: { role: "colaborador" } }, STAFF_ROLES)).not.toThrow();
  });

  it("throws FORBIDDEN when the user's role is not allowed", () => {
    expect(() => requireRole({ user: { role: "cliente" } }, STAFF_ROLES)).toThrow(TRPCError);
    try {
      requireRole({ user: { role: "cliente" } }, ["admin"]);
    } catch (e) {
      expect(e).toBeInstanceOf(TRPCError);
      expect((e as TRPCError).code).toBe("FORBIDDEN");
      expect((e as TRPCError).message).toBe("Acesso negado");
    }
  });

  it("accepts a custom message", () => {
    try {
      requireRole({ user: { role: "cliente" } }, ["admin"], "Apenas administradores");
    } catch (e) {
      expect((e as TRPCError).message).toBe("Apenas administradores");
    }
  });
});
