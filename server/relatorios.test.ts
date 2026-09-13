import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { ADMIN_MODULES } from "../shared/admin-permissions";
import { canAccessAdminProcedure } from "./_core/trpc";

describe("EPIC-012 S-07 (Etapa 5) - Central de Relatorios", () => {
  it("expoe as procedures de overview e exportacao de comissoes", () => {
    const procedures = appRouter._def.procedures;
    expect(procedures["relatorios.overview"]).toBeDefined();
    expect(procedures["relatorios.exportComissoesCsv"]).toBeDefined();
  });

  it("o modulo relatorios existe no catalogo de permissoes", () => {
    expect(ADMIN_MODULES).toContain("relatorios");
  });

  it("um colaborador so acessa relatorios com a permissao concedida", () => {
    const semPermissao = { role: "colaborador", permissions: JSON.stringify(["imoveis"]) };
    const comPermissao = { role: "colaborador", permissions: JSON.stringify(["relatorios"]) };
    expect(canAccessAdminProcedure(semPermissao, "relatorios.overview")).toBe(false);
    expect(canAccessAdminProcedure(comPermissao, "relatorios.overview")).toBe(true);
  });

  it("admin sempre acessa relatorios independente de permissoes", () => {
    expect(canAccessAdminProcedure({ role: "admin", permissions: null }, "relatorios.overview")).toBe(true);
  });

  it("expoe leadOptions no router de avaliacoes (para vinculo na edicao dedicada)", () => {
    const procedures = appRouter._def.procedures;
    expect(procedures["avaliacoes.leadOptions"]).toBeDefined();
  });
});
