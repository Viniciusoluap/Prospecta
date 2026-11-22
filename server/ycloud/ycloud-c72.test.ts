// EPIC-027 C7.2 — modelos da API oficial criados pelo servidor do Prospecta (a YCloud é SIMULADA: nada sai para a rede).
// Modelo padrão uma vez só (idempotente, à prova de corrida, sem laço na recusa: 1 tentativa por dia, 3 no total); template da Central
// enviado para aprovação pelo formulário que já existe (só admin), com as variáveis nomeadas convertidas; validações da Meta; a chave
// nunca aparece em erro, estado, auditoria ou log; payload exatamente no formato da documentação (POST /v2/whatsapp/templates).
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
import { CHAVE_ESTADO_MODELO_PADRAO, garantirModeloPadrao, garantirModeloPadraoNoCron } from "./modelos.js";
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
let travarListagem = false;
let sinalVisto: AbortSignal | null = null;
let wabaDaChave = "waba1";

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
    return resposta(200, { items: [{ id: "p1", phoneNumber: `+${EMPRESA}`, wabaId: wabaDaChave, verifiedName: "VFX Capital", status: "CONNECTED", qualityRating: "GREEN", whatsappBusinessManagerMessagingLimit: "TIER_250" }] });
  }
  if (u.includes("/whatsapp/templates") && metodo === "GET") {
    if (travarListagem) {
      sinalVisto = init?.signal ?? null;
      await new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("abortado"))));
    }
    return resposta(200, { items: modelosDaConta });
  }
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
  travarListagem = false;
  sinalVisto = null;
  wabaDaChave = "waba1";
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

