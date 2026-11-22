// EPIC-029 S-2 — portão de QA (@qa Quinn, 22/11/2026). Tentativas de quebrar os rascunhos de nota.
// Os 5 achados do portão (antes `it.fails`) foram corrigidos pelo @dev e viraram `it` (QA Results na story).
// Mesmo banco em memória do teste do dev (PGlite + DDL do schema + 0154 aplicada duas vezes). Vigia de fetch em todos.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));
vi.mock("../_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste" } }));

import * as schema from "../../drizzle/schema.js";
import { getDb } from "../db.js";
import { router } from "../_core/trpc.js";
import { taxRouter } from "../tax-router.js";
import { fiscalRouter } from "./router.js";
import { gerarRascunhos, gerarRascunhosNoCron, LIMITE_POR_ORIGEM } from "./gerador.js";
import { montarRelatorio, relatorioEmCsv } from "./relatorio-mensal.js";

const TABELAS = [
  "users", "leads", "leadServices", "imoveis", "bpoClients", "bpoLancamentos", "bankAccounts", "bankTransactions", "constructionProjects",
  "obraMovimentos", "regularizacoes", "regularizacaoItensFinanceiros", "regularizacaoRecebimentos", "avaliacoes", "operationalCommissions",
  "financialTransactions", "taxProfiles", "taxObligations", "retProjects",
];
const MIGRACAO = readFileSync(new URL("../../drizzle/0154_fiscal_notas.sql", import.meta.url), "utf8");
// S-4: a 0162 acrescenta a coluna opcional codigo_atividade_simples ao tipo de serviço (lida pelo schema Drizzle).
const MIGRACAO_S4 = readFileSync(new URL("../../drizzle/0162_fiscal_certificados.sql", import.meta.url), "utf8");
let ddl = "";

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
  const escolhidas: Record<string, unknown> = {};
  for (const [nome, valor] of Object.entries(schema)) if (TABELAS.includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
  ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n");
}, 60_000);

let pg: PGlite;
let fetchVigia: ReturnType<typeof vi.spyOn>;
const AGORA = new Date("2026-11-20T15:00:00.000Z");
const q = async <T = Record<string, unknown>>(texto: string, params: unknown[] = []) => (await pg.query<T>(texto, params)).rows;

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(ddl);
  await pg.exec(MIGRACAO);
  await pg.exec(MIGRACAO);
  await pg.exec(MIGRACAO_S4);
  vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
  fetchVigia = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("rede proibida no teste"); });
  await pg.exec(`
    INSERT INTO users (id, "openId", name, role) VALUES (1, 'admin', 'Dono', 'admin'), (2, 'colab', 'Colaboradora', 'colaborador');
    INSERT INTO fiscal_config (id, ligado, inicio_em) VALUES (true, false, '2026-11-01');
  `);
});

afterEach(async () => {
  expect(fetchVigia).not.toHaveBeenCalled();
  fetchVigia.mockRestore();
  await pg.close();
});

const app = router({ fiscal: fiscalRouter, tax: taxRouter });
const caller = (role: string, permissoes: string[] = [], active = true, id = role === "admin" ? 1 : 2) =>
  app.createCaller({ user: { id, role, active, permissions: JSON.stringify(permissoes) }, req: { headers: {} }, res: {} } as never);
const admin = () => caller("admin");

async function lancamento(o: { tipo?: string; valor?: number; descricao?: string } = {}) {
  const [r] = await q<{ id: number }>(`INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, pago, pago_em, competencia)
    VALUES ($1, $2, $3, now(), true, '2026-11-10T12:00:00Z', '2026-11') RETURNING id`, [o.tipo ?? "honorario", o.descricao ?? "Honorário", o.valor ?? 1000]);
  return r!.id;
}
const notas = () => q<{ id: number; origem_tipo: string; origem_id: number; status: string; versao: number }>("SELECT * FROM fiscal_notas ORDER BY id");

