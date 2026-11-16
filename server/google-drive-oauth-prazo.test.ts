// EPIC-025 (Dolores, etapa 3) — QA R2 M2 (versão invertida): o pedido do token OAuth do Drive (conta do dono) respeita o
// prazo de quem chama (`comPrazoNoDrive`); sem prazo, continua igual para os chamadores atuais.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const linha = { id: 1, clientId: "id", clientSecretEncrypted: "seg", refreshTokenEncrypted: "ref", rootFolderId: "raiz", accountEmail: null };
vi.mock("./db.js", () => {
  const cadeia = { select: () => cadeia, from: () => cadeia, where: () => cadeia, limit: async () => [linha] };
  return { getDb: () => cadeia };
});
vi.mock("./_core/secret-vault.js", () => ({ decryptSecret: (s: string) => s, encryptSecret: (s: string) => s }));

import { tokenOAuth } from "./google-drive-oauth.js";

afterEach(() => vi.unstubAllGlobals());

describe("M2 — token OAuth do Drive com prazo", () => {
  it("com sinal: o fetch do token recebe o sinal e é cancelado quando o prazo passa", async () => {
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_, rej) => {
      init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })));
    const inicio = Date.now();
    await expect(tokenOAuth(true, AbortSignal.timeout(50))).rejects.toThrow(/abort/i);
    expect(Date.now() - inicio).toBeLessThan(2_000);
  });
  it("o Drive (conta do dono) passa o sinal do comPrazoNoDrive ao pedir o token", () => {
    const fonte = readFileSync(new URL("./drive-documents.ts", import.meta.url), "utf8");
    expect(fonte).toMatch(/if \(fonte\.modo === "oauth"\) return tokenOAuth\(false, sinalDoDrive\.getStore\(\)\);/);
  });
  it("sem sinal: comportamento de antes (sem signal no pedido)", async () => {
    const f = vi.fn(async (_u: string, _init: RequestInit) => new Response(JSON.stringify({ access_token: "tok2", expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    expect(await tokenOAuth(true)).toBe("tok2");
    expect("signal" in f.mock.calls[0][1]).toBe(false);
  });
});
