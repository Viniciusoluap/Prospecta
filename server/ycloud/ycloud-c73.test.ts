// EPIC-027 C7.3 (21/11/2026) — três achados BAIXOS do portão de QA da C7.1 (rodada 2) e o texto neutro para o colaborador:
// 1) filtro do texto fixo do colaborador endurecido (normalização, link por extenso, palavra.palavra, @perfil, dígitos separados),
//    sem falso positivo em frases normais; 2) eco de campanha só com o texto EXATO da campanha (nada de "contém"); 3) pausa do admin
//    não se contorna com cancelar + recriar; 5) "6+ dígitos" que não é da integração → frase neutra. Mesma montagem (PGlite + YCloud
//    simulada) de ycloud-qa-c71.test.ts; nada sai para a rede.
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
import { AVISO_AJUSTE_ADMIN, AVISO_NAO_CONCLUIDO, CODIGO_CANCELADA_EM_PAUSA_ADMIN, ehEcoDeCampanhaOficial, expirarReservas, motivoParaEquipe, podeContinuarPausa, textoEhDaCampanha } from "./campanhas.js";
import { detalheComPapel, separarPapel } from "./config.js";
import { problemaDoTextoFixoDaEquipe, textoFixoNormalizado } from "../../shared/whatsapp/ycloud.js";
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

const comFixo = (texto: string, leadIds = [1]) => ({ ...entrada(leadIds), variaveis: { ...entrada(leadIds).variaveis, "corpo.2": { fonte: "fixo" as const, texto } } });
const colabNoBanco = () => pg.exec(`INSERT INTO users ("openId", name, role, active) VALUES ('col', 'Colab', 'colaborador', true);`);

// ── Item 1 ──
const RUINS = [
  // rodada 2 (passavam)
  "exemplo ponto com", "exemplo . com", "exemplo .com", "exemplo․com", "exemplo·com", "exemplo．com", "exemplo.dev", "exemplo.ai",
  "meusite.app", "x.io", "11/9999/8888", "11 9 9999 8888", "１１９９９９９８８８８", "@perfil_no_instagram",
  "@ perfil", "＠perfil", "contato arroba gmail", "site ponto br", "exem​plo.com", "11_9999_8888", "11–99999–8888",
  "①①⑨⑨⑨⑨⑨⑧⑧⑧⑧", "25/11/2026 99999 8888",
  // já pegava (continua)
  "https://x.y", "www.exemplo", "exemplo.com", "EXEMPLO.COM.BR", "bit.ly/abc", "wa.me/5511", "t.me/x", "(11) 99999-8888",
  "+55 11 9 9999 8888", "1 1 9 9 9 9 8 8 8 8", "11.99999.8888", "9988881111", "prospecta.com.br",
];
const BONS = [
  "às 14h30", "R$ 1.500,00", "R$ 1.500.000,00", "Entrada de R$ 15.000 em 60x", "Rua 7, nº 120", "25/11/2026", "de 25/11 a 30/11/2026",
  "No dia 25/11/2026, às 14h, no stand 3", "CEP 12345-678", "Torre 2, apto 1203", "Chegue cedo. Traga documentos", "Com certeza. Com carinho",
  "Residencial 2026 — 250 m²", "Jardim das Flores, lote 12, 3 quartos", "Olá, tudo bem? Venha conhecer.", "Venha... conheça!",
  "Piscina • Academia • Churrasqueira", "Lazer · Segurança", "Plantão: sábado e domingo", "Condomínio São José",
];

describe("C7.3 item 1 — texto fixo do colaborador", () => {
  it("normalização: NFKC, sem acento, minúsculas, pontos e traços parecidos, espaço antes do ponto", () => {
    expect(textoFixoNormalizado("EXEMPLO . Com")).toBe("exemplo.com");
    expect(textoFixoNormalizado("exemplo․com")).toBe("exemplo.com");
    expect(textoFixoNormalizado("１２")).toBe("12");
    expect(textoFixoNormalizado("Ação  São")).toBe("acao sao");
    expect(textoFixoNormalizado("Frase. Depois")).toBe("frase. depois");
  });
  it("recusa as ofuscações (link e telefone) e não recusa frases normais", () => {
    for (const v of RUINS) expect(problemaDoTextoFixoDaEquipe(v), v).not.toBeNull();
    for (const v of BONS) expect(problemaDoTextoFixoDaEquipe(v), v).toBeNull();
    expect(problemaDoTextoFixoDaEquipe("11/9999/8888")).toMatch(/telefone/);
    expect(problemaDoTextoFixoDaEquipe("exemplo ponto com")).toMatch(/link/);
  });
  it("no servidor: o colaborador é recusado na prévia; o admin continua sem esse filtro", async () => {
    await colabNoBanco();
    await configurarTudo();
    for (const t of ["exemplo ponto com", "exemplo.dev", "11/9999/8888", "@perfil"]) {
      await expect(colab().whatsappOficial.previa(comFixo(t))).rejects.toThrow(/não pode ter (link|número de telefone)/);
      await expect(admin().whatsappOficial.previa(comFixo(t))).resolves.toBeTruthy();
    }
    await expect(colab().whatsappOficial.previa(comFixo("às 14h30, R$ 1.500,00"))).resolves.toBeTruthy();
    expect(envioCalls()).toHaveLength(0);
  });
});

