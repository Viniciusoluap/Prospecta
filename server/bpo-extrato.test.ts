// LOTE C (25/10): extrato bancário alimentando o BPO Financeiro.
// Banco simulado em memória (nenhum teste toca banco real nem APIs externas).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db.js";
import { bankAccounts, bankTransactions, bpoClients, bpoLancamentos } from "../drizzle/schema.js";
import { confirmarImportacao, gravarMovimentos, sincronizarConta } from "./bancos.js";
import { atualizarMovimentacao, movimentacoesDaConta, reprocessarMovimentacoes } from "./bpo-extrato.js";
import {
  CATEGORIAS_BPO,
  dreDosLancamentos,
  lancamentoDaMovimentacao,
  saldoPorMovimentos,
  sugerirCategoria,
} from "../shared/financeiro/bpo-extrato.js";
import { lerCsv, lerOfx, lerTextoPdf, saldoMaisRecente } from "../shared/extrato-import.js";
import { montarDreMensal } from "./relatorios-router.js";
import { receitaRealizada } from "./tax-router.js";

vi.mock("./db.js", () => ({ getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste" } }));
// Condições viram objetos simples para o banco em memória avaliar.
vi.mock("drizzle-orm", async orig => ({
  ...(await orig<typeof import("drizzle-orm")>()),
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...c: unknown[]) => ({ op: "and", c }),
  or: (...c: unknown[]) => ({ op: "or", c }),
  isNull: (a: unknown) => ({ op: "isNull", a }),
  inArray: (a: unknown, b: unknown[]) => ({ op: "in", a, b }),
  desc: (a: unknown) => a,
}));

type Row = Record<string, unknown>;
type Tabela = Record<string, unknown>;
const TABELAS: [string, Tabela][] = [
  ["bank_accounts", bankAccounts as never],
  ["bank_transactions", bankTransactions as never],
  ["bpo_lancamentos", bpoLancamentos as never],
  ["bpo_clients", bpoClients as never],
];
const nomeDa = (t: unknown) => TABELAS.find(([, x]) => x === t)?.[0] ?? "outra";
/** Coluna drizzle → [tabela, chave TS]. */
function colunaDe(col: unknown): [string, string] | null {
  for (const [nome, t] of TABELAS) for (const [k, v] of Object.entries(t)) if (v === col) return [nome, k];
  return null;
}

function bancoEmMemoria(inicial: Partial<Record<string, Row[]>> = {}) {
  const dados: Record<string, Row[]> = { bank_accounts: [], bank_transactions: [], bpo_lancamentos: [], bpo_clients: [], ...inicial } as never;
  const seq: Record<string, number> = {};
  for (const [n, rows] of Object.entries(dados)) seq[n] = Math.max(0, ...rows.map(r => Number(r.id) || 0));
  const opts = { bloquearDelete: false };

  type Comp = Record<string, Row | undefined>;
  const valor = (x: unknown, r: Comp) => {
    const c = colunaDe(x);
    return c ? r[c[0]]?.[c[1]] ?? null : x;
  };
  const avaliar = (cond: any, r: Comp): boolean => {
    if (!cond) return true;
    switch (cond.op) {
      case "eq": return valor(cond.a, r) === valor(cond.b, r);
      case "and": return cond.c.every((c: unknown) => avaliar(c, r));
      case "or": return cond.c.some((c: unknown) => avaliar(c, r));
      case "isNull": return valor(cond.a, r) == null;
      case "in": return cond.b.includes(valor(cond.a, r));
      default: throw new Error(`condição não suportada: ${cond.op}`);
    }
  };
  const projetar = (campos: Record<string, unknown> | undefined, base: string, r: Comp) =>
    campos ? Object.fromEntries(Object.entries(campos).map(([k, col]) => [k, valor(col, r)])) : { ...r[base] };

  const db = {
    select: (campos?: Record<string, unknown>) => {
      let base = "", where: unknown, limite = Infinity;
      const joins: [string, unknown][] = [];
      const q: any = {
        from: (t: unknown) => { base = nomeDa(t); return q; },
        leftJoin: (t: unknown, on: unknown) => { joins.push([nomeDa(t), on]); return q; },
        where: (c: unknown) => { where = c; return q; },
        orderBy: () => q,
        limit: (n: number) => { limite = n; return q; },
        then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => {
          let linhas: Comp[] = dados[base].map(r => ({ [base]: r }));
          for (const [t, on] of joins) linhas = linhas.map(l => ({ ...l, [t]: dados[t].find(x => avaliar(on, { ...l, [t]: x })) }));
          const res = linhas.filter(l => avaliar(where, l)).slice(0, limite).map(l => projetar(campos, base, l));
          return Promise.resolve(res).then(ok, falha);
        },
      };
      return q;
    },
    insert: (t: unknown) => ({
      values: (v: Row | Row[]) => {
        const nome = nomeDa(t);
        const lista = Array.isArray(v) ? v : [v];
        const gravar = (alvo?: unknown) => {
          const chave = alvo ? colunaDe(alvo)![1] : null;
          const novos: Row[] = [];
          for (const r of lista) {
            if (chave && r[chave] != null && dados[nome].some(x => x[chave] === r[chave])) continue;
            const row = { id: ++seq[nome], ...r };
            dados[nome].push(row);
            novos.push(row);
          }
          return novos;
        };
        return {
          onConflictDoNothing: ({ target }: { target: unknown }) => ({
            returning: (campos?: Record<string, unknown>) =>
              Promise.resolve(gravar(target).map(r => projetar(campos, nome, { [nome]: r }))),
          }),
          returning: () => Promise.resolve(gravar()),
        };
      },
    }),
    update: (t: unknown) => ({
      set: (v: Row) => ({
        where: (c: unknown) => {
          const nome = nomeDa(t);
          dados[nome].filter(r => avaliar(c, { [nome]: r })).forEach(r => Object.assign(r, v));
          return Promise.resolve();
        },
      }),
    }),
    delete: (t: unknown) => ({
      where: (c: unknown) => {
        if (opts.bloquearDelete) return Promise.reject(new Error('update or delete on table "bpo_lancamentos" violates foreign key constraint'));
        const nome = nomeDa(t);
        dados[nome] = dados[nome].filter(r => !avaliar(c, { [nome]: r }));
        return Promise.resolve();
      },
    }),
  };
  vi.mocked(getDb).mockReturnValue(db as never);
  return { dados, opts };
}

const conta = (extra: Row = {}): Row => ({
  id: 1, banco: "Cora", provedor: "manual", dataInicial: null, saldoAtual: "0", saldoFonte: null, ativo: true,
  ultimaSincronizacao: null, credencialEncrypted: null, pluggyAccountId: null, ...extra,
});
const mov = (externalId: string, data: string, descricao: string, valor: number, tipo: "credito" | "debito") =>
  ({ externalId, data, descricao, valor, tipo });

beforeEach(() => vi.resetAllMocks());

describe("regras puras (shared/financeiro/bpo-extrato)", () => {
  it("lista padrão de categorias", () => {
    expect(CATEGORIAS_BPO).toEqual([
      "Recebimento de cliente", "Financiamento/CAIXA", "Material", "Mão de obra", "Projetos e taxas", "Impostos",
      "Tarifas bancárias", "Pró-labore", "Administrativo", "Transferência interna", "Outros",
    ]);
  });

  it("sugestão por palavras-chave", () => {
    expect(sugerirCategoria("TARIFA PIX", "debito")).toBe("Tarifas bancárias");
    expect(sugerirCategoria("Pagamento DARF 2026", "debito")).toBe("Impostos");
    expect(sugerirCategoria("Pix recebido das obras", "credito")).toBe("Recebimento de cliente");
    expect(sugerirCategoria("CAIXA ECONOMICA FEDERAL medição", "credito")).toBe("Financiamento/CAIXA");
    expect(sugerirCategoria("Depósito materiais de construção", "debito")).toBe("Material");
    expect(sugerirCategoria("Transferência entre contas", "debito")).toBe("Transferência interna");
    expect(sugerirCategoria("Compra qualquer", "debito")).toBe("Outros");
  });

  it("crédito → receita, débito → despesa; transferência interna não gera lançamento", () => {
    const base = { id: 9, data: new Date("2026-10-05T12:00:00Z"), descricao: "Pix cliente", valor: "1500.00", categoria: null };
    expect(lancamentoDaMovimentacao({ ...base, tipo: "credito" })).toMatchObject({
      bankTransactionId: 9, tipo: "receita", categoria: "Recebimento de cliente", valor: "1500.00", pago: true, competencia: "2026-10",
    });
    const d = lancamentoDaMovimentacao({ ...base, tipo: "debito", categoria: "Material", bpoClienteId: 4 })!;
    expect(d).toMatchObject({ tipo: "despesa", categoria: "Material", clienteId: 4 });
    expect(d.pagoEm.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(d.vencimento.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(lancamentoDaMovimentacao({ ...base, tipo: "debito", categoria: "Transferência interna" })).toBeNull();
  });

  it("saldo calculado em centavos", () => {
    expect(saldoPorMovimentos([{ tipo: "credito", valor: "0.10" }, { tipo: "credito", valor: "0.20" }, { tipo: "debito", valor: "0.05" }])).toBe(0.25);
  });
});

describe("geração 1:1 dos lançamentos", () => {
  it("cada movimentação gravada gera um lançamento pago; regravar não duplica", async () => {
    const { dados } = bancoEmMemoria({ bank_accounts: [conta()] });
    const movimentos = [
      mov("e1", "2026-10-01", "Pix recebido cliente", 1000, "credito"),
      mov("e2", "2026-10-02", "Tarifa mensal", 25.5, "debito"),
      mov("e3", "2026-10-03", "Transferência entre contas", 300, "debito"),
    ];
    const r = await gravarMovimentos({ id: 1, dataInicial: null }, movimentos, "importacao");
    expect(r.novos).toBe(3);
    expect(r.liquidoNovos).toBe(674.5);
    expect(dados.bank_transactions.map(t => t.categoria)).toEqual(["Recebimento de cliente", "Tarifas bancárias", "Transferência interna"]);
    expect(dados.bpo_lancamentos.map(l => [l.bankTransactionId, l.tipo, l.valor, l.pago, l.competencia])).toEqual([
      [1, "receita", "1000.00", true, "2026-10"],
      [2, "despesa", "25.50", true, "2026-10"],
    ]);

    const de_novo = await gravarMovimentos({ id: 1, dataInicial: null }, movimentos, "importacao");
    expect(de_novo.novos).toBe(0);
    expect(dados.bank_transactions).toHaveLength(3);
    expect(dados.bpo_lancamentos).toHaveLength(2);
  });

  it("sincronização por API também gera os lançamentos e grava o saldo da API", async () => {
    const { dados } = bancoEmMemoria({ bank_accounts: [conta({ id: 3, provedor: "asaas", credencialEncrypted: "plain:$aact_x" })] });
    const fetchFake = vi.fn((url: string) => Promise.resolve({
      ok: true, status: 200,
      json: async () => url.includes("/finance/balance")
        ? { balance: 900 }
        : { hasMore: false, data: [{ id: "a1", value: 1000, date: "2026-10-02", description: "Cobrança recebida" }, { id: "a2", value: -100, date: "2026-10-03", description: "Taxa de boleto" }] },
    } as Response));
    const r = await sincronizarConta(3, fetchFake as never);
    expect(r).toMatchObject({ ok: true, novos: 2 });
    expect(dados.bpo_lancamentos.map(l => [l.tipo, l.categoria])).toEqual([["receita", "Recebimento de cliente"], ["despesa", "Tarifas bancárias"]]);
    expect(dados.bank_accounts[0]).toMatchObject({ saldoAtual: "900.00", saldoFonte: "api" });
  });
});

describe("categoria e Cliente BPO na movimentação", () => {
  it("mudar para Transferência interna remove o lançamento; voltar recria; cliente acompanha", async () => {
    const { dados } = bancoEmMemoria({ bank_accounts: [conta()], bpo_clients: [{ id: 7, razaoSocial: "Cliente X" }] });
    await gravarMovimentos({ id: 1, dataInicial: null }, [mov("e1", "2026-10-01", "Pix recebido", 500, "credito")], "importacao");
    expect(dados.bpo_lancamentos).toHaveLength(1);

    await atualizarMovimentacao(1, { bpoClienteId: 7 });
    expect(dados.bpo_lancamentos[0]).toMatchObject({ clienteId: 7, tipo: "receita" });
    expect(dados.bank_transactions[0].bpoClienteId).toBe(7);

    await atualizarMovimentacao(1, { categoria: "Transferência interna" });
    expect(dados.bpo_lancamentos).toHaveLength(0);
    expect(dados.bank_transactions[0].categoria).toBe("Transferência interna");

    await atualizarMovimentacao(1, { categoria: "Financiamento/CAIXA" });
    expect(dados.bpo_lancamentos).toHaveLength(1);
    expect(dados.bpo_lancamentos[0]).toMatchObject({ categoria: "Financiamento/CAIXA", clienteId: 7, bankTransactionId: 1 });

    const lista = await movimentacoesDaConta(1);
    expect(lista[0]).toMatchObject({ categoria: "Financiamento/CAIXA", bpoClienteId: 7, lancamentoId: dados.bpo_lancamentos[0].id });
  });

  it("lançamento já usado em obra não é removido e a categoria não muda", async () => {
    const { dados, opts } = bancoEmMemoria({ bank_accounts: [conta()] });
    await gravarMovimentos({ id: 1, dataInicial: null }, [mov("e1", "2026-10-01", "Compra cimento material", 80, "debito")], "importacao");
    opts.bloquearDelete = true;
    await expect(atualizarMovimentacao(1, { categoria: "Transferência interna" })).rejects.toThrow(/obra ou regularização/);
    expect(dados.bank_transactions[0].categoria).toBe("Material");
    expect(dados.bpo_lancamentos).toHaveLength(1);
  });

  it("cliente inexistente dá erro", async () => {
    bancoEmMemoria({ bank_accounts: [conta()], bank_transactions: [{ id: 1, accountId: 1, data: new Date(), descricao: "x", valor: "1.00", tipo: "credito", categoria: null, bpoClienteId: null }] });
    await expect(atualizarMovimentacao(1, { bpoClienteId: 99 })).rejects.toThrow(/Cliente BPO/);
  });
});

describe("reprocessar movimentações (backfill)", () => {
  const antigas = (n: number) => Array.from({ length: n }, (_, k) => ({
    id: k + 1, accountId: 1, data: new Date(`2026-09-${String((k % 28) + 1).padStart(2, "0")}T12:00:00Z`),
    descricao: k % 3 === 0 ? "Tarifa Pix" : k % 3 === 1 ? "Pix recebido" : "Transferência entre contas",
    valor: "10.00", tipo: k % 3 === 1 ? "credito" : "debito", categoria: k === 1 ? "Transfers" : null, bpoClienteId: null,
  }));

  it("gera os lançamentos que faltam, categoriza e calcula o saldo; rodar de novo não cria nada", async () => {
    const { dados } = bancoEmMemoria({ bank_accounts: [conta()], bank_transactions: antigas(9) });
    const r1 = await reprocessarMovimentacoes();
    expect(r1).toEqual({ categorizadas: 9, lancamentosCriados: 6, saldosRecalculados: 1 });
    expect(dados.bpo_lancamentos).toHaveLength(6);
    expect(new Set(dados.bpo_lancamentos.map(l => l.bankTransactionId)).size).toBe(6);
    expect(dados.bank_transactions.every(t => (CATEGORIAS_BPO as readonly unknown[]).includes(t.categoria))).toBe(true);
    // 3 créditos de 10 − 6 débitos de 10 (transferência conta no saldo, não no resultado).
    expect(dados.bank_accounts[0]).toMatchObject({ saldoAtual: "-30.00", saldoFonte: "calculado" });

    const r2 = await reprocessarMovimentacoes();
    expect(r2).toEqual({ categorizadas: 0, lancamentosCriados: 0, saldosRecalculados: 1 });
    expect(dados.bpo_lancamentos).toHaveLength(6);
  });

  it("não mexe no saldo vindo do arquivo ou da API", async () => {
    const { dados } = bancoEmMemoria({
      bank_accounts: [conta({ saldoAtual: "5000.00", saldoFonte: "extrato" }), conta({ id: 2, provedor: "asaas", saldoAtual: "70.00", saldoFonte: "api" })],
      bank_transactions: antigas(3),
    });
    const r = await reprocessarMovimentacoes();
    expect(r.saldosRecalculados).toBe(0);
    expect(dados.bank_accounts.map(c => c.saldoAtual)).toEqual(["5000.00", "70.00"]);
  });
});

describe("saldo da conta na importação", () => {
  it("lê o saldo do arquivo: OFX (LEDGERBAL), CSV (coluna Saldo) e PDF (última coluna)", () => {
    const ofx = "<OFX><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261001<TRNAMT>100.00<MEMO>Pix</STMTTRN><LEDGERBAL><BALAMT>1234.56<DTASOF>20261031</LEDGERBAL></OFX>";
    expect(lerOfx(ofx).saldoFinal).toBe(1234.56);
    expect(lerOfx("<OFX><STMTTRN><DTPOSTED>20261001<TRNAMT>1.00</STMTTRN></OFX>").saldoFinal).toBeNull();

    const crescente = lerCsv("Data;Descrição;Valor;Saldo\n01/10/2026;Pix;100,00;1.100,00\n02/10/2026;Tarifa;-5,00;1.095,00");
    expect(crescente.saldoFinal).toBe(1095);
    const decrescente = lerCsv("Data;Descrição;Valor;Saldo\n02/10/2026;Tarifa;-5,00;1.095,00\n01/10/2026;Pix;100,00;1.100,00");
    expect(decrescente.saldoFinal).toBe(1095);
    expect(lerCsv("Data;Descrição;Valor\n01/10/2026;Pix;100,00").saldoFinal).toBeNull();

    const pdf = lerTextoPdf(["01/10/2026 PIX RECEBIDO 1.200,00 3.200,00", "02/10/2026 PAGAMENTO BOLETO -350,75 2.849,25"]);
    expect(pdf.saldoFinal).toBe(2849.25);
    expect(pdf.linhas).toHaveLength(2);
    expect(saldoMaisRecente([])).toBeNull();
  });

  it("arquivo com saldo → saldo do arquivo; sem saldo → créditos − débitos", async () => {
    const linhas = [
      { data: "2026-10-01", descricao: "Pix recebido", valor: 1000, tipo: "credito" as const },
      { data: "2026-10-02", descricao: "Tarifa", valor: 15, tipo: "debito" as const },
    ];
    let mem = bancoEmMemoria({ bank_accounts: [conta()] });
    const comSaldo = await confirmarImportacao(1, linhas, 4321.09);
    expect(comSaldo.saldo).toBe(4321.09);
    expect(mem.dados.bank_accounts[0]).toMatchObject({ saldoAtual: "4321.09", saldoFonte: "extrato" });
    expect(mem.dados.bpo_lancamentos).toHaveLength(2);

    // Novo arquivo sem saldo numa conta cujo saldo veio do extrato: soma o líquido das novas.
    const mais = await confirmarImportacao(1, [{ data: "2026-10-05", descricao: "Pix", valor: 100, tipo: "credito" }], null);
    expect(mais.saldo).toBe(4421.09);

    mem = bancoEmMemoria({ bank_accounts: [conta()] });
    const semSaldo = await confirmarImportacao(1, linhas, null);
    expect(semSaldo.saldo).toBe(985);
    expect(mem.dados.bank_accounts[0]).toMatchObject({ saldoAtual: "985.00", saldoFonte: "calculado" });

    // Reimportar o mesmo arquivo não duplica movimentações nem lançamentos.
    const de_novo = await confirmarImportacao(1, linhas, null);
    expect(de_novo.novos).toBe(0);
    expect(mem.dados.bpo_lancamentos).toHaveLength(2);
    expect(mem.dados.bank_accounts[0].saldoAtual).toBe("985.00");
  });
});

describe("DRE, Relatórios e Contabilidade somam os lançamentos do extrato", () => {
  const lancs = [
    { competencia: "2026-10", tipo: "receita", valor: "1000.00" },
    { competencia: "2026-10", tipo: "despesa", valor: "250.10" },
    { competencia: "2026-09", tipo: "honorario", valor: "500.00" },
  ];

  it("DRE do BPO por competência", () => {
    expect(dreDosLancamentos(lancs)).toEqual([
      { competencia: "2026-10", cobrancas: 1000, despesas: 250.1, resultado: 749.9 },
      { competencia: "2026-09", cobrancas: 500, despesas: 0, resultado: 500 },
    ]);
  });

  it("DRE mensal dos Relatórios soma financeiro + BPO", () => {
    const fin = [{ competency: "2026-10", paidAt: new Date("2026-10-10"), type: "income", amount: "200.00" }];
    expect(montarDreMensal(fin, lancs)).toEqual([
      { mes: "2026-09", receitas: 500, despesas: 0, resultado: 500 },
      { mes: "2026-10", receitas: 1200, despesas: 250.1, resultado: 949.9 },
    ]);
  });

  it("receita realizada da Contabilidade inclui as entradas do extrato (despesa não entra)", () => {
    expect(receitaRealizada([{ type: "income", amount: "200" }, { type: "expense", amount: "50" }], lancs)).toEqual({ total: 1700, financeiro: 200, bpo: 1500 });
  });
});
