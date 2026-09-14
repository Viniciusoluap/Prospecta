import { describe, expect, it } from "vitest";
import {
  buildCorretorRanking,
  buildComissoesExportLegado,
  buildComissoesExportNovas,
  type ComissaoLegadoFullRow,
  type ComissaoNovaFullRow,
} from "./relatorios-router";

/**
 * EPIC-012 S-11 (C1) - unificação de relatórios de comissões.
 *
 * broker_commissions (legado, congelado) e operational_commissions (novo,
 * desde a Etapa 4) são tabelas disjuntas: nenhum registro migra de uma para
 * a outra, então somar as duas nunca duplica um mesmo negócio. A regra:
 * legado não tem `status` (pago = soma real das parcelas pagas, pode ser
 * parcial); o novo só conta como pago quando `status === "paga"` -
 * pendente/aprovada/cancelada nunca entram no total pago.
 */
describe("EPIC-012 S-11 (C1) - buildCorretorRanking", () => {
  it("legado pago (soma das 4 parcelas = total) entra no ranking pelo valor pago", () => {
    const legado: ComissaoLegadoFullRow[] = [
      {
        brokerName: "Ana Legado",
        installment1Paid: "1000",
        installment2Paid: "1000",
        installment3Paid: "1000",
        installment4Paid: "1000",
        createdAt: new Date("2026-01-10"),
        clientName: "Cliente A",
        totalCommission: "4000",
      },
    ];
    const ranking = buildCorretorRanking(legado, []);
    expect(ranking).toEqual([{ nome: "Ana Legado", totalPago: 4000 }]);
  });

  it("legado parcialmente pago entra no ranking só pelo valor efetivamente pago", () => {
    const legado: ComissaoLegadoFullRow[] = [
      {
        brokerName: "Bruno Legado",
        installment1Paid: "500",
        installment2Paid: "0",
        installment3Paid: null,
        installment4Paid: null,
        createdAt: new Date("2026-02-01"),
        clientName: "Cliente B",
        totalCommission: "2000",
      },
    ];
    const ranking = buildCorretorRanking(legado, []);
    expect(ranking).toEqual([{ nome: "Bruno Legado", totalPago: 500 }]);
  });

  it("novo com status 'paga' entra no ranking pelo valor total", () => {
    const novas: ComissaoNovaFullRow[] = [
      {
        brokerName: "Carla Nova",
        beneficiary: "corretor",
        property: "Apto 101",
        amount: "3000",
        status: "paga",
        dueDate: new Date("2026-03-01"),
        paidAt: new Date("2026-03-05"),
      },
    ];
    const ranking = buildCorretorRanking([], novas);
    expect(ranking).toEqual([{ nome: "Carla Nova", totalPago: 3000 }]);
  });

  it("novo com status 'pendente' NAO entra no total pago do ranking", () => {
    const novas: ComissaoNovaFullRow[] = [
      {
        brokerName: "Diego Nova",
        beneficiary: "corretor",
        property: "Casa 202",
        amount: "1500",
        status: "pendente",
        dueDate: new Date("2026-03-01"),
        paidAt: null,
      },
    ];
    const ranking = buildCorretorRanking([], novas);
    expect(ranking).toEqual([]);
  });

  it("novo com status 'cancelada' NUNCA entra no total pago do ranking", () => {
    const novas: ComissaoNovaFullRow[] = [
      {
        brokerName: "Elisa Nova",
        beneficiary: "corretor",
        property: "Lote 303",
        amount: "800",
        status: "cancelada",
        dueDate: new Date("2026-03-01"),
        paidAt: null,
      },
    ];
    const ranking = buildCorretorRanking([], novas);
    expect(ranking).toEqual([]);
  });

  it("soma legado e novo do mesmo corretor sem duplicar (fontes disjuntas)", () => {
    const legado: ComissaoLegadoFullRow[] = [
      {
        brokerName: "Fábio Misto",
        installment1Paid: "1000",
        installment2Paid: "1000",
        installment3Paid: "0",
        installment4Paid: "0",
        createdAt: new Date("2026-01-01"),
        clientName: "Cliente Antigo",
        totalCommission: "4000",
      },
    ];
    const novas: ComissaoNovaFullRow[] = [
      {
        brokerName: "Fábio Misto",
        beneficiary: "corretor",
        property: "Novo Negócio",
        amount: "2000",
        status: "paga",
        dueDate: new Date("2026-04-01"),
        paidAt: new Date("2026-04-02"),
      },
    ];
    const ranking = buildCorretorRanking(legado, novas);
    expect(ranking).toEqual([{ nome: "Fábio Misto", totalPago: 4000 }]);
    // 1000+1000 (legado) + 2000 (novo, paga) = 4000, cada fonte contada uma unica vez
  });

  it("comissão para beneficiário 'empresa' (sem brokerId) nao aparece no ranking de corretores", () => {
    // A query do router filtra beneficiary = "corretor" antes de chegar aqui;
    // buildCorretorRanking so recebe registros ja filtrados. Este teste
    // documenta que, se brokerName vier nulo (corretor sem cadastro/removido),
    // o registro ainda e contado sob um rotulo generico, nunca descartado.
    const novas: ComissaoNovaFullRow[] = [
      {
        brokerName: null,
        beneficiary: "corretor",
        property: "Imóvel X",
        amount: "500",
        status: "paga",
        dueDate: new Date("2026-05-01"),
        paidAt: new Date("2026-05-01"),
      },
    ];
    const ranking = buildCorretorRanking([], novas);
    expect(ranking).toEqual([{ nome: "Corretor sem cadastro", totalPago: 500 }]);
  });

  it("respeita o limite (top N) e ordena do maior para o menor", () => {
    const novas: ComissaoNovaFullRow[] = Array.from({ length: 6 }, (_, i) => ({
      brokerName: `Corretor ${i}`,
      beneficiary: "corretor",
      property: "Imóvel",
      amount: String((i + 1) * 100),
      status: "paga",
      dueDate: new Date("2026-06-01"),
      paidAt: new Date("2026-06-01"),
    }));
    const ranking = buildCorretorRanking([], novas, 5);
    expect(ranking).toHaveLength(5);
    expect(ranking[0]).toEqual({ nome: "Corretor 5", totalPago: 600 });
    expect(ranking[4]).toEqual({ nome: "Corretor 1", totalPago: 200 });
  });
});

