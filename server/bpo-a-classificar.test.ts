// Pedido de 12/11 (noite) — BPO: aba "A classificar". Regras puras + banco em memória (PGlite) com as
// migrações do BPO (inclui 0103). Nenhum teste toca banco real nem APIs externas.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste" } }));

import { getDb } from "./db.js";
import { bpoRouter } from "./bpo-router.js";
import { gravarMovimentos } from "./bancos.js";
import { reprocessarMovimentacoes, salvarRegraTitular } from "./bpo-extrato.js";
import { sincronizarCobrancasAsaas } from "./bpo-asaas.js";
import { receitaEmAbertoDoContaAzul } from "../shared/financeiro/conta-azul.js";
import { sentidoCompativel, sugestoesDeBaixa } from "../shared/financeiro/bpo-a-classificar.js";
import { centrosDoLancamento, centrosUsados, chaveCentro, lancamentoNoCentro, renomearCentroNoTexto } from "../shared/financeiro/centros-custo.js";

const sqlDe = (arquivo: string) => readFileSync(new URL(`../drizzle/${arquivo}`, import.meta.url), "utf8");

const BASE_BPO = `
  CREATE TYPE bpo_client_status AS ENUM ('ativo','pausado','encerrado');
  CREATE TYPE bpo_lancamento_tipo AS ENUM ('honorario','despesa','reembolso');
  CREATE TYPE bank_transaction_tipo AS ENUM ('credito','debito');
  CREATE TYPE bank_transaction_status AS ENUM ('pendente','conciliado','ignorado');
  CREATE TABLE leads (id serial PRIMARY KEY, name varchar(255) NOT NULL, phone varchar(20) NOT NULL, email varchar(320), cpf varchar(14), deleted_at timestamp);
  CREATE TABLE users (id serial PRIMARY KEY, name text);
  CREATE TABLE bpo_clients (
    id serial PRIMARY KEY, razao_social varchar(255) NOT NULL, cnpj varchar(20), cpf varchar(14),
    responsavel varchar(255) NOT NULL, email varchar(255), telefone varchar(20) NOT NULL,
    servicos text DEFAULT '[]' NOT NULL, status bpo_client_status DEFAULT 'ativo' NOT NULL,
    honorarios numeric(15,2) NOT NULL, dia_vencimento integer DEFAULT 10 NOT NULL, data_inicio timestamp NOT NULL,
    observacoes text DEFAULT '' NOT NULL, created_at timestamp DEFAULT now() NOT NULL, updated_at timestamp DEFAULT now() NOT NULL);
  CREATE TABLE bpo_lancamentos (
    id serial PRIMARY KEY, cliente_id integer REFERENCES bpo_clients(id) ON DELETE SET NULL, cliente_nome_livre varchar(255),
    tipo bpo_lancamento_tipo NOT NULL, descricao varchar(500) NOT NULL, valor numeric(15,2) NOT NULL, vencimento timestamp NOT NULL,
    pago boolean DEFAULT false NOT NULL, pago_em timestamp, competencia varchar(7) NOT NULL, centro_custos varchar(100),
    created_at timestamp DEFAULT now() NOT NULL);
  CREATE TABLE bank_accounts (id serial PRIMARY KEY, banco varchar(255) NOT NULL, conta varchar(30) NOT NULL DEFAULT '—',
    provedor varchar(20) DEFAULT 'manual' NOT NULL, ativo boolean DEFAULT true NOT NULL, saldo_atual numeric(15,2), saldo_fonte varchar(20));
  CREATE TABLE bank_transactions (
    id serial PRIMARY KEY, account_id integer NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE, data timestamp NOT NULL,
    descricao varchar(500) NOT NULL, valor numeric(15,2) NOT NULL, tipo bank_transaction_tipo NOT NULL, categoria varchar(100),
    status bank_transaction_status DEFAULT 'pendente' NOT NULL, external_id varchar(255) UNIQUE, origem varchar(20) DEFAULT 'manual' NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL);
`;

/** Banco em memória com as migrações do BPO até a 0103 (mesma ordem dos demais testes). */
async function bancoBpo() {
  const pg = new PGlite();
  await pg.exec(BASE_BPO);
  for (const f of ["0072_bpo_extrato.sql", "0075_bpo_titular_clientes.sql", "0077_banco_identificador_pluggy_v2.sql", "0080_bpo_vinculos_operacionais.sql",
    "0081_bpo_exclusao_edicao_auditavel.sql", "0082_bpo_request_key.sql", "0083_bpo_recebimentos_parciais.sql", "0095_bpo_lote3.sql",
    "0097_bpo_restaurar_exclusoes.sql"]) await pg.exec(sqlDe(f));
  await pg.exec(`
    CREATE TABLE obra_movimentos (id serial PRIMARY KEY, bpo_lancamento_id integer REFERENCES bpo_lancamentos(id) ON DELETE RESTRICT, status varchar(12) DEFAULT 'confirmado', valor numeric(15,2) DEFAULT 1);
    CREATE TABLE regularizacao_recebimentos (id serial PRIMARY KEY, bpo_lancamento_id integer REFERENCES bpo_lancamentos(id) ON DELETE RESTRICT, status varchar(12) DEFAULT 'confirmado', valor numeric(15,2) DEFAULT 1);
    INSERT INTO users (name) VALUES ('Admin');
    INSERT INTO bank_accounts (banco, provedor) VALUES ('C6', 'manual'), ('Asaas', 'asaas');`);
  await pg.exec(sqlDe("0099_bpo_limpeza_ajustes.sql"));
  await pg.exec(sqlDe("0103_bpo_a_classificar.sql"));
  await pg.exec(sqlDe("0103_bpo_a_classificar.sql")); // idempotente
  await pg.exec(sqlDe("0104_bpo_centros_custo.sql"));
  return pg;
}

