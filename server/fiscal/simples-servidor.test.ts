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
import { AVISO_BPO_SEM_CONTA_POR_EMPRESA, aliquotaSimplesDaNota, fonteReceitaDaApuracao, paraDps } from "./simples.js";
import { aliquotaDaDps, faltasDps } from "./dps.js";
import { PARAMETROS_VAZIOS, type EntradaDps } from "../../shared/fiscal/dps-campos.js";

const TABELAS = [
  "users", "leads", "leadServices", "imoveis", "bpoClients", "bpoLancamentos", "bankAccounts", "bankTransactions", "constructionProjects",
  "obraMovimentos", "regularizacoes", "regularizacaoItensFinanceiros", "regularizacaoRecebimentos", "avaliacoes", "operationalCommissions",
  "financialTransactions", "taxProfiles", "taxObligations", "retProjects", "bpoRecebimentos",
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
  ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n")
    // S-6 × S-8: o schema já traz as colunas da 0164; aqui o banco começa SEM elas (os testes ligam a conta por empresa com ALTER TABLE)
    .replace(/,\s*"apelido" varchar\(80\)/, "").replace(/,\s*"empresa_cnpj" varchar\(14\)/, "");
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
    expect(r.aliquotaDps).toBe("3.09"); // pAliq com 2 casas (CASAS_PALIQ), meio para cima
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
    expect(fonteReceitaDaApuracao(db)).toHaveProperty("receitaDoPeriodo");
  });
});

