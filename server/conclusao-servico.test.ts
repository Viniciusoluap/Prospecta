import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { getDb } from "./db.js";
import { concluirRegistroDoServico, reconciliarConclusoes } from "./conclusao-servico.js";
import { mensagemConclusao, moduloConcluivel, STATUS_CONCLUIDO_DO_MODULO } from "../shared/conclusao-servico.js";

vi.mock("./db.js", () => ({ getDb: vi.fn() }));
const dialeto = new PgDialect();

/** Cada execute consome a próxima resposta e registra o SQL gerado. */
function fakeDb(respostas: Array<Array<Record<string, unknown>>>) {
  const consultas: { sql: string; params: unknown[] }[] = [];
  let i = 0;
  vi.mocked(getDb).mockReturnValue({
    execute: async (q: SQL) => { const c = dialeto.sqlToQuery(q); consultas.push({ sql: c.sql, params: c.params }); return { rows: respostas[i++] ?? [] }; },
  } as never);
  return consultas;
}

describe("Concluir serviço no CRM conclui o módulo (etapa 4)", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(Object.entries(STATUS_CONCLUIDO_DO_MODULO))("%s: grava só o status de conclusão, buscando pelo ID do serviço", async (modulo, final) => {
    const consultas = fakeDb([[{ id: 10 }]]);
    expect(await concluirRegistroDoServico({ id: 95, operationalModule: modulo })).toEqual({ estado: "concluido", modulo, registroId: 10 });
    expect(consultas).toHaveLength(1);
    expect(consultas[0].sql).toMatch(/^\s*UPDATE "[a-z_]+" SET status = \$1, updated_at = now\(\)\s+WHERE lead_service_id = \$2 AND status::text NOT IN/);
    expect(consultas[0].params.slice(0, 2)).toEqual([final, 95]);
    expect(consultas[0].sql).not.toMatch(/name|nome|cpf|DELETE/i);
  });

  it("já concluído, cancelado ou sem registro: não altera e informa com honestidade", async () => {
    fakeDb([[], [{ id: 10, status: "liberado" }]]);
    expect(await concluirRegistroDoServico({ id: 95, operationalModule: "financiamentos" })).toMatchObject({ estado: "ja_concluido", registroId: 10 });
    fakeDb([[], [{ id: 22, status: "cancelado" }]]);
    const cancelado = await concluirRegistroDoServico({ id: 67, operationalModule: "regularizacoes" });
    expect(cancelado.estado).toBe("cancelado");
    expect(mensagemConclusao(cancelado)).toMatch(/cancelado e não foi alterado/);
    fakeDb([[], []]);
    expect(await concluirRegistroDoServico({ id: 1, operationalModule: "obras" })).toEqual({ estado: "sem_registro", modulo: "obras" });
  });

  it("módulos sem vínculo por ID (comissões, jurídico) não são tocados", async () => {
    const consultas = fakeDb([]);
    expect(await concluirRegistroDoServico({ id: 1, operationalModule: "comissoes" })).toEqual({ estado: "sem_modulo", modulo: "comissoes" });
    expect(consultas).toHaveLength(0);
    expect(moduloConcluivel("juridico")).toBe(false);
  });

  it("reconciliação lista divergências e só aplica quando pedido", async () => {
    const lista = fakeDb([[{ id: 67, lead_id: 67, operational_module: "regularizacoes" }, { id: 5, lead_id: 3, operational_module: "comissoes" }], [{ id: 22, status: "em_andamento" }]]);
    const r = await reconciliarConclusoes(false);
    expect(r).toEqual({ aplicado: false, divergentes: [{ servicoId: 67, leadId: 67, modulo: "regularizacoes", registroId: 22, statusAtual: "em_andamento" }] });
    expect(lista.some(c => c.sql.startsWith("UPDATE") || c.sql.includes(" UPDATE "))).toBe(false);
    const aplicando = fakeDb([[{ id: 67, lead_id: 67, operational_module: "regularizacoes" }], [{ id: 22, status: "em_andamento" }], [{ id: 22 }]]);
    expect((await reconciliarConclusoes(true)).aplicado).toBe(true);
    expect(aplicando.at(-1)!.params.slice(0, 2)).toEqual(["concluido", 67]);
  });
});
