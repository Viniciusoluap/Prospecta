import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { getDb } from "./db.js";
import {
  createLeadServiceWithAutomation, ensureLeadServicesSchema, linkRecordToLead, materializePendingServices,
} from "./lead-services-router.js";

vi.mock("./db.js", () => ({ getDb: vi.fn() }));

type Insert = { table: string; values: Record<string, unknown> };

/**
 * Banco falso mínimo: cada select/insert/update consome o próximo resultado da
 * fila correspondente; `execute` (SQL bruto) devolve as linhas informadas.
 */
function fakeDb(queues: { select?: unknown[][]; insert?: unknown[][]; update?: unknown[][]; execute?: unknown[][] }) {
  const inserts: Insert[] = [];
  const updates: Record<string, unknown>[] = [];
  const executed: unknown[] = [];
  const chain = (result: unknown, onValues?: (v: Record<string, unknown>) => void, onSet?: (v: Record<string, unknown>) => void) => {
    const builder: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
    };
    for (const method of ["from", "where", "limit", "orderBy", "innerJoin", "leftJoin", "onConflictDoNothing", "returning"])
      builder[method] = () => builder;
    builder.values = (v: Record<string, unknown>) => { onValues?.(v); return builder; };
    builder.set = (v: Record<string, unknown>) => { onSet?.(v); return builder; };
    return builder;
  };
  const db = {
    execute: async (query: unknown) => {
      executed.push(query);
      return { rows: queues.execute?.shift() ?? [] };
    },
    select: () => chain(queues.select?.shift() ?? []),
    insert: (table: Parameters<typeof getTableName>[0]) => {
      const entry: Insert = { table: getTableName(table), values: {} };
      inserts.push(entry);
      return chain(queues.insert?.shift() ?? [], v => { entry.values = v; });
    },
    update: () => chain(queues.update?.shift() ?? [], undefined, v => { updates.push(v); }),
  };
  vi.mocked(getDb).mockReturnValue(db as unknown as ReturnType<typeof getDb>);
  return { inserts, updates, executed };
}

const lead = {
  id: 7, name: "Maria Souza", phone: "(99) 98888-7777", email: "maria@example.com", cpf: null,
  address: "Rua das Flores, 100", neighborhood: "Centro", city: "Imperatriz", state: "MA", notes: null,
};
const service = (overrides: Record<string, unknown>) => ({
  id: 40, leadId: 7, serviceType: "projeto_tecnico", title: null, status: "awaiting_data", originList: null,
  sourceCardUrl: null, idempotencyKey: "7:projeto_tecnico", dueAt: null, description: "",
  operationalModule: "projetos", operationalRecordId: null, createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
});

// A inicialização idempotente do esquema é memorizada; roda uma vez antes das filas.
let schemaStatements: string[] = [];
beforeAll(async () => {
  const { executed } = fakeDb({});
  await ensureLeadServicesSchema();
  const dialect = new PgDialect();
  schemaStatements = executed.map(query => dialect.sqlToQuery(query as SQL).sql.replace(/\s+/g, " "));
});
beforeEach(() => vi.clearAllMocks());

describe("EPIC-017 — vínculo no CRM cria o registro real", () => {
  it("Projeto técnico: cria o projeto com os dados do lead, sem presumir dados técnicos", async () => {
    const created = service({});
    const { inserts, updates } = fakeDb({
      select: [[lead], [], [{ id: 40 }]],
      insert: [[created], [{ id: 70 }]],
      update: [[{ ...created, operationalRecordId: 70, status: "active" }]],
    });
    const result = await createLeadServiceWithAutomation({ leadId: 7, serviceType: "projeto_tecnico" });
    const project = inserts.find(entry => entry.table === "operational_projects");
    expect(project?.values).toMatchObject({
      name: "Projeto técnico — Maria Souza", clientName: "Maria Souza", clientPhone: "(99) 98888-7777",
      engineer: "", value: "0", types: "[]", status: "orcamento", leadId: 7, leadServiceId: 40,
    });
    expect(updates).toContainEqual(expect.objectContaining({ operationalRecordId: 70, status: "active" }));
    expect(result.service.operationalRecordId).toBe(70);
  });

  it("Regularização: cria o processo com nome, telefone e endereço completo do lead", async () => {
    const created = service({ id: 41, serviceType: "regularizacao", operationalModule: "regularizacoes", idempotencyKey: "7:regularizacao" });
    const { inserts } = fakeDb({
      select: [[lead], [], [{ id: 41 }]],
      insert: [[created], [{ id: 80 }]],
      update: [[{ ...created, operationalRecordId: 80 }]],
    });
    await createLeadServiceWithAutomation({ leadId: 7, serviceType: "regularizacao" });
    const record = inserts.find(entry => entry.table === "regularizacoes");
    expect(record?.values).toMatchObject({
      clientName: "Maria Souza", clientPhone: "(99) 98888-7777",
      address: "Rua das Flores, 100, Centro, Imperatriz/MA", type: "", responsible: "", leadId: 7, leadServiceId: 41,
    });
  });

  it("não cria registro novo quando já existe processo inequívoco do mesmo lead", async () => {
    const created = service({});
    const { inserts } = fakeDb({
      select: [[lead], [], [{ id: 40 }]],
      insert: [[created]],
      update: [[{ ...created, operationalRecordId: 55 }]],
      execute: [[{ id: 55, lead_id: 7, lead_service_id: null }], [{ id: 55 }]],
    });
    await createLeadServiceWithAutomation({ leadId: 7, serviceType: "projeto_tecnico" });
    expect(inserts.map(entry => entry.table)).toEqual(["lead_services"]);
  });

  it("Avaliação e Financiamento não são criados automaticamente (dependem de dados técnicos)", async () => {
    const created = service({ id: 42, serviceType: "avaliacao", operationalModule: "avaliacoes", idempotencyKey: "7:avaliacao" });
    const { inserts } = fakeDb({ select: [[lead], [], [{ id: 42 }]], insert: [[created]] });
    await createLeadServiceWithAutomation({ leadId: 7, serviceType: "avaliacao" });
    expect(inserts.map(entry => entry.table)).toEqual(["lead_services"]);
  });

  it("registro criado no módulo sem demanda prévia gera o serviço já vinculado no lead", async () => {
    const { inserts, executed } = fakeDb({
      select: [[]],
      insert: [[{ id: 90 }]],
    });
    await expect(linkRecordToLead("financiamentos", 7, 33)).resolves.toBe("service_created");
    expect(inserts[0]).toMatchObject({
      table: "lead_services",
      values: { leadId: 7, serviceType: "financiamento_habitacional", status: "active", operationalModule: "financiamentos", operationalRecordId: 33 },
    });
    expect(executed).toHaveLength(1);
  });

  it("sem lead não cria vínculo", async () => {
    fakeDb({});
    await expect(linkRecordToLead("avaliacoes", null, 33)).resolves.toBe("no_lead");
  });
});

