import { describe, it, expect } from "vitest";
import {
  createAsaasPayment,
  getAsaasPixQrCode,
  createOrUpdateAsaasCustomer,
} from "./_core/asaas";

describe("Asaas Integration", () => {
  it("should create customer successfully", async () => {
    const customer = await createOrUpdateAsaasCustomer({
      name: "Cliente Teste",
      email: "teste@efficaz.com.br",
      externalReference: "test_user_123",
    });

    expect(customer).toBeDefined();
    expect(customer.id).toBeDefined();
    expect(customer.name).toBe("Cliente Teste");
  }, 30000);

  it("should create PIX payment successfully", async () => {
    // Primeiro criar cliente com CPF
    const customer = await createOrUpdateAsaasCustomer({
      name: "Cliente Teste PIX",
      email: "pix@efficaz.com.br",
      cpfCnpj: "24971563792", // CPF válido de teste
      externalReference: "test_pix_user",
    });

    // Criar cobrança PIX de R$ 5,00 (valor mínimo)
    const payment = await createAsaasPayment({
      customer: customer.id!,
      billingType: "PIX",
      value: 5.0,
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      description: "Teste de integração PIX",
      externalReference: "test_pix_payment_" + Date.now(),
    });

    expect(payment).toBeDefined();
    expect(payment.id).toBeDefined();
    expect(payment.billingType).toBe("PIX");
    expect(payment.value).toBe(5.0);
    expect(payment.status).toBe("PENDING");
  }, 30000);

  it("should get PIX QR Code successfully", async () => {
    // Criar cliente e pagamento primeiro
    const customer = await createOrUpdateAsaasCustomer({
      name: "Cliente Teste QR Code",
      email: "qrcode@efficaz.com.br",
      cpfCnpj: "24971563792", // CPF válido de teste
      externalReference: "test_qrcode_user",
    });

    const payment = await createAsaasPayment({
      customer: customer.id!,
      billingType: "PIX",
      value: 5.0,
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      description: "Teste QR Code PIX",
      externalReference: "test_qrcode_" + Date.now(),
    });

    // Buscar QR Code
    const pixData = await getAsaasPixQrCode(payment.id);

    expect(pixData).toBeDefined();
    expect(pixData.encodedImage).toBeDefined();
    expect(pixData.payload).toBeDefined();
    // O encodedImage vem como base64 puro, sem prefixo
    expect(pixData.encodedImage.length).toBeGreaterThan(100);
  }, 30000);

  it("should create credit card payment successfully", async () => {
    const customer = await createOrUpdateAsaasCustomer({
      name: "Cliente Teste Cartão",
      email: "cartao@efficaz.com.br",
      cpfCnpj: "24971563792", // CPF válido de teste
      externalReference: "test_card_user",
    });

    const payment = await createAsaasPayment({
      customer: customer.id!,
      billingType: "CREDIT_CARD",
      value: 5.0, // Valor mínimo para cartão
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
      description: "Teste de integração Cartão",
      externalReference: "test_card_payment_" + Date.now(),
    });

    expect(payment).toBeDefined();
    expect(payment.id).toBeDefined();
    expect(payment.billingType).toBe("CREDIT_CARD");
    expect(payment.invoiceUrl).toBeDefined();
  }, 30000);
});
