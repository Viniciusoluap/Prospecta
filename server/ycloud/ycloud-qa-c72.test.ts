// EPIC-027 C7.2 — portão de QA de segurança (@qa, 21/11/2026): tentativas de quebrar o modelo padrão e o envio de template.
// A YCloud é SIMULADA (nada sai para a rede). Harness copiado de ycloud-c72.test.ts.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = new Map<string, string>();
vi.mock("../db.js", async orig => ({
  ...(await orig<typeof import("../db.js")>()),
  getDb: vi.fn(),
  getDashboardSetting: vi.fn(async (k: string) => settings.get(k)),
  saveDashboardSetting: vi.fn(async (k: string, v: string) => { settings.set(k, v); }),
}));

import * as schema from "../../drizzle/schema.js";
import { ENV } from "../_core/env.js";
import { getDb } from "../db.js";
import { appRouter } from "../routers.js";
import { definirDependenciasYcloud } from "./config.js";
import { CHAVE_ESTADO_MODELO_PADRAO, garantirModeloPadrao } from "./modelos.js";
import { AVISO_DISPARO_BLOQUEADO } from "../whatsapp-canais.js";
import { MODELO_PADRAO, converterTemplateParaModelo, nomeDoModeloDoTemplate, problemasDoNovoModelo } from "../../shared/whatsapp/ycloud.js";

const CHAVE = "ycl-chave-de-teste-NAO-REAL-0123456789abcdef";
const EMPRESA = "5599900001111";
const AGORA = new Date("2026-11-21T13:00:00.000Z"); // 10h de Brasília

let pg: PGlite;
let relogio: Date;
let modelosDaConta: any[];
let respostaCriar: (corpo: any, n: number) => { status: number; json?: unknown; lancar?: boolean };
let chamadas: Array<{ url: string; metodo: string; chave: string | null; corpo: any }>;
let atrasoCriarMs = 0;

const resposta = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });

const fetchFalso = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  const h = new Headers(init?.headers);
  const metodo = init?.method ?? "GET";
  const corpo = init?.body ? JSON.parse(String(init.body)) : null;
  chamadas.push({ url: u, metodo, chave: h.get("X-API-Key"), corpo });
  if (!u.startsWith("https://api.ycloud.com/v2/")) throw new Error("URL fora da YCloud");
  if (h.get("X-API-Key") !== CHAVE) return resposta(401, { error: { status: 401, code: "UNAUTHORIZED" } });
  if (u.includes("/whatsapp/phoneNumbers")) {
    return resposta(200, { items: [{ id: "p1", phoneNumber: `+${EMPRESA}`, wabaId: "waba1", verifiedName: "VFX Capital", status: "CONNECTED", qualityRating: "GREEN", whatsappBusinessManagerMessagingLimit: "TIER_250" }] });
  }
  if (u.includes("/whatsapp/templates") && metodo === "GET") return resposta(200, { items: modelosDaConta });
  if (u.endsWith("/whatsapp/templates") && metodo === "POST") {
    const n = chamadas.filter(c => c.metodo === "POST" && c.url.endsWith("/whatsapp/templates")).length;
    if (atrasoCriarMs) await new Promise(r => setTimeout(r, atrasoCriarMs));
    const r = respostaCriar(corpo, n);
    if (r.lancar) throw new TypeError("fetch failed");
    return resposta(r.status, r.json ?? { ...corpo, status: "PENDING", officialTemplateId: `t${n}` });
  }
  return resposta(404, { error: { status: 404, code: "NOT_FOUND" } });
});

const caller = (role: string, id: number, permissoes: string[] = ["whatsapp"]) =>
  appRouter.createCaller({ user: { id, role, active: true, permissions: JSON.stringify(permissoes), name: "Fulano" }, req: {}, res: {} } as never);
const admin = () => caller("admin", 1);
const q = async <T = any>(s: string) => (await pg.query<T>(s)).rows;
const posts = () => chamadas.filter(c => c.metodo === "POST" && c.url.endsWith("/whatsapp/templates"));
const estado = async () => { const [r] = await q<{ value: string }>(`SELECT value FROM dashboard_settings WHERE key = '${CHAVE_ESTADO_MODELO_PADRAO}'`); return r ? JSON.parse(r.value) : null; };

