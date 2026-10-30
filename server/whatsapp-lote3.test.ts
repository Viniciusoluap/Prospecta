// Lote 03 (29/10/2026) — correções 01 a 04 da Central WhatsApp, num Postgres em memória (PGlite) com a
// migração 0094 aplicada. Nada externo é chamado (sem Evolution/Business).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
const lixeira = vi.hoisted(() => vi.fn(async (_id: string | null | undefined) => undefined));
vi.mock("./drive-organizacao.js", async orig => ({ ...(await orig<typeof import("./drive-organizacao.js")>()), lixeiraDoArquivo: lixeira }));
import * as banco from "./db.js";
import { financiamentos, leadDocuments, leadServices, leads, users, whatsappConnections, whatsappMessages, whatsappMidias } from "../drizzle/schema.js";
import { router } from "./_core/trpc.js";
import { whatsappRouter } from "./whatsapp-router.js";
import {
  alternarItem, alternarTodosVisiveis, candidatosVinculo, chaveTelefone, inicioPeriodo, podarSelecao, resolverLeadConversa, taxaLeitura, textoConfirmacaoExclusao,
} from "../shared/whatsapp/conversas.js";

const pg = new PGlite();
const app = router({ whatsapp: whatsappRouter });
const ctx = (user: Record<string, unknown>) => ({ user: { active: true, ...user }, req: {}, res: {} }) as never;
const admin = app.createCaller(ctx({ id: 1, role: "admin", name: "Admin" }));
const corretor = app.createCaller(ctx({ id: 7, role: "corretor", name: "Corretora" }));

/** Tabela a partir do schema Drizzle (enums viram texto; sem NOT NULL para simplificar os dados de teste). */
function ddl(t: PgTable) {
  const c = getTableConfig(t);
  const cols = c.columns.map(x => {
    if (x.name === "id" && x.getSQLType() === "serial") return `"id" serial PRIMARY KEY`;
    const tipo = x.columnType === "PgEnumColumn" ? "text" : x.getSQLType();
    let def = "";
    if (x.hasDefault && /^timestamp/.test(tipo)) def = " DEFAULT now()";
    else if (["string", "number", "boolean"].includes(typeof x.default)) def = ` DEFAULT ${typeof x.default === "string" ? `'${x.default}'` : String(x.default)}`;
    return `"${x.name}" ${tipo}${def}${x.name === "id" ? " PRIMARY KEY" : ""}`;
  });
  return `CREATE TABLE "${c.name}" (${cols.join(", ")});`;
}

beforeAll(async () => {
  for (const t of [users, leads, leadServices, financiamentos, leadDocuments, whatsappConnections, whatsappMessages]) await pg.exec(ddl(t));
  await pg.exec(`CREATE TABLE whatsapp_midias (id serial PRIMARY KEY, message_id integer NOT NULL UNIQUE REFERENCES whatsapp_messages(id) ON DELETE CASCADE, drive_file_id varchar(255), created_at timestamp DEFAULT now());`);
  const m = readFileSync(new URL("../drizzle/0094_whatsapp_vinculo.sql", import.meta.url), "utf8");
  await pg.exec(m); await pg.exec(m); // idempotente
  vi.spyOn(banco, "getDb").mockReturnValue(drizzle(pg) as never);
});
afterAll(() => pg.close());

