// QA de SEGURANÇA da EPIC-025 E9 — 2ª rodada (20/11/2026): tentativas de quebrar de novo as correções dos achados 1 e 2,
// regressões de 4 e 5 e uso dos índices da 0135. PGlite; nada sai para a rede (fetch da Evolution simulado).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async orig => ({ ...(await orig<typeof import("../db.js")>()), getDb: vi.fn() }));

import { leads } from "../../drizzle/schema.js";
import { sql } from "drizzle-orm";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { finalDoTelefone, processarEventoEvolution } from "../whatsapp-evolution-webhook.js";
import { definirDependenciasRoteamento, identificarRemetente } from "./roteamento.js";
import { CENARIO, criarBanco } from "./testes-banco.js";

const DONO = "5599991234567";
const EMPRESA = "5599900001111";
let banco: Awaited<ReturnType<typeof criarBanco>>;
const q = async <T = any>(s: string) => (await banco.pg.query<T>(s)).rows;
const caller = (role: string, id: number, permissoes: readonly string[] = ["whatsapp"]) =>
  appRouter.createCaller({ user: { id, role, active: true, permissions: JSON.stringify(permissoes) }, req: {}, res: {} } as never);
const segredoAntes = ENV.cookieSecret;
const envAntes = { url: process.env.EVOLUTION_API_URL, key: process.env.EVOLUTION_API_KEY };
let enviados: Array<{ url: string; corpo: any; redirect?: string }>;
const envios = () => enviados.filter(e => e.url.includes("/message/sendText/"));

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(CENARIO);
  await banco.pg.exec(`UPDATE dolores_whatsapp_config SET instancia = 'prospecta-dolores', status_conexao = 'conectado', numero_dono = '${DONO}',
    numero_dolores = '${EMPRESA}' WHERE id = 1;
    CREATE TABLE IF NOT EXISTS whatsapp_evolution_settings (id integer PRIMARY KEY, url text NOT NULL, api_key_encrypted text NOT NULL, updated_at timestamp DEFAULT now());
    INSERT INTO users ("openId", name, role, active, "passwordHash", phone) VALUES ('cor', 'Carlos Corretor', 'corretor', true, 'hash', '99944443333');`);
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  process.env.EVOLUTION_API_URL = "https://evolution.exemplo.invalid";
  process.env.EVOLUTION_API_KEY = "chave-evolution-de-teste";
  enviados = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    enviados.push({ url: String(url), corpo: init?.body ? JSON.parse(String(init.body)) : null, redirect: init?.redirect });
    return new Response(JSON.stringify({ key: { id: `EVO${enviados.length}` } }), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => {
  definirDependenciasRoteamento();
  ENV.cookieSecret = segredoAntes;
  process.env.EVOLUTION_API_URL = envAntes.url;
  process.env.EVOLUTION_API_KEY = envAntes.key;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("r2 — achado 1: variações do número do dono e da empresa", () => {
  it("responder: dono com sinais, sem o nono dígito (JID real do DDD 99), com +55 e espaços; empresa com sinais → recusado, nada sai", async () => {
    for (const numero of ["+55 (99) 9 9123-4567", "55 99 9123-4567", "(99) 9123-4567", "+55 99 99123 4567", "+55 (99) 90000-1111", "99900001111"]) {
      await expect(caller("colaborador", 2).whatsapp.responder({ numero, texto: "teste" }), numero).rejects.toThrow(/número do dono/);
    }
    expect(envios()).toHaveLength(0);
  });

  it("histórico gravado com o JID SEM o nono dígito (forma real do DDD 99 no WhatsApp) também some de Conversas, da conversa e do Histórico", async () => {
    await caller("admin", 1).whatsapp.minhaConexao();
    const [{ id }] = await q<{ id: number }>("SELECT id FROM whatsapp_connections WHERE user_id = 1");
    await banco.pg.exec(`INSERT INTO whatsapp_messages (connection_id, destinatario, mensagem, status, direcao, lida, external_id) VALUES
      (${id}, '559991234567', 'Dolores, me manda o caixa', 'recebida', 'entrada', false, 'L1'),
      (${id}, '559991234567', 'Caixa: 12.000', 'enviada', 'saida', true, 'L2')`);
    for (const [papel, uid] of [["colaborador", 2], ["admin", 1]] as const) {
      expect(await caller(papel, uid).whatsapp.conversas()).toEqual([]);
      for (const numero of ["559991234567", DONO, "99991234567"]) expect(await caller(papel, uid).whatsapp.mensagensConversa({ numero })).toEqual([]);
      expect((await caller(papel, uid).whatsapp.historico()).some(m => m.mensagem.includes("Caixa"))).toBe(false);
      expect(await caller(papel, uid).whatsapp.previaExclusaoConversas({ numeros: ["559991234567"] })).toEqual({ conversas: 0, mensagens: 0 });
    }
  });

  it("número inválido como o do dono com DDI repetido/zeros não é o dono (sai como número que não existe, nunca como o do dono)", async () => {
    // o envio usa a MESMA regra de prefixo do conferidor (`enviarTextoEvolution`): o que sai nunca é uma forma do número do dono
    await caller("colaborador", 2).whatsapp.responder({ numero: "0 99 99123-4567", texto: "x" });
    expect(envios().map(e => e.corpo.number)).toEqual(["55099991234567"]);
  });
});

describe("r2 — achado 2: instância antiga", () => {
  it("remoção: usa semRedirecionamento (redirect: error); não toca instância de CORRETOR", async () => {
    await banco.pg.exec(`INSERT INTO whatsapp_connections (user_id, provider, instancia, status) VALUES (1, 'evolution', 'prospecta-u1', 'desconectado'),
      (3, 'evolution', 'prospecta-u3', 'conectado')`);
    expect(await caller("admin", 1).dolores.removerConexaoAntiga()).toEqual({ ok: true, removidas: 1 });
    expect(enviados.every(e => e.redirect === "error")).toBe(true);
    expect(enviados.some(e => e.url.includes("prospecta-u3"))).toBe(false);
    expect(await q("SELECT instancia FROM whatsapp_connections WHERE user_id = 3")).toEqual([{ instancia: "prospecta-u3" }]);
  });

  it("CORRIGIDO (era CONCERN): a Evolution recusa a remoção (500) → erro claro na tela e a linha CONTINUA com a instância (dá para tentar de novo)", async () => {
    await banco.pg.exec(`INSERT INTO whatsapp_connections (user_id, provider, instancia, status) VALUES (1, 'evolution', 'prospecta-u1', 'desconectado')`);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { enviados.push({ url: String(url), corpo: null }); return new Response("{}", { status: 500 }); }));
    await expect(caller("admin", 1).dolores.removerConexaoAntiga()).rejects.toThrow(/não confirmou a remoção/);
    expect(await q("SELECT instancia FROM whatsapp_connections WHERE user_id = 1")).toEqual([{ instancia: "prospecta-u1" }]);
    // mesmo viva, o aviso dela continua sem gravar nada na Central da empresa
    expect(await processarEventoEvolution({ event: "messages.upsert", instance: "prospecta-u1",
      data: { key: { remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: "O1" }, message: { conversation: "x" } } })).not.toBe("ok");
  });

  it("a Evolution confirma (200) ou a instância já não existe (404) → linha limpa e a tela diz removida", async () => {
    await banco.pg.exec(`INSERT INTO whatsapp_connections (user_id, provider, instancia, status) VALUES (1, 'evolution', 'prospecta-u1', 'desconectado')`);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { enviados.push({ url: String(url), corpo: null });
      return new Response("{}", { status: String(url).includes("/instance/delete/") ? 404 : 200 }); }));
    expect(await caller("admin", 1).dolores.removerConexaoAntiga()).toEqual({ ok: true, removidas: 1 });
    expect(await q("SELECT instancia FROM whatsapp_connections WHERE user_id = 1")).toEqual([{ instancia: null }]);
  });

  it("aviso da instância gravada na linha do COLABORADOR (papel da conexão da empresa): nada grava, nem do dono", async () => {
    await banco.pg.exec(`INSERT INTO whatsapp_connections (user_id, provider, instancia, status) VALUES (2, 'evolution', 'prospecta-u2', 'conectado')`);
    expect(await processarEventoEvolution({ event: "messages.upsert", instance: "prospecta-u2",
      data: { key: { remoteJid: `${DONO}@s.whatsapp.net`, fromMe: false, id: "C1" }, message: { conversation: "x" } } })).toBe("instancia-antiga-da-empresa");
    expect(await q("SELECT count(*)::int AS n FROM whatsapp_messages WHERE external_id = 'C1'")).toEqual([{ n: 0 }]);
  });
});

