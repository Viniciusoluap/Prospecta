// EPIC-024 S-12 — termo de consentimento no primeiro acesso. Banco em memória (PGlite): tabela `users` gerada do schema
// Drizzle + migração 0127 aplicada duas vezes (idempotência). Rotas pelo appRouter com o caminho completo.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));

import * as schema from "../drizzle/schema.js";
import { ADMIN_MODULES } from "../shared/admin-permissions.js";
import { ENDERECO_DA_SEDE } from "../shared/empresa.js";
import { FRASE_CURTA_DO_TERMO, PENDENCIAS_DO_JURIDICO, SECOES_DO_TERMO, TITULO_DO_TERMO, VERSAO_DO_TERMO } from "../shared/termo-consentimento.js";
import { verifyPassword } from "./_core/auth-utils.js";
import { aparelhoDoUserAgent, ehPrimeiroAcesso, gravarSenhaComAceite, MENSAGEM_SEM_ACEITE, MENSAGEM_VERSAO_ERRADA, pedirAceiteNoLogin } from "./consentimento.js";
import { getDb } from "./db.js";
import { appRouter } from "./routers.js";

let ddl: string | null = null;
let pg: PGlite;
let db: ReturnType<typeof drizzle>;
const migracao = readFileSync(new URL("../drizzle/0127_consentimentos.sql", import.meta.url), "utf8");

async function criarBanco() {
  if (!ddl) {
    const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
    const escolhidas: Record<string, unknown> = {};
    for (const [nome, valor] of Object.entries(schema)) if (nome === "users" || nome === "leads" || nome.endsWith("Enum")) escolhidas[nome] = valor;
    ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n");
  }
  pg = new PGlite();
  await pg.exec(ddl);
  await pg.exec(migracao);
  await pg.exec(migracao); // idempotente
  db = drizzle(pg);
  vi.mocked(getDb).mockReturnValue(db as never);
}

