// EPIC-027 C1 — leitura de prancha pela IA em segundo plano (Message Batches API, SIMULADA) e envio só da página.
// Nada sai para a rede nem toca banco real; a chave é falsa e injetada.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { APIError } from "@anthropic-ai/sdk";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import * as schema from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { clienteLoteAnthropic, definirDependencias, idDoPedidoNoLote, type CredencialIA, type SdkLote } from "./maquete-3d/base.js";
import { lerEstadoLeitura } from "../shared/maquete-3d/regras.js";
import { abrirPdf } from "./maquete-3d/pdf-vetorial.js";
import { lerPagina } from "./maquete-3d/geometrico.js";
import { ladosDoJpeg, pdfDaPagina, pdfDeUmJpeg } from "./maquete-3d/pdf-pagina.js";
import { appRouter } from "./routers.js";
import { comModeloDaTela } from "./fixtures/maquete-3d/confirmacao-da-tela.js";
import { loteSimulado, type RespostaDoLote } from "./fixtures/maquete-3d/lote-simulado.js";
import { andamentoDaLeitura, consultaDeNovo, rotuloDoLote, tempoDecorrido } from "../client/src/components/maquete-3d/rotulos-leitura.js";

const JPEG = readFileSync(new URL("../client/public/casa-compacta-linha-smart.jpg", import.meta.url));
const RASTER = pdfDeUmJpeg({ jpeg: JPEG, ...ladosDoJpeg(JPEG)! });
const VETORIAL = readFileSync(new URL("./fixtures/maquete-3d/sobrado.pdf", import.meta.url));
const CHAVE = "sk-ant-api03-SEGREDO-LOTE-1234567890";
const PAINEL: CredencialIA = { apiKey: CHAVE, modelo: "claude-fable-5-2", origem: "painel" };
const ret = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 8 }, { x: 0, y: 8 }];
const RESPOSTA_IA = {
  plantas: [{
    titulo: "PLANTA BAIXA", escala: 50, escalaLegivel: true, temCotas: true,
    paredes: [
      { id: "p1", ax: 0, ay: 0, bx: 6, by: 0, espessura: 0.15, externa: true, confirmada: true },
      { id: "p2", ax: 6, ay: 0, bx: 6, by: 8, espessura: 0.15, externa: true, confirmada: true },
      { id: "p3", ax: 6, ay: 8, bx: 0, by: 8, espessura: 0.15, externa: true, confirmada: true },
      { id: "p4", ax: 0, ay: 8, bx: 0, by: 0, espessura: 0.15, externa: true, confirmada: true },
    ],
    aberturas: [], comodos: [{ id: "c1", nome: "Sala", funcao: "sala", pontos: ret, areaInformada: 48, confirmada: true }], escadas: [], pendencias: [],
  }],
  pendencias: [],
};

