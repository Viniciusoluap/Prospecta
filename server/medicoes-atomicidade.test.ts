import { afterEach, describe, expect, it, vi } from "vitest";
import * as banco from "./db.js";
import { obraProgressoRouter } from "./obra-progresso-router";
import { constructionProgressHistory, constructionProjects } from "../drizzle/schema";
import { SERVICOS_PROGRESSO } from "../shared/financeiro/progresso";

afterEach(() => vi.restoreAllMocks());

/** Contrato transacional do driver: uma falha no batch desfaz todas as operações. */
function bancoComFalha(...respostas: unknown[][]) {
  let estado = { historicoExiste: true, historicoAlterado: false };
  const operacao = (executar: () => void) => ({
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
    const estado = bancoComFalha([{ id: 2, projectId: 10 }], [{ id: 2 }], [{ itens }]);
    await expect(caller().excluirMedicao({ medicaoId: 2 })).rejects.toThrow("falha ao restaurar progresso");
    expect(estado().historicoExiste).toBe(true);
  });

  it("preserva o conteúdo anterior do histórico se editar a vigente falhar", async () => {
    const estado = bancoComFalha([{ id: 2, projectId: 10, measurementType: "pls" }], [{ id: 2 }]);
    await expect(caller().editarMedicao({ medicaoId: 2, itens })).rejects.toThrow("falha ao restaurar progresso");
    expect(estado().historicoAlterado).toBe(false);
  });
});