describe("Fator R e anexo", () => {
  beforeEach(() => preparar());

  it("cAtvSN 9 sem folha → Anexo V (a informar); com folha ≥ 28% até o mês anterior → III; folha desatualizada → V", async () => {
    await pg.exec("ALTER TABLE bank_accounts ADD COLUMN empresa_cnpj varchar(14)"); // receita completa (com ela incompleta, III vira V)
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
    expect(paraDps(r)).toEqual({ aliquotaIss: null, falta: expect.stringMatching(/alíquota do Simples: .*2027/), receitaCompleta: false, inicioAtividadeInformado: false });
  });

  it("sublimite ultrapassado no ano anterior: ISS fora do DAS → pAliq volta a ser a alíquota municipal do tipo", async () => {
    const id = await rascunho(1, 101);
    const db = drizzle(pg) as never;
    const r = await aliquotaSimplesDaNota(db, await carregarNota(db, id), {
      receitaDoPeriodo: async () => ({ centavos: R$(4_000_000), fontes: { notasEmitidas: R$(4_000_000), bpo: 0 }, completo: true, avisos: [] }),
    });
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.calculo?.iss).toBeNull();
    expect(r.aliquotaDps).toBe("5.00");
    expect(r.sublimite).toMatchObject({ issNoDas: false });
    expect(paraDps(r)).toEqual({ aliquotaIss: "5.00", falta: null, receitaCompleta: true, inicioAtividadeInformado: false });
  });

  it("DPS: Simples usa a alíquota calculada; sem cálculo, falta; produção exige receita completa; outro regime usa a do tipo", () => {
    const base = { ambiente: "producao_restrita", regimeTributario: "simples_nacional", aliquotaIss: "5.0000", competencia: "2026-11-20",
      servico: { codigoAtividadeSimples: "13" }, parametros: PARAMETROS_VAZIOS, prestador: {}, tomador: null } as unknown as EntradaDps;
    expect(aliquotaDaDps({ ...base, aliquotaSimples: { aliquotaIss: "3.09", falta: null, receitaCompleta: true } })).toBe("3.09");
    expect(aliquotaDaDps({ ...base, aliquotaSimples: null })).toBeNull();
    expect(aliquotaDaDps({ ...base, regimeTributario: "lucro_presumido", aliquotaSimples: { aliquotaIss: "3.09", falta: null, receitaCompleta: true } })).toBe("5.00");
    expect(faltasDps({ ...base, aliquotaSimples: null })).toContain("alíquota do Simples calculada pelo sistema (RBT12 × anexo do tipo de serviço)");
    expect(faltasDps({ ...base, aliquotaSimples: { aliquotaIss: null, falta: "alíquota do Simples: x", receitaCompleta: true } })).toContain("alíquota do Simples: x");
    // QA S-8 (M4): produção também exige a data de início de atividade; produção restrita só avisa.
    expect(faltasDps({ ...base, ambiente: "producao", aliquotaSimples: { aliquotaIss: "3.09", falta: null, receitaCompleta: true } }).join(";")).toMatch(/início de atividade/);
    expect(faltasDps({ ...base, ambiente: "producao", aliquotaSimples: { aliquotaIss: "3.09", falta: null, receitaCompleta: true, inicioAtividadeInformado: true } }).join(";")).not.toMatch(/início de atividade/);
    expect(faltasDps({ ...base, aliquotaSimples: { aliquotaIss: "3.09", falta: null, receitaCompleta: true } }).join(";")).not.toMatch(/início de atividade/);
    expect(faltasDps({ ...base, ambiente: "producao", aliquotaSimples: { aliquotaIss: "3.09", falta: null, receitaCompleta: false } }).join(";"))
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

describe("QA S-8 — correções (M1 a M4 e Fator R com receita incompleta)", () => {
  beforeEach(() => preparar());
  const db = () => drizzle(pg) as never;
  /** Fonte falsa por período: RBT12 (12 meses), ano anterior e ano em curso. */
  const fonte = (rbt12: number, anoAnterior: number, anoAtual: number) => ({
    receitaDoPeriodo: async (_raiz: string, de: string, ate: string) => {
      const centavos = de.endsWith("-01-01") && ate.endsWith("-12-31") ? anoAnterior : de.endsWith("-01-01") ? anoAtual : rbt12;
      return { centavos, fontes: { notasEmitidas: centavos, bpo: 0 }, completo: true, avisos: [] };
    },
  });

  it("M3: ano anterior acima do sublimite tira o ISS do DAS mesmo com RBT12 baixo (5ª faixa ou menos)", async () => {
    const id = await rascunho(1, 101, "2026-06-10");
    const r = await aliquotaSimplesDaNota(db(), await carregarNota(db(), id), fonte(R$(500_000), R$(3_600_000) + 1, R$(100_000)));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.calculo).toMatchObject({ faixa: 3, iss: null, reparticao: { issDentroDoDas: false } });
    expect(r.aliquotaDps).toBe("5.00"); // municipal do tipo
  });

  it("M3: ano em curso acima do sublimite em mais de 20% → ISS fora; em até 20% → no DAS, com aviso para o ano seguinte", async () => {
    const id = await rascunho(1, 101, "2026-06-10");
    let r = await aliquotaSimplesDaNota(db(), await carregarNota(db(), id), fonte(R$(3_000_000), R$(2_000_000), R$(4_320_000) + 1));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.calculo?.iss).toBeNull();
    r = await aliquotaSimplesDaNota(db(), await carregarNota(db(), id), fonte(R$(3_000_000), R$(2_000_000), R$(4_320_000)));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.calculo?.iss).toBe(50_000); // 5ª faixa, teto
    expect(r.avisos.join(" ")).toMatch(/janeiro de 2027/);
  });

  it("M3: RBT12 na 6ª faixa sem excesso no ano → ISS no DAS pela fórmula da 5ª faixa (Anexo IV: 12,5%+ → teto)", async () => {
    const id = await rascunho(1, 101, "2026-02-10");
    const r = await aliquotaSimplesDaNota(db(), await carregarNota(db(), id), fonte(R$(3_700_000), R$(3_500_000), R$(300_000)));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.calculo).toMatchObject({ faixa: 6, iss: 50_000, reparticao: { issDentroDoDas: true } });
    expect(r.aliquotaDps).toBe("5.00");
  });

  it("M2: colaborador vê a situação da folha e o anexo, nunca o valor (nem pela nota, nem pela lista)", async () => {
    await pg.exec("ALTER TABLE bank_accounts ADD COLUMN empresa_cnpj varchar(14)");
    await emitida(1, "2026-02-10", R$(500_000));
    await caller("admin").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: R$(150_000), folhaAte: "2026-10", inicioAtividade: null });
    const id = await rascunho(1, 102);
    const colab = await caller("colaborador").fiscal.notas.aliquotaSimples({ id });
    if (!colab.aplica) throw new Error("devia aplicar");
    expect(colab.folha).toMatchObject({ situacao: "valida", folha12mCentavos: null, folhaOculta: true });
    expect(colab.fatorR?.r).toBeNull();
    expect(colab.calculo?.anexo.anexo).toBe("III");
    const adm = await caller("admin").fiscal.notas.aliquotaSimples({ id });
    if (!adm.aplica) throw new Error("devia aplicar");
    expect(adm.folha.folha12mCentavos).toBe(R$(150_000));
    const lista = await caller("colaborador").fiscal.emissores.listar();
    expect(lista.find(p => p.cnpj === "41865900000189")?.simples).toMatchObject({ folha12mCentavos: null, folhaOculta: true, folhaAte: "2026-10" });
  });

  it("Fator R com receita incompleta: r ≥ 28% não vira Anexo III (usa o V, o lado de pagar mais)", async () => {
    await emitida(1, "2026-02-10", R$(500_000));
    await caller("admin").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: R$(150_000), folhaAte: "2026-10", inicioAtividade: null });
    const r = await calcular(await rascunho(1, 102));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.receita.completo).toBe(false);
    expect(r.calculo?.anexo).toMatchObject({ anexo: "V", fatorR: "a_informar" });
    expect(r.fatorR?.motivo).toMatch(/incompleta/);
  });

  it("M4: paraDps leva se o início de atividade foi informado", async () => {
    await caller("admin").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: null, folhaAte: null, inicioAtividade: "2021-05-07" });
    const r = await calcular(await rascunho(1, 101));
    expect(paraDps(r)).toMatchObject({ inicioAtividadeInformado: true });
  });
});

