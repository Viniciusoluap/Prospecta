// EPIC-028 (Etapa 4) — página pública por lote com banco em memória (PGlite): migração 0147 aplicada 2× (padrão
// testes-banco), só publicado (rascunho nunca), a mesma resposta para tudo o que não abre, nada de comprador/preço/ids,
// dois lotes na mesma planta com versões de itens diferentes, status só leitura, WhatsApp da empresa, rotas de admin só
// para o administrador (sem consulta ao banco) e o link antigo /maquete/:token intacto. Nada toca banco real.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import * as schema from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { appRouter } from "./routers.js";
import { fonteDoRepo } from "./maquete-3d/itens.js";
import { MENSAGEM_NAO_ENCONTRADO, semNotas } from "./maquete-3d/lotes.js";
import { modeloVazio } from "../shared/maquete-3d/modelo.js";
import {
  WHATSAPP_EMPRESA, caminhoDoLote, linkWhatsAppDoLote, mensagemWhatsAppDoLote, separarLoteECodigo, statusDaUnidade,
} from "../shared/maquete-3d/lote-publico.js";
import type { ItemFonte } from "../shared/maquete-3d/fonte.js";

const TABELAS = ["users", "leads", "leadServices", "operationalProjects", "projectRevisionRequests", "projectDocuments", "incorporationStudies", "incorporationRegistrationDocuments", "incorporationUnits", "paymentOrders", "draws", "products"];
const ANTERIORES = ["0111_maquete_3d.sql", "0112_maquete_3d_comercial.sql", "0113_maquete_3d_pagamento.sql", "0114_maquete_3d_email.sql", "0115_maquete_3d_lead_arquivos.sql", "0121_maquete_3d_revisoes.sql", "0146_maquete_3d_itens_e_lotes.sql"];
const SQL_0147 = readFileSync(new URL("../drizzle/0147_maquete_3d_lote_link.sql", import.meta.url), "utf8");
let ddl: string | null = null;

async function criarBanco(antesDa0147?: string) {
  if (!ddl) {
    const { generateDrizzleJson, generateMigration } = createRequire(import.meta.url)("drizzle-kit/api");
    const escolhidas: Record<string, unknown> = {};
    for (const [nome, valor] of Object.entries(schema)) if (TABELAS.includes(nome) || nome.endsWith("Enum")) escolhidas[nome] = valor;
    ddl = (await generateMigration(generateDrizzleJson({}), generateDrizzleJson(escolhidas)) as string[]).join(";\n");
  }
  const pg = new PGlite();
  await pg.exec(ddl);
  for (const a of ANTERIORES) await pg.exec(readFileSync(new URL(`../drizzle/${a}`, import.meta.url), "utf8"));
  await pg.exec(`
    INSERT INTO users ("openId", name, role, active) VALUES ('admin', 'Admin Um', 'admin', true), ('colab', 'Colaboradora', 'colaborador', true);
    INSERT INTO operational_projects (name, client_name, client_phone, engineer, value) VALUES ('Casa Silva', 'Ana Silva', '99999', 'Eng', 1000);
    INSERT INTO incorporation_studies (name, city) VALUES ('Loteamento Vila Esmeralda', 'Imperatriz'), ('Outro Estudo', 'Imperatriz');
    INSERT INTO incorporation_units (study_id, code, code_key, kind, status, buyer, sale_price) VALUES
      (1, 'QD 18 LOTE 04', 'QD 18 LOTE 04', 'lote', 'vendida', 'Fulano Comprador da Silva', 254321.77),
      (1, 'QD 18 LOTE 05', 'QD 18 LOTE 05', 'lote', 'reservada', NULL, NULL),
      (2, 'Q18 L4', 'Q18 L4', 'lote', 'disponivel', NULL, NULL);`);
  if (antesDa0147) await pg.exec(antesDa0147);
  await pg.exec(SQL_0147);
  await pg.exec(SQL_0147); // idempotente
  return { pg, db: drizzle(pg) };
}

