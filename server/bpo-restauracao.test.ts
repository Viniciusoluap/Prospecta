// Lote 4 (30/10/2026) — "Restaurar" exclusões em lote do BPO com banco em memória (PGlite).
// Gêmeo do Santa Fé: web/src/lib/__tests__/bpo-restaurar-exclusao.db.test.ts. Nenhum serviço externo.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste" } }));

import { getDb } from "./db.js";
import { bpoRouter } from "./bpo-router.js";
import { combinarPagamentos, excluirLancamentosEmLote, previaExclusaoLote } from "./bpo-lote.js";
import { listarExclusoesEmLote, previaRestauracaoExclusao, restaurarExclusaoEmLote } from "./bpo-restauracao.js";
import { gerarLancamentosDoExtrato, lancamentosComTitular, reprocessarMovimentacoes } from "./bpo-extrato.js";
import { limparContaComBackup, previaLimpezaConta } from "./bpo-auditoria.js";
import { sincronizarCobrancasAsaas } from "./bpo-asaas.js";
import { dreDosLancamentos } from "../shared/financeiro/bpo-extrato.js";

const sqlDe = (arquivo: string) => readFileSync(new URL(`../drizzle/${arquivo}`, import.meta.url), "utf8");
const BASE = `
  CREATE TYPE bpo_client_status AS ENUM ('ativo','pausado','encerrado');
  CREATE TYPE bpo_lancamento_tipo AS ENUM ('honorario','despesa','reembolso');
  CREATE TYPE bank_transaction_tipo AS ENUM ('credito','debito');
  CREATE TYPE bank_transaction_status AS ENUM ('pendente','conciliado','ignorado');
  CREATE TABLE leads (id serial PRIMARY KEY, name varchar(255) NOT NULL, phone varchar(20) NOT NULL, email varchar(320), cpf varchar(14), deleted_at timestamp);
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
`;
let pg: PGlite;
let consultas: string[];
const linhas = async <T = Record<string, unknown>>(q: string) => (await pg.query<T>(q)).rows;
const caller = (role: string) => bpoRouter.createCaller({ user: { id: 1, role, active: true }, req: {}, res: {} } as never);
// Catálogo falso de vínculos operacionais: só a obra 7 existe.
const catalogo = async () => ({ obras: [{ id: "7", rotulo: "Obra 7" }] });

beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(BASE);
  for (const f of ["0072_bpo_extrato.sql", "0075_bpo_titular_clientes.sql", "0077_banco_identificador_pluggy_v2.sql", "0080_bpo_vinculos_operacionais.sql",
    "0081_bpo_exclusao_edicao_auditavel.sql", "0082_bpo_request_key.sql", "0083_bpo_recebimentos_parciais.sql", "0095_bpo_lote3.sql",
    "0097_bpo_restaurar_exclusoes.sql", "0097_bpo_restaurar_exclusoes.sql"]) await pg.exec(sqlDe(f));
  await pg.exec(`
    ALTER TABLE users ADD COLUMN name text;
    CREATE TABLE obra_movimentos (id serial PRIMARY KEY, bpo_lancamento_id integer REFERENCES bpo_lancamentos(id) ON DELETE RESTRICT, status varchar(12) DEFAULT 'confirmado', valor numeric(15,2) DEFAULT 1);
    CREATE TABLE regularizacao_recebimentos (id serial PRIMARY KEY, bpo_lancamento_id integer REFERENCES bpo_lancamentos(id) ON DELETE RESTRICT, status varchar(12) DEFAULT 'confirmado', valor numeric(15,2) DEFAULT 1);
    INSERT INTO users (name) VALUES ('Admin Teste');
    INSERT INTO bpo_clients (razao_social, responsavel, telefone, honorarios, data_inicio) VALUES ('Cliente Apagado', 'X', '', 0, now());`);
  await pg.exec(sqlDe("0099_bpo_limpeza_ajustes.sql"));
  await pg.exec(sqlDe("0103_bpo_a_classificar.sql")); // 12/11 (noite): A classificar e divisão de pagamentos
  consultas = [];
  vi.mocked(getDb).mockReturnValue(drizzle(pg, { logger: { logQuery: query => consultas.push(query) } }) as never);
});

