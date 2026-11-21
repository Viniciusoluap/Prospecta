// EPIC-027 C7 — integração YCloud (API oficial do WhatsApp): permissão por PAPEL pelo appRouter; assinatura do aviso (válida,
// inválida, expirada, reenviada); idempotência e retomada do envio em lotes; limite diário e opt-out; número diferente do da empresa
// bloqueia; a chave nunca aparece em retorno, erro ou log; atualização convergente da situação. PGlite em memória e a API da YCloud
// SIMULADA (nada sai para a rede).
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
  // marca de descadastro da Central de Vendas (tabela real tem mais colunas; aqui só as que a campanha lê)
  await banco.exec("CREATE TABLE IF NOT EXISTS central_vendas_leads (lead_id integer PRIMARY KEY, opt_out boolean NOT NULL DEFAULT false)");
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
  const c = await admin().whatsappOficial.criarCampanha({ ...entrada(leadIds), confirmarQuantidade: p.contagem.aEnviar, chaveConfirmacao: p.chaveConfirmacao });
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

describe("regras puras", () => {
  it("modelo: posicionais suportados; mídia no cabeçalho, nomeados e botão com variável não", () => {
    const a = analisarModelo(modeloAprovado.components);
    expect(a.compativel).toBe(true);
    expect(a.campos.map(c => c.chave)).toEqual(["cabecalho.1", "corpo.1", "corpo.2"]);
    expect(analisarModelo(modeloComImagem.components).compativel).toBe(false);
    expect(analisarModelo([{ type: "BODY", text: "Oi {{nome}}" }]).compativel).toBe(false);
    expect(analisarModelo([{ type: "BODY", text: "Oi {{2}}" }]).compativel).toBe(false);
    expect(analisarModelo([{ type: "BODY", text: "Oi" }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://x.test/{{1}}" }] }]).compativel).toBe(false);
  });
  it("tier: vale o do portfólio; desconhecido → 250 (nunca supõe mais)", () => {
    expect(limiteDoTier({ whatsappBusinessManagerMessagingLimit: "TIER_2K", messagingLimit: "TIER_1K" }).limite).toBe(2000);
    expect(limiteDoTier({ messagingLimit: "TIER_50" }).limite).toBe(50);
    expect(limiteDoTier({ whatsappBusinessManagerMessagingLimit: "TIER_NOT_SET" }).limite).toBe(250);
    expect(limiteDoTier({}).limite).toBe(250);
  });
  it("telefone em E.164 sem inventar o nono dígito; situação convergente", () => {
    expect(telefoneE164("(99) 98888-1111")).toBe("+5599988881111");
    expect(telefoneE164("559988881111")).toBe("+559988881111");
    expect(telefoneE164("123")).toBeNull();
    expect(situacaoConvergente({ lidoEm: new Date(), entregueEm: null })).toBe("lida");
    expect(situacaoConvergente({ entregueEm: new Date(), falhouEm: new Date() })).toBe("entregue");
    expect(situacaoConvergente({ falhouEm: new Date() })).toBe("falhou");
  });
});

describe("permissão por PAPEL (appRouter)", () => {
  it("C7.1: colaborador com o módulo WhatsApp OPERA; corretor e cliente são recusados; configurar segue só do admin", async () => {
    for (const [role, id] of [["corretor", 3], ["cliente", 4]] as const) {
      await expect(caller(role, id).whatsappOficial.status()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(role, id).whatsappOficial.criarCampanha({ ...entrada([1]), confirmarQuantidade: 1, chaveConfirmacao: "chave-de-teste-0123456789" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(role, id).whatsappOficial.enviarLote({ campanhaId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(role, id).whatsappOficial.salvarChave({ apiKey: CHAVE })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const colab = caller("colaborador", 2);
    await expect(colab.whatsappOficial.status()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(colab.whatsappOficial.salvarChave({ apiKey: CHAVE })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(colab.whatsappOficial.salvarConfig({ ligado: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(chamadas).toHaveLength(0);
    // operar: passa da permissão; sem integração configurada, recusa clara (não FORBIDDEN)
    await expect(colab.whatsappOficial.prontidao()).resolves.toMatchObject({ pronta: false });
    await expect(colab.whatsappOficial.previa(entrada([1]))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin().whatsappOficial.status()).resolves.toMatchObject({ configurado: false, ligado: false });
  });
  it("interruptor geral desligado por padrão: sem ligar, nada é disparado", async () => {
    await configurarTudo({ ligar: false });
    await expect(admin().whatsappOficial.previa(entrada([1]))).rejects.toThrow(/DESLIGADOS/);
    expect(envioCalls()).toHaveLength(0);
  });
});

describe("chave e segredo nunca saem", () => {
  it("guardados cifrados; status, teste e erros não trazem a chave; nada em log", async () => {
    const logs: string[] = [];
    const espioes = (["log", "error", "warn", "info"] as const).map(m => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(" ")); }));
    try {
      await configurarTudo();
      expect(settings.get(CHAVE_SEGREDO_YCLOUD)).toBeTruthy();
      expect(settings.get(CHAVE_SEGREDO_YCLOUD)).not.toContain(CHAVE);
      expect(settings.get(CHAVE_SEGREDO_WEBHOOK_YCLOUD)).not.toContain(SEGREDO);
      const s = await admin().whatsappOficial.status();
      const t = await admin().whatsappOficial.testar();
      const saida = JSON.stringify([s, t, await admin().whatsappOficial.modelos(), await admin().whatsappOficial.previa(entrada([1, 2]))]);
      expect(saida).not.toContain(CHAVE);
      expect(saida).not.toContain(SEGREDO);
      expect(s.final).toBe(`…${CHAVE.slice(-4)}`);
      // a YCloud devolve um erro que ECOA a chave errada: a mensagem para a tela é montada pelo código
      const errada = "ycl-outra-chave-errada-0000000000000000";
      const erro = await admin().whatsappOficial.salvarChave({ apiKey: errada }).catch(e => e as Error);
      expect(String((erro as Error).message)).toMatch(/HTTP 401 \(UNAUTHORIZED\)/);
      expect(String((erro as Error).message)).not.toContain(errada);
      // auditoria sem chave nem telefones
      const aud = JSON.stringify(await q("SELECT * FROM ycloud_auditoria"));
      expect(aud).not.toContain(CHAVE);
      expect(aud).not.toMatch(/9888|7777|6666/);
      // a chave só foi enviada à YCloud, no cabeçalho X-API-Key, e só para api.ycloud.com
      expect(chamadas.every(c => c.url.startsWith("https://api.ycloud.com/v2/"))).toBe(true);
      expect(chamadas.some(c => JSON.stringify(c.corpo ?? "").includes(CHAVE))).toBe(false);
      expect(logs.join("\n")).not.toContain(CHAVE);
      expect(logs.join("\n")).not.toContain(SEGREDO);
    } finally { espioes.forEach(e => e.mockRestore()); }
  });
  it("ativar avisos registra SÓ os eventos de status e de revisão de modelo, na URL do servidor", async () => {
    await configurarTudo({ ligar: false });
    const ep = chamadas.find(c => c.url.endsWith("/webhookEndpoints"))!;
    expect(ep.corpo.url).toBe("https://www.exemplo-prospecta.test/api/ycloud/webhook");
    expect(ep.corpo.enabledEvents).toEqual(["whatsapp.message.updated", "whatsapp.template.reviewed", "whatsapp.user.preferences"]);
  });
});

describe("número diferente do da empresa bloqueia", () => {
  it("teste avisa em destaque, ligar é recusado e a prévia não sai", async () => {
    numeroDaApi = "+5511955554444";
    await admin().whatsappOficial.salvarChave({ apiKey: CHAVE });
    await admin().whatsappOficial.ativarAvisos();
    const t = await admin().whatsappOficial.testar();
    expect(t.numeroConfere).toBe(false);
    expect(t.aviso).toMatch(/NÃO é o número da empresa/);
    await expect(admin().whatsappOficial.salvarConfig({ ligado: true })).rejects.toThrow(/NÃO é o número da empresa/);
    // mesmo ligado antes, se o número mudar na YCloud o disparo para
    numeroDaApi = `+${EMPRESA}`;
    await admin().whatsappOficial.salvarConfig({ ligado: true });
    const { campanhaId } = await campanha([1, 2]);
    numeroDaApi = "+5511955554444";
    const r = await admin().whatsappOficial.enviarLote({ campanhaId });
    expect(r.status).toBe("pausada");
    expect(envioCalls()).toHaveLength(0);
  });
});

describe("prévia, limite diário e opt-out", () => {
  it("só cadastros: tira o número do dono, inválido, duplicado e quem pediu para não receber", async () => {
    await configurarTudo();
    await admin().whatsappOficial.registrarOptout({ leadId: 3 });
    const p = await admin().whatsappOficial.previa(entrada([1, 2, 3, 4, 5, 6, 999]));
    expect(p.contagem).toMatchObject({ selecionados: 7, aEnviar: 2, optout: 1, reservados: 1, duplicados: 1, invalidos: 2 });
    expect(p.exemplos[0]).toEqual({ nome: "Maria Souza", texto: "Novidade, Maria\nOlá Maria, conheça o Jardim das Flores." });
    expect(JSON.stringify(p)).not.toMatch(/98888|97777/);
  });
  it("respeita o teto do dia e o tier lido da YCloud (24 h móveis); a contagem confirmada precisa bater", async () => {
    await configurarTudo();
    await admin().whatsappOficial.salvarConfig({ tetoDia: 2 });
    const p = await admin().whatsappOficial.previa(entrada([1, 2, 3]));
    expect(p.contagem).toMatchObject({ aEnviar: 2, acimaDoLimite: 1 });
    await expect(admin().whatsappOficial.criarCampanha({ ...entrada([1, 2, 3]), confirmarQuantidade: 3, chaveConfirmacao: p.chaveConfirmacao })).rejects.toThrow(/contagem mudou/);
    const { campanhaId } = await admin().whatsappOficial.criarCampanha({ ...entrada([1, 2, 3]), confirmarQuantidade: 2, chaveConfirmacao: p.chaveConfirmacao });
    await admin().whatsappOficial.enviarLote({ campanhaId });
    expect(envioCalls()).toHaveLength(2);
    // o dia está cheio: nova campanha não tem vaga
    const cheia = await admin().whatsappOficial.previa(entrada([3]));
    expect(cheia.contagem).toMatchObject({ aEnviar: 0, acimaDoLimite: 1 });
    await expect(admin().whatsappOficial.criarCampanha({ ...entrada([3]), confirmarQuantidade: 1, chaveConfirmacao: cheia.chaveConfirmacao })).rejects.toThrow(/Nenhum destinatário/);
    // 24 h depois a janela libera
    relogio = new Date(AGORA.getTime() + 24 * 60 * 60_000 + 1000);
    expect((await admin().whatsappOficial.previa(entrada([3]))).contagem.aEnviar).toBe(1);
    // tier da conta menor que o teto do painel: vale o tier
    await admin().whatsappOficial.salvarConfig({ tetoDia: 1000 });
    tier = "TIER_50";
    const v = (await admin().whatsappOficial.previa(entrada([3]))).vagas;
    expect(v.limiteDiario).toBe(50);
  });
  it("opt-out registrado depois de criar a campanha: o lote não envia a essa pessoa", async () => {
    await configurarTudo();
    const { campanhaId } = await campanha([1, 2]);
    await pg.exec("INSERT INTO ycloud_optout (telefone, chave_telefone, origem) VALUES ('+5599977772222', '5599977772222', 'whatsapp_preferencia')");
    await admin().whatsappOficial.enviarLote({ campanhaId });
    expect(envioCalls().map(c => c.corpo.to)).toEqual(["+5599988881111"]);
    expect((await envios()).find(e => e.telefone === "+5599977772222")?.status).toBe("falhou");
  });
});

describe("envio: idempotência e retomada", () => {
  it("corpo do envio: fila da YCloud, modelo, variáveis, externalId próprio e filtros de descadastro", async () => {
    await configurarTudo();
    const { campanhaId } = await campanha([1]);
    await admin().whatsappOficial.enviarLote({ campanhaId });
    const c = envioCalls()[0];
    expect(c.metodo).toBe("POST");
    expect(c.corpo).toMatchObject({
      from: `+${EMPRESA}`, to: "+5599988881111", type: "template", externalId: `prospecta-c${campanhaId}-1`, filterUnsubscribed: true, filterBlocked: true,
      template: { name: "lancamento_jardim", language: { code: "pt_BR", policy: "deterministic" }, components: [
        { type: "header", parameters: [{ type: "text", text: "Maria" }] },
        { type: "body", parameters: [{ type: "text", text: "Maria" }, { type: "text", text: "Jardim das Flores" }] },
      ] },
    });
    // a mensagem entra na Central como AUTOMÁTICA (não cala a Dolores)
    const [m] = await q<{ automatica: boolean; destinatario: string; mensagem: string }>("SELECT automatica, destinatario, mensagem FROM whatsapp_messages");
    expect(m).toMatchObject({ automatica: true, destinatario: "5599988881111" });
  });
  it("chamar o lote de novo (ou duas vezes) nunca reenvia ao mesmo número; incerto não é reenviado", async () => {
    await configurarTudo();
    const { campanhaId } = await campanha([1, 2, 3]);
    respostaEnvio = (_c, n) => (n === 2 ? { status: 0, lancar: true } : { status: 200 });
    const r1 = await admin().whatsappOficial.enviarLote({ campanhaId });
    expect(r1).toMatchObject({ enviadas: 2, incertas: 1, status: "concluida" });
    await admin().whatsappOficial.mudarCampanha({ campanhaId, acao: "continuar" }).catch(() => undefined);
    await admin().whatsappOficial.enviarLote({ campanhaId });
    expect(envioCalls()).toHaveLength(3);
    expect(new Set(envioCalls().map(c => c.corpo.to)).size).toBe(3);
    // o aviso da YCloud traz o externalId e resolve o incerto
    const incerto = (await envios()).find(e => e.status === "incerto")!;
    expect(await aviso(evStatus({ id: "ym-tardio", externalId: incerto.external_id, status: "sent" }))).toBe(204);
    expect((await envios()).find(e => e.id === incerto.id)).toMatchObject({ status: "enviada", ycloud_id: "ym-tardio" });
  });
  it("a função encerra no meio (orçamento de tempo): o resto volta para a fila e o próximo lote continua de onde parou", async () => {
    await configurarTudo();
    const { campanhaId } = await campanha([1, 2, 3]);
    avancoPorEnvio = 25_000; // cada envio "leva" 25 s: o lote para depois do 2º
    const r1 = await admin().whatsappOficial.enviarLote({ campanhaId });
    expect(r1).toMatchObject({ enviadas: 2, restantes: 1, status: "enviando" });
    const r2 = await admin().whatsappOficial.enviarLote({ campanhaId });
    expect(r2).toMatchObject({ enviadas: 1, restantes: 0, status: "concluida" });
    expect(envioCalls().map(c => c.corpo.externalId)).toEqual([1, 2, 3].map(i => `prospecta-c${campanhaId}-${i}`));
  });
  it("reserva órfã (função morreu entre o POST e a resposta) vira incerto e não sai de novo", async () => {
    await configurarTudo();
    const { campanhaId } = await campanha([1, 2]);
    await pg.exec(`UPDATE ycloud_envios SET status = 'enviando', reservado_em = '${new Date(AGORA.getTime() - 10 * 60_000).toISOString()}' WHERE id = 1`);
    await expirarReservas(relogio);
    await admin().whatsappOficial.enviarLote({ campanhaId });
    expect(envioCalls().map(c => c.corpo.to)).toEqual(["+5599977772222"]);
    expect((await envios())[0].status).toBe("incerto");
  });
  it("429: devolve para a fila e pede para esperar; erro de conta (saldo) pausa a campanha", async () => {
    await configurarTudo();
    const { campanhaId } = await campanha([1, 2]);
    respostaEnvio = () => ({ status: 429, json: { error: { status: 429, code: "SENDER_RATE_LIMITED" } } });
    const r = await admin().whatsappOficial.enviarLote({ campanhaId });
    expect(r).toMatchObject({ enviadas: 0, restantes: 2, status: "enviando" });
    expect(r.aguardarSegundos).toBeGreaterThan(0);
    respostaEnvio = () => ({ status: 403, json: { error: { status: 403, code: "BALANCE_INSUFFICIENT" } } });
    const r2 = await admin().whatsappOficial.enviarLote({ campanhaId });
    expect(r2.status).toBe("pausada");
    expect(r2.motivo).toMatch(/saldo insuficiente/);
    expect((await envios()).every(e => e.status === "na_fila")).toBe(true);
  });
});

describe("aviso de entrega (webhook)", () => {
  async function comUmEnvio() {
    await configurarTudo();
    const { campanhaId } = await campanha([1]);
    await admin().whatsappOficial.enviarLote({ campanhaId });
    return (await envios())[0];
  }
  it("assinatura: válida processa; inválida, expirada, sem cabeçalho e corpo alterado → 401 sem processar", async () => {
    const e = await comUmEnvio();
    const ev = evStatus({ id: e.ycloud_id, status: "delivered", totalPrice: 0.0625, currency: "USD" });
    const corpo = JSON.stringify(ev);
    expect(await aviso(ev, assinar(corpo, undefined, "segredo-errado-0123456789abcdef"))).toBe(401);
    expect(await aviso(ev, assinar(corpo, Math.floor(relogio.getTime() / 1000) - 8 * 3600 - 1))).toBe(401); // mais velho que a tolerância de reenvio
    expect(await aviso(ev, null)).toBe(401);
    expect(await aviso(ev, assinar(corpo), corpo.replace("delivered", "read"))).toBe(401);
    expect((await envios())[0].status).toBe("aceita");
    expect(await q("SELECT * FROM ycloud_eventos")).toHaveLength(0);
    expect(await aviso(ev)).toBe(204);
    expect((await envios())[0]).toMatchObject({ status: "entregue", preco_final: true });
    expect(verificarAssinaturaYcloud(Buffer.from(corpo), assinar(corpo), SEGREDO, relogio.getTime())).toBe(true);
  });
  it("reenvio do mesmo evento (mesmo id) é aceito sem processar de novo", async () => {
    const e = await comUmEnvio();
    const ev = evStatus({ id: e.ycloud_id, status: "failed", errorCode: "131049", errorMessage: "Não entregue para o número 5599988881111" });
    expect(await aviso(ev)).toBe(204);
    await pg.exec("UPDATE ycloud_envios SET status = 'aceita', falhou_em = NULL");
    expect(await aviso(ev)).toBe(204);
    expect((await envios())[0].status).toBe("aceita"); // não reprocessou
    expect(await q("SELECT * FROM ycloud_eventos")).toHaveLength(1);
  });
  it("situação convergente fora de ordem; preço final; a Central acompanha; motivo sem telefone", async () => {
    const e = await comUmEnvio();
    expect(await aviso(evStatus({ id: e.ycloud_id, status: "read", readTime: relogio.toISOString(), totalPrice: 0.07, currency: "USD" }))).toBe(204);
    expect(await aviso(evStatus({ id: e.ycloud_id, status: "sent", totalPrice: 0.05, currency: "USD" }))).toBe(204);
    expect(await aviso(evStatus({ id: e.ycloud_id, status: "failed", errorMessage: "erro 5599988881111" }))).toBe(204);
    const [x] = await q<{ status: string; preco: string; preco_final: boolean; motivo: string }>("SELECT status, preco, preco_final, motivo FROM ycloud_envios");
    expect(x).toMatchObject({ status: "lida", preco_final: true });
    expect(Number(x.preco)).toBeCloseTo(0.07);
    expect(x.motivo ?? "").not.toContain("5599988881111");
    const [m] = await q<{ status: string }>("SELECT status FROM whatsapp_messages");
    expect(m.status).toBe("lida");
    const painel = await admin().whatsappOficial.campanhas();
    expect(painel[0].totais).toMatchObject({ total: 1, lidas: 1, entregues: 1 });
    expect(painel[0].custoRegistrado).toBeCloseTo(0.07);
  });
  it("falha: motivo agrupado no painel, lista com telefone mascarado", async () => {
    const e = await comUmEnvio();
    await aviso(evStatus({ id: e.ycloud_id, status: "failed", errorCode: "131049", errorMessage: "Meta chose not to deliver" }));
    const d = await admin().whatsappOficial.detalheCampanha({ campanhaId: 1 });
    expect(d.motivos[0]).toMatchObject({ codigo: "131049", quantidade: 1 });
    expect(d.falhas[0].telefone).toBe("+55 •••• 1111");
  });
  it("sem segredo configurado ou corpo já interpretado (não bruto): 401", async () => {
    const res: any = { statusCode: 0, status(c: number) { this.statusCode = c; return this; }, end() { return this; } };
    await tratarWebhookYcloud({ body: { id: "evt_123456", type: "x" }, get: () => "t=1,s=00" } as never, res);
    expect(res.statusCode).toBe(401);
    expect(await aviso(evStatus({ id: "nada", status: "sent" }))).toBe(401); // nenhum segredo salvo ainda
  });
});

describe("rota publicada com corpo bruto", () => {
  it("POST /api/ycloud/webhook fica antes do express.json() na Vercel e no servidor local", () => {
    for (const arq of ["../../api/index.ts", "../_core/index.ts"]) {
      const s = readFileSync(new URL(arq, import.meta.url), "utf8");
      const rota = s.indexOf('"/api/ycloud/webhook", express.raw(');
      expect(rota).toBeGreaterThan(-1);
      expect(rota).toBeLessThan(s.indexOf("app.use(express.json("));
    }
  });
});

describe("eco em coexistência (regra segura, para o roteamento da Dolores)", () => {
  it("só é eco com envio ao MESMO número (forma canônica) há ≤ 10 min E texto que contém o corpo preenchido", async () => {
    const { ehEcoDeCampanhaOficial } = await import("./campanhas.js");
    await configurarTudo();
    const { campanhaId } = await campanha([1]);
    const corpo = "Olá Maria, conheça o Jardim das Flores.";
    expect(await ehEcoDeCampanhaOficial("5599988881111", corpo, relogio)).toBe(false); // ainda na fila
    await admin().whatsappOficial.enviarLote({ campanhaId });
    expect(await ehEcoDeCampanhaOficial("5599988881111", `Novidade, Maria\n${corpo}`, relogio)).toBe(true);
    expect(await ehEcoDeCampanhaOficial("559988881111", corpo, relogio)).toBe(true); // mesmo celular sem o nono dígito
    expect(await ehEcoDeCampanhaOficial("5599988881111", "Oi, tudo bem?", relogio)).toBe(false); // texto da equipe
    expect(await ehEcoDeCampanhaOficial("5599988881111", "", relogio)).toBe(false);
    expect(await ehEcoDeCampanhaOficial("5599977772222", corpo, relogio)).toBe(false);
    expect(await ehEcoDeCampanhaOficial("5599988881111", corpo, new Date(relogio.getTime() + 11 * 60_000))).toBe(false);
  });
});

describe("um lote por vez", () => {
  it("com outro lote em andamento, nada é enviado e a tela é avisada para esperar", async () => {
    await configurarTudo();
    const { campanhaId } = await campanha([1, 2]);
    await pg.exec(`UPDATE ycloud_config SET lote_ate = '${new Date(AGORA.getTime() + 30_000).toISOString()}'`);
    const r = await admin().whatsappOficial.enviarLote({ campanhaId });
    expect(r).toMatchObject({ enviadas: 0, restantes: 2 });
    expect(r.aguardarSegundos).toBeGreaterThan(0);
    expect(envioCalls()).toHaveLength(0);
    relogio = new Date(AGORA.getTime() + 71_000); // trava vencida (função morta) não prende
    expect((await admin().whatsappOficial.enviarLote({ campanhaId })).enviadas).toBe(2);
    expect((await q<{ lote_ate: string | null }>("SELECT lote_ate FROM ycloud_config"))[0].lote_ate).toBeNull();
  });
});

// ── C7.1 (21/11/2026): quem pode disparar — "eu ou colaborador se estiver marcado WhatsApp pra ele" (decisão do dono) ──

type Quem = { role: string; id: number; permissoes?: string[]; ativo?: boolean } | null;
const chamador = (u: Quem) => appRouter.createCaller({
  user: u ? { id: u.id, role: u.role, active: u.ativo ?? true, permissions: JSON.stringify(u.permissoes ?? []), name: "Fulano" } : null, req: {}, res: {},
} as never);
type C = ReturnType<typeof chamador>;
const ROTAS_ADMINISTRAR: Record<string, (c: C) => Promise<unknown>> = {
  status: c => c.whatsappOficial.status(),
  testar: c => c.whatsappOficial.testar(),
  salvarChave: c => c.whatsappOficial.salvarChave({ apiKey: CHAVE }),
  removerChave: c => c.whatsappOficial.removerChave(),
  ativarAvisos: c => c.whatsappOficial.ativarAvisos(),
  salvarSegredoAvisos: c => c.whatsappOficial.salvarSegredoAvisos({ segredo: "y".repeat(24) }),
  salvarConfig: c => c.whatsappOficial.salvarConfig({ tetoDia: 50 }),
  auditoria: c => c.whatsappOficial.auditoria(),
};
const ROTAS_OPERAR: Record<string, (c: C) => Promise<unknown>> = {
  prontidao: c => c.whatsappOficial.prontidao(),
  modelos: c => c.whatsappOficial.modelos(),
  previa: c => c.whatsappOficial.previa(entrada([1])),
  criarCampanha: c => c.whatsappOficial.criarCampanha({ ...entrada([1]), confirmarQuantidade: 1, chaveConfirmacao: "chave-de-teste-0123456789" }),
  enviarLote: c => c.whatsappOficial.enviarLote({ campanhaId: 1 }),
  mudarCampanha: c => c.whatsappOficial.mudarCampanha({ campanhaId: 1, acao: "pausar" }),
  campanhas: c => c.whatsappOficial.campanhas(),
  detalheCampanha: c => c.whatsappOficial.detalheCampanha({ campanhaId: 1 }),
  registrarOptout: c => c.whatsappOficial.registrarOptout({ leadId: 1 }),
};
const barrado = async (f: () => Promise<unknown>) => {
  const e = await f().then(() => null, (x: { code?: string }) => x);
  return Boolean(e && (e.code === "FORBIDDEN" || e.code === "UNAUTHORIZED"));
};

describe("C7.1 — dois níveis: operar campanha × administrar a integração (appRouter)", () => {
  it("toda rota do router está em exatamente um dos dois níveis (rota nova precisa entrar na matriz)", async () => {
    const { whatsappOficialRouter } = await import("./router.js");
    const rotas = Object.keys((whatsappOficialRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures).sort();
    expect(rotas).toEqual([...Object.keys(ROTAS_ADMINISTRAR), ...Object.keys(ROTAS_OPERAR)].sort());
  });

  const perfis: Array<[string, Quem, { operar: boolean; administrar: boolean }]> = [
    ["admin", { role: "admin", id: 1 }, { operar: true, administrar: true }],
    ["colaborador com WhatsApp", { role: "colaborador", id: 2, permissoes: ["whatsapp"] }, { operar: true, administrar: false }],
    ["colaborador com WhatsApp + configurações/integrações", { role: "colaborador", id: 2, permissoes: ["whatsapp", "configuracoes", "integracoes"] }, { operar: true, administrar: false }],
    ["colaborador sem WhatsApp", { role: "colaborador", id: 2, permissoes: ["crm", "agenda"] }, { operar: false, administrar: false }],
    ["corretor (passa em whatsapp.*)", { role: "corretor", id: 3, permissoes: ["whatsapp"] }, { operar: false, administrar: false }],
    ["cliente", { role: "cliente", id: 4, permissoes: ["whatsapp"] }, { operar: false, administrar: false }],
    ["empreiteiro", { role: "empreiteiro", id: 5, permissoes: ["whatsapp"] }, { operar: false, administrar: false }],
    ["colaborador inativo com WhatsApp", { role: "colaborador", id: 2, permissoes: ["whatsapp"], ativo: false }, { operar: false, administrar: false }],
    ["admin inativo", { role: "admin", id: 1, ativo: false }, { operar: false, administrar: false }],
    ["anônimo", null, { operar: false, administrar: false }],
  ];
  for (const [nome, u, espera] of perfis) {
    it(`${nome}: operar ${espera.operar ? "SIM" : "NÃO"}, administrar ${espera.administrar ? "SIM" : "NÃO"}`, async () => {
      await pg.exec(`INSERT INTO users ("openId", name, role, active) VALUES ('col', 'Colab', 'colaborador', true);`);
      const c = chamador(u);
      for (const [rota, f] of Object.entries(ROTAS_OPERAR)) expect({ rota, barrado: await barrado(() => f(c)) }).toEqual({ rota, barrado: !espera.operar });
      for (const [rota, f] of Object.entries(ROTAS_ADMINISTRAR)) expect({ rota, barrado: await barrado(() => f(c)) }).toEqual({ rota, barrado: !espera.administrar });
      if (!espera.operar && !espera.administrar) {
        expect(chamadas).toHaveLength(0); // nada chegou à YCloud
        expect(await q("SELECT id FROM ycloud_auditoria")).toHaveLength(0);
        expect(await q("SELECT id FROM ycloud_campanhas")).toHaveLength(0);
      }
    });
  }
});

describe("C7.1 — colaborador com WhatsApp disparando", () => {
  const colab = () => chamador({ role: "colaborador", id: 2, permissoes: ["whatsapp"] });
  beforeEach(async () => { await pg.exec(`INSERT INTO users ("openId", name, role, active) VALUES ('col', 'Colab', 'colaborador', true);`); });

  it("dispara de ponta a ponta; auditoria registra quem (id e papel); o painel mostra 'disparada por'; nada de chave/segredo", async () => {
    await configurarTudo();
    const respostas: unknown[] = [];
    const pr = await colab().whatsappOficial.prontidao();
    expect(pr).toMatchObject({ pronta: true, motivo: null, ligado: true, numeroConfere: true, restanteHoje: 200 }); // menor entre o tier (250) e o teto do dia (200)
    expect(Object.keys(pr).sort()).toEqual(["janelaRepeticaoDias", "ligado", "motivo", "numeroConfere", "pronta", "restanteHoje", "tetoCampanha"]);
    respostas.push(pr, await colab().whatsappOficial.modelos());
    const p = await colab().whatsappOficial.previa(entrada([1, 2]));
    respostas.push(p);
    const c = await colab().whatsappOficial.criarCampanha({ ...entrada([1, 2]), confirmarQuantidade: p.contagem.aEnviar, chaveConfirmacao: p.chaveConfirmacao });
    respostas.push(c);
    // idempotência vale para ele: a mesma confirmação não cria outra campanha
    expect(await colab().whatsappOficial.criarCampanha({ ...entrada([1, 2]), confirmarQuantidade: p.contagem.aEnviar, chaveConfirmacao: p.chaveConfirmacao })).toMatchObject({ campanhaId: c.campanhaId, repetida: true });
    respostas.push(await colab().whatsappOficial.enviarLote({ campanhaId: c.campanhaId }));
    expect(envioCalls()).toHaveLength(2);
    const painel = await colab().whatsappOficial.campanhas();
    respostas.push(painel, await colab().whatsappOficial.detalheCampanha({ campanhaId: c.campanhaId }));
    expect(painel[0]).toMatchObject({ status: "concluida", disparadaPor: { nome: "Colab", papel: "colaborador" } });
    const aud = await q<{ acao: string; usuario_id: number; detalhe: string | null }>("SELECT acao, usuario_id, detalhe FROM ycloud_auditoria WHERE acao IN ('campanha_criada', 'campanha_concluida') ORDER BY id");
    expect(aud).toEqual([
      { acao: "campanha_criada", usuario_id: 2, detalhe: "papel=colaborador" },
      { acao: "campanha_concluida", usuario_id: 2, detalhe: "papel=colaborador" },
    ]);
    // auditoria completa (só admin) mostra nome e papel
    const lista = await admin().whatsappOficial.auditoria();
    expect(lista.find(a => a.acao === "campanha_criada")).toMatchObject({ usuarioId: 2, usuarioNome: "Colab", papel: "colaborador", detalhe: null });
    expect(lista.find(a => a.acao === "chave_salva")).toMatchObject({ usuarioId: 1, papel: "admin" });
    const saida = JSON.stringify(respostas);
    for (const proibido of [CHAVE, SEGREDO, CHAVE.slice(-4), SEGREDO.slice(-4), `+${EMPRESA}`, EMPRESA, "98888-1111", "5599988881111"]) expect(saida).not.toContain(proibido);
    expect(saida).not.toMatch(/"final"|terminando em/);
  });

  it("interruptor desligado e número divergente: a mesma recusa clara do admin; nada sai", async () => {
    await configurarTudo({ ligar: false });
    await expect(colab().whatsappOficial.prontidao()).resolves.toMatchObject({ pronta: false, motivo: "Os disparos pela API oficial estão desligados pelo administrador." });
    await expect(colab().whatsappOficial.previa(entrada([1]))).rejects.toThrow(/DESLIGADOS pelo administrador/);
    await expect(admin().whatsappOficial.previa(entrada([1]))).rejects.toThrow(/DESLIGADOS pelo administrador/);
    await admin().whatsappOficial.salvarConfig({ ligado: true });
    numeroDaApi = "+5599900002222";
    await expect(colab().whatsappOficial.previa(entrada([1]))).rejects.toThrow(/NÃO é o número da empresa/);
    await expect(colab().whatsappOficial.prontidao()).resolves.toMatchObject({ pronta: false, numeroConfere: false });
    expect(envioCalls()).toHaveLength(0);
  });

  it("tetos, janela de repetição, opt-out e contagem valem para ele (e ele não muda os tetos)", async () => {
    await configurarTudo();
    await admin().whatsappOficial.salvarConfig({ tetoDia: 2 });
    await expect(colab().whatsappOficial.salvarConfig({ tetoDia: 1000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const p = await colab().whatsappOficial.previa(entrada([1, 2, 3]));
    expect(p.contagem).toMatchObject({ aEnviar: 2, acimaDoLimite: 1 });
    await expect(colab().whatsappOficial.criarCampanha({ ...entrada([1, 2, 3]), confirmarQuantidade: 3, chaveConfirmacao: p.chaveConfirmacao })).rejects.toThrow(/contagem mudou/);
    const { campanhaId } = await colab().whatsappOficial.criarCampanha({ ...entrada([1, 2, 3]), confirmarQuantidade: 2, chaveConfirmacao: p.chaveConfirmacao });
    await colab().whatsappOficial.enviarLote({ campanhaId });
    expect((await colab().whatsappOficial.prontidao())).toMatchObject({ pronta: false, restanteHoje: 0 });
    await admin().whatsappOficial.salvarConfig({ tetoDia: 1000 });
    // janela de repetição: quem já recebeu este modelo não recebe de novo
    expect((await colab().whatsappOficial.previa(entrada([1]))).contagem).toMatchObject({ aEnviar: 0, jaRecebeu: 1 });
    // "não enviar mais" registrado por ele vale para todos
    await colab().whatsappOficial.registrarOptout({ leadId: 3 });
    expect((await admin().whatsappOficial.previa(entrada([3]))).contagem).toMatchObject({ aEnviar: 0, optout: 1 });
    const [o] = await q<{ registrado_por: number }>("SELECT registrado_por FROM ycloud_optout");
    expect(o.registrado_por).toBe(2);
    expect(await q("SELECT detalhe FROM ycloud_auditoria WHERE acao = 'optout_registrado'")).toEqual([{ detalhe: "papel=colaborador" }]);
  });

  it("pausar, continuar e cancelar: ele pode; o motivo e a auditoria dizem quem", async () => {
    await configurarTudo();
    const p = await colab().whatsappOficial.previa(entrada([1, 2]));
    const { campanhaId } = await colab().whatsappOficial.criarCampanha({ ...entrada([1, 2]), confirmarQuantidade: 2, chaveConfirmacao: p.chaveConfirmacao });
    await colab().whatsappOficial.mudarCampanha({ campanhaId, acao: "pausar" });
    expect((await colab().whatsappOficial.campanhas())[0]).toMatchObject({ status: "pausada", motivoPausa: "Pausada pela equipe (colaborador)." });
    await colab().whatsappOficial.mudarCampanha({ campanhaId, acao: "continuar" });
    await colab().whatsappOficial.mudarCampanha({ campanhaId, acao: "cancelar" });
    expect((await colab().whatsappOficial.campanhas())[0].status).toBe("cancelada");
    expect(envioCalls()).toHaveLength(0);
    const aud = await q<{ acao: string; detalhe: string }>("SELECT acao, detalhe FROM ycloud_auditoria WHERE acao LIKE 'campanha_%' ORDER BY id");
    expect(aud.map(a => `${a.acao}:${a.detalhe}`)).toEqual([
      "campanha_criada:papel=colaborador", "campanha_pausar:papel=colaborador", "campanha_continuar:papel=colaborador", "campanha_cancelar:papel=colaborador",
    ]);
  });
});
