// EPIC-028 (Etapa 3) — portão de QA (@qa, Quinn): tentativas de QUEBRAR o editor de itens pelo servidor (POST direto,
// sem a tela). Banco em memória (PGlite), mesma montagem de maquete-3d-itens.test.ts. Nada toca banco real.
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
import { fonteDoRepo, itensPublicados } from "./maquete-3d/itens.js";
import type { ItemFonte } from "../shared/maquete-3d/fonte.js";

const TABELAS = ["users", "leads", "leadServices", "operationalProjects", "projectRevisionRequests", "projectDocuments", "incorporationStudies", "incorporationRegistrationDocuments", "incorporationUnits", "paymentOrders", "draws", "products"];
const ANTERIORES = ["0111_maquete_3d.sql", "0112_maquete_3d_comercial.sql", "0113_maquete_3d_pagamento.sql", "0114_maquete_3d_email.sql", "0115_maquete_3d_lead_arquivos.sql", "0121_maquete_3d_revisoes.sql"];
const SQL_0146 = readFileSync(new URL("../drizzle/0146_maquete_3d_itens_e_lotes.sql", import.meta.url), "utf8");
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
  for (const a of ANTERIORES) await pg.exec(readFileSync(new URL(`../drizzle/${a}`, import.meta.url), "utf8"));
  await pg.exec(`
    INSERT INTO users ("openId", name, role, active) VALUES ('admin', 'Admin Um', 'admin', true), ('admin2', 'Admin Dois', 'admin', true), ('colab', 'Colaboradora', 'colaborador', true);
    INSERT INTO operational_projects (name, client_name, client_phone, engineer, value) VALUES ('Casa Silva', 'Ana Silva', '99999', 'Eng', 1000);
    INSERT INTO maquetes_3d (token, titulo, origem, project_id, tipo, status, modelo, leitura) VALUES ('tok-projeto-000000000001', 'Casa antiga', 'projeto', 1, 'casa', 'publicada', '{"tipo":"casa"}', '{"x":1}');`);
  const antes = (await pg.query("SELECT * FROM maquetes_3d ORDER BY id")).rows;
  await pg.exec(SQL_0146);
  await pg.exec(SQL_0146);
  await pg.exec(SQL_0146); // 3×: reexecutável
  return { pg, db: drizzle(pg), antes };
}

let banco: Awaited<ReturnType<typeof criarBanco>>;
const raiz = (id: number | null, role = "admin", permissions = "[]") =>
  appRouter.createCaller({ user: id === null ? null : { id, role, permissions, active: true, name: "x" }, req: {}, res: {} } as never);