describe("Revisão do PR #321 (Codex) — divisão de pagamentos e 1º mês sem dupla contagem", () => {
  beforeEach(() => preparar());

  it("P2 1: receita baixada pela divisão de pagamentos entra pela conta do crédito, uma vez; sem duplicar o lançamento direto nem a nota emitida", async () => {
    await pg.exec(`ALTER TABLE bank_accounts ADD COLUMN empresa_cnpj varchar(14);
      INSERT INTO bank_accounts (id, banco, conta, empresa_cnpj) VALUES (1, 'Banco', '1', '41865900000189'), (2, 'Banco', '2', '11222333000181');
      INSERT INTO bank_transactions (id, account_id, tipo, valor, data, descricao) VALUES
        (1, 1, 'credito', 1000, '2026-03-10 12:00', 'um crédito, três cobranças'),
        (2, 1, 'credito', 500, '2026-04-10 12:00', 'pagamento direto'),
        (3, 2, 'credito', 700, '2026-04-10 12:00', 'outra empresa'),
        (4, 1, 'credito', 300, '2026-11-05 12:00', 'fora da janela');
      INSERT INTO bpo_lancamentos (id, tipo, descricao, valor, vencimento, pago, pago_em, competencia, bank_transaction_id) VALUES
        (11, 'honorario', 'A', 600, '2026-03-10', true, '2026-03-10 12:00', '2026-03', NULL),
        (12, 'receita', 'B', 400, '2026-03-10', false, NULL, '2026-03', NULL),
        (13, 'receita', 'C direto', 500, '2026-04-10', true, '2026-04-10 12:00', '2026-04', 2),
        (14, 'receita', 'D de nota emitida', 300, '2026-03-10', true, '2026-03-10 12:00', '2026-03', NULL),
        (15, 'reembolso', 'E reembolso', 100, '2026-03-10', true, '2026-03-10 12:00', '2026-03', NULL),
        (16, 'receita', 'F outra empresa', 700, '2026-04-10', true, '2026-04-10 12:00', '2026-04', NULL),
        (17, 'receita', 'G fora', 300, '2026-11-05', true, '2026-11-05 12:00', '2026-11', NULL);
      INSERT INTO bpo_recebimentos (lancamento_id, request_key, valor, recebido_em, bank_transaction_id) VALUES
        (11, 'r11', 600, '2026-03-10 12:00', 1),
        (12, 'r12', 400, '2026-03-10 12:00', 1),
        (13, 'r13', 500, '2026-04-10 12:00', 2),
        (14, 'r14', 300, '2026-03-10 12:00', 1),
        (15, 'r15', 100, '2026-03-10 12:00', 1),
        (16, 'r16', 700, '2026-04-10 12:00', 3),
        (17, 'r17', 300, '2026-11-05 12:00', 4);`);
    await pg.query(`INSERT INTO fiscal_notas (emissor_id, tipo_servico_id, origem_tipo, origem_id, data_evento, status) VALUES (1, 101, 'bpo_lancamento', 14, '2026-03-10', 'EMITIDA')`);
    const r = await calcular(await rascunho(1, 101));
    if (!r.aplica) throw new Error("devia aplicar");
    // A (600) + B (400) pela divisão + C (500) direto, uma vez; D já está na nota (300); E é reembolso; F é de outra raiz; G fora.
    expect(r.receita).toEqual({ completo: true, notasEmitidas: R$(300), bpo: R$(1_500) });
    expect(r.rbt12.centavos).toBe(R$(1_800));
  });

  it("P2 2: 1º mês — rascunho de lançamento do BPO já pago não é somado de novo (R$ 20 mil → RBT12 R$ 240 mil)", async () => {
    await caller("admin").fiscal.emissores.salvarSimples({ cnpj: "41865900000189", folha12mCentavos: null, folhaAte: null, inicioAtividade: "2026-11-03" });
    await pg.exec(`ALTER TABLE bank_accounts ADD COLUMN empresa_cnpj varchar(14);
      INSERT INTO bank_accounts (id, banco, conta, empresa_cnpj) VALUES (1, 'Banco', '1', '41865900000189');
      INSERT INTO bank_transactions (id, account_id, tipo, valor, data, descricao) VALUES (1, 1, 'credito', 20000, '2026-11-05 12:00', 'honorário');
      INSERT INTO bpo_lancamentos (id, tipo, descricao, valor, vencimento, pago, pago_em, competencia, bank_transaction_id) VALUES
        (21, 'honorario', 'honorário de novembro', 20000, '2026-11-05', true, '2026-11-05 12:00', '2026-11', 1);`);
    const n = await pg.query<{ id: number }>(`INSERT INTO fiscal_notas (emissor_id, tipo_servico_id, origem_tipo, origem_id, data_evento)
      VALUES (1, 101, 'bpo_lancamento', 21, '2026-11-05') RETURNING id`);
    const r = await calcular(n.rows[0]!.id);
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.rbt12).toEqual({ centavos: R$(240_000), regra: "primeiro_mes", meses: 0 });
    // Rascunho que NÃO é de lançamento do BPO continua somado (ainda não é receita no sistema).
    const outro = await calcular(await rascunho(1, 101, "2026-11-20", R$(10_000)));
    if (!outro.aplica) throw new Error("devia aplicar");
    expect(outro.rbt12.centavos).toBe(R$(360_000)); // (20 mil + 10 mil) × 12
  });
});

