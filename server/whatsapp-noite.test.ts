// Pedido de 25/10 (noite): excluir conversa, variáveis imóvel/documentos, mídia (webhook + rota + limite)
// e conexão fora da Central para o admin. Nada externo é chamado (Evolution sempre simulada).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getUserById } from "./db.js";
import { verifySessionToken, getTokenFromRequest } from "./_core/auth-utils.js";
import { router } from "./_core/trpc.js";
import { leadDocuments, leads, users, whatsappConnections, whatsappEvolutionSettings, whatsappMessages, whatsappMidias, financiamentos, leadServices, userNotifications } from "../drizzle/schema.js";
import { whatsappRouter } from "./whatsapp-router.js";
import { processarEventoEvolution } from "./whatsapp-evolution-webhook.js";
import midiaRouter, { tipoDeEntrega } from "./whatsapp-midia.js";
import { LIMITE_MIDIA, baixarMidiaEvolution, midiaDaMensagem, textoDaMensagem } from "./_core/evolution.js";
import { documentosPendentes, mesclarValores, preencherTemplate, textoDocumentos } from "../shared/whatsapp/variaveis.js";
import { esconderWhatsAppFloat } from "../client/src/components/WhatsAppFloat";
import { abaInicialCentral, abasCentralWhatsapp, linkConexaoWhatsapp } from "../shared/whatsapp/central.js";

vi.mock("./db.js", () => ({ getDb: vi.fn(), getUserById: vi.fn() }));
vi.mock("./_core/auth-utils.js", () => ({ getTokenFromRequest: vi.fn(), verifySessionToken: vi.fn() }));

const app = router({ whatsapp: whatsappRouter });
const ctx = (user: Record<string, unknown>) => ({ user: { active: true, ...user }, req: {}, res: {} }) as never;
const admin = ctx({ id: 1, role: "admin", name: "Admin" });
const corretor = ctx({ id: 7, role: "corretor", name: "Corretora" });
const cliente = ctx({ id: 9, role: "user" });

type Tabela = unknown;
/** Banco falso: cada select consome a próxima resposta da tabela do from(); escritas ficam registradas. */
function fakeDb(respostas: Map<Tabela, unknown[][]>) {
  const escritas: { op: string; tabela?: Tabela; dados?: unknown }[] = [];
  const select = () => {
    let tabela: Tabela;
    const c: Record<string, unknown> = {};
    for (const m of ["where", "orderBy", "leftJoin", "limit", "innerJoin"]) c[m] = () => c;
    c.from = (t: Tabela) => { tabela = t; return c; };
    c.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => {
      const fila = respostas.get(tabela) ?? [];
      return Promise.resolve(fila.length ? fila.shift() : []).then(ok, erro);
    };
    return c;
  };
  let proximoId = 500;
  const escrita = (op: string) => (tabela: Tabela) => {
    const c: Record<string, unknown> = {};
    let dados: unknown;
    let retorno: unknown[] = [];
    c.values = (d: unknown) => { dados = d; return c; };
    c.set = (d: unknown) => { dados = d; return c; };
    c.where = () => c;
    c.returning = () => { retorno = [{ id: proximoId++ }]; return c; };
    c.then = (ok: (v: unknown) => unknown) => { escritas.push({ op, tabela, dados }); return Promise.resolve(retorno).then(ok); };
    return c;
  };
  const execute = vi.fn(async (_q: unknown) => { escritas.push({ op: "execute" }); return { rows: [] as unknown[] }; });
  vi.mocked(getDb).mockReturnValue({ select, insert: escrita("insert"), update: escrita("update"), delete: escrita("delete"), execute } as never);
  return { escritas, execute };
}
const conn = { id: 3, userId: 1, provider: "evolution", instancia: "prospecta-u1", status: "conectado", numero: "5599", tokenEncrypted: null, phoneNumberId: null };