let banco: Awaited<ReturnType<typeof criarBanco>>;
const usuario = (id: number | null, role = "admin", permissions = "[]") => (id === null ? null : { id, role, permissions, active: true, name: "x" });
const app = (id: number | null, role = "admin", permissions = "[]", res: unknown = {}) =>
  appRouter.createCaller({ user: usuario(id, role, permissions), req: {}, res } as never);
const admin = () => app(1).maquete3d;
const publico = (res: unknown = {}) => app(null, "admin", "[]", res).maquetePublica;
const PLANTA = "lote4-qd18";
const mover = (itens: ItemFonte[], id: string, m: Partial<ItemFonte>) => itens.map(i => (i.id === id ? { ...i, ...m } : i));

/** Publica v1 (sofá em z = 6,2) e devolve os itens. */
async function publicarV1() {
  const aberto = await admin().itens.abrir({ planta: PLANTA });
  const v1 = mover(aberto.fonte.itens, "sofa", { z: 6.2 });
  await admin().itens.salvar({ planta: PLANTA, versaoBase: 0, itens: v1 });
  await admin().itens.publicar({ planta: PLANTA, versao: 1 });
  return v1;
}
async function lotePadrao() {
  await admin().lotes.semearPadrao({ planta: PLANTA });
  const { lotes } = await admin().lotes.listar({ planta: PLANTA });
  return lotes.find(l => l.loteSlug === "qd18-lote4")!;
}
const partes = (caminho: string) => { const [, , empreendimento, lote] = caminho.split("/"); return { empreendimento, lote }; };
const erroDe = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; message?: string }) => ({ code: e.code, message: e.message }));

describe("migração 0147 (link do lote)", () => {
  it("aplicada duas vezes sem erro, sobre um banco com lote já ligado (0146), que continua igual e sem link", async () => {
    const b = await criarBanco(`
      INSERT INTO maquetes_3d (token, titulo, origem, tipo, status, fonte_slug) VALUES ('tok-fonte-00000000000001', 'Planta', 'fonte', 'casa', 'validada', 'lote4-qd18');
      INSERT INTO maquete_3d_lotes (empreendimento_slug, lote_slug, maquete_id) VALUES ('vila-esmeralda', 'qd18-lote9', 1);`);
    const { rows } = await b.pg.query<Record<string, unknown>>("SELECT lote_slug, maquete_id, ativo, codigo_link, empreendimento_nome, quadra, lote_numero FROM maquete_3d_lotes");
    expect(rows).toEqual([{ lote_slug: "qd18-lote9", maquete_id: 1, ativo: true, codigo_link: null, empreendimento_nome: null, quadra: null, lote_numero: null }]);
    // Código: só a-z/0-9, de 10 a 24, único.
    await b.pg.exec(`UPDATE maquete_3d_lotes SET codigo_link = 'abcdefghjk'`);
    await expect(b.pg.exec(`UPDATE maquete_3d_lotes SET codigo_link = 'curto'`)).rejects.toThrow();
    await expect(b.pg.exec(`UPDATE maquete_3d_lotes SET codigo_link = 'COM-MAIUSCULA'`)).rejects.toThrow();
    await expect(b.pg.exec(`INSERT INTO maquete_3d_lotes (empreendimento_slug, lote_slug, maquete_id, codigo_link) VALUES ('vila-esmeralda', 'outro', 1, 'abcdefghjk')`)).rejects.toThrow();
  });

  it("só aditiva: sem DROP de tabela/coluna/índice, DELETE, TRUNCATE nem UPDATE; DROP só da CHECK recriada", () => {
    const sem = SQL_0147.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    expect(sem).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX|FUNCTION|TRIGGER)/i);
    expect(sem).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|UPDATE\s+")/i);
    expect((sem.match(/DROP\s+\w+\s+IF EXISTS\s+"?\w+"?/gi) ?? []).map(d => d.replace(/\s+/g, " "))).toEqual(['DROP CONSTRAINT IF EXISTS "maquete_3d_lotes_codigo_ck"']);
    expect(sem.match(/ADD COLUMN IF NOT EXISTS "(\w+)"/g)).toHaveLength(4);
  });
});

