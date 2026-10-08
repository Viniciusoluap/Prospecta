import { describe, expect, it, vi } from "vitest";
import { adminNotificationTemplate, budgetConfirmationTemplate, sendEmail } from "./_core/email-smtp";

function dependencies(
  options: { transportFails?: boolean; insertFails?: boolean } = {}
) {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  const returning = options.insertFails
    ? vi.fn().mockRejectedValue(new Error("audit unavailable"))
    : vi.fn().mockResolvedValue([{ id: 42 }]);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });
  const sendMail = options.transportFails
    ? vi.fn().mockRejectedValue(new Error("smtp unavailable"))
    : vi.fn().mockResolvedValue({ messageId: "local-message" });
  return {
    deps: { db: { insert, update } as never, transport: { sendMail } },
    mocks: { insert, values, returning, update, set, where, sendMail },
  };
}

describe("Email service", () => {
  const template = budgetConfirmationTemplate({
    name: "João",
    projectType: "Casa 47m²",
    city: "Imperatriz - MA",
  });
  const data = {
    to: "recipient@example.test",
    subject: template.subject,
    html: template.html,
    recipientName: "João",
    templateType: "budget_confirmation" as const,
    metadata: { budgetId: 999 },
  };

  it("gera o template esperado", () => {
    expect(template.subject).toContain("Orçamento Recebido");
    expect(template.html).toContain("João");
    expect(template.html).toContain("Casa 47m²");
  });

  it("persiste auditoria e envia usando dependências locais", async () => {
    const { deps, mocks } = dependencies();
    await expect(sendEmail(data, deps)).resolves.toBe(true);
    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: data.to,
        subject: data.subject,
        html: data.html,
      })
    );
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent" })
    );
  });

  it("marca auditoria como falha quando o transporte falha", async () => {
    const { deps, mocks } = dependencies({ transportFails: true });
    await expect(sendEmail(data, deps)).resolves.toBe(false);
    expect(mocks.set).toHaveBeenLastCalledWith({ status: "failed" });
  });

  it("não tenta SMTP quando a persistência inicial falha", async () => {
    const { deps, mocks } = dependencies({ insertFails: true });
    await expect(sendEmail(data, deps)).resolves.toBe(false);
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });
});

describe("adminNotificationTemplate", () => {
  it("escapa HTML vindo de valores de formulários públicos (evita XSS armazenado)", () => {
    const template = adminNotificationTemplate({
      titulo: "Nova mensagem recebida pelo site (Contato)",
      linhas: [
        { label: "Nome", valor: "<img src=x onerror=alert(1)>" },
        { label: "Mensagem", valor: "Olá & bem-vindo <script>alert('xss')</script>" },
      ],
    });

    expect(template.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(template.html).not.toContain("<script>alert('xss')</script>");
    expect(template.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(template.html).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
    expect(template.html).toContain("Olá &amp; bem-vindo");
  });

  it("mostra 'Não informado' quando o valor vem vazio", () => {
    const template = adminNotificationTemplate({
      titulo: "Teste",
      linhas: [{ label: "Telefone", valor: "" }],
    });
    expect(template.html).toContain("Não informado");
  });
});
