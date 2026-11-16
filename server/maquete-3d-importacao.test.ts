// Maquete 3D (EPIC-024 S-05) — "Importar planta arquitetônica (PDF)" na revisão e histórico das plantas (0121).
// Banco em memória (PGlite) e IA simulada; nada sai para a rede nem toca banco real.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import * as schema from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { definirDependencias, type CredencialIA, type PedidoIA } from "./maquete-3d/base.js";
import { ladosDoJpeg, pdfDeUmJpeg } from "./maquete-3d/pdf-pagina.js";
import { DestinoInvalido, aplicarCandidata } from "../shared/maquete-3d/importacao.js";
import { modeloSchema, type ModeloMaquete } from "../shared/maquete-3d/modelo.js";
import { casaPadrao } from "../shared/maquete-3d/padrao.js";
import { appRouter } from "./routers.js";

const VETORIAL = readFileSync(new URL("./fixtures/maquete-3d/sobrado.pdf", import.meta.url));
const JPEG = readFileSync(new URL("../client/public/casa-compacta-linha-smart.jpg", import.meta.url));
const RASTER = pdfDeUmJpeg({ jpeg: JPEG, ...ladosDoJpeg(JPEG)! });
const MIGRACAO = readFileSync(new URL("../drizzle/0121_maquete_3d_revisoes.sql", import.meta.url), "utf8");

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
  for (const arquivo of ["0111_maquete_3d.sql", "0112_maquete_3d_comercial.sql", "0113_maquete_3d_pagamento.sql", "0114_maquete_3d_email.sql", "0115_maquete_3d_lead_arquivos.sql"]) {
    await pg.exec(readFileSync(new URL(`../drizzle/${arquivo}`, import.meta.url), "utf8"));
  }
  await pg.exec(MIGRACAO);
  await pg.exec(MIGRACAO); // idempotente
  return { pg, db: drizzle(pg) };
}

let banco: Awaited<ReturnType<typeof criarBanco>>;
let pedidos: PedidoIA[];
let credencial: CredencialIA | null;
const caller = (id: number, role: string, permissions = "[]") => appRouter.createCaller({ user: { id, role, permissions, active: true, name: "x" }, req: {}, res: {} } as never);
const admin = () => caller(1, "admin").maquete3d;
const colaborador = () => caller(2, "colaborador", JSON.stringify(["maquete3d"])).maquete3d;
const semModulo = () => caller(3, "colaborador", JSON.stringify(["crm"])).maquete3d;
const VET = { fonte: "projeto" as const, id: 1, nome: "projeto-arquiteto.pdf" };
const IMG = { fonte: "projeto" as const, id: 2, nome: "escaneada.pdf" };
const CASA = { frente: 8, fundo: 12, quartos: 2, pavimentos: 1 as const, garagem: true };
const RESPOSTA_IA = {
  plantas: [{
    titulo: "PLANTA BAIXA", escala: 50, escalaLegivel: true, temCotas: true,
    paredes: [
      { id: "p1", ax: 0, ay: 0, bx: 7, by: 0, espessura: 0.15, externa: true, confirmada: true },
      { id: "p2", ax: 7, ay: 0, bx: 7, by: 9, espessura: 0.15, externa: true, confirmada: true },
      { id: "p3", ax: 7, ay: 9, bx: 0, by: 9, espessura: 0.15, externa: true, confirmada: true },
      { id: "p4", ax: 0, ay: 9, bx: 0, by: 0, espessura: 0.15, externa: true, confirmada: true },
    ],
    aberturas: [{ id: "a1", paredeId: "p3", tipo: "porta", posicao: 3, largura: 0.9, altura: 2.1, peitoril: 0, entradaPrincipal: true, confirmada: true }],
    comodos: [{ id: "c1", nome: "Sala", funcao: "sala", pontos: [{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 9 }, { x: 0, y: 9 }], areaInformada: 63, confirmada: true }],
    escadas: [], pendencias: [],
  }],
  pendencias: [],
};

/** Pedido liberado com a casa padrão no meio de um terreno (uma posição, girada). */
async function pedidoComCasaPadrao() {
  const { id } = await colaborador().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "acima_150_ou_sobrado", documentos: [VET] });
  await admin().liberar({ id, nota: "PIX recebido em 16/11" });
  await colaborador().aplicarTipo({ id, tipo: "casa", casa: CASA });
  const d = await colaborador().detalhe({ id });
  const modelo: ModeloMaquete = { ...d.modelo!, implantacao: modeloSchema.parse({ tipo: "casa", implantacao: {
    terreno: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }],
    posicoes: [{ id: "i1", edificacaoId: "padrao", nome: "Casa 1", x: 12.5, y: 20, rotacao: 90 }],
  } }).implantacao };
  await colaborador().salvarModelo({ id, versao: d.modeloVersao, modelo });
  return id;
}
async function importarAteFim(id: number, entrada: { doc?: number; uploadId?: string; nome?: string } = { doc: 0 }) {
  let r = await colaborador().importarPlanta({ id, ...entrada });
  for (let i = 0; i < 20 && !r.pronta && !r.erro && !r.aguardando; i++) r = await colaborador().avancarImportacao({ id });
  return r;
}