const futuro = () => new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString();
/** Conta nova (criada hoje, depois do início do termo) com link válido. */
async function contaNova(token = "tok-novo") {
  await pg.query(`INSERT INTO users ("openId", name, email, role, active, "passwordHash", "tokenPrimeiroAcesso", "tokenPrimeiroAcessoExpiraEm", "createdAt")
    VALUES ($1, 'Ana Nova', $2, 'colaborador', true, 'placeholder', $3, $4, '2026-11-20')`, [`o-${token}`, `${token}@x.com`, token, futuro()]);
  return (await pg.query<{ id: number }>(`SELECT id FROM users WHERE "tokenPrimeiroAcesso" = $1`, [token])).rows[0].id;
}
/** Conta antiga (de 2025) que está redefinindo a senha por link do admin. */
async function contaAntiga(token = "tok-antigo") {
  await pg.query(`INSERT INTO users ("openId", name, email, role, active, "passwordHash", "tokenPrimeiroAcesso", "tokenPrimeiroAcessoExpiraEm", "createdAt")
    VALUES ($1, 'Beto Antigo', $2, 'corretor', true, 'hash-antigo', $3, $4, '2025-03-01')`, [`o-${token}`, `${token}@x.com`, token, futuro()]);
  return (await pg.query<{ id: number }>(`SELECT id FROM users WHERE "tokenPrimeiroAcesso" = $1`, [token])).rows[0].id;
}
const aceites = async () => (await pg.query<any>("SELECT * FROM consentimentos ORDER BY id")).rows;
const hashDe = async (id: number) => (await pg.query<any>(`SELECT "passwordHash", "tokenPrimeiroAcesso" FROM users WHERE id = $1`, [id])).rows[0];
const publico = () => appRouter.createCaller({ user: null, req: { headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148" } }, res: {} } as never);
const caller = (id: number, role: string, permissoes: string[] = [], active = true) =>
  appRouter.createCaller({ user: { id, role, active, permissions: JSON.stringify(permissoes) }, req: { headers: {} }, res: {} } as never);

beforeEach(criarBanco);
afterEach(() => { vi.clearAllMocks(); delete process.env.CONSENTIMENTO_PEDIR_NO_LOGIN; });

describe("primeiro acesso: o servidor exige o aceite", () => {
  it("a tela recebe 'obrigatorio' para conta nova; sem aceite a senha NÃO é gravada e nada vai para consentimentos", async () => {
    const id = await contaNova();
    expect(await publico().primeiroAcesso.validarToken({ token: "tok-novo" })).toMatchObject({ valido: true, termo: "obrigatorio", versaoDoTermo: VERSAO_DO_TERMO });
    await expect(publico().primeiroAcesso.definirSenha({ token: "tok-novo", novaSenha: "senha-forte-1" })).rejects.toMatchObject({ message: MENSAGEM_SEM_ACEITE });
    await expect(publico().primeiroAcesso.definirSenha({ token: "tok-novo", novaSenha: "senha-forte-1", aceitouTermo: false, versaoDoTermo: VERSAO_DO_TERMO })).rejects.toMatchObject({ message: MENSAGEM_SEM_ACEITE });
    expect((await hashDe(id)).passwordHash).toBe("placeholder");
    expect((await hashDe(id)).tokenPrimeiroAcesso).toBe("tok-novo");
    expect(await aceites()).toEqual([]);
  });

  it("versão errada ou ausente é recusada, mesmo com a caixa marcada", async () => {
    const id = await contaNova();
    await expect(publico().primeiroAcesso.definirSenha({ token: "tok-novo", novaSenha: "senha-forte-1", aceitouTermo: true, versaoDoTermo: "2020-01-01.1" })).rejects.toMatchObject({ message: MENSAGEM_VERSAO_ERRADA });
    await expect(publico().primeiroAcesso.definirSenha({ token: "tok-novo", novaSenha: "senha-forte-1", aceitouTermo: true })).rejects.toMatchObject({ message: MENSAGEM_VERSAO_ERRADA });
    expect((await hashDe(id)).passwordHash).toBe("placeholder");
    expect(await aceites()).toEqual([]);
  });

  it("com o aceite: senha e aceite gravados juntos (versão, canal, aparelho, sem IP nem user-agent); o link não serve de novo", async () => {
    const id = await contaNova();
    expect(await publico().primeiroAcesso.definirSenha({ token: "tok-novo", novaSenha: "senha-forte-1", aceitouTermo: true, versaoDoTermo: VERSAO_DO_TERMO })).toEqual({ success: true });
    const linha = await hashDe(id);
    expect(verifyPassword("senha-forte-1", linha.passwordHash)).toBe(true);
    expect(linha.tokenPrimeiroAcesso).toBeNull();
    const [a, ...resto] = await aceites();
    expect(resto).toEqual([]);
    expect(a).toMatchObject({ user_id: id, versao_termo: VERSAO_DO_TERMO, canal: "definir_senha", aparelho: "celular", com_senha: true });
    expect(Object.keys(a).sort()).toEqual(["aceito_em", "aparelho", "canal", "com_senha", "id", "user_id", "versao_termo"]);
    await expect(publico().primeiroAcesso.definirSenha({ token: "tok-novo", novaSenha: "outra-senha-2", aceitouTermo: true, versaoDoTermo: VERSAO_DO_TERMO })).rejects.toMatchObject({ message: "Link inválido ou expirado" });
    expect(await aceites()).toHaveLength(1);
  });

  it("falha ao gravar o aceite desfaz a senha (mesma transação)", async () => {
    const id = await contaNova();
    // força o INSERT em consentimentos a falhar
    await pg.exec(`CREATE OR REPLACE FUNCTION falhar() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'falha simulada'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER t_falhar BEFORE INSERT ON consentimentos FOR EACH ROW EXECUTE FUNCTION falhar();`);
    await expect(gravarSenhaComAceite(db as never, { userId: id, token: "tok-novo", novaSenha: "senha-forte-1", gravarAceite: true, aparelho: "computador" })).rejects.toThrow(/insert into "consentimentos"/);
    const linha = await hashDe(id);
    expect(linha.passwordHash).toBe("placeholder");
    expect(linha.tokenPrimeiroAcesso).toBe("tok-novo");
    expect(await aceites()).toEqual([]);
  });

  it("link vencido/reusado não grava aceite (não existe aceite sem senha)", async () => {
    const id = await contaNova();
    expect(await gravarSenhaComAceite(db as never, { userId: id, token: "token-errado", novaSenha: "senha-forte-1", gravarAceite: true, aparelho: "computador" })).toBe(false);
    expect(await aceites()).toEqual([]);
  });

  it("convite antigo ainda não usado (link emitido no cadastro) também exige o aceite", () => {
    const criada = new Date("2026-11-12T15:00:00Z");
    expect(ehPrimeiroAcesso({ createdAt: criada, tokenExpiraEm: new Date(criada.getTime() + 7 * 86400000 + 2000) })).toBe(true);
    expect(ehPrimeiroAcesso({ createdAt: criada, tokenExpiraEm: new Date(criada.getTime() + 9 * 86400000) })).toBe(false);
    expect(ehPrimeiroAcesso({ createdAt: new Date("2026-11-17T12:00:00Z"), tokenExpiraEm: null })).toBe(true);
  });
});

describe("redefinição de senha", () => {
  it("quem já aceitou a versão atual não é perguntado de novo e não ganha aceite duplicado", async () => {
    const id = await contaNova();
    await publico().primeiroAcesso.definirSenha({ token: "tok-novo", novaSenha: "senha-forte-1", aceitouTermo: true, versaoDoTermo: VERSAO_DO_TERMO });
    await pg.query(`UPDATE users SET "tokenPrimeiroAcesso" = 'tok-reset', "tokenPrimeiroAcessoExpiraEm" = $1 WHERE id = $2`, [futuro(), id]);
    expect(await publico().primeiroAcesso.validarToken({ token: "tok-reset" })).toMatchObject({ termo: "aceito" });
    expect(await publico().primeiroAcesso.definirSenha({ token: "tok-reset", novaSenha: "senha-nova-22" })).toEqual({ success: true });
    expect(verifyPassword("senha-nova-22", (await hashDe(id)).passwordHash)).toBe(true);
    expect(await aceites()).toHaveLength(1);
  });

  it("conta antiga que nunca aceitou não é bloqueada (caixa opcional); se marcar, o aceite é gravado", async () => {
    const id = await contaAntiga();
    expect(await publico().primeiroAcesso.validarToken({ token: "tok-antigo" })).toMatchObject({ termo: "opcional" });
    expect(await publico().primeiroAcesso.definirSenha({ token: "tok-antigo", novaSenha: "senha-forte-1" })).toEqual({ success: true });
    expect(await aceites()).toEqual([]);
    await pg.query(`UPDATE users SET "tokenPrimeiroAcesso" = 'tok-2', "tokenPrimeiroAcessoExpiraEm" = $1 WHERE id = $2`, [futuro(), id]);
    await publico().primeiroAcesso.definirSenha({ token: "tok-2", novaSenha: "senha-forte-2", aceitouTermo: true, versaoDoTermo: VERSAO_DO_TERMO });
    expect(await aceites()).toMatchObject([{ user_id: id, canal: "definir_senha", com_senha: true }]);
  });

  it("aceite de versão anterior: redefinir não bloqueia (nova versão não invalida acessos)", async () => {
    const id = await contaNova();
    await pg.query(`INSERT INTO consentimentos (user_id, versao_termo, canal, com_senha) VALUES ($1, '2026-01-01.1', 'definir_senha', true)`, [id]);
    expect(await publico().primeiroAcesso.validarToken({ token: "tok-novo" })).toMatchObject({ termo: "opcional" });
    expect(await publico().primeiroAcesso.definirSenha({ token: "tok-novo", novaSenha: "senha-forte-1" })).toEqual({ success: true });
  });
});

describe("tabela só de inclusão", () => {
  it("UPDATE, DELETE e TRUNCATE são recusados pelo banco", async () => {
    const id = await contaNova();
    await publico().primeiroAcesso.definirSenha({ token: "tok-novo", novaSenha: "senha-forte-1", aceitouTermo: true, versaoDoTermo: VERSAO_DO_TERMO });
    await expect(pg.query(`UPDATE consentimentos SET versao_termo = 'x'`)).rejects.toThrow(/CONSENTIMENTO_SO_INCLUSAO/);
    await expect(pg.query(`DELETE FROM consentimentos`)).rejects.toThrow(/CONSENTIMENTO_SO_INCLUSAO/);
    await expect(pg.query(`TRUNCATE consentimentos`)).rejects.toThrow(/CONSENTIMENTO_SO_INCLUSAO/);
    await expect(pg.query(`INSERT INTO consentimentos (user_id, versao_termo, canal) VALUES ($1, 'v', 'qualquer')`, [id])).rejects.toThrow();
    expect(await aceites()).toHaveLength(1);
  });

  it("excluir a conta continua possível e a prova do aceite permanece", async () => {
    const id = await contaNova();
    await publico().primeiroAcesso.definirSenha({ token: "tok-novo", novaSenha: "senha-forte-1", aceitouTermo: true, versaoDoTermo: VERSAO_DO_TERMO });
    await pg.query(`DELETE FROM users WHERE id = $1`, [id]);
    expect(await aceites()).toMatchObject([{ user_id: id }]);
  });
});

describe("opção 'pedir o aceite no próximo login' (item 4)", () => {
  it("vem DESLIGADA por padrão: ninguém é perguntado e o aceite por login é recusado", async () => {
    const id = await contaAntiga();
    expect(pedirAceiteNoLogin({})).toBe(false);
    expect(pedirAceiteNoLogin({ CONSENTIMENTO_PEDIR_NO_LOGIN: "1" })).toBe(true);
    expect(await caller(id, "corretor").consentimento.minhaSituacao()).toEqual({ pedir: false, versao: VERSAO_DO_TERMO });
    await expect(caller(id, "corretor").consentimento.aceitar({ aceitouTermo: true, versaoDoTermo: VERSAO_DO_TERMO })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await aceites()).toEqual([]);
  });

  it("ligada: pede uma vez, exige a caixa e a versão, grava canal 'login' e para de pedir", async () => {
    process.env.CONSENTIMENTO_PEDIR_NO_LOGIN = "1";
    const id = await contaAntiga();
    const c = caller(id, "corretor");
    expect(await c.consentimento.minhaSituacao()).toMatchObject({ pedir: true });
    await expect(c.consentimento.aceitar({ aceitouTermo: false, versaoDoTermo: VERSAO_DO_TERMO })).rejects.toMatchObject({ message: MENSAGEM_SEM_ACEITE });
    await expect(c.consentimento.aceitar({ aceitouTermo: true, versaoDoTermo: "velha" })).rejects.toMatchObject({ message: MENSAGEM_VERSAO_ERRADA });
    expect(await c.consentimento.aceitar({ aceitouTermo: true, versaoDoTermo: VERSAO_DO_TERMO })).toEqual({ ok: true, jaAceito: false });
    expect(await c.consentimento.aceitar({ aceitouTermo: true, versaoDoTermo: VERSAO_DO_TERMO })).toEqual({ ok: true, jaAceito: true });
    expect(await c.consentimento.minhaSituacao()).toMatchObject({ pedir: false });
    expect(await aceites()).toMatchObject([{ user_id: id, canal: "login", com_senha: false }]);
  });

  it("sem login: a situação responde 'não pedir' e o aceite responde UNAUTHORIZED", async () => {
    process.env.CONSENTIMENTO_PEDIR_NO_LOGIN = "1";
    expect(await publico().consentimento.minhaSituacao()).toMatchObject({ pedir: false });
    await expect(publico().consentimento.aceitar({ aceitouTermo: true, versaoDoTermo: VERSAO_DO_TERMO })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("conta criada já com senha pelo admin aceita no PRIMEIRO LOGIN (QA S-12, achado 1)", () => {
  const linhaDe = async (id: number) => (await pg.query<any>(`SELECT * FROM users WHERE id = $1`, [id])).rows[0];
  /** Contexto como o de produção: `ctx.user` é a linha inteira lida pelo Drizzle (createdAt já é Date). */
  const logado = async (id: number) => {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    return appRouter.createCaller({ user: u, req: { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }, res: { clearCookie: () => {} } } as never);
  };

  it("portal.admin.provisionAccess (conta nova): pede o termo no login com a opção DESLIGADA, grava canal 'login' e para de pedir", async () => {
    const [lead] = (await pg.query<any>(`INSERT INTO leads (name, phone) VALUES ('Cliente Novo', '9999') RETURNING id`)).rows;
    const r = await caller(99, "admin").portal.admin.provisionAccess({ leadId: lead.id, email: "cli@x.com", password: "senha-do-admin-1" });
    expect(pedirAceiteNoLogin()).toBe(false);
    const c = await logado(r.id);
    expect(await c.consentimento.minhaSituacao()).toEqual({ pedir: true, versao: VERSAO_DO_TERMO });
    await expect(c.consentimento.aceitar({ aceitouTermo: false, versaoDoTermo: VERSAO_DO_TERMO })).rejects.toMatchObject({ message: MENSAGEM_SEM_ACEITE });
    await expect(c.consentimento.aceitar({ aceitouTermo: true, versaoDoTermo: "2020-01-01.1" })).rejects.toMatchObject({ message: MENSAGEM_VERSAO_ERRADA });
    expect(await aceites()).toEqual([]);
    expect(await c.consentimento.aceitar({ aceitouTermo: true, versaoDoTermo: VERSAO_DO_TERMO })).toEqual({ ok: true, jaAceito: false });
    expect(await c.consentimento.minhaSituacao()).toMatchObject({ pedir: false });
    expect(await c.consentimento.aceitar({ aceitouTermo: true, versaoDoTermo: VERSAO_DO_TERMO })).toEqual({ ok: true, jaAceito: true });
    expect(await aceites()).toMatchObject([{ user_id: r.id, versao_termo: VERSAO_DO_TERMO, canal: "login", aparelho: "computador", com_senha: false }]);
  });

  it("conta criada pelo /api/auth/setup-admin (insert direto, createdAt do banco) também é perguntada no login", async () => {
    await pg.query(`INSERT INTO users ("openId", name, email, role, "passwordHash") VALUES ('admin_1', 'Admin', 'adm@x.com', 'admin', 'h')`);
    const { id } = (await pg.query<any>(`SELECT id FROM users WHERE email = 'adm@x.com'`)).rows[0];
    expect(await (await logado(id)).consentimento.minhaSituacao()).toMatchObject({ pedir: true });
  });

  it("re-provisionar uma conta ANTIGA não muda nada: continua sem pergunta e o aceite pelo login é recusado", async () => {
    const id = await contaAntiga();
    const [lead] = (await pg.query<any>(`INSERT INTO leads (name, phone) VALUES ('Beto', '9999') RETURNING id`)).rows;
    await pg.query(`UPDATE users SET role = 'cliente', lead_id = $1 WHERE id = $2`, [lead.id, id]);
    await caller(99, "admin").portal.admin.provisionAccess({ leadId: lead.id, email: (await linhaDe(id)).email, password: "senha-do-admin-1" });
    const c = await logado(id);
    expect(await c.consentimento.minhaSituacao()).toEqual({ pedir: false, versao: VERSAO_DO_TERMO });
    await expect(c.consentimento.aceitar({ aceitouTermo: true, versaoDoTermo: VERSAO_DO_TERMO })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("conta nova que já aceitou (ao criar a senha, ou uma versão anterior) não é perguntada no login com a opção desligada", async () => {
    const id = await contaNova();
    await publico().primeiroAcesso.definirSenha({ token: "tok-novo", novaSenha: "senha-forte-1", aceitouTermo: true, versaoDoTermo: VERSAO_DO_TERMO });
    expect(await (await logado(id)).consentimento.minhaSituacao()).toMatchObject({ pedir: false });
    const outra = await contaNova("tok-outra");
    await pg.query(`INSERT INTO consentimentos (user_id, versao_termo, canal, com_senha) VALUES ($1, '2026-11-17.1', 'definir_senha', true)`, [outra]);
    expect(await (await logado(outra)).consentimento.minhaSituacao()).toMatchObject({ pedir: false });
  });

  it("LIMITAÇÃO registrada: sem o aceite, o servidor ainda atende as outras rotas — a trava é o modal do cliente", async () => {
    const [lead] = (await pg.query<any>(`INSERT INTO leads (name, phone) VALUES ('Cliente Novo', '9999') RETURNING id`)).rows;
    const r = await caller(99, "admin").portal.admin.provisionAccess({ leadId: lead.id, email: "cli2@x.com", password: "senha-do-admin-1" });
    // só as colunas que a rota consulta
    await pg.exec(`CREATE TABLE construction_projects (id serial PRIMARY KEY, user_id integer, lead_id integer);
      CREATE TABLE financiamentos (id serial PRIMARY KEY, lead_id integer, status text NOT NULL DEFAULT 'pre_analise');`);
    const c = await logado(r.id);
    expect(await c.consentimento.minhaSituacao()).toMatchObject({ pedir: true });
    expect(await c.portal.navigation()).toMatchObject({ hasWorks: false, hasActiveFinancing: false });
  });
});

describe("consulta do admin (caminho completo pelo appRouter)", () => {
  it("só admin por PAPEL: colaborador com todos os módulos, corretor, cliente, empreiteiro, user, admin inativo e anônimo são recusados", async () => {
    const inativo = caller(1, "admin", [], false);
    for (const c of [caller(1, "colaborador", [...ADMIN_MODULES]), caller(1, "corretor"), caller(1, "cliente"), caller(1, "empreiteiro"), caller(1, "user"), inativo, publico()]) {
      await expect(c.consentimento.admin.resumo()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("admin vê por usuário quando e qual versão aceitou, e quantos aceitaram cada versão; não há rota para editar ou apagar", async () => {
    const nova = await contaNova();
    await publico().primeiroAcesso.definirSenha({ token: "tok-novo", novaSenha: "senha-forte-1", aceitouTermo: true, versaoDoTermo: VERSAO_DO_TERMO });
    const antiga = await contaAntiga();
    await pg.query(`INSERT INTO consentimentos (user_id, versao_termo, canal, com_senha, aceito_em) VALUES ($1, '2026-01-01.1', 'definir_senha', true, '2026-01-02')`, [antiga]);
    const r = await caller(99, "admin").consentimento.admin.resumo();
    expect(r.versaoAtual).toBe(VERSAO_DO_TERMO);
    expect(r.pedirNoLogin).toBe(false);
    expect(r.avisoProvisorio).toMatch(/provisório/);
    expect(r.pendenciasDoJuridico).toEqual([...PENDENCIAS_DO_JURIDICO]);
    expect(r.porVersao).toEqual(expect.arrayContaining([{ versao: VERSAO_DO_TERMO, usuarios: 1 }, { versao: "2026-01-01.1", usuarios: 1 }]));
    expect(r.usuarios.find(u => u.userId === nova)).toMatchObject({ versao: VERSAO_DO_TERMO, aceitouVersaoAtual: true, canal: "definir_senha" });
    expect(r.usuarios.find(u => u.userId === antiga)).toMatchObject({ versao: "2026-01-01.1", aceitouVersaoAtual: false });
    expect(Object.keys((appRouter as any)._def.procedures).filter((p: string) => p.startsWith("consentimento.")).sort())
      .toEqual(["consentimento.aceitar", "consentimento.admin.resumo", "consentimento.minhaSituacao"]);
  });
});

describe("texto público do termo (QA S-12, achado 2)", () => {
  const publicoTodo = [TITULO_DO_TERMO, FRASE_CURTA_DO_TERMO, ...SECOES_DO_TERMO.flatMap(sec => [sec.titulo, ...sec.paragrafos])].join("\n");
  it("não tem marcador do jurídico; as pendências ficam numa lista separada, só para o admin", () => {
    expect(publicoTodo).not.toMatch(/\[A PREENCHER|PREENCHER PELO JUR|\[|\]/);
    expect(PENDENCIAS_DO_JURIDICO.length).toBeGreaterThanOrEqual(4);
    for (const p of PENDENCIAS_DO_JURIDICO) expect(publicoTodo).not.toContain(p);
  });
  it("endereço da mesma fonte do site; frases neutras para encarregado e prazos", () => {
    expect(ENDERECO_DA_SEDE).toBe("R. Gonçalves Dias, 1993 - Juçara, Imperatriz - MA, 65900-545");
    expect(publicoTodo).toContain(`Endereço: ${ENDERECO_DA_SEDE}.`);
    expect(publicoTodo).toContain("use os contatos do item 7");
    expect(publicoTodo).toContain("pelo tempo exigido por lei");
    expect(publicoTodo).toContain("no prazo previsto em lei");
  });
});

describe("seção de inteligência artificial (QA S-12, achado 3)", () => {
  const ia = SECOES_DO_TERMO.find(sec => /Inteligência artificial/.test(sec.titulo))!.paragrafos.join(" ");
  it("diz a verdade: atendimento automático no WhatsApp com passagem para pessoa, leitura de documentos, apoio à equipe, Anthropic fora do Brasil", () => {
    expect(ia).toMatch(/primeiro atendimento pelo WhatsApp/i);
    expect(ia).toMatch(/assistente automática/);
    expect(ia).toMatch(/passa para alguém da equipe/);
    expect(ia).toMatch(/documentos, plantas e projetos/);
    expect(ia).toMatch(/Apoio à equipe/);
    expect(ia).toMatch(/atualmente a Anthropic/);
    expect(ia).toMatch(/fora do Brasil/);
    expect(ia).not.toMatch(/só|apenas|somente|garant/i);
    expect(FRASE_CURTA_DO_TERMO).toMatch(/WhatsApp/);
  });
  it("texto mudou ⇒ versão nova (a .1 nunca foi aceita em produção)", () => {
    expect(VERSAO_DO_TERMO).toBe("2026-11-17.2");
  });
});

describe("termo e resumo técnico", () => {
  it("frase curta simples, marcadores do jurídico listados e aparelho sem guardar o user-agent", () => {
    expect(FRASE_CURTA_DO_TERMO).toMatch(/inteligência artificial/);
    expect(FRASE_CURTA_DO_TERMO.length).toBeLessThan(160);
    expect(aparelhoDoUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(aparelhoDoUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari")).toBe("celular");
    expect(aparelhoDoUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("computador");
    expect(aparelhoDoUserAgent(undefined)).toBe("desconhecido");
  });
});