const TABELAS = ["users", "leads", "leadServices", "operationalProjects", "projectRevisionRequests", "projectDocuments", "incorporationStudies", "incorporationRegistrationDocuments", "incorporationUnits", "paymentOrders", "draws", "products"];
let ddl: string | null = null;
async function criarBanco() {
  if (!ddl) {
    const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
    const escolhidas: Record<string, unknown> = {};
    for (const [nome, valor] of Object.entries(schema)) if (TABELAS.includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
    ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n");
  }
  const pg = new PGlite();
  await pg.exec(ddl);
  await pg.exec(`CREATE TABLE incorporation_registration_file_data (document_id integer PRIMARY KEY, mime text, size_bytes integer, data bytea);`);
  for (const a of ["0111_maquete_3d.sql", "0112_maquete_3d_comercial.sql", "0113_maquete_3d_pagamento.sql", "0114_maquete_3d_email.sql", "0115_maquete_3d_lead_arquivos.sql", "0121_maquete_3d_revisoes.sql"]) {
    await pg.exec(readFileSync(new URL(`../drizzle/${a}`, import.meta.url), "utf8"));
  }
  return { pg, db: drizzle(pg) };
}

let banco: Awaited<ReturnType<typeof criarBanco>>;
let sim: ReturnType<typeof loteSimulado>;
let enviados: Parameters<ReturnType<typeof loteSimulado>["cliente"]["enviar"]>[0][];
let respostas: RespostaDoLote[];
let emAndamento: number;
let falhaNaConsulta: Error | null;
let relogio: Date;
const caller = (id: number, role: string, permissions = "[]") => appRouter.createCaller({ user: { id, role, permissions, active: true, name: "x" }, req: {}, res: {} } as never);
const admin = () => comModeloDaTela(caller(1, "admin").maquete3d);
const colaborador = () => caller(2, "colaborador", JSON.stringify(["maquete3d"])).maquete3d;
const IMG = { fonte: "projeto" as const, id: 2, nome: "escaneada.pdf" };
const VET = { fonte: "projeto" as const, id: 1, nome: "sobrado.pdf" };
const contador = async (id: number) => (await banco.pg.query<{ n: number }>(`SELECT ia_pranchas_lidas AS n FROM maquetes_3d WHERE id = $1`, [id])).rows[0].n;
const gravado = async (id: number) => lerEstadoLeitura((await banco.pg.query<{ leitura: string }>(`SELECT leitura FROM maquetes_3d WHERE id = $1`, [id])).rows[0].leitura);

async function configurar(dados: Record<string, unknown>) {
  await banco.pg.exec(`DELETE FROM maquete_3d_config`);
  await banco.pg.query(`INSERT INTO maquete_3d_config (id, dados) VALUES (1, $1)`, [JSON.stringify(dados)]);
}
/** Pedido com a prancha escaneada, lida até parar na confirmação, e confirmado pelo admin. */
async function prontoParaIA(documentos = [IMG]) {
  const { id } = await colaborador().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "acima_150_ou_sobrado", documentos });
  await admin().liberar({ id, nota: "PIX recebido" });
  await colaborador().iniciarLeitura({ id });
  let r = await colaborador().avancarLeitura({ id });
  for (let i = 0; i < 10 && !r.aguardando && !r.erro && r.proximo; i++) r = await colaborador().avancarLeitura({ id });
  expect(r.aguardando?.motivo).toBe("confirmacao");
  await admin().confirmarIA({ id });
  return id;
}

vi.setConfig({ testTimeout: 30_000 });

