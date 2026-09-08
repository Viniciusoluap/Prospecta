import { describe, expect, it } from "vitest";
import { bpoClients, bpoLancamentos, bpoClientStatusEnum, bpoLancamentoTipoEnum } from "../../drizzle/schema";
import { appRouter } from "../routers";

describe("EPIC-007 S-02 - BPO (clientes e lancamentos)", () => {
  it("tabela bpo_clients tem os campos do cadastro de cliente BPO", () => {
    expect(bpoClients.razaoSocial).toBeDefined();
    expect(bpoClients.responsavel).toBeDefined();
    expect(bpoClients.telefone).toBeDefined();
    expect(bpoClients.servicos).toBeDefined();
    expect(bpoClients.status).toBeDefined();
    expect(bpoClients.honorarios).toBeDefined();
    expect(bpoClients.diaVencimento).toBeDefined();
    expect(bpoClients.dataInicio).toBeDefined();
  });

  it("tabela bpo_lancamentos tem os campos de cobranca/despesa", () => {
    expect(bpoLancamentos.clienteId).toBeDefined();
    expect(bpoLancamentos.clienteNomeLivre).toBeDefined();
    expect(bpoLancamentos.tipo).toBeDefined();
    expect(bpoLancamentos.valor).toBeDefined();
    expect(bpoLancamentos.vencimento).toBeDefined();
    expect(bpoLancamentos.pago).toBeDefined();
    expect(bpoLancamentos.competencia).toBeDefined();
  });

  it("enums tem os valores esperados", () => {
    expect(bpoClientStatusEnum.enumValues).toEqual(["ativo", "pausado", "encerrado"]);
    expect(bpoLancamentoTipoEnum.enumValues).toEqual(["honorario", "despesa", "reembolso"]);
  });

  it("expoe as procedures de clientes, lancamentos e DRE no router", () => {
    const procedures = appRouter._def.procedures;
    expect(procedures["bpo.clientes.list"]).toBeDefined();
    expect(procedures["bpo.clientes.create"]).toBeDefined();
    expect(procedures["bpo.clientes.updateStatus"]).toBeDefined();
    expect(procedures["bpo.lancamentos.list"]).toBeDefined();
    expect(procedures["bpo.lancamentos.create"]).toBeDefined();
    expect(procedures["bpo.lancamentos.marcarPago"]).toBeDefined();
    expect(procedures["bpo.dre"]).toBeDefined();
  });
});