describe("Item 1 — excluir conversa", () => {
  beforeEach(() => vi.resetAllMocks());

  it("admin apaga do sistema todas as mensagens do número (DDD + 8 últimos dígitos)", async () => {
    const { escritas } = fakeDb(new Map<Tabela, unknown[][]>([
      [whatsappConnections, [[conn]]],
      [whatsappMessages, [[
        { id: 1, destinatario: "5599981392210", leadId: null },
        { id: 2, destinatario: "559981392210", leadId: null }, // sem o 9º dígito
        { id: 3, destinatario: "5599900000000", leadId: null },
      ]]],
    ]));
    const r = await app.createCaller(admin).whatsapp.excluirConversa({ numero: "(99) 98139-2210" });
    expect(r).toEqual({ apagadas: 2 });
    expect(escritas.filter(e => e.op === "delete" && e.tabela === whatsappMessages)).toHaveLength(1);
  });

  it("corretor não exclui conversa de lead de outro corretor; exclui a do próprio lead", async () => {
    fakeDb(new Map<Tabela, unknown[][]>([
      [users, []],
      [whatsappConnections, [[{ ...conn, userId: 7 }]]],
      [whatsappMessages, [[{ id: 1, destinatario: "5599981392210", leadId: 40 }]]],
      [leads, [[{ brokerId: 8 }]]],
    ]));
    await expect(app.createCaller(corretor).whatsapp.excluirConversa({ numero: "5599981392210" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const { escritas } = fakeDb(new Map<Tabela, unknown[][]>([
      [whatsappConnections, [[{ ...conn, userId: 7 }]]],
      [whatsappMessages, [[{ id: 1, destinatario: "5599981392210", leadId: 40 }]]],
      [leads, [[{ brokerId: 7 }]]],
    ]));
    await expect(app.createCaller(corretor).whatsapp.excluirConversa({ numero: "5599981392210" })).resolves.toEqual({ apagadas: 1 });
    expect(escritas.some(e => e.op === "delete")).toBe(true);
  });

  it("cliente não exclui", async () => {
    fakeDb(new Map());
    await expect(app.createCaller(cliente).whatsapp.excluirConversa({ numero: "5599981392210" })).rejects.toThrow();
  });
});

describe("Item 2 — variáveis {{imovel}} e {{documentos}}", () => {
  beforeEach(() => vi.resetAllMocks());

  it("pendentes do checklist: recebido/CNH contam, recusado e solicitado não; Outros e cônjuge só quando cabe", () => {
    const docs = [
      { type: "cnh", status: "received", temArquivo: true },
      { type: "address_proof", status: "rejected", temArquivo: true },
      { type: "pis", status: "pending", temArquivo: false },
      { type: "fgts", status: "approved", temArquivo: true },
    ];
    expect(documentosPendentes(docs, false)).toEqual(["address_proof", "income_proof_formal", "pis", "birth_marriage_certificate"]);
    expect(documentosPendentes(docs, true)).toContain("spouse_docs");
    expect(textoDocumentos(["pis", "rg", "fgts"])).toBe("RG ou CNH frente e verso, PIS e Extrato do FGTS");
  });

  it("precedência: escolha por lead > cadastro > campo geral (que só completa o que falta)", () => {
    expect(mesclarValores({ imovel: "Casa A" }, { imovel: "Casa B", horario: "10h" })).toEqual({ imovel: "Casa A", horario: "10h" });
    expect(preencherTemplate("{{servico}}", mesclarValores({ servico: "Todos do cadastro" })).faltando).toEqual(["servico"]);
    expect(mesclarValores({ servico: "Todos do cadastro" }, { servico: "Somente escolhido" }).servico).toBe("Somente escolhido");
    expect(mesclarValores({ documentos: "PIS" }, { documentos: "RG" }, { documentos: "CNH" }).documentos).toBe("CNH");
    expect(mesclarValores({ imovel: "" }, { imovel: "  " }).imovel).toBeUndefined();
    expect(preencherTemplate("{{imovel}} {{documentos}}", mesclarValores({}, {})).faltando).toEqual(["imovel", "documentos"]);
  });

  it("prévia: cada destinatário recebe os pendentes dele; quem não tem pendente pede o campo (semCampoGeral estável)", async () => {
    fakeDb(new Map<Tabela, unknown[][]>([
      [leads, [[
        { id: 1, nome: "Ana Souza", endereco: null, corretor: "Paula", conjuge: false, composicao: false },
        { id: 2, nome: "Bruno", endereco: null, corretor: "Paula", conjuge: false, composicao: false },
      ]]],
      [leadServices, [[]]],
      [financiamentos, [[]]],
      [leadDocuments, [[
        // Bruno já entregou tudo; Ana só o RG.
        { leadId: 1, type: "rg", status: "received", driveFileId: "x", storage: "drive" },
        ...["rg", "address_proof", "income_proof_formal", "pis", "fgts", "birth_marriage_certificate"].map(type => ({ leadId: 2, type, status: "approved", driveFileId: null, storage: "banco" })),
      ]]],
    ]));
    const msg = "Oi {{nome}}, envie {{documentos}}.";
    const r = await app.createCaller(admin).whatsapp.previaEnvio({ mensagem: msg, ids: [1, 2], extras: { documentos: "Certidão de casamento" } });
    expect(r[0]).toMatchObject({ id: 1, faltando: [], semCampoGeral: [] });
    expect(r[0].texto).toBe("Oi Ana, envie Comprovante de endereço atualizado, Comprovante de renda atualizado, PIS, Extrato do FGTS e Certidão de Nascimento ou Casamento.");
    expect(r[1]).toMatchObject({ id: 2, texto: "Oi Bruno, envie Certidão de casamento.", faltando: [], semCampoGeral: ["documentos"] });
  });

  it("um destinatário: documentos marcados na tela (extrasPorLead) substituem os pendentes", async () => {
    fakeDb(new Map<Tabela, unknown[][]>([
      [leads, [[{ id: 1, nome: "Ana", endereco: null, corretor: null, conjuge: false, composicao: false }]]],
      [leadDocuments, [[]]],
    ]));
    const r = await app.createCaller(admin).whatsapp.previaEnvio({ mensagem: "{{documentos}}", ids: [1], extrasPorLead: { "1": { documentos: "PIS" } } });
    expect(r[0].texto).toBe("PIS");
  });

  it("envio continua bloqueado se sobrar {{…}}", async () => {
    fakeDb(new Map<Tabela, unknown[][]>([
      [users, []],
      [whatsappConnections, [[conn]]],
      [whatsappEvolutionSettings, [[]]],
      [leads, [[{ id: 1, nome: "Ana", telefone: "99981392210" }], [{ id: 1, nome: "Ana", endereco: null, corretor: null, conjuge: false, composicao: false }]]],
    ]));
    process.env.EVOLUTION_API_URL = "https://evo.teste"; process.env.EVOLUTION_API_KEY = "k";
    const r = await app.createCaller(admin).whatsapp.enviar({ mensagem: "Sobre {{imovel}}", destinatarios: [{ id: 1, nome: "x", telefone: "1" }] });
    delete process.env.EVOLUTION_API_URL; delete process.env.EVOLUTION_API_KEY;
    expect(r).toMatchObject({ success: false, enviadas: 0 });
    expect(r.error).toMatch(/\{\{imovel\}\}/);
  });
});

describe("Item 4 — mídia nas conversas", () => {
  beforeEach(() => vi.resetAllMocks());

  it("reconhece tipo, mime, nome e tamanho (inclusive Long do Baileys e documento com legenda)", () => {
    expect(midiaDaMensagem({ imageMessage: { mimetype: "image/jpeg", fileLength: "2048", caption: "planta" } })).toEqual({ tipo: "imagem", mime: "image/jpeg", nome: null, tamanho: 2048 });
    expect(midiaDaMensagem({ audioMessage: { mimetype: "audio/ogg; codecs=opus", fileLength: { low: 5000, high: 0 } } })).toMatchObject({ tipo: "audio", mime: "audio/ogg", tamanho: 5000 });
    expect(midiaDaMensagem({ documentWithCaptionMessage: { message: { documentMessage: { fileName: "rg.pdf", mimetype: "application/pdf", caption: "segue" } } } }))
      .toMatchObject({ tipo: "documento", nome: "rg.pdf" });
    expect(textoDaMensagem({ documentWithCaptionMessage: { message: { documentMessage: { fileName: "rg.pdf", caption: "segue" } } } })).toBe("[documento] rg.pdf segue");
    expect(midiaDaMensagem({ conversation: "oi" })).toBeNull();
  });

  it("baixa o arquivo pela Evolution v2 (getBase64FromMediaMessage) e trata erro", async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://evo.app/chat/getBase64FromMediaMessage/inst1");
      expect(JSON.parse(String(init?.body))).toEqual({ message: { key: { id: "ABC" } }, convertToMp4: false });
      return { ok: true, status: 200, json: async () => ({ base64: "data:image/jpeg;base64,AQID", mimetype: "image/jpeg", fileName: "f.jpg" }) } as Response;
    });
    await expect(baixarMidiaEvolution({ url: "evo.app", apiKey: "k" }, "inst1", "ABC", f as never)).resolves.toEqual({ base64: "AQID", mime: "image/jpeg", nome: "f.jpg" });
    const erro = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ response: { message: ["Message not found"] } }) }) as Response);
    await expect(baixarMidiaEvolution({ url: "evo.app", apiKey: "k" }, "inst1", "ABC", erro as never)).rejects.toThrow("Message not found");
  });

  function eventoImagem(fileLength: number) {
    return { event: "messages.upsert", instance: "prospecta-u1", data: { key: { remoteJid: "5599981392210@s.whatsapp.net", id: "MID1", fromMe: false }, pushName: "Ana", message: { imageMessage: { mimetype: "image/jpeg", fileLength, caption: "planta" } } } };
  }
  const bancoWebhook = () => fakeDb(new Map<Tabela, unknown[][]>([
    [whatsappConnections, [[conn]]],
    [whatsappMessages, [[]]],
    [leads, [[]]],
    [whatsappEvolutionSettings, [[]]],
  ]));

  it("webhook grava a mensagem com os dados da mídia e guarda o arquivo no banco", async () => {
    const { escritas, execute } = bancoWebhook();
    process.env.EVOLUTION_API_URL = "https://evo.teste"; process.env.EVOLUTION_API_KEY = "k";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => ({ base64: Buffer.from("imagem").toString("base64"), mimetype: "image/jpeg" }) } as Response);
    try {
      expect(await processarEventoEvolution(eventoImagem(6))).toBe("mensagens:1");
    } finally { fetchMock.mockRestore(); delete process.env.EVOLUTION_API_URL; delete process.env.EVOLUTION_API_KEY; }
    const msg = escritas.find(e => e.op === "insert" && e.tabela === whatsappMessages)!.dados as Record<string, unknown>;
    expect(msg).toMatchObject({ mensagem: "[imagem] planta", midiaTipo: "imagem", midiaMime: "image/jpeg", midiaTamanho: 6, direcao: "entrada" });
    expect(execute).toHaveBeenCalledTimes(1); // INSERT INTO whatsapp_midias
    expect(escritas.some(e => e.op === "insert" && e.tabela === userNotifications)).toBe(true);
  });

  it("acima de 10 MB não baixa; falha da Evolution não derruba o aviso (fica o rótulo)", async () => {
    let banco = bancoWebhook();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await processarEventoEvolution(eventoImagem(LIMITE_MIDIA + 1))).toBe("mensagens:1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(banco.execute).not.toHaveBeenCalled();

    banco = bancoWebhook();
    process.env.EVOLUTION_API_URL = "https://evo.teste"; process.env.EVOLUTION_API_KEY = "k";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fetchMock.mockRejectedValue(new Error("rede"));
    try {
      expect(await processarEventoEvolution(eventoImagem(100))).toBe("mensagens:1");
    } finally { fetchMock.mockRestore(); delete process.env.EVOLUTION_API_URL; delete process.env.EVOLUTION_API_KEY; }
    expect(banco.execute).not.toHaveBeenCalled();
    expect(banco.escritas.some(e => e.op === "insert" && e.tabela === whatsappMessages)).toBe(true);
  });

  it("só imagem/áudio/vídeo abrem no navegador; html, svg e documentos baixam como arquivo", () => {
    expect(tipoDeEntrega("image/jpeg", "imagem")).toEqual({ mime: "image/jpeg", inline: true });
    expect(tipoDeEntrega("audio/ogg", "audio")).toEqual({ mime: "audio/ogg", inline: true });
    expect(tipoDeEntrega("application/pdf", "documento")).toEqual({ mime: "application/pdf", inline: true });
    expect(tipoDeEntrega("text/html", "documento")).toEqual({ mime: "application/octet-stream", inline: false });
    expect(tipoDeEntrega("image/svg+xml", "imagem")).toEqual({ mime: "application/octet-stream", inline: false });
  });

  /** Chama a rota /whatsapp/midia/:id do router Express sem subir servidor. */
  async function chamarRota(id: string) {
    const camada = (midiaRouter as unknown as { stack: { route?: { path: string; stack: { handle: (req: unknown, res: unknown) => Promise<unknown> }[] } }[] }).stack
      .find(l => l.route?.path === "/whatsapp/midia/:id")!;
    const res = { statusCode: 200, headers: {} as Record<string, string>, corpo: null as unknown,
      status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.corpo = b; return this; },
      setHeader(k: string, v: string) { this.headers[k] = v; }, end(b: unknown) { this.corpo = b; return this; } };
    await camada.route!.stack[0].handle({ params: { id }, headers: {} }, res);
    return res;
  }

  it("rota da mídia: exige sessão, serve com Content-Type certo e esconde conversa de outro corretor", async () => {
    vi.mocked(getTokenFromRequest).mockReturnValue(undefined as never);
    expect((await chamarRota("10")).statusCode).toBe(401);

    vi.mocked(getTokenFromRequest).mockReturnValue("tok" as never);
    vi.mocked(verifySessionToken).mockResolvedValue({ userId: 1, sessionVersion: 0 } as never);
    vi.mocked(getUserById).mockResolvedValue({ id: 1, role: "admin", active: true, sessionVersion: 0 } as never);
    const { execute } = fakeDb(new Map<Tabela, unknown[][]>([
      [whatsappConnections, [[conn]]],
      [whatsappMessages, [[{ id: 10, connectionId: 3, leadId: null, destinatario: "5599", midiaTipo: "imagem", midiaMime: "image/jpeg", midiaNome: "foto.jpg" }]]],
    ]));
    execute.mockResolvedValueOnce({ rows: [{ b64: Buffer.from("abc").toString("base64") }] });
    const ok = await chamarRota("10");
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["Content-Type"]).toBe("image/jpeg");
    expect(String(ok.corpo)).toBe("abc");

    vi.mocked(verifySessionToken).mockResolvedValue({ userId: 7, sessionVersion: 0 } as never);
    vi.mocked(getUserById).mockResolvedValue({ id: 7, role: "corretor", active: true, sessionVersion: 0 } as never);
    fakeDb(new Map<Tabela, unknown[][]>([
      [whatsappConnections, [[{ ...conn, userId: 7 }]]],
      [whatsappMessages, [[{ id: 10, connectionId: 3, leadId: 40, destinatario: "5599", midiaTipo: "imagem", midiaMime: "image/jpeg" }]]],
      [leads, [[{ brokerId: 8 }]]],
    ]));
    expect((await chamarRota("10")).statusCode).toBe(404);
  });

  it("lista da conversa informa a mídia e se o arquivo já foi baixado", async () => {
    fakeDb(new Map<Tabela, unknown[][]>([
      [whatsappConnections, [[conn]]],
      [whatsappMessages, [[
        { id: 11, destinatario: "5599981392210", leadId: null, direcao: "entrada", lida: true, mensagem: "[áudio]", status: "recebida", createdAt: new Date(), midiaTipo: "audio", midiaMime: "audio/ogg", midiaNome: null, midiaTamanho: 10 },
        { id: 12, destinatario: "5599981392210", leadId: null, direcao: "entrada", lida: true, mensagem: "[imagem]", status: "recebida", createdAt: new Date(), midiaTipo: "imagem", midiaMime: "image/jpeg", midiaNome: null, midiaTamanho: 10 },
      ]]],
      [whatsappMidias, [[{ messageId: 11 }]]],
    ]));
    const r = await app.createCaller(admin).whatsapp.mensagensConversa({ numero: "5599981392210" });
    expect(r.find(m => m.id === 11)?.midia).toMatchObject({ tipo: "audio", baixada: true });
    expect(r.find(m => m.id === 12)?.midia).toMatchObject({ tipo: "imagem", baixada: false });
  });
});

