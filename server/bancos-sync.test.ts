// Pedido de 25/10: sincronização por API (Asaas, Pluggy) e importação de extrato.
// APIs externas e banco simulados: nenhum teste toca contas reais.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db.js";
import { confirmarImportacao, previaImportacao, sincronizarConta } from "./bancos.js";
import { decryptSecret } from "./_core/secret-vault.js";
import { bpoLancamentos } from "../drizzle/schema.js";

vi.mock("./db.js", () => ({ getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste" } }));

type Conta = Record<string, unknown>;
/**
 * Cada select() consome a próxima resposta da fila; update/insert ficam registrados.
 * LOTE C: inserts em bank_transactions e em bpo_lancamentos ficam em listas separadas.
 */
function fakeDb(selects: unknown[][]) {
  let i = 0;
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const lancamentos: Record<string, unknown>[] = [];
  const cadeia = (resp: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "leftJoin", "orderBy", "limit"]) c[m] = () => c;
    c.then = (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(resp).then(ok, falha);
    return c;
  };
  vi.mocked(getDb).mockReturnValue({
    select: () => cadeia(selects[i++] ?? []),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: () => { updates.push(v); return Promise.resolve(); } }) }),
    insert: (tabela: unknown) => ({
      values: (v: Record<string, unknown>[]) => {
        const destino = tabela === bpoLancamentos ? lancamentos : inserts;
        const base = destino.length;
        destino.push(...v);
        return { onConflictDoNothing: () => ({ returning: () => Promise.resolve(v.map((row, k) => ({ id: base + k + 1, ...row }))) }) };
      },
    }),
  } as never);
  return { updates, inserts, lancamentos };
}

function resposta(corpo: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => corpo } as Response);
}

const contaAsaas = (extra: Conta = {}) => ({
  id: 3, provedor: "asaas", credencialEncrypted: "plain:$aact_prod_teste", dataInicial: "2026-10-01",
  ultimaSincronizacao: null, pluggyAccountId: null, ...extra,
});

describe("sincronização por API", () => {
  beforeEach(() => vi.resetAllMocks());

  it("Asaas: lê a partir da data inicial, descarta o anterior, grava saldo e recriptografa a chave", async () => {
    const db = fakeDb([[contaAsaas()]]);
    const chamadas: string[] = [];
    const fetchFake = vi.fn((url: string, init?: RequestInit) => {
      chamadas.push(url);
      expect((init?.headers as Record<string, string>).access_token).toBe("$aact_prod_teste");
      if (url.includes("/finance/balance")) return resposta({ balance: 1234.5 });
      return resposta({
        hasMore: false,
        data: [
          { id: "ft1", value: 500, date: "2026-10-02", description: "Pix recebido" },
          { id: "ft2", value: -40, date: "2026-10-03", description: "Taxa" },
          { id: "ft0", value: 99, date: "2026-09-30", description: "De outra empresa" },
        ],
      });
    });
    const r = await sincronizarConta(3, fetchFake as never);
    expect(r).toMatchObject({ ok: true, novos: 2, saldo: 1234.5 });
    expect(chamadas[0]).toContain("https://api.asaas.com/v3/financialTransactions?startDate=2026-10-01");
    expect(db.inserts.map(t => [t.externalId, t.tipo, t.valor, t.origem])).toEqual([
      ["asaas:ft1", "credito", "500.00", "asaas"],
      ["asaas:ft2", "debito", "40.00", "asaas"],
    ]);
    const recripto = db.updates.find(u => typeof u.credencialEncrypted === "string");
    expect(recripto?.credencialEncrypted).not.toContain("plain:");
    expect(decryptSecret(recripto!.credencialEncrypted as string)).toBe("$aact_prod_teste");
    expect(db.updates.at(-1)).toMatchObject({ saldoAtual: "1234.50", ultimoErro: null });
  });

  it("Pluggy: autentica, lê transações v2 sem pageSize (corte por data local) e atualiza o saldo", async () => {
    const db = fakeDb([
      [{ id: 4, provedor: "pluggy", pluggyAccountId: "acc-1", dataInicial: "2026-08-15", ultimaSincronizacao: null }],
      [{ id: 1, isActive: true, clientIdEncrypted: "plain:cid", clientSecretEncrypted: "plain:csec" }],
    ]);
    const fetchFake = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/auth")) {
        expect(JSON.parse(String(init?.body))).toEqual({ clientId: "cid", clientSecret: "csec" });
        return resposta({ apiKey: "tok" });
      }
      if (url.includes("/transactions?")) {
        expect(url).not.toContain("pageSize");
        expect(url).not.toContain("dateFrom");
        return resposta({ totalPages: 1, results: [
          { id: "t0", date: "2026-08-14T00:00:00Z", description: "Antes da data inicial", amount: 1, type: "CREDIT" },
          { id: "t1", date: "2026-09-01T00:00:00Z", description: "Pix", amount: 70, type: "CREDIT" },
        ] });
      }
      return resposta({ balance: 70 });
    });
    const r = await sincronizarConta(4, fetchFake as never);
    expect(r).toMatchObject({ ok: true, novos: 1, saldo: 70 });
    expect(db.inserts[0]).toMatchObject({ externalId: "t1", origem: "pluggy", valor: "70.00" });
  });

  it("erro da API fica registrado na conta e volta como mensagem (sem estourar)", async () => {
    const db = fakeDb([[contaAsaas()]]);
    const r = await sincronizarConta(3, vi.fn(() => resposta({}, 401)) as never);
    expect(r.ok).toBe(false);
    expect(r.mensagem).toMatch(/recusou o acesso \(HTTP 401\)/);
    expect(db.updates.at(-1)).toMatchObject({ ultimoErro: expect.stringMatching(/recusou o acesso/) });
  });

  it("conta de importação não sincroniza por API", async () => {
    fakeDb([[{ id: 9, provedor: "manual", dataInicial: null }]]);
    expect((await sincronizarConta(9, vi.fn() as never)).ok).toBe(false);
  });
});

