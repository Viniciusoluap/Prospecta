// EPIC-029 S-6 (22/11/2026) — contas bancárias por empresa (estabelecimento: matriz/filial; empresa = raiz do CNPJ), apelido, limite de
// receita por empresa conforme o regime, gerador de rascunhos usando a empresa da conta e permissões.
// Banco em memória (PGlite): tabelas geradas do schema Drizzle + 0154 (fiscal) + 0150 (avisos) + 0164 aplicada DUAS vezes. Sem rede.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => {
  const real = await orig<typeof import("../db.js")>();
  const { bankAccounts } = await import("../../drizzle/schema.js");
  const { eq } = await import("drizzle-orm");
  const getDb = vi.fn();
  // as funções de db.ts chamam o getDb INTERNO: aqui elas usam o banco em memória do teste
  return { ...real, getDb,
    createBankAccount: async (data: never) => (await getDb().insert(bankAccounts).values(data).returning())[0],
    getBankAccountById: async (id: number) => (await getDb().select().from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1))[0] };
});
vi.mock("../_core/env.js", async orig => ({ ENV: { ...(await orig<typeof import("../_core/env.js")>()).ENV, cookieSecret: "segredo-de-teste" } }));

import * as schema from "../../drizzle/schema.js";
import { getDb } from "../db.js";
import { router } from "../_core/trpc.js";
import { bancarioRouter } from "../bancos-router.js";
import { taxRouter } from "../tax-router.js";
import { fiscalRouter } from "./router.js";
import { gerarRascunhos } from "./gerador.js";
import { emissoresComPerfil } from "./notas.js";

const TABELAS = [
  "users", "leads", "leadServices", "imoveis", "bpoClients", "bpoLancamentos", "bankAccounts", "bankTransactions", "constructionProjects",
  "obraMovimentos", "regularizacoes", "regularizacaoItensFinanceiros", "regularizacaoRecebimentos", "avaliacoes", "operationalCommissions",
  "financialTransactions", "taxProfiles", "taxObligations", "retProjects",
];
const ler = (n: string) => readFileSync(new URL(`../../drizzle/${n}`, import.meta.url), "utf8");
const M0154 = ler("0154_fiscal_notas.sql");
const M0162 = ler("0162_fiscal_certificados.sql"); // S-4: coluna codigo_atividade_simples do tipo de serviço (junção com a main)
const M0150 = ler("0150_dolores_avisos.sql");
const M0164 = ler("0164_contas_empresa_limite_receita.sql");
let ddl = "";

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
  const escolhidas: Record<string, unknown> = {};
  // a 0164 é quem cria as colunas novas de bank_accounts em produção: aqui a tabela nasce do schema SEM elas, e a migração as acrescenta
  for (const [nome, valor] of Object.entries(schema)) if (TABELAS.includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
  ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n")
    .replace(/,\s*"apelido" varchar\(80\)/, "").replace(/,\s*"empresa_cnpj" varchar\(14\)/, "");
}, 60_000);

let pg: PGlite;
let fetchVigia: ReturnType<typeof vi.spyOn>;
const AGORA = new Date("2026-11-20T15:00:00.000Z");
const q = async <T = Record<string, unknown>>(texto: string, params: unknown[] = []) => (await pg.query<T>(texto, params)).rows;

const PROSPECTA = "41865900000189";
const VFX = "58121993000100";
const EFFICAZ = "04578232000182";
const EFFICAZ_FILIAL = "04578232000263";

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: AGORA });
  pg = new PGlite();
  await pg.exec(ddl);
  expect((await q("SELECT column_name FROM information_schema.columns WHERE table_name = 'bank_accounts' AND column_name IN ('apelido', 'empresa_cnpj')"))).toEqual([]);
  await pg.exec(M0154);
  await pg.exec(M0162);
  await pg.exec(M0150);
  await pg.exec(M0164);
  await pg.exec(M0164); // idempotente
  vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
  fetchVigia = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("rede proibida no teste"); });
  await pg.exec(`
    INSERT INTO users (id, "openId", name, role) VALUES (1, 'admin', 'Dono', 'admin'), (2, 'colab', 'Colaboradora', 'colaborador');
    INSERT INTO fiscal_config (id, ligado, inicio_em) VALUES (true, false, '2026-11-01');
    INSERT INTO tax_profiles (company_name, cnpj, regime, estimated_rate, effective_from, is_active) VALUES
      ('Prospecta', '41.865.900/0001-89', 'simples_nacional', 6, '2021-05-07', true),
      ('VFX Capital', '58.121.993/0001-00', 'lucro_real', 0, '2025-01-01', true),
      ('Efficaz', '04.578.232/0001-82', 'simples_nacional', 6, '2010-01-01', true);
  `);
});

