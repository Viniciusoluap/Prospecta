// Maquete 3D (EPIC-024 S-03) — leitura híbrida: o leitor próprio lê as pranchas vetoriais e a IA (SIMULADA) só as
// que ele não consegue ler. Nada aqui sai para a rede nem toca banco real; a chave é falsa e injetada.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "sk-ant-do-ambiente-0000" } }));

import * as schema from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { ENV } from "./_core/env.js";
import { definirDependencias, modeloDaLeitura, resolverCredencialIA, type CredencialIA, type PedidoIA } from "./maquete-3d/base.js";
import { MOTIVOS_IA, anexoDaPagina, motivoParaIA, plantasDaIA } from "./maquete-3d/leitura.js";
import { jpegDaPagina, ladosDoJpeg, pdfDeUmJpeg } from "./maquete-3d/pdf-pagina.js";
import { lerConfig } from "../shared/maquete-3d/regras.js";
import { appRouter } from "./routers.js";
import { comModeloDaTela } from "./fixtures/maquete-3d/confirmacao-da-tela.js";
import { loteSimulado } from "./fixtures/maquete-3d/lote-simulado.js";

const JPEG = readFileSync(new URL("../client/public/casa-compacta-linha-smart.jpg", import.meta.url));
const RASTER = pdfDeUmJpeg({ jpeg: JPEG, ...ladosDoJpeg(JPEG)! });
const VETORIAL = readFileSync(new URL("./fixtures/maquete-3d/sobrado.pdf", import.meta.url));
const PAINEL: CredencialIA = { apiKey: "sk-ant-do-painel-1111", modelo: "claude-sonnet-5-5", origem: "painel" };

const ret = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 8 }, { x: 0, y: 8 }];
const RESPOSTA_IA = {
  plantas: [{
    titulo: "PLANTA BAIXA - EDÍCULA", escala: 0, escalaLegivel: false, temCotas: false,
    paredes: [
      { id: "p1", ax: 0, ay: 0, bx: 6, by: 0, espessura: 0.15, externa: true, confirmada: true },
      { id: "p2", ax: 6, ay: 0, bx: 6, by: 8, espessura: 0.15, externa: true, confirmada: true },
      { id: "p3", ax: 6, ay: 8, bx: 0, by: 8, espessura: 0.15, externa: true, confirmada: false },
      { id: "p4", ax: 0, ay: 8, bx: 0, by: 0, espessura: 0.15, externa: true, confirmada: false },
    ],
    aberturas: [{ id: "a1", paredeId: "p3", tipo: "porta", posicao: 3, largura: 0.9, altura: 2.1, peitoril: 0, entradaPrincipal: true, confirmada: true }],
    comodos: [{ id: "c1", nome: "Sala", funcao: "sala", pontos: ret, areaInformada: null, confirmada: true }],
    escadas: [], pendencias: ["Cota da porta ilegível."],
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
  for (const arquivo of ["0111_maquete_3d.sql", "0112_maquete_3d_comercial.sql", "0113_maquete_3d_pagamento.sql", "0114_maquete_3d_email.sql", "0115_maquete_3d_lead_arquivos.sql", "0121_maquete_3d_revisoes.sql"]) {
    await pg.exec(readFileSync(new URL(`../drizzle/${arquivo}`, import.meta.url), "utf8"));
  }
  return { pg, db: drizzle(pg) };
}

let banco: Awaited<ReturnType<typeof criarBanco>>;
let pedidos: PedidoIA[];
let respostas: (unknown | Error)[];
/** EPIC-027 C1: erros ao CRIAR o lote (a resposta, quando vem, sai de `respostas` ao terminar). */
let errosNoEnvio: Error[];
let credencial: CredencialIA | null;
const caller = (id: number, role: string, permissions = "[]") => appRouter.createCaller({ user: { id, role, permissions, active: true, name: "x" }, req: {}, res: {} } as never);
const admin = () => comModeloDaTela(caller(1, "admin").maquete3d); // a confirmação leva o modelo que a tela mostrou
const colaborador = () => caller(2, "colaborador", JSON.stringify(["maquete3d"])).maquete3d;
const VET = { fonte: "projeto" as const, id: 1, nome: "sobrado.pdf" };
const IMG = { fonte: "projeto" as const, id: 2, nome: "escaneada.pdf" };
const IMG2 = { fonte: "projeto" as const, id: 3, nome: "escaneada-2.pdf" };

async function configurar(dados: Record<string, unknown> | null) {
  await banco.pg.exec(`DELETE FROM maquete_3d_config`);
  if (dados) await banco.pg.query(`INSERT INTO maquete_3d_config (id, dados) VALUES (1, $1)`, [JSON.stringify(dados)]);
}
async function pedido(documentos: (typeof VET)[]) {
  const { id } = await colaborador().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "acima_150_ou_sobrado", documentos });
  await admin().liberar({ id, nota: "PIX recebido em 16/11" });
  await colaborador().iniciarLeitura({ id });
  return id;
}
/** Avança até acabar, parar num erro ou num "aguardando" (o lote em andamento na IA não para: a tela consulta de novo). */
async function ler(id: number) {
  for (let i = 0; i < 20; i++) {
    const r = await colaborador().avancarLeitura({ id });
    if (r.erro || (r.aguardando && r.aguardando.motivo !== "lote") || !r.proximo) return r;
  }
  throw new Error("a leitura não terminou");
}

