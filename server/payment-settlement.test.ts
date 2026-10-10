import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Draw, PaymentOrder } from "../drizzle/schema";

const dbMock = {
  getPaymentOrderByProviderId: vi.fn(),
  claimPendingPaymentOrder: vi.fn(),
  demoteSettledOrderToReview: vi.fn(),
  markPaymentOrderRefunded: vi.fn(),
  createUtefTransaction: vi.fn(),
  incrementUtefBalanceAtomic: vi.fn(),
  getDrawById: vi.fn(),
  reserveDrawCapacity: vi.fn(),
  insertTicketNumbers: vi.fn(),
  updateTicket: vi.fn(),
};
vi.mock("./db.js", () => dbMock);

const { settlePaymentOrder, refundPaymentOrder } = await import("./payment-settlement");

function order(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return {
    id: 1,
    provider: "asaas",
    providerPaymentId: "pay_123",
    purpose: "utef_purchase",
    userId: 42,
    drawId: null,
    ticketId: null,
    quantity: 1,
    principalAmount: 500,
    bonusAmount: 0,
    status: "pending",
    reviewReason: null,
    createdAt: new Date(),
    settledAt: null,
    updatedAt: new Date(),
    ...overrides,
  } as PaymentOrder;
}

function draw(overrides: Partial<Draw> = {}): Draw {
  return {
    id: 1,
    title: "Sorteio teste",
    description: null,
    prizeAmount: 10_000,
    ticketPrice: 10,
    targetAmount: 100_000,
    currentAmount: 0,
    ticketsSold: 0,
    status: "active",
    drawDate: null,
    winnerUserId: null,
    lotteryResult: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Draw;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("settlePaymentOrder", () => {
  it("retorna order_not_found se o payment_order não existe", async () => {
    dbMock.getPaymentOrderByProviderId.mockResolvedValue(undefined);
    const result = await settlePaymentOrder("pay_desconhecido");
    expect(result).toEqual({ outcome: "order_not_found" });
  });

  it("retorna already_processed se o pedido não está mais pendente (reentrega de webhook)", async () => {
    dbMock.getPaymentOrderByProviderId.mockResolvedValue(order({ status: "settled" }));
    const result = await settlePaymentOrder("pay_123");
    expect(result).toEqual({ outcome: "already_processed" });
    expect(dbMock.claimPendingPaymentOrder).not.toHaveBeenCalled();
  });

  describe("compra de UTEF", () => {
    it("credita principal + bônus (>=1000) em uma única chamada atômica", async () => {
      const pending = order({ principalAmount: 2000 });
      dbMock.getPaymentOrderByProviderId.mockResolvedValue(pending);
      dbMock.claimPendingPaymentOrder.mockResolvedValue(pending);

      const result = await settlePaymentOrder("pay_123");

      expect(result).toEqual({ outcome: "utef_credited", userId: 42, total: 2200, bonus: 200 });
      expect(dbMock.incrementUtefBalanceAtomic).toHaveBeenCalledWith(42, 2200);
      expect(dbMock.createUtefTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 42, amount: 2200, referenceId: "pay_123" }),
      );
    });

    it("não dá bônus para compras abaixo de 1000 UTEFs", async () => {
      const pending = order({ principalAmount: 500 });
      dbMock.getPaymentOrderByProviderId.mockResolvedValue(pending);
      dbMock.claimPendingPaymentOrder.mockResolvedValue(pending);

      const result = await settlePaymentOrder("pay_123");

      expect(result).toEqual({ outcome: "utef_credited", userId: 42, total: 500, bonus: 0 });
    });

    it("é idempotente: se outra chamada já reivindicou o pedido, não credita de novo", async () => {
      const pending = order();
      dbMock.getPaymentOrderByProviderId.mockResolvedValue(pending);
      dbMock.claimPendingPaymentOrder.mockResolvedValue(null); // outra chamada venceu a corrida

      const result = await settlePaymentOrder("pay_123");

      expect(result).toEqual({ outcome: "already_processed" });
      expect(dbMock.incrementUtefBalanceAtomic).not.toHaveBeenCalled();
      expect(dbMock.createUtefTransaction).not.toHaveBeenCalled();
    });
  });

  describe("compra de bilhete", () => {
    const ticketOrder = order({
      purpose: "ticket_purchase",
      drawId: 7,
      ticketId: 55,
      quantity: 3,
      principalAmount: 300,
    });

    it("confirma o bilhete e emite números individuais proporcionais à quantidade", async () => {
      dbMock.getPaymentOrderByProviderId.mockResolvedValue(ticketOrder);
      dbMock.claimPendingPaymentOrder.mockResolvedValue(ticketOrder);
      dbMock.getDrawById.mockResolvedValue(draw({ id: 7 }));
      dbMock.reserveDrawCapacity.mockResolvedValue({ ticketsSoldBefore: 10 });

      const result = await settlePaymentOrder("pay_123");

      expect(result).toEqual({ outcome: "ticket_confirmed", ticketId: 55, numbers: [10, 11, 12] });
      expect(dbMock.insertTicketNumbers).toHaveBeenCalledWith([
        { ticketId: 55, drawId: 7, number: 10 },
        { ticketId: 55, drawId: 7, number: 11 },
        { ticketId: 55, drawId: 7, number: 12 },
      ]);
      expect(dbMock.updateTicket).toHaveBeenCalledWith(55, { paymentStatus: "confirmed" });
    });

    it("vai para conciliação manual se o sorteio já não está ativo (pagamento tardio)", async () => {
      dbMock.getPaymentOrderByProviderId.mockResolvedValue(ticketOrder);
      dbMock.claimPendingPaymentOrder.mockResolvedValue(ticketOrder);
      dbMock.getDrawById.mockResolvedValue(draw({ id: 7, status: "drawn" }));

      const result = await settlePaymentOrder("pay_123");

      expect(result.outcome).toBe("review_required");
      expect(dbMock.reserveDrawCapacity).not.toHaveBeenCalled();
      expect(dbMock.demoteSettledOrderToReview).toHaveBeenCalledWith(
        "pay_123",
        expect.stringContaining("não está mais ativo"),
      );
    });

    it("vai para conciliação manual se a capacidade do sorteio está esgotada", async () => {
      dbMock.getPaymentOrderByProviderId.mockResolvedValue(ticketOrder);
      dbMock.claimPendingPaymentOrder.mockResolvedValue(ticketOrder);
      dbMock.getDrawById.mockResolvedValue(draw({ id: 7 }));
      dbMock.reserveDrawCapacity.mockResolvedValue(null);

      const result = await settlePaymentOrder("pay_123");

      expect(result.outcome).toBe("review_required");
      expect(dbMock.insertTicketNumbers).not.toHaveBeenCalled();
      expect(dbMock.demoteSettledOrderToReview).toHaveBeenCalledWith(
        "pay_123",
        expect.stringContaining("capacidade"),
      );
    });
  });
});

