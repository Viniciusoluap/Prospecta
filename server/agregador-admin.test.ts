import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { canAccessAdminProcedure } from "./_core/trpc";

describe("EPIC-012 S-07 (Etapa 5) - Tela admin de Agregador/Feeds", () => {
  it("expoe todas as procedures consumidas pela tela admin", () => {
    const procedures = appRouter._def.procedures;
    expect(procedures["agregador.list"]).toBeDefined();
    expect(procedures["agregador.scrape"]).toBeDefined();
    expect(procedures["agregador.create"]).toBeDefined();
    expect(procedures["agregador.updateStatus"]).toBeDefined();
    expect(procedures["agregador.importarParaCatalogo"]).toBeDefined();
  });

  it("corretor sem a permissao agregador nao acessa o modulo", () => {
    const corretor = { role: "corretor", permissions: JSON.stringify(["imoveis"]) };
    expect(canAccessAdminProcedure(corretor, "agregador.list")).toBe(false);
  });

  it("colaborador com a permissao agregador acessa o modulo", () => {
    const colaborador = { role: "colaborador", permissions: JSON.stringify(["agregador"]) };
    expect(canAccessAdminProcedure(colaborador, "agregador.list")).toBe(true);
  });
});
