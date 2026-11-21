// QA (Quinn) — portão independente da EPIC-027 C1: provas de dinheiro, lote órfão, cancelamento, chave e PDF degenerado.
// Nada sai para a rede nem toca banco real; a chave é falsa e injetada. Os testes "ACHADO" do portão foram invertidos
// pelo @dev ao corrigir (marcados "corrigido"): provam que o defeito não volta.
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
import { ESPERA_PARA_PROCURAR_MS, MAX_FALHAS_CONSULTA, MAX_PROCURAS, anexoDaPagina } from "./maquete-3d/leitura.js";
import { lerEstadoLeitura } from "../shared/maquete-3d/regras.js";


import { MAX_DESCOMPACTADO, ladosDoJpeg, pdfDaPagina, pdfDeUmJpeg } from "./maquete-3d/pdf-pagina.js";
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
let falhaNoCancelamento: Error | null;
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
    enviados = []; respostas = []; emAndamento = 0; falhaNaConsulta = null; falhaNoCancelamento = null; relogio = new Date("2026-11-20T21:00:00Z");
    sim = loteSimulado({
      agora: () => relogio,
      falhaNoCancelamento: () => falhaNoCancelamento,
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

  const avancar = (id: number) => colaborador().avancarLeitura({ id });
  const passar = (ms: number) => { relogio = new Date(relogio.getTime() + ms); };
  /** Envio que estoura o tempo; `cria`: o lote chega a ser criado na Anthropic antes do estouro. */
  const comTempoEsgotado = (cria: boolean): ClienteLote => ({ ...sim.cliente, enviar: async p => { if (cria) await sim.cliente.enviar(p); else enviados.push(p); throw new APIConnectionTimeoutError(); } });

  it("QA-1 (corrigido): envio que CRIA o lote mas estoura o tempo — o passo procura o lote, adota e segue; nada de segundo lote pago", async () => {
    const id = await prontoParaIA();
    definirDependencias({ lote: comTempoEsgotado(true) });
    const r = await avancar(id);
    expect(r).toMatchObject({ erro: null, aguardando: { motivo: "executando" } }); // a tela continua consultando
    expect(await contador(id)).toBe(1);
    expect(await passoIA(id)).toMatchObject({ estado: "executando", loteAProcurar: { tentativas: 0, pedido: enviados[0].idPedido } });
    expect((await admin().detalhe({ id })).passos.find(p => p.tipo === "prancha_ia")).toMatchObject({ procurandoLote: true, lote: null });
    definirDependencias({ lote: sim.cliente });
    // Logo depois do envio, não procura (quem criou um lote nesse meio tempo ainda pode estar gravando o id).
    expect((await avancar(id)).aguardando?.motivo).toBe("executando");
    expect(sim.procuras).toEqual([]);
    passar(ESPERA_PARA_PROCURAR_MS + 1_000);
    expect((await avancar(id)).aguardando?.motivo).toBe("lote");
    expect(await passoIA(id)).toMatchObject({ loteAProcurar: null, lote: { id: "msgbatch_simulado_1", adotado: true, pedido: enviados[0].idPedido } });
    expect(await avancar(id)).toMatchObject({ erro: null, proximo: { tipo: "montagem" } });
    expect(sim.lotes.size).toBe(1);
    expect(sim.consultas).toEqual(["msgbatch_simulado_1"]);
    expect(await contador(id)).toBe(1);
    expect((await gravado(id)).tokensEntrada).toBe(31_234);
  });

  it("QA-1 (corrigido): sem lote criado, depois de algumas procuras conta como usada (como antes), sem laço", async () => {
    const id = await prontoParaIA();
    definirDependencias({ lote: comTempoEsgotado(false) });
    await avancar(id);
    definirDependencias({ lote: sim.cliente });
    let r = await avancar(id);
    for (let i = 0; i < MAX_PROCURAS + 2 && !r.erro; i++) { passar(ESPERA_PARA_PROCURAR_MS + 1_000); r = await avancar(id); }
    expect(r.erro).toContain("o lote não foi encontrado na Anthropic");
    expect(r.erro).toContain("conta como usada");
    expect(sim.procuras).toHaveLength(MAX_PROCURAS);
    expect(await contador(id)).toBe(1);
    expect(sim.lotes.size).toBe(0);
  });

  it("QA-1 (corrigido): nunca adota o lote de outra maquete; lote sem dono com o pedido de outro não tem o resultado usado; dois candidatos sem dono: não adota nenhum", async () => {
    // Maquete A estoura o tempo sem criar; a B envia normalmente na mesma janela (o lote dela está gravado na B).
    const a = await prontoParaIA();
    const b = await prontoParaIA();
    definirDependencias({ lote: comTempoEsgotado(false) });
    await avancar(a);
    definirDependencias({ lote: sim.cliente });
    await avancar(b);
    let r = await avancar(a);
    for (let i = 0; i < MAX_PROCURAS + 2 && !r.erro; i++) { passar(ESPERA_PARA_PROCURAR_MS + 1_000); r = await avancar(a); }
    expect(r.erro).toContain("o lote não foi encontrado");
    expect((await passoIA(b)).lote).toMatchObject({ id: "msgbatch_simulado_1" });
    expect(sim.cancelamentos).toEqual([]);

    // Um lote sem dono na janela, mas de outro pedido (custom_id): é adotado, e o custom_id é conferido no fim — o resultado não é usado.
    const c = await prontoParaIA();
    definirDependencias({ lote: comTempoEsgotado(false) });
    await avancar(c);
    await sim.cliente.enviar({ ...enviados.at(-1)!, idPedido: "outro-sistema-qualquer" });
    definirDependencias({ lote: sim.cliente });
    passar(ESPERA_PARA_PROCURAR_MS + 1_000);
    expect((await avancar(c)).aguardando?.motivo).toBe("lote");
    const fim = await avancar(c);
    expect(fim.erro).toContain("não era o desta prancha");
    expect((await gravado(c)).tokensEntrada).toBe(0);
    expect(await contador(c)).toBe(1);

    // Dois lotes sem dono na janela: não dá para saber qual é o dela — nenhum é adotado.
    const e = await prontoParaIA();
    definirDependencias({ lote: comTempoEsgotado(true) });
    await avancar(e);
    await sim.cliente.enviar({ ...enviados.at(-1)!, idPedido: "outro-sistema-2" });
    definirDependencias({ lote: sim.cliente });
    passar(ESPERA_PARA_PROCURAR_MS + 1_000);
    expect((await avancar(e)).erro).toContain("mais de um lote recente");
    expect(await contador(e)).toBe(1);
  });

  it("QA-2 (corrigido): a função cai entre criar o lote e gravar o id — com a reserva vencida, o passo procura o lote, adota e segue consultando", async () => {
    const id = await prontoParaIA();
    // ExecucaoConcorrente depois do envio = o pedido termina sem gravar nada (mesmo efeito de a função ser encerrada).
    definirDependencias({ lote: { ...sim.cliente, enviar: async p => { await sim.cliente.enviar(p); throw new ExecucaoConcorrente("queda simulada"); } } });
    await avancar(id);
    expect(await passoIA(id)).toMatchObject({ estado: "executando" });
    expect((await passoIA(id)).lote ?? null).toBeNull();
    await expect(colaborador().cancelarLeituraIA({ id, chave: "ia:0:1" })).rejects.toThrow("ainda está sendo enviada");
    definirDependencias({ lote: sim.cliente });
    passar(80_000);
    const r = await avancar(id);
    expect(r).toMatchObject({ erro: null, aguardando: { motivo: "lote" } });
    expect(await passoIA(id)).toMatchObject({ estado: "executando", lote: { id: "msgbatch_simulado_1", adotado: true } });
    expect(await avancar(id)).toMatchObject({ erro: null, proximo: { tipo: "montagem" } });
    expect(sim.lotes.size).toBe(1);
    expect(await contador(id)).toBe(1);
    // Sem lote achado, continua como antes: "interrompida", conta como usada.
    const outro = await prontoParaIA();
    definirDependencias({ lote: { ...sim.cliente, enviar: async () => { throw new ExecucaoConcorrente("queda antes de criar"); } } });
    await avancar(outro);
    definirDependencias({ lote: sim.cliente });
    passar(80_000);
    expect((await avancar(outro)).erro).toContain("interrompida");
    expect(await contador(outro)).toBe(1);
  });

  it(`QA-3 (corrigido): ${MAX_FALHAS_CONSULTA} consultas com falha — antes de deixar o lote, pede o cancelamento e registra se foi aceito; a chave não vaza`, async () => {
    const id = await prontoParaIA();
    emAndamento = 1_000;
    await avancar(id);
    falhaNaConsulta = new Error(`rede caiu ${CHAVE}`);
    let r = await avancar(id);
    for (let i = 1; i < MAX_FALHAS_CONSULTA && !r.erro; i++) r = await avancar(id);
    expect(r.erro).toContain("conta como usada");
    expect(r.erro).toContain("O cancelamento do lote foi pedido à Anthropic e aceito");
    expect(JSON.stringify([r, await gravado(id), await admin().detalhe({ id })])).not.toContain(CHAVE);
    expect(await contador(id)).toBe(1);
    expect(sim.cancelamentos).toEqual(["msgbatch_simulado_1"]);
    expect(sim.lotes.get("msgbatch_simulado_1")!.cancelado).toBe(true);
    expect(await passoIA(id)).toMatchObject({ estado: "erro", loteAbandonado: { id: "msgbatch_simulado_1", cancelamento: "aceito" } });
  });

  it("QA-3 (corrigido): chave revogada — o cancelamento é tentado, não é aceito, e isso fica registrado (sem travar)", async () => {
    const id = await prontoParaIA();
    emAndamento = 1_000;
    await avancar(id);
    falhaNaConsulta = Object.assign(new Error("invalid x-api-key"), { status: 401 });
    falhaNoCancelamento = Object.assign(new Error("invalid x-api-key"), { status: 401 });
    const r = await avancar(id);
    expect(r.erro).toContain("O cancelamento do lote foi pedido à Anthropic, mas não foi aceito agora");
    expect(await passoIA(id)).toMatchObject({ loteAbandonado: { id: "msgbatch_simulado_1", cancelamento: "recusado" } });
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
      await expect(caller(9, papel).maquete3d.cancelarLeituraIA({ id: a, chave: "ia:0:1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(9, papel).maquete3d.cancelarLeituraIAImportacao({ id: a, chave: "ia:0:1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(sim.cancelamentos).toEqual([]);
    await colaborador().cancelarLeituraIA({ id: b, chave: "ia:0:1" });
    expect(sim.cancelamentos).toEqual(["msgbatch_simulado_2"]);
    expect((await passoIA(a)).lote).toMatchObject({ id: "msgbatch_simulado_1", situacao: "em_andamento" });
    // Id inexistente: erro claro, nada cancelado.
    await expect(colaborador().cancelarLeituraIA({ id: 999, chave: "ia:0:1" })).rejects.toBeTruthy();
    expect(sim.cancelamentos).toHaveLength(1);
  });

  it("QA-6 (corrigido): o cancelamento diz QUAL prancha — com a tela atrasada (mostrando a prancha 1), nada é cancelado e a tela pede para atualizar", async () => {
    const id = await prontoParaIA([IMG, IMG2]);
    await avancar(id); // envia a prancha 1
    expect(await avancar(id)).toMatchObject({ erro: null }); // prancha 1 lida
    emAndamento = 5;
    expect((await avancar(id)).aguardando?.motivo).toBe("lote"); // prancha 2 enviada
    await expect(colaborador().cancelarLeituraIA({ id, chave: "ia:0:1" })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("Atualize a página") });
    expect(sim.cancelamentos).toEqual([]);
    await colaborador().cancelarLeituraIA({ id, chave: "ia:1:1" });
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

  it("QA-R2-1 ACHADO: lote ALHEIO (outra ferramenta com a mesma chave) adotado e ainda não conferido é CANCELADO pelo botão e pelo abandono", async () => {
    emAndamento = 100;
    const c = await prontoParaIA();
    definirDependencias({ lote: comTempoEsgotado(false) });
    await avancar(c);
    await sim.cliente.enviar({ ...enviados.at(-1)!, idPedido: "outra-ferramenta-do-dono" }); // msgbatch_simulado_1: não é da maquete
    definirDependencias({ lote: sim.cliente });
    passar(ESPERA_PARA_PROCURAR_MS + 1_000);
    expect((await avancar(c)).aguardando?.motivo).toBe("lote");
    expect(await passoIA(c)).toMatchObject({ lote: { id: "msgbatch_simulado_1", adotado: true } });
    await colaborador().cancelarLeituraIA({ id: c, chave: "ia:0:1" });
    expect(sim.cancelamentos).toEqual(["msgbatch_simulado_1"]); // cancelou trabalho de outro sistema

    // Abandono (30 falhas de consulta) também cancela o lote adotado sem conferência.
    const d = await prontoParaIA();
    definirDependencias({ lote: comTempoEsgotado(false) });
    await avancar(d);
    await sim.cliente.enviar({ ...enviados.at(-1)!, idPedido: "outra-ferramenta-2" });
    definirDependencias({ lote: sim.cliente });
    passar(ESPERA_PARA_PROCURAR_MS + 1_000);
    await avancar(d);
    const alheio = (await passoIA(d)).lote!.id;
    falhaNaConsulta = new Error("rede");
    let r = await avancar(d);
    for (let i = 1; i < MAX_FALHAS_CONSULTA && !r.erro; i++) r = await avancar(d);
    expect(r.erro).toContain("conta como usada");
    expect(sim.cancelamentos).toContain(alheio);
  });

  it("QA-R2-2 ACHADO (baixo): A (lote não criado) adota o lote órfão da B na mesma janela; a B fica sem o dela e o resultado pago da B não é usado por ninguém", async () => {
    const a = await prontoParaIA();
    const b = await prontoParaIA();
    definirDependencias({ lote: comTempoEsgotado(false) });
    await avancar(a);                                 // A: tempo esgotado, nenhum lote
    definirDependencias({ lote: comTempoEsgotado(true) });
    await avancar(b);                                 // B: tempo esgotado, lote criado (órfão)
    definirDependencias({ lote: sim.cliente });
    passar(ESPERA_PARA_PROCURAR_MS + 1_000);
    expect((await avancar(a)).aguardando?.motivo).toBe("lote"); // A adota o lote da B
    expect(await passoIA(a)).toMatchObject({ lote: { id: "msgbatch_simulado_1", adotado: true } });
    let rb = await avancar(b);
    for (let i = 0; i < MAX_PROCURAS + 2 && !rb.erro; i++) { passar(ESPERA_PARA_PROCURAR_MS + 1_000); rb = await avancar(b); }
    expect(rb.erro).toContain("não foi encontrado"); // a dona perdeu o lote
    const ra = await avancar(a);
    expect(ra.erro).toContain("não era o desta prancha"); // e a A descarta o resultado (correto: nunca grava planta alheia)
    expect([(await gravado(a)).tokensEntrada, (await gravado(b)).tokensEntrada]).toEqual([0, 0]);
    expect([await contador(a), await contador(b)]).toEqual([1, 1]); // dentro do teto
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

  it("(corrigido) bomba de compressão: fluxo que passa do teto não é descompactado; a página não é achada e a prancha vai inteira, com o motivo", () => {
    // Os dicionários das páginas estão SÓ dentro do fluxo de objetos, que descompactado passaria de 64 MB.
    const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] >>"];
    let corpo = "", cab = "";
    objs.forEach((o, i) => { cab += `${i + 1} ${corpo.length} `; corpo += `${o}\n`; });
    const bruto = Buffer.concat([Buffer.from(cab + corpo, "latin1"), Buffer.alloc(MAX_DESCOMPACTADO + (4 << 20), 0x20)]);
    const stm = deflateSync(bruto, { level: 9 });
    expect(stm.length).toBeLessThan(400_000);
    const pdf = Buffer.concat([
      Buffer.from(`%PDF-1.5\n9 0 obj\n<< /Type /ObjStm /N 4 /First ${cab.length} /Filter /FlateDecode /Length ${stm.length} >>\nstream\n`, "latin1"), stm,
      Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1"),
    ]);
    const inicio = Date.now();
    expect(pdfDaPagina(pdf, 1)).toMatchObject({ motivo: expect.stringContaining("não foi encontrada") });
    const r = anexoDaPagina(pdf, "bomba.pdf", 1, 2);
    expect(r).toMatchObject({ envio: "pdf_original", motivo: expect.stringContaining("não foi encontrada") });
    expect(Date.now() - inicio).toBeLessThan(5_000);
    // Abaixo do teto, o mesmo arquivo (sem o enchimento) continua sendo lido.
    const pequeno = deflateSync(Buffer.from(cab + corpo, "latin1"));
    const ok = Buffer.concat([
      Buffer.from(`%PDF-1.5\n9 0 obj\n<< /Type /ObjStm /N 4 /First ${cab.length} /Filter /FlateDecode /Length ${pequeno.length} >>\nstream\n`, "latin1"), pequeno,
      Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1"),
    ]);
    expect(pdfDaPagina(ok, 2)).toHaveProperty("pdf");
  });
});