describe("r2 — achado 4: busca pelos 8 finais", () => {
  it("número com aspas/SQL não injeta (só dígitos viram parâmetro); zeros e curtos não pegam telefone vazio", async () => {
    await banco.pg.exec(`INSERT INTO leads (name, phone, city, stage, created_at, updated_at) VALUES
      ('Vazio', '', 'X', 'attending', now(), now()), ('Zeros', '00000000', 'X', 'attending', now(), now())`);
    expect((await identificarRemetente("55' OR '1'='1")).categoria).toBe("desconhecido");
    expect(await identificarRemetente("5599900000000")).toMatchObject({ categoria: "desconhecido" });
    expect((await identificarRemetente("")).categoria).toBe("desconhecido");
  });

  it("os índices de expressão da 0135 são usados pela consulta que o código gera (sem varredura sequencial)", async () => {
    const consulta = banco.db.select({ id: leads.id }).from(leads).where(sql`${finalDoTelefone(leads.phone)} = ${"91234567"}`).toSQL();
    await banco.pg.exec("SET enable_seqscan = off");
    const plano = (await banco.pg.query<{ "QUERY PLAN": string }>(`EXPLAIN ${consulta.sql}`, consulta.params as unknown[])).rows.map(r => r["QUERY PLAN"]).join("\n");
    expect(plano).toMatch(/leads_telefone_final8_idx/);
  });
});
