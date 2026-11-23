// EPIC-029 S-8 — alíquota do Simples da nota no servidor: RBT12 por raiz do CNPJ (matriz + filiais), só notas EMITIDAS,
// BPO só com a conta por empresa (S-6) e sem contar duas vezes, Fator R pela folha informada, RBT12 proporcional, regime
// fora do Simples, 2027 sem tabela, DPS com a alíquota calculada e as permissões da rota da folha.
// Banco em memória (PGlite): tabelas do schema + 0154, 0162 e 0168. Nenhum teste chama serviço externo.
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
import { AVISO_BPO_SEM_CONTA_POR_EMPRESA, aliquotaSimplesDaNota, fonteReceitaMinima, paraDps } from "./simples.js";
import { aliquotaDaDps, faltasDps } from "./dps.js";
import { PARAMETROS_VAZIOS, type EntradaDps } from "../../shared/fiscal/dps-campos.js";

const TABELAS = [
  "users", "leads", "leadServices", "imoveis", "bpoClients", "bpoLancamentos", "bankAccounts", "bankTransactions", "constructionProjects",
  "obraMovimentos", "regularizacoes", "regularizacaoItensFinanceiros", "regularizacaoRecebimentos", "avaliacoes", "operationalCommissions",
  "financialTransactions", "taxProfiles", "taxObligations", "retProjects",
];
const ler = (n: string) => readFileSync(new URL(`../../drizzle/${n}`, import.meta.url), "utf8");
const M0154 = ler("0154_fiscal_notas.sql");
const M0162 = ler("0162_fiscal_certificados.sql");
const M0168 = ler("0168_fiscal_folha_fator_r.sql");
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
  await pg.close();
});

describe("RBT12 da empresa (raiz do CNPJ)", () => {
  beforeEach(() => preparar());

  it("soma matriz + filial nos 12 meses anteriores; não soma outra empresa, fora da janela nem nota não emitida", async () => {
    await emitida(1, "2025-11-01", R$(200_000)); // 1º dia da janela (11/2025 a 10/2026)
    await emitida(2, "2026-10-31", R$(300_000)); // filial, último dia da janela
    await emitida(1, "2025-10-31", R$(999_000)); // fora (antes)
    await emitida(1, "2026-11-01", R$(999_000)); // fora (o próprio mês)
    await emitida(3, "2026-05-10", R$(999_000)); // outra raiz
    await rascunho(1, 101, "2026-06-10", R$(999_000)); // não emitida
    const id = await rascunho(1, 101);
    const r = await calcular(id);
    expect(r.aplica).toBe(true);
    if (!r.aplica) return;
    expect(r.periodo).toEqual({ de: "2025-11-01", ate: "2026-10-31" });
    expect(r.rbt12).toEqual({ centavos: R$(500_000), regra: "doze_meses", meses: 12 });
    // Anexo IV, R$ 500.000: efetiva 7,7160%, ISS 3,0864% (ALIQUOTAS.md §3.5).
    expect(r.calculo).toMatchObject({ anexo: { anexo: "IV" }, faixa: 3, efetiva: 77_160, iss: 30_864 });
    expect(r.aliquotaDps).toBe("3.0864");
    // Sem a conta por empresa (S-6), o BPO não entra e a tela avisa.
    expect(r.receita).toEqual({ completo: false, notasEmitidas: R$(500_000), bpo: null });
    expect(r.avisos).toContain(AVISO_BPO_SEM_CONTA_POR_EMPRESA);
  });

  it("com a conta por empresa (S-6), soma o BPO pago na conta da empresa sem contar duas vezes o que já está numa nota emitida", async () => {
    await pg.exec(`ALTER TABLE bank_accounts ADD COLUMN empresa_cnpj varchar(14);
      INSERT INTO bank_accounts (id, banco, conta, empresa_cnpj) VALUES (1, 'Banco', '1', '41865900000189'), (2, 'Banco', '2', '11222333000181');
      INSERT INTO bank_transactions (id, account_id, tipo, valor, data, descricao) VALUES
        (1, 1, 'credito', 100000, '2026-03-10', 'a'), (2, 1, 'credito', 50000, '2026-04-10', 'b'), (3, 2, 'credito', 70000, '2026-04-10', 'c'),
        (4, 1, 'credito', 80000, '2026-11-02', 'd');
      INSERT INTO bpo_lancamentos (id, tipo, descricao, valor, vencimento, pago, pago_em, competencia, bank_transaction_id) VALUES
        (1, 'receita', 'a', 100000, '2026-03-10', true, '2026-03-10 12:00', '2026-03', 1),
        (2, 'receita', 'b', 50000, '2026-04-10', true, '2026-04-10 12:00', '2026-04', 2),
        (3, 'receita', 'c', 70000, '2026-04-10', true, '2026-04-10 12:00', '2026-04', 3),
        (4, 'receita', 'd', 80000, '2026-11-02', true, '2026-11-02 12:00', '2026-11', 4);`);
    // A nota emitida do lançamento 2 (R$ 50.000) não pode somar de novo pelo BPO.
    await pg.query(`INSERT INTO fiscal_notas (emissor_id, tipo_servico_id, origem_tipo, origem_id, data_evento, status) VALUES (1, 101, 'bpo_lancamento', 2, '2026-04-10', 'EMITIDA')`);
    const r = await calcular(await rascunho(1, 101));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.receita).toEqual({ completo: true, notasEmitidas: R$(50_000), bpo: R$(100_000) });
    expect(r.rbt12.centavos).toBe(R$(150_000));
    expect(r.avisos).not.toContain(AVISO_BPO_SEM_CONTA_POR_EMPRESA);
  });

  it("fonte de receita é uma interface: a S-6 troca a implementação", async () => {
    const id = await rascunho(1, 103);
    const db = drizzle(pg) as never;
    const r = await aliquotaSimplesDaNota(db, await carregarNota(db, id), {
      receitaDoPeriodo: async () => ({ centavos: R$(3_000_000), fontes: { notasEmitidas: 0, bpo: R$(3_000_000) }, completo: true, avisos: [] }),
    });
    if (!r.aplica || !r.calculo) throw new Error("devia calcular");
    // Anexo III, 5ª faixa: teto do ISS em 5%.
    expect(r.calculo).toMatchObject({ faixa: 5, efetiva: 168_120, iss: 50_000, reparticao: { tetoAplicado: true } });
    expect(fonteReceitaMinima(db)).toHaveProperty("receitaDoPeriodo");
  });
});