describe("C7.2 — modelo padrão enviado pelo servidor, uma vez", () => {
  it("integração pronta e sem modelo de marketing em pt_BR → UM POST, exatamente no formato da documentação; depois nunca mais", async () => {
    await integrar();
    expect((await garantirModeloPadrao({ origem: "cron" })).r).toBe("criado");
    expect(posts()).toHaveLength(1);
    expect(posts()[0].corpo).toEqual(PAYLOAD_PADRAO);
    expect(posts()[0].url).toBe("https://api.ycloud.com/v2/whatsapp/templates");
    expect(posts()[0].chave).toBe(CHAVE); // só no cabeçalho
    expect(await estado()).toMatchObject({ s: "criado", t: 1, st: "PENDING" });
    // outro dia, outra chamada, a listagem: nada novo
    relogio = new Date(AGORA.getTime() + 3 * 86_400_000);
    expect((await garantirModeloPadrao({ origem: "cron" })).r).toBe("ja_feito");
    await admin().whatsappOficial.modelos();
    expect(posts()).toHaveLength(1);
    const [a] = await q<{ acao: string; usuario_id: number | null; detalhe: string }>("SELECT acao, usuario_id, detalhe FROM ycloud_auditoria WHERE acao LIKE 'modelo_padrao%'");
    expect(a).toMatchObject({ acao: "modelo_padrao_enviado", usuario_id: null });
    expect(a.detalhe).toMatch(/^papel=sistema; origem=cron/);
    await semChaveEmLugarNenhum();
  });

  it("a conta já tem modelo de marketing em pt_BR → não cria (e não tenta de novo)", async () => {
    modelosDaConta = [MARKETING_PT];
    await integrar();
    expect((await garantirModeloPadrao()).r).toBe("ja_existia");
    modelosDaConta = [];
    relogio = new Date(AGORA.getTime() + 86_400_000);
    expect((await garantirModeloPadrao()).r).toBe("ja_feito");
    expect(posts()).toHaveLength(0);
  });

  it("integração não pronta (sem chave) → nada vai à YCloud e nenhuma tentativa é gasta", async () => {
    expect((await garantirModeloPadrao()).r).toBe("nao_pronta");
    expect(chamadas).toHaveLength(0);
    expect(await estado()).toBeNull();
  });

  it("corrida: duas chamadas ao mesmo tempo (cron + listagem) → um POST só", async () => {
    await integrar();
    atrasoCriarMs = 30;
    const rs = await Promise.all([garantirModeloPadrao({ origem: "cron" }), garantirModeloPadrao({ origem: "cron" }), admin().whatsappOficial.modelos()]);
    expect(posts()).toHaveLength(1);
    expect(rs.slice(0, 2).every(r => ["criado", "ocupado", "ja_feito"].includes(r.r))).toBe(true);
    expect(await estado()).toMatchObject({ s: "criado", t: 1 });
  });

  it("recusa da YCloud: grava o motivo (sem a chave), 1 tentativa por dia, 3 no total — nunca em laço", async () => {
    await integrar();
    respostaCriar = () => ({ status: 400, json: { error: { status: 400, code: "PARAM_INVALID", message: `rejeitado ${CHAVE}`, whatsappApiError: { message: "x", code: "100", error_user_msg: `Conteúdo inválido 5599988887777 ${CHAVE}` } } } });
    expect((await garantirModeloPadrao()).r).toBe("recusado");
    for (let i = 0; i < 5; i++) expect((await garantirModeloPadrao()).r).toBe("hoje_ja_tentou");
    await admin().whatsappOficial.modelos();
    expect(posts()).toHaveLength(1);
    const e1 = await estado();
    expect(e1).toMatchObject({ s: "recusado", t: 1 });
    expect(e1.m).toContain("PARAM_INVALID");
    expect(e1.m).toContain("Meta: Conteúdo inválido");
    expect(e1.m).not.toMatch(/\d{6,}/);
    for (const dia of [1, 2]) { relogio = new Date(AGORA.getTime() + dia * 86_400_000); expect((await garantirModeloPadrao()).r).toBe("recusado"); }
    expect(posts()).toHaveLength(3);
    relogio = new Date(AGORA.getTime() + 10 * 86_400_000);
    expect((await garantirModeloPadrao()).r).toBe("desistiu");
    expect(posts()).toHaveLength(3);
    const st = await admin().whatsappOficial.status();
    expect(st.modeloPadrao).toMatchObject({ situacao: "recusado", tentativas: 3, maxTentativas: 3 });
    expect(JSON.stringify(st)).not.toContain(CHAVE);
    await semChaveEmLugarNenhum();
  });

  it("tempo esgotado (resultado ambíguo): no dia seguinte confere a lista antes — se chegou, não cria de novo", async () => {
    await integrar();
    respostaCriar = () => ({ status: 200, lancar: true });
    expect((await garantirModeloPadrao()).r).toBe("incerto");
    modelosDaConta = [...modelosDaConta, { ...PAYLOAD_PADRAO, status: "PENDING" }];
    relogio = new Date(AGORA.getTime() + 86_400_000);
    expect((await garantirModeloPadrao()).r).toBe("ja_existia");
    expect(posts()).toHaveLength(1);
  });

  it("listar os modelos (colaborador com WhatsApp, sem clique extra) também dispara e o modelo novo já aparece na lista", async () => {
    await integrar();
    const lista = await caller("colaborador", 2).whatsappOficial.modelos();
    expect(posts()).toHaveLength(1);
    expect(lista.find(m => m.nome === "novidades_prospecta")).toMatchObject({ status: "PENDING", idioma: "pt_BR", categoria: "MARKETING" });
  });
});