const dias = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
async function cenario() {
  await pg.exec(`TRUNCATE whatsapp_conversation_links, whatsapp_midias, whatsapp_messages, whatsapp_connections, leads, users RESTART IDENTITY CASCADE;`);
  await pg.exec(`
    INSERT INTO users (id, role, name) VALUES (1, 'admin', 'Admin'), (7, 'corretor', 'Corretora'), (8, 'corretor', 'Outro');
    INSERT INTO whatsapp_connections (id, user_id, provider, status, instancia) VALUES (3, 1, 'evolution', 'conectado', 'prospecta-u1'), (4, 7, 'evolution', 'conectado', 'prospecta-u7');
    INSERT INTO leads (id, name, phone, cpf, broker_id, deleted_at, created_at) VALUES
      (10, 'Ana Souza', '(99) 98139-2210', '111.222.333-44', 7, NULL, now()),
      (11, 'Ana Duplicada', '99981392210', NULL, 8, NULL, now()),
      (12, 'André Renan', '(99) 97777-0000', NULL, 1, '2026-10-26', now()),
      (13, 'Bruno Lima', '(99) 96666-0000', '555.666.777-88', 7, NULL, now());
  `);
}
async function msg(conn: number, destinatario: string, extra: Record<string, unknown> = {}) {
  const v = { status: "recebida", direcao: "entrada", lida: false, mensagem: "oi", lead_id: null, created_at: dias(1), ...extra };
  const r = await pg.query<{ id: number }>(
    `INSERT INTO whatsapp_messages (connection_id, destinatario, mensagem, status, direcao, lida, lead_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [conn, destinatario, v.mensagem, v.status, v.direcao, v.lida, v.lead_id, v.created_at],
  );
  return r.rows[0].id;
}
const contar = async (sql: string) => Number((await pg.query<{ n: number }>(sql)).rows[0].n);

describe("regras puras (shared/whatsapp/conversas)", () => {
  it("chave do telefone ignora 55, máscara e 9º dígito", () => {
    expect(chaveTelefone("+55 (99) 98139-2210")).toBe(chaveTelefone("9981392210"));
    expect(chaveTelefone("123")).toBe("123");
  });
  it("vínculo manual vence a inferência pelo telefone, que vence o lead gravado", () => {
    expect(resolverLeadConversa({ manual: 2, porTelefone: 1, gravado: 3 })).toEqual({ leadId: 2, origem: "manual" });
    expect(resolverLeadConversa({ porTelefone: 1, gravado: 3 })).toEqual({ leadId: 1, origem: "telefone" });
    expect(resolverLeadConversa({ gravado: 3 })).toEqual({ leadId: 3, origem: "mensagem" });
    expect(resolverLeadConversa({})).toEqual({ leadId: null, origem: null });
  });
  it("seleção: alternar, selecionar todos os visíveis (e desmarcar) e podar removidos", () => {
    expect(alternarItem(["a"], "b")).toEqual(["a", "b"]);
    expect(alternarItem(["a", "b"], "a")).toEqual(["b"]);
    expect(alternarTodosVisiveis(["x"], ["a", "b"])).toEqual(["x", "a", "b"]);
    expect(alternarTodosVisiveis(["x", "a", "b"], ["a", "b"])).toEqual(["x"]);
    expect(alternarTodosVisiveis([], [])).toEqual([]);
    const sel = [1, 2];
    expect(podarSelecao(sel, [1, 2, 3])).toBe(sel);
    expect(podarSelecao([1, 2, 3], [1, 3])).toEqual([1, 3]);
  });
  it("busca de candidatos por nome sem acento, telefone e CPF; mesmo telefone primeiro", () => {
    const lista = [
      { id: 1, nome: "José André", telefone: "(99) 98139-2210", cpf: "111.222.333-44" },
      { id: 2, nome: "Maria", telefone: "11 90000-0000", cpf: null },
      { id: 3, nome: "Andressa", telefone: "9981392210", cpf: null },
    ];
    expect(candidatosVinculo(lista, "", "5599981392210").map(l => l.id)).toEqual([3, 1]);
    expect(candidatosVinculo(lista, "andre", null).map(l => l.id)).toEqual([3, 1]);
    expect(candidatosVinculo(lista, "222333", null).map(l => l.id)).toEqual([1]);
    expect(candidatosVinculo(lista, "(11) 90000-0000", null).map(l => l.id)).toEqual([2]);
  });
  it("período do dashboard, taxa e texto da confirmação", () => {
    const agora = new Date("2026-10-29T12:00:00Z");
    expect(inicioPeriodo("7", agora)?.toISOString()).toBe("2026-10-22T12:00:00.000Z");
    expect(inicioPeriodo("tudo", agora)).toBeNull();
    expect(taxaLeitura(0, 0)).toBe(0);
    expect(taxaLeitura(150, 50)).toBe(33);
    expect(textoConfirmacaoExclusao(2, 5)).toMatch(/2 conversas \(5 mensagens\).*continuam no celular/);
    expect(textoConfirmacaoExclusao(1, 1)).toMatch(/1 conversa \(1 mensagem\)/);
  });
});

describe("01 — exclusão de conversas em lote", () => {
  beforeEach(cenario);

  it("prévia conta conversas e mensagens; exclusão apaga só as escolhidas (com mídia) numa transação e registra auditoria sem dados pessoais", async () => {
    const a1 = await msg(3, "5599981392210");
    await msg(3, "559981392210"); // mesmo número sem o 9º dígito
    await msg(3, "5511955554444");
    const fica = await msg(3, "5521944443333");
    await msg(4, "5599981392210"); // outra conexão: não é tocada
    await pg.query(`INSERT INTO whatsapp_midias (message_id, drive_file_id) VALUES ($1, 'drive-a1')`, [a1]);
    lixeira.mockClear();
    expect(await admin.whatsapp.previaExclusaoConversas({ numeros: ["99981392210", "5511955554444"] })).toEqual({ conversas: 2, mensagens: 3 });

    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    expect(await admin.whatsapp.excluirConversas({ numeros: ["99981392210", "5511955554444"] })).toEqual({ conversas: 2, apagadas: 3 });
    expect((await pg.query(`SELECT id FROM whatsapp_messages WHERE connection_id = 3`)).rows).toEqual([{ id: fica }]);
    expect(await contar(`SELECT count(*) n FROM whatsapp_messages WHERE connection_id = 4`)).toBe(1);
    expect(await contar(`SELECT count(*) n FROM whatsapp_midias`)).toBe(0);
    // Revisão PR #180 (P2): a cópia da mídia no Drive vai para a lixeira, como em excluirConversa.
    expect(lixeira.mock.calls).toEqual([["drive-a1"]]);
    expect(await contar(`SELECT count(*) n FROM leads`)).toBe(4); // CRM intacto
    const registro = String(log.mock.calls.at(-1)?.[0]);
    log.mockRestore();
    expect(JSON.parse(registro)).toMatchObject({ evento: "whatsapp.conversas_excluidas", usuarioId: 1, conversas: 2, mensagens: 3 });
    expect(registro).not.toMatch(/9981392210|5511955554444/);
  });

  it("corretor: se uma conversa é de lead de outro corretor, nada é apagado", async () => {
    await msg(4, "5599966660000"); // Bruno (lead 13, da corretora)
    await msg(4, "5588900001111", { lead_id: 11 }); // lead 11 é de outro corretor
    await expect(corretor.whatsapp.excluirConversas({ numeros: ["5599966660000", "5588900001111"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await contar(`SELECT count(*) n FROM whatsapp_messages`)).toBe(2);
    expect(await corretor.whatsapp.excluirConversas({ numeros: ["5599966660000"] })).toEqual({ conversas: 1, apagadas: 1 });
  });
});

describe("02 — vincular lead com prioridade sobre o telefone", () => {
  beforeEach(cenario);

  it("telefone em dois leads: lista ambos; vínculo manual vence a inferência e pode ser desfeito", async () => {
    await msg(3, "5599981392210");
    const cand = await admin.whatsapp.buscarLeadsParaVincular({ numero: "5599981392210", termo: "" });
    expect(cand.map(c => c.id).sort()).toEqual([10, 11]);
    expect(cand.every(c => c.mesmoTelefone)).toBe(true);

    const antes = (await admin.whatsapp.conversas())[0];
    expect(antes.vinculo).toBe("telefone");
    const inferido = antes.leadId;
    const escolhido = inferido === 10 ? 11 : 10;

    await admin.whatsapp.vincularLead({ numero: "5599981392210", leadId: escolhido });
    const depois = (await admin.whatsapp.conversas())[0];
    expect(depois).toMatchObject({ leadId: escolhido, vinculo: "manual", nome: escolhido === 10 ? "Ana Souza" : "Ana Duplicada" });
    // Mensagem nova (webhook grava pela inferência) não derruba o vínculo.
    await msg(3, "5599981392210", { lead_id: inferido });
    expect((await admin.whatsapp.conversas())[0]).toMatchObject({ leadId: escolhido, vinculo: "manual" });
    // O cadastro do lead não muda.
    expect((await pg.query(`SELECT name, phone FROM leads WHERE id = $1`, [escolhido])).rows[0]).toEqual(escolhido === 10 ? { name: "Ana Souza", phone: "(99) 98139-2210" } : { name: "Ana Duplicada", phone: "99981392210" });

    await admin.whatsapp.desvincularLead({ numero: "5599981392210" });
    expect((await admin.whatsapp.conversas())[0].vinculo).toBe("telefone");
    expect(await contar(`SELECT count(*) n FROM whatsapp_conversation_links`)).toBe(0);
  });

  it("busca por CPF; lead excluído não aparece nem pode ser vinculado; corretor só vincula os próprios", async () => {
    await msg(3, "5521944443333");
    expect((await admin.whatsapp.buscarLeadsParaVincular({ numero: "5521944443333", termo: "555.666" })).map(l => l.id)).toEqual([13]);
    expect(await admin.whatsapp.buscarLeadsParaVincular({ numero: "5521944443333", termo: "André" })).toEqual([]);
    await expect(admin.whatsapp.vincularLead({ numero: "5521944443333", leadId: 12 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await msg(4, "5521944443333");
    await expect(corretor.whatsapp.vincularLead({ numero: "5521944443333", leadId: 11 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(corretor.whatsapp.vincularLead({ numero: "5521944443333", leadId: 13 })).resolves.toEqual({ leadId: 13 });
  });

  it("criar lead avisa quando o telefone já existe; com confirmação cria e já vincula", async () => {
    await msg(3, "5599981392210");
    await expect(admin.whatsapp.criarLeadDaConversa({ numero: "5599981392210", nome: "Nova" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await contar(`SELECT count(*) n FROM leads`)).toBe(4);
    const r = await admin.whatsapp.criarLeadDaConversa({ numero: "5599981392210", nome: "Nova", forcar: true });
    expect((await admin.whatsapp.conversas())[0]).toMatchObject({ leadId: r.leadId, vinculo: "manual" });
  });
});

describe("03 — destinatários só de leads ativos", () => {
  beforeEach(cenario);

  it("André Renan (excluído em 26/10) não aparece na lista, na prévia nem nos documentos", async () => {
    const lista = await admin.whatsapp.leadsParaEnvio();
    expect(lista.map(l => l.name)).not.toContain("André Renan");
    expect(lista).toHaveLength(3);
    expect((await corretor.whatsapp.leadsParaEnvio()).map(l => l.id).sort()).toEqual([10, 13]);
    expect((await admin.whatsapp.previaEnvio({ mensagem: "Oi {{nome}}", ids: [10, 12] })).map(p => p.id)).toEqual([10]);
    expect((await admin.whatsapp.documentosParaEnvio({ ids: [10, 12] })).map(d => d.id)).toEqual([10]);
  });
});

describe("04 — Mensagens Enviadas contadas no banco, por período", () => {
  beforeEach(cenario);

  it("passa de 100, ignora falhas e entradas e respeita o período", async () => {
    const valores: string[] = [];
    for (let i = 0; i < 150; i++) valores.push(`(3, '55999', 'x', '${["enviada", "entregue", "lida"][i % 3]}', 'saida', true, '${dias(2)}')`);
    for (let i = 0; i < 5; i++) valores.push(`(3, '55999', 'x', 'falhou', 'saida', true, '${dias(2)}')`);
    for (let i = 0; i < 20; i++) valores.push(`(3, '55999', 'x', 'enviada', 'saida', true, '${dias(45)}')`);
    for (let i = 0; i < 7; i++) valores.push(`(3, '55999', 'x', 'recebida', 'entrada', false, '${dias(1)}')`);
    await pg.exec(`INSERT INTO whatsapp_messages (connection_id, destinatario, mensagem, status, direcao, lida, created_at) VALUES ${valores.join(",")};`);

    expect(await admin.whatsapp.resumoEnvios()).toMatchObject({ periodo: "30", enviadas: 150, lidas: 50, falhas: 5, taxaLeitura: 33 });
    expect(await admin.whatsapp.resumoEnvios({ periodo: "90" })).toMatchObject({ enviadas: 170, falhas: 5 });
    expect(await admin.whatsapp.resumoEnvios({ periodo: "tudo" })).toMatchObject({ enviadas: 170, desde: null });
    expect(await admin.whatsapp.resumoEnvios({ periodo: "7" })).toMatchObject({ enviadas: 150 });
    // Corretor vê só a própria conexão (sem envios).
    expect(await corretor.whatsapp.resumoEnvios({ periodo: "tudo" })).toMatchObject({ enviadas: 0, falhas: 0 });
  });
});
