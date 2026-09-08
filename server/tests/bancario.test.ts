import { describe, expect, it } from "vitest";
import {
  bankAccounts, bankTransactions, pluggySettings,
  bankAccountTipoEnum, bankTransactionTipoEnum, bankTransactionStatusEnum,
} from "../../drizzle/schema";
import { appRouter } from "../routers";

describe("EPIC-007 S-03 - Integracao bancaria (Pluggy)", () => {
  it("tabela bank_accounts tem os campos de conta bancaria", () => {
    expect(bankAccounts.banco).toBeDefined();
    expect(bankAccounts.conta).toBeDefined();
    expect(bankAccounts.tipo).toBeDefined();
    expect(bankAccounts.saldoAtual).toBeDefined();
    expect(bankAccounts.pluggyAccountId).toBeDefined();
    expect(bankAccounts.ultimaSincronizacao).toBeDefined();
  });

  it("tabela bank_transactions tem os campos de transacao", () => {
    expect(bankTransactions.accountId).toBeDefined();
    expect(bankTransactions.valor).toBeDefined();
    expect(bankTransactions.tipo).toBeDefined();
    expect(bankTransactions.status).toBeDefined();
    expect(bankTransactions.externalId).toBeDefined();
  });

  it("tabela pluggy_settings guarda credenciais criptografadas (nao em env var)", () => {
    expect(pluggySettings.clientIdEncrypted).toBeDefined();
    expect(pluggySettings.clientSecretEncrypted).toBeDefined();
    expect(pluggySettings.isActive).toBeDefined();
  });

  it("enums tem os valores esperados", () => {
    expect(bankAccountTipoEnum.enumValues).toEqual(["corrente", "poupanca", "pagamento", "investimento"]);
    expect(bankTransactionTipoEnum.enumValues).toEqual(["credito", "debito"]);
    expect(bankTransactionStatusEnum.enumValues).toEqual(["pendente", "conciliado", "ignorado"]);
  });

  it("expoe as procedures de contas, transacoes, sincronizacao e credenciais Pluggy", () => {
    const procedures = appRouter._def.procedures;
    expect(procedures["bancario.contas.list"]).toBeDefined();
    expect(procedures["bancario.contas.create"]).toBeDefined();
    expect(procedures["bancario.contas.delete"]).toBeDefined();
    expect(procedures["bancario.contas.atualizarSaldo"]).toBeDefined();
    expect(procedures["bancario.transacoes.listByConta"]).toBeDefined();
    expect(procedures["bancario.transacoes.atualizarStatus"]).toBeDefined();
    expect(procedures["bancario.sincronizar"]).toBeDefined();
    expect(procedures["pluggySettings.status"]).toBeDefined();
    expect(procedures["pluggySettings.save"]).toBeDefined();
  });
});
