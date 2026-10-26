// Pedido de 25/10 (noite), itens 7, 9, 10, 11 e 14 — banco real em memória (PGlite).
// Nenhum teste toca o banco de produção nem chama o Asaas de verdade (fetch simulado).
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste" } }));

import { getDb } from "./db.js";
import { gravarMovimentos } from "./bancos.js";
import { classificarMovimentacao } from "./bpo-extrato.js";
import { bpoRouter, montarClienteBpo } from "./bpo-router.js";
import { sincronizarCobrancasAsaas } from "./bpo-asaas.js";
import { listarProcessos } from "./regularizacao-router.js";

const sqlDe = (arquivo: string) => readFileSync(new URL(`../drizzle/${arquivo}`, import.meta.url), "utf8");

// Estado do banco ANTES da 0075 (0011 + tabelas bancárias + 0072), só com as tabelas do BPO.
const ANTES_0075 = `
  CREATE TYPE bpo_client_status AS ENUM ('ativo','pausado','encerrado');
  CREATE TYPE bpo_lancamento_tipo AS ENUM ('honorario','despesa','reembolso');
  CREATE TYPE bank_transaction_tipo AS ENUM ('credito','debito');
  CREATE TYPE bank_transaction_status AS ENUM ('pendente','conciliado','ignorado');
  CREATE TABLE leads (id serial PRIMARY KEY, name varchar(255) NOT NULL, phone varchar(20) NOT NULL, email varchar(320),
    cpf varchar(14), deleted_at timestamp);
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
let db: ReturnType<typeof drizzle>;
const linhas = async <T = Record<string, unknown>>(q: string) => (await pg.query<T>(q)).rows;
const admin = () => bpoRouter.createCaller({ user: { id: 1, role: "admin", active: true }, req: {}, res: {} } as never);

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(ANTES_0075);
  await pg.exec(sqlDe("0072_bpo_extrato.sql"));
  await pg.exec(sqlDe("0075_bpo_titular_clientes.sql"));
  db = drizzle(pg);
  vi.mocked(getDb).mockReturnValue(db as never);
  await pg.exec("INSERT INTO bank_accounts (banco, provedor) VALUES ('Cora', 'manual'), ('Asaas', 'asaas')");
});
afterEach(async () => { await pg.close(); });

describe("migração 0075", () => {
  it("é idempotente e cria colunas, regra única por titular e vínculos", async () => {
    await pg.exec(sqlDe("0075_bpo_titular_clientes.sql"));
    await pg.exec(sqlDe("0072_bpo_extrato.sql"));
    const cols = await linhas<{ table_name: string; column_name: string }>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE column_name IN ('titular','descricao_original','lead_id','asaas_payment_id','titular_normalizado') AND table_name <> 'regularizacoes' ORDER BY 1,2");
    expect(cols.map(c => `${c.table_name}.${c.column_name}`)).toEqual([
      "bank_transactions.asaas_payment_id", "bank_transactions.descricao_original", "bank_transactions.titular",
      "bpo_clients.lead_id", "bpo_lancamentos.asaas_payment_id", "bpo_regras_titular.titular_normalizado",
    ]);
    await pg.exec("INSERT INTO bpo_regras_titular (titular_normalizado) VALUES ('maria')");
    await expect(pg.exec("INSERT INTO bpo_regras_titular (titular_normalizado) VALUES ('maria')")).rejects.toThrow();
    await pg.exec("INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, competencia, asaas_payment_id) VALUES ('receita','a',1,now(),'2026-10','pay_x')");
    await expect(pg.exec("INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, competencia, asaas_payment_id) VALUES ('receita','b',1,now(),'2026-10','pay_x')")).rejects.toThrow();
    // Apagar o lead não apaga o cliente BPO (set null).
    await pg.exec("INSERT INTO leads (name, phone) VALUES ('Ana', '1'); INSERT INTO bpo_clients (razao_social, responsavel, telefone, honorarios, data_inicio, lead_id) VALUES ('Ana','Ana','',0,now(),1); DELETE FROM leads;");
    expect(await linhas("SELECT lead_id FROM bpo_clients")).toEqual([{ lead_id: null }]);
  });
});

describe("item 10 — cadastro de cliente BPO", () => {
  it("o caso que falhava: só o nome (sem honorários, responsável, telefone e data de início) agora cadastra", async () => {
    const c = await admin().clientes.create({ razaoSocial: "Fornecedor Areia Boa" });
    expect(c).toMatchObject({ razaoSocial: "Fornecedor Areia Boa", responsavel: "Fornecedor Areia Boa", telefone: "", honorarios: "0.00", diaVencimento: 10, leadId: null });
    // O formulário antigo mandava NaN quando honorários ficava vazio: agora é opcional.
    await expect(admin().clientes.create({ razaoSocial: "X" })).rejects.toThrow(/nome do cliente/);
  });

  it("escolhendo o lead, nome/CPF/telefone/e-mail vêm do CRM e movimentações do mesmo nome são vinculadas", async () => {
    await pg.exec("INSERT INTO leads (name, phone, email, cpf) VALUES ('Ana Lima', '18999990000', 'ana@ex.com', '123.456.789-00')");
    await gravarMovimentos({ id: 1, dataInicial: null }, [
      { externalId: "e1", data: "2026-10-01", descricao: "Transf Pix recebida", valor: 1000, tipo: "credito", titular: "ANA LIMA" },
    ], "importacao");
    const c = await admin().clientes.create({ leadId: 1 });
    expect(c).toMatchObject({ razaoSocial: "Ana Lima", cpf: "123.456.789-00", telefone: "18999990000", email: "ana@ex.com", leadId: 1, vinculadas: 1 });
    expect(await linhas("SELECT bpo_cliente_id FROM bank_transactions")).toEqual([{ bpo_cliente_id: c.id }]);
    expect(await linhas("SELECT cliente_id FROM bpo_lancamentos")).toEqual([{ cliente_id: c.id }]);
    const lista = await admin().clientes.list();
    expect(lista[0]).toMatchObject({ id: c.id, nomeLead: "Ana Lima", totalRecebido: 1000, totalEmAberto: 0 });
    const resumo = await admin().clientes.resumoPorLead({ leadId: 1 });
    expect(resumo).toMatchObject({ totalRecebido: 1000, totalEmAberto: 0 });
    expect(resumo.lancamentos).toHaveLength(1);
    expect(await admin().clientes.buscarLeads({ q: "9999" })).toHaveLength(1);
    expect(await admin().clientes.buscarLeads({ q: "lima" })).toHaveLength(1);
  });

  it("montarClienteBpo: dia de vencimento e honorários opcionais", () => {
    expect(montarClienteBpo({ razaoSocial: "Zé", servicos: [], honorarios: 150, diaVencimento: 5 }, null)).toMatchObject({ honorarios: "150.00", diaVencimento: 5 });
  });
});

describe("item 11 — + Lançamento", () => {
  it("Cobrança grava 'receita' com categoria; Despesa grava 'despesa'; categoria é obrigatória", async () => {
    const base = { descricao: "Medição", valor: 100, vencimento: "2026-10-10", competencia: "2026-10" };
    const c = await admin().lancamentos.create({ ...base, tipo: "cobranca", categoria: "Recebimento de cliente", clienteNomeLivre: "Fulano" });
    expect(c).toMatchObject({ tipo: "receita", categoria: "Recebimento de cliente", clienteNomeLivre: "Fulano", valor: "100.00" });
    const d = await admin().lancamentos.create({ ...base, tipo: "despesa", categoria: "Material" });
    expect(d).toMatchObject({ tipo: "despesa", categoria: "Material" });
    await expect(admin().lancamentos.create({ ...base, tipo: "cobranca" } as never)).rejects.toThrow();
    await expect(admin().lancamentos.create({ ...base, tipo: "honorario", categoria: "Outros" } as never)).rejects.toThrow();
    await expect(admin().lancamentos.create({ ...base, tipo: "despesa", categoria: "Transferência interna" } as never)).rejects.toThrow();
  });
});

describe("item 9 — titular, reimportação e regra por titular", () => {
  it("reimportar o mesmo arquivo não duplica e completa titular/descrição; lançamento ganha 'Tipo — Titular'", async () => {
    const mov = { externalId: "imp:1:a", data: "2026-01-02", descricao: "Transf Pix enviada", valor: 350, tipo: "debito" as const };
    await gravarMovimentos({ id: 1, dataInicial: null }, [mov], "importacao");
    expect(await linhas("SELECT descricao FROM bpo_lancamentos")).toEqual([{ descricao: "Transf Pix enviada" }]);
    const r = await gravarMovimentos({ id: 1, dataInicial: null }, [{ ...mov, titular: "Maria Materiais", detalhe: "Cimento", original: "Transf Pix enviada | Maria Materiais | Cimento" }], "importacao");
    expect(r).toMatchObject({ novos: 0, completadas: 1 });
    expect(await linhas("SELECT titular, descricao_original FROM bank_transactions")).toEqual([{ titular: "Maria Materiais", descricao_original: "Transf Pix enviada | Maria Materiais | Cimento" }]);
    expect(await linhas("SELECT descricao FROM bpo_lancamentos")).toEqual([{ descricao: "Transf Pix enviada — Maria Materiais — Cimento" }]);
    // Terceira vez: nada muda.
    expect((await gravarMovimentos({ id: 1, dataInicial: null }, [{ ...mov, titular: "Maria Materiais" }], "importacao")).completadas).toBe(0);
  });

  it("'aplicar a todas deste titular' grava a regra, reclassifica as existentes e vale para as próximas", async () => {
    await pg.exec("INSERT INTO bpo_clients (razao_social, responsavel, telefone, honorarios, data_inicio) VALUES ('Depósito São José','x','',0,now())");
    await gravarMovimentos({ id: 1, dataInicial: null }, [
      { externalId: "a", data: "2026-01-02", descricao: "Transf Pix enviada", valor: 100, tipo: "debito", titular: "JOSE DEPOSITO" },
      { externalId: "b", data: "2026-01-03", descricao: "Pgto QR Code Pix", valor: 200, tipo: "debito", titular: "José Depósito" },
      { externalId: "c", data: "2026-01-04", descricao: "Transf Pix enviada", valor: 300, tipo: "debito", titular: "Outra Pessoa" },
    ], "importacao");
    const r = await classificarMovimentacao(1, { categoria: "Material", bpoClienteId: 1, aplicarATodasDoTitular: true });
    expect(r).toMatchObject({ outras: 1, regra: { titularNormalizado: "jose deposito", categoria: "Material", bpoClienteId: 1 } });
    expect(await linhas("SELECT external_id, categoria, bpo_cliente_id FROM bank_transactions ORDER BY id")).toEqual([
      { external_id: "a", categoria: "Material", bpo_cliente_id: 1 },
      { external_id: "b", categoria: "Material", bpo_cliente_id: 1 },
      { external_id: "c", categoria: "Outros", bpo_cliente_id: null },
    ]);
    expect(await linhas("SELECT categoria, cliente_id FROM bpo_lancamentos ORDER BY id")).toEqual([
      { categoria: "Material", cliente_id: 1 }, { categoria: "Material", cliente_id: 1 }, { categoria: "Outros", cliente_id: null },
    ]);
    await gravarMovimentos({ id: 1, dataInicial: null }, [{ externalId: "d", data: "2026-02-01", descricao: "Transf Pix enviada", valor: 50, tipo: "debito", titular: "JOSÉ DEPÓSITO" }], "importacao");
    expect(await linhas("SELECT categoria, bpo_cliente_id FROM bank_transactions WHERE external_id = 'd'")).toEqual([{ categoria: "Material", bpo_cliente_id: 1 }]);
    // Regra com Transferência interna remove os lançamentos do titular.
    await classificarMovimentacao(1, { categoria: "Transferência interna", aplicarATodasDoTitular: true });
    expect(await linhas("SELECT count(*)::int AS n FROM bpo_lancamentos")).toEqual([{ n: 1 }]);
  });
});

describe("item 7 — valor de cada processo na lista", () => {
  it("Total geral (previsto) = soma de todos os itens do processo, numa consulta", async () => {
    await pg.exec(`INSERT INTO regularizacoes (client_name, type, address, responsible) VALUES ('A','t','e','r'),('B','t','e','r');
      INSERT INTO regularizacao_itens_financeiros (regularizacao_id, nome, grupo, ordem, previsto) VALUES
        (1,'Projetos','durante_obra',1,1500.50),(1,'Taxa cartório','casa_pronta',2,499.50),(1,'Água','durante_obra',3,0);`);
    const lista = await listarProcessos();
    const porNome = Object.fromEntries(lista.map(p => [p.clientName, Number(p.totalPrevisto)]));
    expect(porNome).toEqual({ A: 2000, B: 0 });
    expect(await listarProcessos("concluido")).toEqual([]);
  });
});

describe("item 14 — cobranças do Asaas", () => {
  const respostas = (pagamentos: unknown[]) => vi.fn((url: string) => Promise.resolve({
    ok: true, status: 200,
    json: async () => url.includes("/customers/")
      ? { name: url.includes("cus_ana") ? "Ana Lima" : "Bruno Reis", cpfCnpj: url.includes("cus_ana") ? "12345678900" : "" }
      : { hasMore: false, data: pagamentos },
  } as Response));

  it("cria em aberto/vencida, reconcilia paga com o crédito do extrato (por id ou valor/data) e não duplica", async () => {
    await pg.exec("INSERT INTO bpo_clients (razao_social, cpf, responsavel, telefone, honorarios, data_inicio) VALUES ('Ana (cliente)','123.456.789-00','x','',0,now())");
    // Extrato do Asaas já sincronizado: crédito com id do pagamento e outro sem (antigo).
    await gravarMovimentos({ id: 2, dataInicial: null }, [
      { externalId: "asaas:f1", data: "2026-10-05", descricao: "Cobrança recebida", valor: 498.01, tipo: "credito", asaasPaymentId: "pay_rec" },
      { externalId: "asaas:f2", data: "2026-10-08", descricao: "Cobrança recebida", valor: 300, tipo: "credito" },
    ], "asaas");
    const pagamentos = [
      { id: "pay_rec", status: "RECEIVED", value: 500, netValue: 498.01, dueDate: "2026-10-05", paymentDate: "2026-10-05", customer: "cus_ana", description: "Parcela 1" },
      { id: "pay_old", status: "CONFIRMED", value: 300, netValue: 300, dueDate: "2026-10-07", clientPaymentDate: "2026-10-07", customer: "cus_bruno" },
      { id: "pay_open", status: "PENDING", value: 800, dueDate: "2026-11-10", customer: "cus_ana" },
      { id: "pay_late", status: "OVERDUE", value: 120, dueDate: "2026-09-10", customer: "cus_bruno" },
      { id: "pay_est", status: "REFUNDED", value: 50, dueDate: "2026-09-01", customer: "cus_bruno" },
    ];
    const r = await sincronizarCobrancasAsaas("$aact_teste", "2026-01-01", respostas(pagamentos) as never);
    expect(r).toEqual({ recebidas: 4, criadas: 2, atualizadas: 0, reconciliadas: 2 });
    const lancs = await linhas<{ asaas_payment_id: string; bank_transaction_id: number | null; pago: boolean; valor: string; cliente_id: number | null; cliente_nome_livre: string | null }>(
      "SELECT asaas_payment_id, bank_transaction_id, pago, valor, cliente_id, cliente_nome_livre FROM bpo_lancamentos ORDER BY asaas_payment_id");
    expect(lancs).toEqual([
      { asaas_payment_id: "pay_late", bank_transaction_id: null, pago: false, valor: "120.00", cliente_id: null, cliente_nome_livre: "Bruno Reis" },
      { asaas_payment_id: "pay_old", bank_transaction_id: 2, pago: true, valor: "300.00", cliente_id: null, cliente_nome_livre: "Bruno Reis" },
      { asaas_payment_id: "pay_open", bank_transaction_id: null, pago: false, valor: "800.00", cliente_id: 1, cliente_nome_livre: null },
      { asaas_payment_id: "pay_rec", bank_transaction_id: 1, pago: true, valor: "498.01", cliente_id: 1, cliente_nome_livre: null },
    ]);
    // Segunda sincronização: nada novo, nada duplicado.
    expect(await sincronizarCobrancasAsaas("$aact_teste", "2026-01-01", respostas(pagamentos) as never)).toEqual({ recebidas: 4, criadas: 0, atualizadas: 0, reconciliadas: 0 });

    // A cobrança em aberto é paga: o crédito novo do extrato assume o lançamento dela.
    await gravarMovimentos({ id: 2, dataInicial: null }, [
      { externalId: "asaas:f3", data: "2026-11-09", descricao: "Cobrança recebida", valor: 797.01, tipo: "credito", asaasPaymentId: "pay_open" },
    ], "asaas");
    expect(await linhas("SELECT count(*)::int AS n FROM bpo_lancamentos")).toEqual([{ n: 4 }]);
    expect(await linhas("SELECT pago, valor, bank_transaction_id FROM bpo_lancamentos WHERE asaas_payment_id = 'pay_open'")).toEqual([{ pago: true, valor: "797.01", bank_transaction_id: 3 }]);
    // E o Asaas passa a informar a cobrança como recebida: não volta a mexer no valor do banco.
    const pagos = pagamentos.map(p => (p.id === "pay_open" ? { ...p, status: "RECEIVED", paymentDate: "2026-11-09" } : p));
    expect((await sincronizarCobrancasAsaas("$aact_teste", "2026-01-01", respostas(pagos) as never)).criadas).toBe(0);
    expect(await linhas("SELECT valor FROM bpo_lancamentos WHERE asaas_payment_id = 'pay_open'")).toEqual([{ valor: "797.01" }]);
  });
});
