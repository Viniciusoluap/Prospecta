// Lote 4: conta "API do Banco Inter (beta)" — sincronização com banco e Inter simulados.
// Gêmeo do Santa Fé: web/src/lib/__tests__/banco-inter-sync.db.test.ts.
// APIs externas e banco simulados: nenhum teste toca contas reais.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db.js";
import { sincronizarConta } from "./bancos.js";
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


const CRED = {
  clientId: "cid", clientSecret: "csec",
  certificado: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
  chave: "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----",
};
const contaInter = () => ({
  id: 9, provedor: "inter", credencialEncrypted: `plain:${JSON.stringify(CRED)}`, dataInicial: "2026-10-01",
  ultimaSincronizacao: null, pluggyAccountId: null,
});
const resp = (corpo: unknown, status = 200) => Promise.resolve({ ok: status < 300, status, json: async () => corpo });

describe("Banco Inter (beta) — sincronização", () => {
  beforeEach(() => { vi.resetAllMocks(); delete process.env.BANCO_INTER_API; });

  it("desligado por padrão: não chama o Inter", async () => {
    fakeDb([[contaInter()]]);
    const fetchInter = vi.fn();
    expect(await sincronizarConta(9, fetch, fetchInter)).toEqual({ ok: false, mensagem: expect.stringMatching(/desligado/) });
    expect(fetchInter).not.toHaveBeenCalled();
  });

  it("ligado: lê extrato e saldo, descarta o anterior à data inicial e recriptografa a credencial", async () => {
    process.env.BANCO_INTER_API = "1";
    const db = fakeDb([[contaInter()]]);
    const f = vi.fn((u: string) => {
      if (u.includes("/oauth/v2/token")) return resp({ access_token: "tok" });
      if (u.includes("/saldo")) return resp({ disponivel: 987.65 });
      return resp({ totalPaginas: 1, transacoes: [
        { idTransacao: "1", dataTransacao: "2026-10-05", tipoOperacao: "C", tipoTransacao: "PIX", valor: "150.50", titulo: "Pix recebido", detalhes: { nomePagador: "Ana" } },
        { idTransacao: "2", dataTransacao: "2026-09-20", tipoOperacao: "D", valor: "10", titulo: "Antes da data inicial" },
      ] });
    });
    const r = await sincronizarConta(9, fetch, () => f as never);
    expect(r).toMatchObject({ ok: true, novos: 1, saldo: 987.65 });
    expect(db.inserts.map(t => [t.externalId, t.tipo, t.valor, t.origem, t.titular])).toEqual([["inter:1", "credito", "150.50", "inter", "Ana"]]);
    const recripto = db.updates.find(u => typeof u.credencialEncrypted === "string");
    expect(recripto?.credencialEncrypted).not.toContain("plain:");
    expect(JSON.parse(decryptSecret(recripto!.credencialEncrypted as string))).toMatchObject({ clientId: "cid" });
    delete process.env.BANCO_INTER_API;
  });

  it("recusa do Inter vira erro legível na conta", async () => {
    process.env.BANCO_INTER_API = "1";
    const db = fakeDb([[contaInter()]]);
    const r = await sincronizarConta(9, fetch, () => (() => resp({ title: "Unauthorized" }, 401)) as never);
    expect(r).toEqual({ ok: false, mensagem: expect.stringMatching(/O Inter recusou o acesso \(HTTP 401\)/) });
    expect(db.updates.some(u => String(u.ultimoErro ?? "").includes("HTTP 401"))).toBe(true);
    delete process.env.BANCO_INTER_API;
  });
});
