// LOTE B (25/10): conta Asaas do BPO sem chave própria usa a chave central (Integrações / ASAAS_API_KEY).
// Banco e APIs simulados.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getPaymentSetting } from "./db.js";
import { ENV } from "./_core/env.js";
import { credencialDaConta, tokenPluggy } from "./bancos.js";

vi.mock("./db.js", () => ({ getDb: vi.fn(), getPaymentSetting: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", asaasApiKey: "", asaasEnvironment: "sandbox" } }));

const resp = (corpo: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => corpo } as Response);

function fakeDb(selects: unknown[][]) {
  let i = 0;
  const cadeia = (r: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit"]) c[m] = () => c;
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve(r).then(ok);
    return c;
  };
  vi.mocked(getDb).mockReturnValue({
    select: () => cadeia(selects[i++] ?? []),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  } as never);
}

describe("conta Asaas e chave central", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (ENV as { asaasApiKey: string }).asaasApiKey = "";
  });

  it("sem chave própria usa a chave salva em Integrações", async () => {
    vi.mocked(getPaymentSetting).mockResolvedValue({ isActive: true, asaasApiKeyEncrypted: "plain:$aact_prod_central", asaasEnvironment: "production" } as never);
    await expect(credencialDaConta({ id: 1, provedor: "asaas", credencialEncrypted: null })).resolves.toBe("$aact_prod_central");
  });

  it("a variável ASAAS_API_KEY tem precedência sobre a chave salva", async () => {
    (ENV as { asaasApiKey: string }).asaasApiKey = "$aact_hmlg_env";
    vi.mocked(getPaymentSetting).mockResolvedValue({ isActive: true, asaasApiKeyEncrypted: "plain:$aact_prod_central" } as never);
    await expect(credencialDaConta({ id: 1, provedor: "asaas", credencialEncrypted: null })).resolves.toBe("$aact_hmlg_env");
  });

  it("conta antiga com chave própria continua usando a dela", async () => {
    fakeDb([]);
    vi.mocked(getPaymentSetting).mockResolvedValue({ isActive: true, asaasApiKeyEncrypted: "plain:$aact_prod_central" } as never);
    await expect(credencialDaConta({ id: 1, provedor: "asaas", credencialEncrypted: "plain:$aact_prod_propria" })).resolves.toBe("$aact_prod_propria");
    expect(getPaymentSetting).not.toHaveBeenCalled();
  });

  it("sem chave central: pede para cadastrar em Integrações", async () => {
    vi.mocked(getPaymentSetting).mockResolvedValue(undefined);
    await expect(credencialDaConta({ id: 1, provedor: "asaas", credencialEncrypted: null })).rejects.toThrow(/Integrações/);
  });
});

describe("tokenPluggy com o motivo real", () => {
  beforeEach(() => vi.resetAllMocks());

  it("lança 'A Pluggy recusou (HTTP 403): <mensagem>' com a dica do plano gratuito", async () => {
    fakeDb([[{ id: 1, isActive: true, clientIdEncrypted: "plain:cid", clientSecretEncrypted: "plain:sec" }]]);
    const f = vi.fn(() => resp({ message: "Trial period expired" }, 403));
    await expect(tokenPluggy(f as never)).rejects.toThrow(
      "A Pluggy recusou (HTTP 403): Trial period expired — o plano gratuito da Pluggy não libera a API; use Importar extrato."
    );
  });
});
