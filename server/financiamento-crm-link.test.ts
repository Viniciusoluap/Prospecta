import { describe, expect, it, vi } from "vitest";
import { getDb } from "./db";
import { router } from "./_core/trpc";
import { financiamentoRouter } from "./financiamento-router";

vi.mock("./db", () => ({ getDb: vi.fn() }));

const app = router({ financiamentos: financiamentoRouter });

const admin = () =>
  ({ user: { id: 99, role: "admin", active: true }, req: {}, res: {} }) as never;

/**
 * Réplica mínima do construtor fluente do Drizzle. Cada chamada de entrada
 * (select/insert/update) consome, em ordem, a próxima resposta da fila e
 * registra os argumentos de `values`/`set`/`where` para asserção.
 */
type Call = { method: "select" | "insert" | "update"; values?: unknown; where?: unknown };

function createFakeDb(responses: unknown[]) {
  let i = 0;
  const calls: Call[] = [];
  const next = () => {
    if (i >= responses.length) throw new Error(`createFakeDb: sem resposta cadastrada para a chamada #${i + 1}`);
    return responses[i++];
  };
  function chain(record: Call, value: unknown) {
    const obj: Record<string, unknown> = {
      from: () => obj,
      where: (cond: unknown) => { record.where = cond; return obj; },
      limit: () => obj,
      orderBy: () => obj,
      values: (vals: unknown) => { record.values = vals; return obj; },
      onConflictDoNothing: () => obj,
      set: (vals: unknown) => { record.values = vals; return obj; },
      returning: () => Promise.resolve(value),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(value).then(resolve, reject),
      catch: (reject: (e: unknown) => unknown) => Promise.resolve(value).catch(reject),
    };
    return obj;
  }
  const db = {
    select: () => { const record: Call = { method: "select" }; calls.push(record); return chain(record, next()); },
    insert: () => { const record: Call = { method: "insert" }; calls.push(record); return chain(record, next()); },
    update: () => { const record: Call = { method: "update" }; calls.push(record); return chain(record, next()); },
    execute: () => Promise.resolve({ rows: [] }),
    transaction: (run: (tx: unknown) => Promise<unknown>) => run(db),
  };
  return { db, calls };
}

const lead = {
  id: 1,
  name: "Maria da Silva",
  phone: "11988887777",
  email: "maria@example.com",
  city: "Imperatriz",
  state: "MA",
  notes: null,
};

const createdLeadService = {
  id: 10,
  leadId: 1,
  serviceType: "financiamento_habitacional",
  title: null,
  status: "awaiting_data",
  operationalModule: "financiamentos",
  operationalRecordId: null,
  idempotencyKey: "1:financiamento_habitacional",
};