let pg: PGlite;
const linhas = async <T = Record<string, unknown>>(q: string) => (await pg.query<T>(q)).rows;
const admin = () => bpoRouter.createCaller({ user: { id: 1, role: "admin", active: true }, req: {}, res: {} } as never);
const conta = { id: 1, dataInicial: null };

beforeEach(async () => {
  pg = await bancoBpo();
  vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
});
afterEach(async () => { await pg.close(); });

describe("regras puras", () => {
  it("sentido: crédito baixa cobrança (receita/honorário/reembolso), débito baixa despesa", () => {
    expect(sentidoCompativel("credito", "receita")).toBe(true);
    expect(sentidoCompativel("credito", "honorario")).toBe(true);
    expect(sentidoCompativel("credito", "despesa")).toBe(false);
    expect(sentidoCompativel("debito", "despesa")).toBe(true);
    expect(sentidoCompativel("debito", "reembolso")).toBe(false);
  });

  it("sugestões: mesmo valor (data mais próxima) primeiro, depois mesmo cliente/titular; no máximo 5", () => {
    const base = { tipo: "receita", pago: false, valorRecebido: "0", clienteNome: null as string | null };
    const abertos = [
      { ...base, id: 1, valor: "100.00", vencimento: "2026-03-20", clienteId: null },
      { ...base, id: 2, valor: "100.00", vencimento: "2026-03-06", clienteId: null },
      { ...base, id: 3, valor: "250.00", vencimento: "2026-01-01", clienteId: 7 },
      { ...base, id: 4, valor: "300.00", vencimento: "2026-01-01", clienteId: null, clienteNome: "Maria Teste" },
      { ...base, id: 5, valor: "100.00", vencimento: "2026-03-05", clienteId: null, tipo: "despesa" }, // outro sentido
      { ...base, id: 6, valor: "100.00", vencimento: "2026-03-05", clienteId: null, pago: true }, // já pago
      { ...base, id: 7, valor: "180.00", valorRecebido: "80.00", vencimento: "2026-02-01", clienteId: null }, // saldo 100
      { ...base, id: 8, valor: "999.00", vencimento: "2026-03-05", clienteId: null },
    ];
    const r = sugestoesDeBaixa({ id: 1, tipo: "credito", valor: 100, data: "2026-03-05", bpoClienteId: 7, titular: "MARIA TESTE" }, abertos);
    expect(r.map(l => l.id)).toEqual([2, 1, 7, 3, 4]);
    expect(sugestoesDeBaixa({ id: 1, tipo: "credito", valor: 100, data: "2026-03-05" }, abertos, 2).map(l => l.id)).toEqual([2, 1]);
  });

  it("Asaas em aberto ↔ Conta Azul em aberto só com o mesmo cliente, mesmo valor, vencimento a até 3 dias e candidato único", () => {
    const c = (id: number, extra = {}) => ({ id, tipo: "receita", valor: "500.00", pago: false, pagoEm: null, vencimento: "2026-12-10", clienteId: 3, ...extra });
    expect(receitaEmAbertoDoContaAzul({ clienteId: 3, valor: "500.00", vencimento: new Date("2026-12-12T12:00:00Z") }, [c(1)])).toBe(1);
    expect(receitaEmAbertoDoContaAzul({ clienteId: null, valor: "500.00", vencimento: "2026-12-10" }, [c(1)])).toBeNull();
    expect(receitaEmAbertoDoContaAzul({ clienteId: 4, valor: "500.00", vencimento: "2026-12-10" }, [c(1)])).toBeNull();
    expect(receitaEmAbertoDoContaAzul({ clienteId: 3, valor: "500.00", vencimento: "2026-12-20" }, [c(1)])).toBeNull();
    expect(receitaEmAbertoDoContaAzul({ clienteId: 3, valor: "500.00", vencimento: "2026-12-10" }, [c(1), c(2)])).toBeNull(); // ambíguo
    expect(receitaEmAbertoDoContaAzul({ clienteId: 3, valor: "500.00", vencimento: "2026-12-10" }, [c(1, { pago: true })])).toBeNull();
  });
});

