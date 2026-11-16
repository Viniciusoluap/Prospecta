// Maquete 3D (EPIC-024 S-03/S-05) — regressão dos 10 achados do portão de QA (relatório de 16/11). Cada bloco é a
// versão invertida do teste adversarial do QA: prova que o defeito não volta. Banco em memória (PGlite) e IA
// SIMULADA; nada sai para a rede e a chave é falsa.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { APIConnectionError, APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableColumns } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import * as schema from "../drizzle/schema.js";
import { maquetes3d } from "../drizzle/schema-maquete-3d.js";
import { getDb } from "./db.js";
import { definirDependencias, erroSeguro, tipoDoErroIA, type CredencialIA, type PedidoIA } from "./maquete-3d/base.js";
import { naoCobrado } from "./maquete-3d/execucao-ia.js";
import { anexoDaPagina, plantasDaIA } from "./maquete-3d/leitura.js";
import { AREA_MIN_M2, comodoRepetido, lerRespostaPrancha, medidaSuspeita, sobreposicao } from "./maquete-3d/resposta-ia.js";
import { ladosDoJpeg, pdfDeUmJpeg } from "./maquete-3d/pdf-pagina.js";
import { lerEstadoLeitura } from "../shared/maquete-3d/regras.js";
import { appRouter } from "./routers.js";
import { rotuloContinuarLeitura } from "../client/src/components/maquete-3d/rotulos-leitura.js";

const JPEG = readFileSync(new URL("../client/public/casa-compacta-linha-smart.jpg", import.meta.url));
const RASTER = pdfDeUmJpeg({ jpeg: JPEG, ...ladosDoJpeg(JPEG)! });
const VETORIAL = readFileSync(new URL("./fixtures/maquete-3d/sobrado.pdf", import.meta.url));
const CHAVE = "sk-ant-api03-SEGREDO-QA-1234567890";
const PAINEL: CredencialIA = { apiKey: CHAVE, modelo: "claude-sonnet-5-5", origem: "painel" };
const MIGRACOES = ["0111_maquete_3d.sql", "0112_maquete_3d_comercial.sql", "0113_maquete_3d_pagamento.sql", "0114_maquete_3d_email.sql", "0115_maquete_3d_lead_arquivos.sql", "0121_maquete_3d_revisoes.sql"];

const ret = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 8 }, { x: 0, y: 8 }];
const PLANTA = {
  titulo: "PLANTA BAIXA", escala: 50, escalaLegivel: true, temCotas: true,
  paredes: [
    { id: "p1", ax: 0, ay: 0, bx: 6, by: 0, espessura: 0.15, externa: true, confirmada: true },
    { id: "p2", ax: 6, ay: 0, bx: 6, by: 8, espessura: 0.15, externa: true, confirmada: true },
    { id: "p3", ax: 6, ay: 8, bx: 0, by: 8, espessura: 0.15, externa: true, confirmada: true },
    { id: "p4", ax: 0, ay: 8, bx: 0, by: 0, espessura: 0.15, externa: true, confirmada: true },
  ],
  aberturas: [{ id: "a1", paredeId: "p3", tipo: "porta", posicao: 3, largura: 0.9, altura: 2.1, peitoril: 0, entradaPrincipal: true, confirmada: true }],
  comodos: [{ id: "c1", nome: "Sala", funcao: "sala", pontos: ret, areaInformada: 48, confirmada: true }],
  escadas: [], pendencias: [],
};
const RESPOSTA_IA = { plantas: [PLANTA], pendencias: [] };

const TABELAS = ["users", "leads", "leadServices", "operationalProjects", "projectRevisionRequests", "projectDocuments", "incorporationStudies", "incorporationRegistrationDocuments", "incorporationUnits", "paymentOrders", "draws", "products"];
let ddl: string | null = null;
async function criarBanco(migracoes = MIGRACOES) {
  if (!ddl) {
    const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
    const escolhidas: Record<string, unknown> = {};
    for (const [nome, valor] of Object.entries(schema)) if (TABELAS.includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
    ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n");
  }
  const pg = new PGlite();
  await pg.exec(ddl);
  await pg.exec(`CREATE TABLE incorporation_registration_file_data (document_id integer PRIMARY KEY, mime text, size_bytes integer, data bytea);`);
  for (const a of migracoes) await pg.exec(readFileSync(new URL(`../drizzle/${a}`, import.meta.url), "utf8"));
  return { pg, db: drizzle(pg) };
}

let banco: Awaited<ReturnType<typeof criarBanco>>;
let pedidos: PedidoIA[];
let respostas: unknown[];
let credencial: CredencialIA | null;
let atrasoIA = 0;
let relogio = new Date("2026-11-16T13:00:00Z");
let pdfs: Record<string, Buffer>;
const caller = (id: number, role: string, permissions = "[]") => appRouter.createCaller({ user: { id, role, permissions, active: true, name: "x" }, req: {}, res: {} } as never);
const admin = () => caller(1, "admin").maquete3d;
const colaborador = () => caller(2, "colaborador", JSON.stringify(["maquete3d"])).maquete3d;
const VET = { fonte: "projeto" as const, id: 1, nome: "sobrado.pdf" };
const IMG = { fonte: "projeto" as const, id: 2, nome: "escaneada.pdf" };

async function configurar(dados: Record<string, unknown>) {
  await banco.pg.exec(`DELETE FROM maquete_3d_config`);
  await banco.pg.query(`INSERT INTO maquete_3d_config (id, dados) VALUES (1, $1)`, [JSON.stringify(dados)]);
}
type Passo = Awaited<ReturnType<ReturnType<typeof colaborador>["avancarLeitura"]>>;
async function ler(id: number): Promise<Passo> {
  let r!: Passo;
  for (let i = 0; i < 25; i++) { r = await colaborador().avancarLeitura({ id }); if (r.erro || r.aguardando || !r.proximo) return r; }
  return r;
}
async function importar(id: number, doc: number) {
  let r = await colaborador().importarPlanta({ id, doc });
  for (let i = 0; i < 25 && !r.pronta && !r.erro && !r.aguardando; i++) r = await colaborador().avancarImportacao({ id });
  return r;
}
async function pedido(documentos: (typeof VET)[]) {
  const { id } = await colaborador().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "acima_150_ou_sobrado", documentos });
  await admin().liberar({ id, nota: "PIX recebido" });
  return id;
}
const contador = async (id: number) => (await banco.pg.query<{ n: number }>(`SELECT ia_pranchas_lidas AS n FROM maquetes_3d WHERE id = $1`, [id])).rows[0].n;