describe("EPIC-027 C1 — leitura em segundo plano (router, banco em memória, lote simulado)", () => {
  beforeEach(async () => {
    banco = await criarBanco();
    vi.mocked(getDb).mockReturnValue(banco.db as never);
    await banco.pg.exec(`
      INSERT INTO users ("openId", name, role, active) VALUES ('admin', 'Admin', 'admin', true), ('colab', 'Colab', 'colaborador', true);
      INSERT INTO operational_projects (name, client_name, client_phone, engineer, value) VALUES ('Casa Silva', 'Ana', '99999', 'Eng', 1000);
      INSERT INTO project_documents (project_id, item_id, kind, original_name, canonical_name, mime, size, version, drive_file_id, status)
        VALUES (1, 'a1', 'pdf', 'sobrado.pdf', 'sobrado.pdf', 'application/pdf', 10, 1, 'd1', 'active'),
               (1, 'a2', 'pdf', 'escaneada.pdf', 'escaneada.pdf', 'application/pdf', 10, 1, 'd2', 'active');
    `);
    enviados = []; respostas = []; emAndamento = 0; falhaNaConsulta = null; relogio = new Date("2026-11-20T21:00:00Z");
    sim = loteSimulado({
      aoEnviar: p => { enviados.push(p); },
      consultasAteTerminar: () => emAndamento,
      falhaNaConsulta: () => falhaNaConsulta,
      responder: () => respostas.shift() ?? { json: RESPOSTA_IA, entrada: 31_234, saida: 4_321, modelo: "claude-fable-5-2" },
    });
    definirDependencias({
      agora: () => relogio,
      lerPdf: async d => (d.nome === "sobrado.pdf" ? VETORIAL : RASTER),
      credencialIA: async () => PAINEL,
      ia: async () => { throw new Error("a leitura de prancha não pode usar a chamada direta"); },
      lote: sim.cliente,
    });
    await configurar({ motor: "hibrido", esforcoIA: "high" });
  });
  afterEach(async () => { definirDependencias(); await banco.pg.close(); });

  it("envio → consultas em andamento → sucesso: cada pedido volta logo, o lote fica gravado e os tokens REAIS entram na leitura", async () => {
    const id = await prontoParaIA();
    emAndamento = 2;
    const enviado = await colaborador().avancarLeitura({ id });
    expect(enviado).toMatchObject({ erro: null, aguardando: { motivo: "lote", mensagem: expect.stringContaining("pode fechar esta página") } });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ credencial: PAINEL, idPedido: `leitura-${id}-ia-0-1`, anexos: [{ tipo: "imagem" }] });
    // A reserva foi feita no envio: a confirmação e o contador mostram 1 de 8, coerentes, já durante a leitura.
    let d = await admin().detalhe({ id });
    expect(d.ia).toMatchObject({ emCurso: true, usadas: 1, lidasNaMaquete: 1, teto: 8 });
    const passo = d.passos.find(p => p.tipo === "prancha_ia")!;
    expect(passo).toMatchObject({ estado: "executando", lote: { situacao: "em_andamento", enviadoEm: relogio.toISOString() }, modelo: "claude-fable-5-2" });
    expect(JSON.stringify(d.passos)).not.toContain("msgbatch_"); // o painel não precisa do id do lote
    expect((await gravado(id)).passos.find(p => p.tipo === "prancha_ia")!.lote).toMatchObject({ id: "msgbatch_simulado_1", pedido: `leitura-${id}-ia-0-1` });
    // Consultas enquanto a Anthropic não termina: nada muda e nada é gravado.
    const antes = (await banco.pg.query<{ leitura: string }>(`SELECT leitura FROM maquetes_3d WHERE id = $1`, [id])).rows[0].leitura;
    expect((await colaborador().avancarLeitura({ id })).aguardando?.motivo).toBe("lote");
    expect((await colaborador().avancarLeitura({ id })).aguardando?.motivo).toBe("lote");
    expect((await banco.pg.query<{ leitura: string }>(`SELECT leitura FROM maquetes_3d WHERE id = $1`, [id])).rows[0].leitura).toBe(antes);
    // Terminou: a planta e os tokens da resposta.
    const lido = await colaborador().avancarLeitura({ id });
    expect(lido).toMatchObject({ erro: null, aguardando: null, proximo: { tipo: "montagem" } });
    d = await admin().detalhe({ id });
    expect(d.passos.find(p => p.tipo === "prancha_ia")).toMatchObject({ estado: "feito", motor: "ia", modelo: "claude-fable-5-2", tokens: { entrada: 31_234, saida: 4_321 }, lote: null });
    expect(d.tokens).toEqual({ entrada: 31_234, saida: 4_321 });
    expect(d.ia).toMatchObject({ emCurso: false, usadas: 1, lidasNaMaquete: 1 });
    expect(await colaborador().avancarLeitura({ id })).toMatchObject({ status: "em_revisao" });
    expect(sim.consultas).toEqual(["msgbatch_simulado_1", "msgbatch_simulado_1", "msgbatch_simulado_1"]);
    expect(enviados).toHaveLength(1);
  });

  it("os parâmetros escolhidos pelo dono vão no lote: modelo da função, esforço e saída em JSON pelo esquema", async () => {
    const criar = vi.fn<SdkLote["messages"]["batches"]["create"]>(async () => ({ id: "msgbatch_x" }));
    const opcoes: { timeoutMs: number; maxRetries: number }[] = [];
    const cliente = clienteLoteAnthropic(async (apiKey, o) => {
      expect(apiKey).toBe(CHAVE);
      opcoes.push(o);
      return { messages: { batches: { create: criar, retrieve: vi.fn(), results: vi.fn(), cancel: vi.fn() } } } as unknown as SdkLote;
    });
    definirDependencias({ lote: cliente });
    const id = await prontoParaIA();
    await colaborador().avancarLeitura({ id });
    expect(criar).toHaveBeenCalledTimes(1);
    const { requests } = criar.mock.calls[0][0];
    expect(requests).toHaveLength(1);
    const { custom_id, params } = requests[0];
    expect(custom_id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(params).toMatchObject({ model: "claude-fable-5-2", max_tokens: 16000, output_config: { effort: "high", format: { type: "json_schema" } } });
    expect(params.messages[0].content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg" } });
    expect(params.messages[0].content.at(-1)).toMatchObject({ type: "text", text: expect.stringContaining("página 1 do arquivo \"escaneada.pdf\"") });
    expect(opcoes[0].maxRetries).toBe(0); // repetir um envio que talvez tenha chegado criaria um segundo lote pago
    expect(opcoes[0].timeoutMs).toBeLessThanOrEqual(52_000);
    expect(JSON.stringify(await gravado(id))).not.toContain(CHAVE);
  });

  for (const [motivo, texto] of [
    ["expired", "o lote expirou na Anthropic): nada foi cobrado e a confirmação foi devolvida"],
    ["errored", "A IA não aceitou o pedido desta prancha: nada foi cobrado e a confirmação foi devolvida"],
    ["canceled", "foi cancelada antes de a IA começar a ler: nada foi cobrado"],
  ] as const) {
    it(`lote terminado sem resultado (${motivo}) devolve a confirmação e o contador, e a tela diz isso`, async () => {
      const id = await prontoParaIA();
      respostas.push({ semResultado: motivo });
      await colaborador().avancarLeitura({ id });
      expect(await contador(id)).toBe(1);
      const r = await colaborador().avancarLeitura({ id });
      expect(r.erro).toContain(texto);
      expect(await contador(id)).toBe(0);
      expect((await admin().detalhe({ id })).ia).toMatchObject({ usadas: 0, lidasNaMaquete: 0, emCurso: false });
      // A confirmação continua valendo: tentar de novo envia outro lote, sem pedir de novo.
      await colaborador().avancarLeitura({ id });
      expect(await colaborador().avancarLeitura({ id })).toMatchObject({ erro: null, proximo: { tipo: "montagem" } });
      expect(enviados).toHaveLength(2);
      expect(await contador(id)).toBe(1);
    });
  }

  it("resposta cortada por max_tokens: foi cobrada — conta como usada, guarda os tokens e explica", async () => {
    const id = await prontoParaIA();
    respostas.push({ mensagem: { stopReason: "max_tokens", texto: "{\"plantas\": [", entrada: 20_000, saida: 16_000 } });
    await colaborador().avancarLeitura({ id });
    const r = await colaborador().avancarLeitura({ id });
    expect(r.erro).toContain("A resposta da IA foi cortada antes do fim");
    expect(r.erro).toContain("conta como usada (20.000 + 16.000 tokens)");
    const d = await admin().detalhe({ id });
    expect(d.tokens).toEqual({ entrada: 20_000, saida: 16_000 });
    expect(d.passos.find(p => p.tipo === "prancha_ia")).toMatchObject({ estado: "erro", tokens: { entrada: 20_000, saida: 16_000 } });
    expect(d.ia).toMatchObject({ usadas: 1, lidasNaMaquete: 1 });
    // Repetir é outra leitura paga: pede nova confirmação (a de 1 prancha foi usada).
    expect((await colaborador().avancarLeitura({ id })).aguardando?.motivo).toBe("confirmacao");
  });

  it("cancelar leitura: o lote é cancelado na Anthropic; antes de a IA começar, nada é cobrado", async () => {
    const id = await prontoParaIA();
    emAndamento = 5;
    await colaborador().avancarLeitura({ id });
    await expect(colaborador().pularIA({ id })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("ou cancele a leitura pela IA") });
    await colaborador().cancelarLeituraIA({ id });
    expect(sim.cancelamentos).toEqual(["msgbatch_simulado_1"]);
    expect((await admin().detalhe({ id })).passos.find(p => p.tipo === "prancha_ia")!.lote).toMatchObject({ situacao: "cancelando" });
    await colaborador().cancelarLeituraIA({ id }); // de novo: não pede outra vez
    expect(sim.cancelamentos).toHaveLength(1);
    const r = await colaborador().avancarLeitura({ id });
    expect(r.erro).toContain("cancelada antes de a IA começar a ler: nada foi cobrado");
    expect(await contador(id)).toBe(0);
    // Sem lote em curso, não há o que cancelar; e dá para seguir sem a IA.
    await expect(colaborador().cancelarLeituraIA({ id })).rejects.toThrow("Não há leitura pela IA em andamento");
    await colaborador().pularIA({ id });
    expect((await admin().detalhe({ id })).passos.find(p => p.tipo === "prancha_ia")).toMatchObject({ estado: "feito", motor: "pulada" });
    expect(enviados).toHaveLength(1);
  });

  it("duas abas: dois envios simultâneos criam UM lote; duas consultas simultâneas no fim gravam a leitura e os tokens uma vez só", async () => {
    const id = await prontoParaIA();
    const [a, b] = await Promise.all([colaborador().avancarLeitura({ id }), colaborador().avancarLeitura({ id })]);
    expect(enviados).toHaveLength(1);
    expect([a.aguardando?.motivo, b.aguardando?.motivo].every(m => m === "lote" || m === "executando")).toBe(true);
    await Promise.all([colaborador().avancarLeitura({ id }), colaborador().avancarLeitura({ id }), colaborador().avancarLeitura({ id })]);
    const e = await gravado(id);
    expect(e.passos.find(p => p.tipo === "prancha_ia")).toMatchObject({ estado: "feito", motor: "ia" });
    expect([e.tokensEntrada, e.tokensSaida]).toEqual([31_234, 4_321]);
    expect(await contador(id)).toBe(1);
    expect(enviados).toHaveLength(1);
  });

  it("retomada: recarregar a página (ou voltar outro dia) continua consultando o MESMO lote; nada é reenviado", async () => {
    const id = await prontoParaIA();
    emAndamento = 1;
    await colaborador().avancarLeitura({ id });
    // "Fecha o navegador": a próxima pessoa (outra sessão, outro dia) só tem o banco.
    relogio = new Date(relogio.getTime() + 3 * 60 * 60 * 1000);
    const outra = caller(1, "admin").maquete3d;
    const tela = await outra.detalhe({ id });
    expect(tela.ia.emCurso).toBe(true); // a reserva não vence pelo relógio com o lote na Anthropic
    expect((await outra.avancarLeitura({ id })).aguardando?.motivo).toBe("lote");
    expect(await outra.avancarLeitura({ id })).toMatchObject({ erro: null, proximo: { tipo: "montagem" } });
    expect(sim.consultas).toEqual(["msgbatch_simulado_1", "msgbatch_simulado_1"]);
    expect(enviados).toHaveLength(1);
  });

  it("consulta que falha por instabilidade continua tentando; chave revogada vira erro claro (conta como usada) e a chave não aparece", async () => {
    const id = await prontoParaIA();
    await colaborador().avancarLeitura({ id });
    falhaNaConsulta = Object.assign(new Error("Connection reset"), {});
    expect((await colaborador().avancarLeitura({ id })).aguardando?.motivo).toBe("lote");
    expect((await gravado(id)).passos.find(p => p.tipo === "prancha_ia")!.lote).toMatchObject({ falhasDeConsulta: 1 });
    falhaNaConsulta = APIError.generate(401, { type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${CHAVE}` } }, undefined, new Headers());
    const r = await colaborador().avancarLeitura({ id });
    expect(r.erro).toContain("Não foi possível consultar na IA a leitura desta prancha (Chave da IA inválida ou revogada");
    expect(r.erro).toContain("conta como usada");
    expect(JSON.stringify([r, await admin().detalhe({ id }), await gravado(id)])).not.toContain(CHAVE);
    expect(await contador(id)).toBe(1);
  });

  it("importação: o mesmo fluxo em segundo plano, com o cancelamento próprio", async () => {
    const { id } = await colaborador().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "acima_150_ou_sobrado", documentos: [IMG] });
    await admin().liberar({ id, nota: "PIX recebido" });
    let r = await colaborador().importarPlanta({ id, doc: 0 });
    for (let i = 0; i < 10 && !r.aguardando && !r.erro; i++) r = await colaborador().avancarImportacao({ id });
    expect(r.aguardando?.motivo).toBe("confirmacao");
    await admin().confirmarIAImportacao({ id });
    emAndamento = 3;
    expect((await colaborador().avancarImportacao({ id })).aguardando?.motivo).toBe("lote");
    expect(enviados[0].idPedido).toBe(`importacao-${id}-ia-0-1`);
    const imp = (await admin().detalhe({ id })).importacao!;
    expect(imp.passos.find(p => p.tipo === "prancha_ia")!.lote).toMatchObject({ situacao: "em_andamento" });
    await colaborador().cancelarLeituraIAImportacao({ id });
    expect(sim.cancelamentos).toEqual(["msgbatch_simulado_1"]);
    expect((await colaborador().avancarImportacao({ id })).erro).toContain("nada foi cobrado");
    expect(await contador(id)).toBe(0);
  });

  it("prancha vetorial de um PDF com várias páginas vai à IA como um PDF só daquela página (que abre e tem o mesmo desenho)", async () => {
    const { id } = await colaborador().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "acima_150_ou_sobrado", documentos: [VET] });
    await admin().liberar({ id, nota: "PIX recebido" });
    await colaborador().iniciarLeitura({ id });
    await colaborador().avancarLeitura({ id });
    await colaborador().avancarLeitura({ id });
    await colaborador().avancarLeitura({ id });
    // Uma prancha agendada à mão para a IA (como se o leitor próprio tivesse ficado parcial na página 2).
    const e = await gravado(id);
    const prancha = e.passos.find(p => p.tipo === "prancha" && p.pagina === 2)!;
    e.passos.splice(e.passos.findIndex(p => p.tipo === "montagem"), 0, { chave: "ia:0:2", tipo: "prancha_ia", rotulo: "Leitura pela IA — sobrado.pdf — página 2", estado: "pendente", doc: 0, pagina: 2, arquivo: prancha.arquivo, motivoIA: "teste" });
    e.confirmacaoIA = { em: relogio.toISOString(), por: 1, pranchas: 1, usadas: 0, modelo: "claude-fable-5-2" };
    await banco.pg.query(`UPDATE maquetes_3d SET leitura = $1 WHERE id = $2`, [JSON.stringify(e), id]);
    await colaborador().avancarLeitura({ id });
    const anexo = enviados[0].anexos![0] as { tipo: "pdf"; nome: string; base64: string };
    expect(anexo).toMatchObject({ tipo: "pdf", nome: "sobrado.pdf — página 2" });
    expect(enviados[0].pedido).toContain("Esta é a página 2 do arquivo \"sobrado.pdf\"");
    expect(enviados[0].pedido).not.toContain("A prancha é uma imagem");
    const so = await abrirPdf(Buffer.from(anexo.base64, "base64"));
    expect(so.paginas).toBe(1);
    const original = await abrirPdf(VETORIAL);
    expect(JSON.stringify(lerPagina(await so.pagina(1)).plantas)).toBe(JSON.stringify(lerPagina(await original.pagina(2)).plantas));
    expect((await admin().detalhe({ id })).passos.find(p => p.chave === "ia:0:2")).toMatchObject({ envio: "pdf_pagina", envioMotivo: null });
  });

  it("se a página separada não abrir, vai o PDF inteiro com a instrução da página, e o motivo fica registrado no passo", async () => {
    const { id } = await colaborador().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "acima_150_ou_sobrado", documentos: [VET] });
    await admin().liberar({ id, nota: "PIX recebido" });
    await colaborador().iniciarLeitura({ id });
    for (let i = 0; i < 3; i++) await colaborador().avancarLeitura({ id });
    const e = await gravado(id);
    e.passos.splice(e.passos.findIndex(p => p.tipo === "montagem"), 0, { chave: "ia:0:2", tipo: "prancha_ia", rotulo: "Leitura pela IA — sobrado.pdf — página 2", estado: "pendente", doc: 0, pagina: 2, arquivo: e.passos[1].arquivo, motivoIA: "teste" });
    e.confirmacaoIA = { em: relogio.toISOString(), por: 1, pranchas: 1, usadas: 0, modelo: "claude-fable-5-2" };
    await banco.pg.query(`UPDATE maquetes_3d SET leitura = $1 WHERE id = $2`, [JSON.stringify(e), id]);
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // O leitor de PDF abre o arquivo original, mas não a cópia de uma página.
    definirDependencias({ abrirPdf: async dados => { if (dados.length !== VETORIAL.length) throw new Error("não abriu"); return abrirPdf(dados); } });
    await colaborador().avancarLeitura({ id });
    aviso.mockRestore();
    expect(enviados[0].anexos![0]).toMatchObject({ tipo: "pdf", nome: "sobrado.pdf" });
    expect(Buffer.from((enviados[0].anexos![0] as { base64: string }).base64, "base64").equals(VETORIAL)).toBe(true);
    expect(enviados[0].pedido).toContain("Leia SOMENTE a página 2");
    expect((await admin().detalhe({ id })).passos.find(p => p.chave === "ia:0:2")).toMatchObject({
      envio: "pdf_original", envioMotivo: "Não foi possível separar só a página 2 (a cópia da página não abriu no leitor de PDF): o arquivo foi inteiro à IA, com a instrução de ler só essa página.",
    });
  });
});

describe("EPIC-027 C1 — adaptador da Message Batches API (SDK simulado)", () => {
  const credencial: CredencialIA = PAINEL;
  function sdk(linhas: { custom_id: string; result: unknown }[], status: "in_progress" | "canceling" | "ended" = "ended") {
    const cancel = vi.fn(async () => ({}));
    const s = { messages: { batches: {
      create: vi.fn(), retrieve: vi.fn(async (id: string) => ({ id, processing_status: status })),
      results: vi.fn(async () => (async function* () { for (const l of linhas) yield l; })()), cancel,
    } } } as unknown as SdkLote;
    return { cliente: clienteLoteAnthropic(async () => s), cancel };
  }
  it("em andamento, cancelando e os quatro resultados da API viram a situação do lote; o motivo do erro sai sem a chave", async () => {
    expect(await sdk([], "in_progress").cliente.consultar("b1", "p1", credencial)).toEqual({ andamento: "em_andamento" });
    expect(await sdk([], "canceling").cliente.consultar("b1", "p1", credencial)).toEqual({ andamento: "cancelando" });
    const sucesso = await sdk([
      { custom_id: "outro", result: { type: "expired" } },
      { custom_id: "p1", result: { type: "succeeded", message: { stop_reason: "end_turn", model: "claude-fable-5-2", content: [{ type: "text", text: "{\"plantas\":[]}" }], usage: { input_tokens: 1200, output_tokens: 340 } } } },
    ]).cliente.consultar("b1", "p1", credencial);
    expect(sucesso).toEqual({ andamento: "terminado", resultado: { tipo: "respondido", mensagem: { stopReason: "end_turn", texto: "{\"plantas\":[]}", entrada: 1200, saida: 340, modelo: "claude-fable-5-2" } } });
    const erro = await sdk([{ custom_id: "p1", result: { type: "errored", error: { type: "error", error: { type: "invalid_request_error", message: `chave ${CHAVE} recusada` } } } }]).cliente.consultar("b1", "p1", credencial);
    expect(erro).toMatchObject({ andamento: "terminado", resultado: { tipo: "nao_entregue", motivo: "errored" } });
    expect(JSON.stringify(erro)).not.toContain(CHAVE);
    expect(await sdk([{ custom_id: "p1", result: { type: "canceled" } }]).cliente.consultar("b1", "p1", credencial)).toEqual({ andamento: "terminado", resultado: { tipo: "nao_entregue", motivo: "canceled" } });
    expect(await sdk([{ custom_id: "p1", result: { type: "expired" } }]).cliente.consultar("b1", "p1", credencial)).toEqual({ andamento: "terminado", resultado: { tipo: "nao_entregue", motivo: "expired" } });
    await expect(sdk([]).cliente.consultar("b1", "p1", credencial)).rejects.toThrow("não veio na resposta");
    const c = sdk([]);
    await c.cliente.cancelar("b9", credencial);
    expect(c.cancel).toHaveBeenCalledWith("b9");
    expect(idDoPedidoNoLote("leitura-12-ia:0:3")).toBe("leitura-12-ia-0-3");
  });
});

describe("EPIC-027 C1 — página separada e tela (funções puras)", () => {
  it("pdfDaPagina: cada página do sobrado sai sozinha e lê igual; PDF 1.5 com a página num fluxo de objetos; protegido não", async () => {
    const original = await abrirPdf(VETORIAL);
    for (const p of [1, 2]) {
      const r = pdfDaPagina(VETORIAL, p);
      expect("pdf" in r).toBe(true);
      const so = await abrirPdf((r as { pdf: Buffer }).pdf);
      expect(so.paginas).toBe(1);
      expect(JSON.stringify(lerPagina(await so.pagina(1)).plantas)).toBe(JSON.stringify(lerPagina(await original.pagina(p)).plantas));
    }
    expect(pdfDaPagina(VETORIAL, 3)).toMatchObject({ motivo: expect.stringContaining("página 3 não foi encontrada") });
    expect(pdfDaPagina(Buffer.concat([VETORIAL, Buffer.from("trailer << /Encrypt 9 0 R >>")]), 1)).toEqual({ motivo: "o PDF é protegido (criptografado)" });
    // Duas páginas com os dicionários comprimidos num fluxo de objetos e os recursos herdados da árvore: sai a segunda.
    const c1 = "0 0 m 100 100 l S", c2 = "BT /F1 12 Tf 10 10 Td (Planta 2 \\(fundos\\)) Tj ET";
    const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> >>",
      "<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>", "<< /Type /Page /Parent 2 0 R /Contents 7 0 R /Rotate 90 >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
    let corpo = "", cab = "";
    objs.forEach((o, i) => { cab += `${i + 1} ${corpo.length} `; corpo += `${o}\n`; });
    const stm = deflateSync(Buffer.from(cab + corpo, "latin1"));
    const pdf = Buffer.concat([
      Buffer.from("%PDF-1.5\n"),
      Buffer.from(`6 0 obj\n<< /Length ${c1.length} >>\nstream\n${c1}\nendstream\nendobj\n`),
      Buffer.from(`7 0 obj\n<< /Length ${c2.length} >>\nstream\n${c2}\nendstream\nendobj\n`),
      Buffer.from(`8 0 obj\n<< /Type /ObjStm /N 5 /First ${cab.length} /Filter /FlateDecode /Length ${stm.length} >>\nstream\n`), stm, Buffer.from("\nendstream\nendobj\n"),
      Buffer.from("trailer\n<< /Root 1 0 R >>\n%%EOF\n"),
    ]);
    const r = pdfDaPagina(pdf, 2) as { pdf: Buffer };
    const texto = r.pdf.toString("latin1");
    expect(texto).toContain(c2);
    expect(texto).not.toContain(c1);
    expect(texto).toMatch(/\/MediaBox \[0 0 200 100\]/);
    expect(texto).toMatch(/\/Rotate 90/);
    expect(texto).toMatch(/\/BaseFont \/Helvetica/);
    const so = await abrirPdf(r.pdf);
    expect(so.paginas).toBe(1);
  });

  it("tela: situação do lote em linguagem simples, tempo decorrido, passo e prancha X de Y, sem porcentagem", () => {
    expect(rotuloDoLote({ estado: "executando", lote: null })).toBe("Enviando à IA…");
    expect(rotuloDoLote({ estado: "executando", lote: { situacao: "em_andamento", enviadoEm: "x" } })).toBe("Enviada à IA — na fila ou sendo lida");
    expect(rotuloDoLote({ estado: "executando", lote: { situacao: "cancelando", enviadoEm: "x" } })).toBe("Cancelando a leitura na IA…");
    expect(rotuloDoLote({ estado: "feito", lote: null })).toBe("Lida");
    expect(rotuloDoLote({ estado: "pendente", lote: null })).toBeNull();
    expect([tempoDecorrido(8_400), tempoDecorrido(185_000), tempoDecorrido(3_725_000)]).toEqual(["8 s", "3 min 05 s", "1 h 02 min"]);
    const p = (tipo: string, estado: string, lote: { situacao: "em_andamento"; enviadoEm: string } | null = null) => ({ rotulo: `${tipo} ${estado}`, tipo, estado, lote });
    const a = andamentoDaLeitura([p("inventario", "feito"), p("prancha", "feito"), p("prancha_ia", "feito"), p("prancha_ia", "executando", { situacao: "em_andamento", enviadoEm: "2026-11-20T21:00:00Z" }), p("prancha_ia", "pendente"), p("montagem", "pendente")]);
    expect(a).toMatchObject({ passo: { x: 4, y: 6 }, pranchaIA: { x: 2, y: 3 }, situacao: "Enviada à IA — na fila ou sendo lida", desde: "2026-11-20T21:00:00Z" });
    expect(andamentoDaLeitura([p("prancha", "feito")])).toMatchObject({ atual: null, situacao: null });
    expect(consultaDeNovo("lote")).toBe(true);
    expect(consultaDeNovo("executando")).toBe(true);
    expect(consultaDeNovo("confirmacao")).toBe(false);
    // As duas telas usam o andamento e consultam de novo (o texto antigo "mantenha esta página aberta" não volta).
    for (const arquivo of ["../client/src/pages/admin/AdminMaquete3D.tsx", "../client/src/components/maquete-3d/ImportarPlanta.tsx"]) {
      const tela = readFileSync(new URL(arquivo, import.meta.url), "utf8");
      expect(tela).toContain("<AndamentoLeitura");
      expect(tela).toContain("consultaDeNovo(r.aguardando.motivo)");
      expect(tela).not.toContain("mantenha esta página aberta");
    }
    expect(readFileSync(new URL("../client/src/components/maquete-3d/AndamentoLeitura.tsx", import.meta.url), "utf8")).not.toMatch(/%`|\$\{[^}]*\}%/);
  });
});
