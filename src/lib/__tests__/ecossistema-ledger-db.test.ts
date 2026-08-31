import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, getDb } = vi.hoisted(() => {
  const execute = vi.fn();
  return { execute, getDb: vi.fn(() => ({ execute })) };
});

vi.mock("@/lib/legacy/repository", () => ({ getDb }));

import {
  confirmTicketPayment,
  confirmUtefPayment,
  createProductConversion,
  performDraw,
  processConversion,
  refundPayment,
} from "@/lib/legacy/ecossistema-ledger";

describe("lançamentos atômicos do ecossistema", () => {
  beforeEach(() => {
    execute.mockReset().mockResolvedValue({ rows: [{ id: 1 }] });
    getDb.mockClear();
  });

  it("confirma um bilhete e atualiza o sorteio em um único comando", async () => {
    await confirmTicketPayment({ id: "pay_ticket", value: 25, externalReference: "ticket_purchase_1" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("credita uma compra UTEF e o razão no mesmo comando", async () => {
    await confirmUtefPayment({ id: "pay_utef", value: 1_000, externalReference: "utef_purchase_2_token" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("registra a conversão, o débito e a notificação no mesmo comando", async () => {
    await createProductConversion({ userId: 3, productId: 4, productTitle: "Terreno", utefAmount: 500 });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("finaliza o sorteio com prêmio, razão e notificação no mesmo comando", async () => {
    await performDraw({ drawId: 5, lotteryResult: "12345", winnerUserId: 6, winnerTicketNumber: "PX-ABC" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("cancela a conversão e devolve o saldo no mesmo comando", async () => {
    await processConversion({ conversionId: 7, status: "cancelled" });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("mantém estornos de bilhete e UTEF independentes por tipo de compra", async () => {
    await refundPayment({ id: "pay_refund", value: 100 });
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