describe("migração 0121", () => {
  it("é aditiva e idempotente: cria a tabela de revisões e a coluna da importação, duas vezes sem erro", async () => {
    const b = await criarBanco();
    await b.pg.exec(MIGRACAO);
    const col = await b.pg.query<{ c: number }>(`SELECT count(*)::int AS c FROM information_schema.columns WHERE table_name = 'maquetes_3d' AND column_name = 'importacao'`);
    const tab = await b.pg.query<{ c: number }>(`SELECT count(*)::int AS c FROM information_schema.columns WHERE table_name = 'maquete_3d_revisoes'`);
    expect(col.rows[0].c).toBe(1);
    expect(tab.rows[0].c).toBe(9);
    await expect(b.pg.exec(`INSERT INTO maquete_3d_revisoes (maquete_id, versao, modelo, origem) VALUES (999, 1, '{}', 'edicao')`)).rejects.toThrow(); // chave estrangeira
    await b.pg.close();
  });
});

describe("importar planta arquitetônica na revisão", () => {
  beforeEach(async () => {
    banco = await criarBanco();
    vi.mocked(getDb).mockReturnValue(banco.db as never);
    await banco.pg.exec(`
      INSERT INTO users ("openId", name, role, active) VALUES ('admin', 'Admin', 'admin', true), ('colab', 'Colaboradora', 'colaborador', true), ('outro', 'Sem módulo', 'colaborador', true);
      INSERT INTO operational_projects (name, client_name, client_phone, engineer, value) VALUES ('Casa Silva', 'Ana Silva', '99999', 'Eng', 1000);
      INSERT INTO project_documents (project_id, item_id, kind, original_name, canonical_name, mime, size, version, drive_file_id, status)
        VALUES (1, 'arq', 'pdf', 'projeto-arquiteto.pdf', 'projeto-arquiteto.pdf', 'application/pdf', 10, 1, 'd1', 'active'),
               (1, 'arq2', 'pdf', 'escaneada.pdf', 'escaneada.pdf', 'application/pdf', 10, 1, 'd2', 'active');
    `);
    pedidos = []; credencial = null;
    definirDependencias({
      agora: () => new Date("2026-11-16T15:00:00Z"),
      lerPdf: async d => (d.nome.startsWith("escaneada") ? RASTER : VETORIAL),
      credencialIA: async () => credencial,
      ia: async p => { pedidos.push(p); return { json: RESPOSTA_IA, entrada: 3000, saida: 800, modelo: "claude-sonnet-5-5" }; },
    });
  });
  afterEach(async () => { definirDependencias(); await banco.pg.close(); });

  it("lê o PDF numa candidata sem tocar no modelo; aplicar troca só a casa padrão e mantém as posições; trava de versão", async () => {
    const id = await pedidoComCasaPadrao();
    const antes = await colaborador().detalhe({ id });
    expect(antes.modelo!.edificacoes.map(e => e.id)).toEqual(["padrao"]);

    const r = await importarAteFim(id);
    expect(r).toMatchObject({ pronta: true, erro: null, aguardando: null });
    let d = await colaborador().detalhe({ id });
    // O modelo em uso e a versão não mudaram; a candidata tem os dois pavimentos do sobrado, com o fundo de cada um.
    expect(d.modelo).toEqual(antes.modelo);
    expect(d.modeloVersao).toBe(antes.modeloVersao);
    expect(d.status).toBe("em_revisao");
    const imp = d.importacao!;
    expect(imp.documento).toEqual(VET);
    expect(imp.candidata!.edificacoes[0].pavimentos.map(p => p.nome)).toEqual(["Térreo", "Pavimento superior"]);
    expect(imp.pranchas.map(p => [p.pavimentoId, p.doc, p.pagina])).toEqual([["ed1-pv1", 0, 1], ["ed1-pv2", 0, 2]]);
    expect(imp.passos.filter(p => p.tipo === "prancha").every(p => p.motor === "geometrico")).toBe(true);
    expect(pedidos).toHaveLength(0);

    // Edição da candidata antes de aplicar.
    const editada = structuredClone(imp.candidata!);
    editada.edificacoes[0].pavimentos[0].comodos[0].nome = "Sala de estar";
    await colaborador().salvarCandidata({ id, modelo: editada });

    // Versão velha: conflito, e nada muda (a candidata continua lá).
    await expect(colaborador().aplicarImportacao({ id, versao: d.modeloVersao - 1, destino: { tipo: "padrao" } })).rejects.toThrow("alterada por outra pessoa");
    expect((await colaborador().detalhe({ id })).importacao).not.toBeNull();

    const ap = await colaborador().aplicarImportacao({ id, versao: d.modeloVersao, destino: { tipo: "padrao" }, motivo: "Projeto do arquiteto" });
    expect(ap).toMatchObject({ versao: d.modeloVersao + 1, saiuDoAr: false });
    d = await colaborador().detalhe({ id });
    expect(d.importacao).toBeNull();
    expect(d.status).toBe("em_revisao");
    const [ed] = d.modelo!.edificacoes;
    expect(ed).toMatchObject({ id: "imp1", nome: "Projeto importado — projeto-arquiteto.pdf" });
    expect(ed.pavimentos.map(p => p.id)).toEqual(["imp1-pv1", "imp1-pv2"]);
    expect(ed.pavimentos[0].comodos[0].nome).toBe("Sala de estar");
    expect(ed.pavimentos[0].escadas[0].destinoPavimentoId).toBe("imp1-pv2");
    // A posição no terreno é a mesma da casa padrão, agora com a planta importada.
    expect(d.modelo!.implantacao!.posicoes).toEqual([{ id: "i1", edificacaoId: "imp1", nome: "Casa 1", x: 12.5, y: 20, rotacao: 90, unidade: null }]);
    expect(d.modelo!.pendencias.some(p => p.descricao.startsWith("Planta importada:"))).toBe(true);
    // A prancha original do PDF importado fica ao fundo dos pavimentos novos.
    expect(d.pranchas.filter(p => p.pavimentoId.startsWith("imp1")).map(p => [p.pavimentoId, p.doc, p.pagina])).toEqual([["imp1-pv1", 0, 1], ["imp1-pv2", 0, 2]]);

    // Histórico: troca de tipo, edição e a importação (com o PDF de origem e o motivo).
    const h = await colaborador().revisoes({ id });
    expect(h.map(x => [x.versao, x.origem])).toEqual([[3, "importacao_pdf"], [2, "edicao"], [1, "tipo_padrao"]]);
    expect(h[0]).toMatchObject({ documento: "projeto-arquiteto.pdf", motivo: "Projeto do arquiteto", autor: "Colaboradora" });
  });

  it("aplicar num pavimento substitui só aquele pavimento (mantém id, nível e o resto da construção); restaurar volta e vira revisão nova", async () => {
    const id = await pedidoComCasaPadrao();
    await importarAteFim(id);
    let d = await colaborador().detalhe({ id });
    await colaborador().aplicarImportacao({ id, versao: d.modeloVersao, destino: { tipo: "padrao" } });
    d = await colaborador().detalhe({ id });
    const [terreo, superior] = d.modelo!.edificacoes[0].pavimentos;

    // Segunda importação (outro envio do mesmo projeto): só o pavimento superior recebe o térreo da candidata.
    await importarAteFim(id);
    const cand = (await colaborador().detalhe({ id })).importacao!.candidata!;
    await colaborador().aplicarImportacao({ id, versao: d.modeloVersao, destino: { tipo: "pavimento", edificacaoId: "imp1", pavimentoId: superior.id, pavimentoCandidatoId: "ed1-pv1" } });
    d = await colaborador().detalhe({ id });
    const [t2, s2] = d.modelo!.edificacoes[0].pavimentos;
    expect(t2).toEqual(terreo);
    expect(s2).toMatchObject({ id: superior.id, nome: superior.nome, nivel: superior.nivel, peDireito: superior.peDireito });
    expect(s2.comodos.map(c => c.nome)).toEqual(cand.edificacoes[0].pavimentos[0].comodos.map(c => c.nome));
    expect(s2.escadas.every(e => e.destinoPavimentoId === null)).toBe(true); // não há pavimento acima do superior
    await expect(colaborador().aplicarImportacao({ id, versao: d.modeloVersao, destino: { tipo: "padrao" } })).rejects.toThrow("Não há planta importada");

    // Restaura a planta da troca de tipo (casa padrão): o modelo volta e a restauração entra no histórico.
    const h = await colaborador().revisoes({ id });
    const tipo = h.find(x => x.origem === "tipo_padrao")!;
    expect(await colaborador().restaurarRevisao({ id, revisaoId: tipo.id, versao: d.modeloVersao })).toMatchObject({ versao: d.modeloVersao + 1, saiuDoAr: false });
    d = await colaborador().detalhe({ id });
    expect(d.modelo!.edificacoes.map(e => e.id)).toEqual(["padrao"]);
    expect((await colaborador().revisoes({ id }))[0]).toMatchObject({ origem: "restauracao", motivo: `Restaurada a versão ${tipo.versao}` });
    await expect(colaborador().restaurarRevisao({ id, revisaoId: tipo.id, versao: 0 })).rejects.toThrow("alterada por outra pessoa");
    await expect(colaborador().restaurarRevisao({ id, revisaoId: 9999, versao: d.modeloVersao })).rejects.toThrow("Versão não encontrada");
  });

  it("maquete publicada: importar e aplicar só o admin; ao aplicar ela volta para revisão e o link sai do ar", async () => {
    const id = await pedidoComCasaPadrao();
    const publico = appRouter.createCaller({ user: null, req: {}, res: {} } as never).maquetePublica;
    let d = await colaborador().detalhe({ id });
    // A casa padrão sem pendências pode ser validada e publicada.
    const semImplantacao = { ...d.modelo!, implantacao: null };
    await colaborador().salvarModelo({ id, versao: d.modeloVersao, modelo: semImplantacao });
    await colaborador().validar({ id });
    await admin().publicar({ id });
    d = await colaborador().detalhe({ id });
    expect(d.status).toBe("publicada");
    await expect(colaborador().importarPlanta({ id, doc: 0 })).rejects.toThrow("Só o administrador");
    let r = await admin().importarPlanta({ id, doc: 0 });
    for (let i = 0; i < 10 && !r.pronta; i++) r = await admin().avancarImportacao({ id });
    // Enquanto a candidata não é aplicada, o link continua com a planta publicada.
    expect((await publico.porToken({ token: d.token })).modelo.edificacoes.map(e => e.id)).toEqual(["padrao"]);
    await expect(colaborador().aplicarImportacao({ id, versao: d.modeloVersao, destino: { tipo: "padrao" } })).rejects.toThrow("Só o administrador");
    expect(await admin().aplicarImportacao({ id, versao: d.modeloVersao, destino: { tipo: "padrao" } })).toMatchObject({ saiuDoAr: true });
    d = await colaborador().detalhe({ id });
    expect(d).toMatchObject({ status: "em_revisao", publicadoEm: null });
    await expect(publico.porToken({ token: d.token })).rejects.toThrow("não encontrada");
  });

  it("permissões: sem o módulo não entra; maquete aguardando pagamento ou recusada não importa", async () => {
    const { id } = await colaborador().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "terrea_ate_70", documentos: [VET] });
    await expect(semModulo().importarPlanta({ id, doc: 0 })).rejects.toThrow("Sem permissão");
    await expect(semModulo().revisoes({ id })).rejects.toThrow("Sem permissão");
    await expect(colaborador().importarPlanta({ id, doc: 0 })).rejects.toThrow("Nesta situação");
    await admin().liberar({ id, nota: "PIX recebido em 16/11" });
    await expect(colaborador().importarPlanta({ id })).rejects.toThrow("Envie o PDF da planta");
    await expect(colaborador().importarPlanta({ id, doc: 3 })).rejects.toThrow("não está na lista");
    // Liberada sem planta ainda: a importação vira a base do modelo.
    await importarAteFim(id);
    await colaborador().aplicarImportacao({ id, versao: 0, destino: { tipo: "padrao" } });
    const d = await colaborador().detalhe({ id });
    expect(d).toMatchObject({ status: "em_revisao", modeloVersao: 1 });
    expect(d.modelo!.edificacoes.map(e => e.id)).toEqual(["imp1"]);
  });

  it("PDF importado que é imagem segue o roteamento híbrido: confirmação (só desta importação) e IA só nessa prancha", async () => {
    credencial = { apiKey: "sk-ant-teste-0000", modelo: null, origem: "painel" };
    const { id } = await colaborador().criar({ origem: "projeto", alvoId: 1, tipo: "casa", faixaPreco: "terrea_ate_70", documentos: [VET, IMG] });
    await admin().liberar({ id, nota: "PIX recebido em 16/11" });
    const r = await importarAteFim(id, { doc: 1 });
    expect(r.aguardando).toMatchObject({ motivo: "confirmacao", pendentes: 1 });
    await expect(colaborador().confirmarIAImportacao({ id })).rejects.toThrow("Só o administrador");
    let s = await admin().confirmarIAImportacao({ id });
    for (let i = 0; i < 10 && !s.pronta && !s.erro; i++) s = await colaborador().avancarImportacao({ id });
    expect(s).toMatchObject({ pronta: true, erro: null });
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].anexos![0].tipo).toBe("imagem");
    const d = await colaborador().detalhe({ id });
    expect(d.modelo).toBeNull();
    expect(d.importacao!.passos.find(p => p.tipo === "prancha_ia")).toMatchObject({ motor: "ia", modelo: "claude-sonnet-5-5", tokens: { entrada: 3000, saida: 800 } });
    expect(d.importacao!.candidata!.edificacoes[0].pavimentos[0].comodos[0].nome).toBe("Sala");
    // A confirmação era só desta importação: a leitura principal pergunta de novo, e só lê depois do admin.
    await colaborador().descartarImportacao({ id });
    expect((await colaborador().detalhe({ id })).importacao).toBeNull();
    await colaborador().definirDocumentos({ id, documentos: [IMG] });
    await colaborador().iniciarLeitura({ id });
    let l = await colaborador().avancarLeitura({ id });
    for (let i = 0; i < 10 && l.proximo && !l.aguardando && !l.erro; i++) l = await colaborador().avancarLeitura({ id });
    expect(l).toMatchObject({ status: "em_leitura", aguardando: { motivo: "confirmacao" } });
    expect(pedidos).toHaveLength(1);
    await admin().confirmarIA({ id });
    for (let i = 0; i < 10 && l.proximo && !l.erro; i++) l = await colaborador().avancarLeitura({ id });
    expect(l).toMatchObject({ status: "em_revisao", aguardando: null });
    expect(pedidos).toHaveLength(2);
    expect((await colaborador().revisoes({ id })).map(x => x.origem)).toEqual(["leitura"]);
  });
});

