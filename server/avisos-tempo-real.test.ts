// Pedido de 25/10: avisos em tempo real (webhooks Asaas e Pluggy). Nada externo é chamado.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { garantirWebhookPluggy } from "./_core/pluggy";

const sync = vi.hoisted(() => ({ chamadas: [] as unknown[] }));
vi.mock("./bancos.js", () => ({
  segredoWebhookPluggy: () => "segredo-certo",
  sincronizarPorEvento: async (f: unknown) => { sync.chamadas.push(f); return [{ contaId: 1, ok: true }]; },
}));
const { handlePluggyWebhook } = await import("./pluggy-webhook");

function resposta() {
  const r = { status: 0, corpo: null as unknown, statusFn(s: number) { r.status = s; return r; } };
  return { obj: r, res: { status: (s: number) => { r.status = s; return { json: (c: unknown) => { r.corpo = c; } }; } } as never };
}
const resp = (corpo: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => corpo } as Response);

describe("webhook da Pluggy", () => {
  beforeEach(() => { sync.chamadas = []; });

  it("recusa sem o cabeçalho secreto", async () => {
    const { obj, res } = resposta();
    await handlePluggyWebhook({ headers: { "x-webhook-token": "errado" }, body: { event: "item/updated", itemId: "i1" } } as never, res);
    expect(obj.status).toBe(401);
    expect(sync.chamadas).toEqual([]);
  });

  it("evento de dados novos sincroniza as contas daquela conexão", async () => {
    const { obj, res } = resposta();
    await handlePluggyWebhook({ headers: { "x-webhook-token": "segredo-certo" }, body: { event: "transactions/created", itemId: "i1" } } as never, res);
    expect(obj.status).toBe(200);
    expect(sync.chamadas).toEqual([{ provedor: "pluggy", itemId: "i1" }]);
  });

  it("evento irrelevante é ignorado com 200", async () => {
    const { obj, res } = resposta();
    await handlePluggyWebhook({ headers: { "x-webhook-token": "segredo-certo" }, body: { event: "connector/status_updated" } } as never, res);
    expect(obj.status).toBe(200);
    expect(sync.chamadas).toEqual([]);
  });
});

describe("registro do webhook na Pluggy", () => {
  it("cria uma vez com o cabeçalho secreto e não duplica", async () => {
    const criar = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ event: "all", url: "https://site/api/pluggy/webhook", headers: { "x-webhook-token": "s" } });
        return resp({ id: "w1" });
      }
      expect(url).toBe("https://api.pluggy.ai/webhooks");
      return resp({ results: [] });
    });
    expect(await garantirWebhookPluggy("tok", "https://site/api/pluggy/webhook", "s", criar as never)).toBe("criado");
    const existe = vi.fn(() => resp({ results: [{ url: "https://site/api/pluggy/webhook" }] }));
    expect(await garantirWebhookPluggy("tok", "https://site/api/pluggy/webhook", "s", existe as never)).toBe("existente");
    expect(existe).toHaveBeenCalledTimes(1);
  });
});