describe("regras compartilhadas do lote", () => {
  it("WhatsApp: número da empresa (99) 98139-2210 e mensagem com empreendimento, quadra e lote, codificada", () => {
    expect(WHATSAPP_EMPRESA).toBe("5599981392210");
    const t = { empreendimento: "Vila Esmeralda", quadra: "18", lote: "4" };
    expect(mensagemWhatsAppDoLote(t)).toBe("Olá! Vi a maquete 3D do Lote 4, Quadra 18 do Vila Esmeralda e quero saber mais sobre este lote.");
    const link = linkWhatsAppDoLote(t);
    expect(link).toBe(`https://wa.me/5599981392210?text=${encodeURIComponent(mensagemWhatsAppDoLote(t))}`);
    expect(link).toContain("Ol%C3%A1!%20Vi%20a%20maquete%203D%20do%20Lote%204%2C%20Quadra%2018%20do%20Vila%20Esmeralda");
    expect(link).not.toMatch(/[ áç,]/);
    expect(decodeURIComponent(new URL(link).searchParams.get("text")!)).toBe(mensagemWhatsAppDoLote(t));
    // Texto com & ou # não quebra o link.
    expect(new URL(linkWhatsAppDoLote({ empreendimento: "A & B #1", quadra: null, lote: "7" })).searchParams.get("text")).toBe("Olá! Vi a maquete 3D do Lote 7 do A & B #1 e quero saber mais sobre este lote.");
  });

  it("endereço: código é o último pedaço do lote; status da Incorporação mapeado, desconhecido = sem status", () => {
    expect(separarLoteECodigo("qd18-lote4-abcdefghjk")).toEqual({ loteSlug: "qd18-lote4", codigo: "abcdefghjk" });
    for (const ruim of ["qd18-lote4", "abcdefghjk", "-abcdefghjk", "qd18-lote4-ABCDEFGHJK", "qd18-lote4-abc", "Q18-abcdefghjk", "x".repeat(200)]) expect(separarLoteECodigo(ruim)).toBeNull();
    expect(caminhoDoLote("vila-esmeralda", "qd18-lote4", "abcdefghjk")).toBe("/maquete/vila-esmeralda/qd18-lote4-abcdefghjk");
    expect([statusDaUnidade("disponivel"), statusDaUnidade("reservada"), statusDaUnidade("vendida"), statusDaUnidade("outro"), statusDaUnidade(null)])
      .toEqual(["disponivel", "reservado", "vendido", null, null]);
  });
});