afterEach(async () => {
  expect(fetchVigia).not.toHaveBeenCalled();
  fetchVigia.mockRestore();
  vi.useRealTimers();
  await pg.close();
});

const app = router({ bancario: bancarioRouter, fiscal: fiscalRouter, tax: taxRouter });
const caller = (role: string, permissoes: string[] = [], active = true) =>
  app.createCaller({ user: { id: role === "admin" ? 1 : 2, role, active, permissions: JSON.stringify(permissoes) }, req: { headers: {} }, res: {} } as never);
const admin = () => caller("admin");

async function contaManual(banco: string, numero: string, extra: { apelido?: string | null; empresaCnpj?: string | null } = {}) {
  const c = await admin().bancario.contas.create({ provedor: "manual", banco, conta: numero, descricao: "Conta PJ", ...extra });
  return c.id;
}
let txSeq = 0;
/** Movimentação + lançamento pago ligado a ela (como o extrato faz). */
async function entrada(contaId: number, valor: number, dia = "2026-11-10", descricao = "PIX recebido cliente", tipo = "receita") {
  const [t] = await q<{ id: number }>(`INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo, categoria, external_id)
    VALUES ($1, $2, $3, $4, 'credito', 'Recebimento de cliente', $5) RETURNING id`, [contaId, `${dia}T12:00:00Z`, descricao, valor, `ext-${++txSeq}`]);
  const [l] = await q<{ id: number }>(`INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, pago, pago_em, competencia, bank_transaction_id, categoria)
    VALUES ($1, $2, $3, $4, true, $4, $5, $6, 'Recebimento de cliente') RETURNING id`, [tipo, descricao, valor, `${dia}T12:00:00Z`, dia.slice(0, 7), t!.id]);
  return l!.id;
}
async function saida(contaId: number, valor: number, dia = "2026-11-10") {
  await q(`INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo, categoria, external_id) VALUES ($1, $2, 'TED enviada', $3, 'debito', 'Outros', $4)`,
    [contaId, `${dia}T12:00:00Z`, valor, `ext-${++txSeq}`]);
}

describe("S-6 — contas: apelido e vínculo com a empresa (N:1)", () => {
  it("renomear muda só o apelido: banco, agência, número e descrição continuam; em branco volta ao nome do banco", async () => {
    const id = await contaManual("Cora", "12345-6");
    await admin().bancario.contas.update({ id, apelido: "  Obras Imperatriz  " });
    const [c] = await q<any>("SELECT banco, agencia, conta, descricao, apelido FROM bank_accounts WHERE id = $1", [id]);
    expect(c).toEqual({ banco: "Cora", agencia: null, conta: "12345-6", descricao: "Conta PJ", apelido: "Obras Imperatriz" });
    await admin().bancario.contas.update({ id, dataInicial: "2026-01-01" }); // apelido ausente = não muda
    expect((await q<any>("SELECT apelido FROM bank_accounts WHERE id = $1", [id]))[0].apelido).toBe("Obras Imperatriz");
    await admin().bancario.contas.update({ id, apelido: "" });
    expect((await q<any>("SELECT apelido, conta FROM bank_accounts WHERE id = $1", [id]))[0]).toEqual({ apelido: null, conta: "12345-6" });
    await expect(admin().bancario.contas.update({ id, apelido: "x".repeat(81) })).rejects.toThrow(/80/);
  });

  it("três contas da mesma empresa e duas de outra; só aceita estabelecimento conhecido; filial entra depois do complemento fiscal dela", async () => {
    for (const n of ["1", "2", "3"]) await contaManual("Cora", n, { empresaCnpj: "41.865.900/0001-89" });
    for (const n of ["4", "5"]) await contaManual("Inter", n, { empresaCnpj: VFX });
    expect(await q("SELECT empresa_cnpj, count(*)::int AS n FROM bank_accounts GROUP BY 1 ORDER BY 1")).toEqual([
      { empresa_cnpj: PROSPECTA, n: 3 }, { empresa_cnpj: VFX, n: 2 }]);
    await expect(contaManual("X", "9", { empresaCnpj: "11222333000181" })).rejects.toThrow(/perfil tributário/);
    await expect(contaManual("X", "9", { empresaCnpj: "123" })).rejects.toThrow(/inválido/);
    await expect(contaManual("X", "9", { empresaCnpj: EFFICAZ_FILIAL })).rejects.toThrow(/perfil tributário/);
    // a filial usa o perfil da empresa (mesma raiz): o complemento fiscal dela é aceito e, com ele, a conta da filial
    await admin().fiscal.emissores.salvar({ cnpj: EFFICAZ_FILIAL, municipioNome: "Canaã dos Carajás", municipioUf: "PA", inscricaoMunicipal: "999" });
    const filial = await contaManual("Sicoob", "77", { empresaCnpj: EFFICAZ_FILIAL, apelido: "Efficaz Canaã" });
    expect((await q<any>("SELECT empresa_cnpj FROM bank_accounts WHERE id = $1", [filial]))[0].empresa_cnpj).toBe(EFFICAZ_FILIAL);
    const estab = await admin().bancario.contas.empresas();
    expect(estab.find(e => e.cnpj === EFFICAZ_FILIAL)).toMatchObject({ nome: "Efficaz", matriz: false, regimeRotulo: "Simples Nacional" });
    // desvincular (null) volta a "sem empresa definida"
    await admin().bancario.contas.update({ id: filial, empresaCnpj: null });
    expect((await q<any>("SELECT empresa_cnpj FROM bank_accounts WHERE id = $1", [filial]))[0].empresa_cnpj).toBeNull();
  });

  it("o banco recusa CNPJ fora do formato e apelido vazio (CHECK da 0164)", async () => {
    const id = await contaManual("Cora", "1");
    await expect(pg.query("UPDATE bank_accounts SET empresa_cnpj = '41.865.900/0001-89' WHERE id = $1", [id])).rejects.toThrow();
    await expect(pg.query("UPDATE bank_accounts SET apelido = '   ' WHERE id = $1", [id])).rejects.toThrow();
  });
});

