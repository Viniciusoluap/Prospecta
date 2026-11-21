// EPIC-027 C7.1 — portão de QA de SEGURANÇA (Quinn, 21/11/2026): colaborador com o módulo WhatsApp OPERA campanha pela API oficial;
// a configuração segue só do admin. Testes adicionais (não substituem ycloud.test.ts / ycloud-qa.test.ts): recusa antes de qualquer
// consulta, campos devolvidos ao colaborador, autor não forjável, cadastro excluído, permissão revogada no meio da campanha,
// texto fixo dentro do modelo aprovado. Mesma montagem (PGlite + YCloud simulada) de ycloud.test.ts.
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
import { AVISO_AJUSTE_ADMIN, expirarReservas, motivoParaEquipe, podeContinuarPausa } from "./campanhas.js";
import { detalheComPapel, separarPapel } from "./config.js";
import { problemaDoTextoFixoDaEquipe } from "../../shared/whatsapp/ycloud.js";
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


// ── QA C7.1 ──
type Quem = { role: string; id: number; permissoes?: string[]; ativo?: boolean } | null;
const chamador = (u: Quem) => appRouter.createCaller({
  user: u ? { id: u.id, role: u.role, active: u.ativo ?? true, permissions: JSON.stringify(u.permissoes ?? []), name: "Fulano" } : null, req: {}, res: {},
} as never);
const colab = () => chamador({ role: "colaborador", id: 2, permissoes: ["whatsapp"] });
const PROIBIDOS = () => [CHAVE, SEGREDO, CHAVE.slice(-4), SEGREDO.slice(-4), `+${EMPRESA}`, EMPRESA, DONO, "5599988881111", "98888-1111"];

describe("QA C7.1 — recusa ANTES de qualquer consulta (banco, cofre ou YCloud)", () => {
  it("corretor, cliente, empreiteiro, colaborador sem o módulo, inativo e anônimo: nenhuma rota toca getDb, o cofre ou a rede", async () => {
    const quem: Quem[] = [
      { role: "corretor", id: 3, permissoes: ["whatsapp"] }, { role: "cliente", id: 4, permissoes: ["whatsapp"] },
      { role: "colaborador", id: 2, permissoes: ["crm", "configuracoes", "integracoes"] },
      { role: "colaborador", id: 2, permissoes: ["whatsapp"], ativo: false }, { role: "admin", id: 1, ativo: false }, null,
    ];
    const rotas = (c: ReturnType<typeof chamador>) => [
      () => c.whatsappOficial.prontidao(), () => c.whatsappOficial.modelos(), () => c.whatsappOficial.previa(entrada([1])),
      () => c.whatsappOficial.criarCampanha({ ...entrada([1]), confirmarQuantidade: 1, chaveConfirmacao: "chave-de-teste-0123456789" }),
      () => c.whatsappOficial.enviarLote({ campanhaId: 1 }), () => c.whatsappOficial.mudarCampanha({ campanhaId: 1, acao: "continuar" }),
      () => c.whatsappOficial.campanhas(), () => c.whatsappOficial.detalheCampanha({ campanhaId: 1 }), () => c.whatsappOficial.registrarOptout({ leadId: 1 }),
      () => c.whatsappOficial.status(), () => c.whatsappOficial.auditoria(), () => c.whatsappOficial.salvarConfig({ ligado: true }),
    ];
    vi.mocked(getDb).mockClear();
    const { getDashboardSetting } = await import("../db.js");
    vi.mocked(getDashboardSetting).mockClear();
    for (const u of quem) for (const f of rotas(chamador(u))) await expect(f()).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/) });
    expect(vi.mocked(getDb).mock.calls.length).toBe(0);
    expect(vi.mocked(getDashboardSetting).mock.calls.length).toBe(0);
    expect(chamadas).toHaveLength(0);
  });
});

