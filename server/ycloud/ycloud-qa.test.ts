// QA de SEGURANÇA e CUSTO (portão independente, 20/11/2026) — EPIC-027 C7 (YCloud). Provas de ataque/regra; os testes marcados
// "ACHADO" documentam um comportamento ATUAL que o portão considera problema (passam hoje; quando o dev corrigir, invertem a
// expectativa). Mesmo arranjo do ycloud.test.ts: PGlite em memória e a API da YCloud SIMULADA (nada sai para a rede).
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
import { CHAVE_SEGREDO_WEBHOOK_YCLOUD, CHAVE_SEGREDO_YCLOUD, definirDependenciasYcloud } from "./config.js";
import { expirarReservas } from "./campanhas.js";
import { tratarWebhookYcloud, verificarAssinaturaYcloud } from "./webhook.js";
import { analisarModelo, limiteDoTier, situacaoConvergente, telefoneE164 } from "../../shared/whatsapp/ycloud.js";

const CHAVE = "ycl-chave-de-teste-NAO-REAL-0123456789abcdef";
const SEGREDO = "whsec_segredo_de_teste_nao_real_0123456789";
const EMPRESA = "5599900001111";
const DONO = "5599991234567";
const AGORA = new Date("2026-11-20T15:00:00.000Z");

let pg: PGlite;
let relogio: Date;
let numeroDaApi = `+${EMPRESA}`;
let tier = "TIER_250";
let statusNumero = "CONNECTED";
let respostaEnvio: (corpo: any, n: number) => { status: number; json?: unknown; lancar?: boolean } = () => ({ status: 200, json: { id: "x", status: "accepted" } });
let chamadas: Array<{ url: string; metodo: string; chave: string | null; corpo: any }>;
let avancoPorEnvio = 0;

const modeloAprovado = {
  wabaId: "waba1", name: "lancamento_jardim", language: "pt_BR", category: "MARKETING", status: "APPROVED",
  components: [{ type: "HEADER", format: "TEXT", text: "Novidade, {{1}}" }, { type: "BODY", text: "Olá {{1}}, conheça o {{2}}." }, { type: "FOOTER", text: "Prospecta" }],
};
const modeloComImagem = { ...modeloAprovado, name: "com_imagem", components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Oi {{1}}" }] };
const modeloPendente = { ...modeloAprovado, name: "em_analise", status: "PENDING" };

const resposta = (status: number, json: unknown, cab: Record<string, string> = {}) =>
  new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json", ...cab } });

const fetchFalso = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  const h = new Headers(init?.headers);
  const corpo = init?.body ? JSON.parse(String(init.body)) : null;
  chamadas.push({ url: u, metodo: init?.method ?? "GET", chave: h.get("X-API-Key"), corpo });
  if (!u.startsWith("https://api.ycloud.com/v2/")) throw new Error("URL fora da YCloud");
  if (h.get("X-API-Key") !== CHAVE) return resposta(401, { error: { status: 401, code: "UNAUTHORIZED", message: `chave ${h.get("X-API-Key")} recusada` } });
  if (u.includes("/whatsapp/phoneNumbers")) {
    return resposta(200, { offset: 0, limit: 100, length: 1, items: [{ id: "p1", phoneNumber: numeroDaApi, wabaId: "waba1", verifiedName: "VFX Capital", status: statusNumero, qualityRating: "GREEN", messagingLimit: "TIER_1K", whatsappBusinessManagerMessagingLimit: tier }] });
  }
  if (u.includes("/whatsapp/templates")) return resposta(200, { offset: 0, limit: 100, length: 3, items: [modeloAprovado, modeloComImagem, modeloPendente] });
  if (u.endsWith("/webhookEndpoints")) return resposta(200, { id: "ep1", url: corpo.url, enabledEvents: corpo.enabledEvents, status: "active", secret: SEGREDO });
  if (u.endsWith("/unsubscribers")) return resposta(200, corpo);
  if (u.endsWith("/whatsapp/messages")) {
    const n = chamadas.filter(c => c.url.endsWith("/whatsapp/messages")).length;
    relogio = new Date(relogio.getTime() + avancoPorEnvio);
    const r = respostaEnvio(corpo, n);
    if (r.lancar) throw new TypeError("fetch failed");
    return resposta(r.status, r.json ?? { id: `ym${n}`, status: "accepted", externalId: corpo.externalId, totalPrice: 0.0625, currency: "USD" });
  }
  return resposta(404, { error: { status: 404, code: "NOT_FOUND" } });
});