describe("S-6 — limites de receita por empresa (aba Contabilidade)", () => {
  it("soma por empresa (matriz + filial), sem transferência entre contas dela e sem estorno; conta sem vínculo vira pendência", async () => {
    await admin().fiscal.emissores.salvar({ cnpj: EFFICAZ_FILIAL, municipioNome: "Canaã dos Carajás", municipioUf: "PA" });
    const a = await contaManual("Cora", "1", { empresaCnpj: PROSPECTA, apelido: "Cora obras" });
    const b = await contaManual("Inter", "2", { empresaCnpj: PROSPECTA });
    const m = await contaManual("BB", "3", { empresaCnpj: EFFICAZ });
    const f = await contaManual("Sicoob", "4", { empresaCnpj: EFFICAZ_FILIAL });
    const solta = await contaManual("C6", "5");
    await entrada(a, 300_000);
    await entrada(a, 10_000, "2026-11-11"); await saida(b, 10_000, "2026-11-11"); // da conta b para a conta a: mesma empresa → fora
    await entrada(a, 500, "2026-11-12", "ESTORNO PIX");
    await entrada(b, 1_000, "2026-11-13", "Reembolso cartório", "reembolso");
    await entrada(m, 2_000_000); await entrada(f, 1_600_000);
    await entrada(solta, 7_000);
    await entrada(a, 999_999, "2025-12-31"); // ano passado: fora
    const r = await admin().fiscal.limitesReceita();
    const pro = r.empresas.find(e => e.raiz === "41865900")!;
    expect(pro.receitaCentavos).toBe(301_000_00);
    expect(pro.reembolsosCentavos).toBe(1_000_00);
    expect(pro.foraDaSoma).toMatchObject({ transferencias: 1, transferenciasCentavos: 10_000_00, estornos: 1, estornosCentavos: 500_00 });
    // QA S-6 (A9): sem apelido, banco + final mascarado (número curto demais: só o banco) — nunca o número nem a descrição
    expect(pro.contas.map(c => c.nome)).toEqual(["Cora obras", "Inter"]);
    expect(pro.limites.find(l => l.chave === "me")).toMatchObject({ faixa: 70, informativo: true });
    const efficaz = r.empresas.find(e => e.raiz === "04578232")!;
    expect(efficaz.receitaCentavos).toBe(3_600_000_00); // matriz + filial no MESMO teto
    expect(efficaz.limites.find(l => l.chave === "sublimite")?.faixa).toBe(100);
    expect(efficaz.limites.find(l => l.chave === "teto_simples")?.faixa).toBe(70);
    expect(r.empresas.find(e => e.raiz === "58121993")).toMatchObject({ situacao: "sem_limite", limites: [], receitaCentavos: 0 });
    expect(r.semEmpresa.contas.map(c => c.id)).toEqual([solta]);
    expect(r.semEmpresa.receitaCentavos).toBe(7_000_00);
    expect(JSON.stringify(r)).not.toMatch(/12345|agencia/);
  });

  it("Presumido: limite de 78 mi; troca de regime no meio do ano vale a partir da versão nova; 'a confirmar' sem limite e sem estimativa", async () => {
    const id = await contaManual("Cora", "1", { empresaCnpj: PROSPECTA });
    await entrada(id, 60_000_000, "2026-03-10");
    // versão nova do perfil (troca de regime), com data de início em julho: hoje (novembro) vale o Presumido
    await admin().tax.profiles.create({ companyName: "Prospecta", cnpj: PROSPECTA, regime: "lucro_presumido", estimatedRate: 11.33, effectiveFrom: new Date("2026-07-01T12:00:00Z") });
    let pro = (await admin().fiscal.limitesReceita()).empresas.find(e => e.raiz === "41865900")!;
    expect(pro.regime).toBe("lucro_presumido");
    expect(pro.limites).toEqual([expect.objectContaining({ chave: "presumido", faixa: 70, percentual: 76.9 })]);
    await admin().tax.profiles.create({ companyName: "Prospecta", cnpj: PROSPECTA, regime: "a_confirmar", estimatedRate: 0, effectiveFrom: new Date("2026-11-01T12:00:00Z") });
    pro = (await admin().fiscal.limitesReceita()).empresas.find(e => e.raiz === "41865900")!;
    expect(pro).toMatchObject({ situacao: "a_confirmar", limites: [] });
    const ov = await admin().tax.overview({ cnpj: PROSPECTA });
    expect(ov.estimatedTax).toBeNull();
    expect(ov.estimativaIndisponivel).toMatch(/regime a confirmar/);
  });

  it("permissões: ver os limites = admin e colaborador com BPO; mexer nas contas = só admin", async () => {
    const id = await contaManual("Cora", "1");
    await expect(caller("colaborador", ["bpo"]).fiscal.limitesReceita()).resolves.toMatchObject({ ano: 2026 });
    for (const c of [caller("colaborador", ["crm"]), caller("corretor"), caller("cliente"), caller("colaborador", ["bpo"], false)]) {
      await expect(c.fiscal.limitesReceita()).rejects.toThrow();
    }
    for (const c of [caller("colaborador", ["bpo"]), caller("corretor")]) {
      await expect(c.bancario.contas.update({ id, apelido: "invasor", empresaCnpj: PROSPECTA })).rejects.toThrow(/permissão/);
      await expect(c.bancario.contas.empresas()).rejects.toThrow(/permissão/);
    }
    expect((await q<any>("SELECT apelido, empresa_cnpj FROM bank_accounts WHERE id = $1", [id]))[0]).toEqual({ apelido: null, empresa_cnpj: null });
  });
});