describe("QA C7.1 — o que o colaborador recebe", () => {
  beforeEach(async () => { await pg.exec(`INSERT INTO users ("openId", name, role, active) VALUES ('col', 'Colab', 'colaborador', true);`); });

  it("prontidão: só os 6 campos combinados (F1: sem a janela de repetição); nunca chave, segredo, final, número, tier ou preço", async () => {
    await configurarTudo();
    const pr = await colab().whatsappOficial.prontidao();
    expect(Object.keys(pr).sort()).toEqual(["ligado", "motivo", "numeroConfere", "pronta", "restanteHoje", "tetoCampanha"]);
    expect(await admin().whatsappOficial.prontidao()).toHaveProperty("janelaRepeticaoDias", 7);
    const s = JSON.stringify(pr);
    for (const p of PROIBIDOS()) expect(s).not.toContain(p);
  });

  it("F1 corrigido: a PRÉVIA ao colaborador traz só vagas {restante, tetoCampanha} e custo {estimado, moeda}; o admin vê tudo", async () => {
    await configurarTudo();
    await admin().whatsappOficial.salvarConfig({ tetoDia: 150, precoEstimado: 0.05 });
    const p = await colab().whatsappOficial.previa(entrada([1]));
    expect(p.vagas).toEqual({ restante: 150, tetoCampanha: 250 });
    expect(p.custo).toEqual({ estimado: 0.05, moeda: "USD" });
    expect(p).not.toHaveProperty("janelaRepeticaoDias");
    const s = JSON.stringify(p);
    for (const x of [...PROIBIDOS(), "limiteDiario", "tetoDia", "usados24h", "janelaRepeticaoDias", "precoUnitario", "\"base\""]) expect(s).not.toContain(x);
    // admin: tudo, como antes
    const a = await admin().whatsappOficial.previa(entrada([1]));
    expect(a.vagas).toEqual({ limiteDiario: 250, tetoDia: 150, usados24h: 0, restante: 150, tetoCampanha: 250 });
    expect(a.custo).toEqual({ precoUnitario: 0.05, estimado: 0.05, moeda: "USD", base: "configurado" });
    expect(a).toHaveProperty("janelaRepeticaoDias", 7);
  });

  it("F2 corrigido: número divergente — a recusa ao colaborador é o texto genérico, sem números nem mascarados; o admin vê o detalhe", async () => {
    await configurarTudo();
    numeroDaApi = "+5599900002222";
    const e = await colab().whatsappOficial.previa(entrada([1])).then(() => null, (x: Error) => x);
    expect(e?.message).toBe(AVISO_AJUSTE_ADMIN);
    const ec = await colab().whatsappOficial.criarCampanha({ ...entrada([1]), confirmarQuantidade: 1, chaveConfirmacao: "chave-de-teste-0123456789" }).then(() => null, (x: Error) => x);
    expect(ec?.message).toBe(AVISO_AJUSTE_ADMIN);
    const ea = await admin().whatsappOficial.previa(entrada([1])).then(() => null, (x: Error) => x);
    expect(ea?.message).toMatch(/NÃO é o número da empresa/);
    expect(ea?.message).toContain("•••• 2222");
    for (const x of [EMPRESA, "5599900002222", CHAVE, SEGREDO]) expect(ea?.message).not.toContain(x);
  });

  it("F2 corrigido: campanha pausada por número divergente — lote e painel mostram ao colaborador o genérico; ao admin, o detalhe", async () => {
    await configurarTudo();
    const p = await colab().whatsappOficial.previa(entrada([1, 2]));
    const { campanhaId } = await colab().whatsappOficial.criarCampanha({ ...entrada([1, 2]), confirmarQuantidade: 2, chaveConfirmacao: p.chaveConfirmacao });
    numeroDaApi = "+5599900002222";
    const r = await colab().whatsappOficial.enviarLote({ campanhaId });
    expect(r).toMatchObject({ status: "pausada", enviadas: 0, motivo: AVISO_AJUSTE_ADMIN });
    expect((await colab().whatsappOficial.campanhas())[0].motivoPausa).toBe(AVISO_AJUSTE_ADMIN);
    expect((await admin().whatsappOficial.campanhas())[0].motivoPausa).toMatch(/•••• 2222.*NÃO é o número da empresa/);
    expect(JSON.stringify(await colab().whatsappOficial.campanhas())).not.toContain("••••");
    expect(envioCalls()).toHaveLength(0);
  });

  it("motivoParaEquipe: limite do dia e janela sem os valores; texto sem número fica igual", () => {
    expect(motivoParaEquipe("Limite de 150 destinatários em 24 h atingido. Clique em \"Continuar\" depois.")).toBe("Limite de destinatários em 24 h atingido. Clique em \"Continuar\" depois.");
    expect(motivoParaEquipe("Não enviada: já recebeu este modelo nos últimos 7 dia(s).")).toBe("Não enviada: já recebeu este modelo recentemente.");
    expect(motivoParaEquipe("O número da API não é o da empresa.")).toBe(AVISO_AJUSTE_ADMIN);
    expect(motivoParaEquipe("falha com +5599900002222")).toBe(AVISO_AJUSTE_ADMIN);
    expect(motivoParaEquipe("Cinco falhas seguidas: campanha pausada.")).toBe("Cinco falhas seguidas: campanha pausada.");
    expect(motivoParaEquipe(null)).toBeNull();
  });

  it("detalhe da campanha: telefone sempre mascarado para o colaborador", async () => {
    await configurarTudo();
    respostaEnvio = () => ({ status: 400, json: { error: { status: 400, code: "WHATSAPP_PHONE_NUMBER_INVALID", message: "número inválido" } } });
    const p = await colab().whatsappOficial.previa(entrada([1, 2]));
    const { campanhaId } = await colab().whatsappOficial.criarCampanha({ ...entrada([1, 2]), confirmarQuantidade: p.contagem.aEnviar, chaveConfirmacao: p.chaveConfirmacao });
    await colab().whatsappOficial.enviarLote({ campanhaId });
    const d = await colab().whatsappOficial.detalheCampanha({ campanhaId });
    expect(d.falhas.length).toBeGreaterThan(0);
    for (const f of d.falhas) expect(f.telefone).toMatch(/^\+\d{2} •••• \d{4}$/);
    const s = JSON.stringify(d) + JSON.stringify(await colab().whatsappOficial.campanhas());
    for (const x of PROIBIDOS()) expect(s).not.toContain(x);
  });
});

