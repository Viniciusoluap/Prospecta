// Pedido de 12/11: importação do backup ZIP do Conta Azul Pro no BPO Financeiro.
// CSVs sintéticos no formato real do backup (nenhum dado de cliente no repositório) e banco em memória (PGlite)
// com as mesmas migrações do BPO usadas pelos demais testes.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste" } }));

import { getDb } from "./db.js";
import { bpoRouter } from "./bpo-router.js";
import {
  categoriaDoContaAzul, dataContaAzul, lerBackupContaAzul, parseCsv, valorContaAzul,
} from "../shared/financeiro/conta-azul.js";

const sqlDe = (arquivo: string) => readFileSync(new URL(`../drizzle/${arquivo}`, import.meta.url), "utf8");

const PESSOAS = [
  "tipo,nome,endereco,tipo_pessoa,fone_comercial,fone_celular,cep,cidade,email,cpf_cnpj,inscricao_estadual,bairro,complemento,numero,isento_icms,razao_social,id_empresa,fl_ativo",
  'Cliente,Maria Teste,"Rua A, 10",F,,99999990000,65900-000,Imperatriz,maria@exemplo.com,11122233344,,,,,,,1,true',
  "Cliente,Construtora Exemplo,,J,9933330000,,,,,11222333000144,,,,,,Construtora Exemplo LTDA,1,true",
  "Fornecedor,Depósito Exemplo,,J,,,,,,55666777000188,,,,,,,1,true",
  "Vendedor,Vendedor Exemplo,,F,,,,,,,,,,,,,1,true",
].join("\n");

const CAB_FIN = "id,data,data_de_quitacao,valor,tipo,descricao,status,nome_do_negociador,id_do_evento,data_de_vencimento,data_de_competencia,data_de_pagamento_esperada,id_da_parcela,metodo_de_pagamento,conta_financeira,data_solicitacao_cobranca,categoria,centro_de_custo";
const FINANCEIRO = [
  CAB_FIN,
  // receita paga
  "aaaaaaaa-0000-0000-0000-000000000001,2026-03-05,2026-03-05,1500.00,REVENUE,\"Honorários março, parcela 1\",ACQUITTED,Maria Teste,e1,2026-03-05,2026-03-01,2026-03-05,p1,INSTANT_PAYMENT,C6 - Conta Corrente,,Receitas de Serviços,Prospecta Maranhao",
  // despesa em aberto de fornecedor
  "aaaaaaaa-0000-0000-0000-000000000002,2026-04-10,,320.50,EXPENSE,Cimento e areia,PENDING,Depósito Exemplo,e2,2026-04-10,2026-04-01,2026-04-10,,,Inter - Conta Corrente,,Materiais de Construção,",
  // mesma linha repetida em dois centros de custo, mesmo valor: entra uma vez
  "aaaaaaaa-0000-0000-0000-000000000003,2026-04-15,2026-04-15,709.00,EXPENSE,Contador,ACQUITTED,,e3,2026-04-15,2026-04-01,2026-04-15,p3,OTHER,C6 - Conta Corrente,,Honorários Contábeis,Prospecta Maranhao",
  "aaaaaaaa-0000-0000-0000-000000000003,2026-04-15,2026-04-15,709.00,EXPENSE,Contador,ACQUITTED,,e3,2026-04-15,2026-04-01,2026-04-15,p3,OTHER,C6 - Conta Corrente,,Honorários Contábeis,Prospecta Para",
  // mesmo id com outra categoria e outro valor: é outra parte do lançamento (entra)
  "aaaaaaaa-0000-0000-0000-000000000003,2026-04-15,2026-04-15,90.00,EXPENSE,Contador,ACQUITTED,,e3,2026-04-15,2026-04-01,2026-04-15,p3,OTHER,C6 - Conta Corrente,,Tarifa de Cobrança,",
  // transferência entre empresas do grupo: fora do resultado
  "aaaaaaaa-0000-0000-0000-000000000004,2026-04-20,2026-04-20,5000.00,EXPENSE,Repasse,ACQUITTED,,e4,2026-04-20,2026-04-01,2026-04-20,p4,BANKING_TRANSFER,C6 - Conta Corrente,,(-) Transferência Entre Empresas do Grupo - Efficaz,",
  // linha inválida
  "aaaaaaaa-0000-0000-0000-000000000005,2026-04-21,,abc,EXPENSE,Ruim,PENDING,,e5,2026-04-21,2026-04-01,2026-04-21,,,,,Aluguel,",
].join("\r\n");

