import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db";
import { router } from "./_core/trpc";
import { comissoesRouter } from "./operacional-router";

vi.mock("./db", () => ({ getDb: vi.fn() }));

// EPIC-020 Lote 3 (item 32): toda obra com corretor no CRM aparece em
// Comissões, derivada da obra — sem registro duplicado e sem % inventado.
const app = router({ comissoes: comissoesRouter });
const caller = (role: string) => app.createCaller({ user: { id: 1, role, active: true }, req: {}, res: {} } as never);

function fakeDb(respostas: unknown[]) {
  let i = 0;
  const cadeia = () => {
    const obj: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "orderBy", "leftJoin", "innerJoin"]) obj[m] = () => obj;
    obj.then = (ok: (v: unknown) => unknown) => Promise.resolve(respostas[i++]).then(ok);
    return obj;
  };
  return { select: () => cadeia() };
}

const linha = (o: Record<string, unknown>) => ({
  obraId: 1, obra: "Obra", status: "planning", vgv: null, percentualObra: null, leadId: 10, cliente: "Cliente",
  corretorId: 9, corretor: "Chaleilson", percentualCorretor: null, pago: "0", ...o,
});

beforeEach(() => vi.clearAllMocks());

describe("comissoes.obras", () => {
  it("só administrador acessa", async () => {
    await expect(caller("corretor").comissoes.obras()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lista obras antigas sem VGV/percentual como dados incompletos (sem valor inventado)", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[linha({})], []]) as never);
    const [r] = await caller("admin").comissoes.obras();
    expect(r.calculo.status).toBe("dados_incompletos");
    expect(r.calculo.valorCentavos).toBeNull();
    expect(r.calculo.pendencias).toHaveLength(2);
  });

  it("calcula VGV × % e considera pagamentos de categoria comissão", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([[linha({ vgv: "230000.00", percentualObra: "5.0000", pago: "5000.00" })], []]) as never);
    const [r] = await caller("admin").comissoes.obras();
    expect(r.calculo).toMatchObject({ valorCentavos: 1_150_000, pagoCentavos: 500_000, saldoCentavos: 650_000, status: "parcial" });
  });

  it("comissão manual da mesma obra é preservada e a divergência sinalizada", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([
      [linha({ vgv: "230000.00", percentualCorretor: "5.0000" })],
      [{ id: 3, obraId: 1, brokerId: 8, amount: "1000.00", percent: "5.00", status: "pendente" }],
    ]) as never);
    const [r] = await caller("admin").comissoes.obras();
    expect(r.registrosManuais).toHaveLength(1);
    expect(r.alertas.join(" ")).toContain("outro corretor");
    expect(r.alertas.join(" ")).toContain("valor diferente");
  });
});
