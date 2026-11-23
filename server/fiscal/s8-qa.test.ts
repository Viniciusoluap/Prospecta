// EPIC-029 S-8 — portão de QA (Quinn, 23/11/2026): tentativa de quebrar a alíquota do Simples.
// Parte 1 (pura): cada número dos Anexos III, IV e V (LC 123, redação da LC 155/2016), fronteiras de faixa, teto do ISS,
// 6ª faixa, RBT12 zero/negativo, proporcional (art. 18 §2º), Fator R na fronteira de 28%, arredondamento.
// Parte 2 (servidor, PGlite): RBT12 por raiz, janela, dupla contagem, permissões, DPS, migração 0168.
// Achados ficam como `it.fails` (o teste descreve o comportamento CORRETO e hoje falha).
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
import { carregarNota } from "./notas.js";
import { aliquotaSimplesDaNota, paraDps } from "./simples.js";
import { faltasDps } from "./dps.js";
import { PARAMETROS_VAZIOS, type EntradaDps } from "../../shared/fiscal/dps-campos.js";
import {
  ErroSimples, TABELA_LC155, aliquotaEfetiva, anexoDoServico, calcularSimples, centavosDaAliquota, faixaDoRbt12, fatorR,
  mesesDeAtividadeAntes, percentualDecimal, rbt12Proporcional, reparticao, tabelaDoPeriodo, type Anexo, type Tributo,
} from "../../shared/fiscal/simples.js";

const TABELAS = [
  "users", "leads", "leadServices", "imoveis", "bpoClients", "bpoLancamentos", "bankAccounts", "bankTransactions", "constructionProjects",
  "obraMovimentos", "regularizacoes", "regularizacaoItensFinanceiros", "regularizacaoRecebimentos", "avaliacoes", "operationalCommissions",
  "financialTransactions", "taxProfiles", "taxObligations", "retProjects",
];
const ler = (n: string) => readFileSync(new URL(`../../drizzle/${n}`, import.meta.url), "utf8");
const M0154 = ler("0154_fiscal_notas.sql");
const M0162 = ler("0162_fiscal_certificados.sql");
const M0168 = ler("0168_fiscal_folha_fator_r.sql");
// S-7 (merge): o schema lê as colunas da emissão (0167) — a migração entra também aqui.
const M0167 = ler("0167_fiscal_emissao.sql");
let ddl = "";

beforeAll(async () => {
  const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
  const escolhidas: Record<string, unknown> = {};
  for (const [nome, valor] of Object.entries(schema)) if (TABELAS.includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
  ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n");
}, 60_000);

let pg: PGlite;
let fetchVigia: ReturnType<typeof vi.spyOn>;
const R$ = (v: number) => Math.round(v * 100);

async function preparar(comMigracao = true) {
  pg = new PGlite();
  await pg.exec(ddl);
  await pg.exec(M0154);
  await pg.exec(M0162);
  await pg.exec(M0167);
  if (comMigracao) {
    await pg.exec(M0168);
    await pg.exec(M0168); // idempotente
  }
  vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
  await pg.exec(`
    INSERT INTO users (id, "openId", name, role) VALUES (1, 'admin', 'Dono', 'admin'), (2, 'colab', 'Colaboradora', 'colaborador');
    INSERT INTO tax_profiles (company_name, cnpj, regime, effective_from) VALUES
      ('Prospecta', '41.865.900/0001-89', 'simples_nacional', '2021-05-07'),
      ('Prospecta filial', '41.865.900/0002-60', 'simples_nacional', '2021-05-07'),
      ('Outra', '11.222.333/0001-81', 'simples_nacional', '2021-01-01'),
      ('Presumida', '55.444.333/0001-22', 'lucro_presumido', '2021-01-01');
    INSERT INTO fiscal_emissores (id, cnpj, municipio_ibge, serie_dps) VALUES
      (1, '41865900000189', '2105302', '1'), (2, '41865900000260', '2105302', '1'), (3, '11222333000181', '2105302', '1'), (4, '55444333000122', '2105302', '1');
    INSERT INTO fiscal_tipos_servico (id, nome, codigo_atividade_simples, aliquota_iss) VALUES
      (101, 'Obra S8', '13', 5), (102, 'Avaliação S8', '9', 5), (103, 'Corretagem S8', '7', 5);
    ALTER TABLE fiscal_notas DISABLE TRIGGER fiscal_notas_guarda_trg;
  `);
}

let origem = 1000;
/** Nota já EMITIDA (o gatilho que recusa EMITIDA fica desligado só neste banco de teste). */
async function emitida(emissorId: number, dataEvento: string, valor: number) {
  await pg.query(`INSERT INTO fiscal_notas (emissor_id, tipo_servico_id, origem_tipo, origem_id, data_evento, status, valor_ajustado_centavos)
    VALUES ($1, 101, 'avaliacao', $2, $3, 'EMITIDA', $4)`, [emissorId, origem++, dataEvento, valor]);
}
async function rascunho(emissorId: number | null, tipo: number, dataEvento = "2026-11-20", valor = R$(1_000)): Promise<number> {
  const r = await pg.query<{ id: number }>(`INSERT INTO fiscal_notas (emissor_id, tipo_servico_id, origem_tipo, origem_id, data_evento, valor_ajustado_centavos)
    VALUES ($1, $2, 'avaliacao', $3, $4, $5) RETURNING id`, [emissorId, tipo, origem++, dataEvento, valor]);
  return r.rows[0]!.id;
}
const calcular = async (id: number) => aliquotaSimplesDaNota(drizzle(pg) as never, await carregarNota(drizzle(pg) as never, id));

const app = router({ fiscal: fiscalRouter, tax: taxRouter });
const caller = (role: string) =>
  app.createCaller({ user: { id: role === "admin" ? 1 : 2, role, active: true, permissions: JSON.stringify(["bpo"]) }, req: { headers: {} }, res: {} } as never);

beforeEach(() => {
  fetchVigia = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("rede proibida no teste"); });
});
afterEach(async () => {
  expect(fetchVigia).not.toHaveBeenCalled();
  fetchVigia.mockRestore();
  await pg?.close();
  pg = undefined as never;
});