const caller = (role: string, id: number, permissoes: string[] = ["whatsapp"]) =>
  appRouter.createCaller({ user: { id, role, active: true, permissions: JSON.stringify(permissoes), name: "Fulano" }, req: {}, res: {} } as never);
const admin = () => caller("admin", 1);
const q = async <T = any>(s: string) => (await pg.query<T>(s)).rows;
const envios = () => q<{ id: number; telefone: string; status: string; external_id: string; ycloud_id: string | null; preco: string | null; preco_final: boolean; mensagem_central_id: number | null }>("SELECT * FROM ycloud_envios ORDER BY id");
const envioCalls = () => chamadas.filter(c => c.url.endsWith("/whatsapp/messages"));

let ddl: string | null = null;
async function criarBanco() {
  if (!ddl) {
    const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
    const escolhidas: Record<string, unknown> = {};
    for (const [nome, valor] of Object.entries(schema)) if (["users", "leads", "whatsappMessages", "dashboardSettings"].includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
    ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n");
  }
  const banco = new PGlite();
  await banco.exec(ddl);
  const migracao = readFileSync(new URL("../../drizzle/0141_ycloud.sql", import.meta.url), "utf8");
  await banco.exec(migracao);
  await banco.exec(migracao); // idempotente
  return banco;
}

async function configurarTudo(p: { ligar?: boolean } = {}) {
  await admin().whatsappOficial.salvarChave({ apiKey: CHAVE });
  await admin().whatsappOficial.ativarAvisos();
  if (p.ligar !== false) await admin().whatsappOficial.salvarConfig({ ligado: true });
}

const entrada = (leadIds: number[]) => ({
  nome: "Lançamento Jardim", modelo: { nome: "lancamento_jardim", idioma: "pt_BR" }, leadIds,
  variaveis: { "cabecalho.1": { fonte: "primeiro_nome" as const }, "corpo.1": { fonte: "primeiro_nome" as const }, "corpo.2": { fonte: "fixo" as const, texto: "Jardim das Flores" } },
});

async function campanha(leadIds: number[]) {
  const p = await admin().whatsappOficial.previa(entrada(leadIds));
  const c = await admin().whatsappOficial.criarCampanha({ ...entrada(leadIds), confirmarQuantidade: p.contagem.aEnviar });
  return { previa: p, ...c };
}

function assinar(corpo: string, t = Math.floor(relogio.getTime() / 1000), segredo = SEGREDO) {
  return `t=${t},s=${createHmac("sha256", segredo).update(`${t}.${corpo}`).digest("hex")}`;
}
async function aviso(ev: unknown, cabecalho?: string | null, bruto?: string) {
  const corpo = bruto ?? JSON.stringify(ev);
  const res: any = { statusCode: 0, status(c: number) { this.statusCode = c; return this; }, end() { return this; } };
  const req: any = { body: Buffer.from(corpo), get: (n: string) => (n.toLowerCase() === "ycloud-signature" ? (cabecalho === undefined ? assinar(corpo) : cabecalho ?? undefined) : undefined) };
  await tratarWebhookYcloud(req, res);
  return res.statusCode as number;
}
let seqEv = 0;
const evStatus = (m: Record<string, unknown>) => ({ id: `evt_teste_${++seqEv}`, type: "whatsapp.message.updated", apiVersion: "v2", createTime: relogio.toISOString(), whatsappMessage: { wabaId: "waba1", from: `+${EMPRESA}`, ...m } });

const segredoAntes = ENV.cookieSecret;
beforeEach(async () => {
  pg = await criarBanco();
  vi.mocked(getDb).mockReturnValue(drizzle(pg, { schema }) as never);
  settings.clear();
  ENV.cookieSecret = "segredo-do-servidor-de-teste-0123456789";
  relogio = new Date(AGORA);
  numeroDaApi = `+${EMPRESA}`; tier = "TIER_250"; statusNumero = "CONNECTED"; avancoPorEnvio = 0;
  respostaEnvio = () => ({ status: 200 });
  chamadas = [];
  fetchFalso.mockClear();
  await pg.exec(`INSERT INTO users ("openId", name, role, active) VALUES ('adm', 'Admin', 'admin', true);`);
  await pg.exec(`INSERT INTO leads (name, phone) VALUES
    ('Maria Souza', '(99) 98888-1111'), ('João Lima', '99 97777-2222'), ('Ana Paula', '5599966663333'),
    ('Dono Disfarçado', '${DONO}'), ('Sem Telefone', '123'), ('Maria Repetida', '99988881111');`);
  definirDependenciasYcloud({
    agora: () => relogio, fetch: fetchFalso as never, esperar: async () => undefined,
    numeroDaEmpresa: async () => EMPRESA, numeroDoDono: async () => DONO, conexaoDaEmpresaId: async () => 1,
    urlDoSite: () => "https://www.exemplo-prospecta.test",
  });
});
afterEach(async () => {
  definirDependenciasYcloud();
  ENV.cookieSecret = segredoAntes;
  await pg.close();
});

const recebidosPor = (tel: string) => envioCalls().filter(c => c.corpo?.to === tel).length;

describe("QA — dinheiro e proteção do número", () => {
  it("ACHADO 1: duas confirmações (duas abas / reenvio do pedido) criam DUAS campanhas e a mesma pessoa recebe DUAS vezes", async () => {
    await configurarTudo();
    const p = await admin().whatsappOficial.previa(entrada([1, 2]));
    const [a, b] = await Promise.all([
      admin().whatsappOficial.criarCampanha({ ...entrada([1, 2]), confirmarQuantidade: p.contagem.aEnviar }),
      admin().whatsappOficial.criarCampanha({ ...entrada([1, 2]), confirmarQuantidade: p.contagem.aEnviar }),
    ]);
    expect(a.campanhaId).not.toBe(b.campanhaId);
    await admin().whatsappOficial.enviarLote({ campanhaId: a.campanhaId });
    await admin().whatsappOficial.enviarLote({ campanhaId: b.campanhaId });
    expect(recebidosPor("+5599988881111")).toBe(2); // mesmo modelo, mesma pessoa, duas cobranças
    // o limite de 24 h conta destinatários ÚNICOS, então a segunda campanha nem consome vaga
    expect((await admin().whatsappOficial.status()).usados24h).toBe(2);
  });

  it("ACHADO 2: quem disse SAIR na Central de Vendas (central_vendas_leads.opt_out) recebe a campanha da API oficial", async () => {
    await pg.exec(`CREATE TABLE IF NOT EXISTS central_vendas_leads (lead_id integer PRIMARY KEY, opt_out boolean NOT NULL DEFAULT false);
      INSERT INTO central_vendas_leads (lead_id, opt_out) VALUES (1, true);`);
    await configurarTudo();
    const { campanhaId, previa } = await campanha([1]);
    expect(previa.contagem.optout).toBe(0);
    await admin().whatsappOficial.enviarLote({ campanhaId });
    expect(recebidosPor("+5599988881111")).toBe(1);
  });

  it("ACHADO 3: opt-out gravado SEM o nono dígito (formato do wa_id antigo) não bloqueia o mesmo celular com o 9", async () => {
    await configurarTudo();
    await pg.exec(`INSERT INTO ycloud_optout (telefone, origem) VALUES ('+559988881111', 'whatsapp_preferencia')`);
    const { campanhaId, previa } = await campanha([1]);
    expect(previa.contagem.optout).toBe(0);
    await admin().whatsappOficial.enviarLote({ campanhaId });
    expect(recebidosPor("+5599988881111")).toBe(1);
  });

  it("ACHADO 4: o mesmo celular em dois cadastros, com e sem o nono dígito, recebe duas vezes na MESMA campanha", async () => {
    await pg.exec(`INSERT INTO leads (name, phone) VALUES ('Maria Antiga', '(99) 8888-1111')`); // id 7
    await configurarTudo();
    const { campanhaId, previa } = await campanha([1, 7]);
    expect(previa.contagem.duplicados).toBe(0);
    await admin().whatsappOficial.enviarLote({ campanhaId });
    expect(recebidosPor("+5599988881111") + recebidosPor("+559988881111")).toBe(2);
  });

  it("ACHADO 5: o nome do cadastro (vem de fora: pushName do WhatsApp, formulário do site) entra na variável sem filtro — link sai pelo número oficial", async () => {
    await pg.exec(`INSERT INTO leads (name, phone) VALUES ('https://golpe.example/pix Clique', '99 95555-4444')`); // id 7
    await configurarTudo();
    const { campanhaId } = await campanha([7]);
    await admin().whatsappOficial.enviarLote({ campanhaId });
    const corpo = envioCalls()[0].corpo;
    expect(JSON.stringify(corpo.template.components)).toContain("https://golpe.example/pix");
  });

  it("ACHADO 7: aviso de entrega que chega ANTES da gravação do aceite é sobrescrito (volta para 'aceita' e perde o preço final)", async () => {
    await configurarTudo();
    const { campanhaId } = await campanha([1]);
    const original = fetchFalso.getMockImplementation()!;
    definirDependenciasYcloud({
      agora: () => relogio, esperar: async () => undefined, numeroDaEmpresa: async () => EMPRESA, numeroDoDono: async () => DONO,
      conexaoDaEmpresaId: async () => 1, urlDoSite: () => "https://www.exemplo-prospecta.test",
      fetch: (async (u: any, init?: RequestInit) => {
        const r = await original(u, init);
        if (String(u).endsWith("/whatsapp/messages")) {
          const ext = JSON.parse(String(init!.body)).externalId;
          expect(await aviso(evStatus({ externalId: ext, status: "delivered", totalPrice: 0.0625, currency: "USD" }))).toBe(204);
          expect((await envios())[0].status).toBe("entregue");
        }
        return r;
      }) as never,
    });
    await admin().whatsappOficial.enviarLote({ campanhaId });
    const [e] = await envios();
    expect(e.status).toBe("aceita");
    expect(e.preco_final).toBe(true); // marcado como final…
    expect(e.preco).not.toBeNull();   // (preço da resposta do POST, não o do aviso)
  });

  it("OK: trava de lote é atômica — dois lotes em paralelo (mesma campanha) não enviam duas vezes", async () => {
    await configurarTudo();
    const { campanhaId } = await campanha([1, 2, 3]);
    const r = await Promise.all([1, 2, 3].map(() => admin().whatsappOficial.enviarLote({ campanhaId })));
    expect(r.filter(x => x.enviadas > 0)).toHaveLength(1);
    expect(envioCalls()).toHaveLength(3);
    expect(new Set(envioCalls().map(c => c.corpo.to)).size).toBe(3);
  });

  it("OK: interruptor desligado no servidor bloqueia o lote de uma campanha já criada (pausa, nada sai)", async () => {
    await configurarTudo();
    const { campanhaId } = await campanha([1, 2]);
    await admin().whatsappOficial.salvarConfig({ ligado: false });
    const r = await admin().whatsappOficial.enviarLote({ campanhaId });
    expect(r.status).toBe("pausada");
    expect(envioCalls()).toHaveLength(0);
  });

  it("OK: número da API trocado depois da criação bloqueia o lote no servidor", async () => {
    await configurarTudo();
    const { campanhaId } = await campanha([1]);
    numeroDaApi = "+5511999998888";
    const r = await admin().whatsappOficial.enviarLote({ campanhaId });
    expect(r.status).toBe("pausada");
    expect(envioCalls()).toHaveLength(0);
  });

  it("OK: o cliente não injeta telefone (campo extra recusado) e o número da empresa nunca é alvo", async () => {
    await pg.exec(`INSERT INTO leads (name, phone) VALUES ('Empresa', '${EMPRESA}')`); // id 7
    await configurarTudo();
    await expect(admin().whatsappOficial.previa({ ...entrada([1]), telefones: ["+5511999990000"] } as never)).rejects.toThrow();
    const p = await admin().whatsappOficial.previa(entrada([7, 4]));
    expect(p.contagem).toMatchObject({ reservados: 2, aEnviar: 0 });
  });

  it("OK: contagem alterada entre a prévia e a confirmação é recusada", async () => {
    await configurarTudo();
    const p = await admin().whatsappOficial.previa(entrada([1, 2]));
    await pg.exec(`INSERT INTO ycloud_optout (telefone, origem) VALUES ('+5599977772222', 'painel')`);
    await expect(admin().whatsappOficial.criarCampanha({ ...entrada([1, 2]), confirmarQuantidade: p.contagem.aEnviar })).rejects.toThrow(/contagem mudou/);
  });
});

describe("QA — webhook público", () => {
  async function comUmEnvio() {
    await configurarTudo();
    const { campanhaId } = await campanha([1]);
    await admin().whatsappOficial.enviarLote({ campanhaId });
    return (await envios())[0];
  }
  it("cabeçalho duplicado, gigante, t no futuro, s curto, t não numérico → 401; nada gravado", async () => {
    const e = await comUmEnvio();
    const ev = evStatus({ id: e.ycloud_id, status: "delivered" });
    const corpo = JSON.stringify(ev);
    const ok = assinar(corpo);
    const agoraS = Math.floor(relogio.getTime() / 1000);
    for (const cab of [
      `${ok}, ${ok}`, `${ok},${"x".repeat(2000)}`, assinar(corpo, agoraS + 301), ok.replace(/s=[0-9a-f]+/, "s=abcd"),
      ok.replace(/t=\d+/, "t=1e9"), `s=${ok.split("s=")[1]}`, "", "t=,s=",
    ]) expect(await aviso(ev, cab)).toBe(401);
    expect(await q("SELECT * FROM ycloud_eventos")).toHaveLength(0);
    expect((await envios())[0].status).toBe("aceita");
  });
  it("JSON inválido com assinatura válida → 400 sem gravar; evento sem id → 400", async () => {
    await comUmEnvio();
    expect(await aviso(null, undefined, "{nao-e-json")).toBe(400);
    expect(await aviso({ type: "whatsapp.message.updated" })).toBe(400);
    expect(await q("SELECT * FROM ycloud_eventos")).toHaveLength(0);
  });
  it("evento antigo (assinatura válida de 6 min atrás) → 401; reenvio dentro da janela com outro t e mesmo id → 204 sem reprocessar", async () => {
    const e = await comUmEnvio();
    const ev = evStatus({ id: e.ycloud_id, status: "failed" });
    const corpo = JSON.stringify(ev);
    expect(await aviso(ev, assinar(corpo, Math.floor(relogio.getTime() / 1000) - 360))).toBe(401);
    expect(await aviso(ev)).toBe(204);
    await pg.exec("UPDATE ycloud_envios SET status = 'aceita', falhou_em = NULL");
    expect(await aviso(ev, assinar(corpo, Math.floor(relogio.getTime() / 1000) - 10))).toBe(204);
    expect((await envios())[0].status).toBe("aceita");
  });
  it("externalId de formato estranho é ignorado; aviso não toca mensagem NÃO automática da Central", async () => {
    const e = await comUmEnvio();
    await pg.exec(`UPDATE whatsapp_messages SET automatica = false`);
    expect(await aviso(evStatus({ externalId: "'; DROP TABLE x;--", status: "failed" }))).toBe(204);
    expect(await aviso(evStatus({ id: e.ycloud_id, status: "failed" }))).toBe(204);
    const [m] = await q<{ status: string }>("SELECT status FROM whatsapp_messages");
    expect(m.status).toBe("enviada");
  });
  it("tipo de mensagem RECEBIDA (inbound) é ignorado: nada vai para a Central (sem duplicar com a Evolution)", async () => {
    await comUmEnvio();
    const antes = (await q("SELECT id FROM whatsapp_messages")).length;
    expect(await aviso({ id: "evt_inbound_1", type: "whatsapp.inbound_message.received", whatsappInboundMessage: { from: "+5599988881111", text: { body: "oi" } } })).toBe(204);
    expect((await q("SELECT id FROM whatsapp_messages")).length).toBe(antes);
  });
});

describe("QA — permissão e segredo", () => {
  it("anônimo, colaborador com módulo, corretor, cliente e empreiteiro: todas as rotas barradas (inclusive leituras)", async () => {
    const semUser = appRouter.createCaller({ user: null, req: {}, res: {} } as never);
    const quem = [semUser, caller("colaborador", 2, ["whatsapp", "configuracoes", "integracoes"]), caller("corretor", 3), caller("cliente", 4), caller("empreiteiro", 5)];
    for (const c of quem) {
      for (const f of [
        () => c.whatsappOficial.status(), () => c.whatsappOficial.campanhas(), () => c.whatsappOficial.detalheCampanha({ campanhaId: 1 }),
        () => c.whatsappOficial.testar(), () => c.whatsappOficial.salvarSegredoAvisos({ segredo: "x".repeat(20) }),
        () => c.whatsappOficial.registrarOptout({ leadId: 1 }), () => c.whatsappOficial.enviarLote({ campanhaId: 1 }),
      ]) await expect(f()).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/) });
    }
  });
  it("nenhuma rota devolve o segredo do webhook nem a chave (só os 4 finais)", async () => {
    await configurarTudo();
    const s = JSON.stringify(await admin().whatsappOficial.status()) + JSON.stringify(await admin().whatsappOficial.testar())
      + JSON.stringify(await admin().whatsappOficial.ativarAvisos());
    expect(s).not.toContain(SEGREDO);
    expect(s).not.toContain(CHAVE);
    expect(s).not.toContain(SEGREDO.slice(0, 12));
    for (const v of settings.values()) { expect(v).not.toContain(SEGREDO); expect(v).not.toContain(CHAVE); }
  });
});

