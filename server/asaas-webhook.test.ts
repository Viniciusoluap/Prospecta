import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const deps = vi.hoisted(() => ({
  setting: vi.fn(), decrypt: vi.fn(), sync: vi.fn(), settle: vi.fn(), refund: vi.fn(),
}));
vi.mock("./db.js", () => ({ getPaymentSetting: deps.setting }));
vi.mock("./_core/secret-vault.js", () => ({ decryptSecret: deps.decrypt }));
vi.mock("./bancos.js", () => ({ sincronizarPorEvento: deps.sync }));
vi.mock("./payment-settlement.js", () => ({ settlePaymentOrder: deps.settle, refundPaymentOrder: deps.refund }));
import { handleAsaasWebhook } from "./asaas-webhook";

async function deliver(body: unknown, token: unknown = "test-hook-token") {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  await handleAsaasWebhook({ body, headers: { "asaas-access-token": token } } as Request, res as unknown as Response);
  return res;
}

describe("Asaas webhook: autenticação e validação antes de efeitos", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", "test-hook-token");
    deps.setting.mockResolvedValue(null);
    deps.sync.mockResolvedValue([]);
    deps.settle.mockResolvedValue({ outcome: "already_processed" });
    deps.refund.mockResolvedValue({ outcome: "already_processed" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it.each([undefined, "", "wrong", ["test-hook-token"]])("rejeita token inválido sem tocar no financeiro (%s)", async token => {
    const res = await deliver({ event: "PAYMENT_RECEIVED", payment: { id: "pay_test" } }, token ?? null);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(deps.sync).not.toHaveBeenCalled();
    expect(deps.settle).not.toHaveBeenCalled();
  });
  it("falha fechado sem token configurado", async () => {
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", "");
    expect((await deliver({ event: "PAYMENT_CREATED" })).status).toHaveBeenCalledWith(401);
    expect(deps.sync).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { event: 1 }, { event: " " }])("rejeita corpo inválido antes da sincronização (%j)", async body => {
    expect((await deliver(body)).status).toHaveBeenCalledWith(400);
    expect(deps.sync).not.toHaveBeenCalled();
  });
  it.each(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_REFUNDED"])("não confirma %s sem ID de pagamento", async event => {
    expect((await deliver({ event, payment: { id: 123 } })).status).toHaveBeenCalledWith(400);
    expect(deps.sync).not.toHaveBeenCalled();
    expect(deps.settle).not.toHaveBeenCalled();
    expect(deps.refund).not.toHaveBeenCalled();
  });
  it("mantém eventos autenticados sem pagamento e sem liquidação", async () => {
    expect((await deliver({ event: "TRANSFER_DONE" })).status).toHaveBeenCalledWith(200);
    expect(deps.sync).toHaveBeenCalledOnce();
    expect(deps.settle).not.toHaveBeenCalled();
  });
  it("health check autenticado não sincroniza nem liquida", async () => {
    expect((await deliver({ event: "INTEGRATION_HEALTH_CHECK" })).status).toHaveBeenCalledWith(200);
    expect(deps.sync).not.toHaveBeenCalled();
    expect(deps.settle).not.toHaveBeenCalled();
  });
  it("preserva o serviço idempotente de liquidação", async () => {
    expect((await deliver({ event: "PAYMENT_RECEIVED", payment: { id: "pay_test" } })).status).toHaveBeenCalledWith(200);
    expect(deps.settle).toHaveBeenCalledWith("pay_test");
  });
  it("retorna erro para permitir retry quando a liquidação falha", async () => {
    deps.settle.mockRejectedValue(new Error("database unavailable"));
    expect((await deliver({ event: "PAYMENT_CONFIRMED", payment: { id: "pay_test" } })).status).toHaveBeenCalledWith(500);
  });
  it("mantém o processamento existente de estorno", async () => {
    expect((await deliver({ event: "PAYMENT_REFUNDED", payment: { id: "pay_test" } })).status).toHaveBeenCalledWith(200);
    expect(deps.refund).toHaveBeenCalledWith("pay_test");
  });
});