// ── Item 2 ──
const CORPO_M = "Olá Maria, conheça o Jardim das Flores.";
describe("C7.3 item 2 — eco de campanha só com o texto da campanha", () => {
  it("envio com cabeçalho e rodapé guardados: só o texto exato (com ou sem cabeçalho/rodapé); acréscimo é da equipe", () => {
    const envio = { texto: CORPO_M, parametros: { textoCompleto: `Novidade, Maria\n${CORPO_M}`, rodape: "Prospecta" } };
    for (const eco of [CORPO_M, `Novidade, Maria\n${CORPO_M}`, `Novidade, Maria\n${CORPO_M}\nProspecta`, `${CORPO_M}\nProspecta`, `  ${CORPO_M.toUpperCase()}  `]) {
      expect(textoEhDaCampanha(eco, envio), eco).toBe(true);
    }
    for (const eco of [`${CORPO_M}\nMe chama aqui se tiver dúvida`, `${CORPO_M} ok`, `Novidade, Maria\n${CORPO_M}\nProspecta\nAbs, Bia`, `Oi! ${CORPO_M}`,
      "Olá João, conheça o Jardim das Flores.", "Olá Maria", "", `${CORPO_M}\nProspecta 2`]) {
      expect(textoEhDaCampanha(eco, envio), eco).toBe(false);
    }
  });
  it("sem rodapé no modelo (rodape: null): nada depois do corpo", () => {
    const envio = { texto: CORPO_M, parametros: { textoCompleto: CORPO_M, rodape: null } };
    expect(textoEhDaCampanha(CORPO_M, envio)).toBe(true);
    expect(textoEhDaCampanha(`${CORPO_M} Prospecta`, envio)).toBe(false);
    expect(textoEhDaCampanha(`Novidade ${CORPO_M}`, envio)).toBe(false);
  });
  it("envio antigo (sem rodapé guardado): tolerância de um rodapé (60); sem cabeçalho guardado, de um cabeçalho", () => {
    const antigo = { texto: CORPO_M, parametros: { textoCompleto: `Novidade, Maria\n${CORPO_M}` } };
    expect(textoEhDaCampanha(`Novidade, Maria\n${CORPO_M}\nProspecta`, antigo)).toBe(true);
    expect(textoEhDaCampanha(`Oi, ${CORPO_M}`, antigo)).toBe(false); // o cabeçalho guardado é exato
    expect(textoEhDaCampanha(`${CORPO_M}\n${"x".repeat(61)}`, antigo)).toBe(false);
    const semNada = { texto: CORPO_M, parametros: {} };
    expect(textoEhDaCampanha(`Novidade, Maria\n${CORPO_M}\nProspecta`, semNada)).toBe(true);
    expect(textoEhDaCampanha(`${"y".repeat(61)} ${CORPO_M}`, semNada)).toBe(false);
  });
  it("de ponta a ponta: a campanha guarda o rodapé e o eco com acréscimo NÃO é eco", async () => {
    await configurarTudo();
    const { campanhaId } = await campanha([1]);
    await admin().whatsappOficial.enviarLote({ campanhaId });
    const [e] = await q<{ parametros: any; texto: string }>("SELECT parametros, texto FROM ycloud_envios WHERE lead_id = 1");
    expect(e.texto).toBe(CORPO_M);
    expect(e.parametros).toMatchObject({ textoCompleto: `Novidade, Maria\n${CORPO_M}`, rodape: "Prospecta" });
    expect(await ehEcoDeCampanhaOficial("5599988881111", `Novidade, Maria\n${CORPO_M}\nProspecta`, relogio)).toBe(true);
    expect(await ehEcoDeCampanhaOficial("5599988881111", CORPO_M, relogio)).toBe(true);
    expect(await ehEcoDeCampanhaOficial("5599988881111", `${CORPO_M}\nQualquer dúvida me chama, Bia`, relogio)).toBe(false);
    expect(await ehEcoDeCampanhaOficial("5599988881111", `Novidade, Maria\n${CORPO_M}\nProspecta\nPassa aqui amanhã`, relogio)).toBe(false);
  });
});

