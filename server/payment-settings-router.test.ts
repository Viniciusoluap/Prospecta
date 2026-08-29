import { describe, expect, it, vi } from "vitest";
import { createPaymentSettingsRouter } from "./payment-settings-router";

const context = (role: "admin" | "user" | null) =>
  ({
    user: role ? { id: 1, role } : null,
    req: {},
    res: {},
  }) as never;

function setup(valid = true) {
  const get = vi.fn().mockResolvedValue(undefined);
  const save = vi.fn().mockResolvedValue(undefined);
  const validate = vi.fn().mockResolvedValue(valid);
  const encrypt = vi.fn((value: string) => `encrypted:${value.length}`);
  return {
    router: createPaymentSettingsRouter({ get, save, validate, encrypt }),
    get,
    save,
    validate,
    encrypt,
  };
}

describe("payment settings router", () => {
  it.each(["status", "validate", "save"] as const)(
    "impede usuário não administrador em %s",
    async procedure => {
      const { router } = setup();
      const caller = router.createCaller(context("user"));
      const call =
        procedure === "status"
          ? caller.status()
          : procedure === "validate"
            ? caller.validate({ apiKey: "fake", environment: "sandbox" })
            : caller.save({ apiKey: "fake", environment: "sandbox" });
      await expect(call).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  );

  it("rejeita chave vazia", async () => {
    const { router, validate } = setup();
    await expect(
      router
        .createCaller(context("admin"))
        .validate({ apiKey: " ", environment: "sandbox" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(validate).not.toHaveBeenCalled();
  });

  it("não persiste credencial inválida", async () => {
    const { router, save } = setup(false);
    await expect(
      router
        .createCaller(context("admin"))
        .save({ apiKey: "invalid", environment: "sandbox" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(save).not.toHaveBeenCalled();
  });

  it("valida e salva somente valores criptografados", async () => {
    const { router, save } = setup(true);
    await expect(
      router
        .createCaller(context("admin"))
        .save({
          apiKey: "fictitious-key",
          webhookToken: "fictitious-token",
          environment: "sandbox",
        })
    ).resolves.toEqual({ success: true });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        asaasApiKeyEncrypted: "encrypted:14",
        asaasWebhookTokenEncrypted: "encrypted:16",
        asaasEnvironment: "sandbox",
      })
    );
    expect(JSON.stringify(save.mock.calls[0][0])).not.toContain(
      "fictitious-key"
    );
  });

  it("consulta status sem devolver o segredo", async () => {
    const { router, get } = setup();
    get.mockResolvedValue({
      asaasApiKeyEncrypted: "encrypted-value",
      asaasEnvironment: "production",
      isActive: true,
    });
    const result = await router.createCaller(context("admin")).status();
    expect(result).toEqual({
      configured: true,
      environment: "production",
      active: true,
    });
    expect(JSON.stringify(result)).not.toContain("encrypted-value");
  });
});