// ---------------------------------------------------------------------------------------------------------------------
// Parte 1 — tabelas da lei (conferência independente, digitada a partir da LC 123, Anexos III, IV e V, redação LC 155/2016)
// ---------------------------------------------------------------------------------------------------------------------
type Linha = [ate: number, nominal: number, deduzir: number, irpj: number, csll: number, cofins: number, pis: number, cpp: number | null, iss: number | null];
const LEI: Record<Anexo, Linha[]> = {
  III: [
    [180_000, 6, 0, 4, 3.5, 12.82, 2.78, 43.4, 33.5],
    [360_000, 11.2, 9_360, 4, 3.5, 14.05, 3.05, 43.4, 32],
    [720_000, 13.5, 17_640, 4, 3.5, 13.64, 2.96, 43.4, 32.5],
    [1_800_000, 16, 35_640, 4, 3.5, 13.64, 2.96, 43.4, 32.5],
    [3_600_000, 21, 125_640, 4, 3.5, 12.82, 2.78, 43.4, 33.5],
    [4_800_000, 33, 648_000, 35, 15, 16.03, 3.47, 30.5, null],
  ],
  IV: [
    [180_000, 4.5, 0, 18.8, 15.2, 17.67, 3.83, null, 44.5],
    [360_000, 9, 8_100, 19.8, 15.2, 20.55, 4.45, null, 40],
    [720_000, 10.2, 12_420, 20.8, 15.2, 19.73, 4.27, null, 40],
    [1_800_000, 14, 39_780, 17.8, 19.2, 18.9, 4.1, null, 40],
    [3_600_000, 22, 183_780, 18.8, 19.2, 18.08, 3.92, null, 40],
    [4_800_000, 33, 828_000, 53.5, 21.5, 20.55, 4.45, null, null],
  ],
  V: [
    [180_000, 15.5, 0, 25, 15, 14.1, 3.05, 28.85, 14],
    [360_000, 18, 4_500, 23, 15, 14.1, 3.05, 27.85, 17],
    [720_000, 19.5, 9_900, 24, 15, 14.92, 3.23, 23.85, 19],
    [1_800_000, 20.5, 17_100, 21, 15, 15.74, 3.41, 23.85, 21],
    [3_600_000, 23, 62_100, 23, 12.5, 14.1, 3.05, 23.85, 23.5],
    [4_800_000, 30.5, 540_000, 35, 15.5, 16.44, 3.56, 29.5, null],
  ],
};
const u = (pct: number) => Math.round(pct * 10_000);
const c = (reais: number) => Math.round(reais * 100);

