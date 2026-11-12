// Central de Vendas — etapa 3: serviço de entrada (WhatsApp, site, Logyca), deduplicação e origem.
// Banco em memória (PGlite); envio e IA simulados — nenhuma chamada externa.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import { getDb } from "./db.js";
import { aviso, montarCenario, NUMERO_TESTE, OUTRO_NUMERO, type Cenario } from "./__fixtures__/central-vendas/cenario.js";
import { cifrar, definirDependencias } from "./central-vendas/base.js";
import { receberContato } from "./central-vendas/entrada.js";
import { tratarEntrada } from "./central-vendas/rotas.js";
import { processarEventoEvolution } from "./whatsapp-evolution-webhook.js";
import { extrairRef, linkCampanha, origemDoRef } from "../shared/central-vendas/regras.js";

let c: Cenario;
beforeEach(async () => {
  c = await montarCenario(db => vi.mocked(getDb).mockReturnValue(db as never));
});
afterEach(async () => { definirDependencias(); await c.pg.close(); });

describe("origem pelo código de campanha", () => {
  it("lê [ref:...] e resolve canal/empreendimento", () => {
    expect(extrairRef("Olá! [ref:instagram-colina-park]")).toBe("instagram-colina-park");
    expect(extrairRef("Olá [REF: Teste ]")).toBe("teste");
    expect(extrairRef("sem código")).toBeNull();
    const produtos = [{ id: 7, slug: "colina-park" }];
    expect(origemDoRef("instagram-colina-park", [], produtos)).toEqual({ canal: "instagram", campanha: "instagram-colina-park", produtoId: 7 });
    expect(origemDoRef("x", [{ codigo: "x", canal: "facebook", produtoId: null }], produtos)).toEqual({ canal: "facebook", campanha: "x", produtoId: null });
    expect(linkCampanha("(99) 99000-0000", "instagram-colina-park")).toBe("https://wa.me/5599990000000?text=Ol%C3%A1!%20%5Bref%3Ainstagram-colina-park%5D");
  });
});

describe("mensagem de número novo no WhatsApp", () => {
  it("cria um único lead, mesmo com o aviso repetido, com origem da campanha e operador do rodízio", async () => {
    await c.pg.exec("INSERT INTO central_vendas_produtos (slug, nome) VALUES ('colina-park', 'Colina Park')");
    const ev = aviso("MSG1", NUMERO_TESTE, "Olá! [ref:instagram-colina-park]");
    await processarEventoEvolution(ev);
    await processarEventoEvolution(ev); // a Evolution reenviou o mesmo aviso
    const ls = await c.linhas("SELECT id, name, phone, source_channel, responsible_user_id FROM leads");
    expect(ls).toEqual([{ id: 1, name: "Cliente Teste", phone: "99988887777", source_channel: "instagram", responsible_user_id: 2 }]);
    expect(await c.linhas("SELECT lead_id, origem, campanha, produto_id, operador_id FROM central_vendas_leads")).toEqual([
      { lead_id: 1, origem: "whatsapp", campanha: "instagram-colina-park", produto_id: 1, operador_id: 2 },
    ]);
    expect(await c.linhas("SELECT lead_id FROM whatsapp_messages WHERE direcao = 'entrada'")).toEqual([{ lead_id: 1 }]);
    expect((await c.linhas<{ tipo: string }>("SELECT tipo FROM central_vendas_eventos ORDER BY id")).map(e => e.tipo)).toEqual(expect.arrayContaining(["lead_criado", "atribuido"]));
  });

  it("avisos simultâneos de mensagens diferentes do mesmo número não duplicam o lead", async () => {
    const r = await Promise.all([1, 2, 3].map(i => receberContato({ origem: "whatsapp", telefone: NUMERO_TESTE, texto: `oi ${i}` })));
    expect(r.filter(x => x.criado)).toHaveLength(1);
    expect(await c.linhas("SELECT count(*)::int AS n FROM leads")).toEqual([{ n: 1 }]);
    // Com e sem o 9º dígito e o 55: mesma chave de telefone.
    expect((await receberContato({ origem: "whatsapp", telefone: "99 8888-7777" })).criado).toBe(false);
    expect(await c.linhas("SELECT count(*)::int AS n FROM leads")).toEqual([{ n: 1 }]);
  });

  it("lead que já existia no CRM não é recriado e fica com atendimento humano (a IA não assume)", async () => {
    await c.pg.exec("INSERT INTO leads (name, phone, responsible_user_id) VALUES ('Maria Antiga', '99988887777', 3)");
    await processarEventoEvolution(aviso("M2", NUMERO_TESTE, "Oi, sou eu"));
    expect(await c.linhas("SELECT count(*)::int AS n FROM leads")).toEqual([{ n: 1 }]);
    expect(await c.linhas("SELECT origem, status_atendimento, operador_id FROM central_vendas_leads")).toEqual([{ origem: "crm", status_atendimento: "em_atendimento_humano", operador_id: 3 }]);
    expect(c.chamadasIA).toHaveLength(0);
  });

  it("modo de teste ignora números fora da lista e Central desligada não faz nada", async () => {
    await processarEventoEvolution(aviso("M3", OUTRO_NUMERO, "Olá"));
    expect(await c.linhas("SELECT count(*)::int AS n FROM leads")).toEqual([{ n: 0 }]);
    await c.salvarConfig({ ativo: false });
    await processarEventoEvolution(aviso("M4", NUMERO_TESTE, "Olá"));
    expect(await c.linhas("SELECT count(*)::int AS n FROM leads")).toEqual([{ n: 0 }]);
    expect(await c.linhas("SELECT count(*)::int AS n FROM whatsapp_messages")).toEqual([{ n: 2 }]); // o WhatsApp segue como antes
  });
});