describe("limpeza de ajustes — integridade e restauração em lote", () => {
  const ajustes = { aba: "cobrancas" as const, modo: "tudo" as const, limpezaAjustes: true, filtros: { mes: "10", ano: "2026" } };
  const limpar = async (entrada = ajustes) => {
    const previa = await previaExclusaoLote(entrada);
    return excluirLancamentosEmLote({ ...entrada, previaToken: previa.previaToken, confirmacao: "EXCLUIR" }, 1);
  };

  it("retira e restaura 823 registros sem perder recebimentos, vínculos, fontes ou combinações; restaura em número constante de escritas", async () => {
    await pg.exec(`INSERT INTO bank_accounts(banco) VALUES ('Banco teste');
      INSERT INTO bank_transactions(account_id,data,descricao,valor,tipo) VALUES (1,now(),'Fonte teste',100,'credito');
      INSERT INTO bpo_lancamentos(tipo,descricao,valor,vencimento,competencia,pago,pago_em,valor_recebido,asaas_payment_id,bank_transaction_id)
      SELECT 'receita','Lançamento teste '||g,100,'2026-10-10','2026-10',true,'2026-10-10',100,'pay_teste_'||g,CASE WHEN g=1 THEN 1 END FROM generate_series(1,823) g;
      INSERT INTO bpo_lancamentos(tipo,descricao,valor,vencimento,competencia,pago)
      SELECT 'despesa','Despesa teste '||g,10,'2026-10-10','2026-10',true FROM generate_series(1,188) g;
      INSERT INTO bpo_lancamentos(tipo,descricao,valor,vencimento,competencia,pago) VALUES ('receita','Outro mês',5,'2026-11-10','2026-11',true);
      INSERT INTO bpo_lancamentos(tipo,descricao,valor,vencimento,competencia,combinada_em_id) VALUES ('receita','Original combinada',100,'2026-10-10','2026-10',4);
      INSERT INTO bpo_recebimentos(lancamento_id,request_key,valor,recebido_em,registrado_por_user_id) VALUES (2,'rec-teste',100,'2026-10-10',1);
      INSERT INTO obra_movimentos(bpo_lancamento_id,valor) VALUES (2,30);
      INSERT INTO regularizacao_recebimentos(bpo_lancamento_id,valor) VALUES (3,40);`);
    const antes = await linhas("SELECT id,asaas_payment_id,bank_transaction_id,combinada_em_id,valor,pago,valor_recebido FROM bpo_lancamentos ORDER BY id");
    expect(await previaExclusaoLote({ ...ajustes, limpezaAjustes: false })).toMatchObject({ alcancados: 823, excluiveis: 0, protegidos: 823 });
    const r = await limpar();
    expect(r).toMatchObject({ excluidos: 823, protegidos: 0 });
    expect(await linhas("SELECT count(*)::int n FROM bpo_lancamentos WHERE exclusao_lote_backup_id IS NOT NULL")).toEqual([{ n: 823 }]);
    expect(await linhas("SELECT count(*)::int n FROM bpo_recebimentos")).toEqual([{ n: 1 }]);
    expect(await linhas("SELECT bpo_lancamento_id FROM obra_movimentos")).toEqual([{ bpo_lancamento_id: 2 }]);
    expect(await linhas("SELECT bpo_lancamento_id FROM regularizacao_recebimentos")).toEqual([{ bpo_lancamento_id: 3 }]);
    const visiveis = await lancamentosComTitular();
    expect(visiveis).toHaveLength(189);
    expect(dreDosLancamentos(visiveis)).toEqual(expect.arrayContaining([{ competencia: "2026-10", cobrancas: 0, despesas: 1880, resultado: -1880 }]));
    expect(await previaRestauracaoExclusao(r.backupId!, catalogo)).toMatchObject({ restaurar: 823, jaExistem: 0 });
    consultas.length = 0;
    expect(await restaurarExclusaoEmLote({ backupId: r.backupId!, confirmacao: "RESTAURAR" }, 1, catalogo)).toMatchObject({ restaurados: 823 });
    expect(consultas.filter(q => q.startsWith('update "bpo_lancamentos"'))).toHaveLength(1);
    expect(consultas.filter(q => q.startsWith('insert into "bpo_lancamento_historico"'))).toHaveLength(1);
    expect(await linhas("SELECT id,asaas_payment_id,bank_transaction_id,combinada_em_id,valor,pago,valor_recebido FROM bpo_lancamentos ORDER BY id")).toEqual(antes);
    expect(await linhas("SELECT count(*)::int n FROM bpo_recebimentos")).toEqual([{ n: 1 }]);
    expect(await linhas("SELECT count(*)::int n FROM bpo_lancamento_historico")).toEqual([{ n: 1646 }]);
    await expect(restaurarExclusaoEmLote({ backupId: r.backupId!, confirmacao: "RESTAURAR" }, 1, catalogo)).rejects.toThrow(/já foi restaurada/);
  }, 30000);

  it("exige confirmação e prévia atual; falha antes de gravar backup se o alcance mudar", async () => {
    await pg.exec("INSERT INTO bpo_lancamentos(tipo,descricao,valor,vencimento,competencia,pago) VALUES ('receita','A',100,'2026-10-10','2026-10',true)");
    const previa = await previaExclusaoLote(ajustes);
    await expect(excluirLancamentosEmLote({ ...ajustes, previaToken: previa.previaToken, confirmacao: "excluir" }, 1)).rejects.toThrow(/EXCLUIR/);
    await expect(excluirLancamentosEmLote({ ...ajustes, confirmacao: "EXCLUIR" }, 1)).rejects.toThrow(/prévia/);
    await pg.exec("INSERT INTO bpo_lancamentos(tipo,descricao,valor,vencimento,competencia,pago) VALUES ('receita','Nova',100,'2026-10-10','2026-10',true)");
    await expect(excluirLancamentosEmLote({ ...ajustes, previaToken: previa.previaToken, confirmacao: "EXCLUIR" }, 1)).rejects.toThrow(/mudaram/);
    expect(await linhas("SELECT count(*)::int n FROM bpo_lancamento_exclusoes_backup")).toEqual([{ n: 0 }]);
    const selecionados = { ...ajustes, modo: "selecionados" as const, ids: [1] };
    const p = await previaExclusaoLote(selecionados);
    expect(await excluirLancamentosEmLote({ ...selecionados, previaToken: p.previaToken, confirmacao: "EXCLUIR" }, 1)).toMatchObject({ excluidos: 1 });
    expect(await linhas("SELECT id FROM bpo_lancamentos WHERE exclusao_lote_backup_id IS NULL")).toEqual([{ id: 2 }]);
  });

  it("bloqueia telas antigas e novas alocações, mas preserva alterações não financeiras e desfazimento dos vínculos anteriores", async () => {
    await pg.exec(`INSERT INTO bpo_lancamentos(tipo,descricao,valor,vencimento,competencia) VALUES ('receita','A',100,'2026-10-10','2026-10'),('receita','B',100,'2026-10-10','2026-10');
      INSERT INTO obra_movimentos(bpo_lancamento_id,status,valor) VALUES (1,'confirmado',20),(2,'cancelado',10);
      INSERT INTO regularizacao_recebimentos(bpo_lancamento_id,status,valor) VALUES (1,'confirmado',10);`);
    await limpar();
    await expect(caller("admin").lancamentos.receber({ id: 1, requestKey: "17bb3dbd-9870-4131-8be0-a57045d67bcf", valor: 1, recebidoEm: "2026-10-10" })).rejects.toThrow(/limpeza/);
    await expect(caller("admin").lancamentos.marcarPago({ id: 1 })).rejects.toThrow(/limpeza/);
    await expect(caller("admin").lancamentos.editar({ id: 1, version: 1, motivo: "teste", descricao: "Alterada", valor: 100, vencimento: "2026-10-10", competencia: "2026-10" })).rejects.toThrow(/limpeza/);
    await expect(caller("admin").lancamentos.vincularCliente({ id: 1, version: 1, clienteId: 1, motivo: "teste" })).rejects.toThrow(/limpeza/);
    await expect(combinarPagamentos({ ids: [1,2], requestKey: "rk-combinar" }, 1)).rejects.toThrow(/disponível/);
    await expect(pg.exec("INSERT INTO obra_movimentos(bpo_lancamento_id,valor) VALUES (1,1)")).rejects.toThrow(/limpeza/);
    await expect(pg.exec("INSERT INTO regularizacao_recebimentos(bpo_lancamento_id,valor) VALUES (1,1)")).rejects.toThrow(/limpeza/);
    await expect(pg.exec("UPDATE obra_movimentos SET valor=21 WHERE id=1")).rejects.toThrow(/limpeza/);
    await expect(pg.exec("UPDATE obra_movimentos SET status='confirmado' WHERE id=2")).rejects.toThrow(/limpeza/);
    await pg.exec("UPDATE obra_movimentos SET valor=19 WHERE id=1; UPDATE regularizacao_recebimentos SET status='cancelado' WHERE id=1;");
    expect(await linhas("SELECT bpo_lancamento_id,valor FROM obra_movimentos WHERE id=1")).toEqual([{ bpo_lancamento_id: 1, valor: "19.00" }]);
    await expect(caller("corretor").lancamentos.previaExclusao(ajustes)).rejects.toThrow();
  });

  it("rollback reverte backup, histórico e marcadores se a auditoria falhar", async () => {
    await pg.exec(`INSERT INTO bpo_lancamentos(tipo,descricao,valor,vencimento,competencia,pago) VALUES ('receita','A',100,'2026-10-10','2026-10',true);
      CREATE FUNCTION falhar_historico() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'falha simulada'; END$$;
      CREATE TRIGGER falhar_historico BEFORE INSERT ON bpo_lancamento_historico FOR EACH ROW EXECUTE FUNCTION falhar_historico();`);
    await expect(limpar()).rejects.toThrow();
    expect(await linhas("SELECT count(*)::int n FROM bpo_lancamento_exclusoes_backup")).toEqual([{ n: 0 }]);
    expect(await linhas("SELECT count(*)::int n FROM bpo_lancamento_historico")).toEqual([{ n: 0 }]);
    expect(await linhas("SELECT exclusao_lote_backup_id FROM bpo_lancamentos")).toEqual([{ exclusao_lote_backup_id: null }]);
  });

  it.each([true, false])("reconcilia crédito tardio sem duplicar na restauração (processado antes de restaurar: %s)", async processarAntes => {
    await pg.exec(`INSERT INTO bpo_lancamentos(tipo,descricao,valor,vencimento,competencia,pago,asaas_payment_id) VALUES ('receita','Asaas removido',150,'2026-10-10','2026-10',false,'pay_teste');
      INSERT INTO bank_accounts(banco,provedor) VALUES ('Asaas','asaas');
      INSERT INTO bank_transactions(account_id,data,descricao,valor,tipo,asaas_payment_id) VALUES (1,'2026-10-10','Crédito tardio',100,'credito','pay_teste');`);
    const { backupId } = await limpar();
    const fetchFake = vi.fn(async () => new Response(JSON.stringify({ hasMore: false, data: [{ id: "pay_teste", status: "RECEIVED", value: 150, dueDate: "2026-10-10", description: "Alterada externamente" }] }), { status: 200, headers: { "content-type": "application/json" } }));
    expect(await sincronizarCobrancasAsaas("chave-teste", "2026-10-01", fetchFake)).toMatchObject({ criadas: 0, atualizadas: 0, reconciliadas: 0 });
    if (processarAntes) {
      const movimento = { id: 1, data: new Date("2026-10-10"), descricao: "Crédito tardio", valor: "100", tipo: "credito" as const, categoria: null, asaasPaymentId: "pay_teste" };
      expect(await gerarLancamentosDoExtrato([movimento])).toBe(0);
      expect(await gerarLancamentosDoExtrato([movimento])).toBe(0);
      expect(await linhas("SELECT id,descricao,valor,pago,bank_transaction_id FROM bpo_lancamentos")).toEqual([{ id: 1, descricao: "Asaas removido", valor: "100.00", pago: true, bank_transaction_id: 1 }]);
    }
    expect(await lancamentosComTitular()).toEqual([]);
    expect(fetchFake).toHaveBeenCalledTimes(1);
    expect(await restaurarExclusaoEmLote({ backupId: backupId!, confirmacao: "RESTAURAR" }, 1, catalogo)).toMatchObject({ restaurados: 1 });
    expect(await reprocessarMovimentacoes()).toMatchObject({ lancamentosCriados: 0 });
    expect(await lancamentosComTitular()).toMatchObject([{ id: 1, valor: "100.00", pago: true, bankTransactionId: 1 }]);
  });

  it("reconcilia cobrança com o crédito arquivado sem id, sem torná-lo visível ou duplicar na restauração", async () => {
    await pg.exec(`INSERT INTO bank_accounts(banco,provedor) VALUES ('Asaas','asaas');
      INSERT INTO bank_transactions(account_id,data,descricao,valor,tipo) VALUES (1,'2026-10-10','Crédito',100,'credito');
      INSERT INTO bpo_lancamentos(tipo,descricao,valor,vencimento,competencia,pago,bank_transaction_id) VALUES ('receita','Crédito',100,'2026-10-10','2026-10',true,1);`);
    const { backupId } = await limpar();
    const fetchFake = vi.fn(async () => new Response(JSON.stringify({ hasMore: false, data: [{ id: "pay_arquivado", status: "RECEIVED", value: 100, dueDate: "2026-10-10", description: "Asaas" }] }), { status: 200 }));
    expect(await sincronizarCobrancasAsaas("chave-teste", "2026-10-01", fetchFake)).toMatchObject({ criadas: 0, reconciliadas: 1 });
    expect(await sincronizarCobrancasAsaas("chave-teste", "2026-10-01", fetchFake)).toMatchObject({ criadas: 0, atualizadas: 0, reconciliadas: 0 });
    expect(await lancamentosComTitular()).toEqual([]);
    expect(await linhas("SELECT id,descricao,asaas_payment_id,exclusao_lote_backup_id FROM bpo_lancamentos")).toEqual([{ id: 1, descricao: "Crédito", asaas_payment_id: "pay_arquivado", exclusao_lote_backup_id: backupId }]);
    expect(await linhas("SELECT asaas_payment_id FROM bank_transactions")).toEqual([{ asaas_payment_id: "pay_arquivado" }]);
    expect(await restaurarExclusaoEmLote({ backupId: backupId!, confirmacao: "RESTAURAR" }, 1, catalogo)).toMatchObject({ restaurados: 1 });
    expect(await lancamentosComTitular()).toMatchObject([{ id: 1, asaasPaymentId: "pay_arquivado", bankTransactionId: 1 }]);
  });

  it("excluir conta preserva o lançamento arquivado para a restauração do lote", async () => {
    await pg.exec(`ALTER TABLE bank_accounts ADD COLUMN agencia text, ADD COLUMN tipo text, ADD COLUMN descricao text,
      ADD COLUMN saldo_atual numeric DEFAULT 0, ADD COLUMN pluggy_item_id text, ADD COLUMN pluggy_account_id text,
      ADD COLUMN webhook_url text, ADD COLUMN ultima_sincronizacao timestamp, ADD COLUMN data_inicial timestamp,
      ADD COLUMN ultimo_erro text, ADD COLUMN created_at timestamp DEFAULT now();
      INSERT INTO bank_accounts(banco) VALUES ('Banco teste');
      INSERT INTO bank_transactions(account_id,data,descricao,valor,tipo) VALUES (1,now(),'Pix',100,'credito');
      INSERT INTO bpo_lancamentos(tipo,descricao,valor,vencimento,competencia,pago,bank_transaction_id,origem_efetiva) VALUES ('receita','Extrato',100,'2026-10-10','2026-10',true,1,'extrato');`);
    const r = await limpar();
    expect(await previaLimpezaConta(1)).toMatchObject({ lancamentosRemovidos: 0, lancamentosPreservados: 1 });
    await limparContaComBackup(1,"EXCLUIR",1);
    expect(await linhas("SELECT id,bank_transaction_id,exclusao_lote_backup_id FROM bpo_lancamentos")).toEqual([{ id: 1, bank_transaction_id: null, exclusao_lote_backup_id: r.backupId }]);
    expect(await previaRestauracaoExclusao(r.backupId!,catalogo)).toMatchObject({ restaurar: 1, comAviso: 1, itens: [{ avisos: [expect.stringMatching(/bancária original foi removida/)] }] });
    expect(await restaurarExclusaoEmLote({ backupId: r.backupId!, confirmacao: "RESTAURAR" },1,catalogo)).toMatchObject({ restaurados: 1 });
  });
});
afterEach(async () => { await pg.close(); });