describe("QA S-8 — tabelas iguais à lei, linha por linha", () => {
  for (const anexo of ["III", "IV", "V"] as Anexo[]) {
    it(`Anexo ${anexo}: faixa, nominal, parcela a deduzir e repartição batem com a LC 155 e somam 100%`, () => {
      const faixas = TABELA_LC155.anexos![anexo];
      expect(faixas).toHaveLength(6);
      LEI[anexo].forEach(([ate, nominal, deduzir, irpj, csll, cofins, pis, cpp, iss], i) => {
        const f = faixas[i]!;
        expect(f.ate).toBe(c(ate));
        expect(f.nominal).toBe(u(nominal));
        expect(f.deduzir).toBe(c(deduzir));
        const esperado: Partial<Record<Tributo, number>> = { irpj: u(irpj), csll: u(csll), cofins: u(cofins), pis: u(pis) };
        if (cpp != null) esperado.cpp = u(cpp);
        if (iss != null) esperado.iss = u(iss);
        expect(f.reparticao).toEqual(esperado);
        expect(Object.values(f.reparticao).reduce((a, b) => a + (b ?? 0), 0)).toBe(1_000_000);
      });
    });
  }

  it("teto do ISS só na 5ª faixa de III e IV, com o excedente da lei (soma 100%); V sem teto", () => {
    expect(TABELA_LC155.anexos!.III[4]!.teto).toEqual({ issMaximo: u(5), excedente: { irpj: u(6.02), csll: u(5.26), cofins: u(19.28), pis: u(4.18), cpp: u(65.26) } });
    expect(TABELA_LC155.anexos!.IV[4]!.teto).toEqual({ issMaximo: u(5), excedente: { irpj: u(31.33), csll: u(32), cofins: u(30.13), pis: u(6.54) } });
    for (const a of ["III", "IV", "V"] as Anexo[]) TABELA_LC155.anexos![a].forEach((f, i) => { if (i !== 4 || a === "V") expect(f.teto).toBeUndefined(); });
    for (const a of ["III", "IV"] as Anexo[]) expect(Object.values(TABELA_LC155.anexos![a][4]!.teto!.excedente).reduce((x, y) => x + (y ?? 0), 0)).toBe(1_000_000);
  });

  it("continuidade: a efetiva é contínua na troca de faixa (a parcela a deduzir da lei fecha a conta)", () => {
    for (const a of ["III", "IV", "V"] as Anexo[]) {
      for (let i = 0; i < 4; i++) { // 5ª→6ª é descontínua na lei (o ISS sai do DAS)
        const limite = LEI[a][i]![0];
        const antes = aliquotaEfetiva(c(limite), a).efetiva;
        const depois = aliquotaEfetiva(c(limite) + 1, a).efetiva;
        expect(Math.abs(depois - antes)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("QA S-8 — fronteiras de faixa", () => {
  const casos: [number, number][] = [[180_000, 1], [180_000.01, 2], [360_000, 2], [360_000.01, 3], [3_600_000, 5], [3_600_000.01, 6], [4_800_000, 6]];
  for (const [rbt, faixa] of casos) it(`RBT12 R$ ${rbt} → ${faixa}ª faixa nos três anexos`, () => {
    for (const a of ["III", "IV", "V"] as Anexo[]) expect(faixaDoRbt12(c(rbt), a).numero).toBe(faixa);
  });
  it("R$ 4.800.000,01 → fora do Simples (erro), nunca uma 7ª faixa", () => {
    for (const a of ["III", "IV", "V"] as Anexo[]) expect(() => aliquotaEfetiva(c(4_800_000) + 1, a)).toThrow(ErroSimples);
  });
  it("R$ 3.600.000,00 (Anexo III): efetiva 17,5100%, ISS no teto 5%, IRPJ = 12,51% × 6,02% = 0,7531%", () => {
    expect(aliquotaEfetiva(c(3_600_000), "III").efetiva).toBe(175_100);
    expect(reparticao(c(3_600_000), "III")).toMatchObject({ tetoAplicado: true, partes: { iss: 50_000, irpj: 7_531 } });
  });
  it("6ª faixa: ISS fora do DAS (sem parte de ISS) e efetiva 19,5000% em R$ 4,8 mi (Anexo III)", () => {
    expect(aliquotaEfetiva(c(4_800_000), "III").efetiva).toBe(195_000);
    const r = reparticao(c(4_800_000), "III");
    expect(r.issDentroDoDas).toBe(false);
    expect(r.partes.iss).toBeUndefined();
  });
  it("teto do ISS liga exatamente acima de 14,92537% (III) e de 12,5% (IV)", () => {
    // III: efetiva = 21% − 125.640/RBT12; limiar ≈ R$ 2.068.275,4
    expect(reparticao(c(2_068_275), "III").tetoAplicado).toBe(false);
    expect(reparticao(c(2_068_276), "III").tetoAplicado).toBe(true);
    // IV: 22% − 183.780/RBT12 = 12,5% ⇔ RBT12 = 1.934.526,31...
    expect(reparticao(c(1_934_526), "IV").tetoAplicado).toBe(false);
    expect(reparticao(c(1_934_527), "IV").tetoAplicado).toBe(true);
    // Anexo V nunca passa de 5% de ISS (no topo da 5ª faixa: 4,9996%).
    expect(reparticao(c(3_600_000), "V")).toMatchObject({ tetoAplicado: false, partes: { iss: 49_996 } });
  });
  it("no teto, a soma das partes fecha com a efetiva (diferença de arredondamento ≤ 3 u)", () => {
    for (const rbt of [2_100_000, 2_500_000, 3_000_000, 3_600_000]) for (const a of ["III", "IV"] as Anexo[]) {
      const ef = aliquotaEfetiva(c(rbt), a).efetiva;
      const soma = Object.values(reparticao(c(rbt), a).partes).reduce((x, y) => x + (y ?? 0), 0);
      expect(Math.abs(soma - ef)).toBeLessThanOrEqual(3);
    }
  });
});

describe("QA S-8 — RBT12 zero/negativo, proporcional, arredondamento", () => {
  it("RBT12 zero → nominal da 1ª faixa; negativo, fracionário ou NaN → erro", () => {
    expect(aliquotaEfetiva(0, "III").efetiva).toBe(60_000);
    expect(aliquotaEfetiva(0, "IV").efetiva).toBe(45_000);
    expect(aliquotaEfetiva(0, "V").efetiva).toBe(155_000);
    for (const v of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => aliquotaEfetiva(v, "III")).toThrow(ErroSimples);
  });
  it("proporcional: 1º mês ×12; média dos meses anteriores ×12 (arredondada ao centavo); ≥ 12 meses soma só os 12 últimos", () => {
    expect(rbt12Proporcional([], c(10_000))).toEqual({ rbt12: c(120_000), regra: "primeiro_mes", meses: 0 });
    expect(rbt12Proporcional([1, 0, 0, 0, 0, 0, 0], 999).rbt12).toBe(2); // 12/7 = 1,71 → 2
    expect(rbt12Proporcional([1, 0, 0, 0, 0, 0, 0, 0], 999).rbt12).toBe(2); // 12/8 = 1,5 → 2 (meio para cima)
    expect(rbt12Proporcional(Array(13).fill(100), 0)).toEqual({ rbt12: 1200, regra: "doze_meses", meses: 12 });
    expect(() => rbt12Proporcional([-1], 0)).toThrow(ErroSimples);
  });
  it("meses de atividade: início no meio do mês conta o mês; início depois da competência → 0", () => {
    expect(mesesDeAtividadeAntes("2026-07-15", "2026-11")).toBe(4);
    expect(mesesDeAtividadeAntes("2026-11-30", "2026-11")).toBe(0);
    expect(mesesDeAtividadeAntes("2027-01-01", "2026-11")).toBe(0);
    expect(mesesDeAtividadeAntes(null, "2026-11")).toBeNull();
  });
  it("percentualDecimal sem erro de ponto flutuante (0 a 33%)", () => {
    for (let v = 0; v <= 330_000; v += 7) {
      const esperado = `${Math.floor(v / 10_000)}.${String(v % 10_000).padStart(4, "0")}`;
      expect(percentualDecimal(v)).toBe(esperado);
    }
  });
  it("valor × alíquota ao centavo, meio para cima", () => {
    expect(centavosDaAliquota(100, 5_000)).toBe(1); // 0,5 centavo → 1
    expect(centavosDaAliquota(99, 5_000)).toBe(0); // 0,495 → 0
    expect(centavosDaAliquota(c(1_234.56), 30_864)).toBe(3_810); // 1.234,56 × 3,0864% = 38,1035 → 38,10
  });
});

describe("QA S-8 — Fator R e vigência", () => {
  it("r exatamente 28% → Anexo III (\"igual ou superior\", §5º-J); 1 centavo a menos → V", () => {
    expect(anexoDoServico("9", fatorR(c(28_000), c(100_000))).anexo).toBe("III");
    expect(anexoDoServico("9", fatorR(c(28_000) - 1, c(100_000))).anexo).toBe("V");
  });
  it("folha zero → V; folha negativa → erro; receita zero ou folha ausente → V (a informar)", () => {
    expect(anexoDoServico("9", fatorR(0, c(100_000)))).toMatchObject({ anexo: "V", fatorR: "anexo_v" });
    expect(() => fatorR(-1, c(100_000))).toThrow(ErroSimples);
    expect(anexoDoServico("9", fatorR(c(50_000), 0))).toMatchObject({ anexo: "V", fatorR: "a_informar" });
    expect(anexoDoServico("9", null)).toMatchObject({ anexo: "V", fatorR: "a_informar" });
  });
  it("cAtvSN inválido ou 'IMP' → erro; competência 2026-12-31 usa a LC 155, 2027-01-01 não calcula", () => {
    expect(() => anexoDoServico("IMP", null)).toThrow(ErroSimples);
    expect(() => anexoDoServico(" ", null)).toThrow(ErroSimples);
    expect(tabelaDoPeriodo("2026-12-31")?.id).toBe("lc123-lc155-2018");
    expect(() => calcularSimples({ competencia: "2027-01", cAtvSN: "7", rbt12: c(100_000), fatorR: null })).toThrow(/2027/);
    expect(() => calcularSimples({ competencia: "2017-12", cAtvSN: "7", rbt12: c(100_000), fatorR: null })).toThrow(ErroSimples);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Parte 2 — servidor (PGlite)
// ---------------------------------------------------------------------------------------------------------------------
describe("QA S-8 — servidor: RBT12 por raiz e janela", () => {
  beforeEach(() => preparar());

  it("janela = 12 meses ANTERIORES (competência jan/2026 → jan..dez/2025), em qualquer virada de ano", async () => {
    await emitida(1, "2025-01-01", R$(100_000));
    await emitida(2, "2025-12-31", R$(100_000));
    await emitida(1, "2024-12-31", R$(999_000));
    await emitida(1, "2026-01-02", R$(999_000));
    const r = await calcular(await rascunho(1, 101, "2026-01-15"));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.periodo).toEqual({ de: "2025-01-01", ate: "2025-12-31" });
    expect(r.rbt12.centavos).toBe(R$(200_000));
  });

  it("nota CANCELADA não entra no RBT12", async () => {
    await pg.query(`INSERT INTO fiscal_notas (emissor_id, tipo_servico_id, origem_tipo, origem_id, data_evento, status, valor_ajustado_centavos)
      VALUES (1, 101, 'avaliacao', 77777, '2026-05-10', 'CANCELADA', $1)`, [R$(999_000)]);
    const r = await calcular(await rascunho(1, 101));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.rbt12.centavos).toBe(0);
  });

  it("receita incompleta (sem conta por empresa) bloqueia a DPS de PRODUÇÃO, não a de produção restrita", async () => {
    const r = await calcular(await rascunho(1, 101));
    const a = paraDps(r)!;
    expect(a.receitaCompleta).toBe(false);
    const base = { ambiente: "producao", regimeTributario: "simples_nacional", aliquotaIss: "5.0000", competencia: "2026-11-20",
      servico: { codigoAtividadeSimples: "13" }, parametros: PARAMETROS_VAZIOS, prestador: {}, tomador: null, aliquotaSimples: a } as unknown as EntradaDps;
    expect(faltasDps(base).join(";")).toMatch(/receita dos 12 meses completa/);
    expect(faltasDps({ ...base, ambiente: "producao_restrita" }).join(";")).not.toMatch(/receita dos 12 meses completa/);
  });

  it("BPO só da conta da MESMA raiz; lançamento combinado, a classificar, não pago ou despesa não entram", async () => {
    await pg.exec(`ALTER TABLE bank_accounts ADD COLUMN empresa_cnpj varchar(18);
      INSERT INTO bank_accounts (id, banco, conta, empresa_cnpj) VALUES (1, 'Banco', '1', '41.865.900/0002-60'), (2, 'Banco', '2', '41865901000100');
      INSERT INTO bank_transactions (id, account_id, tipo, valor, data, descricao) VALUES
        (1, 1, 'credito', 1000, '2026-03-10', 'a'), (2, 2, 'credito', 1000, '2026-03-10', 'b'), (3, 1, 'credito', 1000, '2026-03-10', 'c'),
        (4, 1, 'credito', 1000, '2026-03-10', 'd');
      INSERT INTO bpo_lancamentos (id, tipo, descricao, valor, vencimento, pago, pago_em, competencia, bank_transaction_id) VALUES
        (1, 'receita', 'a', 1000, '2026-03-10', true, '2026-03-10 12:00', '2026-03', 1),
        (2, 'receita', 'b', 1000, '2026-03-10', true, '2026-03-10 12:00', '2026-03', 2),
        (3, 'receita', 'c', 1000, '2026-03-10', false, null, '2026-03', 3),
        (4, 'despesa', 'd', 1000, '2026-03-10', true, '2026-03-10 12:00', '2026-03', 4);`);
    const r = await calcular(await rascunho(1, 101));
    if (!r.aplica) throw new Error("devia aplicar");
    // Conta 1 com CNPJ formatado da filial entra; conta 2 é de outra raiz (41865901).
    expect(r.receita).toEqual({ completo: true, notasEmitidas: 0, bpo: R$(1_000) });
  });

  it("ACHADO M1: reembolso de despesa do cliente não é receita bruta (art. 3º §1º) — não pode inflar o RBT12", async () => {
    await pg.exec(`ALTER TABLE bank_accounts ADD COLUMN empresa_cnpj varchar(14);
      INSERT INTO bank_accounts (id, banco, conta, empresa_cnpj) VALUES (1, 'Banco', '1', '41865900000189');
      INSERT INTO bank_transactions (id, account_id, tipo, valor, data, descricao) VALUES (1, 1, 'credito', 50000, '2026-03-10', 'cartório');
      INSERT INTO bpo_lancamentos (id, tipo, descricao, valor, vencimento, pago, pago_em, competencia, bank_transaction_id) VALUES
        (1, 'reembolso', 'custas de cartório repassadas', 50000, '2026-03-10', true, '2026-03-10 12:00', '2026-03', 1);`);
    const r = await calcular(await rascunho(1, 101));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.rbt12.centavos).toBe(0);
  });
});

describe("QA S-8 — servidor: Fator R", () => {
  beforeEach(() => preparar());

  it("folha informada até um mês POSTERIOR ao anterior à competência (nota retroativa) → desatualizada → Anexo V", async () => {
    await emitida(1, "2026-02-10", R$(500_000));
    await caller("admin").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: R$(400_000), folhaAte: "2026-11", inicioAtividade: null });
    const r = await calcular(await rascunho(1, 102, "2026-11-20"));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.folha.situacao).toBe("desatualizada");
    expect(r.calculo?.anexo.anexo).toBe("V");
  });

  it("folha zero com receita → r = 0 → Anexo V; RBT12 zero → a informar → Anexo V", async () => {
    await caller("admin").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: 0, folhaAte: "2026-10", inicioAtividade: null });
    let r = await calcular(await rascunho(1, 102));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.calculo?.anexo).toMatchObject({ anexo: "V", fatorR: "a_informar" }); // sem receita no período
    await emitida(1, "2026-02-10", R$(100_000));
    r = await calcular(await rascunho(1, 102));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.calculo?.anexo).toMatchObject({ anexo: "V", fatorR: "anexo_v" });
  });

  it("salvarSimples recusa folha negativa e mês inválido", async () => {
    await expect(caller("admin").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: -1, folhaAte: "2026-10", inicioAtividade: null })).rejects.toBeTruthy();
    await expect(caller("admin").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: 1, folhaAte: "2026-13", inicioAtividade: null })).rejects.toBeTruthy();
    await expect(caller("admin").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: 1, folhaAte: "2026-10", inicioAtividade: "2026-02-31" })).rejects.toBeTruthy();
  });
});