describe("movimentação nova do banco", () => {
  it("sem correspondência não cria lançamento, não entra no DRE e aparece em A classificar", async () => {
    const r = await gravarMovimentos(conta, [
      { externalId: "x1", data: "2026-10-01", descricao: "Pix recebido", valor: 1000, tipo: "credito", titular: "Fulano" },
      { externalId: "x2", data: "2026-10-02", descricao: "Tarifa pix", valor: 2.5, tipo: "debito" },
      { externalId: "x3", data: "2026-10-03", descricao: "Transferência entre contas", valor: 300, tipo: "debito" },
    ], "importacao");
    expect(r.novos).toBe(3);
    expect(await linhas("SELECT count(*)::int n FROM bpo_lancamentos")).toEqual([{ n: 0 }]);
    expect(await admin().dre()).toEqual([]);
    expect(await admin().lancamentos.list()).toEqual([]);
    const movs = await admin().aClassificar.movimentacoes();
    expect(movs.map(m => [m.descricao, m.valor, m.conta])).toEqual([["Tarifa pix", "2.50", "C6"], ["Pix recebido", "1000.00", "C6"]]);
    expect(await admin().aClassificar.contagem()).toEqual({ movimentacoes: 2, lancamentos: 0, total: 2 });
    // transferência interna: nem lançamento nem A classificar
    expect(await linhas("SELECT a_classificar FROM bank_transactions WHERE external_id = 'x3'")).toEqual([{ a_classificar: false }]);
  });

  it("regra do titular (com categoria) cria o lançamento na hora", async () => {
    await salvarRegraTitular("Depósito Bom Preço", { categoria: "Material" });
    await gravarMovimentos(conta, [{ externalId: "r1", data: "2026-10-01", descricao: "Pix enviado", valor: 80, tipo: "debito", titular: "DEPOSITO BOM PRECO" }], "importacao");
    expect(await linhas("SELECT l.tipo, l.categoria, l.pago, t.a_classificar FROM bpo_lancamentos l JOIN bank_transactions t ON t.id = l.bank_transaction_id"))
      .toEqual([{ tipo: "despesa", categoria: "Material", pago: true, a_classificar: false }]);
    // regra só com cliente (sem categoria) não basta
    await pg.exec("INSERT INTO bpo_clients (razao_social, responsavel, telefone, honorarios, data_inicio) VALUES ('Cliente Y','x','',0,now())");
    await salvarRegraTitular("Cliente Y", { bpoClienteId: 1 });
    await gravarMovimentos(conta, [{ externalId: "r2", data: "2026-10-02", descricao: "Pix recebido", valor: 50, tipo: "credito", titular: "Cliente Y" }], "importacao");
    expect(await linhas("SELECT bpo_cliente_id, a_classificar FROM bank_transactions WHERE external_id = 'r2'")).toEqual([{ bpo_cliente_id: 1, a_classificar: true }]);
  });

  it("criar lançamento (individual/lote) classifica, grava o centro de custo e limpa a flag; ignorar tira sem lançamento", async () => {
    await pg.exec("INSERT INTO bpo_clients (razao_social, responsavel, telefone, honorarios, data_inicio) VALUES ('Cliente Z','x','',0,now())");
    await gravarMovimentos(conta, [
      { externalId: "c1", data: "2026-10-01", descricao: "Pix recebido", valor: 400, tipo: "credito" },
      { externalId: "c2", data: "2026-10-02", descricao: "Pix recebido", valor: 600, tipo: "credito" },
      { externalId: "c3", data: "2026-10-03", descricao: "Pix enviado", valor: 70, tipo: "debito" },
    ], "importacao");
    expect(await admin().aClassificar.criarLancamentos({ ids: [1, 2], categoria: "Recebimento de cliente", bpoClienteId: 1, centroCustos: "Obra Centro" })).toEqual({ classificadas: 2 });
    expect(await linhas("SELECT bank_transaction_id bt, tipo, categoria, cliente_id, centro_custos, pago FROM bpo_lancamentos ORDER BY bank_transaction_id")).toEqual([
      { bt: 1, tipo: "receita", categoria: "Recebimento de cliente", cliente_id: 1, centro_custos: "Obra Centro", pago: true },
      { bt: 2, tipo: "receita", categoria: "Recebimento de cliente", cliente_id: 1, centro_custos: "Obra Centro", pago: true },
    ]);
    expect((await admin().dre()).map(r => [r.competencia, r.cobrancas, r.despesas])).toEqual([["2026-10", 1000, 0]]);
    expect(await admin().aClassificar.ignorar({ ids: [3] })).toEqual({ ignoradas: 1 });
    expect(await linhas("SELECT id, a_classificar, categoria FROM bank_transactions ORDER BY id")).toEqual([
      { id: 1, a_classificar: false, categoria: "Recebimento de cliente" }, { id: 2, a_classificar: false, categoria: "Recebimento de cliente" },
      { id: 3, a_classificar: false, categoria: "Transferência interna" },
    ]);
    expect(await linhas("SELECT count(*)::int n FROM bpo_lancamentos")).toEqual([{ n: 2 }]);
    // repetir não age sobre o que já saiu de A classificar
    await expect(admin().aClassificar.criarLancamentos({ ids: [1], categoria: "Outros" })).rejects.toThrow(/Atualize a tela/);
    await expect(admin().aClassificar.criarLancamentos({ ids: [3], categoria: "Transferência interna" as never })).rejects.toThrow();
  });

  it("reprocessar não cria lançamento para movimentação A classificar (e cria para as antigas, como antes)", async () => {
    await gravarMovimentos(conta, [{ externalId: "p1", data: "2026-10-01", descricao: "Pix recebido", valor: 10, tipo: "credito" }], "importacao");
    // movimentação antiga (de antes da regra nova): sem flag e sem lançamento
    await pg.exec("INSERT INTO bank_transactions (account_id, data, descricao, valor, tipo) VALUES (1, '2026-09-01 12:00', 'Pix antigo', 20, 'credito')");
    const r = await reprocessarMovimentacoes();
    expect(r.lancamentosCriados).toBe(1);
    expect(await linhas("SELECT t.descricao, l.id IS NOT NULL tem, t.a_classificar FROM bank_transactions t LEFT JOIN bpo_lancamentos l ON l.bank_transaction_id = t.id ORDER BY t.id"))
      .toEqual([{ descricao: "Pix recebido", tem: false, a_classificar: true }, { descricao: "Pix antigo", tem: true, a_classificar: false }]);
    expect((await reprocessarMovimentacoes()).lancamentosCriados).toBe(0);
  });
});

