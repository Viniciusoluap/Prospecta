import { describe, expect, it } from "vitest";
import { ADMIN_MODULES, normalizePermissions, parsePermissions } from "../shared/admin-permissions";
import { canAccessAdminProcedure } from "./_core/trpc";

describe("Permissões administrativas", () => {
  it("normaliza, remove duplicadas e ignora módulos desconhecidos", () => {
    expect(normalizePermissions(["crm", "crm", "juridico", "invalido"])).toEqual(["crm", "juridico"]);
  });

  it("não quebra com JSON inválido", () => {
    expect(parsePermissions("não-json")).toEqual([]);
  });

  it("mantém catálogo único e inclui todos os módulos P0", () => {
    expect(new Set(ADMIN_MODULES).size).toBe(ADMIN_MODULES.length);
    expect(ADMIN_MODULES).toEqual(expect.arrayContaining(["financiamentos", "juridico", "configuracoes"]));
  });

  it("aplica a permissão no procedimento tRPC sem limitar o administrador", () => {
    expect(canAccessAdminProcedure({ role: "admin", permissions: "[]" }, "juridico.list")).toBe(true);
    expect(canAccessAdminProcedure({ role: "colaborador", permissions: '["juridico"]' }, "juridico.list")).toBe(true);
    expect(canAccessAdminProcedure({ role: "colaborador", permissions: '["crm"]' }, "juridico.list")).toBe(false);
    expect(canAccessAdminProcedure({ role: "cliente", permissions: '["juridico"]' }, "juridico.list")).toBe(false);
  });
});