describe("QA C7.1 — o colaborador não contorna as travas", () => {
  beforeEach(async () => { await pg.exec(`INSERT INTO users ("openId", name, role, active) VALUES ('col', 'Colab', 'colaborador', true);`); });

  it("autor não é forjável: campo extra (usuarioId/papel/criadaPor) na entrada é recusado pelo schema estrito; nada é criado", async () => {
    await configurarTudo();
    const p = await colab().whatsappOficial.previa(entrada([1]));
    for (const extra of [{ papel: "admin" }, { usuarioId: 1 }, { criadaPor: 1 }, { autor: { id: 1, papel: "admin" } }]) {
      await expect(colab().whatsappOficial.criarCampanha({ ...entrada([1]), confirmarQuantidade: 1, chaveConfirmacao: p.chaveConfirmacao, ...extra } as never))
        .rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(colab().whatsappOficial.mudarCampanha({ campanhaId: 1, acao: "pausar", papel: "admin" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await q("SELECT id FROM ycloud_campanhas")).toHaveLength(0);
    // a criação legítima grava o id/papel do CONTEXTO (servidor)
    const c = await colab().whatsappOficial.criarCampanha({ ...entrada([1]), confirmarQuantidade: 1, chaveConfirmacao: p.chaveConfirmacao });
    expect(await q("SELECT criada_por FROM ycloud_campanhas")).toEqual([{ criada_por: 2 }]);
    expect(await q(`SELECT usuario_id, detalhe FROM ycloud_auditoria WHERE campanha_id = ${c.campanhaId}`)).toEqual([{ usuario_id: 2, detalhe: "papel=colaborador" }]);
  });

  it("cadastro excluído do CRM não vira destinatário (mesmo escopo da lista whatsapp.leadsParaEnvio)", async () => {
    await configurarTudo();
    await pg.exec("UPDATE leads SET deleted_at = now() WHERE id = 1");
    const p = await colab().whatsappOficial.previa(entrada([1, 2]));
    expect(p.contagem).toMatchObject({ selecionados: 2, aEnviar: 1, invalidos: 1 });
  });

  it("texto fixo só dentro do modelo APROVADO: modelo pendente, variável inexistente e texto com quebra de linha são recusados", async () => {
    await configurarTudo();
    await expect(colab().whatsappOficial.previa({ ...entrada([1]), modelo: { nome: "em_analise", idioma: "pt_BR" } })).rejects.toThrow(/APROVADO/);
    await expect(colab().whatsappOficial.previa({ ...entrada([1]), variaveis: { ...entrada([1]).variaveis, "corpo.9": { fonte: "fixo", texto: "x" } } })).rejects.toThrow(/não existe/);
    await expect(colab().whatsappOficial.previa({ ...entrada([1]), variaveis: { ...entrada([1]).variaveis, "corpo.2": { fonte: "fixo", texto: "linha\nnova" } } })).rejects.toThrow(/quebra de linha/);
    expect(envioCalls()).toHaveLength(0);
  });

  it("módulo retirado no meio da campanha: o mesmo colaborador deixa de enviar o lote, pausar ou continuar", async () => {
    await configurarTudo();
    const p = await colab().whatsappOficial.previa(entrada([1, 2]));
    const { campanhaId } = await colab().whatsappOficial.criarCampanha({ ...entrada([1, 2]), confirmarQuantidade: 2, chaveConfirmacao: p.chaveConfirmacao });
    const semModulo = chamador({ role: "colaborador", id: 2, permissoes: ["crm"] });
    await expect(semModulo.whatsappOficial.enviarLote({ campanhaId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(semModulo.whatsappOficial.mudarCampanha({ campanhaId, acao: "cancelar" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(envioCalls()).toHaveLength(0);
  });

  const criarDoColab = async (ids = [1, 2]) => {
    const p = await colab().whatsappOficial.previa(entrada(ids));
    return (await colab().whatsappOficial.criarCampanha({ ...entrada(ids), confirmarQuantidade: p.contagem.aEnviar, chaveConfirmacao: p.chaveConfirmacao })).campanhaId;
  };
  const situacao = async () => (await q<{ status: string; motivo_pausa: string | null }>("SELECT status, motivo_pausa FROM ycloud_campanhas ORDER BY id DESC LIMIT 1"))[0];

  it("F3 corrigido: campanha que o ADMIN pausou o colaborador NÃO continua; o admin continua", async () => {
    await configurarTudo();
    const campanhaId = await criarDoColab();
    await admin().whatsappOficial.mudarCampanha({ campanhaId, acao: "pausar" });
    await expect(colab().whatsappOficial.mudarCampanha({ campanhaId, acao: "continuar" })).rejects.toThrow(/só o administrador pode continuar/);
    expect(await situacao()).toEqual({ status: "pausada", motivo_pausa: "Pausada pelo administrador." });
    // o lote do colaborador também não envia nada (a campanha continua pausada)
    expect(await colab().whatsappOficial.enviarLote({ campanhaId })).toMatchObject({ status: "pausada", enviadas: 0 });
    expect(envioCalls()).toHaveLength(0);
    expect(await q(`SELECT acao FROM ycloud_auditoria WHERE acao = 'campanha_continuar'`)).toHaveLength(0);
    await admin().whatsappOficial.mudarCampanha({ campanhaId, acao: "continuar" });
    expect(await situacao()).toEqual({ status: "enviando", motivo_pausa: null });
  });

  it("F3 corrigido: o admin pausando uma campanha que o colaborador pausou passa a ser pausa do admin (colaborador não continua)", async () => {
    await configurarTudo();
    const campanhaId = await criarDoColab();
    await colab().whatsappOficial.mudarCampanha({ campanhaId, acao: "pausar" });
    await admin().whatsappOficial.mudarCampanha({ campanhaId, acao: "pausar" });
    expect(await situacao()).toEqual({ status: "pausada", motivo_pausa: "Pausada pelo administrador." });
    await expect(colab().whatsappOficial.mudarCampanha({ campanhaId, acao: "continuar" })).rejects.toThrow(/só o administrador/);
    // e a pausa do colaborador nunca troca a do admin
    await colab().whatsappOficial.mudarCampanha({ campanhaId, acao: "pausar" });
    expect((await situacao()).motivo_pausa).toBe("Pausada pelo administrador.");
  });

  it("F3 corrigido: pausa automática por trava de segurança (disparos desligados) só o admin continua", async () => {
    await configurarTudo();
    const campanhaId = await criarDoColab();
    await admin().whatsappOficial.salvarConfig({ ligado: false });
    expect(await colab().whatsappOficial.enviarLote({ campanhaId })).toMatchObject({ status: "pausada", enviadas: 0 });
    await admin().whatsappOficial.salvarConfig({ ligado: true });
    await expect(colab().whatsappOficial.mudarCampanha({ campanhaId, acao: "continuar" })).rejects.toThrow(/só o administrador/);
    expect((await situacao()).status).toBe("pausada");
    await admin().whatsappOficial.mudarCampanha({ campanhaId, acao: "continuar" });
    expect((await situacao()).status).toBe("enviando");
    expect(envioCalls()).toHaveLength(0);
  });

  it("F3: o colaborador continua o que um colaborador pausou e a pausa do limite do dia (o limite é conferido de novo no lote)", async () => {
    await configurarTudo();
    const campanhaId = await criarDoColab();
    await colab().whatsappOficial.mudarCampanha({ campanhaId, acao: "pausar" });
    await colab().whatsappOficial.mudarCampanha({ campanhaId, acao: "continuar" });
    expect((await situacao()).status).toBe("enviando");
    await admin().whatsappOficial.salvarConfig({ tetoDia: 1 });
    const r1 = await colab().whatsappOficial.enviarLote({ campanhaId });
    const r = await colab().whatsappOficial.enviarLote({ campanhaId });
    expect(r1).toMatchObject({ enviadas: 1, restantes: 1 }); // o lote respeita o limite do dia (1)
    expect(r.status).toBe("pausada");
    expect(r.motivo).toMatch(/^Limite de destinatários em 24 h atingido/);
    expect((await situacao()).motivo_pausa).toMatch(/^Limite de 1 destinatários/);
    await colab().whatsappOficial.mudarCampanha({ campanhaId, acao: "continuar" });
    // continuar não contorna o limite: o lote volta a pausar sem enviar
    expect(await colab().whatsappOficial.enviarLote({ campanhaId })).toMatchObject({ status: "pausada", enviadas: 0 });
    expect(envioCalls()).toHaveLength(1);
  });

  it("podeContinuarPausa: regra por papel e motivo", () => {
    expect(podeContinuarPausa("Pausada pelo administrador.", "admin")).toBe(true);
    expect(podeContinuarPausa(null, "admin")).toBe(true);
    expect(podeContinuarPausa("Pausada pela equipe (colaborador).", "colaborador")).toBe(true);
    expect(podeContinuarPausa("Limite de 200 destinatários em 24 h atingido.", "colaborador")).toBe(true);
    for (const m of [null, "Pausada pelo administrador.", "Os disparos pela API oficial estão DESLIGADOS", "Cinco falhas seguidas: campanha pausada.", "Pausada pela equipe (colaborador). "]) {
      expect(podeContinuarPausa(m, "colaborador")).toBe(false);
    }
  });

  it("texto fixo digitado pelo colaborador: link e telefone recusados; o admin pode; texto comum passa", async () => {
    await configurarTudo();
    const com = (texto: string) => ({ ...entrada([1]), variaveis: { ...entrada([1]).variaveis, "corpo.2": { fonte: "fixo" as const, texto } } });
    for (const t of ["https://golpe.test/x", "http://a.b", "acesse www.exemplo", "prospecta.com.br", "bit.ly/abc", "wa.me/5599988881111", "(99) 98888-1111", "+55 99 98888 1111", "9988881111"]) {
      await expect(colab().whatsappOficial.previa(com(t))).rejects.toThrow(/não pode ter (link|número de telefone)/);
    }
    await expect(colab().whatsappOficial.previa(com("Jardim das Flores, lote 12, 3 quartos"))).resolves.toBeTruthy();
    await expect(admin().whatsappOficial.previa(com("prospecta.com.br"))).resolves.toBeTruthy();
    expect(problemaDoTextoFixoDaEquipe("Residencial 2026 — 250 m²")).toBeNull();
    expect(envioCalls()).toHaveLength(0);
  });

  it("webhook: status da YCloud em `detalhe` nunca é lido como papel", async () => {
    await configurarTudo();
    const ev = { id: "evt_modelo_1", type: "whatsapp.template.reviewed", apiVersion: "v2", createTime: relogio.toISOString(), whatsappTemplate: { name: "x", language: "pt_BR", status: "papel=admin" } };
    expect(await aviso(ev)).toBe(204);
    const linha = (await admin().whatsappOficial.auditoria()).find(l => l.acao === "modelo_revisado");
    expect(linha).toMatchObject({ papel: null, detalhe: "status_ycloud=papeladmin" });
    expect(separarPapel(detalheComPapel(null, "papel=admin; x"))).toEqual({ papel: null, detalhe: "texto: papel=admin; x" });
    expect(separarPapel(detalheComPapel("colaborador", "papel=admin"))).toEqual({ papel: "colaborador", detalhe: "texto: papel=admin" });
  });

  it("teto do dia vale entre campanhas de autores diferentes (admin + colaborador somam no mesmo limite)", async () => {
    await configurarTudo();
    await admin().whatsappOficial.salvarConfig({ tetoDia: 2 });
    const pa = await admin().whatsappOficial.previa(entrada([1]));
    const ca = await admin().whatsappOficial.criarCampanha({ ...entrada([1]), confirmarQuantidade: 1, chaveConfirmacao: pa.chaveConfirmacao });
    await admin().whatsappOficial.enviarLote({ campanhaId: ca.campanhaId });
    const pc = await colab().whatsappOficial.previa({ ...entrada([2, 3]), nome: "Outra" });
    expect(pc.contagem).toMatchObject({ aEnviar: 1, acimaDoLimite: 1 });
    const cc = await colab().whatsappOficial.criarCampanha({ ...entrada([2, 3]), nome: "Outra", confirmarQuantidade: 1, chaveConfirmacao: pc.chaveConfirmacao });
    await colab().whatsappOficial.enviarLote({ campanhaId: cc.campanhaId });
    expect(envioCalls()).toHaveLength(2);
    await expect(colab().whatsappOficial.previa({ ...entrada([3]), nome: "Mais" })).resolves.toMatchObject({ contagem: { aEnviar: 0 } });
  });
});