describe("lançamentos em aberto a classificar", () => {
  const inserir = (extra = "") => pg.exec(`INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, competencia, origem_efetiva, a_classificar, cliente_id)
    VALUES ('receita','Honorários CA',300,'2026-10-10','2026-10','conta_azul',true,1), ('despesa','Aluguel CA',900,'2026-10-05','2026-10','conta_azul',true,null),
      ('receita','Já confirmado',100,'2026-10-10','2026-10','manual',false,1) ${extra}`);

  beforeEach(async () => {
    await pg.exec("INSERT INTO bpo_clients (razao_social, responsavel, telefone, honorarios, data_inicio) VALUES ('Cliente Z','x','',0,now())");
  });

  it("ficam fora de Cobranças, Despesas, DRE e totais por cliente; Confirmar traz de volta (com histórico)", async () => {
    await inserir();
    expect((await admin().lancamentos.list()).map(l => l.descricao)).toEqual(["Já confirmado"]);
    expect((await admin().dre()).map(r => [r.cobrancas, r.despesas])).toEqual([[100, 0]]);
    expect(await admin().dreCategorias()).toEqual([expect.objectContaining({ entradas: 100, saidas: 0 })]);
    expect((await admin().clientes.list())[0]).toMatchObject({ totalEmAberto: 100 });
    expect((await admin().aClassificar.lancamentos()).map(l => [l.descricao, l.clienteNome])).toEqual([["Aluguel CA", null], ["Honorários CA", "Cliente Z"]]);
    expect(await admin().lancamentos.previaExclusao({ aba: "cobrancas", modo: "tudo" })).toMatchObject({ totalAba: 1 });

    expect(await admin().aClassificar.confirmar({ ids: [1, 2] })).toEqual({ confirmados: 2 });
    expect((await admin().lancamentos.list()).map(l => l.descricao).sort()).toEqual(["Aluguel CA", "Honorários CA", "Já confirmado"]);
    expect((await admin().dre()).map(r => [r.cobrancas, r.despesas])).toEqual([[400, 900]]);
    expect((await admin().clientes.list())[0]).toMatchObject({ totalEmAberto: 400 });
    expect(await linhas("SELECT lancamento_id, motivo FROM bpo_lancamento_historico ORDER BY lancamento_id")).toEqual([
      { lancamento_id: 1, motivo: "Confirmado na aba A classificar" }, { lancamento_id: 2, motivo: "Confirmado na aba A classificar" },
    ]);
    // repetir não muda nada
    expect(await admin().aClassificar.confirmar({ ids: [1, 2] })).toEqual({ confirmados: 0 });
  });

  it("registrar recebimento (fluxo existente) tira da aba e leva para Cobranças", async () => {
    await inserir();
    await admin().lancamentos.receber({ id: 1, requestKey: "0d1f3c51-9b51-4b8e-8f3c-6a4bb1d4a001", valor: 100, recebidoEm: "2026-10-12" });
    expect(await linhas("SELECT valor_recebido::text vr, pago, a_classificar FROM bpo_lancamentos WHERE id = 1")).toEqual([{ vr: "100.00", pago: false, a_classificar: false }]);
    await pg.exec("INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, competencia, origem_efetiva, a_classificar) VALUES ('receita','Outra CA',50,'2026-10-10','2026-10','conta_azul',true)");
    await admin().lancamentos.marcarPago({ id: 4 });
    expect(await linhas("SELECT pago, a_classificar FROM bpo_lancamentos WHERE id = 4")).toEqual([{ pago: true, a_classificar: false }]);
    // (a despesa "Marcar pago" usa db.marcarBpoLancamentoPago, que também limpa a flag; a baixa de despesa pelo banco está nos testes da divisão)
    expect(await admin().aClassificar.contagem()).toMatchObject({ lancamentos: 1 });
  });

  it("Cancelar arquiva (reversível, com backup) e Restaurar devolve para A classificar", async () => {
    await inserir();
    const previa = await admin().lancamentos.previaExclusao({ aba: "a_classificar", modo: "selecionados", ids: [1], limpezaAjustes: true });
    expect(previa).toMatchObject({ totalAba: 2, excluiveis: 1 });
    const r = await admin().lancamentos.excluirLote({ aba: "a_classificar", modo: "selecionados", ids: [1], limpezaAjustes: true, previaToken: previa.previaToken, confirmacao: "EXCLUIR" });
    expect(r).toMatchObject({ excluidos: 1 });
    expect(await linhas("SELECT id, exclusao_lote_backup_id IS NOT NULL arquivado FROM bpo_lancamentos ORDER BY id")).toEqual([
      { id: 1, arquivado: true }, { id: 2, arquivado: false }, { id: 3, arquivado: false },
    ]);
    expect((await admin().aClassificar.lancamentos()).map(l => l.id)).toEqual([2]);
    // o lote "cobrancas" não alcança os A classificar
    expect(await admin().lancamentos.previaExclusao({ aba: "cobrancas", modo: "selecionados", ids: [2], limpezaAjustes: true })).toMatchObject({ excluiveis: 0 });
    await admin().lancamentos.restaurarExclusao({ backupId: r.backupId!, confirmacao: "RESTAURAR" });
    expect((await admin().aClassificar.lancamentos()).map(l => l.id)).toEqual([2, 1]);
  });
});