describe("leitura híbrida — router com banco em memória e IA simulada", () => {
  beforeEach(async () => {
    banco = await criarBanco();
    vi.mocked(getDb).mockReturnValue(banco.db as never);
    await banco.pg.exec(`
      INSERT INTO users ("openId", name, role, active) VALUES ('admin', 'Admin', 'admin', true), ('colab', 'Colaboradora', 'colaborador', true);
      INSERT INTO operational_projects (name, client_name, client_phone, engineer, value) VALUES ('Casa Silva', 'Ana Silva', '99999', 'Eng', 1000);
      INSERT INTO project_documents (project_id, item_id, kind, original_name, canonical_name, mime, size, version, drive_file_id, status)
        VALUES (1, 'arq', 'pdf', 'sobrado.pdf', 'sobrado.pdf', 'application/pdf', 10, 1, 'd1', 'active'),
               (1, 'arq2', 'pdf', 'escaneada.pdf', 'escaneada.pdf', 'application/pdf', 10, 1, 'd2', 'active'),
               (1, 'arq3', 'pdf', 'escaneada-2.pdf', 'escaneada-2.pdf', 'application/pdf', 10, 1, 'd3', 'active');
    `);
    pedidos = []; respostas = []; errosNoEnvio = []; credencial = null;
    definirDependencias({
      agora: () => new Date("2026-11-16T13:00:00Z"),
      lerPdf: async d => (d.nome.startsWith("escaneada") ? RASTER : VETORIAL),
      credencialIA: async () => credencial,
      ia: async () => { throw new Error("a leitura de prancha não usa mais a chamada direta"); },
      lote: loteSimulado({
        aoEnviar: p => { pedidos.push(p); const e = errosNoEnvio.shift(); if (e) throw e; },
        responder: p => {
          const r = respostas.shift() ?? RESPOSTA_IA;
          return r instanceof Error ? r : { json: r, entrada: 2500, saida: 900, modelo: p.credencial?.modelo ?? p.config.modeloIA };
        },
      }).cliente,
    });
  });
  afterEach(async () => { definirDependencias(); await banco.pg.close(); });

  it("prancha que é imagem, sem chave: para sem erro, com a mensagem clara; com a chave, retoma do mesmo passo, pede a confirmação uma vez e a IA lê só ela", async () => {
    await configurar({ motor: "hibrido" });
    const id = await pedido([VET, IMG]);
    const parado = await ler(id);
    // Inventário, as 2 páginas do sobrado e a página escaneada foram lidas pelo leitor próprio; a IA foi agendada.
    expect(parado).toMatchObject({ status: "em_leitura", erro: null, aguardando: { motivo: "chave", pendentes: 1 } });
    expect(parado.aguardando!.mensagem).toBe("Esta prancha é uma imagem e precisa da leitura por IA; cadastre a chave em Integrações → Anthropic (ou envie o PDF exportado do programa de desenho).");
    expect(pedidos).toHaveLength(0);
    let d = await admin().detalhe({ id });
    expect(d).toMatchObject({ status: "em_leitura", pagoEm: expect.any(Date), modelo: null });
    expect(d.passos.map(p => [p.tipo, p.estado, p.motor])).toEqual([
      ["inventario", "feito", "geometrico"], ["prancha", "feito", "geometrico"], ["prancha", "feito", "geometrico"], ["prancha", "feito", "geometrico"],
      ["prancha_ia", "aguardando", null], ["montagem", "pendente", null],
    ]);
    expect(d.passos[4].motivoIA).toBe(MOTIVOS_IA.imagem);
    // De novo sem chave: continua parado no mesmo passo, sem refazer nada.
    expect((await ler(id)).aguardando!.motivo).toBe("chave");

    // O dono cadastra a chave no painel. A leitura retoma do passo que parou e pede a confirmação do custo.
    credencial = PAINEL;
    const confirmar = await ler(id);
    expect(confirmar.aguardando).toMatchObject({ motivo: "confirmacao", pendentes: 1 });
    expect(confirmar.aguardando!.mensagem).toContain("modelo claude-sonnet-5-5");
    expect(pedidos).toHaveLength(0);
    await expect(colaborador().confirmarIA({ id })).rejects.toThrow("Só o administrador");
    await admin().confirmarIA({ id });
    const fim = await ler(id);
    expect(fim).toMatchObject({ status: "em_revisao", erro: null, aguardando: null, proximo: null });

    // A IA foi chamada uma vez, só para a prancha escaneada, com a imagem da página (não o PDF) e a chave do painel.
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].pdfs).toEqual([]);
    expect(pedidos[0].anexos).toEqual([{ tipo: "imagem", base64: JPEG.toString("base64") }]);
    expect(pedidos[0].credencial).toEqual(PAINEL);
    expect(pedidos[0].pedido).toContain("página 1 do arquivo \"escaneada.pdf\"");
    expect(pedidos[0].prazoMs).toBeLessThan(52_000);

    d = await admin().detalhe({ id });
    expect(d.tokens).toEqual({ entrada: 2500, saida: 900 });
    const ia = d.passos.find(p => p.tipo === "prancha_ia")!;
    expect(ia).toMatchObject({ estado: "feito", motor: "ia", modelo: "claude-sonnet-5-5", tokens: { entrada: 2500, saida: 900 }, envio: "imagem" });
    expect(d.ia).toMatchObject({ pranchas: 1, pendentes: 0, lidas: 1, confirmadaEm: "2026-11-16T13:00:00.000Z" });
    // A planta lida pela IA entrou como mais um pavimento, sem nada confirmado (sem cota) e com as pendências.
    const pavs = d.modelo!.edificacoes[0].pavimentos;
    expect(pavs).toHaveLength(3);
    const daIA = pavs.find(p => p.comodos.some(c => c.nome === "Sala" && c.poligono.length === 4 && c.poligono[2].x === 6))!;
    expect(daIA.paredes.every(w => w.origem === "estimada")).toBe(true);
    expect(daIA.aberturas.every(a => a.origem === "estimada")).toBe(true);
    expect(d.modelo!.pendencias.some(p => p.descricao.includes("A escala não está escrita de forma legível"))).toBe(true);
    expect(d.modelo!.pendencias.some(p => p.descricao.includes("Planta lida pela IA a partir de uma imagem, sem cotas legíveis"))).toBe(true);
    expect(d.escalas.filter(e => e.lidaPor === "ia")).toEqual([{ titulo: "PLANTA BAIXA - EDÍCULA", escala: 0, origem: "suposta", lidaPor: "ia" }]);

    // Ler de novo do zero: a confirmação valia só para aquela leitura — a nova pergunta outra vez e não chama a IA.
    await colaborador().iniciarLeitura({ id });
    expect(await ler(id)).toMatchObject({ status: "em_leitura", aguardando: { motivo: "confirmacao", pendentes: 1 } });
    expect(pedidos).toHaveLength(1);
    await admin().confirmarIA({ id });
    expect(await ler(id)).toMatchObject({ status: "em_revisao", aguardando: null });
    expect(pedidos).toHaveLength(2);
    expect((await admin().detalhe({ id })).ia).toMatchObject({ lidasNaMaquete: 2, teto: 8, autorizadas: 1, usadas: 1 });
    expect(ENV.anthropicApiKey).toBe("sk-ant-do-ambiente-0000");
  });

  it("com chave e sem configuração salva, o padrão é o híbrido: as pranchas vetoriais não chamam a IA", async () => {
    credencial = PAINEL;
    expect(await admin().config()).toMatchObject({ motor: "hibrido", motorEscolhido: null, iaConfigurada: true, origemChaveIA: "painel", modeloEmUso: "claude-sonnet-5-5", limitePranchasIA: 8 });
    const id = await pedido([VET]);
    expect(await ler(id)).toMatchObject({ status: "em_revisao", aguardando: null, erro: null });
    expect(pedidos).toHaveLength(0);
    const d = await admin().detalhe({ id });
    expect(d.passos.every(p => p.motor !== "ia")).toBe(true);
    expect(d.ia).toMatchObject({ pranchas: 0 });
    expect(d.modelo!.edificacoes[0].pavimentos).toHaveLength(2);
  });

  it("modo leitor próprio nunca chama a IA, mesmo com chave e prancha escaneada (comportamento de antes)", async () => {
    credencial = PAINEL;
    await configurar({ motor: "geometrico" });
    definirDependencias({ ia: async () => { throw new Error("a IA não pode ser chamada"); } });
    const id = await pedido([IMG]);
    const r = await ler(id);
    expect(r.erro).toContain("Nenhuma planta baixa foi reconhecida");
    expect(r.erro).toContain("A prancha é uma imagem");
    expect((await admin().detalhe({ id })).passos.some(p => p.tipo === "prancha_ia")).toBe(false);
  });

  it("teto de pranchas pela IA por maquete: a confirmação autoriza só até o teto; o que passa dele para e, sem o 'além do teto', fica com o leitor próprio (e isso é dito)", async () => {
    credencial = PAINEL;
    await configurar({ motor: "hibrido", limitePranchasIA: 1 });
    const id = await pedido([IMG, IMG2]);
    expect((await ler(id)).aguardando).toMatchObject({ motivo: "confirmacao", pendentes: 2 });
    await admin().confirmarIA({ id });
    const parado = await ler(id);
    expect(parado.aguardando!.motivo).toBe("teto");
    expect(parado.aguardando!.mensagem).toContain("já usou 1 de 1 prancha(s) pela IA");
    expect(pedidos).toHaveLength(1);
    // Confirmar de novo sem o "além do teto" não autoriza nada.
    await expect(admin().confirmarIA({ id })).rejects.toThrow("já usou o teto de 1 prancha(s)");
    await colaborador().pularIA({ id });
    expect(await ler(id)).toMatchObject({ status: "em_revisao" });
    expect(pedidos).toHaveLength(1);
    const d = await admin().detalhe({ id });
    expect(d.ia).toMatchObject({ pranchas: 2, lidas: 1, lidasNaMaquete: 1, teto: 1 });
    expect(d.ia.foraDoLimite).toHaveLength(1);
    expect(d.ia.foraDoLimite[0]).toContain("escaneada-2.pdf");
    expect(d.ia.foraDoLimite[0]).toContain("limite de 1 prancha(s)");
  });

  it("além do teto: só o admin autoriza, de forma explícita, e só para esta leitura", async () => {
    credencial = PAINEL;
    await configurar({ motor: "hibrido", limitePranchasIA: 1 });
    const id = await pedido([IMG, IMG2]);
    await ler(id);
    await admin().confirmarIA({ id });
    expect((await ler(id)).aguardando!.motivo).toBe("teto");
    await expect(colaborador().confirmarIA({ id, alemDoTeto: true })).rejects.toThrow("Só o administrador");
    await admin().confirmarIA({ id, alemDoTeto: true });
    expect(await ler(id)).toMatchObject({ status: "em_revisao", aguardando: null });
    expect(pedidos).toHaveLength(2);
    expect((await admin().detalhe({ id })).ia).toMatchObject({ lidasNaMaquete: 2, alemDoTeto: true });
    // Ler de novo: nada passa do teto sem uma autorização nova.
    await colaborador().iniciarLeitura({ id });
    expect((await ler(id)).aguardando!.motivo).toBe("teto");
    expect(pedidos).toHaveLength(2);
  });

  it("EPIC-027 C1: envio sem resposta a tempo conta como usado (o lote pode existir); recusa da API no envio e lote sem resultado não são cobrados", async () => {
    credencial = PAINEL;
    await configurar({ motor: "hibrido" });
    const id = await pedido([IMG]);
    await ler(id);
    await admin().confirmarIA({ id });
    // Erros reais do SDK (QA rodada 2, N2: o SDK deixa `name === "Error"`; o tipo vem da classe).
    errosNoEnvio.push(new APIConnectionTimeoutError(), APIError.generate(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, undefined, new Headers()));
    expect((await ler(id)).erro).toContain("O envio da prancha à IA não teve resposta a tempo");
    // O lote pode ter sido criado e lido: a prancha autorizada foi usada e repetir pede nova confirmação.
    expect((await ler(id)).aguardando).toMatchObject({ motivo: "confirmacao" });
    expect(pedidos).toHaveLength(1);
    await admin().confirmarIA({ id });
    expect((await ler(id)).erro).toBe("A IA está sobrecarregada agora. Tente de novo este passo em instantes.");
    // Sobrecarga (529) ao criar o lote: nada foi criado nem cobrado; a prancha volta e o passo se repete sem perguntar.
    // Agora o lote é criado, mas termina com erro da API ("errored"): não cobrado, volta de novo.
    respostas.push(new Error("invalid_request_error: imagem ilegível"));
    expect((await ler(id)).erro).toContain("A IA não aceitou o pedido desta prancha (motivo: invalid_request_error: imagem ilegível): nada foi cobrado e a confirmação foi devolvida");
    expect((await admin().detalhe({ id })).ia).toMatchObject({ lidasNaMaquete: 1, usadas: 0 });
    expect(await ler(id)).toMatchObject({ status: "em_revisao", erro: null });
    expect(pedidos).toHaveLength(4);
    expect((await admin().detalhe({ id })).ia).toMatchObject({ lidasNaMaquete: 2, usadas: 1 });
    expect(pedidos.every(p => p.anexos?.length === 1)).toBe(true);
  });

  it("seguir sem a IA: a prancha fica com o leitor próprio e a montagem diz por que não leu", async () => {
    await configurar({ motor: "hibrido" });
    const id = await pedido([VET, IMG]);
    expect((await ler(id)).aguardando!.motivo).toBe("chave");
    await colaborador().pularIA({ id });
    expect(await ler(id)).toMatchObject({ status: "em_revisao" });
    const d = await admin().detalhe({ id });
    expect(d.passos.find(p => p.tipo === "prancha_ia")).toMatchObject({ estado: "feito", motor: "pulada" });
    expect(d.avisosDaLeitura.some(a => a.includes("A prancha é uma imagem"))).toBe(true);
    expect(pedidos).toHaveLength(0);
  });
});