describe("QA S-8 — servidor: permissões e vazamento", () => {
  beforeEach(() => preparar());

  it("salvarSimples: colaborador recusado mesmo com o módulo BPO; nada é gravado", async () => {
    await expect(caller("colaborador").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: 1, folhaAte: "2026-10", inicioAtividade: null }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await pg.query("SELECT count(*)::int AS n FROM fiscal_dados_simples")).rows[0]).toEqual({ n: 0 });
  });

  it("aliquotaSimples: usuário sem o módulo fiscal/BPO não acessa", async () => {
    const semModulo = app.createCaller({ user: { id: 2, role: "colaborador", active: true, permissions: JSON.stringify([]) }, req: { headers: {} }, res: {} } as never);
    const id = await rascunho(1, 101);
    await expect(semModulo.fiscal.notas.aliquotaSimples({ id })).rejects.toBeTruthy();
  });

  it("aliquotaSimples de nota inexistente → erro controlado (sem SQL na mensagem)", async () => {
    const e = await caller("admin").fiscal.notas.aliquotaSimples({ id: 999_999 }).catch(x => x);
    expect(e).toBeInstanceOf(Error);
    expect(String(e.message)).not.toMatch(/select|from|fiscal_notas/i);
  });

  it("ACHADO M2: colaborador (não admin) não deveria receber o valor da folha (salários + pró-labore) da empresa", async () => {
    await caller("admin").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: R$(123_456), folhaAte: "2026-10", inicioAtividade: null });
    const id = await rascunho(1, 102);
    const pelaNota = await caller("colaborador").fiscal.notas.aliquotaSimples({ id });
    const pelaLista = await caller("colaborador").fiscal.emissores.listar();
    expect(JSON.stringify(pelaNota)).not.toContain(String(R$(123_456)));
    expect(JSON.stringify(pelaLista)).not.toContain(String(R$(123_456)));
  });
});