let ddl: string | null = null;
async function criarBanco() {
  if (!ddl) {
    const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
    const escolhidas: Record<string, unknown> = {};
    for (const [nome, valor] of Object.entries(schema)) if (["users", "leads", "whatsappMessages", "dashboardSettings", "whatsappTemplates"].includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
    ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n");
  }
  const banco = new PGlite();
  await banco.exec(ddl);
  await banco.exec(readFileSync(new URL("../../drizzle/0141_ycloud.sql", import.meta.url), "utf8"));
  await banco.exec("CREATE TABLE IF NOT EXISTS central_vendas_leads (lead_id integer PRIMARY KEY, opt_out boolean NOT NULL DEFAULT false)");
  return banco;
}

const MODELO_UTILIDADE = { wabaId: "waba1", name: "aviso_obra", language: "pt_BR", category: "UTILITY", status: "APPROVED", components: [{ type: "BODY", text: "Sua obra avançou, {{1}}. Veja os detalhes." }] };
const MARKETING_EN = { wabaId: "waba1", name: "promo_en", language: "en_US", category: "MARKETING", status: "APPROVED", components: [{ type: "BODY", text: "Hi {{1}}, news!" }] };
const MARKETING_PT = { wabaId: "waba1", name: "lancamento_jardim", language: "pt_BR", category: "MARKETING", status: "APPROVED", components: [{ type: "BODY", text: "Olá {{1}}, novidade." }] };

const PAYLOAD_PADRAO = {
  wabaId: "waba1", name: "novidades_prospecta", language: "pt_BR", category: "MARKETING",
  components: [{
    type: "BODY",
    text: "Olá, {{1}}! Aqui é da Prospecta. Temos novidades em imóveis financiados e construção na sua região. Quer que um consultor te mande os detalhes? Responda SIM. Para não receber mais, responda SAIR.",
    example: { body_text: [["Maria"]] },
  }],
};

const segredoAntes = ENV.cookieSecret;
const erroLog = vi.spyOn(console, "error");
beforeEach(async () => {
  pg = await criarBanco();
  vi.mocked(getDb).mockReturnValue(drizzle(pg, { schema }) as never);
  settings.clear();
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  relogio = new Date(AGORA);
  modelosDaConta = [MODELO_UTILIDADE, MARKETING_EN];
  respostaCriar = () => ({ status: 200 });
  atrasoCriarMs = 0;
  chamadas = [];
  fetchFalso.mockClear();
  erroLog.mockClear();
  await pg.exec(`INSERT INTO users ("openId", name, role, active) VALUES ('adm', 'Admin', 'admin', true);`);
  definirDependenciasYcloud({
    agora: () => relogio, fetch: fetchFalso as never, esperar: async () => undefined,
    numeroDaEmpresa: async () => EMPRESA, numeroDoDono: async () => "5599991234567", conexaoDaEmpresaId: async () => 1,
    urlDoSite: () => "https://www.exemplo-prospecta.test",
  });
});
afterEach(async () => {
  definirDependenciasYcloud();
  ENV.cookieSecret = segredoAntes;
  await pg.close();
});

const integrar = () => admin().whatsappOficial.salvarChave({ apiKey: CHAVE });
const semChaveEmLugarNenhum = async () => {
  const tudo = JSON.stringify([await q("SELECT * FROM dashboard_settings WHERE key NOT LIKE 'segredo.%'"), await q("SELECT * FROM ycloud_auditoria"), erroLog.mock.calls]);
  expect(tudo).not.toContain(CHAVE);
};

describe("QA C7.2 — modelo padrão", () => {
  // ACHADO QA-1 (portão 21/11): se a gravação do estado final falhar depois do POST (aqui: motivo que, escapado pelo JSON, passa de
  // value(500)), o estado fica "andamento" com t=0 e o servidor tenta 1 POST por dia para sempre — o "3 no total" não vale.
  // QA-1 corrigido (a tentativa conta na reserva; o JSON gravado cabe em value(500)).
  it("motivo da recusa com caracteres que o JSON escapa não estoura value(500) nem destrava o limite de 3", async () => {
    await integrar();
    const aspas = "\ud800".repeat(190); // surrogate isolado: JSON.stringify escreve 6 caracteres por unidade
    respostaCriar = () => ({ status: 400, json: { error: { status: 400, code: "PARAM_INVALID", whatsappApiError: { error_user_msg: aspas } } } });
    const rs: string[] = [];
    for (let dia = 0; dia < 6; dia++) { relogio = new Date(AGORA.getTime() + dia * 86_400_000); rs.push((await garantirModeloPadrao()).r); }
    const e = await estado();
    expect(e?.s).not.toBe("andamento");
    expect(rs).toContain("desistiu");
    expect(posts().length).toBeLessThanOrEqual(3);
  });

  it("colaborador chamando a listagem muitas vezes no mesmo dia não gasta tentativas", async () => {
    await integrar();
    respostaCriar = () => ({ status: 400, json: { error: { status: 400, code: "PARAM_INVALID" } } });
    for (let i = 0; i < 8; i++) await caller("colaborador", 2).whatsappOficial.modelos().catch(() => undefined);
    expect(posts()).toHaveLength(1);
    expect(await estado()).toMatchObject({ t: 1 });
  });

  it("corretor e colaborador sem o módulo não chegam à listagem (nenhuma chamada à YCloud)", async () => {
    await integrar();
    chamadas = [];
    await expect(caller("corretor", 3).whatsappOficial.modelos()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("colaborador", 4, []).whatsappOficial.modelos()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(chamadas).toHaveLength(0);
  });

  it("colaborador não recebe modeloPadrao/wabaId (status é só admin)", async () => {
    await integrar();
    await expect(caller("colaborador", 2).whatsappOficial.status()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const p = await caller("colaborador", 2).whatsappOficial.prontidao();
    expect(JSON.stringify(p)).not.toMatch(/waba|modeloPadrao|tier/i);
  });
});

describe("QA C7.2 — template da Central", () => {
  const existe = (nomes: string[]) => (c: any) => nomes.includes(c.name)
    ? { status: 400, json: { error: { status: 400, code: "ALREADY_EXISTS" } } } : { status: 200 };

  it("nome igual ao de modelo de outra origem → YCloud recusa, nenhum vínculo; o modelo alheio não ganha mapeamento", async () => {
    await integrar();
    modelosDaConta = [MODELO_UTILIDADE, MARKETING_PT];
    respostaCriar = existe(["lancamento_jardim", "novidades_prospecta"]);
    const r = await admin().whatsapp.salvarTemplate({ nome: "Lançamento Jardim", categoria: "Captação", conteudo: "Olá, {{nome}}! Novidade no Jardim.", apiOficial: { categoria: "MARKETING" } });
    expect(r.apiOficial).toMatchObject({ ok: false, motivo: expect.stringMatching(/Mude o nome/) });
    expect(await q("SELECT * FROM dashboard_settings WHERE key LIKE 'ycloud.template.%'")).toHaveLength(0);
    const lista = await admin().whatsappOficial.modelos();
    expect(lista.find(m => m.nome === "lancamento_jardim")?.variaveisDoTemplate ?? null).toBeNull();
  });

  it("dois templates com o mesmo nome → o segundo não sobrescreve o vínculo do primeiro", async () => {
    await integrar();
    const ja = new Set<string>();
    respostaCriar = (c: any) => { if (ja.has(c.name)) return { status: 400, json: { error: { status: 400, code: "ALREADY_EXISTS" } } }; ja.add(c.name); return { status: 200 }; };
    const a = await admin().whatsapp.salvarTemplate({ nome: "Promo", categoria: "Captação", conteudo: "Olá, {{nome}}! Promoção.", apiOficial: { categoria: "MARKETING" } });
    const b = await admin().whatsapp.salvarTemplate({ nome: "Promo", categoria: "Captação", conteudo: "Oi, {{corretor}} aqui. Promoção!", apiOficial: { categoria: "MARKETING" } });
    expect(a.apiOficial).toMatchObject({ ok: true, nome: "promo" });
    expect(b.apiOficial).toMatchObject({ ok: false });
    const v = await q<{ key: string; value: string }>("SELECT key, value FROM dashboard_settings WHERE key LIKE 'ycloud.template.%'");
    expect(v).toHaveLength(1);
    expect(JSON.parse(v[0].value).v).toEqual(["nome"]);
  });

  it("nome com injeção/acentos/emoji → sempre [a-z0-9_] e ≤ 60", async () => {
    await integrar();
    const r = await admin().whatsapp.salvarTemplate({ nome: `Ação ${"ß😀/../x".repeat(12)}`, categoria: "Captação", conteudo: "Olá, {{nome}}! Teste.", apiOficial: { categoria: "MARKETING" } });
    expect(r.apiOficial?.nome).toMatch(/^[a-z0-9_]{1,60}$/);
  });

  it("exemplos enviados à Meta são fixos (nunca dados de lead real)", async () => {
    await integrar();
    await pg.exec(`INSERT INTO leads (name, phone) VALUES ('Joaquina Real da Silva', '5599988887777')`).catch(() => undefined);
    await admin().whatsapp.salvarTemplate({ nome: "Ex", categoria: "Captação", conteudo: "Olá, {{nome}}! Fale com {{corretor}} sobre {{servicos}} hoje.", apiOficial: { categoria: "MARKETING" } });
    const p = posts().find(x => x.corpo.name === "ex");
    expect(p?.corpo.components[0].example.body_text).toEqual([["Maria", "João", "financiamento"]]);
    expect(JSON.stringify(p)).not.toMatch(/Joaquina|5599988887777/);
  });

  // ACHADO QA-3 (baixo): o vínculo guarda só a versão mais nova; a v1 aprovada continua selecionável na campanha, mas sem preenchimento automático.
  // QA-3 corrigido: o vínculo guarda o mapeamento por NOME de modelo (v1 e v2).
  it("nova versão (_v2): o modelo v1 já aprovado continua com o mapeamento das variáveis", async () => {
    await integrar();
    const r = await admin().whatsapp.salvarTemplate({ nome: "Promo", categoria: "Captação", conteudo: "Olá, {{nome}}! Promoção.", apiOficial: { categoria: "MARKETING" } });
    await admin().whatsapp.salvarTemplate({ id: r.id, nome: "Promo", categoria: "Captação", conteudo: "Olá, {{nome}}! Promoção nova.", apiOficial: { categoria: "MARKETING" } });
    modelosDaConta = [...modelosDaConta, { wabaId: "waba1", name: "promo", language: "pt_BR", category: "MARKETING", status: "APPROVED", components: [{ type: "BODY", text: "Olá, {{1}}! Promoção." }] }];
    const lista = await admin().whatsappOficial.modelos();
    expect(lista.find(m => m.nome === "promo")?.variaveisDoTemplate).toEqual(["nome"]);
  });
});
