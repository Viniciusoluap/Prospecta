import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAllProjects, getDb } from "./db";
import { router } from "./_core/trpc";
import { empreiteiroRouter, obraFinanceiroRouter, sincronizarVgvDoLead } from "./obra-financeiro-router";

vi.mock("./db", () => ({ getDb: vi.fn(), getAllProjects: vi.fn(async () => []) }));

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
  it("só administradores acessam (corretor, colaborador e cliente recebem FORBIDDEN)", async () => {
    for (const role of ["corretor", "colaborador", "cliente"]) {
      await expect(caller(role).obraFinanceiro.resumo({ projectId: 35 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(role).obraFinanceiro.adicionarMovimento({ projectId: 35, natureza: "entrada", descricao: "x", valor: "10", data: "2026-10-12" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    // Empreiteiro (15/10): só na obra vinculada a ele e só pagamentos — ver portal-empreiteiro.test.ts.
    await expect(caller("empreiteiro").obraFinanceiro.adicionarMovimento({ projectId: 35, natureza: "entrada", descricao: "x", valor: "10", data: "2026-10-12" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const { db } = fakeDb([[{ id: 12 }]]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await expect(caller("empreiteiro").obraFinanceiro.resumo({ projectId: 35 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("portal do empreiteiro recusa outros papéis", async () => {
    await expect(caller("admin").empreiteiro.minhasObras()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("cliente").empreiteiro.minhasObras()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("empreiteiro só consulta obras vinculadas a ele (filtro pelo próprio id)", async () => {
    await expect(caller("empreiteiro", 7).empreiteiro.minhasObras()).resolves.toEqual([]);
    expect(vi.mocked(getAllProjects)).toHaveBeenCalledWith(7);
  });
});

describe("API financeira da obra — validações", () => {
  it("campos calculados não existem na API: só entradas são aceitas", async () => {
    const { db, gravacoes } = fakeDb([[{ obra, valorAprovado: null }], []]);
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

    const { db } = fakeDb([[{ obra, valorAprovado: null }], [{ role: "corretor", active: true }]]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await expect(caller("admin").obraFinanceiro.salvarValores({
      projectId: 35, vgv: null, financiamento: null, fgts: null, subsidio: null, custoTerreno: null,
      comissao: null, orcamentoPrevisto: null, taxaMensalPct: null, parcelas: null, empreiteiroId: 5, percentualEmpreiteiro: "20",
    })).rejects.toThrow("empreiteiro cadastrado");
  });

  it("soma de investidores acima de 100% e investidor repetido são recusados", async () => {
    const { db } = fakeDb([[{ obra, valorAprovado: null }], [{ obra, valorAprovado: null }]]);
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
    const { db } = fakeDb([[{ obra, valorAprovado: null }], [{ obra, valorAprovado: null }]]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await expect(caller("admin").obraFinanceiro.adicionarMovimento({ projectId: 35, natureza: "pagamento", descricao: "Empreiteiro", valor: "100", data: "2026-10-12" }))
      .rejects.toThrow("categoria");
    await expect(caller("admin").obraFinanceiro.adicionarMovimento({ projectId: 35, natureza: "entrada", categoria: "outros", descricao: "Entrada", valor: "100", data: "2026-10-12" }))
      .rejects.toThrow("categoria");
    await expect(caller("admin").obraFinanceiro.adicionarMovimento({ projectId: 35, natureza: "entrada", descricao: "Entrada", valor: "0", data: "2026-10-12" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("traduz o bloqueio de duplicidade do banco em mensagem compreensível", async () => {
    const { db } = fakeDb([[{ obra, valorAprovado: null }], new Error("BPO_ALOCACAO_EXCEDIDA: disponível R$ 2000.00")]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await expect(caller("admin").obraFinanceiro.adicionarMovimento({
      projectId: 35, natureza: "recebimento_cef", descricao: "CEF", valor: "2500", data: "2026-10-12", bpoLancamentoId: 10,
    })).rejects.toThrow("Disponível: R$ 2000.00");
  });

  it("registra quem lançou e marca a origem BPO quando há vínculo", async () => {
    const { db, gravacoes } = fakeDb([[{ obra, valorAprovado: null }], (v: unknown) => [v]]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await caller("admin", 42).obraFinanceiro.adicionarMovimento({
      projectId: 35, natureza: "entrada", descricao: "Entrada", valor: "2000", data: "2026-10-12", bpoLancamentoId: 10,
    });
    expect(gravacoes.find((g) => g.metodo === "insert")!.valores).toMatchObject({ origem: "bpo", bpoLancamentoId: 10, criadoPor: 42, categoria: null });
  });

  it("pedido A6: não existe mais cancelar movimento, só excluir (e só admin)", async () => {
    await expect(caller("admin").obraFinanceiro.excluirMovimento({ id: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(Object.keys(obraFinanceiroRouter._def.procedures)).not.toContain("cancelarMovimento");
  });
});

describe("Lote 3 — comissão da obra pelo CRM (item 32)", () => {
  const entrada = {
    projectId: 35, vgv: "230000.00", financiamento: null, fgts: null, subsidio: null, custoTerreno: null,
    comissao: "1", orcamentoPrevisto: null, taxaMensalPct: null, parcelas: null, empreiteiroId: null, percentualEmpreiteiro: null,
  };

  it("com corretor e % da obra, grava o valor calculado (Teste G: 230.000 × 5% = 11.500,00) e ignora o digitado", async () => {
    const { db, gravacoes } = fakeDb([[{ obra: { ...obra, leadId: 24, commissionPct: null }, valorAprovado: "200000.00", vgvSimulado: "230000.00" }], [{ id: 9, nome: "Chaleilson", percentualPadrao: null }], []]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await caller("admin").obraFinanceiro.salvarValores({ ...entrada, comissaoPercentual: "5" });
    const gravado = gravacoes.find((g) => g.metodo === "update")!.valores as Record<string, unknown>;
    expect(gravado.commissionAmount).toBe("11500.00");
    expect(gravado.commissionPct).toBe("5");
  });

  it("sem % da obra usa o padrão do corretor", async () => {
    const { db, gravacoes } = fakeDb([[{ obra: { ...obra, leadId: 24, commissionPct: null }, valorAprovado: "200000.00", vgvSimulado: "230000.00" }], [{ id: 9, nome: "C", percentualPadrao: "4.0000" }], []]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await caller("admin").obraFinanceiro.salvarValores({ ...entrada, comissaoPercentual: null });
    expect((gravacoes.find((g) => g.metodo === "update")!.valores as Record<string, unknown>).commissionAmount).toBe("9200.00");
  });

  it("obra com corretor sem regra: não inventa percentual nem reaproveita valor digitado/antigo", async () => {
    const { db, gravacoes } = fakeDb([[{ obra: { ...obra, leadId: 24, commissionPct: null }, valorAprovado: "200000.00", vgvSimulado: "230000.00" }], [{ id: 9, nome: "C", percentualPadrao: null }], []]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await caller("admin").obraFinanceiro.salvarValores({ ...entrada, comissaoPercentual: null });
    const gravado = gravacoes.find((g) => g.metodo === "update")!.valores as Record<string, unknown>;
    expect(gravado.commissionAmount).toBeNull();
    expect(gravado.commissionPct).toBeNull();
  });

  it("obra com lead: VGV gravado é o VGV simulado do CRM — nunca o valor financiado aprovado nem o digitado (correção 22/10)", async () => {
    // Caso real do lead #92: VGV simulado R$ 291.000, financiado aprovado menor.
    const { db, gravacoes } = fakeDb([[{ obra: { ...obra, leadId: 92, commissionPct: null }, valorAprovado: "195000.00", vgvSimulado: "291000.00" }], [{ id: 9, nome: "C", percentualPadrao: "4.0000" }], []]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await caller("admin").obraFinanceiro.salvarValores({ ...entrada, vgv: "999999.00", comissaoPercentual: null });
    const gravado = gravacoes.find((g) => g.metodo === "update")!.valores as Record<string, unknown>;
    expect(gravado.vgv).toBe("291000.00");
    expect(gravado.commissionAmount).toBe("11640.00"); // 291.000 × 4%
  });

  it("obra sem lead: VGV continua digitado", async () => {
    const { db, gravacoes } = fakeDb([[{ obra: { ...obra, leadId: null, commissionPct: null }, valorAprovado: null }], []]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await caller("admin").obraFinanceiro.salvarValores({ ...entrada, vgv: "150000.00", comissaoPercentual: null });
    expect((gravacoes.find((g) => g.metodo === "update")!.valores as Record<string, unknown>).vgv).toBe("150000.00");
  });

  it("obra sem corretor: comissão é o valor informado", async () => {
    const { db, gravacoes } = fakeDb([[{ obra: { ...obra, leadId: null, commissionPct: null }, valorAprovado: null }], []]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await caller("admin").obraFinanceiro.salvarValores({ ...entrada, comissao: "5000", comissaoPercentual: null });
    expect((gravacoes.find((g) => g.metodo === "update")!.valores as Record<string, unknown>).commissionAmount).toBe("5000");
  });

  it("percentual de comissão inválido é recusado", async () => {
    for (const p of ["100.01", "5.12345", "-1", "5,5"]) {
      await expect(caller("admin").obraFinanceiro.salvarValores({ ...entrada, comissaoPercentual: p })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });
});

describe("Correção 22/10 — VGV da obra acompanha o VGV simulado do lead", () => {
  it("ao editar o lead, a obra recebe o VGV simulado (291.000) e a comissão é recalculada sobre ele", async () => {
    const { db, gravacoes } = fakeDb([
      [{ vgvSimulado: "291000.00" }],                       // lead
      [{ id: 9, nome: "C", percentualPadrao: "4.0000" }],   // corretor do lead
      [{ id: 35, pct: null }],                              // obras do lead
      [],                                                   // update
    ]);
    vi.mocked(getDb).mockReturnValue(db as never);
    await sincronizarVgvDoLead(92);
    const gravado = gravacoes.find((g) => g.metodo === "update")!.valores as Record<string, unknown>;
    expect(gravado.vgv).toBe("291000.00");
    expect(gravado.commissionAmount).toBe("11640.00");
  });
});
