import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "./db.js";
import { appRouter } from "./routers.js";

const caller = () => appRouter.createCaller({
  user: { id: 7, role: "admin", active: true }, req: {}, res: {},
} as never);

beforeEach(() => {
  vi.spyOn(db, "validateLeadAssignment").mockResolvedValue({ responsibleOk: true, brokerOk: true });
  vi.spyOn(db, "createLead").mockImplementation(async data => ({ id: 88, ...data }) as never);
  vi.spyOn(db, "addLeadActivity").mockResolvedValue(undefined as never);
});
afterEach(() => vi.restoreAllMocks());

describe("VGV simulado no cadastro do lead", () => {
  it("persiste o valor e os centavos no mesmo campo lido pelo detalhe e edição", async () => {
    const lead = await caller().leads.create({ name: "Cliente teste", simulationValue: 230000.75 });
    expect(db.createLead).toHaveBeenCalledWith(expect.objectContaining({ simulationValue: "230000.75" }));
    expect(lead.simulationValue).toBe("230000.75");
  });

  it("continua permitindo cadastro sem simulação", async () => {
    await expect(caller().leads.create({ name: "Cliente teste" })).resolves.toMatchObject({ id: 88 });
  });

  it.each([-1, Number.POSITIVE_INFINITY, Number.NaN, 10_000_000_000_000])("recusa valor inválido %s antes da gravação", async simulationValue => {
    await expect(caller().leads.create({ name: "Cliente teste", simulationValue })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.createLead).not.toHaveBeenCalled();
  });

  it("não aceita preencher financiamento aprovado pelo cadastro inicial", async () => {
    await caller().leads.create({ name: "Cliente teste", simulationValue: 230000, approvedValue: 180000 } as never);
    expect(vi.mocked(db.createLead).mock.calls[0][0]).not.toHaveProperty("approvedValue");
  });
});
