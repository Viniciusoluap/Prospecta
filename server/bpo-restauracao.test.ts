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
import { excluirLancamentosEmLote } from "./bpo-lote.js";
import { listarExclusoesEmLote, previaRestauracaoExclusao, restaurarExclusaoEmLote } from "./bpo-restauracao.js";

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
    CREATE TABLE obra_movimentos (id serial PRIMARY KEY, bpo_lancamento_id integer REFERENCES bpo_lancamentos(id) ON DELETE RESTRICT);
    CREATE TABLE regularizacao_recebimentos (id serial PRIMARY KEY, bpo_lancamento_id integer REFERENCES bpo_lancamentos(id) ON DELETE RESTRICT);
    INSERT INTO users (name) VALUES ('Admin Teste');
    INSERT INTO bpo_clients (razao_social, responsavel, telefone, honorarios, data_inicio) VALUES ('Cliente Apagado', 'X', '', 0, now());`);
  vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
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