describe("C7.2 — template da Central enviado para aprovação (formulário que já existe)", () => {
  const followup = "Olá, {{nome}}! Estou retomando nosso atendimento sobre {{servicos}}. Falo com você no dia {{dia}}, certo?";

  it("admin: variáveis nomeadas → {{1}}, {{2}}… na ordem, exemplos gerados, payload da documentação; mapeamento guardado", async () => {
    await integrar();
    const r = await admin().whatsapp.salvarTemplate({ nome: "Follow-up 48h", categoria: "Acompanhamento", conteudo: followup, apiOficial: { categoria: "MARKETING" } });
    expect(r.apiOficial).toMatchObject({ ok: true, nome: "follow_up_48h", repetido: false });
    const criacoes = posts().filter(p => p.corpo.name === "follow_up_48h");
    expect(criacoes).toHaveLength(1);
    expect(criacoes[0].corpo).toEqual({
      wabaId: "waba1", name: "follow_up_48h", language: "pt_BR", category: "MARKETING",
      components: [{ type: "BODY", text: "Olá, {{1}}! Estou retomando nosso atendimento sobre {{2}}. Falo com você no dia {{3}}, certo?", example: { body_text: [["Maria", "financiamento", "25/11"]] } }],
    });
    // a campanha sabe de onde vem cada variável
    modelosDaConta = [...modelosDaConta, { ...criacoes[0].corpo, status: "APPROVED" }];
    const lista = await admin().whatsappOficial.modelos();
    expect(lista.find(m => m.nome === "follow_up_48h")?.variaveisDoTemplate).toEqual(["nome", "servicos", "dia"]);
    const sit = await admin().whatsappOficial.situacaoDosTemplates();
    expect(sit).toEqual([expect.objectContaining({ templateId: r.id, nome: "follow_up_48h", status: "APPROVED", statusRotulo: "Aprovado", textoMudou: false })]);
  });

  it("mesmo texto salvo de novo → não reenvia; texto mudou → nova versão (_v2) vai para aprovação", async () => {
    await integrar();
    const r = await admin().whatsapp.salvarTemplate({ nome: "Follow-up 48h", categoria: "Acompanhamento", conteudo: followup, apiOficial: { categoria: "MARKETING" } });
    const antes = posts().length;
    const de_novo = await admin().whatsapp.salvarTemplate({ id: r.id, nome: "Follow-up 48h", categoria: "Acompanhamento", conteudo: followup, apiOficial: { categoria: "MARKETING" } });
    expect(de_novo.apiOficial).toMatchObject({ ok: true, repetido: true });
    expect(posts()).toHaveLength(antes);
    // editado sem a opção: a tela avisa que o texto mudou
    await admin().whatsapp.salvarTemplate({ id: r.id, nome: "Follow-up 48h", categoria: "Acompanhamento", conteudo: `${followup} Abraço!` });
    expect((await admin().whatsappOficial.situacaoDosTemplates())[0].textoMudou).toBe(true);
    const v2 = await admin().whatsapp.salvarTemplate({ id: r.id, nome: "Follow-up 48h", categoria: "Acompanhamento", conteudo: `${followup} Abraço!`, apiOficial: { categoria: "MARKETING" } });
    expect(v2.apiOficial).toMatchObject({ ok: true, nome: "follow_up_48h_v2" });
    expect(posts()).toHaveLength(antes + 1);
  });

  it("clique duplo (duas gravações simultâneas do mesmo texto) → um POST", async () => {
    await integrar();
    const r = await admin().whatsapp.salvarTemplate({ nome: "Visita", categoria: "Agenda", conteudo: "Olá, {{nome}}! Sua visita é dia {{dia}}, às {{horario}}. Até lá!" });
    atrasoCriarMs = 30;
    const antes = posts().length;
    const rs = await Promise.all([1, 2].map(() => admin().whatsapp.salvarTemplate({ id: r.id, nome: "Visita", categoria: "Agenda", conteudo: "Olá, {{nome}}! Sua visita é dia {{dia}}, às {{horario}}. Até lá!", apiOficial: { categoria: "UTILITY" } })));
    expect(posts().length - antes).toBe(1);
    expect(rs.every(x => x.apiOficial?.ok)).toBe(true);
  });

  it("texto que não pode virar modelo → recusa clara dizendo o que ajustar, e nada é salvo nem enviado", async () => {
    await integrar();
    const antes = posts().length;
    await expect(admin().whatsapp.salvarTemplate({ nome: "Ruim", categoria: "x1", conteudo: "{{nome}}, temos novidade para você.", apiOficial: { categoria: "MARKETING" } }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/não pode começar com uma variável/) });
    await expect(admin().whatsapp.salvarTemplate({ nome: "Ruim", categoria: "x1", conteudo: "Olá! Fale com {{corretor}}", apiOficial: { categoria: "MARKETING" } }))
      .rejects.toMatchObject({ message: expect.stringMatching(/não pode terminar com uma variável/) });
    await expect(admin().whatsapp.salvarTemplate({ nome: "Ruim", categoria: "x1", conteudo: "Olá, {{nome}}!\n\n\n\nTudo bem?", apiOficial: { categoria: "MARKETING" } }))
      .rejects.toMatchObject({ message: expect.stringMatching(/Quebra de linha em excesso/) });
    await expect(admin().whatsapp.salvarTemplate({ nome: "Ruim", categoria: "x1", conteudo: "Oi {{nome}}, tudo bem, {{nome}}? Abraço.", apiOficial: { categoria: "MARKETING" } }))
      .rejects.toMatchObject({ message: expect.stringMatching(/aparece mais de uma vez/) });
    expect(await q("SELECT * FROM whatsapp_templates")).toHaveLength(0);
    expect(posts()).toHaveLength(antes);
  });

  it("colaborador e corretor barrados na criação pela tela (nenhum POST à YCloud)", async () => {
    await integrar();
    const antes = posts().length;
    for (const [role, id] of [["colaborador", 2], ["corretor", 3]] as const) {
      await expect(caller(role, id).whatsapp.salvarTemplate({ nome: "Novo", categoria: "x1", conteudo: "Olá, {{nome}}! Novidade.", apiOficial: { categoria: "MARKETING" } }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(role, id).whatsappOficial.situacaoDosTemplates()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(posts()).toHaveLength(antes);
  });

  it("YCloud recusa o modelo → template salvo na Central, aviso amigável sem a chave; dá para tentar de novo", async () => {
    await integrar();
    respostaCriar = c => (c.name === "boas_vindas" ? { status: 422, json: { error: { status: 422, code: "CONTENT_PROHIBITED", message: `x ${CHAVE}` } } } : { status: 200 });
    const r = await admin().whatsapp.salvarTemplate({ nome: "Boas-vindas", categoria: "Captação", conteudo: "Olá, {{nome}}! Seja bem-vindo.", apiOficial: { categoria: "MARKETING" } });
    expect(r.apiOficial).toMatchObject({ ok: false });
    expect(r.apiOficial?.motivo).toMatch(/salvo na Central.*CONTENT_PROHIBITED/);
    expect(JSON.stringify(r)).not.toContain(CHAVE);
    expect(await q("SELECT * FROM whatsapp_templates")).toHaveLength(1);
    respostaCriar = () => ({ status: 200 });
    const de_novo = await admin().whatsapp.salvarTemplate({ id: r.id, nome: "Boas-vindas", categoria: "Captação", conteudo: "Olá, {{nome}}! Seja bem-vindo.", apiOficial: { categoria: "MARKETING" } });
    expect(de_novo.apiOficial).toMatchObject({ ok: true, repetido: false, nome: "boas_vindas" });
    await semChaveEmLugarNenhum();
  });

  it("sem a chave cadastrada: o template é salvo e o aviso diz o que falta", async () => {
    const r = await admin().whatsapp.salvarTemplate({ nome: "Boas-vindas", categoria: "Captação", conteudo: "Olá, {{nome}}! Seja bem-vindo.", apiOficial: { categoria: "MARKETING" } });
    expect(r.apiOficial).toMatchObject({ ok: false, motivo: expect.stringMatching(/chave da YCloud não está cadastrada/) });
    expect(chamadas).toHaveLength(0);
  });
});

describe("C7.2 — regras puras", () => {
  it("validações da Meta no corpo, nome e rodapé", () => {
    expect(problemasDoNovoModelo(MODELO_PADRAO)).toEqual([]);
    const base = { nome: "ok_1", categoria: "MARKETING" as const, corpo: "Olá {{1}}, tudo bem?", exemplos: ["Maria"] };
    expect(problemasDoNovoModelo({ ...base, nome: "Com Espaço" }).join()).toMatch(/minúsculas/);
    expect(problemasDoNovoModelo({ ...base, corpo: "Olá {{2}}, tudo?" }).join()).toMatch(/sequência/);
    expect(problemasDoNovoModelo({ ...base, corpo: "Olá {{2}} e {{1}}, tudo?", exemplos: ["a", "b"] }).join()).toMatch(/na ordem/);
    expect(problemasDoNovoModelo({ ...base, corpo: "Olá {{1}}{{2}} tudo?", exemplos: ["a", "b"] }).join()).toMatch(/coladas/);
    expect(problemasDoNovoModelo({ ...base, corpo: "Olá {{nome}}, tudo?" }).join()).toMatch(/numeradas/);
    expect(problemasDoNovoModelo({ ...base, exemplos: [] }).join()).toMatch(/exemplo para cada variável/);
    expect(problemasDoNovoModelo({ ...base, exemplos: ["a\nb"] }).join()).toMatch(/quebra de linha/);
    expect(problemasDoNovoModelo({ ...base, corpo: `Olá {{1}}, ${"x".repeat(1100)}` }).join()).toMatch(/1024/);
    expect(problemasDoNovoModelo({ ...base, rodape: "y".repeat(61) }).join()).toMatch(/60/);
    expect(problemasDoNovoModelo({ ...base, categoria: "AUTHENTICATION" as never }).join()).toMatch(/Categoria/);
  });
  it("conversão do template e nome do modelo", () => {
    const c = converterTemplateParaModelo({ conteudo: "Olá, {{nome}}! Sou {{corretor}}, da Prospecta. Temos {{imovel}} para você.", nomeModelo: "x", categoria: "MARKETING" });
    expect(c).toMatchObject({ ok: true, variaveis: ["nome", "corretor", "imovel"], modelo: { corpo: "Olá, {{1}}! Sou {{2}}, da Prospecta. Temos {{3}} para você.", exemplos: ["Maria", "João", "exemplo"] } });
    expect(nomeDoModeloDoTemplate("Confirmação de visita", 7)).toBe("confirmacao_de_visita");
    expect(nomeDoModeloDoTemplate("!!!", 7)).toBe("modelo_7");
    expect(nomeDoModeloDoTemplate("Follow-up 48h", 7, 3)).toBe("follow_up_48h_v3");
  });
  it("aviso da Central: disparo em massa é pela Campanha pela API oficial (coexistência já existe)", () => {
    expect(AVISO_DISPARO_BLOQUEADO).toMatch(/Campanha pela API oficial/);
    expect(AVISO_DISPARO_BLOQUEADO).not.toMatch(/fase separada|bloqueado até/);
  });
});

describe("C7.2 — correções do portão de QA", () => {
  it("QA-1: a tentativa conta já na reserva — reserva 'andamento' sem fechamento (função morreu) respeita 1/dia e 3 no total", async () => {
    await integrar();
    await pg.query(`INSERT INTO dashboard_settings (key, value) VALUES ($1, $2)`, [CHAVE_ESTADO_MODELO_PADRAO, JSON.stringify({ s: "andamento", t: 2, d: "2026-11-20", em: "2026-11-20T13:00:00.000Z" })]);
    respostaCriar = () => ({ status: 400, json: { error: { status: 400, code: "PARAM_INVALID" } } });
    expect((await garantirModeloPadrao()).r).toBe("recusado"); // 3ª tentativa
    expect(await estado()).toMatchObject({ s: "recusado", t: 3 });
    relogio = new Date(AGORA.getTime() + 86_400_000);
    expect((await garantirModeloPadrao()).r).toBe("desistiu");
    expect(posts()).toHaveLength(1);
  });

  it("QA-1: durante o POST a reserva já tem a tentativa somada (se o fechamento falhar, nada destrava o limite)", async () => {
    await integrar();
    let durante: any = null;
    respostaCriar = () => ({ status: 200 });
    atrasoCriarMs = 20;
    const p = garantirModeloPadrao();
    await new Promise(r => setTimeout(r, 10));
    durante = await estado();
    await p;
    expect(durante).toMatchObject({ s: "andamento", t: 1 });
  });

  it("QA-1: motivo com caracteres que o JSON escapa → o valor gravado cabe em 500 e é JSON válido", async () => {
    await integrar();
    respostaCriar = () => ({ status: 400, json: { error: { status: 400, code: "PARAM_INVALID", whatsappApiError: { error_user_msg: `${"\\\"".repeat(150)}\ud800\udc00\udbff` } } } });
    expect((await garantirModeloPadrao()).r).toBe("recusado");
    const [r] = await q<{ value: string }>(`SELECT value FROM dashboard_settings WHERE key = '${CHAVE_ESTADO_MODELO_PADRAO}'`);
    expect(r.value.length).toBeLessThanOrEqual(500);
    expect(JSON.parse(r.value)).toMatchObject({ s: "recusado", t: 1 });
    expect(JSON.parse(r.value).m).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  it("QA-2: no cron, prazo total curto — a YCloud travada é abortada e volta 'sem_tempo' sem lançar", async () => {
    await integrar();
    travarListagem = true;
    const t0 = Date.now();
    expect(await garantirModeloPadraoNoCron(1_200)).toBe("sem_tempo");
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(sinalVisto?.aborted).toBe(true);
    expect(posts()).toHaveLength(0);
  });

  it("QA-2: nos dois crons, o modelo padrão roda DEPOIS da rotina principal e não entra na resposta", () => {
    const fonte = readFileSync(new URL("../../api/index.ts", import.meta.url), "utf8");
    const dolores = fonte.indexOf("saida = await tratarCronDolores(req)");
    const depoisDolores = fonte.indexOf("garantirModeloPadraoNoCron(", dolores);
    expect(dolores).toBeGreaterThan(0);
    expect(depoisDolores).toBeGreaterThan(dolores);
    expect(fonte.indexOf("return res.status(saida.status).json(saida.body)")).toBeGreaterThan(depoisDolores);
    const lead = fonte.indexOf("executarRotinaCentralVendas({");
    expect(fonte.indexOf("garantirModeloPadraoNoCron(", lead)).toBeGreaterThan(lead);
    expect(fonte).not.toMatch(/centralVendas, modeloPadrao/);
    expect(fonte).not.toMatch(/garantirModeloPadrao\(\{/);
  });

  it("QA-3: texto mudou e saiu _v2 — a v1 ainda aprovada continua preenchendo as variáveis na campanha", async () => {
    await integrar();
    const texto = "Olá, {{nome}}! Novidade sobre {{servicos}} para você.";
    const r = await admin().whatsapp.salvarTemplate({ nome: "Novidade", categoria: "Captação", conteudo: texto, apiOficial: { categoria: "MARKETING" } });
    const v1 = posts().find(p => p.corpo.name === "novidade")!.corpo;
    await admin().whatsapp.salvarTemplate({ id: r.id, nome: "Novidade", categoria: "Captação", conteudo: "Olá, {{nome}}! Sou {{corretor}}, tenho novidade.", apiOficial: { categoria: "MARKETING" } });
    const v2 = posts().find(p => p.corpo.name === "novidade_v2")!.corpo;
    modelosDaConta = [MARKETING_PT, { ...v1, status: "APPROVED" }, { ...v2, status: "PENDING" }];
    const lista = await admin().whatsappOficial.modelos();
    expect(lista.find(m => m.nome === "novidade")?.variaveisDoTemplate).toEqual(["nome", "servicos"]);
    expect(lista.find(m => m.nome === "novidade_v2")?.variaveisDoTemplate).toEqual(["nome", "corretor"]);
    const [linha] = await q<{ value: string }>(`SELECT value FROM dashboard_settings WHERE key = 'ycloud.template.${r.id}'`);
    expect(linha.value.length).toBeLessThanOrEqual(500);
  });

  it("QA-3: muitas versões — o vínculo cabe em 500 (as versões mais antigas saem primeiro) e a atual sempre fica", async () => {
    await integrar();
    const vars = "{{nome}} {{corretor}} {{servicos}} {{dia}} {{horario}} {{imovel}} {{banco}}";
    let id: number | undefined;
    for (let i = 0; i < 12; i++) {
      const r = await admin().whatsapp.salvarTemplate({ id, nome: "Modelo com nome bem comprido para versões", categoria: "x1", conteudo: `Olá, ${vars.split(" ").join(", e ")} versão ${i}.`, apiOficial: { categoria: "MARKETING" } });
      id = r.id;
      expect(r.apiOficial?.ok).toBe(true);
    }
    const [linha] = await q<{ value: string }>(`SELECT value FROM dashboard_settings WHERE key = 'ycloud.template.${id}'`);
    expect(linha.value.length).toBeLessThanOrEqual(500);
    const v = JSON.parse(linha.value);
    expect(v.ver).toBe(12);
    expect(v.ant.length).toBeGreaterThan(0);
    expect(v.ant[0][0]).toMatch(/_v11$/);
  });

  it("QA-4: o texto do cartão de modelos diz as condições reais do envio automático", () => {
    const fonte = readFileSync(new URL("../../client/src/components/whatsapp/CampanhaApiOficial.tsx", import.meta.url), "utf8");
    expect(fonte).toMatch(/Com a chave salva e o número conferido, se a conta não tiver nenhum modelo de marketing em português/);
  });
});

describe("C7.3 — estado dos modelos por conta (WABA): chave trocada por uma de outra conta", () => {
  const texto = "Olá, {{nome}}! Temos novidade sobre {{servicos}} para você.";
  const salvar = (id?: number) => admin().whatsapp.salvarTemplate({ id, nome: "Novidade WABA", categoria: "Captação", conteudo: texto, apiOficial: { categoria: "MARKETING" } });
  const vinculo = async (id: number) => { const [l] = await q<{ value: string }>(`SELECT value FROM dashboard_settings WHERE key = 'ycloud.template.${id}'`); return JSON.parse(l.value); };

  it("troca de WABA → o template com o mesmo texto é enviado à conta nova e o modelo padrão é criado nela", async () => {
    await integrar();
    expect((await garantirModeloPadrao()).r).toBe("criado");
    const r = await salvar();
    expect(r.apiOficial).toMatchObject({ ok: true, repetido: false });
    expect(await vinculo(r.id)).toMatchObject({ w: "waba1" });
    expect(await estado()).toMatchObject({ s: "criado", w: "waba1" });
    const antes = posts().length;

    wabaDaChave = "waba2";
    await integrar(); // a chave nova é de outra conta: cfg.wabaId passa a ser waba2
    const de_novo = await salvar(r.id);
    expect(de_novo.apiOficial).toMatchObject({ ok: true, repetido: false });
    expect(posts()).toHaveLength(antes + 1);
    expect(posts().at(-1)!.corpo.wabaId).toBe("waba2");
    expect(await vinculo(r.id)).toMatchObject({ w: "waba2" });

    // modelo padrão: o "criado" era da waba1 → na waba2 é como nunca tentado (mesmo dia: a contagem é por conta)
    expect((await admin().whatsappOficial.status()).modeloPadrao).toMatchObject({ situacao: null, tentativas: 0 });
    expect((await garantirModeloPadrao()).r).toBe("criado");
    const padrao = posts().filter(p => p.corpo.name === "novidades_prospecta");
    expect(padrao.map(p => p.corpo.wabaId)).toEqual(["waba1", "waba2"]);
    expect(await estado()).toMatchObject({ s: "criado", t: 1, w: "waba2" });
    expect((await garantirModeloPadrao()).r).toBe("ja_feito");
    const [linha] = await q<{ value: string }>(`SELECT value FROM dashboard_settings WHERE key = '${CHAVE_ESTADO_MODELO_PADRAO}'`);
    expect(linha.value.length).toBeLessThanOrEqual(500);
  });

  it("troca de WABA com recusas: 1 por dia e 3 no total POR WABA (recomeça na conta nova)", async () => {
    await integrar();
    respostaCriar = () => ({ status: 400, json: { error: { status: 400, code: "PARAM_INVALID", message: "rejeitado" } } });
    for (const dia of [0, 1, 2]) { relogio = new Date(AGORA.getTime() + dia * 86_400_000); expect((await garantirModeloPadrao()).r).toBe("recusado"); }
    relogio = new Date(AGORA.getTime() + 3 * 86_400_000);
    expect((await garantirModeloPadrao()).r).toBe("desistiu");
    wabaDaChave = "waba2";
    await integrar();
    expect((await garantirModeloPadrao()).r).toBe("recusado");
    expect((await garantirModeloPadrao()).r).toBe("hoje_ja_tentou");
    expect(await estado()).toMatchObject({ s: "recusado", t: 1, w: "waba2" });
    expect(posts()).toHaveLength(4);
  });

  it("mesma WABA (chave salva de novo) → continua sem repetir", async () => {
    await integrar();
    expect((await garantirModeloPadrao()).r).toBe("criado");
    const r = await salvar();
    const antes = posts().length;
    await integrar();
    expect((await salvar(r.id)).apiOficial).toMatchObject({ ok: true, repetido: true });
    expect((await garantirModeloPadrao()).r).toBe("ja_feito");
    expect(posts()).toHaveLength(antes);
  });

  it("registro antigo sem WABA gravada conta como da WABA atual → não repete (nada de reenvio em massa)", async () => {
    await integrar();
    expect((await garantirModeloPadrao()).r).toBe("criado");
    const r = await salvar();
    const antes = posts().length;
    // simula os registros gravados antes da correção (sem o campo w)
    const semW = (v: string) => { const o = JSON.parse(v); delete o.w; return JSON.stringify(o); };
    for (const k of [CHAVE_ESTADO_MODELO_PADRAO, `ycloud.template.${r.id}`]) {
      const [l] = await q<{ value: string }>(`SELECT value FROM dashboard_settings WHERE key = '${k}'`);
      await pg.query("UPDATE dashboard_settings SET value = $1 WHERE key = $2", [semW(l.value), k]);
    }
    expect((await salvar(r.id)).apiOficial).toMatchObject({ ok: true, repetido: true });
    relogio = new Date(AGORA.getTime() + 86_400_000);
    expect((await garantirModeloPadrao()).r).toBe("ja_feito");
    expect(posts()).toHaveLength(antes);
  });
});