describe("Conexão consolidada em Serviços › WhatsApp", () => {
  beforeEach(() => vi.resetAllMocks());

  it("admin e corretor acessam a conexão na Central, sem aba Histórico", () => {
    expect(abasCentralWhatsapp("admin")).toEqual(["conversas", "enviar", "templates", "conexao"]);
    expect(abasCentralWhatsapp("corretor")).toContain("conexao");
    expect(abaInicialCentral("admin", "conexao")).toBe("conexao");
    expect(abaInicialCentral("admin", null)).toBe("conversas");
    expect(abaInicialCentral("corretor", "conexao")).toBe("conexao");
    expect(linkConexaoWhatsapp("admin")).toBe("/admin/whatsapp?aba=conexao");
    expect(linkConexaoWhatsapp("corretor")).toBe("/admin/whatsapp?aba=conexao");
  });

  it("botão verde flutuante some na Central WhatsApp (cobria o enviar resposta) e fica no resto do site", () => {
    expect(esconderWhatsAppFloat("/admin/whatsapp")).toBe(true);
    expect(esconderWhatsAppFloat("/")).toBe(false);
    expect(esconderWhatsAppFloat("/imoveis/casa")).toBe(false);
  });

  it("corretor gera o QR da própria conexão (instância dele); cliente não", async () => {
    fakeDb(new Map<Tabela, unknown[][]>([[whatsappEvolutionSettings, [[]]], [whatsappConnections, [[]]]]));
    process.env.EVOLUTION_API_URL = "https://evo.teste"; process.env.EVOLUTION_API_KEY = "k";
    const urls: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (u) => {
      urls.push(String(u));
      return { ok: true, status: 200, json: async () => (String(u).includes("connectionState") ? { instance: { state: "close" } } : { base64: "QR" }) } as Response;
    });
    try {
      await expect(app.createCaller(corretor).whatsapp.conectarQr()).resolves.toEqual({ qrCode: "QR", status: "aguardando_qr" });
      await expect(app.createCaller(cliente).whatsapp.conectarQr()).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally { fetchMock.mockRestore(); delete process.env.EVOLUTION_API_URL; delete process.env.EVOLUTION_API_KEY; }
    expect(urls[0]).toContain("/instance/connectionState/prospecta-u7");
  });
});
