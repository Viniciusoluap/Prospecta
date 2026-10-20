import { beforeEach, describe, expect, it, vi } from "vitest";
import { notifyClientDocumentRequest } from "./document-request-notifications.js";
import { getDb } from "./db.js";
import { sendEmail } from "./_core/email-smtp.js";
vi.mock("./db.js", () => ({ getDb: vi.fn() }));
vi.mock("./_core/email-smtp.js", () => ({ sendEmail: vi.fn(), adminNotificationTemplate: () => ({ subject: "Documento solicitado", html: "portal" }) }));
function fake(lead: object) {
  let n = 0;
  const values = vi.fn();
  const chain = (value: unknown) => { const c = { from: () => c, where: () => c, limit: () => c, then: (resolve: (v: unknown) => unknown) => Promise.resolve(value).then(resolve) }; return c; };
  vi.mocked(getDb).mockReturnValue({ select: () => chain(n++ === 0 ? [lead] : [{ id: 7 }]), insert: () => ({ values }) } as never);
  return values;
}
describe("Aviso de documento solicitado", () => {
  beforeEach(() => vi.resetAllMocks());
  it("usa email atual do CRM e notifica só o acesso cliente vinculado", async () => {
    const insert = fake({ name: "Maria", email: "atual@example.com" });
    vi.mocked(sendEmail).mockResolvedValue(true);
    await expect(notifyClientDocumentRequest(42, "ART", "/portal/financiamento")).resolves.toMatchObject({ emailSent: true });
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({ userId: 7, relatedId: 42, actionUrl: "/portal/financiamento", type: "system" })]);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "atual@example.com", metadata: { leadId: 42, document: "ART", kind: "document_request" } }));
  });
  it("mantém aviso no portal e retorna falha explícita se email ausente", async () => {
    const insert = fake({ name: "Maria", email: null });
    const result = await notifyClientDocumentRequest(42, "ART");
    expect(result.emailSent).toBe(false);
    expect(result.emailWarning).toMatch(/sem email/);
    expect(insert).toHaveBeenCalledOnce();
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it("retorna aviso de falha SMTP sem dizer que email foi enviado", async () => {
    fake({ name: "Maria", email: "cliente@example.com" });
    vi.mocked(sendEmail).mockResolvedValue(false);
    expect(await notifyClientDocumentRequest(42, "ART")).toMatchObject({ emailSent: false, emailWarning: expect.stringContaining("não foi enviado") });
  });
});