describe("QA S-8 — servidor: sublimite e DPS", () => {
  beforeEach(() => preparar());

  it("ACHADO M3: RBT12 > R$ 3,6 mi SEM excesso de sublimite no ano → ISS continua no DAS (fórmula da 5ª faixa, Res. CGSN 140) [confirmar com o contador]", async () => {
    // Ano anterior com R$ 3,5 mi (não passou o sublimite) e RBT12 de R$ 3,7 mi: a empresa não está impedida de recolher o ISS
    // no Simples. A conta da Receita usa a 5ª faixa: (3,7 mi × 21% − 125.640)/3,7 mi × 33,5% = 5,897% → teto 5%.
    const id = await rascunho(1, 101, "2026-02-10");
    const db = drizzle(pg) as never;
    const r = await aliquotaSimplesDaNota(db, await carregarNota(db, id), {
      receitaDoPeriodo: async (_raiz, de) => ({ centavos: de.startsWith("2025-02") ? R$(3_700_000) : R$(3_500_000), fontes: { notasEmitidas: 0, bpo: 0 }, completo: true, avisos: [] }),
    });
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.calculo?.iss).toBe(50_000);
  });

  it("DPS do Simples: pAliq leva a parte do ISS calculada, não a do tipo; regime Presumido não calcula", async () => {
    const r = await calcular(await rascunho(4, 101));
    expect(r).toMatchObject({ aplica: false });
    expect(paraDps(r)).toBeNull();
  });

  it("competência 2027+ recusa na DPS mesmo com receita completa", async () => {
    const id = await rascunho(1, 101, "2027-03-01");
    const db = drizzle(pg) as never;
    const r = await aliquotaSimplesDaNota(db, await carregarNota(db, id), {
      receitaDoPeriodo: async () => ({ centavos: R$(100_000), fontes: { notasEmitidas: R$(100_000), bpo: 0 }, completo: true, avisos: [] }),
    });
    const a = paraDps(r)!;
    expect(a).toMatchObject({ aliquotaIss: null, receitaCompleta: true });
    expect(a.falta).toMatch(/2027/);
  });

  it("migração 0168: só CREATE TABLE IF NOT EXISTS (sem DROP/ALTER/UPDATE/DELETE) e roda duas vezes", async () => {
    const semComentario = M0168.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    expect(semComentario).not.toMatch(/\b(DROP|ALTER|UPDATE|DELETE|TRUNCATE|INSERT)\b/i);
    expect(semComentario).toMatch(/CREATE TABLE IF NOT EXISTS "fiscal_dados_simples"/);
    await pg.exec(M0168);
    await expect(pg.query(`INSERT INTO fiscal_dados_simples (raiz, folha_12m_centavos) VALUES ('41865900', 1)`)).rejects.toBeTruthy(); // folha sem o mês
    await expect(pg.query(`INSERT INTO fiscal_dados_simples (raiz) VALUES ('4186590')`)).rejects.toBeTruthy();
  });
});