describe("aplicarCandidata (função pura)", () => {
  const candidata = (): ModeloMaquete => modeloSchema.parse({
    tipo: "casa", pendencias: [{ id: "pd1", descricao: "Térreo: confira a porta" }, { id: "pd2", descricao: "Superior: confira a janela" }, { id: "pd3", descricao: "Pé-direito sem corte" }],
    edificacoes: [{ id: "ed1", nome: "Edificação", pavimentos: [{ id: "ed1-pv1", nome: "Térreo" }, { id: "ed1-pv2", nome: "Superior", nivel: 2.85 }] }],
  });
  it("sem construção padrão e com construção lida, exige escolher o pavimento", () => {
    const atual = modeloSchema.parse({ tipo: "casa", edificacoes: [{ id: "ed1", nome: "Lida", pavimentos: [{ id: "ed1-pv1", nome: "Térreo" }] }] });
    expect(() => aplicarCandidata(atual, candidata(), { tipo: "padrao" }, "imp1", "x.pdf")).toThrow(DestinoInvalido);
    expect(() => aplicarCandidata(atual, candidata(), { tipo: "pavimento", edificacaoId: "ed1", pavimentoId: "nao-existe" }, "imp1", "x.pdf")).toThrow("não existe mais");
  });
  it("num pavimento, leva só as pendências dele e as gerais; na construção padrão, todas; a outra construção fica igual", () => {
    const outra = { id: "ed9", nome: "Outra", pavimentos: [{ id: "ed9-pv1", nome: "Térreo" }] };
    const atual = modeloSchema.parse({ tipo: "casa", edificacoes: [casaPadrao(CASA), outra] });
    const r = aplicarCandidata(atual, candidata(), { tipo: "pavimento", edificacaoId: "padrao", pavimentoId: atual.edificacoes[0].pavimentos[0].id, pavimentoCandidatoId: "ed1-pv1" }, "imp1", "x.pdf");
    expect(r.modelo.pendencias.map(p => p.descricao)).toEqual(["Planta importada: Térreo: confira a porta", "Planta importada: Pé-direito sem corte"]);
    expect(r.modelo.edificacoes[1]).toEqual(atual.edificacoes[1]);
    const p = aplicarCandidata(atual, candidata(), { tipo: "padrao" }, "imp1", "x.pdf");
    expect(p.modelo.pendencias).toHaveLength(3);
    expect(p.modelo.edificacoes.map(e => e.id)).toEqual(["imp1", "ed9"]);
    expect(Array.from(p.pavimentos.entries())).toEqual([["ed1-pv1", "imp1-pv1"], ["ed1-pv2", "imp1-pv2"]]);
  });
});