describe("leitura híbrida — critérios, envio e conversão", () => {
  const diag = (x: Partial<{ segmentos: number; imagens: number; tituloDePlanta: boolean }>) => ({ segmentos: 500, arcos: 0, textos: 10, imagens: 0, escalas: [], plantas: 0, motivo: null, ...x });
  const planta = (x: Partial<{ nomeados: number; pendencias: string[] }>) => ({ ...plantasDaIA(RESPOSTA_IA, false)[0], ...x });

  it("critérios objetivos: imagem, título sem planta, leitura parcial, sem nomes; nunca com leitura boa", () => {
    expect(motivoParaIA({ plantas: [], diagnostico: diag({ segmentos: 0, imagens: 1 }) }, "hibrido")).toBe(MOTIVOS_IA.imagem);
    expect(motivoParaIA({ plantas: [], diagnostico: diag({ segmentos: 0, imagens: 1 }) }, "geometrico")).toBeNull();
    expect(motivoParaIA({ plantas: [], diagnostico: diag({ tituloDePlanta: true }) }, "hibrido")).toBe(MOTIVOS_IA.semPlanta);
    expect(motivoParaIA({ plantas: [], diagnostico: diag({ tituloDePlanta: false }) }, "hibrido")).toBeNull(); // urbanismo, corte, página vazia
    expect(motivoParaIA({ plantas: [planta({ pendencias: ["… o resultado é parcial (pode faltar desenho)"] })], diagnostico: diag({}) }, "hibrido")).toBe(MOTIVOS_IA.parcial);
    expect(motivoParaIA({ plantas: [planta({ nomeados: 0 })], diagnostico: diag({}) }, "hibrido")).toBe(MOTIVOS_IA.semNomes);
    // Leitura boa (uma planta inteira com cômodos nomeados), mesmo com outra parcial: fica com o leitor próprio.
    expect(motivoParaIA({ plantas: [planta({}), planta({ pendencias: ["resultado é parcial"] })], diagnostico: diag({}) }, "hibrido")).toBeNull();
    expect(motivoParaIA({ plantas: [planta({})], diagnostico: diag({}) }, "ia")).toBe(MOTIVOS_IA.sempre);
    expect(motivoParaIA({ plantas: [], diagnostico: diag({ segmentos: 0 }) }, "ia")).toBeNull();
  });

  it("envio: o JPEG da página como imagem; JPEG grande num PDF de uma página; prancha vetorial, o PDF original", () => {
    expect(anexoDaPagina(RASTER, "x.pdf", 1, 1, 1)).toEqual({ anexo: { tipo: "imagem", base64: JPEG.toString("base64") }, envio: "imagem", deImagem: true });
    // JPEG de 4 MB (o de verdade com bytes a mais no fim): não cabe como imagem, vai num PDF só daquela página.
    const grande = Buffer.concat([JPEG, Buffer.alloc(4_000_000, 0)]);
    const r = anexoDaPagina(pdfDeUmJpeg({ jpeg: grande, ...ladosDoJpeg(JPEG)! }), "x.pdf", 1, 1, 1);
    expect(r.envio).toBe("pdf_pagina");
    expect(jpegDaPagina(Buffer.from((r.anexo as { base64: string }).base64, "base64"), 1)!.jpeg.equals(grande)).toBe(true);
    // EPIC-027 C1: prancha vetorial de um PDF com várias páginas vai só com a página dela.
    expect(anexoDaPagina(VETORIAL, "s.pdf", 2, 2)).toMatchObject({ envio: "pdf_pagina", deImagem: false, anexo: { tipo: "pdf", nome: "s.pdf — página 2" } });
    expect(anexoDaPagina(VETORIAL, "s.pdf", 2, 2, 0, false)).toMatchObject({ envio: "pdf_original", anexo: { tipo: "pdf", nome: "s.pdf" } });
    expect(() => anexoDaPagina(VETORIAL, "s.pdf", 2, 101, 0, false)).toThrow("mais que as 100");
  });

  it("extrai o JPEG da página certa, inclusive com o dicionário da página comprimido num fluxo de objetos (PDF 1.5)", () => {
    const lados = ladosDoJpeg(JPEG)!;
    const conteudo = "q 100 0 0 100 0 0 cm /Im7 Do Q";
    const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im7 4 0 R >> >> /Contents 5 0 R >>"];
    // Objetos 1–3 dentro do fluxo 6 (comprimido); 4 é a imagem, 5 o conteúdo.
    let corpo = "", cab = "";
    objs.forEach((o, i) => { cab += `${i + 1} ${corpo.length} `; corpo += `${o}\n`; });
    const stm = deflateSync(Buffer.from(cab + corpo, "latin1"));
    const partes = [
      Buffer.from("%PDF-1.5\n"),
      Buffer.from(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${lados.largura} /Height ${lados.altura} /Filter [/DCTDecode] /Length 6 0 R >>\nstream\n`), JPEG, Buffer.from("\nendstream\nendobj\n"),
      Buffer.from(`5 0 obj\n<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream\nendobj\n`),
      Buffer.from(`6 0 obj\n${JPEG.length}\nendobj\n`),
      Buffer.from(`7 0 obj\n<< /Type /ObjStm /N 3 /First ${cab.length} /Filter /FlateDecode /Length ${stm.length} >>\nstream\n`), stm, Buffer.from("\nendstream\nendobj\n"),
      Buffer.from("trailer\n<< /Root 1 0 R >>\n%%EOF\n"),
    ];
    const pdf = Buffer.concat(partes);
    expect(jpegDaPagina(pdf, 1)!.jpeg.equals(JPEG)).toBe(true);
    expect(jpegDaPagina(pdf, 2)).toBeNull();
    expect(jpegDaPagina(Buffer.from("não é PDF"), 1)).toBeNull();
    expect(jpegDaPagina(Buffer.concat([pdf, Buffer.from("trailer << /Encrypt 9 0 R >>")]), 1)).toBeNull();
  });

  it("conversão da IA: sem cota escrita nada fica confirmado; com cotas, vale o que a IA marcou", () => {
    const [semCota] = plantasDaIA(RESPOSTA_IA, true);
    expect(semCota.paredes.every(w => !w.confirmada)).toBe(true);
    expect(semCota.comodos.every(c => !c.confirmada)).toBe(true);
    expect(semCota).toMatchObject({ escala: 0, escalaOrigem: "suposta", largura: 6, comprimento: 8, nomeados: 1, metrosPorPonto: 0 });
    const [comCota] = plantasDaIA({ ...RESPOSTA_IA, plantas: [{ ...RESPOSTA_IA.plantas[0], temCotas: true, escalaLegivel: true, escala: 50 }] }, true);
    expect(comCota.paredes.map(w => w.confirmada)).toEqual([true, true, false, false]);
    expect(comCota).toMatchObject({ escala: 50, escalaOrigem: "texto" });
    expect(comCota.pendencias.some(t => t.includes("escala não está escrita"))).toBe(false);
  });

  it("credencial: a chave do painel vem antes da do ambiente; o modelo do painel só vale com a chave dele; ENV não muda", async () => {
    const env = { anthropicApiKey: "sk-ant-env-2222" };
    expect(await resolverCredencialIA(async () => ({ apiKey: "sk-ant-painel-3333", modelo: "claude-haiku-5" }), env)).toEqual({ apiKey: "sk-ant-painel-3333", modelo: "claude-haiku-5", origem: "painel" });
    expect(await resolverCredencialIA(async () => null, env)).toEqual({ apiKey: "sk-ant-env-2222", modelo: null, origem: "ambiente" });
    expect(await resolverCredencialIA(async () => { throw new Error("banco fora"); }, env)).toEqual({ apiKey: "sk-ant-env-2222", modelo: null, origem: "ambiente" });
    expect(await resolverCredencialIA(async () => null, {})).toBeNull();
    expect(env).toEqual({ anthropicApiKey: "sk-ant-env-2222" });
    const config = lerConfig(JSON.stringify({ modeloIA: "claude-opus-5-5" }));
    expect(modeloDaLeitura({ apiKey: "k", modelo: "claude-haiku-5", origem: "painel" }, config)).toBe("claude-haiku-5");
    expect(modeloDaLeitura({ apiKey: "k", modelo: null, origem: "painel" }, config)).toBe("claude-opus-5-5");
    expect(modeloDaLeitura({ apiKey: "k", modelo: null, origem: "ambiente" }, config)).toBe("claude-opus-5-5");
    expect(lerConfig(null).motor).toBeUndefined();
  });
});