// ── Item 3 ──
describe("C7.3 item 3 — pausa do admin não se contorna com cancelar + recriar", () => {
  beforeEach(colabNoBanco);
  const situacao = async (id: number) => (await q<{ status: string; motivo_pausa: string | null }>(`SELECT status, motivo_pausa FROM ycloud_campanhas WHERE id = ${id}`))[0];

  it("colaborador não cancela a pausa do admin nem a de uma trava; o admin cancela", async () => {
    await configurarTudo();
    const { campanhaId } = await campanha([1, 2]);
    await admin().whatsappOficial.mudarCampanha({ campanhaId, acao: "pausar" });
    await expect(colab().whatsappOficial.mudarCampanha({ campanhaId, acao: "cancelar" })).rejects.toThrow(/só o administrador pode cancelar/);
    expect(await situacao(campanhaId)).toMatchObject({ status: "pausada", motivo_pausa: "Pausada pelo administrador." });
    await pg.exec(`UPDATE ycloud_campanhas SET motivo_pausa = 'Cinco falhas seguidas: campanha pausada para conferir o modelo e a conta.' WHERE id = ${campanhaId}`);
    await expect(colab().whatsappOficial.mudarCampanha({ campanhaId, acao: "cancelar" })).rejects.toThrow(/só o administrador pode cancelar/);
    await admin().whatsappOficial.mudarCampanha({ campanhaId, acao: "cancelar" });
    expect((await situacao(campanhaId)).status).toBe("cancelada");
    expect((await q<{ erro_codigo: string }>("SELECT erro_codigo FROM ycloud_envios ORDER BY id")).map(r => r.erro_codigo)).toEqual([CODIGO_CANCELADA_EM_PAUSA_ADMIN, CODIGO_CANCELADA_EM_PAUSA_ADMIN]);
    expect(envioCalls()).toHaveLength(0);
  });

  it("quem estava na fila conta como 'já recebeu' para o colaborador (não é reenviado); o admin pode recriar", async () => {
    await configurarTudo();
    const { campanhaId } = await campanha([1, 2]);
    await admin().whatsappOficial.mudarCampanha({ campanhaId, acao: "pausar" });
    await admin().whatsappOficial.mudarCampanha({ campanhaId, acao: "cancelar" });
    expect((await colab().whatsappOficial.previa({ ...entrada([1, 2, 3]), nome: "De novo" })).contagem).toMatchObject({ aEnviar: 1, jaRecebeu: 2 });
    expect((await admin().whatsappOficial.previa({ ...entrada([1, 2]), nome: "De novo" })).contagem).toMatchObject({ aEnviar: 2, jaRecebeu: 0 });
  });

  it("e no lote: campanha do admin rodada pelo colaborador também confere (o envio vira REPETIDO, nada sai)", async () => {
    await configurarTudo();
    const a = await campanha([1]);
    await admin().whatsappOficial.mudarCampanha({ campanhaId: a.campanhaId, acao: "pausar" });
    await admin().whatsappOficial.mudarCampanha({ campanhaId: a.campanhaId, acao: "cancelar" });
    const b = await campanha([1]); // o admin pode recriar
    await colab().whatsappOficial.enviarLote({ campanhaId: b.campanhaId });
    expect(envioCalls()).toHaveLength(0);
    expect((await q<{ erro_codigo: string }>(`SELECT erro_codigo FROM ycloud_envios WHERE campanha_id = ${b.campanhaId}`))[0].erro_codigo).toBe("REPETIDO");
  });

  it("rodado pelo admin, a campanha do admin sai normalmente", async () => {
    await configurarTudo();
    const a = await campanha([1]);
    await admin().whatsappOficial.mudarCampanha({ campanhaId: a.campanhaId, acao: "pausar" });
    await admin().whatsappOficial.mudarCampanha({ campanhaId: a.campanhaId, acao: "cancelar" });
    const b = await campanha([1]);
    await admin().whatsappOficial.enviarLote({ campanhaId: b.campanhaId });
    expect(envioCalls()).toHaveLength(1);
  });

  it("pausa do próprio colaborador: ele cancela, o código é o de sempre e ele pode recriar", async () => {
    await configurarTudo();
    const p = await colab().whatsappOficial.previa(entrada([1]));
    const { campanhaId } = await colab().whatsappOficial.criarCampanha({ ...entrada([1]), confirmarQuantidade: 1, chaveConfirmacao: p.chaveConfirmacao });
    await colab().whatsappOficial.mudarCampanha({ campanhaId, acao: "pausar" });
    await colab().whatsappOficial.mudarCampanha({ campanhaId, acao: "cancelar" });
    expect((await q<{ erro_codigo: string }>("SELECT erro_codigo FROM ycloud_envios"))[0].erro_codigo).toBe("CANCELADA");
    expect((await colab().whatsappOficial.previa({ ...entrada([1]), nome: "De novo" })).contagem).toMatchObject({ aEnviar: 1, jaRecebeu: 0 });
  });

  it("cancelar confere a situação lida: se o admin pausou no meio, o cancelamento do colaborador não passa", async () => {
    await configurarTudo();
    const { campanhaId } = await campanha([1]);
    // simula a corrida: o colaborador leu "enviando"; o admin pausa antes da gravação
    const original = pg.query.bind(pg);
    let pausou = false;
    const espiao = vi.spyOn(pg, "query").mockImplementation((async (sql: string, ...r: unknown[]) => {
      if (!pausou && /update "ycloud_campanhas" set "status" = \$1, "concluida_em"/i.test(sql)) {
        pausou = true;
        await original(`UPDATE ycloud_campanhas SET status = 'pausada', motivo_pausa = 'Pausada pelo administrador.' WHERE id = ${campanhaId}`);
      }
      return original(sql, ...(r as []));
    }) as never);
    await expect(colab().whatsappOficial.mudarCampanha({ campanhaId, acao: "cancelar" })).rejects.toThrow(/mudou enquanto você cancelava/);
    espiao.mockRestore();
    expect(pausou).toBe(true);
    expect((await situacao(campanhaId)).status).toBe("pausada");
  });
});