describe("S-6 × S-8 — RBT12 pela apuração da S-6 (M5 e lado seguro)", () => {
  beforeEach(() => preparar());
  const contas = `ALTER TABLE bank_accounts ADD COLUMN empresa_cnpj varchar(14);
    INSERT INTO bank_accounts (id, banco, conta, empresa_cnpj) VALUES (1, 'Banco', '1', '41865900000189'), (2, 'Banco', '2', '41865900000260');`;

  it("M5: nota emitida SEM lançamento do BPO e o recebimento de mesmo valor no banco contam uma vez só", async () => {
    await pg.exec(`${contas}
      INSERT INTO bank_transactions (id, account_id, tipo, valor, data, descricao) VALUES (1, 1, 'credito', 8000, '2026-05-20 12:00', 'PIX RECEBIDO');
      INSERT INTO bpo_lancamentos (id, tipo, descricao, valor, vencimento, pago, pago_em, competencia, bank_transaction_id) VALUES
        (1, 'receita', 'PIX RECEBIDO', 8000, '2026-05-20', true, '2026-05-20 12:00', '2026-05', 1);`);
    await emitida(1, "2026-05-10", R$(8_000)); // avaliação: origem fora do BPO
    await emitida(1, "2026-08-10", R$(3_000)); // sem recebimento de mesmo valor → conta
    const r = await calcular(await rascunho(1, 101));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.rbt12.centavos).toBe(R$(11_000));
    expect(r.receita).toEqual({ completo: true, notasEmitidas: R$(11_000), bpo: 0 });
    expect(r.avisos.join(" ")).toMatch(/casada/);
  });

  it("transferência entre contas da MESMA empresa (os dois lados marcados) não infla o RBT12", async () => {
    await pg.exec(`${contas}
      INSERT INTO bank_transactions (id, account_id, tipo, valor, data, descricao, categoria) VALUES
        (1, 1, 'debito', -50000, '2026-06-10 12:00', 'TED ENVIADA', 'Transferência interna'),
        (2, 2, 'credito', 50000, '2026-06-10 13:00', 'TED RECEBIDA', 'Transferência interna'),
        (3, 1, 'credito', 7000, '2026-06-11 12:00', 'PIX RECEBIDO', NULL);
      INSERT INTO bpo_lancamentos (id, tipo, descricao, valor, vencimento, pago, pago_em, competencia, bank_transaction_id) VALUES
        (1, 'honorario', 'PIX RECEBIDO', 7000, '2026-06-11', true, '2026-06-11 12:00', '2026-06', 3);`);
    const r = await calcular(await rascunho(1, 101));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.receita).toEqual({ completo: true, notasEmitidas: 0, bpo: R$(7_000) });
  });

  it("lançamento editado para baixo não tira do RBT12 o que o banco recebeu (a diferença entra, com aviso)", async () => {
    await pg.exec(`${contas}
      INSERT INTO bank_transactions (id, account_id, tipo, valor, data, descricao) VALUES (1, 1, 'credito', 10000, '2026-04-10 12:00', 'PIX RECEBIDO');
      INSERT INTO bpo_lancamentos (id, tipo, descricao, valor, vencimento, pago, pago_em, competencia, bank_transaction_id) VALUES
        (1, 'receita', 'PIX RECEBIDO', 100, '2026-04-10', true, '2026-04-10 12:00', '2026-04', 1);`);
    const r = await calcular(await rascunho(1, 101));
    if (!r.aplica) throw new Error("devia aplicar");
    expect(r.rbt12.centavos).toBe(R$(10_000));
    expect(r.avisos.join(" ")).toMatch(/diferença entre o extrato e o lançamento/);
  });
});
