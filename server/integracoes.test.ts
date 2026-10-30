// LOTE B (25/10): Configurações › Integrações. Asaas, Pluggy e Evolution simulados — nada externo é chamado.
import { describe, expect, it, vi } from "vitest";
import { createIntegracoesRouter, finalDaChave, type IntegracoesDeps } from "./integracoes-router";
import { autenticarPluggyDetalhado, authenticatePluggy, mensagemRecusaPluggy } from "./_core/pluggy";

const ctx = (role: "admin" | "colaborador" | "user") =>
  ({ user: { id: 1, role, active: true, permissions: JSON.stringify(["bpo", "whatsapp"]) }, req: {}, res: {} }) as never;

const resp = (corpo: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => corpo } as Response);

const CHAVE_ASAAS = "$aact_prod_000000000000abcd";

function setup(over: Partial<IntegracoesDeps> = {}) {
  const deps: IntegracoesDeps = {
    lerAsaas: vi.fn(async () => ({ apiKey: CHAVE_ASAAS, environment: "production" as const, fonte: "banco" as const })),
    asaasSalvaNoBanco: vi.fn(async () => true),
    lerWebhookAsaas: vi.fn(async () => ({ token: "token-webhook-9876", fonte: "banco" as const })),
    salvarAsaas: vi.fn(async () => undefined),
    lerPluggy: vi.fn(async () => ({ clientId: "client-id-1111", clientSecret: "client-secret-2222" })),
    salvarPluggy: vi.fn(async () => undefined),
    lerEvolution: vi.fn(async () => ({ url: "https://evo.up.railway.app", apiKey: "evo-chave-3333", fonte: "banco" as const })),
    salvarEvolution: vi.fn(async () => undefined),
    estadoWhatsapp: vi.fn(async () => "conectado" as const),
    encrypt: vi.fn((v: string) => `cifrado:${v.length}`),
    fetchImpl: vi.fn(() => resp({})) as never,
    ...over,
  };
  return { deps, caller: createIntegracoesRouter(deps).createCaller(ctx("admin")) };
}