describe("EPIC Lote 3 — Financiamentos originados exclusivamente no CRM", () => {
  it("bloqueia a criação avulsa de financiamento no servidor (sem lead vinculado)", async () => {
    const { db, calls } = createFakeDb([]);
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(
      app.createCaller(admin()).financiamentos.create({
        clienteNome: "Cliente Avulso",
        clienteTel: "11999999999",
        imovel: "Casa X",
        tipo: "mcmv",
        banco: "caixa",
        valorImovel: 100_000,
        valorFinanciado: 80_000,
        entrada: 20_000,
        taxa: 10,
        prazo: 360,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(calls.some(c => c.method === "insert")).toBe(false);
  });

  it("recusa leadId inexistente ao tentar criar financiamento diretamente", async () => {
    const { db, calls } = createFakeDb([[]]); // select leads -> não encontrado
    vi.mocked(getDb).mockReturnValue(db as never);

    await expect(
      app.createCaller(admin()).financiamentos.create({
        clienteNome: "Cliente",
        clienteTel: "11999999999",
        imovel: "Casa X",
        tipo: "mcmv",
        banco: "caixa",
        valorImovel: 100_000,
        valorFinanciado: 80_000,
        entrada: 20_000,
        taxa: 10,
        prazo: 360,
        leadId: 999,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(calls.some(c => c.method === "insert")).toBe(false);
  });

  it("vincular o serviço no lead cria o financiamento inicial só com dados do CRM, sem inventar imóvel/tipo/banco", async () => {
    const { createLeadServiceWithAutomation } = await import("./lead-services-router.js");
    const createdFinanciamento = { id: 501, leadId: 1, leadServiceId: 10 };
    const updatedLeadService = { ...createdLeadService, operationalRecordId: 501, status: "active" };

    const { db, calls } = createFakeDb([
      [lead],                 // 1. select leads
      [],                     // 2. select leadServices existentes (nenhum)
      [createdLeadService],   // 3. insert leadServices
      [],                     // 4. select financiamentos por leadServiceId (nenhum)
      [],                     // 5. select financiamentos órfãos do lead (nenhum)
      [],                     // 6. select lead_services irmãos do módulo financiamentos
      [createdFinanciamento], // 7. insert financiamentos
      [],                     // 8. insert financiamento_checklist_items
      [updatedLeadService],   // 9. update leadServices
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await createLeadServiceWithAutomation({
      leadId: 1,
      serviceType: "financiamento_habitacional",
    });

    expect(result.workState).toBe("created");
    expect(result.service).toMatchObject({ operationalRecordId: 501, operationalModule: "financiamentos" });

    const financiamentoInsert = calls.filter(c => c.method === "insert")[1];
    expect(financiamentoInsert.values).toMatchObject({
      leadId: 1,
      leadServiceId: 10,
      clienteNome: "Maria da Silva",
      clienteTel: "11988887777",
      clienteEmail: "maria@example.com",
    });
    // Imóvel, tipo e banco nunca são inventados — ficam para a edição operacional.
    expect(financiamentoInsert.values).not.toHaveProperty("imovel");
    expect(financiamentoInsert.values).not.toHaveProperty("tipo");
    expect(financiamentoInsert.values).not.toHaveProperty("banco");
    expect(financiamentoInsert.values).not.toHaveProperty("clienteCpf");
  });

  it("vincular o mesmo serviço duas vezes não duplica o financiamento (idempotência)", async () => {
    const { createLeadServiceWithAutomation } = await import("./lead-services-router.js");
    const alreadyLinkedService = { ...createdLeadService, operationalRecordId: 501 };
    const updatedLeadService = { ...alreadyLinkedService, status: "active" };

    const { db, calls } = createFakeDb([
      [lead],                        // 1. select leads
      [alreadyLinkedService],        // 2. select leadServices existentes (já havia um vínculo)
      [{ id: 501 }],                 // 3. select financiamentos por leadServiceId (já existe!)
      [updatedLeadService],          // 4. update leadServices
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await createLeadServiceWithAutomation({
      leadId: 1,
      serviceType: "financiamento_habitacional",
    });

    expect(result.workState).toBe("already_linked");
    expect(calls.filter(c => c.method === "insert")).toHaveLength(0);
  });

  it("financiamento legado sem vínculo de lead continua editável normalmente", async () => {
    const legacyFinanciamento = {
      id: 42,
      leadId: null,
      leadServiceId: null,
      clienteNome: "Cliente legado",
      clienteTel: "11900000000",
      clienteCpf: null,
      clienteEmail: null,
      imovel: "Casa antiga",
      tipo: "sbpe",
      banco: "bb",
      status: "documentacao",
      valorImovel: "100.00",
      valorFinanciado: "80.00",
      entrada: "20.00",
      taxa: "9.0000",
      prazo: 300,
    };
    const { db } = createFakeDb([
      [{ leadId: null }],                                      // 1. select financiamentos.leadId atual
      [{ ...legacyFinanciamento, protocolo: "NOVO-PROTOCOLO" }], // 2. update financiamentos
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);

    const updated = await app.createCaller(admin()).financiamentos.update({
      id: 42,
      data: { protocolo: "NOVO-PROTOCOLO" },
    });

    expect(updated).toMatchObject({ id: 42, protocolo: "NOVO-PROTOCOLO", leadId: null });
  });
});