async function preparar(b: Awaited<ReturnType<typeof criarBanco>>) {
  banco = b;
  vi.mocked(getDb).mockReturnValue(banco.db as never);
  await banco.pg.exec(`
    INSERT INTO users ("openId", name, role, active) VALUES ('admin', 'Admin', 'admin', true), ('colab', 'Colab', 'colaborador', true);
    INSERT INTO operational_projects (name, client_name, client_phone, engineer, value) VALUES ('Casa Silva', 'Ana', '99999', 'Eng', 1000);
    INSERT INTO project_documents (project_id, item_id, kind, original_name, canonical_name, mime, size, version, drive_file_id, status)
      VALUES (1, 'a1', 'pdf', 'sobrado.pdf', 'sobrado.pdf', 'application/pdf', 10, 1, 'd1', 'active'),
             (1, 'a2', 'pdf', 'escaneada.pdf', 'escaneada.pdf', 'application/pdf', 10, 1, 'd2', 'active');
  `);
  pedidos = []; respostas = []; credencial = null; atrasoIA = 0; relogio = new Date("2026-11-16T13:00:00Z");
  pdfs = { "sobrado.pdf": VETORIAL, "escaneada.pdf": RASTER };
  definirDependencias({
    agora: () => relogio,
    lerPdf: async d => pdfs[d.nome],
    credencialIA: async () => credencial,
    ia: async p => {
      pedidos.push(p);
      if (atrasoIA) await new Promise(r => setTimeout(r, atrasoIA));
      const r = respostas.shift() ?? RESPOSTA_IA;
      if (r instanceof Error) throw r;
      return { json: r, entrada: 1000, saida: 500, modelo: "claude-sonnet-5-5" };
    },
  });
}

// Testes com banco em memória e várias leituras seguidas: passam de 5 s com a máquina carregada.
vi.setConfig({ testTimeout: 30_000 });

