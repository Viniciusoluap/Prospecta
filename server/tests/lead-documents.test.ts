import { describe, expect, it } from "vitest";
import { authorizedLead } from "../lead-documents-router.js";

describe("private lead document access", () => {
  const client = { id: 10, role: "cliente" as const, active: true, leadId: 42, permissions: null };

  it("allows a client to access only their own lead", () => {
    expect(authorizedLead(client)).toBe(42);
    expect(authorizedLead(client, 42)).toBe(42);
    expect(() => authorizedLead(client, 43)).toThrow();
  });

  it("rejects inactive accounts and unlinked clients", () => {
    expect(() => authorizedLead({ ...client, active: false }, 42)).toThrow();
    expect(() => authorizedLead({ ...client, leadId: null }, 42)).toThrow();
  });

  it("allows authorized CRM operators and blocks unrelated operators", () => {
    const collaborator = { ...client, role: "colaborador" as const, leadId: null, permissions: '["crm"]' };
    expect(authorizedLead(collaborator, 43)).toBe(43);
    expect(() => authorizedLead({ ...collaborator, permissions: "[]" }, 43)).toThrow();
  });
});