describe("QA — ordem dos middlewares (HTTP real com express)", () => {
  it("rota da YCloud recebe os bytes exatos; outra rota JSON continua interpretada; corpo > 1 MB → 413 sem chegar ao handler", async () => {
    const express = (await import("express")).default;
    const app = express();
    let bruto: unknown = null, chamou = 0;
    app.post("/api/whatsapp/webhook", express.raw({ type: "application/json" }), (req, res) => { res.json({ buf: Buffer.isBuffer(req.body) }); });
    app.post("/api/ycloud/webhook", express.raw({ type: "application/json", limit: "1mb" }), (req, res) => { chamou++; bruto = req.body; res.status(204).end(); });
    app.use(express.json({ limit: "50mb" }));
    app.post("/api/outra", (req, res) => { res.json({ eco: req.body }); });
    const srv = app.listen(0);
    const porta = (srv.address() as any).port;
    try {
      const corpo = '{ "id":"evt_1",\n  "type": "x", "t":"\\u00e9 ção" }';
      await fetch(`http://127.0.0.1:${porta}/api/ycloud/webhook`, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: corpo });
      expect(Buffer.isBuffer(bruto) && (bruto as Buffer).toString("utf8")).toBe(corpo);
      const o = await (await fetch(`http://127.0.0.1:${porta}/api/outra`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"a":1}' })).json();
      expect(o).toEqual({ eco: { a: 1 } });
      const w = await (await fetch(`http://127.0.0.1:${porta}/api/whatsapp/webhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"a":1}' })).json();
      expect(w).toEqual({ buf: true });
      const antes = chamou;
      const grande = await fetch(`http://127.0.0.1:${porta}/api/ycloud/webhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(1_100_000) });
      expect(grande.status).toBe(413);
      expect(chamou).toBe(antes);
    } finally { srv.close(); }
  });
});
