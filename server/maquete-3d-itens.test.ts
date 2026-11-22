// EPIC-028 (Etapa 3) — itens editáveis com banco em memória (PGlite): migração 0146 aplicada 2×, semente idempotente
// da maquete lote4-qd18, mover → salvar → recarregar, rascunho × publicado, concorrência otimista, revalidação no
// servidor, permissões por papel (sem consulta ao banco) e imutabilidade das versões. Nada toca banco real.
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
import { fonteDoRepo, hashDaEstrutura, itensPublicados } from "./maquete-3d/itens.js";
import { canonico, girar } from "../shared/maquete-3d/edicao.js";
import type { ItemFonte } from "../shared/maquete-3d/fonte.js";

const TABELAS = ["users", "leads", "leadServices", "operationalProjects", "projectRevisionRequests", "projectDocuments", "incorporationStudies", "incorporationRegistrationDocuments", "incorporationUnits", "paymentOrders", "draws", "products"];
const ANTERIORES = ["0111_maquete_3d.sql", "0112_maquete_3d_comercial.sql", "0113_maquete_3d_pagamento.sql", "0114_maquete_3d_email.sql", "0115_maquete_3d_lead_arquivos.sql", "0121_maquete_3d_revisoes.sql"];
const SQL_0146 = readFileSync(new URL("../drizzle/0146_maquete_3d_itens_e_lotes.sql", import.meta.url), "utf8");
let ddl: string | null = null;

