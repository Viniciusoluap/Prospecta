import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db";
import { router } from "./_core/trpc";
import { empreiteiroRouter, obraFinanceiroRouter } from "./obra-financeiro-router";

vi.mock("./db", () => ({ getDb: vi.fn() }));

const app = router({ obraFinanceiro: obraFinanceiroRouter, empreiteiro: empreiteiroRouter });
const caller = (role: string, id = 99) => app.createCaller({ user: { id, role, active: true }, req: {}, res: {} } as never);

type Resposta = unknown | ((valores: unknown) => unknown);

/** Banco simulado: cada consulta consome a próxima resposta; inserts/updates podem lançar. */
function fakeDb(respostas: Resposta[]) {
  let i = 0;
  const gravacoes: { metodo: string; valores?: unknown }[] = [];
  const proxima = (valores?: unknown) => {
    const r = respostas[i++];
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(typeof r === "function" ? (r as (v: unknown) => unknown)(valores) : r);
  };
  const cadeia = (metodo: string) => {
    const registro: { metodo: string; valores?: unknown } = { metodo };
    gravacoes.push(registro);
    const obj: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "orderBy", "leftJoin", "innerJoin"]) obj[m] = () => obj;
    obj.values = (v: unknown) => { registro.valores = v; return obj; };
    obj.set = (v: unknown) => { registro.valores = v; return obj; };
    obj.returning = () => proxima(registro.valores);
    obj.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => proxima(registro.valores).then(ok, erro);
    return obj;
  };
  const db = {
    select: () => cadeia("select"),
    insert: () => cadeia("insert"),
    update: () => cadeia("update"),
    delete: () => cadeia("delete"),
    batch: vi.fn(async () => []),
  };
  return { db, gravacoes };
}

const obra = { id: 35, contractorUserId: null };

beforeEach(() => vi.clearAllMocks());

describe("API financeira da obra — permissões", () => {
  it("só administradores acessam (corretor, colaborador, cliente e empreiteiro recebem FORBIDDEN)", async () => {
    for (const role of ["corretor", "colaborador", "cliente", "empreiteiro"]) {
      await expect(caller(role).obraFinanceiro.resumo({ projectId: 35 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(role).obraFinanceiro.adicionarMovimento({ projectId: 35, natureza: "entrada", descricao: "x", valor: "10", data: "2026-10-12" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("portal do empreiteiro recusa outros papéis", async () => {
    await expect(caller("admin").empreiteiro.minhasObras()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("cliente").empreiteiro.minhasObras()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("empreiteiro só consulta obras vinculadas a ele (filtro pelo próprio id)", async () => {
    const { db } = fakeDb([[]]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await expect(caller("empreiteiro", 7).empreiteiro.minhasObras()).resolves.toEqual([]);
  });
});

describe("API financeira da obra — validações", () => {
  it("campos calculados não existem na API: só entradas são aceitas", async () => {
    const { db, gravacoes } = fakeDb([[obra], []]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await caller("admin").obraFinanceiro.salvarValores({
      projectId: 35, vgv: "170000.00", financiamento: "140000", fgts: "0", subsidio: "8234", custoTerreno: "10000",
      comissao: "5000", orcamentoPrevisto: "110000", taxaMensalPct: "1.5", parcelas: 20, empreiteiroId: null, percentualEmpreiteiro: "20",
      entradaTotal: "999", lucroEstimado: "1",
    } as never);
    const gravado = gravacoes.find((g) => g.metodo === "update")!.valores as Record<string, unknown>;
    expect(gravado).not.toHaveProperty("entradaTotal");
    expect(gravado).not.toHaveProperty("lucroEstimado");
    expect(gravado.contractValue).toBe("110000");
    expect(gravado.contractorSharePct).toBeNull();
  });

  it("recusa percentual acima de 100%, valor monetário malformado e empreiteiro que não é empreiteiro", async () => {
    await expect(caller("admin").obraFinanceiro.salvarValores({
      projectId: 35, vgv: "1.000,00", financiamento: null, fgts: null, subsidio: null, custoTerreno: null,
      comissao: null, orcamentoPrevisto: null, taxaMensalPct: null, parcelas: null, empreiteiroId: null, percentualEmpreiteiro: null,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller("admin").obraFinanceiro.definirInvestidores({ projectId: 35, participacoes: [{ investidorId: 1, percentual: "100.5" }] }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });

    const { db } = fakeDb([[obra], [{ role: "corretor", active: true }]]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await expect(caller("admin").obraFinanceiro.salvarValores({
      projectId: 35, vgv: null, financiamento: null, fgts: null, subsidio: null, custoTerreno: null,
      comissao: null, orcamentoPrevisto: null, taxaMensalPct: null, parcelas: null, empreiteiroId: 5, percentualEmpreiteiro: "20",
    })).rejects.toThrow("empreiteiro cadastrado");
  });

  it("soma de investidores acima de 100% e investidor repetido são recusados", async () => {
    const { db } = fakeDb([[obra], [obra]]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await expect(caller("admin").obraFinanceiro.definirInvestidores({
      projectId: 35, participacoes: [{ investidorId: 1, percentual: "70" }, { investidorId: 2, percentual: "40" }],
    })).rejects.toThrow("100%");
    await expect(caller("admin").obraFinanceiro.definirInvestidores({
      projectId: 35, participacoes: [{ investidorId: 1, percentual: "10" }, { investidorId: 1, percentual: "10" }],
    })).rejects.toThrow("repetido");
    expect(db.batch).not.toHaveBeenCalled();
  });

  it("pagamento exige categoria; recebimento não aceita; valor zero é recusado", async () => {
    const { db } = fakeDb([[obra], [obra]]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await expect(caller("admin").obraFinanceiro.adicionarMovimento({ projectId: 35, natureza: "pagamento", descricao: "Empreiteiro", valor: "100", data: "2026-10-12" }))
      .rejects.toThrow("categoria");
    await expect(caller("admin").obraFinanceiro.adicionarMovimento({ projectId: 35, natureza: "entrada", categoria: "outros", descricao: "Entrada", valor: "100", data: "2026-10-12" }))
      .rejects.toThrow("categoria");
    await expect(caller("admin").obraFinanceiro.adicionarMovimento({ projectId: 35, natureza: "entrada", descricao: "Entrada", valor: "0", data: "2026-10-12" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("traduz o bloqueio de duplicidade do banco em mensagem compreensível", async () => {
    const { db } = fakeDb([[obra], new Error("BPO_ALOCACAO_EXCEDIDA: disponível R$ 2000.00")]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await expect(caller("admin").obraFinanceiro.adicionarMovimento({
      projectId: 35, natureza: "recebimento_cef", descricao: "CEF", valor: "2500", data: "2026-10-12", bpoLancamentoId: 10,
    })).rejects.toThrow("Disponível: R$ 2000.00");
  });

  it("registra quem lançou e marca a origem BPO quando há vínculo", async () => {
    const { db, gravacoes } = fakeDb([[obra], (v: unknown) => [v]]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await caller("admin", 42).obraFinanceiro.adicionarMovimento({
      projectId: 35, natureza: "entrada", descricao: "Entrada", valor: "2000", data: "2026-10-12", bpoLancamentoId: 10,
    });
    expect(gravacoes.find((g) => g.metodo === "insert")!.valores).toMatchObject({ origem: "bpo", bpoLancamentoId: 10, criadoPor: 42, categoria: null });
  });

  it("cancelamento exige motivo", async () => {
    await expect(caller("admin").obraFinanceiro.cancelarMovimento({ id: 1, motivo: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