describe("Codex #87 — registro criado no módulo nunca fica sem serviço no lead", () => {
  const linkedService = (overrides: Record<string, unknown>) => service({
    id: 50, serviceType: "avaliacao", status: "active", operationalModule: "avaliacoes",
    idempotencyKey: "7:avaliacao", operationalRecordId: 31, ...overrides,
  });

  it("segunda avaliação do mesmo lead cria um novo serviço em vez de ficar órfã", async () => {
    const { inserts, executed } = fakeDb({
      select: [[linkedService({})]],
      insert: [[{ id: 91 }]],
    });
    await expect(linkRecordToLead("avaliacoes", 7, 34)).resolves.toBe("service_created");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      table: "lead_services",
      values: { leadId: 7, serviceType: "avaliacao", status: "active", operationalModule: "avaliacoes", operationalRecordId: 34 },
    });
    // O registro recém-criado recebe o lead_service_id do serviço novo.
    expect(executed).toHaveLength(1);
  });

  it("com uma demanda livre e outra já atendida, conecta à demanda livre sem criar outra", async () => {
    const { inserts, updates } = fakeDb({
      select: [[linkedService({}), linkedService({ id: 51, operationalRecordId: null })]],
      execute: [[{ id: 34 }]],
    });
    await expect(linkRecordToLead("avaliacoes", 7, 34)).resolves.toBe("linked");
    expect(inserts).toHaveLength(0);
    expect(updates).toContainEqual(expect.objectContaining({ operationalRecordId: 34 }));
  });

  it("religar o mesmo registro é idempotente", async () => {
    const { inserts } = fakeDb({
      select: [[linkedService({ id: 52, operationalRecordId: 60 }), linkedService({ operationalRecordId: 34 })]],
      execute: [[{ id: 34 }]],
    });
    await expect(linkRecordToLead("avaliacoes", 7, 34)).resolves.toBe("linked");
    expect(inserts).toHaveLength(0);
  });
});

describe("Codex #87 — materialização concorrente não duplica registros", () => {
  it("o esquema garante um único registro operacional por serviço em Projetos e Regularização", () => {
    for (const table of ["operational_projects", "regularizacoes"]) {
      const index = schemaStatements.findIndex(statement =>
        statement.includes(`CREATE UNIQUE INDEX IF NOT EXISTS "${table}_lead_service_id_unique" ON "${table}" ("lead_service_id")`));
      expect(index).toBeGreaterThan(-1);
      // Duplicatas antigas são desfeitas antes, senão a criação do índice falharia em produção.
      const dedupe = schemaStatements.findIndex(statement =>
        statement.startsWith(`UPDATE "${table}" AS r SET "lead_service_id" = NULL`));
      expect(dedupe).toBeGreaterThan(-1);
      expect(dedupe).toBeLessThan(index);
    }
  });

  it("quando outro administrador criou o registro primeiro, reutiliza o dele", async () => {
    const pending = service({ id: 41, serviceType: "regularizacao", operationalModule: "regularizacoes", idempotencyKey: "7:regularizacao" });
    const { inserts, updates } = fakeDb({
      // pendentes → irmãos na reconciliação → registro do vencedor da corrida
      select: [[{ service: pending, lead }], [{ id: 41 }], [{ id: 81 }]],
      execute: [[]],
      // ON CONFLICT DO NOTHING: o índice único barrou o segundo insert
      insert: [[]],
      update: [[{ ...pending, operationalRecordId: 81, status: "active" }]],
    });
    await expect(materializePendingServices("regularizacoes")).resolves.toEqual([{ serviceId: 41, state: "already_linked" }]);
    expect(inserts.map(entry => entry.table)).toEqual(["regularizacoes"]);
    expect(updates).toContainEqual(expect.objectContaining({ operationalRecordId: 81 }));
  });
});