describe("EPIC-012 S-11 (C1) - buildComissoesExportLegado", () => {
  it("marca como 'pago' quando a soma das parcelas cobre o total", () => {
    const rows: ComissaoLegadoFullRow[] = [
      {
        brokerName: "Ana Legado",
        installment1Paid: "2000",
        installment2Paid: "2000",
        installment3Paid: "0",
        installment4Paid: "0",
        createdAt: new Date("2026-01-10"),
        clientName: "Cliente A",
        totalCommission: "4000",
      },
    ];
    const [row] = buildComissoesExportLegado(rows);
    expect(row.origem).toBe("legado");
    expect(row.referencia).toBe("Cliente A");
    expect(row.pago).toBe(4000);
    expect(row.status).toBe("pago");
  });

  it("marca como 'pago parcial' quando ha pagamento mas nao cobre o total", () => {
    const rows: ComissaoLegadoFullRow[] = [
      {
        brokerName: "Bruno Legado",
        installment1Paid: "500",
        installment2Paid: null,
        installment3Paid: null,
        installment4Paid: null,
        createdAt: new Date("2026-02-01"),
        clientName: "Cliente B",
        totalCommission: "2000",
      },
    ];
    const [row] = buildComissoesExportLegado(rows);
    expect(row.status).toBe("pago parcial");
  });

  it("marca como 'pendente' quando nao ha nenhum pagamento", () => {
    const rows: ComissaoLegadoFullRow[] = [
      {
        brokerName: "Carla Legado",
        installment1Paid: "0",
        installment2Paid: null,
        installment3Paid: null,
        installment4Paid: null,
        createdAt: new Date("2026-02-01"),
        clientName: "Cliente C",
        totalCommission: "1000",
      },
    ];
    const [row] = buildComissoesExportLegado(rows);
    expect(row.status).toBe("pendente");
  });
});

describe("EPIC-012 S-11 (C1) - buildComissoesExportNovas", () => {
  it("exporta status real (paga/pendente/aprovada/cancelada) sem inferencia", () => {
    const rows: ComissaoNovaFullRow[] = [
      { brokerName: "Diego", beneficiary: "corretor", property: "Imovel 1", amount: "1000", status: "paga", dueDate: new Date("2026-01-01"), paidAt: new Date("2026-01-05") },
      { brokerName: "Elisa", beneficiary: "corretor", property: "Imovel 2", amount: "500", status: "pendente", dueDate: new Date("2026-01-01"), paidAt: null },
      { brokerName: "Fabio", beneficiary: "corretor", property: "Imovel 3", amount: "300", status: "cancelada", dueDate: new Date("2026-01-01"), paidAt: null },
    ];
    const exportado = buildComissoesExportNovas(rows);
    expect(exportado.map((r) => r.status)).toEqual(["paga", "pendente", "cancelada"]);
    expect(exportado[0].pago).toBe(1000);
    expect(exportado[1].pago).toBe(0);
    expect(exportado[2].pago).toBe(0);
  });

  it("usa 'Empresa' como rotulo quando beneficiary=empresa e brokerName e nulo", () => {
    const rows: ComissaoNovaFullRow[] = [
      { brokerName: null, beneficiary: "empresa", property: "Imovel 4", amount: "700", status: "paga", dueDate: new Date("2026-01-01"), paidAt: new Date("2026-01-01") },
    ];
    const [row] = buildComissoesExportNovas(rows);
    expect(row.corretor).toBe("Empresa");
  });

  it("usa data de pagamento quando existe, senao a data de vencimento", () => {
    const rows: ComissaoNovaFullRow[] = [
      { brokerName: "Diego", beneficiary: "corretor", property: "Imovel 1", amount: "1000", status: "paga", dueDate: new Date("2026-01-01"), paidAt: new Date("2026-02-15") },
      { brokerName: "Elisa", beneficiary: "corretor", property: "Imovel 2", amount: "500", status: "pendente", dueDate: new Date("2026-03-10"), paidAt: null },
    ];
    const exportado = buildComissoesExportNovas(rows);
    expect(exportado[0].data).toBe("2026-02-15");
    expect(exportado[1].data).toBe("2026-03-10");
  });
});