// ── Item 5 ──
describe("C7.3 item 5 — frase neutra para o colaborador", () => {
  it("número da integração → aviso da integração; outro número (6+ dígitos, ••••) → frase neutra; resto igual", () => {
    expect(motivoParaEquipe("O número da API não é o da empresa.")).toBe(AVISO_AJUSTE_ADMIN);
    expect(motivoParaEquipe("A conta da YCloud não tem nenhum número de WhatsApp conectado.")).toBe(AVISO_AJUSTE_ADMIN);
    expect(motivoParaEquipe("ATENÇÃO: o número da API (+55 •••• 1111) NÃO é o número da empresa (+55 •••• 2222).")).toBe(AVISO_AJUSTE_ADMIN);
    expect(motivoParaEquipe("A YCloud respondeu HTTP 400 (131049): pedido 1234567.")).toBe(AVISO_NAO_CONCLUIDO);
    expect(motivoParaEquipe("Falhou para +55 •••• 1111.")).toBe(AVISO_NAO_CONCLUIDO);
    expect(AVISO_NAO_CONCLUIDO).toBe("Não foi possível concluir. Avise o administrador.");
    expect(motivoParaEquipe("Cinco falhas seguidas: campanha pausada.")).toBe("Cinco falhas seguidas: campanha pausada.");
    expect(motivoParaEquipe("Não enviada: a pessoa pediu para não receber.")).toBe("Não enviada: a pessoa pediu para não receber.");
  });
  it("no servidor: a lista de falhas do colaborador mostra a frase neutra; a do admin, o texto original", async () => {
    await colabNoBanco();
    await configurarTudo();
    respostaEnvio = () => ({ status: 400, json: { error: { status: 400, code: "1310490", message: "Pedido 98765432 recusado" } } });
    const { campanhaId } = await campanha([1]);
    await admin().whatsappOficial.enviarLote({ campanhaId });
    const doAdmin = await admin().whatsappOficial.detalheCampanha({ campanhaId });
    expect(doAdmin.falhas[0].motivo).toMatch(/1310490/);
    const doColab = await colab().whatsappOficial.detalheCampanha({ campanhaId });
    expect(doColab.falhas[0].motivo).toBe(AVISO_NAO_CONCLUIDO);
    expect(doColab.motivos.map(m => m.motivo)).toEqual([AVISO_NAO_CONCLUIDO]);
  });
});