describe("Fator R e anexo", () => {
  beforeEach(() => preparar());

  it("cAtvSN 9 sem folha → Anexo V (a informar); com folha ≥ 28% até o mês anterior → III; folha desatualizada → V", async () => {
    await emitida(1, "2026-02-10", R$(500_000));
    const id = await rascunho(1, 102);
    let r = await calcular(id);
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.folha.situacao).toBe("a_informar");
    expect(r.calculo).toMatchObject({ anexo: { anexo: "V", fatorR: "a_informar" }, efetiva: 175_200, iss: 33_288 });
    expect(r.avisos.join(" ")).toMatch(/Anexo V \(o lado de pagar mais\)/);

    await caller("admin").fiscal.emissores.salvarSimples({ cnpj: "41.865.900/0002-60", folha12mCentavos: R$(150_000), folhaAte: "2026-10", inicioAtividade: null });
    r = await calcular(id);
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.folha.situacao).toBe("valida"); // salvo pela filial, vale para a raiz
    expect(r.fatorR).toEqual({ r: 300_000, atinge: true, motivo: "r ≥ 28%" });
    expect(r.calculo).toMatchObject({ anexo: { anexo: "III", fatorR: "anexo_iii" }, efetiva: 99_720, iss: 32_409 });

    await caller("admin").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: R$(150_000), folhaAte: "2026-09", inicioAtividade: null });
    r = await calcular(id);
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.folha.situacao).toBe("desatualizada");
    expect(r.calculo?.anexo.anexo).toBe("V");
  });

  it("tipo sem Fator R não olha a folha", async () => {
    const r = await calcular(await rascunho(1, 103));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.folha.situacao).toBe("nao_se_aplica");
    expect(r.calculo?.anexo.anexo).toBe("III");
  });
});

describe("empresa com menos de 12 meses", () => {
  beforeEach(() => preparar());

  it("5º mês de atividade: média dos 4 meses anteriores × 12", async () => {
    await caller("admin").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: null, folhaAte: null, inicioAtividade: "2026-07-15" });
    await emitida(1, "2026-07-20", R$(10_000));
    await emitida(1, "2026-08-20", R$(20_000));
    await emitida(2, "2026-09-20", R$(30_000));
    await emitida(1, "2026-10-20", R$(40_000));
    const r = await calcular(await rascunho(1, 101));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.rbt12).toEqual({ centavos: R$(300_000), regra: "media_dos_meses", meses: 4 });
    expect(r.periodo).toEqual({ de: "2026-07-01", ate: "2026-10-31" });
  });

  it("1º mês: receita do mês (emitidas + esta nota) × 12, provisório", async () => {
    await caller("admin").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: null, folhaAte: null, inicioAtividade: "2026-11-03" });
    await emitida(1, "2026-11-05", R$(4_000));
    const r = await calcular(await rascunho(1, 101, "2026-11-20", R$(1_000)));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.rbt12).toEqual({ centavos: R$(60_000), regra: "primeiro_mes", meses: 0 });
    expect(r.avisos.join(" ")).toMatch(/provisório/);
  });

  it("sem início de atividade: tratada com 12 meses ou mais, com aviso", async () => {
    const r = await calcular(await rascunho(1, 101));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.avisos.join(" ")).toMatch(/Início de atividade não informado/);
  });
});