describe("QA — permissões e superfícies de ataque (devem passar)", () => {
  it("admin INATIVO, empreiteiro, cliente e corretor não alcançam nenhuma rota do fiscal", async () => {
    await lancamento();
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const [n] = await notas();
    for (const c of [caller("admin", [], false), caller("empreiteiro"), caller("cliente"), caller("corretor"), caller("colaborador", ["bpo"], false)]) {
      await expect(c.fiscal.notas.atualizar()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.fiscal.notas.naoEmitir({ id: n!.id, versao: n!.versao, motivo: "emitida_fora" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.fiscal.notas.ver({ id: n!.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.fiscal.relatorio.csv({ competencia: "2026-11" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.fiscal.emissores.salvar({ cnpj: "11222333000181", municipioNome: "Imperatriz", municipioUf: "MA" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    // colaborador com BPO: nenhuma escrita (inclusive tipos e emissores)
    const colab = caller("colaborador", ["bpo"]);
    await expect(colab.fiscal.tipos.salvar({ nome: "X", regra: "sempre_perguntar", origens: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(colab.fiscal.notas.reabrir({ id: n!.id, versao: n!.versao })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(colab.fiscal.notas.adiar({ id: n!.id, versao: n!.versao })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await notas())[0]).toMatchObject({ status: "A_DECIDIR", versao: 1 });
  });

  it("'Emitir' é recusado também para o admin, em qualquer status, e o banco recusa INSERT já emitido", async () => {
    await lancamento();
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const [n] = await notas();
    await expect(admin().fiscal.notas.emitir({ id: n!.id, versao: n!.versao })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    for (const s of ["EMITINDO", "EMITIDA", "CANCELADA", "ERRO"]) {
      await expect(pg.query(`INSERT INTO fiscal_notas (origem_tipo, origem_id, data_evento, status) VALUES ('avaliacao', 9${s.length}, '2026-11-10', $1)`, [s]))
        .rejects.toThrow(/FISCAL_EMISSAO_INDISPONIVEL/);
    }
    await expect(pg.query("TRUNCATE fiscal_notas CASCADE")).rejects.toThrow(/FISCAL_IMUTAVEL/);
    await expect(pg.query("UPDATE fiscal_notas SET status = 'CANCELADA'")).rejects.toThrow(/FISCAL_EMISSAO_INDISPONIVEL/);
    // "automático" não existe em lugar nenhum: nem no CHECK, nem na rota
    await expect(pg.query("INSERT INTO fiscal_tipos_servico (nome, regra) VALUES ('auto', 'automatico')")).rejects.toThrow();
  });

  it("mapa de origens não aceita texto que tente fugir do formato (nada chega ao SQL cru do gerador)", async () => {
    for (const origem of ["bpo_lancamento:x' OR 1=1 --", "bpo_lancamento:", "outra:*", "bpo_lancamento:HONORARIO"]) {
      await expect(admin().fiscal.tipos.salvar({ nome: "Injeção", regra: "sempre_perguntar", origens: [origem] })).rejects.toThrow();
    }
  });

  it("emissor não aceita ambiente diferente de 'desligado' (o campo nem existe na rota)", async () => {
    await admin().tax.profiles.create({ companyName: "Prospecta", cnpj: "11222333000181", regime: "simples_nacional", estimatedRate: 6, effectiveFrom: new Date("2026-01-01") });
    const e = await admin().fiscal.emissores.salvar({ cnpj: "11222333000181", municipioNome: "Imperatriz", municipioUf: "MA", ambiente: "producao" } as never);
    expect(e!.ambiente).toBe("desligado");
  });
});

describe("QA — integridade do gerador (devem passar)", () => {
  it("duas varreduras ao mesmo tempo (dois crons) não duplicam rascunho nem histórico", async () => {
    for (let i = 0; i < 5; i++) await lancamento({ valor: 100 + i });
    await pg.exec("UPDATE fiscal_config SET ligado = true");
    const r = await Promise.all([gerarRascunhosNoCron(getDb, 30_000), gerarRascunhosNoCron(getDb, 30_000), gerarRascunhos(getDb(), { origem: "botao", agora: AGORA })]);
    expect(r.filter(x => "erro" in x)).toEqual([]);
    expect(await notas()).toHaveLength(5);
    expect(await q("SELECT nota_id FROM fiscal_notas_historico WHERE acao = 'criada'")).toHaveLength(5);
  });

  it("falha do banco no cron não lança e não registra dado pessoal no log", async () => {
    const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await gerarRascunhosNoCron(() => { throw new Error("CPF 123.456.789-09 do cliente Maria"); }, 30_000);
    expect(r).toEqual({ erro: true });
    expect(JSON.stringify(espiao.mock.calls)).not.toMatch(/123\.456|Maria/);
    espiao.mockRestore();
  });

  it("transições fora do fluxo e versão de outra nota são recusadas", async () => {
    await lancamento(); await lancamento({ valor: 2 });
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const [a, b] = await notas();
    await expect(admin().fiscal.notas.reabrir({ id: a!.id, versao: a!.versao })).rejects.toThrow(/Não é possível/);
    await admin().fiscal.notas.editar({ id: b!.id, versao: b!.versao, descricao: "x" });
    await admin().fiscal.notas.editar({ id: b!.id, versao: 2, descricao: "y" });
    // versão 3 é da nota B; na nota A (versão 1) é conflito
    await expect(admin().fiscal.notas.editar({ id: a!.id, versao: 3, descricao: "z" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("QA — achados do portão, corrigidos", () => {
  // [MÉDIO] gerador.ts:130-139 + 193-195: o LIMIT 500 é aplicado ANTES de descartar os tipos "nunca_gerar". Como esses
  // nunca viram linha em fiscal_notas, continuam sendo os 500 primeiros candidatos em toda passada e os recebimentos de id
  // maior (ex.: honorários) nunca ganham rascunho.
  it("500+ origens 'nunca_gerar' não podem travar para sempre os rascunhos das demais origens do mesmo tipo", async () => {
    await pg.exec(`UPDATE fiscal_tipos_servico SET regra = 'nunca_gerar' WHERE nome = 'Outras receitas do BPO'`);
    await pg.exec(`INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, pago, pago_em, competencia)
      SELECT 'receita', 'Receita ' || g, 10, now(), true, '2026-11-10T12:00:00Z', '2026-11' FROM generate_series(1, ${LIMITE_POR_ORIGEM}) g`);
    const honorario = await lancamento({ tipo: "honorario" });
    for (let i = 0; i < 3; i++) await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    expect((await notas()).map(n => n.origem_id)).toContain(honorario);
  });

  // [MÉDIO] relatorio-mensal.ts:177: o CSV só põe aspas. Excel/LibreOffice executam célula que começa com = + - @ mesmo entre
  // aspas. A descrição vem do BPO, inclusive de extrato bancário/importação (texto de terceiro, ex.: mensagem de PIX).
  it("CSV do contador neutraliza fórmula vinda da descrição do lançamento (CSV injection)", () => {
    const r = montarRelatorio({
      competencia: "2026-11", de: new Date("2026-11-01T03:00:00Z"), ate: new Date("2026-12-01T02:59:59Z"),
      movimentos: [], lancamentosBpo: [{ id: 1, tipo: "receita", valor: "10.00", descricao: "=HYPERLINK(\"http://x\";\"clique\")" }], notas: [],
    });
    const csv = relatorioEmCsv(r);
    expect(csv).not.toMatch(/;"=HYPERLINK/);
  });

  // [MÉDIO] tax-router.ts:142-172 + TaxAccountingPanel.tsx:210-219: com o filtro "Empresa", o cartão "Tributos estimados"
  // aplica a alíquota DA empresa escolhida sobre a receita de TODAS as empresas (a tela avisa só no cartão da receita).
  // "Obrigações vencidas" também não é filtrada. AC 11 diz que o filtro separa os cartões.
  it("filtro 'Empresa' não aplica a alíquota de uma empresa sobre a receita de todas", async () => {
    const a = admin();
    await a.tax.profiles.create({ companyName: "Prospecta", cnpj: "11222333000181", regime: "simples_nacional", estimatedRate: 6, effectiveFrom: new Date("2026-01-01") });
    await a.tax.profiles.create({ companyName: "Efficaz", cnpj: "45723174000110", regime: "lucro_presumido", estimatedRate: 11, effectiveFrom: new Date("2026-02-01") });
    await lancamento({ valor: 1000 });
    const de = new Date("2026-11-01T03:00:00Z"), ate = new Date("2026-12-01T02:59:59Z");
    const geral = await a.tax.overview({ from: de, to: ate });
    const efficaz = await a.tax.overview({ from: de, to: ate, cnpj: "45723174000110" });
    expect(geral.estimatedTax).not.toBeNull();
    expect(efficaz.estimatedTax).toBeNull();
    expect(efficaz.estimativaIndisponivel).toMatch(/indisponível por empresa/);
  });

  // [MÉDIO] tax-router.ts:236-246: quem tinha perfil SEM CNPJ e cadastra a versão nova COM CNPJ (ou corrige um CNPJ digitado
  // errado) fica com dois perfis vigentes, e não há rota para desativar o antigo. Antes da S-2 sempre ficava um só.
  it("nova versão do perfil (passando a ter CNPJ) não deixa o perfil antigo vigente junto", async () => {
    const a = admin();
    await a.tax.profiles.create({ companyName: "Prospecta", regime: "simples_nacional", estimatedRate: 6, effectiveFrom: new Date("2026-01-01") });
    await a.tax.profiles.create({ companyName: "Prospecta", cnpj: "11222333000181", regime: "lucro_presumido", estimatedRate: 11, effectiveFrom: new Date("2026-06-01") });
    expect((await a.tax.profiles.list()).filter(p => p.isActive)).toHaveLength(1);
  });

  // [BAIXO] router.ts:31 e 177: UF só com max(2) e data só com regex; "M1" ou "2026-02-31" passam pela rota e estouram no
  // CHECK/tipo do banco como erro interno (500), sem frase para o dono.
  it("UF e data inválidas viram erro de validação (BAD_REQUEST), não erro interno", async () => {
    await lancamento();
    await gerarRascunhos(getDb(), { origem: "botao", agora: AGORA });
    const [n] = await notas();
    await expect(admin().fiscal.notas.editar({ id: n!.id, versao: n!.versao, municipioNome: "Imperatriz", municipioUf: "M1" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin().fiscal.notas.adiar({ id: n!.id, versao: n!.versao, ate: "2026-02-31" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