describe("Integrações — status mascarado", () => {
  it("mostra só os 4 últimos caracteres e nunca a chave", async () => {
    const { caller } = setup();
    const s = await caller.status();
    expect(s.asaas).toMatchObject({ configurado: true, final: "…abcd", fonte: "banco", ambiente: "production", webhookFinal: "…9876" });
    expect(s.asaas.webhookUrl).toBe("https://www.prospectaconstrucoes.com/api/asaas/webhook");
    expect(s.pluggy).toEqual({ configurado: true, clientIdFinal: "…1111", secretFinal: "…2222" });
    expect(s.whatsapp).toMatchObject({ configurado: true, url: "https://evo.up.railway.app", final: "…3333" });
    const json = JSON.stringify(s);
    for (const segredo of [CHAVE_ASAAS, "token-webhook-9876", "client-id-1111", "client-secret-2222", "evo-chave-3333"]) expect(json).not.toContain(segredo);
  });

  it("avisa quando a chave em uso vem da variável de ambiente", async () => {
    const { caller } = setup({ lerAsaas: vi.fn(async () => ({ apiKey: "$aact_hmlg_xyz12345", environment: "sandbox" as const, fonte: "env" as const })) });
    const s = await caller.status();
    expect(s.asaas).toMatchObject({ fonte: "env", ambiente: "sandbox", salvaNoBancoIgnorada: true });
  });

  it("nada configurado", async () => {
    const { caller } = setup({ lerAsaas: vi.fn(async () => null), lerWebhookAsaas: vi.fn(async () => null), lerPluggy: vi.fn(async () => null), lerEvolution: vi.fn(async () => null) });
    const s = await caller.status();
    expect(s.asaas.configurado).toBe(false);
    expect(s.pluggy.configurado).toBe(false);
    expect(s.whatsapp.configurado).toBe(false);
  });

  it("finalDaChave", () => {
    expect(finalDaChave("12345678")).toBe("…5678");
    expect(finalDaChave("abc")).toBe("…");
    expect(finalDaChave(null)).toBeNull();
  });

  it("só o admin acessa (colaborador com todos os módulos e cliente são barrados)", async () => {
    const { deps } = setup();
    for (const role of ["colaborador", "user"] as const) {
      const caller = createIntegracoesRouter(deps).createCaller(ctx(role));
      await expect(caller.status()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.salvarPluggy({ clientId: "a", clientSecret: "b" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.verificarWebhookAsaas()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.recuperarWebhookAsaas()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Integrações — testar com a mensagem real", () => {
  it("Asaas 401: mostra o errors[].description devolvido", async () => {
    const fetchImpl = vi.fn(() => resp({ errors: [{ code: "invalid_access_token", description: "A chave de API fornecida é inválida" }] }, 401));
    const { caller } = setup({ fetchImpl: fetchImpl as never });
    const r = await caller.testar({ servico: "asaas" });
    expect(r.ok).toBe(false);
    expect(r.mensagem).toContain("HTTP 401");
    expect(r.mensagem).toContain("A chave de API fornecida é inválida");
    expect(String(fetchImpl.mock.calls[0][0])).toContain("https://api.asaas.com/v3/finance/balance");
  });

  it("Asaas ok: conectado com saldo", async () => {
    const { caller } = setup({ fetchImpl: vi.fn(() => resp({ balance: 10 })) as never });
    const r = await caller.testar({ servico: "asaas" });
    expect(r.ok).toBe(true);
    expect(r.mensagem).toContain("produção");
  });

  it("Pluggy 403: mostra o message e a dica do plano gratuito", async () => {
    const fetchImpl = vi.fn(() => resp({ code: 403, message: "Your trial has expired, please contact sales" }, 403));
    const { caller } = setup({ fetchImpl: fetchImpl as never });
    const r = await caller.testar({ servico: "pluggy" });
    expect(r.ok).toBe(false);
    expect(r.mensagem).toContain("A Pluggy recusou (HTTP 403): Your trial has expired, please contact sales");
    expect(r.mensagem).toContain("o plano gratuito da Pluggy não libera a API; use Importar extrato");
  });

  it("Pluggy 401 sem trial: sem a dica do plano", async () => {
    const { caller } = setup({ fetchImpl: vi.fn(() => resp({ message: "Invalid credentials" }, 401)) as never });
    const r = await caller.testar({ servico: "pluggy" });
    expect(r.mensagem).toMatch(/^A Pluggy recusou \(HTTP 401\): Invalid credentials\. Credencial inválida/);
    expect(r.mensagem).not.toMatch(/plano gratuito/);
  });

  it("WhatsApp: servidor ok e estado da conexão", async () => {
    const fetchImpl = vi.fn(() => resp([]));
    const { caller } = setup({ fetchImpl: fetchImpl as never, estadoWhatsapp: vi.fn(async () => "aguardando_qr" as const) });
    const r = await caller.testar({ servico: "whatsapp" });
    expect(r).toMatchObject({ ok: true, estado: "aguardando_qr" });
    expect(r.mensagem).toContain("aguardando a leitura do QR code");
  });

  it("WhatsApp: chave recusada mostra o motivo da Evolution", async () => {
    const { caller } = setup({ fetchImpl: vi.fn(() => resp({ response: { message: ["Unauthorized"] } }, 401)) as never });
    const r = await caller.testar({ servico: "whatsapp" });
    expect(r.ok).toBe(false);
    expect(r.mensagem).toContain("Unauthorized");
  });
});

describe("Integrações — trocar valida antes de salvar", () => {
  it("Asaas: chave recusada não é salva e devolve a mensagem real", async () => {
    const { caller, deps } = setup({ fetchImpl: vi.fn(() => resp({ errors: [{ description: "IP não autorizado" }] }, 401)) as never });
    await expect(caller.salvarAsaas({ apiKey: "$aact_prod_ruim12345" })).rejects.toThrow(/IP não autorizado/);
    expect(deps.salvarAsaas).not.toHaveBeenCalled();
  });

  it("Asaas: ambiente inferido pelo prefixo e só valores criptografados", async () => {
    const { caller, deps } = setup({ fetchImpl: vi.fn(() => resp({ balance: 0 })) as never });
    await expect(caller.salvarAsaas({ apiKey: CHAVE_ASAAS, webhookToken: "tok-novo-1234" })).resolves.toMatchObject({ ambiente: "production" });
    expect(deps.salvarAsaas).toHaveBeenCalledWith({ apiKeyEncrypted: `cifrado:${CHAVE_ASAAS.length}`, environment: "production", webhookTokenEncrypted: "cifrado:13" });
    await caller.salvarAsaas({ apiKey: "$aact_hmlg_teste1234" });
    expect(deps.salvarAsaas).toHaveBeenLastCalledWith(expect.objectContaining({ environment: "sandbox" }));
  });

  it("Asaas: só o token do webhook não chama o Asaas", async () => {
    const fetchImpl = vi.fn(() => resp({}));
    const { caller, deps } = setup({ fetchImpl: fetchImpl as never });
    await caller.salvarAsaas({ webhookToken: "tok-novo-1234" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(deps.salvarAsaas).toHaveBeenCalledWith({ webhookTokenEncrypted: "cifrado:13" });
    await expect(caller.salvarAsaas({})).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("Pluggy: recusa não salva", async () => {
    const { caller, deps } = setup({ fetchImpl: vi.fn(() => resp({ message: "Invalid credentials" }, 401)) as never });
    await expect(caller.salvarPluggy({ clientId: "x", clientSecret: "y" })).rejects.toThrow("A Pluggy recusou (HTTP 401): Invalid credentials");
    expect(deps.salvarPluggy).not.toHaveBeenCalled();
  });

  it("Evolution: endereço normalizado antes de testar e de salvar", async () => {
    const fetchImpl = vi.fn(() => resp([]));
    const { caller, deps } = setup({ fetchImpl: fetchImpl as never });
    await expect(caller.salvarEvolution({ url: "  evo.up.railway.app/manager/ ", apiKey: "chave-evo-5555" })).resolves.toEqual({ success: true, url: "https://evo.up.railway.app" });
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://evo.up.railway.app/instance/fetchInstances");
    expect(deps.salvarEvolution).toHaveBeenCalledWith({ url: "https://evo.up.railway.app", apiKeyEncrypted: "cifrado:14" });
  });
});

describe("Pluggy — autenticação detalhada (compatível)", () => {
  it("devolve status e mensagem; authenticatePluggy continua devolvendo null", async () => {
    const f = vi.fn(() => resp({ message: "Forbidden" }, 403)) as never;
    expect(await autenticarPluggyDetalhado("a", "b", f)).toEqual({ ok: false, status: 403, mensagem: "Forbidden" });
    expect(await authenticatePluggy("a", "b", f)).toBeNull();
    expect(await autenticarPluggyDetalhado("a", "b", vi.fn(() => Promise.reject(new Error("ECONNRESET"))) as never)).toEqual({ ok: false, status: null, mensagem: "ECONNRESET" });
    expect(mensagemRecusaPluggy(null, "ECONNRESET")).toBe("Não consegui falar com a Pluggy: ECONNRESET");
    expect(mensagemRecusaPluggy(403, "Subscription required")).toContain("plano gratuito");
  });
});