describe("regime, vigência e DPS", () => {
  beforeEach(() => preparar());

  it("regime fora do Simples ou sem empresa: não calcula", async () => {
    expect(await calcular(await rascunho(4, 101))).toEqual({ aplica: false, motivo: expect.stringMatching(/lucro_presumido/) });
    expect(await calcular(await rascunho(null, 101))).toMatchObject({ aplica: false });
    expect(paraDps({ aplica: false, motivo: "x" })).toBeNull();
  });

  it("competência de 2027: sem tabela cadastrada → não calcula e a DPS recusa", async () => {
    const r = await calcular(await rascunho(1, 101, "2027-01-15"));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/2027/);
    expect(paraDps(r)).toEqual({ aliquotaIss: null, falta: expect.stringMatching(/alíquota do Simples: .*2027/), receitaCompleta: false });
  });

  it("6ª faixa: ISS fora do DAS → pAliq volta a ser a alíquota municipal do tipo", async () => {
    const id = await rascunho(1, 101);
    const db = drizzle(pg) as never;
    const r = await aliquotaSimplesDaNota(db, await carregarNota(db, id), {
      receitaDoPeriodo: async () => ({ centavos: R$(4_000_000), fontes: { notasEmitidas: R$(4_000_000), bpo: 0 }, completo: true, avisos: [] }),
    });
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.calculo?.iss).toBeNull();
    expect(r.aliquotaDps).toBe("5.0000");
    expect(paraDps(r)).toEqual({ aliquotaIss: "5.0000", falta: null, receitaCompleta: true });
  });

  it("DPS: Simples usa a alíquota calculada; sem cálculo, falta; produção exige receita completa; outro regime usa a do tipo", () => {
    const base = { ambiente: "producao_restrita", regimeTributario: "simples_nacional", aliquotaIss: "5.0000", competencia: "2026-11-20",
      servico: { codigoAtividadeSimples: "13" }, parametros: PARAMETROS_VAZIOS, prestador: {}, tomador: null } as unknown as EntradaDps;
    expect(aliquotaDaDps({ ...base, aliquotaSimples: { aliquotaIss: "3.0864", falta: null, receitaCompleta: true } })).toBe("3.0864");
    expect(aliquotaDaDps({ ...base, aliquotaSimples: null })).toBeNull();
    expect(aliquotaDaDps({ ...base, regimeTributario: "lucro_presumido", aliquotaSimples: { aliquotaIss: "3.0864", falta: null, receitaCompleta: true } })).toBe("5.0000");
    expect(faltasDps({ ...base, aliquotaSimples: null })).toContain("alíquota do Simples calculada pelo sistema (RBT12 × anexo do tipo de serviço)");
    expect(faltasDps({ ...base, aliquotaSimples: { aliquotaIss: null, falta: "alíquota do Simples: x", receitaCompleta: true } })).toContain("alíquota do Simples: x");
    expect(faltasDps({ ...base, ambiente: "producao", aliquotaSimples: { aliquotaIss: "3.0864", falta: null, receitaCompleta: false } }).join(";"))
      .toMatch(/receita dos 12 meses completa/);
    expect(faltasDps({ ...base, regimeTributario: "lucro_presumido", aliquotaSimples: null }).join(";")).not.toMatch(/alíquota do Simples/);
  });

  it("rota aliquotaSimples devolve o cálculo (sem dado pessoal)", async () => {
    const id = await rascunho(1, 101);
    const r = await caller("admin").fiscal.notas.aliquotaSimples({ id });
    expect(r).toMatchObject({ aplica: true, ok: true, raiz: "41865900" });
    expect(JSON.stringify(r)).not.toMatch(/tomador|cpf/i);
  });
});

describe("rota da folha (salvarSimples)", () => {
  it("só admin por papel; folha sem o mês recusada; perfil inexistente recusado; lista mostra os dados", async () => {
    await preparar();
    await expect(caller("colaborador").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: 1, folhaAte: "2026-10", inicioAtividade: null }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("admin").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: 1, folhaAte: null, inicioAtividade: null }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller("admin").fiscal.emissores.salvarSimples({ cnpj: "99888777000166", folha12mCentavos: null, folhaAte: null, inicioAtividade: null }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller("admin").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: R$(150_000), folhaAte: "2026-10", inicioAtividade: "2021-05-07" });
    const lista = await caller("admin").fiscal.emissores.listar();
    const filial = lista.find(p => p.cnpj === "41865900000260");
    expect(filial?.simples).toEqual({ folha12mCentavos: R$(150_000), folhaAte: "2026-10", inicioAtividade: "2021-05-07" });
    expect(lista.find(p => p.cnpj === "11222333000181")?.simples).toBeNull();
  });

  it("sem a migração 0168: salvar avisa que falta a migração e o cálculo segue com a folha a informar", async () => {
    await preparar(false);
    await expect(caller("admin").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: 1, folhaAte: "2026-10", inicioAtividade: null }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const r = await calcular(await rascunho(1, 102));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.folha.situacao).toBe("a_informar");
    expect((await caller("admin").fiscal.emissores.listar())[0]?.simples).toBeNull();
  });
});
