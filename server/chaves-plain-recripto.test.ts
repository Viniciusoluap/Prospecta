// Lote 4 (frente antiga "chaves da Prospecta"): chaves gravadas direto no banco como "plain:<valor>"
// funcionam e são recriptografadas no primeiro uso (Asaas central: na sincronização diária).
// Sem banco real e sem serviço externo.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", () => ({ getDb: vi.fn(), getPaymentSetting: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", asaasApiKey: "", asaasEnvironment: "sandbox" } }));

import { getDb } from "./db.js";
import { recriptografarConfiguracaoAsaas } from "./bancos.js";
import { decryptSecret, encryptSecret, segredoEmTextoPuro } from "./_core/secret-vault.js";

function dbCom(linha: Record<string, unknown> | null) {
  const gravado: Record<string, unknown>[] = [];
  const cadeia = (r: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit"]) c[m] = () => c;
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve(r).then(ok);
    return c;
  };
  vi.mocked(getDb).mockReturnValue({
    select: () => cadeia(linha ? [linha] : []),
    update: () => ({ set: (v: Record<string, unknown>) => { gravado.push(v); return { where: () => Promise.resolve() }; } }),
  } as never);
  return gravado;
}

describe("chaves 'plain:' gravadas direto no banco", () => {
  beforeEach(() => vi.resetAllMocks());

  it("decryptSecret lê o texto puro e o cofre identifica", () => {
    expect(decryptSecret("plain:$aact_prod_abc")).toBe("$aact_prod_abc");
    expect(segredoEmTextoPuro("plain:x")).toBe(true);
    expect(segredoEmTextoPuro(encryptSecret("x"))).toBe(false);
  });

  it("Asaas central (payment_settings): chave e token do webhook são recriptografados", async () => {
    const gravado = dbCom({ id: 1, asaasApiKeyEncrypted: "plain:$aact_prod_abc", asaasWebhookTokenEncrypted: "plain:whsec_123" });
    await recriptografarConfiguracaoAsaas();
    expect(gravado).toHaveLength(1);
    const set = gravado[0] as { asaasApiKeyEncrypted: string; asaasWebhookTokenEncrypted: string };
    expect(segredoEmTextoPuro(set.asaasApiKeyEncrypted)).toBe(false);
    expect(decryptSecret(set.asaasApiKeyEncrypted)).toBe("$aact_prod_abc");
    expect(decryptSecret(set.asaasWebhookTokenEncrypted)).toBe("whsec_123");
  });

  it("já criptografada: não regrava nada", async () => {
    const gravado = dbCom({ id: 1, asaasApiKeyEncrypted: encryptSecret("$aact_prod_abc"), asaasWebhookTokenEncrypted: null });
    await recriptografarConfiguracaoAsaas();
    expect(gravado).toEqual([]);
  });
});