describe("importação do Conta Azul e Asaas", () => {
  const FIN = [
    "id,data,data_de_quitacao,valor,tipo,descricao,status,nome_do_negociador,id_do_evento,data_de_vencimento,data_de_competencia,data_de_pagamento_esperada,id_da_parcela,metodo_de_pagamento,conta_financeira,data_solicitacao_cobranca,categoria,centro_de_custo",
    "bbbbbbbb-0000-0000-0000-000000000001,2026-03-05,2026-03-05,1500.00,REVENUE,Honorários março,ACQUITTED,Maria Teste,e1,2026-03-05,2026-03-01,2026-03-05,p1,PIX,C6,,Receitas de Serviços,",
    "bbbbbbbb-0000-0000-0000-000000000002,2026-12-10,,500.00,REVENUE,Honorários dezembro,PENDING,Maria Teste,e2,2026-12-10,2026-12-01,2026-12-10,,,C6,,Receitas de Serviços,",
    "bbbbbbbb-0000-0000-0000-000000000003,2026-12-15,,700.00,REVENUE,Honorários extra,PENDING,Maria Teste,e3,2026-12-15,2026-12-01,2026-12-15,,,C6,,Receitas de Serviços,",
  ].join("\n");
  const PESSOAS = "tipo,nome,cpf_cnpj\nCliente,Maria Teste,11122233344";

  it("importador marca em aberto como A classificar (pago não)", async () => {
    await admin().contaAzul.importar({ arquivos: { "pessoas.csv": PESSOAS, "financeiro.csv": FIN } });
    expect(await linhas("SELECT valor::text v, pago, a_classificar ac FROM bpo_lancamentos ORDER BY valor")).toEqual([
      { v: "500.00", pago: false, ac: true }, { v: "700.00", pago: false, ac: true }, { v: "1500.00", pago: true, ac: false },
    ]);
    expect((await admin().lancamentos.list()).map(l => l.valor)).toEqual(["1500.00"]);
  });

  it("cobrança Asaas: em aberto assume a receita em aberto do mesmo cliente; paga não baixa a em aberto", async () => {
    await admin().contaAzul.importar({ arquivos: { "pessoas.csv": PESSOAS, "financeiro.csv": FIN } });
    const fetch = vi.fn((url: string) => Promise.resolve({
      ok: true, status: 200,
      json: async () => url.includes("/customers/") ? { name: "Maria Teste", cpfCnpj: "11122233344" }
        : { hasMore: false, data: [
          { id: "pay_aberta", status: "PENDING", value: 500, dueDate: "2026-12-11", customer: "cus_m" },
          { id: "pay_paga", status: "RECEIVED", value: 700, netValue: 700, dueDate: "2026-12-15", paymentDate: "2026-12-15", customer: "cus_m" },
        ] },
    } as Response));
    const r = await sincronizarCobrancasAsaas("$aact_teste", "2026-01-01", fetch as never);
    expect(r).toMatchObject({ criadas: 1, reconciliadas: 1 });
    expect(await linhas("SELECT valor::text v, origem_efetiva o, asaas_payment_id p, pago, a_classificar ac FROM bpo_lancamentos ORDER BY id")).toEqual([
      { v: "1500.00", o: "conta_azul", p: null, pago: true, ac: false },
      { v: "500.00", o: "conta_azul", p: "pay_aberta", pago: false, ac: false }, // mesma cobrança: assume o id, status não muda
      { v: "700.00", o: "conta_azul", p: null, pago: false, ac: true }, // em aberto não é baixado sozinho
      { v: "700.00", o: "manual", p: "pay_paga", pago: true, ac: false },
    ]);
  });

  it("crédito do Asaas que chegou antes da cobrança fica A classificar e a cobrança paga o assume (sem duplicar)", async () => {
    await gravarMovimentos({ id: 2, dataInicial: null }, [
      { externalId: "asaas:1", data: "2026-10-05", descricao: "Cobrança recebida", valor: 498.01, tipo: "credito", asaasPaymentId: "pay_x" },
    ], "asaas");
    expect(await linhas("SELECT a_classificar FROM bank_transactions")).toEqual([{ a_classificar: true }]);
    const fetch = vi.fn((url: string) => Promise.resolve({
      ok: true, status: 200,
      json: async () => url.includes("/customers/") ? { name: "Ana", cpfCnpj: "" }
        : { hasMore: false, data: [{ id: "pay_x", status: "RECEIVED", value: 500, netValue: 498.01, dueDate: "2026-10-05", paymentDate: "2026-10-05", customer: "cus_a" }] },
    } as Response));
    await sincronizarCobrancasAsaas("$aact_teste", "2026-01-01", fetch as never);
    await sincronizarCobrancasAsaas("$aact_teste", "2026-01-01", fetch as never);
    expect(await linhas("SELECT asaas_payment_id p, bank_transaction_id bt, valor::text v, pago FROM bpo_lancamentos")).toEqual([{ p: "pay_x", bt: 1, v: "498.01", pago: true }]);
    expect(await linhas("SELECT a_classificar FROM bank_transactions")).toEqual([{ a_classificar: false }]);
  });
});

