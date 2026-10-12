// Mesmo conteúdo em Grupo-Santa-Fe/web/src/lib/__tests__/email-erro.test.ts.
import { describe, expect, it } from "vitest";
import { descreverErroSmtp } from "../shared/email-erro";

describe("descreverErroSmtp", () => {
  it("senha recusada orienta senha de app", () => {
    expect(descreverErroSmtp({ code: "EAUTH", responseCode: 535, message: "Invalid login" })).toContain("senha de app");
  });
  it("conexão: confere host e porta", () => {
    expect(descreverErroSmtp({ code: "ETIMEDOUT" })).toContain("SMTP_HOST");
    expect(descreverErroSmtp({ code: "ENOTFOUND" })).toContain("(código ENOTFOUND)");
  });
  it("erro desconhecido não vaza dados", () => {
    expect(descreverErroSmtp(new Error("senha=abc"))).toBe("Falha desconhecida no envio.");
    expect(descreverErroSmtp(null)).toBe("Falha desconhecida no envio.");
  });
});
