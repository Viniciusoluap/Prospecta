import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as banco from "./db.js";
import { obraProgressoRouter } from "./obra-progresso-router";
import { constructionProgressHistory, constructionProjects } from "../drizzle/schema";
import { SERVICOS_PROGRESSO } from "../shared/financeiro/progresso";

afterEach(() => vi.restoreAllMocks());

/** Contrato transacional do driver: uma falha no batch desfaz todas as operações. */
function bancoComFalha(...respostas: unknown[][]) {
  let estado = { historicoExiste: true, historicoAlterado: false };
  const operacao = (executar: () => unknown) => ({
    executar,
    then: (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) =>
      Promise.resolve().then(executar).then(ok, erro),
  });
  const fila = [...respostas];
  const select = () => {
    const q = { from: () => q, where: () => q, orderBy: () => q, limit: async () => fila.shift() ?? [] };
    return q;
  };
  const db = {
    select,
    execute: (query: Parameters<PgDialect["sqlToQuery"]>[0]) => operacao(() => {
      const texto = new PgDialect().sqlToQuery(query).sql;
      if (/UPDATE construction_projects/.test(texto)) throw new Error("falha ao restaurar progresso");
      if (/created_at::text/.test(texto)) return { rows: [{ criada: "2026-10-18 10:00:00.123456" }] };
      return undefined;
    }),
    delete: (tabela: unknown) => ({ where: () => operacao(() => {
      if (tabela === constructionProgressHistory) estado.historicoExiste = false;
    }) }),
    insert: () => ({ values: () => operacao(() => undefined) }),
    update: (tabela: unknown) => ({ set: () => ({ where: () => operacao(() => {
      if (tabela === constructionProjects) throw new Error("falha ao restaurar progresso");
      if (tabela === constructionProgressHistory) estado.historicoAlterado = true;
    }) }) }),
    batch: async (ops: ReturnType<typeof operacao>[]) => {
      const antes = { ...estado };
      try { for (const op of ops) op.executar(); }
      catch (e) { estado = antes; throw e; }
    },
  };
  vi.spyOn(banco, "getDb").mockReturnValue(db as never);
  return () => estado;
}

const itens = SERVICOS_PROGRESSO.map(s => ({ chave: s.chave, incidencia: s.incidenciaPadrao, execucao: "50" }));
const caller = () => obraProgressoRouter.createCaller({ user: { id: 1, role: "admin", active: true }, req: {}, res: {} } as never);

describe("medições: falha na atualização do progresso", () => {
  it("preserva o histórico se a restauração após excluir a vigente falhar", async () => {
    const estado = bancoComFalha([{ id: 2, projectId: 10 }]);
    await expect(caller().excluirMedicao({ medicaoId: 2 })).rejects.toThrow("falha ao restaurar progresso");
    expect(estado().historicoExiste).toBe(true);
  });

  it("preserva o conteúdo anterior do histórico se editar a vigente falhar", async () => {
    const estado = bancoComFalha([{ id: 2, projectId: 10, measurementType: "pls" }], []);
    await expect(caller().editarMedicao({ medicaoId: 2, itens })).rejects.toThrow("falha ao restaurar progresso");
    expect(estado().historicoAlterado).toBe(false);
  });
});

describe("medições: editar/excluir medição antiga não desfaz o vínculo da PCI", () => {
  function bancoQueRegistra(...respostas: unknown[][]) {
    const comandos: string[] = [];
    const fila = [...respostas];
    const q = { from: () => q, where: () => q, orderBy: () => q, limit: async () => fila.shift() ?? [] };
    const operacao = (texto: string, valor?: unknown) => ({ texto, then: (ok: (v: unknown) => unknown) => Promise.resolve(valor).then(ok) });
    const db = {
      select: () => q,
      execute: (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const texto = new PgDialect().sqlToQuery(query).sql;
        return operacao(texto, /created_at::text/.test(texto) ? { rows: [{ criada: "2026-10-18 10:00:00.123456" }] } : undefined);
      },
      delete: () => ({ where: () => operacao("delete history") }),
      update: () => ({ set: () => ({ where: () => operacao("update history") }) }),
      batch: async (ops: { texto: string }[]) => { comandos.push(...ops.map(o => o.texto)); },
    };
    vi.spyOn(banco, "getDb").mockReturnValue(db as never);
    return comandos;
  }

  it("editar: só reaplica os itens quando a medição editada é a vigente", async () => {
    const comandos = bancoQueRegistra([{ id: 2, projectId: 10, measurementType: "pls" }], []);
    await caller().editarMedicao({ medicaoId: 2, itens });
    const sincronia = comandos.filter(c => /construction_progress_items|UPDATE construction_projects/.test(c));
    expect(sincronia).toHaveLength(3);
    for (const c of sincronia) expect(c).toMatch(/ORDER BY created_at DESC, id DESC LIMIT 1\) = \$/);
  });

  it("excluir: só reaplica quando a excluída era a vigente", async () => {
    const comandos = bancoQueRegistra([{ id: 2, projectId: 10 }]);
    await caller().excluirMedicao({ medicaoId: 2 });
    const sincronia = comandos.filter(c => /construction_progress_items|UPDATE construction_projects/.test(c));
    expect(sincronia).toHaveLength(3);
    for (const c of sincronia) expect(c).toMatch(/NOT EXISTS \(SELECT 1 FROM construction_progress_history WHERE project_id = \$\d+ AND \(created_at, id\) >/);
  });
});
