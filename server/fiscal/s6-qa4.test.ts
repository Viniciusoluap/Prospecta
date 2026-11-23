// EPIC-029 S-6 — 4º portão de QA (@qa Quinn, 23/11/2026: segurança e integridade fiscal), depois das correções Q1–Q4. Achados NOVOS
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
import { editarLancamentoAuditavel } from "../bpo-auditoria.js";

const ler = (n: string) => readFileSync(new URL(`../../drizzle/${n}`, import.meta.url), "utf8");
const M0164 = ler("0164_contas_empresa_limite_receita.sql");
const M0150 = ler("0150_dolores_avisos.sql");
const TABELAS = [
  "users", "leads", "leadServices", "imoveis", "bpoClients", "bpoLancamentos", "bpoLancamentoHistorico", "bpoRecebimentos", "bankAccounts",
  "bankTransactions", "constructionProjects", "financialTransactions", "taxProfiles",
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

describe("QA4 S-6 — receita que ainda deixa de ser somada (com banco)", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: AGORA });
    pg = new PGlite();
    await pg.exec(ddl);
    await pg.exec(M0150);
    await pg.exec(M0164);
    vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
    await pg.exec(`
      INSERT INTO users (id, "openId", name, role) VALUES (1, 'admin', 'Dono', 'admin'), (2, 'colab', 'Colaboradora Ana', 'colaborador');
      INSERT INTO tax_profiles (company_name, cnpj, regime, estimated_rate, effective_from, is_active) VALUES
        ('Prospecta', '41.865.900/0001-89', 'simples_nacional', 6, '2021-05-07', true);
    `);
  });
  afterEach(async () => { vi.useRealTimers(); await pg.close(); });

  let tx = 0;
  async function conta() {
    const [c] = await q<{ id: number }>("INSERT INTO bank_accounts (banco, conta, empresa_cnpj) VALUES ('Cora', '999', $1) RETURNING id", [PROSPECTA]);
    return c!.id;
  }
  async function mov(contaId: number, tipo: "credito" | "debito", reais: number, quando: string, categoria: string | null = null, descricao = "PIX RECEBIDO JOAO SILVA") {
    const [t] = await q<{ id: number }>(`INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo, external_id, categoria) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [contaId, quando, descricao, tipo === "debito" ? -reais : reais, tipo, `qa4-${++tx}`, categoria]);
    return t!.id;
  }
  async function lanc(reais: number, quando: string, btId: number | null, descricao = "PIX RECEBIDO JOAO SILVA", valorRecebido = 0) {
    const [l] = await q<{ id: number }>(`INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, pago, pago_em, competencia, bank_transaction_id, valor_recebido)
      VALUES ('receita', $1, $2, $3, true, $3, $4, $5, $6) RETURNING id`, [descricao, reais, quando, quando.slice(0, 7), btId, valorRecebido]);
    return l!.id;
  }
  const editar = (id: number, mudanca: { valor: number; descricao?: string }, userId = 2) => editarLancamentoAuditavel({
    id, version: 1, motivo: "ajuste", descricao: mudanca.descricao ?? "PIX RECEBIDO JOAO SILVA", valor: mudanca.valor, categoria: "Recebimento de cliente",
    vencimento: new Date("2026-10-10T12:00:00Z"), competencia: "2026-10",
  }, userId);
  const prospecta = async () => (await apurarLimites(getDb() as never, AGORA)).empresas.find(e => e.raiz === "41865900")!;

  // ACHADO R1 (MÉDIO): a soma usa `bpo_lancamentos.valor` (teto.ts:96) e não o valor que o BANCO registrou. Editar o valor de um lançamento
  // ligado a um crédito do extrato (bpo.lancamentos.editar → bpo-auditoria.ts:112-128; adminProcedure com o módulo "bpo", liberado ao
  // colaborador) para baixo tira a diferença do limite em definitivo: o crédito tem lançamento (não vira "a classificar", teto.ts:138-142),
  // e a diferença não aparece em pendência nenhuma do painel. Fica só no histórico do lançamento, que o painel de limites não mostra.
  // Lado seguro: crédito do extrato conta pelo MAIOR entre o valor do banco e o do lançamento (ou a diferença vira pendência com valor).
  it.fails("R1: editar para baixo o valor de um lançamento ligado ao extrato não tira do limite o que o banco recebeu", async () => {
    const c1 = await conta();
    const l = await lanc(10_000, "2026-10-10T12:00:00Z", await mov(c1, "credito", 10_000, "2026-10-10T12:00:00Z"));
    await editar(l, { valor: 100 });
    expect((await prospecta()).receitaPossivelCentavos).toBeGreaterThanOrEqual(10_000_00);
  });

  // ACHADO R2 (MÉDIO): lançamento ligado ao extrato com valor_recebido = valor (cobrança Asaas casada com o crédito, bpo-asaas.ts:103, ou
  // Conta Azul pago). Editar o valor para CIMA (R$ 0,01 basta) faz `pago = (valor_recebido = valor)` = false (bpo-auditoria.ts:124): o
  // lançamento sai da soma (teto.ts:99 exige pago = true) e o crédito do banco também não vira pendência (tem lançamento com
  // a_classificar = false). O dinheiro que entrou na conta some do limite e de todas as pendências.
  it.fails("R2: lançamento casado com o crédito do banco e editado para cima (fica 'não pago') continua contando o que o banco recebeu", async () => {
    const c1 = await conta();
    const l = await lanc(1_000, "2026-10-10T12:00:00Z", await mov(c1, "credito", 1_000, "2026-10-10T12:00:00Z"), "Cobrança Asaas", 1_000);
    await editar(l, { valor: 1_000.01, descricao: "Cobrança Asaas" });
    expect((await prospecta()).receitaPossivelCentavos).toBeGreaterThanOrEqual(1_000_00);
  });

  // ACHADO R3 (MÉDIO): o estorno é decidido só pelo texto do LANÇAMENTO (regimes.ts:361, A2), que é editável pela mesma tela
  // (bpo-auditoria.ts:119). Renomear um recebimento de cliente para "Devolução ..." tira o valor INTEIRO da soma, sem saída correspondente,
  // sem par e sem "quem" no painel — o mesmo buraco que o Q1 fechou para a Transferência interna. O texto do BANCO ("PIX RECEBIDO ...")
  // não diz estorno. Lado seguro: só é estorno quando o texto do banco também diz (ou, sem isso, conta e fica "para conferir").
  it.fails("R3: recebimento renomeado para 'Devolução' no lançamento, com o banco dizendo 'PIX RECEBIDO', continua na receita", async () => {
    const c1 = await conta();
    const l = await lanc(20_000, "2026-10-10T12:00:00Z", await mov(c1, "credito", 20_000, "2026-10-10T12:00:00Z"));
    await editar(l, { valor: 20_000, descricao: "Devolução de caução" });
    expect((await prospecta()).receitaCentavos).toBe(20_000_00);
  });

  // Controle (passa hoje): estorno escrito pelo próprio banco (texto do lançamento gerado do extrato) continua fora da soma.
  it("controle: 'ESTORNO PIX' do banco fica fora da soma como estorno", async () => {
    const c1 = await conta();
    await lanc(3_000, "2026-10-10T12:00:00Z", await mov(c1, "credito", 3_000, "2026-10-10T12:00:00Z", null, "ESTORNO PIX"), "ESTORNO PIX");
    const p = await prospecta();
    expect({ receita: p.receitaCentavos, estornos: p.foraDaSoma.estornosCentavos }).toEqual({ receita: 0, estornos: 3_000_00 });
  });

  // Controle (passa hoje): a edição só da descrição, sem palavra de estorno, não muda a soma.
  it("controle: editar a descrição sem palavra de estorno mantém o valor na receita", async () => {
    const c1 = await conta();
    const l = await lanc(5_000, "2026-10-10T12:00:00Z", await mov(c1, "credito", 5_000, "2026-10-10T12:00:00Z"));
    await editar(l, { valor: 5_000, descricao: "Medição 3 — obra Silva" });
    expect((await prospecta()).receitaCentavos).toBe(5_000_00);
  });

  // ACHADO R4 (BAIXO): o painel atribui a transferência só a quem marcou a ENTRADA (regimes.ts:367; teto.ts:125 lê a auditoria só da
  // entrada). Entrada marcada pela importação ("sem registro") + saída marcada à mão por colaborador → o painel diz "sem registro
  // (marcação automática...)" e esconde quem tirou o valor da soma. A auditoria (Q3) deveria aparecer pelos dois lados do par.
  it.fails("R4: quem marcou a SAÍDA do par aparece no painel quando a entrada foi marcada pela importação", async () => {
    const a = await conta(); const b = await conta();
    await mov(a, "credito", 12_000, "2026-10-10T12:00:00Z", TI, "RESGATE APLICACAO");
    const saida = await mov(b, "debito", 12_000, "2026-10-10T13:00:00Z");
    await q("UPDATE bank_transactions SET a_classificar = true WHERE id = $1", [saida]);
    const { ignorarMovimentacoes } = await import("../bpo-a-classificar.js");
    await ignorarMovimentacoes([saida], 2);
    const p = await prospecta();
    expect(p.receitaCentavos).toBe(0); // o par marcado × marcado sai da soma (Q1/Q2: correto)
    expect(p.transferenciasPorQuem.map(x => x.quem).join(" ")).toContain("Colaboradora Ana");
  });

  // Controle (passa hoje): a edição de lançamento é do módulo BPO (o colaborador com BPO alcança R1–R3).
  it("controle: bpo.lancamentos.editar está liberado ao colaborador com o módulo BPO", () => {
    expect(canAccessAdminProcedure({ role: "colaborador", permissions: JSON.stringify(["bpo"]), active: true }, "bpo.lancamentos.editar")).toBe(true);
  });
});