describe("QA S-03/S-05 — regressão dos achados", () => {
  beforeEach(async () => { await preparar(await criarBanco()); });
  afterEach(async () => { definirDependencias(); await banco.pg.close(); });

  // Achado 2 (Q1): dois "avançar" ao mesmo tempo no passo da IA.
  it("achado 2: dois 'avançar' simultâneos na leitura fazem UMA chamada paga; o outro vê o passo em curso", async () => {
    await configurar({ motor: "hibrido" });
    credencial = PAINEL;
    const id = await pedido([IMG]);
    await colaborador().iniciarLeitura({ id });
    expect((await ler(id)).aguardando?.motivo).toBe("confirmacao");
    await admin().confirmarIA({ id });
    atrasoIA = 150;
    const [a, b] = await Promise.all([colaborador().avancarLeitura({ id }), colaborador().avancarLeitura({ id })]);
    expect(pedidos).toHaveLength(1);
    expect([a.aguardando?.motivo, b.aguardando?.motivo]).toContain("executando");
    expect(await contador(id)).toBe(1);
    expect(await ler(id)).toMatchObject({ status: "em_revisao", erro: null });
    expect(pedidos).toHaveLength(1);
  });

  it("achado 2: reserva velha (a função morreu no meio) vira erro claro e não chama a IA em silêncio", async () => {
    await configurar({ motor: "hibrido" });
    credencial = PAINEL;
    const id = await pedido([IMG]);
    await colaborador().iniciarLeitura({ id });
    await ler(id);
    await admin().confirmarIA({ id });
    // Simula a reserva gravada por uma chamada que nunca terminou.
    const linha = (await banco.pg.query<{ leitura: string }>(`SELECT leitura FROM maquetes_3d WHERE id = $1`, [id])).rows[0];
    const estado = lerEstadoLeitura(linha.leitura);
    Object.assign(estado.passos.find(p => p.tipo === "prancha_ia")!, { estado: "executando", reservadoEm: relogio.toISOString() });
    estado.confirmacaoIA!.usadas = 1;
    await banco.pg.query(`UPDATE maquetes_3d SET leitura = $1, ia_pranchas_lidas = 1 WHERE id = $2`, [JSON.stringify(estado), id]);
    expect((await colaborador().avancarLeitura({ id })).aguardando?.motivo).toBe("executando");
    relogio = new Date(relogio.getTime() + 90_000);
    expect((await colaborador().avancarLeitura({ id })).erro).toContain("foi interrompida");
    // A chamada interrompida conta como usada: repetir pede confirmação nova.
    expect((await colaborador().avancarLeitura({ id })).aguardando?.motivo).toBe("confirmacao");
    expect(pedidos).toHaveLength(0);
  });

  it("achado 2: na importação, dois 'avançar' simultâneos fazem UMA chamada; o atrasado não regrava a importação descartada", async () => {
    await configurar({ motor: "hibrido" });
    credencial = PAINEL;
    const id = await pedido([IMG]);
    expect((await importar(id, 0)).aguardando?.motivo).toBe("confirmacao");
    await admin().confirmarIAImportacao({ id });
    atrasoIA = 150;
    await Promise.all([colaborador().avancarImportacao({ id }), colaborador().avancarImportacao({ id })]);
    expect(pedidos).toHaveLength(1);

    // Outra importação; a chamada fica em curso e, enquanto isso, a pessoa tenta descartar: recusado até o passo
    // terminar (QA rodada 2, N1 — a resposta paga não é jogada fora). Depois, descarta e nada é regravado.
    expect((await importar(id, 0)).aguardando?.motivo).toBe("confirmacao");
    await admin().confirmarIAImportacao({ id });
    const emCurso = colaborador().avancarImportacao({ id });
    await new Promise(r => setTimeout(r, 40));
    await expect(colaborador().descartarImportacao({ id })).rejects.toThrow("sendo lido pela IA agora");
    await emCurso;
    await colaborador().descartarImportacao({ id });
    expect((await colaborador().detalhe({ id })).importacao).toBeNull();
    expect(pedidos).toHaveLength(2);
  });

  // Achado 1 (Q2): confirmação eterna e teto que não valia por maquete.
  it("achado 1: com teto 1 e UMA confirmação, reler 3 vezes e importar 3 vezes não chama a IA de novo (o colaborador não consegue gastar)", async () => {
    await configurar({ motor: "hibrido", limitePranchasIA: 1 });
    credencial = PAINEL;
    const id = await pedido([VET, IMG]);
    await colaborador().iniciarLeitura({ id });
    await ler(id);
    await admin().confirmarIA({ id });
    await ler(id);
    expect(pedidos).toHaveLength(1);
    for (let k = 0; k < 3; k++) {
      await colaborador().iniciarLeitura({ id });
      expect((await ler(id)).aguardando?.motivo).toBe("teto");
      await colaborador().pularIA({ id }); // seguir sem a IA: fica o leitor próprio
      await ler(id);
    }
    for (let k = 0; k < 3; k++) expect((await importar(id, 1)).aguardando?.motivo).toBe("teto");
    expect(pedidos).toHaveLength(1);
    expect(await contador(id)).toBe(1);
    // A confirmação comum não passa do teto; só o "além do teto" do admin, e o colaborador não pode dá-lo.
    await expect(admin().confirmarIAImportacao({ id })).rejects.toThrow("já usou o teto");
    await expect(colaborador().confirmarIAImportacao({ id, alemDoTeto: true })).rejects.toThrow("Só o administrador");
  });

  it("achado 1: a confirmação traz o número de pranchas e expira ao atingi-lo; importação nova nasce sem confirmação", async () => {
    await configurar({ motor: "hibrido", limitePranchasIA: 8 });
    credencial = PAINEL;
    const id = await pedido([IMG]);
    expect((await importar(id, 0)).aguardando?.motivo).toBe("confirmacao");
    await admin().confirmarIAImportacao({ id });
    let r = await colaborador().avancarImportacao({ id });
    for (let i = 0; i < 10 && !r.pronta && !r.erro && !r.aguardando; i++) r = await colaborador().avancarImportacao({ id });
    expect(r.pronta).toBe(true);
    const d = await colaborador().detalhe({ id });
    expect(d.importacao!.ia).toMatchObject({ autorizadas: 1, usadas: 1, lidasNaMaquete: 1, teto: 8 });
    // Nova importação: pede de novo, e a leitura principal também não herda nada.
    expect((await importar(id, 0)).aguardando?.motivo).toBe("confirmacao");
    expect(pedidos).toHaveLength(1);
    expect(lerEstadoLeitura((await banco.pg.query<{ leitura: string }>(`SELECT leitura FROM maquetes_3d WHERE id = $1`, [id])).rows[0].leitura).confirmacaoIA ?? null).toBeNull();
  });

  // Achado 3 (Q3): motor "ia" sem confirmação.
  it("achado 3: motor 'IA em tudo' não chama a IA sem a confirmação do admin, mesmo com a chave do painel", async () => {
    await configurar({ motor: "ia" });
    credencial = PAINEL;
    respostas = [{ pranchas: [], edificacoes: [], implantacao: null, pendencias: [] }];
    const id = await pedido([VET]);
    await colaborador().iniciarLeitura({ id });
    const r = await colaborador().avancarLeitura({ id });
    expect(r).toMatchObject({ erro: null, aguardando: { motivo: "confirmacao", pendentes: 1 } });
    expect(r.aguardando!.mensagem).toContain("motor \"IA em tudo\"");
    expect(pedidos).toHaveLength(0);
    await expect(colaborador().confirmarIA({ id })).rejects.toThrow("Só o administrador");
    await admin().confirmarIA({ id });
    expect((await colaborador().avancarLeitura({ id })).erro).toMatch(/Nenhuma planta baixa/);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].prazoMs).toBeLessThan(52_000);
  });

  it("achado 3: só cadastrar a chave no painel (sem motor escolhido) não liga gasto: prancha vetorial boa não vai à IA e a escaneada espera a confirmação", async () => {
    credencial = PAINEL;
    const id = await pedido([VET, IMG]);
    await colaborador().iniciarLeitura({ id });
    expect((await ler(id)).aguardando?.motivo).toBe("confirmacao");
    expect(pedidos).toHaveLength(0);
  });

  // Achado 4 (Q4): documento pela posição.
  it("achado 4: reordenar a lista durante a importação não troca o PDF lido; tirar o PDF da lista para com mensagem clara", async () => {
    await configurar({ motor: "geometrico" });
    const id = await pedido([VET, IMG]);
    let r = await colaborador().importarPlanta({ id, doc: 0 }); // sobrado.pdf
    await colaborador().definirDocumentos({ id, documentos: [IMG, VET] }); // a posição 0 agora é a escaneada
    for (let i = 0; i < 10 && !r.pronta && !r.erro; i++) r = await colaborador().avancarImportacao({ id });
    expect(r).toMatchObject({ pronta: true, erro: null });
    const d = await colaborador().detalhe({ id });
    expect(d.importacao!.documento.nome).toBe("sobrado.pdf");
    expect(d.importacao!.candidata!.edificacoes[0].pavimentos).toHaveLength(2);
    // O fundo de cada pavimento aponta para o sobrado na posição de agora (1), não para a escaneada.
    expect(d.importacao!.pranchas.map(p => [p.pavimentoId, p.doc, p.pagina])).toEqual([["ed1-pv1", 1, 1], ["ed1-pv2", 1, 2]]);

    await colaborador().descartarImportacao({ id });
    let s = await colaborador().importarPlanta({ id, doc: 1 }); // sobrado.pdf de novo
    await colaborador().definirDocumentos({ id, documentos: [IMG] }); // o sobrado sai da lista
    for (let i = 0; i < 10 && !s.pronta && !s.erro; i++) s = await colaborador().avancarImportacao({ id });
    expect(s.pronta).toBe(false);
    expect(s.erro).toContain("\"sobrado.pdf\" saiu da lista de PDFs desta maquete");
    expect(s.erro).toContain("Nada foi lido de outro arquivo");
  });

  it("achado 4: o fundo da revisão segue o arquivo pela identidade; arquivo fora da lista fica sem fundo (nunca o de outro PDF)", async () => {
    await configurar({ motor: "geometrico" });
    const id = await pedido([VET]);
    await colaborador().iniciarLeitura({ id });
    expect(await ler(id)).toMatchObject({ status: "em_revisao" });
    expect((await colaborador().detalhe({ id })).pranchas.map(p => p.doc)).toEqual([0, 0]);
    await colaborador().definirDocumentos({ id, documentos: [IMG, VET] });
    expect((await colaborador().detalhe({ id })).pranchas.map(p => p.doc)).toEqual([1, 1]);
    await colaborador().definirDocumentos({ id, documentos: [IMG] });
    expect((await colaborador().detalhe({ id })).pranchas).toEqual([]);
  });

  // Achado 5 (Q11 + resposta vazia): anexo e leitura própria preservada.
  it("achado 5: prancha escaneada (imagem cobrindo a página) vai como imagem; com a imagem pequena, vai a página/PDF", async () => {
    await configurar({ motor: "hibrido" });
    credencial = PAINEL;
    const id = await pedido([IMG]);
    await colaborador().iniciarLeitura({ id });
    await ler(id);
    await admin().confirmarIA({ id });
    await ler(id);
    expect(pedidos[0].anexos).toEqual([{ tipo: "imagem", base64: JPEG.toString("base64") }]);
    // Cobertura medida pelo leitor próprio: abaixo de 60% da página, a imagem não é "a página".
    expect(anexoDaPagina(RASTER, "x.pdf", 1, 1, 0.3).envio).toBe("pdf_original");
    expect(anexoDaPagina(RASTER, "x.pdf", 1, 1, 0.95).envio).toBe("imagem");
  });

  it("achado 5: a IA voltou sem planta — fica o que o leitor próprio leu, com pendência visível", async () => {
    await configurar({ motor: "hibrido" });
    credencial = PAINEL;
    const id = await pedido([VET]);
    await colaborador().iniciarLeitura({ id });
    // Leitura própria feita (sobrado vetorial) e, à mão, uma prancha agendada para a IA (como se o leitor tivesse ficado parcial).
    let r = await colaborador().avancarLeitura({ id });
    r = await colaborador().avancarLeitura({ id });
    const linha = (await banco.pg.query<{ leitura: string }>(`SELECT leitura FROM maquetes_3d WHERE id = $1`, [id])).rows[0];
    const estado = lerEstadoLeitura(linha.leitura);
    const prancha = estado.passos.find(p => p.tipo === "prancha" && p.estado === "feito")!;
    const final = estado.passos.findIndex(p => p.tipo === "montagem");
    estado.passos.splice(final, 0, { chave: `ia:${prancha.doc}:${prancha.pagina}`, tipo: "prancha_ia", rotulo: "Leitura pela IA — sobrado.pdf — página 1", estado: "pendente", doc: prancha.doc, pagina: prancha.pagina, arquivo: prancha.arquivo, motivoIA: "teste" });
    estado.confirmacaoIA = { em: relogio.toISOString(), por: 1, pranchas: 1, usadas: 0 };
    await banco.pg.query(`UPDATE maquetes_3d SET leitura = $1 WHERE id = $2`, [JSON.stringify(estado), id]);
    respostas = [{ plantas: [], pendencias: ["Não encontrei planta baixa."] }];
    expect(await ler(id)).toMatchObject({ status: "em_revisao", erro: null });
    expect(pedidos).toHaveLength(1);
    const d = await colaborador().detalhe({ id });
    expect(d.modelo!.edificacoes[0].pavimentos).toHaveLength(2); // o térreo lido pelo leitor próprio continua
    expect(d.modelo!.pendencias.some(p => p.descricao.includes("Ficou o que o leitor próprio leu desta prancha"))).toBe(true);
    expect(d.escalas.every(e => e.lidaPor === "geometrico")).toBe(true);
  });

  // Achado 6 (Q8): a planta anterior não se perde se o histórico falhar.
  it("achado 6: histórico fora do ar — aplicar, restaurar, ler de novo e salvar param com erro claro e NADA é sobrescrito", async () => {
    await configurar({ motor: "geometrico" });
    const id = await pedido([VET]);
    await colaborador().iniciarLeitura({ id });
    await ler(id);
    // Maquete antiga: sem histórico; e o insert no histórico passa a falhar.
    await banco.pg.exec(`DELETE FROM maquete_3d_revisoes`);
    await banco.pg.exec(`CREATE FUNCTION falha() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'falha transitória'; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER t BEFORE INSERT ON maquete_3d_revisoes FOR EACH ROW EXECUTE FUNCTION falha();`);
    const antes = await colaborador().detalhe({ id });
    const destino = { tipo: "pavimento" as const, edificacaoId: antes.modelo!.edificacoes[0].id, pavimentoId: antes.modelo!.edificacoes[0].pavimentos[0].id };
    await importar(id, 0);
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(colaborador().aplicarImportacao({ id, versao: antes.modeloVersao, destino })).rejects.toThrow("nada foi alterado (a planta anterior nunca é perdida)");
    await expect(colaborador().salvarModelo({ id, versao: antes.modeloVersao, modelo: antes.modelo! })).rejects.toThrow("nada foi alterado");
    await expect(colaborador().iniciarLeitura({ id })).rejects.toThrow("Há uma planta importada em andamento");
    await colaborador().descartarImportacao({ id });
    await expect(colaborador().iniciarLeitura({ id })).rejects.toThrow("nada foi alterado");
    erro.mockRestore();
    const depois = await colaborador().detalhe({ id });
    expect(depois.modelo).toEqual(antes.modelo);
    expect(depois).toMatchObject({ modeloVersao: antes.modeloVersao, status: "em_revisao" });

    // O histórico volta: a primeira mudança guarda a planta anterior ANTES de sobrescrever.
    await banco.pg.exec(`DROP TRIGGER t ON maquete_3d_revisoes`);
    await importar(id, 0);
    await colaborador().aplicarImportacao({ id, versao: antes.modeloVersao, destino });
    const revs = await colaborador().revisoes({ id });
    expect(revs.map(r => [r.versao, r.origem])).toEqual([[antes.modeloVersao + 1, "importacao_pdf"], [antes.modeloVersao, "anterior"]]);
    await colaborador().restaurarRevisao({ id, revisaoId: revs[1].id, versao: antes.modeloVersao + 1 });
    expect((await colaborador().detalhe({ id })).modelo).toEqual(antes.modelo);
  });

  // Achados 8 e 9 (Q6, Q7, Q12): resposta fora do esquema e geometria absurda.
  it("achados 8 e 9: resposta fora do formato não vira erro técnico, não cobra de novo e o que foi descartado vira pendência", async () => {
    await configurar({ motor: "hibrido" });
    credencial = PAINEL;
    const id = await pedido([IMG]);
    await colaborador().iniciarLeitura({ id });
    await ler(id);
    await admin().confirmarIA({ id });
    respostas = [{ plantas: [{ ...PLANTA, comodos: [
      ...PLANTA.comodos,
      { id: "c2", nome: "Sala 2", funcao: "sala", pontos: ret, areaInformada: 48, confirmada: true },
      { id: "c3", nome: "Zero", funcao: "sala", pontos: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], areaInformada: null, confirmada: true },
      { id: "c4", nome: "Gigante", funcao: "sala", pontos: [{ x: 0, y: 0 }, { x: 1e9, y: 0 }, { x: 1e9, y: 1e9 }], areaInformada: null, confirmada: true },
      { id: "c5", nome: 42, funcao: "sala", pontos: [], areaInformada: 0, confirmada: true },
      { id: "c6", nome: "Dois pontos", funcao: "sala", pontos: [{ x: 0, y: 0 }, { x: 1, y: 1 }], areaInformada: null, confirmada: true },
    ] }], pendencias: [] }];
    expect(await ler(id)).toMatchObject({ status: "em_revisao", erro: null });
    expect(pedidos).toHaveLength(1);
    const d = await admin().detalhe({ id });
    expect(d.modelo!.edificacoes[0].pavimentos[0].comodos.map(c => c.nome)).toEqual(["Sala"]);
    const textos = d.modelo!.pendencias.map(p => p.descricao).join("\n");
    expect(textos).toContain("\"Sala 2\" lido pela IA repete \"Sala\"");
    expect(textos).toContain("\"Zero\" lido pela IA tem área quase zero");
    expect(textos).toContain("\"Gigante\" lido pela IA tem coordenadas fora da escala");
    expect(textos).toContain("\"Dois pontos\" lido pela IA tem menos de 3 pontos");
    expect(textos).toContain("1 item(ns) fora do formato esperado");
  });

  it("achado 8: resposta inteira fora do esquema — mensagem simples, sem stack/TypeError, e a chave nunca aparece", async () => {
    await configurar({ motor: "hibrido" });
    credencial = PAINEL;
    const id = await pedido([IMG]);
    await colaborador().iniciarLeitura({ id });
    await ler(id);
    await admin().confirmarIA({ id });
    respostas = [{ plantas: "x" }];
    const r = await ler(id);
    expect(r.erro).toContain("A IA devolveu uma resposta fora do formato esperado");
    expect(r.erro).not.toMatch(/TypeError|Cannot read|undefined/);
    expect(pedidos).toHaveLength(1);
    // Chave no texto de um erro da API: mascarada no passo, no detalhe, na configuração e na linha do banco.
    respostas = [new Error(`401 invalid x-api-key ${CHAVE}`)];
    await colaborador().iniciarLeitura({ id });
    await ler(id);
    await admin().confirmarIA({ id });
    const r2 = await ler(id);
    const tudo = JSON.stringify([r, r2, await admin().detalhe({ id }), await admin().config()]);
    expect(tudo.includes(CHAVE)).toBe(false);
    const linha = await banco.pg.query<{ t: string }>(`SELECT row_to_json(m)::text AS t FROM maquetes_3d m`);
    expect(linha.rows[0].t.includes(CHAVE)).toBe(false);
    expect(erroSeguro(new Error(`falhou ${CHAVE}`))).not.toContain("SEGREDO");
  });

  // Achado 10 (Q9): importação com a maquete em leitura.
  it("achado 10: 'ler de novo' é bloqueado com importação aberta; avançar/confirmar a importação conferem a situação e não gravam", async () => {
    await configurar({ motor: "geometrico" });
    const id = await pedido([VET]);
    await colaborador().importarPlanta({ id, doc: 0 });
    await expect(colaborador().iniciarLeitura({ id })).rejects.toThrow("aplique ou descarte a importação antes de ler o projeto de novo");
    expect((await colaborador().detalhe({ id })).status).toBe("liberada");
    // Mesmo que a maquete esteja em leitura (estado antigo), a importação não anda nem é confirmada.
    await banco.pg.exec(`UPDATE maquetes_3d SET status = 'em_leitura' WHERE id = ${id}`);
    const antes = (await banco.pg.query<{ importacao: string }>(`SELECT importacao FROM maquetes_3d WHERE id = $1`, [id])).rows[0].importacao;
    await expect(colaborador().avancarImportacao({ id })).rejects.toThrow("Nesta situação não é possível importar");
    await expect(admin().confirmarIAImportacao({ id })).rejects.toThrow("Nesta situação não é possível importar");
    await expect(colaborador().pularIAImportacao({ id })).rejects.toThrow("Nesta situação não é possível importar");
    expect((await banco.pg.query<{ importacao: string }>(`SELECT importacao FROM maquetes_3d WHERE id = $1`, [id])).rows[0].importacao).toBe(antes);
    await colaborador().descartarImportacao({ id });
    expect((await colaborador().detalhe({ id })).importacao).toBeNull();
  });
});

