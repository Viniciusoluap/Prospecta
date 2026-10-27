import { describe, expect, it, vi, afterEach } from "vitest";
import { authenticatePluggy, fetchPluggyTransactions, fetchPluggyAccountBalance } from "./_core/pluggy";

describe("EPIC-007 S-03 - cliente Pluggy (fallback gracioso)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("authenticatePluggy retorna null quando a API responde erro", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const token = await authenticatePluggy("id", "secret");
    expect(token).toBeNull();
  });

  it("authenticatePluggy retorna null quando a chamada falha (sem credenciais configuradas)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const token = await authenticatePluggy("id", "secret");
    expect(token).toBeNull();
  });

  it("authenticatePluggy retorna o apiKey quando a API responde com sucesso", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ apiKey: "tok123" }) }));
    const token = await authenticatePluggy("id", "secret");
    expect(token).toBe("tok123");
  });

  it("fetchPluggyTransactions mapeia CREDIT/DEBIT para credito/debito", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { id: "t1", date: "2026-09-01", description: "Venda", amount: 100, type: "CREDIT", category: "vendas" },
          { id: "t2", date: "2026-09-02", description: "Taxa", amount: -20, type: "DEBIT" },
        ],
      }),
    }));
    const txs = await fetchPluggyTransactions("tok", "acc1");
    expect(txs).toEqual([
      { externalId: "t1", data: "2026-09-01", descricao: "Venda", valor: 100, tipo: "credito", categoria: "vendas" },
      { externalId: "t2", data: "2026-09-02", descricao: "Taxa", valor: 20, tipo: "debito", categoria: undefined },
    ]);
  });

  it("usa /v2/transactions, percorre o cursor e prefere providerId estável", async () => {
    const fetchFake = vi.fn((url: string) => {
      expect(url).toContain("/v2/transactions");
      if (!url.includes("after=")) return Promise.resolve({ ok: true, json: async () => ({
        next: "?accountId=acc1&after=cursor-opaco",
        results: [{ id: "id-item-1", providerId: "provider-77", providerCode: "nsu-9", date: "2026-10-01", description: "PIX", descriptionRaw: "PIX MARIA", amount: 25, type: "CREDIT", paymentData: { payer: { name: "Maria" } } }],
      }) } as Response);
      return Promise.resolve({ ok: true, json: async () => ({ next: null, results: [] }) } as Response);
    });
    expect(await fetchPluggyTransactions("tok", "acc1", "2026-01-01", fetchFake as never)).toEqual([
      { externalId: "id-item-1", identificadorBancario: "provider-77", data: "2026-10-01", descricao: "PIX MARIA", valor: 25, tipo: "credito", categoria: undefined, titular: "Maria" },
    ]);
    expect(fetchFake).toHaveBeenCalledTimes(2);
    expect(fetchFake.mock.calls[0][0]).toContain("dateFrom=2026-01-01");
    expect(fetchFake.mock.calls[0][0]).not.toContain("&from=");
  });

  it("rejeita cursor de outro host antes de enviar a chave", async () => {
    const fake = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [], next: "https://outro-host.example/token" }) });
    await expect(fetchPluggyTransactions("segredo", "acc", null, fake)).rejects.toThrow("cursor inválido");
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it("no HTTP 410 preserva detalhe da API e diagnostica o item", async () => {
    const fetchFake = vi.fn((url: string) => url.includes("/items/")
      ? Promise.resolve({ ok: true, json: async () => ({ status: "OUTDATED", executionStatus: "CONNECTION_ERROR", error: { message: "Conexão expirada" } }) } as Response)
      : Promise.resolve({ ok: false, status: 410, json: async () => ({ codeDescription: "ENDPOINT_GONE", message: "Use v2" }) } as Response));
    await expect(fetchPluggyTransactions("tok", "acc1", null, fetchFake as never, "item-1"))
      .rejects.toThrow(/HTTP 410.*Use v2.*OUTDATED.*Conexão expirada/);
  });

  it("fetchPluggyAccountBalance retorna null em erro de rede", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const saldo = await fetchPluggyAccountBalance("tok", "acc1");
    expect(saldo).toBeNull();
  });
});
