import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canAccessAdminProcedure } from "./_core/trpc";
import { appRouter } from "./routers";

describe("EPIC-015 - consolidação operacional", () => {
  it("expõe o setor tributário e o upload direto de produto", () => {
    const procedures = appRouter._def.procedures;
    expect(procedures["tax.overview"]).toBeDefined();
    expect(procedures["tax.profiles.create"]).toBeDefined();
    expect(procedures["tax.obligations.create"]).toBeDefined();
    expect(procedures["tax.ret.create"]).toBeDefined();
    expect(procedures["products.uploadImage"]).toBeDefined();
  });

  it("preserva permissões legadas ao consolidar BPO, Contabilidade e Relatórios", () => {
    for (const permission of ["bpo", "contabilidade", "relatorios"]) {
      const user = {
        role: "colaborador",
        permissions: JSON.stringify([permission]),
      };
      expect(canAccessAdminProcedure(user, "bpo.dre")).toBe(true);
      expect(canAccessAdminProcedure(user, "relatorios.overview")).toBe(true);
      expect(canAccessAdminProcedure(user, "tax.overview")).toBe(true);
    }
  });

  it("preserva permissões legadas nas áreas unificadas de tarefas e imóveis", () => {
    const agenda = {
      role: "colaborador",
      permissions: JSON.stringify(["agenda"]),
    };
    const agregador = {
      role: "colaborador",
      permissions: JSON.stringify(["agregador"]),
    };
    expect(canAccessAdminProcedure(agenda, "tasks.list")).toBe(true);
    expect(canAccessAdminProcedure(agenda, "agenda.list")).toBe(true);
    expect(canAccessAdminProcedure(agregador, "imoveis.list")).toBe(true);
    expect(canAccessAdminProcedure(agregador, "agregador.list")).toBe(true);
  });

  it("não libera as áreas consolidadas para permissões não relacionadas", () => {
    const user = {
      role: "colaborador",
      permissions: JSON.stringify(["crm"]),
    };
    expect(canAccessAdminProcedure(user, "bpo.dre")).toBe(false);
    expect(canAccessAdminProcedure(user, "tax.overview")).toBe(false);
    expect(canAccessAdminProcedure(user, "tasks.list")).toBe(false);
    expect(canAccessAdminProcedure(user, "imoveis.list")).toBe(false);
  });

  it("mantém o retorno único no canto superior esquerdo", () => {
    const source = readFileSync(
      resolve(process.cwd(), "client/src/components/GlobalBackButton.tsx"),
      "utf8"
    );
    expect(source).toContain("fixed left-4 top-4");
    expect(source).toContain("hasPageBackButton(location)");
    expect(source).not.toContain("bottom-5 left-5");
  });
});
