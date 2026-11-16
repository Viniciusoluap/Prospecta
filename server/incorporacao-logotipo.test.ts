// EPIC-024 S-02 — logotipo por empreendimento. Banco real em memória (PGlite) com a migração 0119.
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableColumns } from "drizzle-orm";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./routes/camadas-terreno.js", () => ({
  usuarioDaIncorporacao: vi.fn(async () => ({ id: 1, role: "admin", active: true })),
}));

import * as db from "./db.js";
import { appRouter } from "./routers.js";
import { ENV } from "./_core/env.js";
import { usuarioDaIncorporacao } from "./routes/camadas-terreno.js";
import logoRotas from "./routes/incorporacao-logo.js";
import { incorporationStudies } from "../drizzle/schema";
import { promptLogotipo, tipoDoLogo } from "../shared/incorporacao/logotipo";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a3e8d5b30000000049454e44ae426082", "hex");
const PNG_B = Buffer.concat([PNG, Buffer.from("estudo-b")]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF");
const SVG = Buffer.from('﻿<?xml version="1.0"?>\n<!-- logo --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="4"/></svg>');

let pg: PGlite;
const admin = (id = 1) => appRouter.createCaller({ user: { id, role: "admin", active: true }, req: {}, res: {} } as never);
let envio = 0;

async function enviar(studyId: number, dados: Buffer, nome: string, exibicao = PNG, user = 1) {
  const c = admin(user);
  const uploadId = `logo-teste-${String(++envio).padStart(12, "0")}`;
  await c.documentChunks.part({ uploadId, part: 0, total: 1, scope: `incorporacao-logo:${studyId}`, fileName: nome, base64: dados.toString("base64") });
  return c.incorporacao.logo.salvar({ studyId, uploadId, nome, exibicaoBase64: exibicao.toString("base64"), largura: 100, altura: 50 });
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`CREATE TABLE users (id serial PRIMARY KEY); INSERT INTO users DEFAULT VALUES;
    CREATE TABLE incorporation_studies (id serial PRIMARY KEY, name text);
    INSERT INTO incorporation_studies (name) VALUES ('Residencial A'), ('Loteamento B');`);
  const sql = readFileSync(new URL("../drizzle/0119_logotipo_empreendimento.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", "");
  await pg.exec(sql);
  await pg.exec(sql); // idempotente
});
beforeEach(() => {
  vi.spyOn(db, "getDb").mockReturnValue(drizzle(pg) as never);
  vi.spyOn(db, "getIncorporationStudyById").mockImplementation(async (id: number) =>
    (id === 1 || id === 2 ? { id, name: id === 1 ? "Residencial A" : "Loteamento B", city: "Imperatriz", state: "MA", incorporationType: "vertical" } : undefined) as never);
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => pg.close());

describe("tipo pelo conteúdo", () => {
  it("reconhece PNG, JPG, PDF e SVG pelos bytes e recusa o resto", () => {
    expect(tipoDoLogo(PNG)).toBe("image/png");
    expect(tipoDoLogo(JPG)).toBe("image/jpeg");
    expect(tipoDoLogo(PDF)).toBe("application/pdf");
    expect(tipoDoLogo(SVG)).toBe("image/svg+xml");
    expect(tipoDoLogo(Buffer.from("<html><svg></svg></html>"))).toBeNull();
    expect(tipoDoLogo(Buffer.from("GIF89a"))).toBeNull();
  });
  it("o pedido à IA usa só o nome e os dados do estudo", () => {
    const p = promptLogotipo({ name: " Residencial A ", city: "Imperatriz", state: "MA", incorporationType: "vertical" });
    expect(p).toContain('"Residencial A"');
    expect(p).toContain("Imperatriz/MA");
  });
});

describe("envio, troca e exclusão", () => {
  it("um logotipo por estudo; trocar marca o anterior; A nunca aparece em B", async () => {
    const a1 = await enviar(1, PNG, "logo.png");
    expect(a1).toMatchObject({ studyId: 1, mime: "image/png", origem: "envio", largura: 100 });
    expect(await admin().incorporacao.logo.obter({ studyId: 2 })).toBeNull();
    const a2 = await enviar(1, PDF, "Logo Final.pdf");
    expect(a2?.mime).toBe("application/pdf");
    expect(a2?.id).not.toBe(a1?.id);
    const ativos = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM incorporation_study_logos WHERE study_id = 1 AND deleted_at IS NULL");
    expect(ativos.rows[0].n).toBe(1);
    const b = await enviar(2, SVG, "b.svg", PNG_B);
    expect(b?.mime).toBe("image/svg+xml");
    expect((await admin().incorporacao.logo.obter({ studyId: 1 }))?.id).toBe(a2?.id);
    expect((await admin().incorporacao.logo.obter({ studyId: 2 }))?.id).toBe(b?.id);
    expect(b?.versao).not.toBe(a2?.versao);
  });

  it("recusa conteúdo que não bate com o tipo e exibição que não é PNG", async () => {
    await expect(enviar(1, Buffer.from("<html>oi</html>"), "falso.png")).rejects.toThrow(/PNG, JPG, SVG ou PDF/);
    await expect(enviar(1, JPG, "logo.png")).rejects.toThrow(/não corresponde à extensão/);
    await expect(enviar(1, PNG, "logo.png", JPG)).rejects.toThrow(/exibição/);
    await expect(enviar(99, PNG, "logo.png")).rejects.toThrow(/não encontrado/);
  });

  it("listagem: versões sem bytes e o estudo não tem coluna de logotipo", async () => {
    const versoes = await admin().incorporacao.logo.versoes();
    expect(versoes.map((v) => v.studyId).sort()).toEqual([1, 2]);
    for (const v of versoes) expect(Object.keys(v).sort()).toEqual(["altura", "largura", "studyId", "versao"]);
    const colunas = Object.values(getTableColumns(incorporationStudies)).map((c) => c.getSQLType());
    expect(colunas).not.toContain("bytea");
    expect(Object.keys(getTableColumns(incorporationStudies)).some((k) => /logo/i.test(k))).toBe(false);
  });

  it("rota de imagem: só o PNG de exibição, com ETag; original como download; estudo sem logo = 404", async () => {
    const app = express();
    app.use("/api", logoRotas);
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/incorporacao/logo`;
    try {
      const r = await fetch(`${base}/2`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await r.arrayBuffer()).equals(PNG_B)).toBe(true);
      const etag = r.headers.get("etag")!;
      expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
      expect((await fetch(`${base}/2`, { headers: { "If-None-Match": etag } })).status).toBe(304);
      const original = await fetch(`${base}/2/original`);
      expect(original.headers.get("content-disposition")).toMatch(/^attachment/);
      expect(Buffer.from(await original.arrayBuffer()).equals(SVG)).toBe(true);
      const a = await fetch(`${base}/1`);
      expect(Buffer.from(await a.arrayBuffer()).equals(PNG)).toBe(true);
      expect((await fetch(`${base}/3`)).status).toBe(404);
      vi.mocked(usuarioDaIncorporacao).mockResolvedValueOnce(false as never);
      expect((await fetch(`${base}/1`)).status).toBe(403);
    } finally {
      server.close();
    }
  });

  it("excluir tira só o logotipo daquele estudo", async () => {
    await admin().incorporacao.logo.excluir({ studyId: 1 });
    expect(await admin().incorporacao.logo.obter({ studyId: 1 })).toBeNull();
    expect(await admin().incorporacao.logo.obter({ studyId: 2 })).not.toBeNull();
  });

  it("sem o módulo Incorporação, nada passa", async () => {
    const c = appRouter.createCaller({ user: { id: 1, role: "colaborador", active: true, permissions: JSON.stringify(["obras"]) }, req: {}, res: {} } as never);
    await expect(c.incorporacao.logo.obter({ studyId: 2 })).rejects.toThrow(/permissão/i);
    await expect(c.incorporacao.logo.versoes()).rejects.toThrow(/permissão/i);
    await expect(c.incorporacao.logo.excluir({ studyId: 2 })).rejects.toThrow(/permissão/i);
    await expect(c.incorporacao.logo.gerarIa({ studyId: 2 })).rejects.toThrow(/permissão/i);
  });
});

describe("geração com IA", () => {
  const original = { url: ENV.forgeApiUrl, key: ENV.forgeApiKey };
  afterEach(() => { ENV.forgeApiUrl = original.url; ENV.forgeApiKey = original.key; vi.unstubAllGlobals(); });

  it("sem chave diz claramente que não está configurado e não chama nada", async () => {
    ENV.forgeApiUrl = ""; ENV.forgeApiKey = "";
    const rede = vi.fn();
    vi.stubGlobal("fetch", rede);
    expect(await admin().incorporacao.logo.iaDisponivel()).toMatchObject({ disponivel: false, faltando: ["BUILT_IN_FORGE_API_URL", "BUILT_IN_FORGE_API_KEY"] });
    const r = await admin().incorporacao.logo.gerarIa({ studyId: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/não configurada.*BUILT_IN_FORGE_API_URL e BUILT_IN_FORGE_API_KEY/);
    expect(rede).not.toHaveBeenCalled();
    expect(await admin().incorporacao.logo.obter({ studyId: 1 })).toBeNull(); // nada gravado
  });

  it("com o gerador configurado (falso no teste), devolve a proposta sem gravar", async () => {
    ENV.forgeApiUrl = "https://gerador.invalido/"; ENV.forgeApiKey = "chave-de-teste";
    const rede = vi.fn(async () => new Response(JSON.stringify({ image: { b64Json: PNG.toString("base64"), mimeType: "image/png" } })));
    vi.stubGlobal("fetch", rede);
    const r = await admin().incorporacao.logo.gerarIa({ studyId: 1 });
    expect(r).toMatchObject({ ok: true, mime: "image/png", base64: PNG.toString("base64") });
    expect(String(rede.mock.calls[0][0])).toContain("gerador.invalido");
    expect(JSON.parse((rede.mock.calls[0][1] as RequestInit).body as string).prompt).toContain('"Residencial A"');
    expect(await admin().incorporacao.logo.obter({ studyId: 1 })).toBeNull();
  });

  it("gerador fora do ar: falha honesta", async () => {
    ENV.forgeApiUrl = "https://gerador.invalido/"; ENV.forgeApiKey = "chave-de-teste";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro", { status: 503 })));
    const r = await admin().incorporacao.logo.gerarIa({ studyId: 1 });
    expect(r.ok).toBe(false);
  });
});
