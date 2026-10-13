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

  it("permissao imoveis acessa a captação consolidada, mas permissão alheia não", () => {
    const colaborador = { role: "colaborador", permissions: JSON.stringify(["imoveis"]) };
    const semAcesso = { role: "colaborador", permissions: JSON.stringify(["crm"]) };
    expect(canAccessAdminProcedure(colaborador, "agregador.list")).toBe(true);
    expect(canAccessAdminProcedure(semAcesso, "agregador.list")).toBe(false);
  });

  it("item 06: corretor não usa módulos do painel além de Agenda e WhatsApp, mesmo com permissões gravadas", () => {
    const corretor = { role: "corretor", permissions: JSON.stringify(["imoveis", "crm", "obras"]) };
    expect(canAccessAdminProcedure(corretor, "agregador.list")).toBe(false);
    expect(canAccessAdminProcedure(corretor, "leads.list")).toBe(false);
    expect(canAccessAdminProcedure(corretor, "agenda.list")).toBe(true);
    expect(canAccessAdminProcedure(corretor, "whatsapp.historico")).toBe(true);
    expect(canAccessAdminProcedure({ ...corretor, active: false }, "agenda.list")).toBe(false);
    expect(canAccessAdminProcedure({ role: "cliente", permissions: '["obras"]' }, "construction.allProjects")).toBe(false);
    expect(canAccessAdminProcedure({ role: "empreiteiro", permissions: '["obras"]' }, "construction.allProjects")).toBe(false);
  });

  it("colaborador com a permissao agregador acessa o modulo", () => {
    const colaborador = { role: "colaborador", permissions: JSON.stringify(["agregador"]) };
    expect(canAccessAdminProcedure(colaborador, "agregador.list")).toBe(true);
  });
});
