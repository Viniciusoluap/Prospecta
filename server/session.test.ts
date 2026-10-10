import { describe, expect, it } from "vitest";
import { sessaoAindaValida } from "../shared/session.js";

describe("sessaoAindaValida", () => {
  it("aceita quando sessionVersion do token bate com o do banco e usuário está ativo", () => {
    expect(sessaoAindaValida({ active: true, sessionVersion: 3 }, 3)).toBe(true);
  });

  it("rejeita quando a senha foi redefinida depois do token ser emitido (versão divergente)", () => {
    expect(sessaoAindaValida({ active: true, sessionVersion: 4 }, 3)).toBe(false);
  });

  it("rejeita quando o usuário foi desativado, mesmo com a versão batendo", () => {
    expect(sessaoAindaValida({ active: false, sessionVersion: 3 }, 3)).toBe(false);
  });

  it("rejeita quando o usuário não existe mais no banco", () => {
    expect(sessaoAindaValida(null, 3)).toBe(false);
    expect(sessaoAindaValida(undefined, 3)).toBe(false);
  });

  it("rejeita (fail-closed) quando o token não tem sessionVersion (claim ausente/malformado)", () => {
    // verifySessionToken (auth-utils.ts) normaliza um claim ausente para 0 antes
    // de chegar aqui - via `payload.sessionVersion ?? 0` - entao um token antigo
    // continua validado normalmente contra um usuario ainda na versao 0. Esta
    // funcao pura, isolada, so ve `undefined` se for chamada de forma incorreta
    // (bug de integracao) e deve falhar fechado nesse caso.
    expect(sessaoAindaValida({ active: true, sessionVersion: 0 }, undefined)).toBe(false);
  });
});
