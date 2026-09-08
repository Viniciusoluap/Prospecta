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

  it("fetchPluggyAccountBalance retorna null em erro de rede", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const saldo = await fetchPluggyAccountBalance("tok", "acc1");
    expect(saldo).toBeNull();
  });
});
