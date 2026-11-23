// EPIC-029 S-6 — 3º portão de QA (@qa Quinn, 22/11/2026: segurança e integridade fiscal), depois das correções N1–N5. Achados NOVOS
// como `it.fails` (o teste descreve o comportamento CERTO; enquanto o código não for corrigido, "falha como esperado"). Corrigido,
// trocar `it.fails` por `it`. Banco em memória (PGlite), sem rede. Lado seguro fiscal (CLAUDE.md): na dúvida, CONTAR A MAIS.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => {
  const real = await orig<typeof import("../db.js")>();
  const getDb = vi.fn();
  return { ...real, getDb };
});

import * as schema from "../../drizzle/schema.js";
import { getDb } from "../db.js";
import { canAccessAdminProcedure } from "../_core/trpc.js";
import { apurarLimites } from "./teto.js";
import { consultarLimitesReceita } from "../dolores/leitura/limites-receita.js";
import { lancamentoDaMovimentacao, sugerirCategoria } from "../../shared/financeiro/bpo-extrato.js";
import { nomeSeguroDaConta } from "../../shared/fiscal/regimes.js";
import { sanitizarResposta } from "../../shared/dolores/sanitizar.js";

const ler = (n: string) => readFileSync(new URL(`../../drizzle/${n}`, import.meta.url), "utf8");
const M0164 = ler("0164_contas_empresa_limite_receita.sql");
const M0150 = ler("0150_dolores_avisos.sql");
const TABELAS = [
  "users", "leads", "leadServices", "imoveis", "bpoClients", "bpoLancamentos", "bpoRecebimentos", "bankAccounts", "bankTransactions", "constructionProjects",
  "financialTransactions", "taxProfiles",
];
let ddl = "";
beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
  const escolhidas: Record<string, unknown> = {};
  for (const [nome, valor] of Object.entries(schema)) if (TABELAS.includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
  ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n")
    .replace(/,\s*"apelido" varchar\(80\)/, "").replace(/,\s*"empresa_cnpj" varchar\(14\)/, "");
}, 60_000);

const AGORA = new Date("2026-11-20T15:00:00.000Z");
const PROSPECTA = "41865900000189";
const TI = "Transferência interna";

let pg: PGlite;
const q = async <T = Record<string, unknown>>(texto: string, params: unknown[] = []) => (await pg.query<T>(texto, params)).rows;

