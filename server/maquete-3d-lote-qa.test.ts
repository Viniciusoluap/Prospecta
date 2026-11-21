// QA (Quinn) — portão independente da EPIC-027 C1: provas de dinheiro, lote órfão, cancelamento, chave e PDF degenerado.
// Nada sai para a rede nem toca banco real; a chave é falsa e injetada. Testes "ACHADO" documentam o comportamento atual.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import * as schema from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { definirDependencias, type ClienteLote, type CredencialIA } from "./maquete-3d/base.js";
import { ExecucaoConcorrente } from "./maquete-3d/execucao-ia.js";
import { MAX_FALHAS_CONSULTA } from "./maquete-3d/leitura.js";
import { lerEstadoLeitura } from "../shared/maquete-3d/regras.js";


import { ladosDoJpeg, pdfDaPagina, pdfDeUmJpeg } from "./maquete-3d/pdf-pagina.js";
import { appRouter } from "./routers.js";
import { comModeloDaTela } from "./fixtures/maquete-3d/confirmacao-da-tela.js";
import { loteSimulado, type RespostaDoLote } from "./fixtures/maquete-3d/lote-simulado.js";


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

describe("QA C1 — dinheiro, lote órfão, cancelamento e chave (router, banco em memória, lote simulado)", () => {
  beforeEach(async () => {
    banco = await criarBanco();
    vi.mocked(getDb).mockReturnValue(banco.db as never);
    await banco.pg.exec(`
      INSERT INTO users ("openId", name, role, active) VALUES ('admin', 'Admin', 'admin', true), ('colab', 'Colab', 'colaborador', true);
      INSERT INTO operational_projects (name, client_name, client_phone, engineer, value) VALUES ('Casa Silva', 'Ana', '99999', 'Eng', 1000);
      INSERT INTO project_documents (project_id, item_id, kind, original_name, canonical_name, mime, size, version, drive_file_id, status)
        VALUES (1, 'a1', 'pdf', 'sobrado.pdf', 'sobrado.pdf', 'application/pdf', 10, 1, 'd1', 'active'),
               (1, 'a2', 'pdf', 'escaneada.pdf', 'escaneada.pdf', 'application/pdf', 10, 1, 'd2', 'active'),
               (1, 'a3', 'pdf', 'escaneada-2.pdf', 'escaneada-2.pdf', 'application/pdf', 10, 1, 'd3', 'active');
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

  const IMG2 = { fonte: "projeto" as const, id: 3, nome: "escaneada-2.pdf" };
  const passoIA = async (id: number) => (await gravado(id)).passos.find(p => p.tipo === "prancha_ia")!;

  it("QA-1 ACHADO: envio que CRIA o lote mas estoura o tempo — conta como usado (certo), mas o lote fica órfão (nunca consultado nem cancelado) e repetir cria e paga um segundo", async () => {
    const id = await prontoParaIA();
    const comTempoEsgotado: ClienteLote = { ...sim.cliente, enviar: async p => { await sim.cliente.enviar(p); throw new APIConnectionTimeoutError(); } };
    definirDependencias({ lote: comTempoEsgotado });
    const r = await colaborador().avancarLeitura({ id });
    expect(r.erro).toContain("O envio da prancha à IA não teve resposta a tempo");
    expect(await contador(id)).toBe(1);
    expect((await passoIA(id)).lote ?? null).toBeNull(); // o id do lote criado se perdeu
    // Repetir pede nova confirmação (teto e confirmação respeitados) e, confirmado, cria OUTRO lote.
    expect((await colaborador().avancarLeitura({ id })).aguardando?.motivo).toBe("confirmacao");
    definirDependencias({ lote: sim.cliente });
    await admin().confirmarIA({ id });
    await colaborador().avancarLeitura({ id });
    expect(await colaborador().avancarLeitura({ id })).toMatchObject({ erro: null, proximo: { tipo: "montagem" } });
    expect(sim.lotes.size).toBe(2); // dois lotes na Anthropic (os dois seriam lidos e cobrados)
    expect(sim.consultas.every(c => c === "msgbatch_simulado_2")).toBe(true); // o 1º nunca é consultado
    expect(sim.cancelamentos).toEqual([]); // nem cancelado
    expect(await contador(id)).toBe(2); // mas os dois contam no teto: sem gasto fora do teto
  });

  it("QA-2 ACHADO: a função cai entre criar o lote e gravar o id — vira 'interrompida' depois de 75 s, conta como usada, e o lote some do sistema (não dá para cancelar)", async () => {
    const id = await prontoParaIA();
    // ExecucaoConcorrente depois do envio = o pedido termina sem gravar nada (mesmo efeito de a função ser encerrada).
    definirDependencias({ lote: { ...sim.cliente, enviar: async p => { await sim.cliente.enviar(p); throw new ExecucaoConcorrente("queda simulada"); } } });
    await colaborador().avancarLeitura({ id });
    expect(await passoIA(id)).toMatchObject({ estado: "executando" });
    expect((await passoIA(id)).lote ?? null).toBeNull();
    await expect(colaborador().cancelarLeituraIA({ id })).rejects.toThrow("ainda está sendo enviada");
    definirDependencias({ lote: sim.cliente });
    relogio = new Date(relogio.getTime() + 80_000);
    const r = await colaborador().avancarLeitura({ id });
    expect(r.erro).toContain("interrompida");
    expect(await contador(id)).toBe(1);
    expect(sim.lotes.size).toBe(1);
    expect(sim.consultas).toEqual([]);
    expect(sim.cancelamentos).toEqual([]);
    expect(JSON.stringify(await gravado(id))).not.toContain("msgbatch_simulado_1");
  });

  it(`QA-3 ACHADO: ${MAX_FALHAS_CONSULTA} consultas com falha abandonam o lote SEM pedir o cancelamento; a chave não vaza`, async () => {
    const id = await prontoParaIA();
    emAndamento = 1_000;
    await colaborador().avancarLeitura({ id });
    falhaNaConsulta = new Error(`rede caiu ${CHAVE}`);
    let r = await colaborador().avancarLeitura({ id });
    for (let i = 1; i < MAX_FALHAS_CONSULTA && !r.erro; i++) r = await colaborador().avancarLeitura({ id });
    expect(r.erro).toContain("conta como usada");
    expect(JSON.stringify([r, await gravado(id), await admin().detalhe({ id })])).not.toContain(CHAVE);
    expect(await contador(id)).toBe(1);
    expect(sim.cancelamentos).toEqual([]); // o lote continua na Anthropic e ainda pode ser lido e cobrado
    expect(sim.lotes.get("msgbatch_simulado_1")!.cancelado).toBe(false);
  });

  it("QA-4: a consulta periódica (6 s na tela) só CONSULTA — 40 'avançar' com o lote em andamento não reenviam nada", async () => {
    const id = await prontoParaIA();
    emAndamento = 100;
    await colaborador().avancarLeitura({ id });
    for (let i = 0; i < 40; i++) expect((await colaborador().avancarLeitura({ id })).aguardando?.motivo).toBe("lote");
    expect(enviados).toHaveLength(1);
    expect(sim.consultas).toHaveLength(40);
    expect(await contador(id)).toBe(1);
  });

  it("QA-5: cancelar — corretor e cliente são barrados no servidor; cancelar a maquete B não toca no lote da maquete A", async () => {
    const a = await prontoParaIA();
    const b = await prontoParaIA();
    emAndamento = 10;
    await colaborador().avancarLeitura({ id: a });
    await colaborador().avancarLeitura({ id: b });
    for (const papel of ["corretor", "cliente", "user"]) {
      await expect(caller(9, papel).maquete3d.cancelarLeituraIA({ id: a })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(9, papel).maquete3d.cancelarLeituraIAImportacao({ id: a })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(sim.cancelamentos).toEqual([]);
    await colaborador().cancelarLeituraIA({ id: b });
    expect(sim.cancelamentos).toEqual(["msgbatch_simulado_2"]);
    expect((await passoIA(a)).lote).toMatchObject({ id: "msgbatch_simulado_1", situacao: "em_andamento" });
    // Id inexistente: erro claro, nada cancelado.
    await expect(colaborador().cancelarLeituraIA({ id: 999 })).rejects.toBeTruthy();
    expect(sim.cancelamentos).toHaveLength(1);
  });

  it("QA-6 ACHADO (baixo): o cancelamento não diz QUAL prancha — com a tela atrasada, cancela a prancha seguinte que acabou de ser enviada", async () => {
    const id = await prontoParaIA([IMG, IMG2]);
    await colaborador().avancarLeitura({ id }); // envia a prancha 1
    expect(await colaborador().avancarLeitura({ id })).toMatchObject({ erro: null }); // prancha 1 lida
    emAndamento = 5;
    expect((await colaborador().avancarLeitura({ id })).aguardando?.motivo).toBe("lote"); // prancha 2 enviada
    // A pessoa clicou "Cancelar" vendo ainda a prancha 1: o servidor cancela a 2.
    await colaborador().cancelarLeituraIA({ id });
    expect(sim.cancelamentos).toEqual(["msgbatch_simulado_2"]);
  });

  it("QA-7: lote 'expired' devolve; o passo NÃO reenvia sozinho na mesma chamada (só no próximo 'avançar', que a tela não faz depois de erro)", async () => {
    const id = await prontoParaIA();
    respostas.push({ semResultado: "expired" });
    await colaborador().avancarLeitura({ id });
    const r = await colaborador().avancarLeitura({ id });
    expect(r.erro).toContain("expirou");
    expect(enviados).toHaveLength(1);
    expect(await contador(id)).toBe(0);
  });
});

describe("QA C1 — pdfDaPagina com PDFs degenerados (tempo, memória, vazamento)", () => {
  const montar = (objs: string[], extra = "") => {
    let corpo = "%PDF-1.4\n";
    objs.forEach((o, i) => { corpo += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    return Buffer.from(`${corpo}${extra}trailer\n<< /Root 1 0 R >>\n%%EOF\n`, "latin1");
  };
  const rapido = (f: () => unknown) => { const t = Date.now(); const r = f(); expect(Date.now() - t).toBeLessThan(3_000); return r; };

  it("árvore de páginas circular, recurso que aponta para si, página inexistente, arquivo cortado, lixo e aninhamento fundo: responde rápido e nunca lança", () => {
    const circular = montar([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /XObject << /X1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << /XObject << /X1 4 0 R >> >> /Length 0 >>\nstream\n\nendstream",
      "<< /Length 3 >>\nstream\n0 g\nendstream",
    ]);
    const r = rapido(() => pdfDaPagina(circular, 1)) as { pdf?: Buffer };
    expect(r.pdf).toBeInstanceOf(Buffer);
    for (const p of [0, -1, 2, 1e9]) expect(rapido(() => pdfDaPagina(circular, p))).toHaveProperty("motivo");
    expect(rapido(() => pdfDaPagina(VETORIAL.subarray(0, Math.floor(VETORIAL.length / 2)), 1))).toBeTruthy();
    expect(rapido(() => pdfDaPagina(Buffer.from(Array.from({ length: 200_000 }, (_, i) => (i * 7919) % 256)), 1))).toHaveProperty("motivo");
    const fundo = montar(["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [3 0 R] /Count 1 /X ${"[".repeat(200_000)} >>`, "<< /Type /Page /MediaBox [0 0 1 1] >>"]);
    expect(rapido(() => pdfDaPagina(fundo, 1))).toBeTruthy();
    const hexCortado = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /X <ABCD", "latin1");
    expect(rapido(() => pdfDaPagina(hexCortado, 1))).toHaveProperty("motivo");
  });

  it("ACHADO (baixo): recursos compartilhados no nó de páginas levam junto as imagens das OUTRAS páginas", () => {
    const pdf = montar([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 10 10] /Resources << /XObject << /Im1 5 0 R /Im2 6 0 R >> >> >>",
      "<< /Type /Page /Parent 2 0 R /Contents 7 0 R >>",
      "<< /Type /Page /Parent 2 0 R /Contents 8 0 R >>",
      "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Length 22 >>\nstream\nPAGINA-UM-IMAGEM-0001\nendstream",
      "<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Length 22 >>\nstream\nPAGINA-DOIS-SEGREDO-2\nendstream",
      "<< /Length 8 >>\nstream\n/Im1 Do\nendstream",
      "<< /Length 8 >>\nstream\n/Im2 Do\nendstream",
    ]);
    const r = pdfDaPagina(pdf, 1) as { pdf: Buffer };
    const texto = r.pdf.toString("latin1");
    expect(texto).toContain("PAGINA-UM-IMAGEM");
    expect(texto).toContain("PAGINA-DOIS-SEGREDO"); // vai junto, embora a página 1 não desenhe
  });

  it("ACHADO (baixo, pré-existente e ampliado): fluxo de objetos comprimido é descompactado sem limite de tamanho (bomba de compressão)", () => {
    const bruto = Buffer.alloc(48 * 1024 * 1024, 0x20);
    const stm = deflateSync(bruto, { level: 9 });
    expect(stm.length).toBeLessThan(200_000); // ~50 KB que viram 48 MB na memória
    const pdf = Buffer.concat([
      Buffer.from("%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /MediaBox [0 0 1 1] >>\nendobj\n", "latin1"),
      Buffer.from(`9 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${stm.length} >>\nstream\n`, "latin1"), stm, Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1"),
    ]);
    const inicio = Date.now();
    const r = pdfDaPagina(pdf, 1);
    // eslint-disable-next-line no-console
    console.info(`[QA] bomba ~50 KB → 48 MB descompactados: ${Date.now() - inicio} ms, resultado: ${"pdf" in r ? "pdf" : r.motivo}`);
    expect(r).toBeTruthy(); // não há maxOutputLength no inflateSync (pdf-pagina.ts, decodificar)
  });
});
