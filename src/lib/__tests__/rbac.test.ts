import { describe, it, expect } from "vitest";
import type { Session } from "next-auth";
import { apiRoleError, canAccessAdminPath, getSessionRole, hasRole, requireActionRole } from "@/lib/auth/rbac";

function makeSession(role: string): Session {
  return {
    user: { role, name: "Test", email: "test@example.com", image: null },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as unknown as Session;
}

describe("hasRole", () => {
  it("returns false for null session", () => {
    expect(hasRole(null, "admin")).toBe(false);
  });
  it("returns true when role matches", () => {
    expect(hasRole(makeSession("admin"), "admin")).toBe(true);
  });
  it("returns true when role is in multiple allowed roles", () => {
    expect(hasRole(makeSession("corretor"), "admin", "corretor")).toBe(true);
  });
  it("returns false when role is not in allowed roles", () => {
    expect(hasRole(makeSession("corretor"), "admin")).toBe(false);
  });
  it("returns false for colaborador when only admin allowed", () => {
    expect(hasRole(makeSession("colaborador"), "admin")).toBe(false);
  });
  it("returns true for colaborador when colaborador is in allowed roles", () => {
    expect(hasRole(makeSession("colaborador"), "admin", "corretor", "colaborador")).toBe(true);
  });
  it("returns false for cliente role", () => {
    expect(hasRole(makeSession("cliente"), "admin", "corretor", "colaborador")).toBe(false);
  });
});

describe("requireActionRole", () => {
  it("throws 'Não autorizado' for null session", () => {
    expect(() => requireActionRole(null, "admin")).toThrow("Não autorizado");
  });
  it("throws 'Não autorizado' when role does not match", () => {
    expect(() => requireActionRole(makeSession("corretor"), "admin")).toThrow("Não autorizado");
  });
  it("does NOT throw when role matches", () => {
    expect(() => requireActionRole(makeSession("admin"), "admin")).not.toThrow();
  });
  it("does NOT throw for corretor when corretor is allowed", () => {
    expect(() =>
      requireActionRole(makeSession("corretor"), "admin", "corretor")
    ).not.toThrow();
  });
  it("throws for cliente even with broad role list", () => {
    expect(() =>
      requireActionRole(makeSession("cliente"), "admin", "corretor", "colaborador")
    ).toThrow("Não autorizado");
  });
});

describe("RBAC de páginas e APIs", () => {
  it("rejeita papéis desconhecidos", () => {
    expect(getSessionRole(makeSession("superadmin"))).toBeNull();
  });

  it("permite equipe nas páginas operacionais", () => {
    expect(canAccessAdminPath(makeSession("corretor"), "/admin/leads")).toBe(true);
    expect(canAccessAdminPath(makeSession("colaborador"), "/admin/agenda")).toBe(true);
  });

  it("restringe páginas administrativas sensíveis ao admin", () => {
    expect(canAccessAdminPath(makeSession("admin"), "/admin/configuracoes")).toBe(true);
    expect(canAccessAdminPath(makeSession("corretor"), "/admin/configuracoes")).toBe(false);
    expect(canAccessAdminPath(makeSession("colaborador"), "/admin/relatorios")).toBe(false);
    expect(canAccessAdminPath(makeSession("cliente"), "/admin/leads")).toBe(false);
  });

  it("diferencia ausência de sessão e papel insuficiente nas APIs", async () => {
    expect(apiRoleError(null, "admin")?.status).toBe(401);
    expect(apiRoleError(makeSession("corretor"), "admin")?.status).toBe(403);
    expect(apiRoleError(makeSession("admin"), "admin")).toBeNull();
  });
});