describe("importação de extrato", () => {
  beforeEach(() => vi.resetAllMocks());
  const csv = Buffer.from("Data;Descrição;Valor\n30/09/2026;Antes;10,00\n01/10/2026;Pix;10,00\n01/10/2026;Pix;10,00\n02/10/2026;Tarifa;-5,00");

  it("prévia aplica a data inicial e marca o que já foi importado; confirmação usa as mesmas chaves", async () => {
    const conta = { id: 7, provedor: "manual", dataInicial: "2026-10-01" };
    fakeDb([[conta], []]);
    const previa = await previaImportacao(7, "cora.csv", csv);
    expect(previa.antesDaDataInicial).toBe(1);
    expect(previa.linhas).toHaveLength(3);
    expect(previa.linhas.every(l => !l.jaImportada)).toBe(true);

    const db = fakeDb([[conta]]);
    const r = await confirmarImportacao(7, previa.linhas.map(({ jaImportada: _j, ...l }) => l));
    expect(r.novos).toBe(3);
    const chaves = db.inserts.map(t => t.externalId as string);
    expect(new Set(chaves).size).toBe(3);
    expect(chaves.every(k => k.startsWith("imp:7:"))).toBe(true);
    expect(db.inserts.map(t => t.origem)).toEqual(["importacao", "importacao", "importacao"]);

    // Reimportar o mesmo arquivo: a prévia acusa as linhas já gravadas.
    fakeDb([[conta], chaves.map(e => ({ e }))]);
    const de_novo = await previaImportacao(7, "cora.csv", csv);
    expect(de_novo.linhas.every(l => l.jaImportada)).toBe(true);
  });

  it("formato desconhecido dá erro claro", async () => {
    fakeDb([[{ id: 7, dataInicial: null }]]);
    await expect(previaImportacao(7, "extrato.docx", Buffer.from("x"))).rejects.toThrow(/Formato não suportado/);
  });

  it("OFX com FITID reconhece a chave legada e não duplica ao melhorar a extração", async () => {
    const conta = { id: 7, provedor: "manual", dataInicial: null };
    const arquivo = Buffer.from("<OFX><STMTTRN><DTPOSTED>20261001<TRNAMT>10.00<MEMO>PIX RECEBIDO<FITID>abc</STMTTRN></OFX>");
    const { chavesImportacao } = await import("../shared/extrato-import.js");
    const { createHash } = await import("node:crypto");
    const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
    const legada = chavesImportacao(7, [{ data: "2026-10-01", tipo: "credito", descricao: "PIX RECEBIDO", valor: 10 }], hash)[0];
    fakeDb([[conta], [{ externalId: legada }], [{ e: legada }]]);
    const previa = await previaImportacao(7, "cora.ofx", arquivo);
    expect(previa.linhas[0]).toMatchObject({ identificadorBancario: "abc", jaImportada: true });
  });
});

describe("PDF de verdade (gerado no teste)", () => {
  it("extrai as linhas do PDF e lê os lançamentos", async () => {
    const { jsPDF } = await import("jspdf");
    const { lerArquivoExtrato } = await import("./bancos.js");
    const doc = new jsPDF();
    doc.text("Extrato Conta PJ - outubro/2026", 10, 10);
    doc.text("01/10/2026  PIX RECEBIDO CLIENTE  1.200,00  3.200,00", 10, 20);
    doc.text("02/10/2026  PAGAMENTO BOLETO  -350,75  2.849,25", 10, 30);
    const r = await lerArquivoExtrato("extrato.pdf", Buffer.from(doc.output("arraybuffer")));
    expect(r.formato).toBe("PDF");
    expect(r.linhas).toEqual([
      // Pedido de 25/10 (noite): titular depois do tipo e texto completo da linha.
      { data: "2026-10-01", descricao: "PIX RECEBIDO CLIENTE", valor: 1200, tipo: "credito", titular: "CLIENTE", original: "PIX RECEBIDO CLIENTE 1.200,00 3.200,00" },
      { data: "2026-10-02", descricao: "PAGAMENTO BOLETO", valor: 350.75, tipo: "debito", original: "PAGAMENTO BOLETO -350,75 2.849,25" },
    ]);
  });
});