describe("página pública por lote", () => {
  beforeEach(async () => {
    banco = await criarBanco();
    vi.mocked(getDb).mockReset();
    vi.mocked(getDb).mockReturnValue(banco.db as never);
  });

  it("semente idempotente: liga o Lote 4 da Quadra 18 (Vila Esmeralda) à planta, com código, e acha a unidade única do estudo", async () => {
    expect(await admin().lotes.semearPadrao({ planta: PLANTA })).toEqual({ criado: true, unidadeLigada: true });
    expect(await admin().lotes.semearPadrao({ planta: PLANTA })).toEqual({ criado: false, unidadeLigada: true });
    const { rows } = await banco.pg.query<Record<string, unknown>>(`SELECT l.empreendimento_slug, l.lote_slug, l.empreendimento_nome, l.quadra, l.lote_numero, l.unit_id, m.fonte_slug,
      l.codigo_link ~ '^[a-z0-9]{10}$' AS codigo_ok FROM maquete_3d_lotes l JOIN maquetes_3d m ON m.id = l.maquete_id`);
    expect(rows).toEqual([{ empreendimento_slug: "vila-esmeralda", lote_slug: "qd18-lote4", empreendimento_nome: "Vila Esmeralda", quadra: "18", lote_numero: "4", unit_id: 1, fonte_slug: PLANTA, codigo_ok: true }]);
    await expect(admin().lotes.semearPadrao({ planta: "outra" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("só entrega o PUBLICADO: sem publicação não abre; rascunho salvo depois não aparece; status e textos certos", async () => {
    const l = await lotePadrao();
    expect(l.pendencia).toBe("Nenhuma versão de itens publicada ainda.");
    await expect(publico().porLote(partes(l.caminho!))).rejects.toMatchObject({ code: "NOT_FOUND", message: MENSAGEM_NAO_ENCONTRADO });
    const v1 = await publicarV1();
    // rascunho v2 (sofá em outro lugar), não publicado
    await admin().itens.salvar({ planta: PLANTA, versaoBase: 1, itens: fonteDoRepo(PLANTA).itens });
    const setHeader = vi.fn();
    const r = await publico({ setHeader }).porLote(partes(l.caminho!));
    expect(r.fonte.itens).toEqual(semNotas(v1));
    expect(r.fonte.itens.find(i => i.id === "sofa")!.z).toBe(6.2);
    expect(r.fonte.estrutura).toEqual(semNotas(fonteDoRepo(PLANTA).estrutura));
    expect(r).toMatchObject({ empreendimento: "Vila Esmeralda", quadra: "18", lote: "4", status: "vendido" });
    expect(setHeader).toHaveBeenCalledWith("X-Robots-Tag", "noindex, nofollow");
    // Fixar o lote no rascunho (direto no banco, a tela não deixa) não abre: rascunho nunca.
    await expect(admin().lotes.salvar({ planta: PLANTA, id: l.id, empreendimentoSlug: "vila-esmeralda", loteSlug: "qd18-lote4", empreendimentoNome: "Vila Esmeralda", quadra: "18", lote: "4", itensVersao: 2, unitId: 1, ativo: true }))
      .rejects.toThrow("já foi publicada");
    await banco.pg.exec(`UPDATE maquete_3d_lotes SET itens_versao = 2`);
    await expect(publico().porLote(partes(l.caminho!))).rejects.toMatchObject({ code: "NOT_FOUND", message: MENSAGEM_NAO_ENCONTRADO });
  });

  it("resposta mínima: nada de comprador, preço, ids, autor, versões ou rascunho", async () => {
    const l = await lotePadrao();
    await publicarV1();
    const r = await publico().porLote(partes(l.caminho!));
    expect(Object.keys(r).sort()).toEqual(["empreendimento", "fonte", "lote", "quadra", "status"]);
    const texto = JSON.stringify(r);
    for (const proibido of ["Fulano", "254321", "254.321", "Admin Um", "maqueteId", "unitId", "unit_id", "versao_publicada", "itensVersao", "rascunho", "token", "buyer", "sale", "\"nota\""]) expect(texto, proibido).not.toContain(proibido);
    // Nenhum número de id: os ids dos itens são nomes (sofa, geladeira…), não sequenciais.
    expect(r.fonte.itens.every(i => /[a-z]/.test(i.id))).toBe(true);
  });

  it("código errado, lote inexistente, empreendimento errado, lote desligado ou formato inválido: a MESMA resposta", async () => {
    const l = await lotePadrao();
    await publicarV1();
    const { empreendimento, lote } = partes(l.caminho!);
    const codigo = lote.split("-").at(-1)!;
    const outroCodigo = codigo.slice(0, -1) + (codigo.endsWith("a") ? "b" : "a");
    const casos = [
      { empreendimento, lote: `qd18-lote4-${outroCodigo}` }, { empreendimento, lote: `qd18-lote9-${codigo}` }, { empreendimento: "outro-bairro", lote },
      { empreendimento, lote: "qd18-lote4" }, { empreendimento, lote: codigo }, { empreendimento: "Vila Esmeralda", lote }, { empreendimento, lote: "x".repeat(500) },
      { empreendimento: "", lote: "" },
    ];
    const respostas = await Promise.all(casos.map(c => erroDe(publico().porLote(c))));
    for (const r of respostas) expect(r).toEqual({ code: "NOT_FOUND", message: MENSAGEM_NAO_ENCONTRADO });
    expect(await publico().porLote({ empreendimento, lote })).toBeTruthy();
    await banco.pg.exec(`UPDATE maquete_3d_lotes SET ativo = false`);
    expect(await erroDe(publico().porLote({ empreendimento, lote }))).toEqual({ code: "NOT_FOUND", message: MENSAGEM_NAO_ENCONTRADO });
  });

  it("regenerar o código: o link anterior para de abrir e o novo abre", async () => {
    const l = await lotePadrao();
    await publicarV1();
    const { caminho } = await admin().lotes.gerarCodigo({ planta: PLANTA, id: l.id });
    expect(caminho).not.toBe(l.caminho);
    expect(caminho).toMatch(/^\/maquete\/vila-esmeralda\/qd18-lote4-[a-z0-9]{10}$/);
    expect(await erroDe(publico().porLote(partes(l.caminho!)))).toEqual({ code: "NOT_FOUND", message: MENSAGEM_NAO_ENCONTRADO });
    expect((await publico().porLote(partes(caminho))).lote).toBe("4");
  });

  it("dois lotes na mesma planta (N → 1) com versões de itens diferentes; status de cada um; sem unidade = sem status", async () => {
    const a = await lotePadrao();
    const v1 = await publicarV1();
    const v2 = fonteDoRepo(PLANTA).itens;
    await admin().itens.salvar({ planta: PLANTA, versaoBase: 1, itens: v2 });
    await admin().itens.publicar({ planta: PLANTA, versao: 2 });
    // Lote A fica fixo na v1 (hoje arquivada, mas foi publicada); lote B segue a publicada da maquete (v2), ligado à unidade reservada.
    await admin().lotes.salvar({ planta: PLANTA, id: a.id, empreendimentoSlug: "vila-esmeralda", loteSlug: "qd18-lote4", empreendimentoNome: "Vila Esmeralda", quadra: "18", lote: "4", itensVersao: 1, unitId: 1, ativo: true });
    const { id: idB } = await admin().lotes.salvar({ planta: PLANTA, empreendimentoSlug: "vila-esmeralda", loteSlug: "qd18-lote5", empreendimentoNome: "Vila Esmeralda", quadra: "18", lote: "5", itensVersao: null, unitId: 2, ativo: true });
    const { id: idC } = await admin().lotes.salvar({ planta: PLANTA, empreendimentoSlug: "vila-esmeralda", loteSlug: "qd18-lote6", empreendimentoNome: "Vila Esmeralda", quadra: "18", lote: "6", itensVersao: null, unitId: null, ativo: true });
    const lista = await admin().lotes.listar({ planta: PLANTA });
    expect(lista.versaoPublicada).toBe(2);
    expect(lista.versoes.map(v => [v.versao, v.situacao, v.valeParaPlanta])).toEqual([[2, "publicada", true], [1, "arquivada", true]]);
    const porSlug = Object.fromEntries(lista.lotes.map(l => [l.loteSlug, l]));
    expect(new Set((await banco.pg.query<{ maquete_id: number }>("SELECT DISTINCT maquete_id FROM maquete_3d_lotes")).rows.map(r => r.maquete_id)).size).toBe(1);
    expect([porSlug["qd18-lote4"].versaoEfetiva, porSlug["qd18-lote5"].versaoEfetiva, porSlug["qd18-lote6"].versaoEfetiva]).toEqual([1, 2, 2]);
    expect(porSlug["qd18-lote5"]).toMatchObject({ id: idB, unidade: { codigo: "QD 18 LOTE 05", estudo: "Loteamento Vila Esmeralda", status: "reservado" }, pendencia: null });
    const ra = await publico().porLote(partes(porSlug["qd18-lote4"].caminho!));
    const rb = await publico().porLote(partes(porSlug["qd18-lote5"].caminho!));
    const rc = await publico().porLote(partes(porSlug["qd18-lote6"].caminho!));
    expect(ra.fonte.itens).toEqual(semNotas(v1));
    expect(rb.fonte.itens).toEqual(semNotas(v2));
    expect(ra.fonte.estrutura).toEqual(rb.fonte.estrutura);
    expect([ra.status, rb.status, rc.status]).toEqual(["vendido", "reservado", null]);
    expect(idC).toBeGreaterThan(0);
    // O status é só leitura: muda na Incorporação e a página acompanha.
    await banco.pg.exec(`UPDATE incorporation_units SET status = 'disponivel' WHERE id = 2`);
    expect((await publico().porLote(partes(porSlug["qd18-lote5"].caminho!))).status).toBe("disponivel");
    // Endereço repetido no mesmo empreendimento é recusado.
    await expect(admin().lotes.salvar({ planta: PLANTA, empreendimentoSlug: "vila-esmeralda", loteSlug: "qd18-lote5", empreendimentoNome: "Vila Esmeralda", quadra: "18", lote: "5", itensVersao: null, unitId: null, ativo: true }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    // Unidades para ligar: só código, estudo e status.
    const us = await admin().lotes.unidades({ busca: "esmeralda" });
    expect(us.map(u => Object.keys(u).sort())).toEqual([["codigo", "estudo", "id", "status"], ["codigo", "estudo", "id", "status"]]);
    expect(JSON.stringify(us)).not.toContain("Fulano");
  });

  it("permissões: rotas de lotes só para o administrador; os outros papéis e o anônimo são barrados sem consulta ao banco", async () => {
    const quem: [string, ReturnType<typeof app>][] = [
      ["corretor", app(5, "corretor")], ["colaborador com o módulo", app(2, "colaborador", JSON.stringify(["maquete3d"]))],
      ["colaborador sem módulo", app(2, "colaborador")], ["empreiteiro", app(6, "empreiteiro")], ["cliente", app(8, "cliente")], ["anônimo", app(null)],
    ];
    vi.mocked(getDb).mockClear();
    const dados = { planta: PLANTA, empreendimentoSlug: "vila-esmeralda", loteSlug: "x", empreendimentoNome: "V", quadra: null, lote: null, itensVersao: null, unitId: null, ativo: true };
    for (const [nome, c] of quem) {
      for (const chamada of [
        () => c.maquete3d.lotes.listar({ planta: PLANTA }), () => c.maquete3d.lotes.salvar(dados), () => c.maquete3d.lotes.gerarCodigo({ planta: PLANTA, id: 1 }),
        () => c.maquete3d.lotes.unidades({ busca: "" }), () => c.maquete3d.lotes.semearPadrao({ planta: PLANTA }),
      ]) {
        const e = await erroDe(chamada());
        expect(e?.code, nome).toMatch(/^(FORBIDDEN|UNAUTHORIZED)$/);
      }
    }
    expect(vi.mocked(getDb)).not.toHaveBeenCalled();
    expect((await banco.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM maquete_3d_lotes")).rows[0].n).toBe(0);
  });

  it("o link antigo /maquete/:token continua: abre a maquete publicada e recusa a não publicada", async () => {
    await banco.pg.exec(`INSERT INTO maquetes_3d (token, titulo, origem, project_id, tipo, status, modelo) VALUES
      ('tok-projeto-000000000001', 'Casa antiga', 'projeto', 1, 'casa', 'publicada', '${JSON.stringify(modeloVazio("casa"))}'),
      ('tok-projeto-000000000002', 'Casa em revisão', 'projeto', 1, 'casa', 'validada', '${JSON.stringify(modeloVazio("casa"))}')`);
    const r = await publico().porToken({ token: "tok-projeto-000000000001" });
    expect(r).toMatchObject({ titulo: "Casa antiga", tipo: "casa" });
    await expect(publico().porToken({ token: "tok-projeto-000000000002" })).rejects.toThrow("não encontrada");
    // A maquete da planta (origem 'fonte') não abre pelo token: só pela página do lote.
    await lotePadrao();
    await publicarV1();
    const { rows } = await banco.pg.query<{ token: string }>("SELECT token FROM maquetes_3d WHERE fonte_slug IS NOT NULL");
    await expect(publico().porToken({ token: rows[0].token })).rejects.toThrow("não encontrada");
  });
});