describe("entrada do site e da Logyca", () => {
  const req = (token: string | null, body: unknown, ip = "1.1.1.1") => ({ headers: token ? { authorization: `Bearer ${token}` } : {}, body, ip });

  beforeEach(async () => {
    await c.salvarConfig({ segredos: { tokenSite: cifrar("tok-site"), tokenLogycaEntrada: cifrar("tok-logyca") } });
  });

  it("exige token, valida o payload e é idempotente pela origem + ID externo", async () => {
    const body = { telefone: NUMERO_TESTE, nome: "Bia Site", idExterno: "form-1", campanha: "site-colina" };
    expect((await tratarEntrada("site", req(null, body))).status).toBe(401);
    expect((await tratarEntrada("site", req("errado", body))).status).toBe(401);
    expect((await tratarEntrada("site", req("tok-site", { telefone: "1" }))).status).toBe(400);
    expect((await tratarEntrada("site", req("tok-site", { ...body, cpf: "x" }))).status).toBe(400); // campo desconhecido
    const a = await tratarEntrada("site", req("tok-site", body));
    const b = await tratarEntrada("site", req("tok-site", body));
    expect(a).toMatchObject({ status: 200, body: { novo: true, leadId: 1 } });
    expect(b).toMatchObject({ status: 200, body: { novo: false, leadId: 1 } });
    expect(await c.linhas("SELECT name, source_channel FROM leads")).toEqual([{ name: "Bia Site", source_channel: "site" }]);
    // Saudação com o pedido de consentimento saiu para o lead do site (10h: dentro da janela).
    expect(c.envios.map(e => e.texto)).toEqual([expect.stringContaining("LGPD")]);
    expect(JSON.stringify(a.body)).not.toContain(NUMERO_TESTE);
  });

  it("Logyca desligada por padrão; ligada, o dado do Prospecta prevalece e o conflito é registrado", async () => {
    const body = { telefone: NUMERO_TESTE, nome: "Outro Nome", idExterno: "lg-1" };
    expect((await tratarEntrada("logyca", req("tok-logyca", body))).status).toBe(404);
    await c.pg.exec("INSERT INTO leads (name, phone) VALUES ('Nome Prospecta', '99988887777')");
    await c.salvarConfig({ logyca: { ativo: true, usarParaEnvio: false, endpointEnvio: "" }, segredos: { tokenLogycaEntrada: cifrar("tok-logyca") } });
    expect((await tratarEntrada("logyca", req("tok-logyca", body))).status).toBe(200);
    expect(await c.linhas("SELECT name FROM leads")).toEqual([{ name: "Nome Prospecta" }]);
    expect(await c.linhas("SELECT tipo, payload FROM central_vendas_eventos WHERE tipo = 'conflito_logyca'")).toEqual([
      { tipo: "conflito_logyca", payload: JSON.stringify({ campos: ["nome"], prevalece: "prospecta" }) },
    ]);
  });

  it("limita a taxa por origem e IP", async () => {
    const body = { telefone: NUMERO_TESTE };
    const r = [];
    for (let i = 0; i < 32; i++) r.push((await tratarEntrada("site", req("tok-site", body, "9.9.9.9"))).status);
    expect(r.slice(0, 30).every(s => s === 200)).toBe(true);
    expect(r.slice(30)).toEqual([429, 429]);
  });
});
