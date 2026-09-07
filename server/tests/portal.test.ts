import { describe, expect, it } from "vitest";
import { portalChatMessages, portalContractDocuments, portalContracts, portalVisits, users } from "../../drizzle/schema";
import { assertProvisionable, clientLeadId, isValidSignedPdf, portalRouter } from "../portal-router";

describe("EPIC-002 - Portal do Cliente", () => {
  it("declara vínculo e entidades persistentes do portal", () => {
    expect(users.leadId).toBeDefined();
    expect(portalVisits).toBeDefined();
    expect(portalContracts).toBeDefined();
    expect(portalContractDocuments).toBeDefined();
    expect(portalChatMessages).toBeDefined();
  });

  it("expõe operações isoladas do cliente e operações administrativas", () => {
    const procedures = portalRouter._def.procedures;
    for (const name of ["dashboard", "activities", "visits", "contracts", "uploadSignedContract", "messages", "sendMessage"]) {
      expect(procedures[name]).toBeDefined();
    }
    for (const name of ["admin.overview", "admin.provisionAccess", "admin.createVisit", "admin.createContract", "admin.addDocument", "admin.setSignatureStatus", "admin.sendMessage"]) {
      expect(procedures[name]).toBeDefined();
    }
  });

  it("obtém o lead exclusivamente do usuário cliente autenticado", () => {
    expect(clientLeadId({ user: { role: "cliente", leadId: 42 } })).toBe(42);
    expect(() => clientLeadId({ user: { role: "cliente", leadId: null } })).toThrow("Perfil não vinculado");
    expect(() => clientLeadId({ user: { role: "admin", leadId: 42 } })).toThrow("Acesso negado");
  });

  it("aceita somente conteúdo PDF dentro do limite", () => {
    expect(isValidSignedPdf(Buffer.from("%PDF-1.7\nconteudo"))).toBe(true);
    expect(isValidSignedPdf(Buffer.from("arquivo falso"))).toBe(false);
    expect(isValidSignedPdf(Buffer.alloc(10 * 1024 * 1024 + 1, 1))).toBe(false);
  });

  it("impede que o provisionamento sobrescreva outra conta", () => {
    expect(() => assertProvisionable(undefined, 42)).not.toThrow();
    expect(() => assertProvisionable({ role: "cliente", leadId: 42 }, 42)).not.toThrow();
    expect(() => assertProvisionable({ role: "admin", leadId: null }, 42)).toThrow("outra conta");
    expect(() => assertProvisionable({ role: "cliente", leadId: 7 }, 42)).toThrow("outra conta");
  });

  it("rejeita mensagens acima de 2.000 caracteres antes de consultar o banco", async () => {
    const caller = portalRouter.createCaller({ user: { id: 1, role: "cliente", leadId: 42 } } as never);
    await expect(caller.sendMessage({ text: "x".repeat(2001) })).rejects.toThrow();
  });
});