describe("S-6 — gerador e emissor: a empresa da conta escolhe o emissor; a filial herda o regime", () => {
  it("com vários emissores, o lançamento da conta da VFX vai para o emissor da VFX; sem conta, fica a escolher", async () => {
    await admin().fiscal.emissores.salvar({ cnpj: PROSPECTA, municipioNome: "Imperatriz", municipioUf: "MA" });
    await admin().fiscal.emissores.salvar({ cnpj: VFX, municipioNome: "Imperatriz", municipioUf: "MA" });
    const [emP, emV] = (await q<{ id: number; cnpj: string }>("SELECT id, cnpj FROM fiscal_emissores ORDER BY id"));
    const cv = await contaManual("Inter", "4", { empresaCnpj: VFX });
    const cp = await contaManual("Cora", "1", { empresaCnpj: PROSPECTA });
    const solta = await contaManual("C6", "5");
    const lv = await entrada(cv, 1_500);
    const lp = await entrada(cp, 2_000);
    const ls = await entrada(solta, 700);
    const [lm] = await q<{ id: number }>(`INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, pago, pago_em, competencia)
      VALUES ('honorario', 'Honorário', 100, now(), true, '2026-11-10T12:00:00Z', '2026-11') RETURNING id`);
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const notas = await q<{ origem_id: number; emissor_id: number | null }>("SELECT origem_id, emissor_id FROM fiscal_notas ORDER BY origem_id");
    expect(notas).toEqual([
      { origem_id: lv, emissor_id: emV!.id }, { origem_id: lp, emissor_id: emP!.id }, { origem_id: ls, emissor_id: null }, { origem_id: lm!.id, emissor_id: null }]);
    expect(emV!.cnpj).toBe(VFX);
  });

  it("emissor da filial: nome e regime da empresa (matriz); opção do Simples só para empresa do Simples", async () => {
    await admin().fiscal.emissores.salvar({ cnpj: EFFICAZ_FILIAL, municipioNome: "Canaã dos Carajás", municipioUf: "PA" });
    await admin().fiscal.emissores.salvar({ cnpj: VFX, municipioNome: "Imperatriz", municipioUf: "MA" });
    const em = await emissoresComPerfil(getDb());
    expect(em.find(e => e.cnpj === EFFICAZ_FILIAL)).toMatchObject({ razaoSocial: "Efficaz", regime: "simples_nacional", optanteSimples: true });
    expect(em.find(e => e.cnpj === VFX)).toMatchObject({ regime: "lucro_real", optanteSimples: false });
    const lista = await admin().fiscal.emissores.listar();
    expect(lista.find(e => e.cnpj === EFFICAZ_FILIAL)).toMatchObject({ razaoSocial: "Efficaz", regime: "simples_nacional" });
  });
});