describe("QA3 S-6 — receita que deixa de ser somada (com banco)", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: AGORA });
    pg = new PGlite();
    await pg.exec(ddl);
    await pg.exec(M0150);
    await pg.exec(M0164);
    vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
    await pg.exec(`
      INSERT INTO users (id, "openId", name, role) VALUES (1, 'admin', 'Dono', 'admin');
      INSERT INTO tax_profiles (company_name, cnpj, regime, estimated_rate, effective_from, is_active) VALUES
        ('Prospecta', '41.865.900/0001-89', 'simples_nacional', 6, '2021-05-07', true);
    `);
  });
  afterEach(async () => { vi.useRealTimers(); await pg.close(); });

  let tx = 0;
  async function conta(empresa: string | null = PROSPECTA, apelido: string | null = null) {
    const [c] = await q<{ id: number }>("INSERT INTO bank_accounts (banco, conta, empresa_cnpj, apelido) VALUES ('Cora', '999', $1, $2) RETURNING id", [empresa, apelido]);
    return c!.id;
  }
  async function mov(contaId: number, tipo: "credito" | "debito", reais: number, quando: string, categoria: string | null = null, descricao = "PIX") {
    const [t] = await q<{ id: number }>(`INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo, external_id, categoria) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [contaId, quando, descricao, tipo === "debito" ? -reais : reais, tipo, `qa3-${++tx}`, categoria]);
    return t!.id;
  }
  async function lanc(tipo: string, reais: number, quando: string, btId: number | null) {
    const [l] = await q<{ id: number }>(`INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, pago, pago_em, competencia, bank_transaction_id)
      VALUES ($1, 'Recebimento de cliente', $2, $3, true, $3, $4, $5) RETURNING id`, [tipo, reais, quando, quando.slice(0, 7), btId]);
    return l!.id;
  }
  const prospecta = async () => (await apurarLimites(getDb() as never, AGORA)).empresas.find(e => e.raiz === "41865900")!;

  // ACHADO Q1 (IMPORTANTE): ENTRADA marcada como "Transferência interna" some da apuração INTEIRA — não entra na receita, nem em
  // "a classificar" (teto.ts:118 exclui), nem em "possível", e não precisa de saída correspondente numa conta da MESMA empresa. O N1 travou
  // só o lado da SAÍDA. Quem marca: `bpo.aClassificar.ignorar` (server/bpo-router.ts:478) é adminProcedure com o módulo "bpo"
  // (server/_core/trpc.ts:72) — colaborador com BPO marca até 2.000 movimentações por vez, sem registro de quem/quando
  // (server/bpo-a-classificar.ts:93-97 → bpo-extrato.ts:307: não grava autor nem histórico). E a própria importação marca sozinha:
  // sugerirCategoria (shared/financeiro/bpo-extrato.ts:31) põe TI em crédito com "aplicacao|resgate|entre contas|mesma titularidade" na
  // descrição/titular, e lancamentoDaMovimentacao devolve null → nem vai para "A classificar" (bpo-extrato.ts:87-99).
  // Contradiz o [AUTO-DECISION] da story ("Transferência vinda de OUTRA empresa → conta como receita"). Lado seguro: entrada marcada como TI
  // só sai da soma se casar com uma saída de outra conta da MESMA empresa; sem par, conta (ou ao menos entra na receita "possível").
  it.fails("Q1: entrada marcada como Transferência interna SEM saída correspondente na mesma empresa continua na receita (possível)", async () => {
    const c1 = await conta();
    await mov(c1, "credito", 80_000, "2026-10-10T12:00:00Z", TI); // ex.: cliente, ou outra empresa, marcada "Transferência interna / ignorar"
    expect((await prospecta()).receitaPossivelCentavos).toBe(80_000_00);
  });

  // Evidência do Q1 (passa hoje): a classificação automática da importação já põe TI num recebimento de cliente comum de obra.
  it("Q1 (evidência): 'PIX RECEBIDO ... aplicacao de textura' é marcado sozinho como Transferência interna e não gera lançamento", () => {
    const descricao = "PIX RECEBIDO JOAO SILVA aplicacao de textura";
    expect(sugerirCategoria(descricao, "credito")).toBe(TI);
    expect(lancamentoDaMovimentacao({ id: 1, data: "2026-10-10", descricao, valor: 15_000, tipo: "credito", categoria: null })).toBeNull();
  });

  // ACHADO Q2 (IMPORTANTE — N1/A1 pelo outro lado): uma transferência REAL entre duas contas da empresa tem os DOIS lados marcados TI. A
  // entrada TI nem entra em `receitas` (não tem lançamento), então a saída TI fica livre e casa com o 1º recebimento de cliente de MESMO
  // valor em até 2 dias numa terceira conta (shared/fiscal/regimes.ts:377-381): o recebimento sai da soma como "transferência". Valores
  // redondos (medição, parcela) tornam a coincidência plausível — o mesmo raciocínio que fez do A1 um achado importante.
  it.fails("Q2: transferência real B→C (os dois lados marcados) não esconde o recebimento de cliente de mesmo valor na conta A", async () => {
    const a = await conta(); const b = await conta(); const c = await conta();
    await lanc("receita", 50_000, "2026-10-10T12:00:00Z", await mov(a, "credito", 50_000, "2026-10-10T12:00:00Z"));
    await mov(b, "debito", 50_000, "2026-10-10T13:00:00Z", TI);
    await mov(c, "credito", 50_000, "2026-10-10T13:00:00Z", TI);
    const p = await prospecta();
    expect(p.receitaCentavos).toBe(50_000_00);
  });

  // Controle (passa hoje): sem a transferência B→C, o recebimento conta normalmente.
  it("controle: recebimento de cliente sozinho conta na receita", async () => {
    const a = await conta();
    await lanc("receita", 50_000, "2026-10-10T12:00:00Z", await mov(a, "credito", 50_000, "2026-10-10T12:00:00Z"));
    expect((await prospecta()).receitaCentavos).toBe(50_000_00);
  });

  // Controle (passa hoje): dupla contagem por bpo_recebimentos — crédito dividido em duas cobranças, uma delas TAMBÉM com baixa manual:
  // cada real entra uma vez só (20 mil + 10 mil pelo banco; 5 mil manual sem conta).
  it("controle: divisão de pagamentos não conta duas vezes", async () => {
    const c1 = await conta();
    const cr = await mov(c1, "credito", 30_000, "2026-10-10T12:00:00Z");
    const l1 = await lanc("receita", 25_000, "2026-10-10T12:00:00Z", null);
    const l2 = await lanc("receita", 10_000, "2026-10-10T12:00:00Z", null);
    await q("INSERT INTO bpo_recebimentos (lancamento_id, request_key, valor, recebido_em, bank_transaction_id) VALUES ($1, 'a', 20000, '2026-10-10T12:00:00Z', $3), ($2, 'b', 10000, '2026-10-10T12:00:00Z', $3)", [l1, l2, cr]);
    await q("INSERT INTO bpo_recebimentos (lancamento_id, request_key, valor, recebido_em) VALUES ($1, 'c', 5000, '2026-10-10T12:00:00Z')", [l1]);
    await q("UPDATE bank_transactions SET a_classificar = false, status = 'conciliado' WHERE id = $1", [cr]);
    const r = await apurarLimites(getDb() as never, AGORA);
    const p = r.empresas.find(e => e.raiz === "41865900")!;
    expect({ receita: p.receitaCentavos, aClassificar: p.aClassificar.centavos, semConta: r.semConta.receitaCentavos }).toEqual({ receita: 30_000_00, aClassificar: 0, semConta: 5_000_00 });
  });

  // ACHADO Q4 (baixo — N5 residual): o filtro do apelido só junta dígitos separados por . - / espaço. Com "_" ou "," o número inteiro
  // (8 dígitos, em dois blocos de 4) passa para a leitura da Dolores (shared/fiscal/regimes.ts:233).
  it.fails("Q4: número de conta com '_' no apelido não chega inteiro à Dolores", async () => {
    await conta(PROSPECTA, "Cora 1234_5678");
    const leitura = JSON.stringify(sanitizarResposta((await consultarLimitesReceita({}, { agora: AGORA })).dados, { mascararDadosPessoais: false }));
    expect(leitura).not.toMatch(/1234_5678/);
  });
});

describe("QA3 S-6 — quem pode tirar receita da soma", () => {
  // ACHADO Q3 (MÉDIO, ligado ao Q1): marcar "Transferência interna / ignorar" tira dinheiro do limite de receita (entrada) ou esconde um
  // recebimento (saída que casa), mas é liberado a colaborador com o módulo BPO e não deixa rastro. Pelo mesmo motivo do A5 (trocar o
  // regime decide o limite → só admin), a marcação que tira receita da soma deveria ser só do admin — ou, no mínimo, auditada (quem, quando).
  // Hoje bancos.transacoes.atualizar já é só admin (router fora do mapa); bpo.aClassificar.ignorar não.
  it.fails("Q3: colaborador com BPO não marca movimentação como Transferência interna (bpo.aClassificar.ignorar)", () => {
    expect(canAccessAdminProcedure({ role: "colaborador", permissions: JSON.stringify(["bpo"]), active: true }, "bpo.aClassificar.ignorar")).toBe(false);
  });
  it("controle: bancos.transacoes.atualizar (mudar categoria pela aba Bancos) já é só admin", () => {
    expect(canAccessAdminProcedure({ role: "colaborador", permissions: JSON.stringify(["bpo"]), active: true }, "bancos.transacoes.atualizar")).toBe(false);
  });
  it("controle (N5): 5+ dígitos com pontuação continuam mascarados", () => {
    expect(nomeSeguroDaConta({ banco: "Cora", apelido: "Cora 1234 5678", conta: "1" })).toBe("Cora •••5678");
  });
});
