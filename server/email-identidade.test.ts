import { describe, expect, it } from "vitest";
import { IDENTIDADE_EMAIL, rodapeEmail } from "../shared/email-identidade";
import { adminNotificationTemplate, budgetConfirmationTemplate, paymentConfirmedTemplate, primeiroAcessoTemplate } from "./_core/email-smtp";
import { emailTemplates } from "./_core/email";

const ano = new Date().getFullYear();

describe("identidade dos e-mails da Prospecta (item 08)", () => {
  it("rodapé com o ano atual (dinâmico)", () => {
    expect(rodapeEmail(new Date("2031-05-01T12:00:00Z"))).toBe("© 2031 Prospecta Construções - VFX Capital");
    expect(rodapeEmail()).toBe(`© ${ano} ${IDENTIDADE_EMAIL}`);
  });
  const renderizados = [
    budgetConfirmationTemplate({ name: "João", projectType: "Casa", city: "Imperatriz" }),
    paymentConfirmedTemplate({ name: "João", amount: 100, type: "bilhete", quantity: 1 }),
    adminNotificationTemplate({ titulo: "Novo lead", linhas: [{ label: "Nome", valor: "João" }] }),
    primeiroAcessoTemplate({ name: "João", link: "https://x", novoUsuario: true }),
    primeiroAcessoTemplate({ name: "João", link: "https://x", novoUsuario: false }),
    emailTemplates.welcome("João"),
    emailTemplates.budgetConfirmation("João", "Casa", "Imperatriz"),
    emailTemplates.budgetUpdate("João", "aprovado", ""),
    emailTemplates.drawWinner("João", "Sorteio", 100),
    emailTemplates.promotionalCampaign("Oferta", "Texto"),
  ];
  it.each(renderizados.map((t, i) => [i, t] as const))("template %i sem identidade antiga e com rodapé novo", (_i, t) => {
    const texto = `${t.subject}\n${t.html}`;
    expect(texto).not.toMatch(/Efficaz|Prospecta Empreendimentos/);
    expect(t.html).toContain(`© ${ano} Prospecta Construções - VFX Capital`);
  });
});