async function criarBanco(comMaqueteAntiga = false) {
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
    INSERT INTO users ("openId", name, role, active) VALUES ('admin', 'Admin Um', 'admin', true), ('admin2', 'Admin Dois', 'admin', true), ('colab', 'Colaboradora', 'colaborador', true);
    INSERT INTO operational_projects (name, client_name, client_phone, engineer, value) VALUES ('Casa Silva', 'Ana Silva', '99999', 'Eng', 1000);
    INSERT INTO incorporation_studies (name, city) VALUES ('Vila Esmeralda', 'Imperatriz');`);
  if (comMaqueteAntiga) await pg.exec(`
    INSERT INTO maquetes_3d (token, titulo, origem, project_id, tipo, status, modelo) VALUES ('tok-projeto-000000000001', 'Casa antiga', 'projeto', 1, 'casa', 'publicada', '{"tipo":"casa"}');
    INSERT INTO maquetes_3d (token, titulo, origem, study_id, tipo, status) VALUES ('tok-incorp-0000000000001', 'Estudo antigo', 'incorporacao', 1, 'condominio', 'liberada');`);
  await pg.exec(SQL_0146);
  await pg.exec(SQL_0146); // idempotente
  return { pg, db: drizzle(pg) };
}

let banco: Awaited<ReturnType<typeof criarBanco>>;
const caller = (id: number | null, role = "admin", permissions = "[]") =>
  appRouter.createCaller({ user: id === null ? null : { id, role, permissions, active: true, name: "x" }, req: {}, res: {} } as never).maquete3d.itens;
const admin = () => caller(1);
const PLANTA = "lote4-qd18";
const padrao = () => fonteDoRepo(PLANTA).itens;
const canonicoItens = (texto: string) => canonico(JSON.parse(texto));
const mover = (itens: ItemFonte[], id: string, m: Partial<ItemFonte>) => itens.map(i => (i.id === id ? { ...i, ...m } : i));

describe("migração 0146 (itens e lotes da maquete)", () => {
  it("aplicada duas vezes sem erro, sobre um banco com maquetes antigas, que continuam válidas", async () => {
    const b = await criarBanco(true);
    const { rows } = await b.pg.query<{ origem: string; glb_url: string | null; itens_versao_publicada: number | null }>("SELECT origem, glb_url, itens_versao_publicada FROM maquetes_3d ORDER BY id");
    expect(rows).toEqual([{ origem: "projeto", glb_url: null, itens_versao_publicada: null }, { origem: "incorporacao", glb_url: null, itens_versao_publicada: null }]);
    // origem 'fonte' entra (com fonte_slug); outra origem continua recusada; 'fonte' sem slug também.
    await b.pg.exec(`INSERT INTO maquetes_3d (token, titulo, origem, tipo, status, fonte_slug) VALUES ('tok-fonte-00000000000001', 'Planta', 'fonte', 'casa', 'validada', 'x')`);
    await expect(b.pg.exec(`INSERT INTO maquetes_3d (token, titulo, origem, tipo, status) VALUES ('tok-outra-00000000000001', 'P', 'avulsa', 'casa', 'validada')`)).rejects.toThrow();
    await expect(b.pg.exec(`INSERT INTO maquetes_3d (token, titulo, origem, tipo, status) VALUES ('tok-fonte-00000000000002', 'P', 'fonte', 'casa', 'validada')`)).rejects.toThrow();
    // As regras antigas continuam: projeto sem projeto/cliente é recusado.
    await expect(b.pg.exec(`INSERT INTO maquetes_3d (token, titulo, origem, tipo, status) VALUES ('tok-proj-000000000000002', 'P', 'projeto', 'casa', 'liberada')`)).rejects.toThrow();
    // Uma maquete por planta.
    await expect(b.pg.exec(`INSERT INTO maquetes_3d (token, titulo, origem, tipo, status, fonte_slug) VALUES ('tok-fonte-00000000000003', 'P2', 'fonte', 'casa', 'validada', 'x')`)).rejects.toThrow();
    const ck = await b.pg.query<{ conname: string }>(`SELECT conname FROM pg_constraint WHERE conrelid = 'maquetes_3d'::regclass AND contype = 'c' ORDER BY conname`);
    expect(ck.rows.map(r => r.conname)).toEqual(expect.arrayContaining(["maquetes_3d_origem_alvo_ck", "maquetes_3d_origem_check"]));
    // Lotes: slug só a-z/0-9/hífen, único por empreendimento.
    await b.pg.exec(`INSERT INTO maquete_3d_lotes (empreendimento_slug, lote_slug, maquete_id) VALUES ('vila-esmeralda', 'qd18-lote4', 3)`);
    await expect(b.pg.exec(`INSERT INTO maquete_3d_lotes (empreendimento_slug, lote_slug, maquete_id) VALUES ('vila-esmeralda', 'qd18-lote4', 3)`)).rejects.toThrow();
    await expect(b.pg.exec(`INSERT INTO maquete_3d_lotes (empreendimento_slug, lote_slug, maquete_id) VALUES ('Vila Esmeralda', 'x', 3)`)).rejects.toThrow();
  });

  it("só aditiva: sem DROP de tabela/coluna, DELETE, TRUNCATE nem UPDATE no texto; DROP só de CHECK e gatilho recriados", () => {
    const sem = SQL_0146.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
    expect(sem).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX|FUNCTION)/i);
    expect(sem).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE\s+(TABLE\s+)?"|UPDATE\s+")/i);
    const drops = sem.match(/DROP\s+\w+\s+IF EXISTS\s+"?\w+"?/gi) ?? [];
    expect(drops.map(d => d.replace(/\s+/g, " "))).toEqual([
      'DROP CONSTRAINT IF EXISTS "maquetes_3d_origem_check"', 'DROP CONSTRAINT IF EXISTS "maquetes_3d_origem_alvo_ck"',
      "DROP TRIGGER IF EXISTS maquete_3d_itens_imutavel_upd", "DROP TRIGGER IF EXISTS maquete_3d_itens_imutavel_trunc",
    ]);
    expect(sem).toMatch(/ADD CONSTRAINT "maquetes_3d_origem_check" CHECK \("origem" IN \('projeto', 'incorporacao', 'fonte'\)\)/);
  });

  it("versão gravada é imutável: não muda itens, não apaga, não volta de situação; só anda rascunho → publicada → arquivada", async () => {
    const b = await criarBanco();
    await b.pg.exec(`INSERT INTO maquetes_3d (token, titulo, origem, tipo, status, fonte_slug) VALUES ('tok-fonte-00000000000001', 'Planta', 'fonte', 'casa', 'validada', 'x');
      INSERT INTO maquete_3d_itens (maquete_id, versao, itens, quantidade, modelo_versao, estrutura_hash, situacao, autor_id) VALUES (1, 1, '[]', 0, 1, 'h', 'rascunho', 1)`);
    await expect(b.pg.exec(`UPDATE maquete_3d_itens SET itens = '[{"x":1}]'`)).rejects.toThrow(/MAQUETE_ITENS_IMUTAVEL/);
    await expect(b.pg.exec(`UPDATE maquete_3d_itens SET versao = 2`)).rejects.toThrow(/MAQUETE_ITENS_IMUTAVEL/);
    await expect(b.pg.exec(`UPDATE maquete_3d_itens SET autor_id = 2`)).rejects.toThrow(/MAQUETE_ITENS_IMUTAVEL/);
    await expect(b.pg.exec(`DELETE FROM maquete_3d_itens`)).rejects.toThrow(/MAQUETE_ITENS_IMUTAVEL/);
    await expect(b.pg.exec(`TRUNCATE maquete_3d_itens`)).rejects.toThrow(/MAQUETE_ITENS_IMUTAVEL/);
    await b.pg.exec(`UPDATE maquete_3d_itens SET situacao = 'publicada', publicada_em = now(), publicada_por = 1`);
    await expect(b.pg.exec(`UPDATE maquete_3d_itens SET situacao = 'rascunho'`)).rejects.toThrow(/MAQUETE_ITENS_IMUTAVEL/);
    await expect(b.pg.exec(`UPDATE maquete_3d_itens SET publicada_em = now() + interval '1 day'`)).rejects.toThrow(/MAQUETE_ITENS_IMUTAVEL/);
    await b.pg.exec(`UPDATE maquete_3d_itens SET situacao = 'arquivada'`);
    await expect(b.pg.exec(`UPDATE maquete_3d_itens SET situacao = 'publicada'`)).rejects.toThrow(/MAQUETE_ITENS_IMUTAVEL/);
    // Excluir o autor continua funcionando (ON DELETE SET NULL passa pelo gatilho).
    await b.pg.exec(`DELETE FROM users WHERE id = 1`);
    expect((await b.pg.query<{ autor_id: number | null }>("SELECT autor_id FROM maquete_3d_itens")).rows[0].autor_id).toBeNull();
  });
});

describe("router maquete3d.itens", () => {
  beforeEach(async () => {
    banco = await criarBanco(true);
    vi.mocked(getDb).mockReset();
    vi.mocked(getDb).mockReturnValue(banco.db as never);
  });

  it("abrir cria a maquete da planta uma vez só (semente idempotente) e devolve a estrutura do servidor com os itens padrão", async () => {
    const [a, b] = await Promise.all([admin().abrir({ planta: PLANTA }), caller(2).abrir({ planta: PLANTA })]);
    expect(a.maqueteId).toBe(b.maqueteId);
    const { rows } = await banco.pg.query<{ n: number; origem: string; status: string }>(`SELECT count(*)::int AS n, min(origem) AS origem, min(status) AS status FROM maquetes_3d WHERE fonte_slug = 'lote4-qd18'`);
    expect(rows[0]).toEqual({ n: 1, origem: "fonte", status: "validada" });
    expect(a).toMatchObject({ slug: PLANTA, versaoBase: 0, situacao: "padrao", versaoPublicada: null, rascunhoNaoPublicado: false, estruturaMudou: false });
    expect(a.fonte.itens).toEqual(padrao());
    expect(a.fonte.estrutura).toEqual(fonteDoRepo(PLANTA).estrutura);
    expect(a.problemas.filter(p => p.nivel === "erro")).toEqual([]);
    // As maquetes antigas não aparecem misturadas e a lista antiga não mostra a da planta.
    const lista = await appRouter.createCaller({ user: { id: 1, role: "admin", permissions: "[]", active: true, name: "x" }, req: {}, res: {} } as never).maquete3d.listar({});
    expect(lista.map(l => l.titulo)).toEqual(["Estudo antigo", "Casa antiga"]);
    await expect(admin().abrir({ planta: "outra-planta" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("mover → salvar → recarregar mantém o estado (rascunho), sem tocar na estrutura", async () => {
    const aberto = await admin().abrir({ planta: PLANTA });
    const itens = mover(aberto.fonte.itens, "sofa", { z: 6.2 }).map(i => (i.id === "geladeira" ? girar(i, 0) : i));
    const s = await admin().salvar({ planta: PLANTA, versaoBase: 0, itens });
    expect(s.versao).toBe(1);
    const de = await admin().abrir({ planta: PLANTA });
    expect(de).toMatchObject({ versaoBase: 1, situacao: "rascunho", rascunhoNaoPublicado: true, versaoPublicada: null });
    expect(de.fonte.itens.find(i => i.id === "sofa")!.z).toBe(6.2);
    expect(de.fonte.estrutura).toEqual(fonteDoRepo(PLANTA).estrutura);
    expect(de.ultimaSalva).toMatchObject({ versao: 1, autor: "Admin Um" });
    const { rows } = await banco.pg.query<{ estrutura_hash: string; situacao: string; quantidade: number; modelo_versao: number }>("SELECT estrutura_hash, situacao, quantidade, modelo_versao FROM maquete_3d_itens");
    expect(rows).toEqual([{ estrutura_hash: hashDaEstrutura(fonteDoRepo(PLANTA)), situacao: "rascunho", quantidade: itens.length, modelo_versao: 1 }]);
    // O modelo (estrutura) da maquete não mudou com o salvamento dos itens.
    const m = await banco.pg.query<{ modelo_versao: number }>(`SELECT modelo_versao FROM maquetes_3d WHERE fonte_slug = 'lote4-qd18'`);
    expect(m.rows[0].modelo_versao).toBe(1);
  });

  it("cada regra violada recusa salvar no SERVIDOR (mesmas regras da tela), com a mensagem em português", async () => {
    await admin().abrir({ planta: PLANTA });
    const p = padrao();
    const casos: [string, ItemFonte[], RegExp][] = [
      ["porta", mover(p.filter(i => i.id !== "bancada-pia"), "geladeira", { x: 0.54, z: 1.36, rot: 0 }), /P3.*porta bloqueada/],
      ["parede", mover(p, "geladeira", { x: 2.0 }), /atravessa a parede/],
      ["ambiente", mover(p, "cama-q1", { ambiente: "Sala" }), /sai do ambiente/],
      ["vão", mover(p, "criado-q1-a", { x: 2.67, z: 3.725 }), /ocupa o vão/],
      ["janela", mover(p.filter(i => i.id !== "bancada-pia"), "geladeira", { x: 1.48, z: 1.36, rot: 0 }), /debaixo da janela/],
      ["sobreposição", mover(p, "cadeira-1", { x: 1.15, z: 4.7 }), /ocupam o mesmo lugar/],
    ];
    for (const [nome, itens, msg] of casos)
      await expect(admin().salvar({ planta: PLANTA, versaoBase: 0, itens }), nome).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(msg) });
    // Formato: HTML, cor e material fora da lista, campo de estrutura enviado junto.
    for (const ruim of [mover(p, "sofa", { cor: "javascript:alert(1)" }), mover(p, "sofa", { material: "ouro" as never }), mover(p, "sofa", { nota: "<script>x</script>" }),
      p.map(i => (i.id === "sofa" ? { ...i, paredes: [] } : i))])
      await expect(admin().salvar({ planta: PLANTA, versaoBase: 0, itens: ruim })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await banco.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM maquete_3d_itens")).rows[0].n).toBe(0);
  });

  it("rascunho × publicado: publicar troca o que o cliente vê; um rascunho novo não aparece até publicar", async () => {
    await admin().abrir({ planta: PLANTA });
    const v1 = await admin().salvar({ planta: PLANTA, versaoBase: 0, itens: mover(padrao(), "sofa", { z: 6.2 }) });
    const { maqueteId } = await admin().abrir({ planta: PLANTA });
    expect(await itensPublicados(maqueteId)).toBeNull(); // rascunho nunca é público
    await admin().publicar({ planta: PLANTA, versao: v1.versao, publicadaVista: null });
    expect((await itensPublicados(maqueteId))!.itens.find(i => i.id === "sofa")!.z).toBe(6.2);
    const v2 = await admin().salvar({ planta: PLANTA, versaoBase: 1, itens: mover(padrao(), "rack-tv", { z: 6.4 }) });
    expect(v2.versao).toBe(2);
    expect((await itensPublicados(maqueteId))!.versao).toBe(1); // o cliente continua vendo a publicada
    const aberto = await admin().abrir({ planta: PLANTA });
    expect(aberto).toMatchObject({ versaoBase: 2, situacao: "rascunho", versaoPublicada: 1, rascunhoNaoPublicado: true });
    await admin().publicar({ planta: PLANTA, versao: 2, publicadaVista: 1 });
    expect((await itensPublicados(maqueteId))!.itens.find(i => i.id === "rack-tv")!.z).toBe(6.4);
    const versoes = await admin().versoes({ planta: PLANTA });
    expect(versoes.map(v => [v.versao, v.situacao, v.emUso])).toEqual([[2, "publicada", true], [1, "arquivada", false]]);
    expect((await admin().abrir({ planta: PLANTA })).situacao).toBe("publicada");
    // Publicar de novo a mesma versão não muda nada.
    expect(await admin().publicar({ planta: PLANTA, versao: 2, publicadaVista: 2 })).toMatchObject({ jaPublicada: true });
  });

  it("concorrência: salvar com base desatualizada e publicar versão que não é a última → CONFLICT", async () => {
    await admin().abrir({ planta: PLANTA });
    await admin().salvar({ planta: PLANTA, versaoBase: 0, itens: mover(padrao(), "sofa", { z: 6.2 }) });
    // A segunda aba ainda pensa que não havia versão.
    await expect(caller(2).salvar({ planta: PLANTA, versaoBase: 0, itens: padrao() })).rejects.toMatchObject({ code: "CONFLICT" });
    // Duas abas com a mesma base ao mesmo tempo: só uma grava.
    const r = await Promise.allSettled([admin().salvar({ planta: PLANTA, versaoBase: 1, itens: padrao() }), caller(2).salvar({ planta: PLANTA, versaoBase: 1, itens: padrao() })]);
    expect(r.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect((r.find(x => x.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "CONFLICT" });
    await expect(admin().publicar({ planta: PLANTA, versao: 1, publicadaVista: null })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(admin().publicar({ planta: PLANTA, versao: 9, publicadaVista: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await admin().publicar({ planta: PLANTA, versao: 2, publicadaVista: null });
  });

  it("publicação concorrente: quem publica com a versão publicada desatualizada recebe CONFLICT e a mais nova continua valendo", async () => {
    const { maqueteId } = await admin().abrir({ planta: PLANTA }); // admin 1 vê: nada publicado
    await admin().salvar({ planta: PLANTA, versaoBase: 0, itens: mover(padrao(), "sofa", { z: 6.2 }) });
    await caller(2).publicar({ planta: PLANTA, versao: 1, publicadaVista: null }); // admin 2 publica a v1
    await caller(2).salvar({ planta: PLANTA, versaoBase: 1, itens: mover(padrao(), "rack-tv", { z: 6.4 }) });
    await caller(2).publicar({ planta: PLANTA, versao: 2, publicadaVista: 1 });
    await admin().salvar({ planta: PLANTA, versaoBase: 2, itens: mover(padrao(), "sofa", { z: 6.25 }) });
    // Admin 1 ainda acha que nada está publicado: não sobrescreve a v2 sem saber.
    await expect(admin().publicar({ planta: PLANTA, versao: 3, publicadaVista: null })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/Outra pessoa publicou/) });
    expect((await itensPublicados(maqueteId))!.versao).toBe(2);
    await expect(admin().publicar({ planta: PLANTA, versao: 3, publicadaVista: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await admin().publicar({ planta: PLANTA, versao: 3, publicadaVista: 2 })).toMatchObject({ versao: 3, jaPublicada: false });
    const { rows } = await banco.pg.query<{ versao: number; situacao: string }>("SELECT versao, situacao FROM maquete_3d_itens ORDER BY versao");
    expect(rows.map(r => [r.versao, r.situacao])).toEqual([[1, "arquivada"], [2, "arquivada"], [3, "publicada"]]);
  });

  it("publicar revalida no servidor: versão gravada com problema (ou de outra estrutura) não é publicada", async () => {
    const { maqueteId } = await admin().abrir({ planta: PLANTA });
    const ruim = JSON.stringify(mover(padrao(), "geladeira", { x: 2.0 }));
    await banco.pg.query(`INSERT INTO maquete_3d_itens (maquete_id, versao, itens, quantidade, modelo_versao, estrutura_hash, situacao) VALUES ($1, 1, $2, 22, 1, $3, 'rascunho')`, [maqueteId, ruim, hashDaEstrutura(fonteDoRepo(PLANTA))]);
    await expect(admin().publicar({ planta: PLANTA, versao: 1, publicadaVista: null })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/atravessa a parede/) });
    await banco.pg.query(`INSERT INTO maquete_3d_itens (maquete_id, versao, itens, quantidade, modelo_versao, estrutura_hash, situacao) VALUES ($1, 2, $2, 22, 1, 'estrutura-antiga', 'rascunho')`, [maqueteId, JSON.stringify(padrao())]);
    await expect(admin().publicar({ planta: PLANTA, versao: 2, publicadaVista: null })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/estrutura/) });
    expect((await admin().abrir({ planta: PLANTA })).estruturaMudou).toBe(true);
    expect(await itensPublicados(maqueteId)).toBeNull();
  });

  it("editavel:false enviado pela tela não isenta de regra: a geladeira elevada na frente da P3 é recusada; item travado da FONTE continua sem poder mudar", async () => {
    await admin().abrir({ planta: PLANTA });
    const p = padrao();
    const ruim = mover(p.filter(i => i.id !== "bancada-pia"), "geladeira", { x: 0.54, z: 1.36, elev: 2.2, alt: 0.3, editavel: false });
    await expect(admin().salvar({ planta: PLANTA, versaoBase: 0, itens: ruim })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/não pode ficar elevado/) });
    // `alcanca` inventado em item marcado como travado pela tela: gravado o derivado, e editavel volta ao da fonte.
    const s = await admin().salvar({ planta: PLANTA, versaoBase: 0, itens: mover(p, "sofa", { alcanca: ["Quarto 1"], editavel: false }) });
    const aberto = await admin().abrir({ planta: PLANTA });
    expect(aberto.versaoBase).toBe(s.versao);
    expect(aberto.fonte.itens.find(i => i.id === "sofa")).toMatchObject({ editavel: true });
    expect(aberto.fonte.itens.find(i => i.id === "sofa")!.alcanca).toBeUndefined();
    // Item travado NA FONTE (simulado no JSON do servidor): mudar continua recusado, mesmo mandando editavel:true.
    const f = fonteDoRepo(PLANTA), original = f.itens;
    try {
      f.itens = original.map(i => (i.id === "geladeira" ? { ...i, editavel: false } : i));
      await expect(admin().salvar({ planta: PLANTA, versaoBase: 1, itens: mover(f.itens, "geladeira", { z: 1.5, editavel: true }) }))
        .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/travados.*geladeira/) });
      // Igual à fonte, só com editavel:true vindo da tela: passa (o valor é o da fonte) e grava travado.
      await admin().salvar({ planta: PLANTA, versaoBase: 1, itens: mover(f.itens, "geladeira", { editavel: true }) });
      const { rows } = await banco.pg.query<{ itens: string }>("SELECT itens FROM maquete_3d_itens WHERE versao = 2");
      expect((JSON.parse(rows[0].itens) as ItemFonte[]).find(i => i.id === "geladeira")!.editavel).toBe(false);
    } finally { f.itens = original; }
  });

  it("estrutura mudou: abrir sinaliza precisaRegravar; salvar sem mudar itens cria versão nova com o hash atual e libera publicar", async () => {
    const { maqueteId } = await admin().abrir({ planta: PLANTA });
    expect((await admin().abrir({ planta: PLANTA })).precisaRegravar).toBe(false);
    const itens = mover(padrao(), "sofa", { z: 6.2 });
    await banco.pg.query(`INSERT INTO maquete_3d_itens (maquete_id, versao, itens, quantidade, modelo_versao, estrutura_hash, situacao) VALUES ($1, 1, $2, $3, 1, 'estrutura-antiga', 'rascunho')`, [maqueteId, JSON.stringify(itens), itens.length]);
    const aberto = await admin().abrir({ planta: PLANTA });
    expect(aberto).toMatchObject({ versaoBase: 1, precisaRegravar: true, estruturaMudou: true });
    await expect(admin().publicar({ planta: PLANTA, versao: 1, publicadaVista: null })).rejects.toMatchObject({ code: "CONFLICT" });
    // Os mesmos itens, sem mudança nenhuma: grava a versão 2 com o hash da estrutura atual.
    const s = await admin().salvar({ planta: PLANTA, versaoBase: 1, itens: aberto.fonte.itens });
    expect(s.versao).toBe(2);
    const { rows } = await banco.pg.query<{ estrutura_hash: string; itens: string }>("SELECT estrutura_hash, itens FROM maquete_3d_itens WHERE versao = 2");
    expect(rows[0].estrutura_hash).toBe(hashDaEstrutura(fonteDoRepo(PLANTA)));
    expect(canonicoItens(rows[0].itens)).toBe(canonicoItens(JSON.stringify(itens)));
    expect((await admin().abrir({ planta: PLANTA })).precisaRegravar).toBe(false);
    expect(await admin().publicar({ planta: PLANTA, versao: 2, publicadaVista: null })).toMatchObject({ versao: 2, jaPublicada: false });
  });

  it("restaurar padrão grava um rascunho com os itens da planta", async () => {
    await admin().abrir({ planta: PLANTA });
    await admin().salvar({ planta: PLANTA, versaoBase: 0, itens: mover(padrao(), "sofa", { z: 6.2 }) });
    const r = await admin().restaurarPadrao({ planta: PLANTA, versaoBase: 1 });
    expect(r.versao).toBe(2);
    const a = await admin().abrir({ planta: PLANTA });
    expect(a.fonte.itens).toEqual(padrao());
    expect((await admin().versoes({ planta: PLANTA }))[0]).toMatchObject({ versao: 2, origem: "restauracao", situacao: "rascunho", autor: "Admin Um" });
    await expect(admin().restaurarPadrao({ planta: PLANTA, versaoBase: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("permissões: só o administrador; corretor, colaborador (mesmo com o módulo), empreiteiro, cliente e anônimo são barrados sem consulta ao banco", async () => {
    const quem: [string, ReturnType<typeof caller>][] = [
      ["corretor", caller(5, "corretor")], ["colaborador com o módulo", caller(3, "colaborador", JSON.stringify(["maquete3d"]))],
      ["colaborador sem módulo", caller(3, "colaborador")], ["empreiteiro", caller(6, "empreiteiro")], ["engenheiro (papel inexistente)", caller(7, "engenheiro")],
      ["cliente", caller(8, "cliente")], ["anônimo", caller(null)],
    ];
    vi.mocked(getDb).mockClear();
    for (const [nome, c] of quem) {
      for (const chamada of [
        () => c.abrir({ planta: PLANTA }), () => c.salvar({ planta: PLANTA, versaoBase: 0, itens: padrao() }),
        () => c.publicar({ planta: PLANTA, versao: 1, publicadaVista: null }), () => c.restaurarPadrao({ planta: PLANTA, versaoBase: 0 }), () => c.versoes({ planta: PLANTA }),
      ]) {
        const e = await chamada().then(() => null, (x: { code: string }) => x);
        expect(e?.code, nome).toMatch(/^(FORBIDDEN|UNAUTHORIZED)$/);
      }
    }
    expect(vi.mocked(getDb)).not.toHaveBeenCalled();
    expect((await banco.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM maquetes_3d WHERE fonte_slug IS NOT NULL")).rows[0].n).toBe(0);
  });
});
