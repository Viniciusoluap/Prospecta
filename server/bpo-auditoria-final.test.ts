import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { getDb } from "./db.js";
import { limparContaComBackup, previaLimpezaConta } from "./bpo-auditoria.js";
import { catalogoDaCategoria } from "../shared/financeiro/bpo-operacional.js";
vi.mock("./db.js", () => ({ getDb: vi.fn() }));
let pg: PGlite;
beforeEach(async () => {
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE bank_accounts (id int primary key,banco text,agencia text,conta text,tipo text,descricao text,saldo_atual numeric,ativo boolean,pluggy_item_id text,pluggy_account_id text,webhook_url text,ultima_sincronizacao timestamp,provedor text,data_inicial date,ultimo_erro text,saldo_fonte text,created_at timestamp);
    CREATE TABLE bank_transactions (id int primary key,account_id int references bank_accounts(id) on delete cascade);
    CREATE TABLE bpo_lancamentos (id int primary key,bank_transaction_id int references bank_transactions(id) on delete cascade,asaas_payment_id text,origem_efetiva text,vinculo_operacional_id text,updated_at timestamp,version int default 1);
    CREATE TABLE obra_movimentos (bpo_lancamento_id int references bpo_lancamentos(id));
    CREATE TABLE regularizacao_recebimentos (bpo_lancamento_id int references bpo_lancamentos(id));
    CREATE TABLE bpo_conta_limpeza_backups (id serial primary key,conta_referencia int,conta_rotulo text,snapshot_json text,transacoes int,lancamentos_removidos int,lancamentos_preservados int,criado_por_user_id int);
    INSERT INTO bank_accounts(id,banco,conta) VALUES(1,'Cora','123'),(2,'Outra','456');
    INSERT INTO bank_transactions VALUES(1,1),(2,1),(3,1),(4,1),(5,2);
    INSERT INTO bpo_lancamentos(id,bank_transaction_id,origem_efetiva,asaas_payment_id,vinculo_operacional_id) VALUES
      (1,1,'extrato',null,null),(2,2,'manual',null,null),(3,3,'extrato','pay-legitimo',null),(4,4,'extrato',null,'obra-1'),(5,5,'extrato',null,null);
  `);
  vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
});
afterEach(async () => { await pg.close(); });
describe("limpeza financeira por origem", () => {
  it("remove somente derivado exclusivo do extrato, preservando manual conciliado, Asaas, operação e outra conta", async () => {
    expect(await previaLimpezaConta(1)).toMatchObject({ transacoes: 4, lancamentosRemovidos: 1, lancamentosPreservados: 3 });
    await limparContaComBackup(1, "Cora · 123", 9);
    expect((await pg.query("select id,bank_transaction_id from bpo_lancamentos order by id")).rows).toEqual([
      { id: 2, bank_transaction_id: null }, { id: 3, bank_transaction_id: null }, { id: 4, bank_transaction_id: null }, { id: 5, bank_transaction_id: 5 },
    ]);
    const backup = (await pg.query<{ snapshot_json: string }>("select snapshot_json from bpo_conta_limpeza_backups")).rows[0];
    expect(JSON.parse(backup.snapshot_json).lancamentos).toHaveLength(4);
    expect((await pg.query("select id from bank_accounts")).rows).toEqual([{ id: 2 }]);
  });
  it("confirmação incorreta não altera dados", async () => {
    await expect(limparContaComBackup(1, "Outra", 9)).rejects.toThrow(/exatamente/);
    expect((await pg.query("select count(*)::int n from bank_transactions")).rows[0]).toEqual({ n: 5 });
  });
  it("despesa de comissão usa imóveis; receita usa comissões", () => {
    expect(catalogoDaCategoria("despesa", "comissoes")).toBe("imoveis");
    expect(catalogoDaCategoria("cobranca", "comissoes")).toBe("comissoes");
  });
});
