import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./_core/env";
import {
  AsaasApiError,
  AsaasConfigurationError,
  createAsaasClient,
  createAsaasPayment,
  createOrUpdateAsaasCustomer,
  getAsaasPixQrCode,
} from "./_core/asaas";

const TEST_KEY = "$aact_test_fictitious_local_key";
const PROD_KEY = "$aact_prod_fictitious_local_key";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}

describe("Asaas client", () => {
  const originalKey = ENV.asaasApiKey;
  const originalEnvironment = ENV.asaasEnvironment;

  beforeEach(() => {
    ENV.asaasApiKey = TEST_KEY;
    ENV.asaasEnvironment = "sandbox";
  });

  afterEach(() => {
    ENV.asaasApiKey = originalKey;
    ENV.asaasEnvironment = originalEnvironment;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("falha sem credencial antes de acessar a rede", async () => {
    const fetchImpl = vi.fn();
    const client = createAsaasClient({
      apiKey: "",
      environment: "sandbox",
      fetchImpl,
    });
    await expect(client.request("/customers")).rejects.toThrow(
      AsaasConfigurationError
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["sandbox", TEST_KEY, "https://sandbox.asaas.com/api/v3/customers"],
    ["production", PROD_KEY, "https://api.asaas.com/v3/customers"],
  ] as const)(
    "usa explicitamente o ambiente %s",
    async (environment, apiKey, expectedUrl) => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }));
      const client = createAsaasClient({ apiKey, environment, fetchImpl });
      await client.request("/customers");
      expect(fetchImpl).toHaveBeenCalledWith(
        expectedUrl,
        expect.objectContaining({
          headers: expect.objectContaining({ access_token: apiKey }),
        })
      );
    }
  );

  it("rejeita combinações perigosas de chave e ambiente", async () => {
    const fetchImpl = vi.fn();
    await expect(
      createAsaasClient({
        apiKey: PROD_KEY,
        environment: "sandbox",
        fetchImpl,
      }).request("/customers")
    ).rejects.toThrow("produção não pode ser usada no sandbox");
    await expect(
      createAsaasClient({
        apiKey: TEST_KEY,
        environment: "production",
        fetchImpl,
      }).request("/customers")
    ).rejects.toThrow("teste não pode ser usada em produção");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("serializa a criação e atualização de cliente", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "cus_1", name: "Cliente" }))
      .mockResolvedValueOnce(
        jsonResponse({ id: "cus_1", name: "Cliente Atualizado" })
      );
    vi.stubGlobal("fetch", fetchImpl);

    await createOrUpdateAsaasCustomer({
      name: "Cliente",
      email: "local@example.test",
    });
    await createOrUpdateAsaasCustomer({
      id: "cus_1",
      name: "Cliente Atualizado",
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://sandbox.asaas.com/api/v3/customers",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Cliente", email: "local@example.test" }),
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://sandbox.asaas.com/api/v3/customers/cus_1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ id: "cus_1", name: "Cliente Atualizado" }),
      })
    );
  });

  it.each(["PIX", "CREDIT_CARD"] as const)(
    "cria cobrança %s sem rede externa",
    async billingType => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({
            id: "pay_1",
            billingType,
            status: "PENDING",
            value: 5,
          })
        );
      vi.stubGlobal("fetch", fetchImpl);
      const payload = {
        customer: "cus_1",
        billingType,
        value: 5,
        dueDate: "2026-08-30",
        externalReference: "fixed-reference",
      };
      await createAsaasPayment(payload);
      expect(fetchImpl).toHaveBeenCalledWith(
        "https://sandbox.asaas.com/api/v3/payments",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(payload),
        })
      );
    }
  );

  it("obtém QR Code PIX", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ encodedImage: "image", payload: "payload" })
      );
    vi.stubGlobal("fetch", fetchImpl);
    await expect(getAsaasPixQrCode("pay_1")).resolves.toEqual({
      encodedImage: "image",
      payload: "payload",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://sandbox.asaas.com/api/v3/payments/pay_1/pixQrCode",
      expect.anything()
    );
  });

  it("converte erro HTTP em erro de domínio seguro", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { errors: [{ description: "Credencial inválida" }] },
          false
        )
      );
    const client = createAsaasClient({
      apiKey: TEST_KEY,
      environment: "sandbox",
      fetchImpl,
    });
    await expect(client.request("/customers")).rejects.toEqual(
      new AsaasApiError("Credencial inválida")
    );
  });

  it("rejeita resposta malformada", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(new Error("invalid json")),
      });
    const client = createAsaasClient({
      apiKey: TEST_KEY,
      environment: "sandbox",
      fetchImpl,
    });
    await expect(client.request("/customers")).rejects.toThrow(
      "resposta inválida"
    );
  });
});