describe("dividir pagamentos (bloco 2)", () => {
  // 1: receita 300 (A classificar, do Conta Azul) · 2: receita 200 · 3: despesa 900 (A classificar) · 4: receita Asaas · 5: receita combinada
  beforeEach(async () => {
    await pg.exec(`INSERT INTO bpo_clients (razao_social, responsavel, telefone, honorarios, data_inicio) VALUES ('Cliente Z','x','',0,now());
      INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, competencia, origem_efetiva, a_classificar, cliente_id, asaas_payment_id) VALUES
      ('receita','Honorários out',300,'2026-10-10','2026-10','conta_azul',true,1,null),
      ('receita','Projeto',200,'2026-10-12','2026-10','manual',false,1,null),
      ('despesa','Aluguel',900,'2026-10-05','2026-10','conta_azul',true,null,null),
      ('receita','Asaas',100,'2026-10-10','2026-10','manual',false,1,'pay_1'),
      ('receita','Combinada',100,'2026-10-10','2026-10','manual',false,1,null);
      UPDATE bpo_lancamentos SET combinada_em_id = 2 WHERE id = 5;`);
    await gravarMovimentos(conta, [
      { externalId: "s1", data: "2026-10-11", descricao: "Pix recebido", valor: 500, tipo: "credito", titular: "Cliente Z" },
      { externalId: "s2", data: "2026-10-06", descricao: "Pix enviado", valor: 400, tipo: "debito" },
      { externalId: "s3", data: "2026-10-20", descricao: "Pix enviado", valor: 500, tipo: "debito" },
      { externalId: "s4", data: "2026-10-21", descricao: "Pix recebido", valor: 50, tipo: "credito" },
    ], "importacao");
  });
  const baixa = (movimentacaoId: number, alocacoes: { lancamentoId: number; valor: number }[]) => admin().aClassificar.darBaixa({ movimentacaoId, alocacoes });
  const estado = () => linhas("SELECT id, valor_recebido::text vr, pago, to_char(pago_em,'YYYY-MM-DD') pe, a_classificar ac, version v FROM bpo_lancamentos WHERE id <= 3 ORDER BY id");

  it("sugestões de baixa: mesmo sentido e em aberto (inclui os A classificar), mesmo valor/cliente primeiro", async () => {
    const r = await admin().aClassificar.abertosParaBaixa({ movimentacaoId: 1 });
    expect(r.abertos.map(l => l.id)).toEqual([1, 2]); // sem despesa, Asaas, combinada
    expect(r.sugeridos).toEqual([1, 2]); // nenhum com o valor 500: mesmo cliente, vencimento mais próximo (empate: menor id)
    expect((await admin().aClassificar.abertosParaBaixa({ movimentacaoId: 2 })).abertos.map(l => l.id)).toEqual([3]);
  });

  it("1 → N: a soma tem que fechar exatamente e nenhum valor passa do saldo; depois quita os dois", async () => {
    await expect(baixa(1, [{ lancamentoId: 1, valor: 300 }, { lancamentoId: 2, valor: 199.99 }])).rejects.toThrow(/exatamente/);
    await expect(baixa(1, [{ lancamentoId: 1, valor: 300.01 }, { lancamentoId: 2, valor: 199.99 }])).rejects.toThrow(/passa do saldo/);
    await expect(baixa(1, [{ lancamentoId: 1, valor: 500 }])).rejects.toThrow(/passa do saldo/);
    await expect(baixa(1, [{ lancamentoId: 3, valor: 500 }])).rejects.toThrow(/outro sentido/);
    await expect(baixa(1, [{ lancamentoId: 4, valor: 100 }, { lancamentoId: 2, valor: 200 }, { lancamentoId: 1, valor: 200 }])).rejects.toThrow(/Asaas/);
    await expect(baixa(1, [{ lancamentoId: 5, valor: 100 }, { lancamentoId: 2, valor: 200 }, { lancamentoId: 1, valor: 200 }])).rejects.toThrow(/combinado/);
    await expect(baixa(1, [{ lancamentoId: 1, valor: 250 }, { lancamentoId: 1, valor: 250 }])).rejects.toThrow(/mais de uma vez/);
    expect(await linhas("SELECT count(*)::int n FROM bpo_recebimentos")).toEqual([{ n: 0 }]); // nada gravado nos erros

    const dreAntes = await admin().dre(); // Projeto 200 + Asaas 100 (o A classificar de 300 ainda fora)
    expect(dreAntes.map(r => r.cobrancas)).toEqual([300]);
    const r = await baixa(1, [{ lancamentoId: 1, valor: 300 }, { lancamentoId: 2, valor: 200 }]);
    expect(r).toMatchObject({ repetida: false, alocacoes: [{ lancamentoId: 1, valor: "300.00", pago: true, saldo: 0 }, { lancamentoId: 2, valor: "200.00", pago: true, saldo: 0 }] });
    expect(await estado()).toEqual([
      { id: 1, vr: "300.00", pago: true, pe: "2026-10-11", ac: false, v: 2 },
      { id: 2, vr: "200.00", pago: true, pe: "2026-10-11", ac: false, v: 2 },
      { id: 3, vr: "0.00", pago: false, pe: null, ac: true, v: 1 },
    ]);
    expect(await linhas("SELECT request_key k, bank_transaction_id bt, valor::text v FROM bpo_recebimentos ORDER BY id")).toEqual([
      { k: "bt:1:1", bt: 1, v: "300.00" }, { k: "bt:1:2", bt: 1, v: "200.00" },
    ]);
    expect(await linhas("SELECT a_classificar ac, status FROM bank_transactions WHERE id = 1")).toEqual([{ ac: false, status: "conciliado" }]);
    expect(await linhas("SELECT count(*)::int n FROM bpo_lancamento_historico")).toEqual([{ n: 2 }]);
    // sem dupla contagem: a movimentação não ganha lançamento próprio; DRE e totais contam só os lançamentos
    expect(await linhas("SELECT count(*)::int n FROM bpo_lancamentos WHERE bank_transaction_id IS NOT NULL")).toEqual([{ n: 0 }]);
    // DRE por competência: +300 (o lançamento saiu de A classificar), nada do valor da movimentação somado de novo
    expect((await admin().dre()).map(r => [r.cobrancas, r.despesas])).toEqual([[600, 0]]);
    expect((await admin().clientes.list())[0]).toMatchObject({ totalRecebido: 500, totalEmAberto: 100 }); // 100 = cobrança Asaas em aberto
    // reprocessar e reclassificar não criam lançamento para a movimentação que já deu baixa
    expect((await reprocessarMovimentacoes()).lancamentosCriados).toBe(0);
    await admin().aClassificar.criarLancamentos({ ids: [1], categoria: "Outros" }).catch(() => undefined);
    expect(await linhas("SELECT count(*)::int n FROM bpo_lancamentos WHERE bank_transaction_id = 1")).toEqual([{ n: 0 }]);
  });

  it("idempotente: repetir a mesma divisão não duplica; outra divisão da mesma movimentação é recusada", async () => {
    const a = [{ lancamentoId: 2, valor: 200 }, { lancamentoId: 1, valor: 300 }];
    await baixa(1, a);
    const de_novo = await baixa(1, [...a].reverse());
    expect(de_novo).toMatchObject({ repetida: true });
    await expect(baixa(1, [{ lancamentoId: 1, valor: 250 }, { lancamentoId: 2, valor: 250 }])).rejects.toThrow(/já foi usada/);
    expect(await linhas("SELECT count(*)::int n FROM bpo_recebimentos")).toEqual([{ n: 2 }]);
    expect(await linhas("SELECT valor_recebido::text vr FROM bpo_lancamentos WHERE id IN (1,2) ORDER BY id")).toEqual([{ vr: "300.00" }, { vr: "200.00" }]);
  });

  it("duas chamadas ao mesmo tempo: uma grava, a outra devolve a mesma baixa (sem duplicar)", async () => {
    const a = [{ lancamentoId: 3, valor: 400 }];
    const r = await Promise.all([baixa(2, a), baixa(2, a)]);
    expect(r.map(x => x.repetida).sort()).toEqual([false, true]);
    expect(await linhas("SELECT valor_recebido::text vr FROM bpo_lancamentos WHERE id = 3")).toEqual([{ vr: "400.00" }]);
  });

  it("N → 1 em despesa: pagamentos parciais acumulam e só quita quando fecha o valor", async () => {
    const r1 = await baixa(2, [{ lancamentoId: 3, valor: 400 }]);
    expect(r1.alocacoes[0]).toMatchObject({ pago: false, saldo: 500 });
    expect((await estado())[2]).toEqual({ id: 3, vr: "400.00", pago: false, pe: null, ac: false, v: 2 }); // perde a flag: vai para Despesas
    expect((await admin().lancamentos.list()).find(l => l.id === 3)).toMatchObject({ pago: false, valorRecebido: "400.00" });
    await expect(baixa(3, [{ lancamentoId: 3, valor: 500.01 }])).rejects.toThrow(); // soma ≠ movimento e acima do saldo
    const r2 = await baixa(3, [{ lancamentoId: 3, valor: 500 }]);
    expect(r2.alocacoes[0]).toMatchObject({ pago: true, saldo: 0 });
    expect((await estado())[2]).toEqual({ id: 3, vr: "900.00", pago: true, pe: "2026-10-20", ac: false, v: 3 });
    expect((await admin().dre()).map(r => r.despesas)).toEqual([900]);
    // lançamento já pago não recebe mais
    await expect(baixa(4, [{ lancamentoId: 3, valor: 50 }])).rejects.toThrow();
  });

  it("recusa movimentação que não está A classificar e lançamento já ligado 1:1 a outra movimentação", async () => {
    await admin().aClassificar.ignorar({ ids: [4] });
    await expect(baixa(4, [{ lancamentoId: 2, valor: 50 }])).rejects.toThrow(/não está em A classificar/);
    await pg.exec("UPDATE bpo_lancamentos SET bank_transaction_id = 4 WHERE id = 2");
    await expect(baixa(1, [{ lancamentoId: 2, valor: 200 }, { lancamentoId: 1, valor: 300 }])).rejects.toThrow(/já está ligado/);
  });
});