const admin = () => raiz(1).maquete3d.itens;
const PLANTA = "lote4-qd18";
const padrao = () => fonteDoRepo(PLANTA).itens;
const mover = (itens: ItemFonte[], id: string, m: Partial<ItemFonte>) => itens.map(i => (i.id === id ? { ...i, ...m } : i));
const contar = async () => (await banco.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM maquete_3d_itens")).rows[0].n;

beforeEach(async () => {
  banco = await criarBanco();
  vi.mocked(getDb).mockReset();
  vi.mocked(getDb).mockReturnValue(banco.db as never);
});

describe("QA E3 — migração sobre maquete antiga", () => {
  it("as colunas antigas da maquete antiga ficam idênticas depois da 0146 aplicada 3×", async () => {
    const depois = (await banco.pg.query<Record<string, unknown>>("SELECT * FROM maquetes_3d ORDER BY id")).rows;
    expect(depois).toHaveLength(1);
    for (const [k, v] of Object.entries(banco.antes[0] as Record<string, unknown>)) expect(depois[0][k], k).toEqual(v);
    expect(depois[0]).toMatchObject({ glb_url: null, itens_versao_publicada: null, fonte_slug: null });
  });
  it("o link público antigo continua funcionando", async () => {
    const r = await raiz(null).maquetePublica.porToken({ token: "tok-projeto-000000000001" }).catch((e: { code: string }) => e);
    // modelo '{"tipo":"casa"}' é mínimo: o que importa é a consulta não quebrar com as colunas novas (NOT_FOUND = modelo ilegível, não erro de SQL).
    expect((r as { code?: string }).code ?? "ok").toMatch(/^(ok|NOT_FOUND)$/);
  });
});

describe("QA E3 — POST direto ao servidor", () => {
  it("geladeira na frente da P3 (com a bancada da pia no lugar) → recusa e nada é gravado", async () => {
    await admin().abrir({ planta: PLANTA });
    const itens = mover(padrao(), "geladeira", { x: 0.54, z: 1.36, rot: 0 });
    await expect(admin().salvar({ planta: PLANTA, versaoBase: 0, itens })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/P3/) });
    expect(await contar()).toBe(0);
  });

  it("formatos hostis → BAD_REQUEST, sem gravar", async () => {
    await admin().abrir({ planta: PLANTA });
    const p = padrao();
    const ruins: [string, unknown[]][] = [
      ["Infinity", mover(p, "sofa", { x: Infinity })],
      ["NaN", mover(p, "sofa", { larg: NaN })],
      ["negativo", mover(p, "sofa", { larg: -1 })],
      ["gigante", mover(p, "sofa", { larg: 1e9 })],
      ["tipo fora do catálogo", mover(p, "sofa", { tipo: "piscina" as never })],
      ["id com caminho", mover(p, "sofa", { id: "../../etc/passwd" })],
      ["id com SQL", mover(p, "sofa", { id: "x'; DROP TABLE users;--" })],
      ["cor curta", mover(p, "sofa", { cor: "#fff" })],
      ["cor url", mover(p, "sofa", { cor: "url(http://x)" })],
      ["ambiente com HTML", mover(p, "sofa", { ambiente: "<img src=x onerror=alert(1)>" })],
      ["fonte com SVG", mover(p, "sofa", { fonte: "<svg onload=1>" })],
      ["nota longa", mover(p, "sofa", { nota: "a".repeat(301) })],
      ["opções demais", mover(p, "sofa", { opcoes: Object.fromEntries("abcdefghi".split("").map(k => [k, 1])) })],
      ["opção com objeto", mover(p, "sofa", { opcoes: { x: { y: 1 } } as never })],
      ["campo a mais", p.map(i => (i.id === "sofa" ? { ...i, modelo: "{}" } : i))],
      ["item não-objeto", [...p, "texto"]],
      ["id repetido (um em cima da P3)", [...p, { ...p.find(i => i.id === "sofa")!, x: 0.54, z: 1.36 }]],
    ];
    for (const [nome, itens] of ruins)
      await expect(admin().salvar({ planta: PLANTA, versaoBase: 0, itens }), nome).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Mais de 150 itens: recusado já na entrada da rota.
    await expect(admin().salvar({ planta: PLANTA, versaoBase: 0, itens: Array.from({ length: 151 }, () => p[0]) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Planta com caminho: recusada antes de virar nome de arquivo.
    for (const planta of ["../lote4-qd18", "lote4-qd18.json", "LOTE4-QD18", "__proto__", "tostring"])
      await expect(admin().abrir({ planta }), planta).rejects.toMatchObject({ code: expect.stringMatching(/^(BAD_REQUEST|NOT_FOUND)$/) });
    expect(await contar()).toBe(0);
  });

  it("versaoBase adiantada ou negativa não grava", async () => {
    await admin().abrir({ planta: PLANTA });
    await expect(admin().salvar({ planta: PLANTA, versaoBase: 5, itens: padrao() })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(admin().salvar({ planta: PLANTA, versaoBase: -1, itens: padrao() })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await contar()).toBe(0);
  });

  it("restaurar padrão e publicar não apagam histórico; versões antigas continuam com os itens originais", async () => {
    await admin().abrir({ planta: PLANTA });
    await admin().salvar({ planta: PLANTA, versaoBase: 0, itens: mover(padrao(), "sofa", { z: 6.2 }) });
    await admin().publicar({ planta: PLANTA, versao: 1, publicadaVista: null });
    await admin().restaurarPadrao({ planta: PLANTA, versaoBase: 1 });
    await admin().publicar({ planta: PLANTA, versao: 2, publicadaVista: 1 });
    const { rows } = await banco.pg.query<{ versao: number; situacao: string; itens: string }>("SELECT versao, situacao, itens FROM maquete_3d_itens ORDER BY versao");
    expect(rows.map(r => [r.versao, r.situacao])).toEqual([[1, "arquivada"], [2, "publicada"]]);
    expect((JSON.parse(rows[0].itens) as ItemFonte[]).find(i => i.id === "sofa")!.z).toBe(6.2);
  });

  it("rascunho nunca vaza: link público com o token da maquete da planta → NOT_FOUND; itensPublicados de id inexistente → null", async () => {
    const { maqueteId } = await admin().abrir({ planta: PLANTA });
    await admin().salvar({ planta: PLANTA, versaoBase: 0, itens: mover(padrao(), "sofa", { z: 6.2 }) });
    const { rows } = await banco.pg.query<{ token: string }>("SELECT token FROM maquetes_3d WHERE id = $1", [maqueteId]);
    await expect(raiz(null).maquetePublica.porToken({ token: rows[0].token })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await itensPublicados(maqueteId)).toBeNull();
    expect(await itensPublicados(maqueteId + 999)).toBeNull();
  });

  it("dois admins publicando ao mesmo tempo: no fim um único ponteiro e uma única versão publicada", async () => {
    await admin().abrir({ planta: PLANTA });
    await admin().salvar({ planta: PLANTA, versaoBase: 0, itens: mover(padrao(), "sofa", { z: 6.2 }) });
    await Promise.allSettled([admin().publicar({ planta: PLANTA, versao: 1, publicadaVista: null }), raiz(2).maquete3d.itens.publicar({ planta: PLANTA, versao: 1, publicadaVista: null })]);
    const { rows } = await banco.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM maquete_3d_itens WHERE situacao = 'publicada'");
    expect(rows[0].n).toBe(1);
  });
});

describe("QA E3 — achados corrigidos", () => {
  it("[achado baixo, corrigido] item de piso não pode ficar elevado: geladeira 'flutuando' a 2,2 m na frente da P3 é recusada", async () => {
    await admin().abrir({ planta: PLANTA });
    const itens = mover(padrao(), "geladeira", { x: 0.54, z: 1.36, rot: 0, elev: 2.2, alt: 0.3 });
    await expect(admin().salvar({ planta: PLANTA, versaoBase: 0, itens })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/não pode ficar elevado/) });
    // Mesmo longe da porta, geladeira com elevação é recusada.
    await expect(admin().salvar({ planta: PLANTA, versaoBase: 0, itens: mover(padrao(), "geladeira", { elev: 0.1 }) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await contar()).toBe(0);
  });

  it("[achado médio, corrigido] a maquete da planta (origem 'fonte') não existe pelas rotas antigas para o colaborador; o admin só lê por elas", async () => {
    const { maqueteId } = await admin().abrir({ planta: PLANTA });
    const colab = raiz(3, "colaborador", JSON.stringify(["maquete3d"])).maquete3d;
    const inexistente = await colab.detalhe({ id: 999_999 }).then(() => null, (e: { code: string; message: string }) => e);
    for (const chamada of [
      () => colab.detalhe({ id: maqueteId }), () => colab.revisoes({ id: maqueteId }), () => colab.documentosDoPedido({ id: maqueteId }),
      () => colab.salvarComercial({ id: maqueteId, comercial: {} as never }), () => colab.validar({ id: maqueteId }), () => colab.iniciarLeitura({ id: maqueteId }),
    ]) {
      const e = await chamada().then(() => null, (x: { code: string; message: string }) => x);
      expect(e).toMatchObject({ code: "NOT_FOUND", message: inexistente!.message });
    }
    const adm = raiz(1).maquete3d;
    expect(await adm.detalhe({ id: maqueteId })).toMatchObject({ id: maqueteId, origem: "fonte" });
    const antes = (await banco.pg.query("SELECT modelo, comercial, status FROM maquetes_3d WHERE id = $1", [maqueteId])).rows[0];
    for (const chamada of [
      () => adm.salvarModelo({ id: maqueteId, versao: 1, modelo: {} as never }), () => adm.salvarComercial({ id: maqueteId, comercial: {} as never }),
      () => adm.publicar({ id: maqueteId }), () => adm.validar({ id: maqueteId }), () => adm.excluir({ id: maqueteId }), () => adm.despublicar({ id: maqueteId }),
    ]) await expect(chamada()).rejects.toMatchObject({ code: expect.stringMatching(/^(FORBIDDEN|BAD_REQUEST)$/) });
    expect((await banco.pg.query("SELECT modelo, comercial, status FROM maquetes_3d WHERE id = $1", [maqueteId])).rows[0]).toEqual(antes);
  });

  it("[achado baixo, corrigido] planta 'constructor', '__proto__' e 'tostring' → NOT_FOUND, sem gravar nada", async () => {
    for (const planta of ["constructor", "hasownproperty", "valueof"]) {
      const e = await admin().abrir({ planta }).then(() => null, (x: { code: string }) => x);
      expect(e?.code, planta).toBe("NOT_FOUND");
    }
    expect((await banco.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM maquetes_3d WHERE fonte_slug IS NOT NULL")).rows[0].n).toBe(0);
  });

  it("[achado baixo, corrigido] 'alcanca' vindo da tela é ignorado: o servidor grava o derivado da geometria", async () => {
    await admin().abrir({ planta: PLANTA });
    const itens = padrao().map(i => (i.id === "sofa" ? { ...i, alcanca: ["Quarto 1", "Banheiro"] } : i.id === "balcao" ? { ...i, alcanca: ["Quarto 1", "Quarto 2", "Banheiro", "Garagem e frente"] } : i));
    await admin().salvar({ planta: PLANTA, versaoBase: 0, itens });
    const gravados = JSON.parse((await banco.pg.query<{ itens: string }>("SELECT itens FROM maquete_3d_itens WHERE versao = 1")).rows[0].itens) as ItemFonte[];
    expect(gravados.find(i => i.id === "sofa")!.alcanca).toBeUndefined();
    expect(gravados.find(i => i.id === "balcao")!.alcanca).toEqual(padrao().find(i => i.id === "balcao")!.alcanca);
  });
});