describe("refundPaymentOrder", () => {
  it("retorna order_not_found se o pedido não existe", async () => {
    dbMock.getPaymentOrderByProviderId.mockResolvedValue(undefined);
    const result = await refundPaymentOrder("pay_x");
    expect(result).toEqual({ outcome: "order_not_found" });
  });

  it("cancela sem efeito colateral se o pedido nunca foi liquidado", async () => {
    dbMock.getPaymentOrderByProviderId.mockResolvedValue(order({ status: "pending" }));
    dbMock.markPaymentOrderRefunded.mockResolvedValue(order({ status: "refunded" }));

    const result = await refundPaymentOrder("pay_123");

    expect(result).toEqual({ outcome: "refunded_unsettled" });
    expect(dbMock.incrementUtefBalanceAtomic).not.toHaveBeenCalled();
  });

  it("nunca reverte saldo/bilhete automaticamente se o pedido já foi liquidado - vai para conciliação manual", async () => {
    dbMock.getPaymentOrderByProviderId.mockResolvedValue(order({ status: "settled" }));
    dbMock.demoteSettledOrderToReview.mockResolvedValue(order({ status: "review_required" }));

    const result = await refundPaymentOrder("pay_123");

    expect(result.outcome).toBe("review_required");
    expect(dbMock.incrementUtefBalanceAtomic).not.toHaveBeenCalled();
    expect(dbMock.demoteSettledOrderToReview).toHaveBeenCalledWith(
      "pay_123",
      expect.stringContaining("requer decisão manual"),
    );
  });
});