describe("centros de custo (bloco 3)", () => {
  it("regras: combinado \"A / B\" vale para os dois; comparação sem maiúsculas/acentos; renomear só a parte certa", () => {
    expect(centrosDoLancamento("Prospecta Maranhao / Prospecta Para")).toEqual(["Prospecta Maranhao", "Prospecta Para"]);
    expect(chaveCentro("  Prospecta  Pará ")).toBe("prospecta para");
    expect(lancamentoNoCentro("Prospecta Maranhao / Prospecta Para", "PROSPECTA PARÁ")).toBe(true);
    expect(lancamentoNoCentro("Prospecta Maranhao", "Prospecta Para")).toBe(false);
    expect(renomearCentroNoTexto("Prospecta Maranhao / Prospecta Para", "prospecta para", "Filial Belém")).toBe("Prospecta Maranhao / Filial Belém");
    expect(renomearCentroNoTexto("Obra X", "Obra Y", "Z")).toBeNull();
    expect(renomearCentroNoTexto("A / B", "B", "A")).toBe("A"); // juntar não duplica
    expect(() => renomearCentroNoTexto("A / B", "B", "x".repeat(99))).toThrow(/100 caracteres/);
    expect(centrosUsados([{ centroCustos: "B / a" }, { centroCustos: "A" }, { centroCustos: null }])).toEqual(["a", "B"]);
  });

  it("semente da 0104: separa os combinados, ignora maiúsculas/acentos repetidos e é idempotente (só insere)", async () => {
    await pg.exec(`INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, competencia, centro_custos) VALUES
      ('despesa','a',1,now(),'2026-10','Prospecta Maranhao / Prospecta Para'), ('despesa','b',1,now(),'2026-10','Prospecta Maranhao'),
      ('despesa','c',1,now(),'2026-10','prospecta pará'), ('despesa','d',1,now(),'2026-10',null), ('despesa','e',1,now(),'2026-10','Obra Centro');
      DROP TABLE bpo_centros_custo;`);
    await pg.exec(sqlDe("0104_bpo_centros_custo.sql"));
    await pg.exec("UPDATE bpo_centros_custo SET ativo = false WHERE nome = 'Obra Centro'");
    await pg.exec(sqlDe("0104_bpo_centros_custo.sql"));
    const nomes = (await linhas<{ nome: string; ativo: boolean }>("SELECT nome, ativo FROM bpo_centros_custo ORDER BY id"));
    expect(nomes).toHaveLength(3);
    expect(nomes.map(n => chaveCentro(n.nome)).sort()).toEqual(["obra centro", "prospecta maranhao", "prospecta para"]);
    expect(nomes.find(n => n.nome === "Obra Centro")?.ativo).toBe(false); // reaplicar não mexe no que existe
    await expect(pg.exec("INSERT INTO bpo_centros_custo (nome) VALUES ('OBRA CENTRO')")).rejects.toThrow();
  });

  it("criar, listar com uso, renomear (inclusive nos combinados) e desativar", async () => {
    await pg.exec(`INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, competencia, centro_custos) VALUES
      ('despesa','a',1,now(),'2026-10','Prospecta Maranhao / Prospecta Para'), ('despesa','b',1,now(),'2026-10','Prospecta Para'),
      ('despesa','c',1,now(),'2026-10','Outro')`);
    const para = await admin().centrosCusto.criar({ nome: "Prospecta Para" });
    await admin().centrosCusto.criar({ nome: "Prospecta Maranhao" });
    await expect(admin().centrosCusto.criar({ nome: "prospecta  pará" })).rejects.toThrow(/Já existe/);
    await expect(admin().centrosCusto.criar({ nome: "A/B" })).rejects.toThrow(/separador/);
    expect((await admin().centrosCusto.list()).map(c => [c.nome, c.lancamentos])).toEqual([["Prospecta Maranhao", 1], ["Prospecta Para", 2]]);
    await expect(admin().centrosCusto.renomear({ id: para.id, nome: "PROSPECTA MARANHÃO" })).rejects.toThrow(/Já existe/);
    expect(await admin().centrosCusto.renomear({ id: para.id, nome: "Filial Belém" })).toMatchObject({ lancamentos: 2, centro: { nome: "Filial Belém" } });
    expect(await linhas("SELECT centro_custos c FROM bpo_lancamentos ORDER BY id")).toEqual([
      { c: "Prospecta Maranhao / Filial Belém" }, { c: "Filial Belém" }, { c: "Outro" },
    ]);
    expect(await admin().centrosCusto.ativar({ id: para.id, ativo: false })).toMatchObject({ ativo: false });
  });

  it("+ Lançamento e edição gravam o centro de custo", async () => {
    const criado = await admin().lancamentos.create({
      requestKey: "6c9b1d1e-1111-4a4a-9b9b-000000000001", tipo: "despesa", descricao: "Cimento", valor: 50, vencimento: "2026-10-10",
      competencia: "2026-10", categoriaOperacional: "administrativo", centroCustos: "Obra Centro",
    });
    expect(criado.centroCustos).toBe("Obra Centro");
    await admin().lancamentos.editar({ id: criado.id, version: criado.version, motivo: "ajuste", descricao: "Cimento", valor: 50, vencimento: "2026-10-10", competencia: "2026-10", centroCustos: "Obra Norte" });
    expect(await linhas("SELECT centro_custos c FROM bpo_lancamentos")).toEqual([{ c: "Obra Norte" }]);
  });
});