describe("lote 4 — restaurar exclusão em lote (banco)", () => {
  it("prévia, restauração em transação, vínculos que sumiram, histórico e sem restaurar duas vezes", async () => {
    await pg.exec(`INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, competencia, cliente_id, categoria_operacional, vinculo_operacional_id, vinculo_operacional_rotulo, request_key, version) VALUES
      ('despesa','Com cliente',1234.56,'2026-10-10 12:00:00','2026-10',1,NULL,NULL,NULL,NULL,1),
      ('despesa','Com obra apagada',1,'2026-10-10','2026-10',NULL,'obras','99','Obra 99',NULL,1),
      ('despesa','Com obra viva',1,'2026-10-10','2026-10',NULL,'obras','7','Obra 7',NULL,3),
      ('despesa','Com chave',1,'2026-10-10','2026-10',NULL,NULL,NULL,NULL,'rk-1',1)`);
    const ex = await excluirLancamentosEmLote({ aba: "despesas", modo: "tudo", confirmacao: "EXCLUIR" }, 1);
    expect(ex.excluidos).toBe(4);
    const backupId = ex.backupId!;
    await pg.exec("DELETE FROM bpo_clients WHERE id = 1");
    await pg.exec("INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, competencia, request_key) VALUES ('receita','Reuso',1,now(),'2026-10','rk-1')");

    expect(await listarExclusoesEmLote()).toMatchObject([{ id: backupId, aba: "despesas", modo: "tudo", quantidade: 4, usuario: "Admin Teste", restauradoEm: null }]);
    const previa = await previaRestauracaoExclusao(backupId, catalogo);
    expect(previa).toMatchObject({ restaurar: 4, jaExistem: 0, comAviso: 3 });
    expect(previa.itens.find(i => i.descricao === "Com cliente")?.avisos.join(" ")).toMatch(/Cliente Apagado.*não existe mais/);
    expect(previa.itens.find(i => i.descricao === "Com obra apagada")?.avisos.join(" ")).toMatch(/Obra 99.*não existe mais/);
    expect(previa.itens.find(i => i.descricao === "Com obra viva")?.avisos).toEqual([]);

    await expect(restaurarExclusaoEmLote({ backupId, confirmacao: "restaurar" }, 1, catalogo)).rejects.toThrow(/RESTAURAR/);
    const r = await restaurarExclusaoEmLote({ backupId, confirmacao: "RESTAURAR" }, 1, catalogo);
    expect(r).toMatchObject({ restaurados: 4, jaExistiam: 0, comAviso: 3 });
    expect(r.avisos).toHaveLength(3);

    expect(await linhas("SELECT id, descricao, valor, cliente_id, cliente_nome_livre, vinculo_operacional_id, request_key, version FROM bpo_lancamentos WHERE id <= 4 ORDER BY id")).toEqual([
      { id: 1, descricao: "Com cliente", valor: "1234.56", cliente_id: null, cliente_nome_livre: "Cliente Apagado", vinculo_operacional_id: null, request_key: null, version: 2 },
      { id: 2, descricao: "Com obra apagada", valor: "1.00", cliente_id: null, cliente_nome_livre: null, vinculo_operacional_id: null, request_key: null, version: 2 },
      { id: 3, descricao: "Com obra viva", valor: "1.00", cliente_id: null, cliente_nome_livre: null, vinculo_operacional_id: "7", request_key: null, version: 4 },
      { id: 4, descricao: "Com chave", valor: "1.00", cliente_id: null, cliente_nome_livre: null, vinculo_operacional_id: null, request_key: null, version: 2 },
    ]);
    const [v] = await linhas<{ vencimento: Date }>("SELECT vencimento FROM bpo_lancamentos WHERE id = 1");
    expect(new Date(v.vencimento).toISOString().slice(0, 10)).toBe("2026-10-10");
    expect(await linhas(`SELECT count(*)::int n FROM bpo_lancamento_historico WHERE motivo LIKE 'Restaurado da exclusão em lote (backup #${backupId})%' AND alterado_por_user_id = 1 AND lancamento_id IS NOT NULL`)).toEqual([{ n: 4 }]);
    const [b] = await linhas<{ restaurado_em: Date | null; restaurado_por_user_id: number; restauracao_json: string }>(`SELECT * FROM bpo_lancamento_exclusoes_backup WHERE id = ${backupId}`);
    expect(b.restaurado_em).not.toBeNull();
    expect(b.restaurado_por_user_id).toBe(1);
    expect(JSON.parse(b.restauracao_json)).toEqual({ restaurados: 4, jaExistiam: 0, comAviso: 3 });

    await expect(restaurarExclusaoEmLote({ backupId, confirmacao: "RESTAURAR" }, 1, catalogo)).rejects.toThrow(/já foi restaurada/);
    expect(await linhas("SELECT count(*)::int n FROM bpo_lancamentos")).toEqual([{ n: 5 }]);
    expect((await listarExclusoesEmLote())[0]).toMatchObject({ restauradoPor: "Admin Teste", restauracao: { restaurados: 4 } });
  });

  it("não duplica lançamento que já existe com o mesmo ID; os demais voltam", async () => {
    await pg.exec("INSERT INTO bpo_lancamentos (tipo, descricao, valor, vencimento, competencia) VALUES ('despesa','A',1,now(),'2026-10'), ('despesa','B',1,now(),'2026-10')");
    const ex = await excluirLancamentosEmLote({ aba: "despesas", modo: "selecionados", ids: [1, 2], confirmacao: "EXCLUIR" }, 1);
    await pg.exec("INSERT INTO bpo_lancamentos (id, tipo, descricao, valor, vencimento, competencia) VALUES (1, 'despesa','A recriado',1,now(),'2026-10')");
    expect(await previaRestauracaoExclusao(ex.backupId!, catalogo)).toMatchObject({ restaurar: 1, jaExistem: 1 });
    expect(await restaurarExclusaoEmLote({ backupId: ex.backupId!, confirmacao: "RESTAURAR" }, 1, catalogo)).toMatchObject({ restaurados: 1, jaExistiam: 1 });
    expect(await linhas("SELECT id, descricao FROM bpo_lancamentos ORDER BY id")).toEqual([{ id: 1, descricao: "A recriado" }, { id: 2, descricao: "B" }]);
  });

  it("rotas: só admin acessa a lista", async () => {
    await expect(caller("user").lancamentos.exclusoesEmLote()).rejects.toThrow();
    expect(await caller("admin").lancamentos.exclusoesEmLote()).toEqual([]);
  });
});