const BACKUP = { "pessoas.csv": PESSOAS, "financeiro.csv": FINANCEIRO, "produtos.csv": "nome,codigo\nCasa,1\n" };

describe("leitura do backup do Conta Azul", () => {
  it("CSV com aspas, vírgula e quebra dentro do campo, BOM e CRLF", () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","linha\num ""aspas"""\r\n')).toEqual([["a", "b"], ["x, y", 'linha\num "aspas"']]);
  });
  it("valores e datas no formato do backup (e o brasileiro, por garantia)", () => {
    expect(valorContaAzul("1234.5")).toBe("1234.50");
    expect(valorContaAzul("1.234,56")).toBe("1234.56");
    expect(valorContaAzul("-10")).toBeNull();
    expect(dataContaAzul("2026-02-30")).toBeNull();
    expect(dataContaAzul("05/03/2026")).toBe("2026-03-05");
  });
  it("a categoria do Conta Azul manda; transferência entre empresas fica fora", () => {
    expect(categoriaDoContaAzul("Pró-labore", "", "despesa")).toBe("Pró-labore");
    expect(categoriaDoContaAzul("Mão de obra", "medição caixa", "despesa")).toBe("Mão de obra");
    expect(categoriaDoContaAzul("Receitas de Serviços", "", "receita")).toBe("Recebimento de cliente");
    expect(categoriaDoContaAzul("Aporte de Capital", "", "receita")).toBe("Outros");
    expect(categoriaDoContaAzul("Despesas a identificar", "tarifa pix", "despesa")).toBe("Tarifas bancárias");
    expect(categoriaDoContaAzul("Tarifas de Notificação", "", "despesa")).toBe("Tarifas bancárias");
    expect(categoriaDoContaAzul("Multas de Trânsito", "", "despesa")).toBe("Administrativo");
    expect(categoriaDoContaAzul("(+) Empréstimo entre empresas do grupo", "", "receita")).toBe("Transferência interna");
  });
  it("lê pessoas e financeiro, junta a linha repetida por centro de custo e lista o que fica de fora", () => {
    const b = lerBackupContaAzul(BACKUP);
    expect(b.pessoas.map(p => [p.papel, p.cpf ?? p.cnpj])).toEqual([["Cliente", "11122233344"], ["Cliente", "11222333000144"], ["Fornecedor", "55666777000188"], ["Vendedor", null]]);
    expect(b.movimentos).toHaveLength(4);
    const contador = b.movimentos.find(m => m.valor === "709.00")!;
    expect(contador.centrosCusto).toEqual(["Prospecta Maranhao", "Prospecta Para"]);
    expect(b.repetidasPorCentro).toBe(1);
    expect(b.transferencias).toEqual({ quantidade: 1, total: "5000.00" });
    expect(b.erros).toEqual([expect.stringMatching(/linha 8: valor "abc" inválido/)]);
    expect(b.outrosArquivos).toEqual([{ arquivo: "produtos.csv", linhas: 1 }]);
    expect(new Set(b.movimentos.map(m => m.chave)).size).toBe(4);
    // a chave não depende da ordem das linhas no arquivo
    const invertido = lerBackupContaAzul({ ...BACKUP, "financeiro.csv": [CAB_FIN, ...FINANCEIRO.split("\r\n").slice(1).reverse()].join("\n") });
    expect(invertido.movimentos.map(m => m.chave).sort()).toEqual(b.movimentos.map(m => m.chave).sort());
  });
  it("arquivo que não é backup do Conta Azul", () => {
    expect(lerBackupContaAzul({ "outro.csv": "a,b\n1,2" }).erros[0]).toMatch(/não parece um backup/);
    expect(lerBackupContaAzul({ "financeiro.csv": "id,valor\n1,2" }).erros[0]).toMatch(/sem as colunas/);
  });
});

const ANTES_0075 = `
  CREATE TYPE bpo_client_status AS ENUM ('ativo','pausado','encerrado');
  CREATE TYPE bpo_lancamento_tipo AS ENUM ('honorario','despesa','reembolso');
  CREATE TYPE bank_transaction_tipo AS ENUM ('credito','debito');
  CREATE TYPE bank_transaction_status AS ENUM ('pendente','conciliado','ignorado');
  CREATE TABLE leads (id serial PRIMARY KEY, name varchar(255) NOT NULL, phone varchar(20) NOT NULL, email varchar(320),
    cpf varchar(14), deleted_at timestamp);
  CREATE TABLE users (id serial PRIMARY KEY);
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
    provedor varchar(20) DEFAULT 'manual' NOT NULL, ativo boolean DEFAULT true NOT NULL);
  CREATE TABLE bank_transactions (
    id serial PRIMARY KEY, account_id integer NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE, data timestamp NOT NULL,
    descricao varchar(500) NOT NULL, valor numeric(15,2) NOT NULL, tipo bank_transaction_tipo NOT NULL, categoria varchar(100),
    status bank_transaction_status DEFAULT 'pendente' NOT NULL, external_id varchar(255) UNIQUE, origem varchar(20) DEFAULT 'manual' NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL);
  CREATE TABLE regularizacoes (
    id serial PRIMARY KEY, client_name varchar(255) NOT NULL, client_phone varchar(30), type varchar(120) NOT NULL,
    status varchar(40) DEFAULT 'em_analise' NOT NULL, legacy_status varchar(40), address text NOT NULL, registration varchar(120),
    registry_office varchar(255), responsible varchar(120) NOT NULL, lead_id integer, lead_service_id integer,
    service_value numeric(15,2) DEFAULT 0 NOT NULL, paid_value numeric(15,2) DEFAULT 0 NOT NULL, expected_end_at timestamp,
    description text DEFAULT '' NOT NULL, notes text, created_at timestamp DEFAULT now() NOT NULL, updated_at timestamp DEFAULT now() NOT NULL);
  CREATE TABLE regularizacao_itens_financeiros (
    id serial PRIMARY KEY, regularizacao_id integer NOT NULL REFERENCES regularizacoes(id) ON DELETE CASCADE, chave_padrao varchar(40),
    nome varchar(120) NOT NULL, grupo varchar(20) NOT NULL, ordem integer NOT NULL, previsto numeric(15,2) DEFAULT 0 NOT NULL,
    created_at timestamp DEFAULT now() NOT NULL, updated_at timestamp DEFAULT now() NOT NULL);
`;

let pg: PGlite;
const linhas = async <T = Record<string, unknown>>(q: string) => (await pg.query<T>(q)).rows;
const admin = () => bpoRouter.createCaller({ user: { id: 1, role: "admin", active: true }, req: {}, res: {} } as never);

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(ANTES_0075);
  await pg.exec(sqlDe("0072_bpo_extrato.sql"));
  await pg.exec(sqlDe("0075_bpo_titular_clientes.sql"));
  await pg.exec(sqlDe("0077_banco_identificador_pluggy_v2.sql"));
  await pg.exec(sqlDe("0080_bpo_vinculos_operacionais.sql"));
  await pg.exec(sqlDe("0081_bpo_exclusao_edicao_auditavel.sql"));
  await pg.exec(sqlDe("0082_bpo_request_key.sql"));
  await pg.exec(sqlDe("0083_bpo_recebimentos_parciais.sql"));
  await pg.exec(sqlDe("0095_bpo_lote3.sql")); // lote 3: combinada_em_id (filtro das listas/DRE)
  await pg.exec("ALTER TABLE bpo_lancamentos ADD COLUMN exclusao_lote_backup_id integer");
  vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
});
afterEach(async () => { await pg.close(); });

describe("importação no BPO (banco em memória)", () => {
  it("prévia não grava; importação cria clientes e lançamentos; reimportar não duplica", async () => {
    // cliente já cadastrado com o mesmo CNPJ: não é recriado
    await pg.exec("INSERT INTO bpo_clients(razao_social,cnpj,responsavel,telefone,honorarios,data_inicio) VALUES('Construtora Exemplo','11.222.333/0001-44','X','',800,now())");
    const p = await admin().contaAzul.previa({ arquivos: BACKUP });
    expect(p).toMatchObject({
      clientesNovos: 1, clientesExistentes: 1, pessoas: { clientes: 2, fornecedores: 1 },
      lancamentos: { novos: 4, jaImportados: 0, receitas: { quantidade: 1, total: "1500.00" }, despesas: { quantidade: 3, total: "1119.50" }, pagos: 3, emAberto: 1 },
      repetidasPorCentro: 1, transferencias: { quantidade: 1 }, totalErros: 1,
    });
    expect((await linhas("SELECT count(*)::int n FROM bpo_lancamentos"))[0]).toEqual({ n: 0 });
    expect(p.lancamentosDoExtratoNoPeriodo).toBe(0);
    await pg.exec("INSERT INTO bpo_lancamentos(tipo,descricao,valor,vencimento,competencia,origem_efetiva) VALUES('despesa','Pix',10,now(),'2026-04','extrato')");
    expect((await admin().contaAzul.previa({ arquivos: BACKUP })).lancamentosDoExtratoNoPeriodo).toBe(1);
    await pg.exec("DELETE FROM bpo_lancamentos");

    const r = await admin().contaAzul.importar({ arquivos: BACKUP });
    expect(r).toMatchObject({ clientesCriados: 1, lancamentosCriados: 4, lancamentosJaImportados: 0, transferenciasIgnoradas: 1 });
    const ls = await linhas<Record<string, unknown>>(`SELECT l.tipo, l.valor::text, l.pago, l.valor_recebido::text vr, l.competencia, l.centro_custos, l.categoria,
      l.cliente_nome_livre, c.razao_social cliente, l.origem_efetiva, l.observacoes FROM bpo_lancamentos l LEFT JOIN bpo_clients c ON c.id = l.cliente_id ORDER BY l.valor`);
    expect(ls.map(l => [l.tipo, l.valor, l.pago, l.vr, l.categoria, l.cliente ?? l.cliente_nome_livre])).toEqual([
      ["despesa", "90.00", true, "90.00", "Tarifas bancárias", null],
      ["despesa", "320.50", false, "0.00", "Material", "Depósito Exemplo"],
      ["despesa", "709.00", true, "709.00", "Administrativo", null],
      ["receita", "1500.00", true, "1500.00", "Recebimento de cliente", "Maria Teste"],
    ]);
    expect(ls[2]).toMatchObject({ centro_custos: "Prospecta Maranhao / Prospecta Para", competencia: "2026-04", origem_efetiva: "conta_azul" });
    expect(String(ls[3].observacoes)).toMatch(/Categoria no Conta Azul: Receitas de Serviços\..*Forma de pagamento: Pix/);
    // honorários do cliente existente preservados; fornecedor e vendedor não viram cliente BPO
    expect(await linhas("SELECT razao_social, honorarios::text h, cpf FROM bpo_clients ORDER BY id")).toEqual([
      { razao_social: "Construtora Exemplo", h: "800.00", cpf: null },
      { razao_social: "Maria Teste", h: "0.00", cpf: "11122233344" },
    ]);

    const de_novo = await admin().contaAzul.importar({ arquivos: BACKUP });
    expect(de_novo).toMatchObject({ clientesCriados: 0, lancamentosCriados: 0, lancamentosJaImportados: 4 });
    expect((await linhas("SELECT count(*)::int n FROM bpo_lancamentos"))[0]).toEqual({ n: 4 });
    expect((await admin().contaAzul.previa({ arquivos: BACKUP })).lancamentos).toMatchObject({ novos: 0, jaImportados: 4 });
  });

  it("recusa arquivo que não é backup e limita o tamanho", async () => {
    await expect(admin().contaAzul.importar({ arquivos: { "x.csv": "a\n1" } })).rejects.toThrow(/não parece um backup/);
    await expect(admin().contaAzul.previa({ arquivos: { "financeiro.csv": "x".repeat(3_000_001) } })).rejects.toThrow();
  });
});
