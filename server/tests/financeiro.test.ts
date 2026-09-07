import { describe, expect, it } from "vitest";
import { financialTransactions, financialTransactionStatusEnum } from "../../drizzle/schema";
import { appRouter } from "../routers";

describe("EPIC-007 S-01 - Contabilidade (financial_transactions estendida)", () => {
  it("tabela financial_transactions tem os campos novos de contas a pagar/receber", () => {
    expect(financialTransactions.status).toBeDefined();
    expect(financialTransactions.dueDate).toBeDefined();
    expect(financialTransactions.paymentMethod).toBeDefined();
    expect(financialTransactions.externalReference).toBeDefined();
    expect(financialTransactions.competency).toBeDefined();
    expect(financialTransactions.vendor).toBeDefined();
  });

  it("enum de status tem pending/paid/cancelled", () => {
    expect(financialTransactionStatusEnum.enumValues).toEqual(["pending", "paid", "cancelled"]);
  });

  it("expõe a mutation updateStatus no router", () => {
    const procedures = appRouter._def.procedures;
    expect(procedures["financialTransactions.updateStatus"]).toBeDefined();
    expect(procedures["financialTransactions.create"]).toBeDefined();
    expect(procedures["financialTransactions.list"]).toBeDefined();
  });
});
