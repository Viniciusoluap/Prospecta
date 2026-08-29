import { describe, expect, it, vi } from "vitest";
import { validateAsaasApiKey } from "./_core/asaas";

const config = (ok: boolean) => ({
  apiKey: "$aact_test_fictitious_local_key",
  environment: "sandbox" as const,
  fetchImpl: vi
    .fn()
    .mockResolvedValue({
      ok,
      json: vi.fn().mockResolvedValue(ok ? { data: [] } : { errors: [] }),
    }) as typeof fetch,
});

describe("Asaas credential validation", () => {
  it("retorna true para uma resposta válida simulada", async () => {
    expect(await validateAsaasApiKey(config(true))).toBe(true);
  });

  it("retorna false para uma resposta inválida simulada", async () => {
    expect(await validateAsaasApiKey(config(false))).toBe(false);
  });
});