describe("QA S-03/S-05 — conversão da resposta da IA (funções puras)", () => {
  it("achado 8 (Q12): plantasDaIA nunca lança, qualquer que seja a resposta", () => {
    const casos: unknown[] = [null, undefined, "texto", 42, [], { plantas: "x" }, { plantas: [{}] }, { plantas: [null, 3] }, { plantas: [{ ...PLANTA, paredes: "x", comodos: [{ nome: 5, pontos: [] }] }] }];
    for (const c of casos) expect(() => plantasDaIA(c, true)).not.toThrow();
    expect(plantasDaIA({ plantas: [{}] }, true)).toEqual([]);
    expect(lerRespostaPrancha({ plantas: "x" }, true)).toMatchObject({ plantas: [], motivo: "A IA devolveu uma resposta fora do formato esperado." });
  });

  it("achado 9: filtros de geometria — abertura sem parede, parede de comprimento zero e escada sem contorno saem com pendência", () => {
    const [p] = plantasDaIA({ plantas: [{
      ...PLANTA,
      paredes: [...PLANTA.paredes, { id: "p9", ax: 1, ay: 1, bx: 1, by: 1, espessura: 0.15, externa: false, confirmada: true }],
      aberturas: [...PLANTA.aberturas, { id: "a9", paredeId: "p77", tipo: "janela", posicao: 1, largura: 1, altura: 1.2, peitoril: 1, entradaPrincipal: false, confirmada: true }],
      escadas: [{ id: "e1", tipo: "reta", pontos: [{ x: 0, y: 0 }], inicio: { x: 0, y: 0 }, fim: { x: 1, y: 0 }, percurso: [], largura: 0.9, degraus: 16, confirmada: true }],
    }] }, false);
    expect(p.paredes.map(w => w.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(p.aberturas.map(a => a.id)).toEqual(["a1"]);
    expect(p.escadas).toEqual([]);
    expect(p.pendencias.join("\n")).toMatch(/1 parede\(s\) de comprimento quase zero[\s\S]*1 abertura\(s\) numa parede que não existe[\s\S]*1 escada\(s\) sem contorno válido/);
    expect(sobreposicao(ret, ret)).toBe(1);
    expect(sobreposicao(ret, ret.map(q => ({ x: q.x + 100, y: q.y })))).toBe(0);
    expect(AREA_MIN_M2).toBeGreaterThan(0);
  });

  it("achado 5 (Q11): prancha vetorial com logotipo JPEG pequeno não manda o logotipo como 'a página'", () => {
    const lados = ladosDoJpeg(JPEG)!;
    const linhas = Array.from({ length: 30 }, (_, i) => `${100 + i * 20} 100 m ${100 + i * 20} 900 l S`).join(" ");
    const conteudo = `${linhas} q 60 0 0 40 1600 20 cm /Logo Do Q`;
    const bufs: Buffer[] = []; const offs: number[] = []; let tam = 0;
    const por = (b: Buffer | string) => { const x = typeof b === "string" ? Buffer.from(b, "latin1") : b; bufs.push(x); tam += x.length; };
    por("%PDF-1.4\n");
    const obj = (n: number, corpo: string, fluxo?: Buffer) => { offs[n] = tam; if (fluxo) { por(`${n} 0 obj\n${corpo}\nstream\n`); por(fluxo); por("\nendstream\nendobj\n"); } else por(`${n} 0 obj\n${corpo}\nendobj\n`); };
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1684 1191] /Resources << /XObject << /Logo 4 0 R >> >> /Contents 5 0 R >>`);
    obj(4, `<< /Type /XObject /Subtype /Image /Width ${lados.largura} /Height ${lados.altura} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${JPEG.length} >>`, JPEG);
    obj(5, `<< /Length ${conteudo.length} >>`, Buffer.from(conteudo, "latin1"));
    const xref = tam;
    por(`xref\n0 6\n0000000000 65535 f \n${offs.slice(1).map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const pdf = Buffer.concat(bufs);
    // O logotipo cobre 60 × 40 pt de 1684 × 1191 pt: ~0,1% da página.
    const r = anexoDaPagina(pdf, "planta-com-logo.pdf", 1, 1, (60 * 40) / (1684 * 1191));
    expect(r.envio).toBe("pdf_original");
    expect(Buffer.from((r.anexo as { base64: string }).base64, "base64").equals(pdf)).toBe(true);
    // Sem a cobertura medida, também não arrisca.
    expect(anexoDaPagina(pdf, "planta-com-logo.pdf", 1, 1).envio).toBe("pdf_original");
  });
});

describe("QA S-03/S-05 — migração 0121 (achado 7)", () => {
  it("com a 0121 aplicada, listar, detalhe e o link público funcionam; todas as colunas do schema existem nas migrações", async () => {
    await preparar(await criarBanco());
    try {
      const id = await pedido([VET]);
      expect(await colaborador().listar({})).toHaveLength(1);
      expect((await colaborador().detalhe({ id })).id).toBe(id);
      await expect(appRouter.createCaller({ user: null, req: {}, res: {} } as never).maquetePublica.porToken({ token: "x".repeat(32) })).rejects.toThrow("não encontrada");
      const cols = (await banco.pg.query<{ c: string }>(`SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'maquetes_3d'`)).rows.map(r => r.c);
      const doSchema = Object.values(getTableColumns(maquetes3d)).map(c => c.name);
      expect(doSchema.filter(c => !cols.includes(c))).toEqual([]);
      expect(doSchema).toEqual(expect.arrayContaining(["importacao", "ia_pranchas_lidas"]));
      // Idempotente: rodar de novo não falha nem duplica nada.
      await banco.pg.exec(readFileSync(new URL("../drizzle/0121_maquete_3d_revisoes.sql", import.meta.url), "utf8"));
      expect(await contador(id)).toBe(0);
    } finally { definirDependencias(); await banco.pg.close(); }
  });

  it("sem a 0121 a coluna nova falta (por isso ela é aplicada ANTES de publicar o código)", async () => {
    const b = await criarBanco(MIGRACOES.filter(m => !m.startsWith("0121")));
    const cols = (await b.pg.query<{ c: string }>(`SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'maquetes_3d'`)).rows.map(r => r.c);
    expect(cols).not.toContain("importacao");
    expect(cols).not.toContain("ia_pranchas_lidas");
    await b.pg.close();
  });
});

// ── QA rodada 2 (16/11): achados novos N1–N7. Cada teste é a versão invertida do adversarial do QA. ──
describe("QA S-03/S-05 rodada 2 — funções puras", () => {
  it("N2: erros reais do SDK viram mensagens amigáveis (nunca '429 {}' nem 'Request timed out.') e o 'não cobrado' vem da classe/status", () => {
    const h = new Headers();
    const casos: [unknown, string, boolean][] = [
      [new APIConnectionTimeoutError(), "passou do tempo limite", false],
      [new APIConnectionError({ message: "Connection error." }), "Não foi possível falar com a IA", false],
      [APIError.generate(429, {}, undefined, h), "Limite de uso da IA atingido", true],
      [APIError.generate(401, {}, undefined, h), "Chave da IA inválida ou revogada", true],
      [APIError.generate(403, {}, undefined, h), "não tem permissão", true],
      [APIError.generate(529, {}, undefined, h), "sobrecarregada", true],
      [APIError.generate(500, {}, undefined, h), "fora do ar", true],
      [APIError.generate(400, { type: "error", error: { type: "invalid_request_error", message: `PDF grande demais ${CHAVE}` } }, undefined, h), "não aceitou o pedido deste passo (código 400)", false],
    ];
    for (const [e, texto, gratis] of casos) {
      expect((e as Error).name).toBe("Error"); // o SDK não preenche `name`: por isso o código não olha para ele
      const m = erroSeguro(e);
      expect(m).toContain(texto);
      expect(m).not.toMatch(/^\d{3} \{|Request timed out|SEGREDO/);
      expect(naoCobrado(e)).toBe(gratis);
    }
    expect(tipoDoErroIA(new Error("qualquer"))).toBeNull();
  });

  it("N4: closet dentro da suíte e cozinha dentro de 'Sala/Cozinha' ficam (com pendência 'confira'); o mesmo cômodo repetido sai", () => {
    const r = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    const comodos = [
      { id: "c1", nome: "Suíte", funcao: "suite", pontos: r(0, 0, 4, 4), areaInformada: 16, confirmada: true },
      { id: "c2", nome: "Closet", funcao: "closet", pontos: r(0.2, 0.2, 1.8, 1.8), areaInformada: 2.56, confirmada: true },
      { id: "c3", nome: "Sala/Cozinha", funcao: "sala", pontos: r(5, 0, 11, 5), areaInformada: 30, confirmada: true },
      { id: "c4", nome: "Cozinha", funcao: "cozinha", pontos: r(8, 0, 11, 3), areaInformada: 9, confirmada: true },
      { id: "c5", nome: "SUÍTE", funcao: "quarto", pontos: r(0.1, 0, 4, 4), areaInformada: 16, confirmada: true }, // a suíte de novo
      { id: "c6", nome: "Dormitório", funcao: "suite", pontos: r(0, 0.1, 4, 4), areaInformada: null, confirmada: true }, // a suíte de novo (mesma função)
    ];
    const [p] = plantasDaIA({ plantas: [{ ...PLANTA, paredes: [], aberturas: [], comodos }] }, false);
    expect(p.comodos.map(c => c.nome)).toEqual(["Suíte", "Closet", "Sala/Cozinha", "Cozinha"]);
    const t = p.pendencias.join("\n");
    expect(t).toContain('"Closet" lido pela IA fica dentro de "Suíte"');
    expect(t).toContain('"Cozinha" lido pela IA fica dentro de "Sala/Cozinha"');
    expect(t).toContain('"SUÍTE" lido pela IA repete "Suíte"');
    expect(t).toContain('"Dormitório" lido pela IA repete "Suíte"');
    // Áreas parecidas mas funções e nomes diferentes (varanda colada à sala, desenhada por cima): ficam as duas.
    expect(comodoRepetido({ nome: "Sala", funcao: "sala", pontos: r(0, 0, 4, 4) }, { nome: "Varanda", funcao: "varanda", pontos: r(0, 0, 4, 3.8) })).toBe(false);
  });

  it("N6: 'Continuar leitura (depois de cadastrar a chave)' só aparece quando o que falta é a chave", () => {
    expect(rotuloContinuarLeitura("aguardando", "chave")).toBe("Continuar leitura (depois de cadastrar a chave)");
    expect(rotuloContinuarLeitura("aguardando", "teto")).toBe("Continuar leitura");
    expect(rotuloContinuarLeitura("aguardando", "confirmacao")).toBe("Continuar leitura");
    expect(rotuloContinuarLeitura("erro", null)).toBe("Tentar de novo este passo");
    expect(rotuloContinuarLeitura("pendente", null)).toBe("Continuar leitura");
    // A tela usa a função (o texto fixo antigo não volta).
    const tela = readFileSync(new URL("../client/src/pages/admin/AdminMaquete3D.tsx", import.meta.url), "utf8");
    expect(tela).toContain("rotuloContinuarLeitura(d.progresso.proximo?.estado");
    expect(tela).not.toContain("(depois de cadastrar a chave)");
  });

  it("N5: planta em centímetros (ou fora de escala) nunca passa em silêncio: área desenhada × escrita e tamanho do pavimento", () => {
    const vezes = (k: number) => ({
      ...PLANTA,
      paredes: PLANTA.paredes.map(w => ({ ...w, ax: w.ax * k, ay: w.ay * k, bx: w.bx * k, by: w.by * k })),
      aberturas: [],
      comodos: PLANTA.comodos.map(c => ({ ...c, pontos: c.pontos.map(q => ({ x: q.x * k, y: q.y * k })) })),
    });
    // ×50 (0..400, abaixo do limite de coordenada): área desenhada 120 000 m² contra 48 m² escritos.
    const [p50] = plantasDaIA({ plantas: [vezes(50)] }, false);
    expect(p50.pendencias[0]).toMatch(/não batem com as áreas escritas na prancha: os cômodos desenhados somam 120\.000 m² e as áreas escritas, 48 m²\. Acerte a escala/);
    // Sem área escrita, o tamanho do pavimento acusa: ×12 vira uma casa de 72 × 96 m.
    const sem = (k: number) => ({ ...vezes(k), comodos: vezes(k).comodos.map(c => ({ ...c, areaInformada: null })) });
    expect(plantasDaIA({ plantas: [sem(12)] }, false)[0].pendencias[0]).toMatch(/tem 96 m de lado, grande demais para um pavimento/);
    // Centímetros com área escrita: o texto diz a provável unidade.
    expect(medidaSuspeita([{ pontos: ret.map(q => ({ x: q.x * 100, y: q.y * 100 })), areaInformada: 48 }], 600, 800)).toContain("parece que as medidas vieram em centímetros");
    // Planta certa: nenhuma pendência de escala.
    expect(plantasDaIA({ plantas: [PLANTA] }, false)[0].pendencias.join(" ")).not.toMatch(/não batem|grande demais/);
    expect(medidaSuspeita([{ pontos: ret, areaInformada: 48 }], 6, 8)).toBeNull();
  });
});

describe("QA S-03/S-05 rodada 2 — leitura e importação (banco em memória)", () => {
  beforeEach(async () => { await preparar(await criarBanco()); });
  afterEach(async () => { definirDependencias(); await banco.pg.close(); });

  /** Grava o passo da IA como "executando" com a reserva em `reservadoEm` (simula outra instância no meio da chamada). */
  async function reservaGravada(id: number, reservadoEm: string) {
    const estado = lerEstadoLeitura((await banco.pg.query<{ leitura: string }>(`SELECT leitura FROM maquetes_3d WHERE id = $1`, [id])).rows[0].leitura);
    Object.assign(estado.passos.find(p => p.tipo === "prancha_ia")!, { estado: "executando", reservadoEm });
    estado.confirmacaoIA!.usadas = 1;
    await banco.pg.query(`UPDATE maquetes_3d SET leitura = $1, ia_pranchas_lidas = 1 WHERE id = $2`, [JSON.stringify(estado), id]);
  }

  it("N3: reserva com data à frente do relógio (instância adiantada) não prende o passo; dentro da tolerância, segue em curso", async () => {
    await configurar({ motor: "hibrido" });
    credencial = PAINEL;
    const id = await pedido([IMG]);
    await colaborador().iniciarLeitura({ id });
    await ler(id);
    await admin().confirmarIA({ id });
    await reservaGravada(id, new Date(relogio.getTime() + 3_000).toISOString());
    expect((await colaborador().avancarLeitura({ id })).aguardando?.motivo).toBe("executando");
    await reservaGravada(id, "2099-01-01T00:00:00.000Z");
    const r = await colaborador().avancarLeitura({ id });
    expect(r.aguardando).toBeNull();
    expect(r.erro).toContain("foi interrompida antes de terminar");
    expect(r.erro).not.toContain("página foi fechada");
    expect(pedidos).toHaveLength(0);
  });

  it("N1: com um passo da leitura sendo lido pela IA, confirmar, seguir sem a IA e ler de novo dão CONFLICT; a resposta paga fica", async () => {
    await configurar({ motor: "hibrido" });
    credencial = PAINEL;
    const id = await pedido([IMG]);
    await colaborador().iniciarLeitura({ id });
    expect((await ler(id)).aguardando?.motivo).toBe("confirmacao");
    await admin().confirmarIA({ id });
    atrasoIA = 400;
    const emCurso = colaborador().avancarLeitura({ id });
    await new Promise(r => setTimeout(r, 80));
    expect((await admin().detalhe({ id })).ia.emCurso).toBe(true);
    for (const tentativa of [() => colaborador().pularIA({ id }), () => admin().confirmarIA({ id }), () => admin().confirmarIA({ id, alemDoTeto: true }), () => colaborador().iniciarLeitura({ id })]) {
      await expect(tentativa()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("Um passo está sendo lido pela IA agora; aguarde terminar") });
    }
    await emCurso;
    const d = await admin().detalhe({ id });
    expect(d.ia.emCurso).toBe(false);
    expect(d.passos.find(p => p.tipo === "prancha_ia")).toMatchObject({ estado: "feito", motor: "ia", erro: null });
    expect(await ler(id)).toMatchObject({ status: "em_revisao", erro: null });
    expect(pedidos).toHaveLength(1);
    expect(await contador(id)).toBe(1);
  });

  it("N1: com um passo da importação sendo lido pela IA, confirmar, seguir sem a IA, descartar e importar outro dão CONFLICT", async () => {
    await configurar({ motor: "hibrido" });
    credencial = PAINEL;
    const id = await pedido([IMG]);
    expect((await importar(id, 0)).aguardando?.motivo).toBe("confirmacao");
    await admin().confirmarIAImportacao({ id });
    atrasoIA = 400;
    const emCurso = colaborador().avancarImportacao({ id });
    await new Promise(r => setTimeout(r, 80));
    expect((await admin().detalhe({ id })).importacao?.ia.emCurso).toBe(true);
    for (const tentativa of [() => colaborador().pularIAImportacao({ id }), () => admin().confirmarIAImportacao({ id }), () => colaborador().descartarImportacao({ id }), () => colaborador().importarPlanta({ id, doc: 0 })]) {
      await expect(tentativa()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("sendo lido pela IA agora") });
    }
    await emCurso;
    const imp = (await admin().detalhe({ id })).importacao!;
    expect(imp.ia.emCurso).toBe(false);
    expect(imp.passos.find(p => p.tipo === "prancha_ia")).toMatchObject({ estado: "feito", motor: "ia" });
    expect(pedidos).toHaveLength(1);
    expect(await contador(id)).toBe(1);
  });

  it("N5: planta da IA em centímetros chega à revisão com pendência em aberto, que impede validar", async () => {
    await configurar({ motor: "hibrido" });
    credencial = PAINEL;
    const id = await pedido([IMG]);
    await colaborador().iniciarLeitura({ id });
    await ler(id);
    await admin().confirmarIA({ id });
    const k = 50;
    respostas = [{ plantas: [{ ...PLANTA, aberturas: [], paredes: PLANTA.paredes.map(w => ({ ...w, ax: w.ax * k, ay: w.ay * k, bx: w.bx * k, by: w.by * k })), comodos: PLANTA.comodos.map(c => ({ ...c, pontos: c.pontos.map(q => ({ x: q.x * k, y: q.y * k })) })) }], pendencias: [] }];
    expect(await ler(id)).toMatchObject({ status: "em_revisao", erro: null });
    const d = await admin().detalhe({ id });
    const pend = d.modelo!.pendencias.find(p => p.descricao.includes("não batem com as áreas escritas"));
    expect(pend?.resolvida).toBe(false);
    await expect(admin().validar({ id })).rejects.toThrow("pendências em aberto");
  });

  it("N7: sem ~10 s sobrando do orçamento, a IA não é chamada nem reservada (não conta); a tela chama de novo e lê", async () => {
    await configurar({ motor: "hibrido" });
    credencial = PAINEL;
    const id = await pedido([IMG]);
    await colaborador().iniciarLeitura({ id });
    expect((await ler(id)).aguardando?.motivo).toBe("confirmacao");
    await admin().confirmarIA({ id });
    // Baixar o PDF "demora" 45 s (relógio do processo adiantado dentro do pedido).
    const real = Date.now.bind(Date);
    let desvio = 0, lento = true;
    const espiao = vi.spyOn(Date, "now").mockImplementation(() => real() + desvio);
    definirDependencias({ lerPdf: async d => { if (lento) desvio += 45_000; return pdfs[d.nome]; } });
    try {
      const r = await colaborador().avancarLeitura({ id });
      expect(r).toMatchObject({ erro: null, aguardando: null });
      expect(r.proximo).toMatchObject({ tipo: "prancha_ia", estado: "pendente" });
      expect(pedidos).toHaveLength(0);
      expect(await contador(id)).toBe(0);
      expect((await admin().detalhe({ id })).ia).toMatchObject({ usadas: 0, emCurso: false });
      // Mais rápido na vez seguinte: lê normalmente, com o prazo da IA de pelo menos 10 s.
      lento = false;
      expect(await ler(id)).toMatchObject({ status: "em_revisao", erro: null });
      expect(pedidos).toHaveLength(1);
      expect(pedidos[0].prazoMs!).toBeGreaterThanOrEqual(8_000);
      expect(await contador(id)).toBe(1);
    } finally { espiao.mockRestore(); }
  });

  it("N7: devolver o controle seguidas vezes vira erro claro (sem laço na tela e sem cobrança)", async () => {
    await configurar({ motor: "hibrido" });
    credencial = PAINEL;
    const id = await pedido([IMG]);
    await colaborador().iniciarLeitura({ id });
    await ler(id);
    await admin().confirmarIA({ id });
    const real = Date.now.bind(Date);
    let desvio = 0;
    const espiao = vi.spyOn(Date, "now").mockImplementation(() => real() + desvio);
    definirDependencias({ lerPdf: async d => { desvio += 45_000; return pdfs[d.nome]; } });
    try {
      const r = await ler(id);
      expect(r.erro).toContain("levou tempo demais");
      expect(r.erro).toContain("nada foi cobrado");
      expect(pedidos).toHaveLength(0);
      expect(await contador(id)).toBe(0);
    } finally { espiao.mockRestore(); }
  });

  it("N1 (segunda barreira): se a leitura muda durante a chamada sem tocar no passo, o resultado pago é aplicado sobre o estado atual", async () => {
    await configurar({ motor: "hibrido" });
    credencial = PAINEL;
    const id = await pedido([IMG]);
    await colaborador().iniciarLeitura({ id });
    await ler(id);
    await admin().confirmarIA({ id });
    // Durante a chamada, outra gravação muda a coluna (aqui, direto no banco: um aviso a mais).
    definirDependencias({
      ia: async p => {
        pedidos.push(p);
        const e = lerEstadoLeitura((await banco.pg.query<{ leitura: string }>(`SELECT leitura FROM maquetes_3d WHERE id = $1`, [id])).rows[0].leitura);
        e.foraDoLimiteIA = ["aviso gravado durante a chamada"];
        await banco.pg.query(`UPDATE maquetes_3d SET leitura = $1 WHERE id = $2`, [JSON.stringify(e), id]);
        return { json: RESPOSTA_IA, entrada: 1000, saida: 500, modelo: "claude-sonnet-5-5" };
      },
    });
    const r = await colaborador().avancarLeitura({ id });
    expect(r.erro).toBeNull();
    const e = lerEstadoLeitura((await banco.pg.query<{ leitura: string }>(`SELECT leitura FROM maquetes_3d WHERE id = $1`, [id])).rows[0].leitura);
    expect(e.foraDoLimiteIA).toEqual(["aviso gravado durante a chamada"]); // a mudança do outro não se perde
    expect(e.passos.find(p => p.tipo === "prancha_ia")).toMatchObject({ estado: "feito", motor: "ia", reservadoEm: null });
    expect(e.tokensEntrada).toBe(1000);
    expect(await ler(id)).toMatchObject({ status: "em_revisao", erro: null });
    expect(pedidos).toHaveLength(1);
    expect(await contador(id)).toBe(1);
  });
});
