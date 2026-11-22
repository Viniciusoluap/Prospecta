// QA (Quinn) — portão de SEGURANÇA independente da EPIC-028 Etapa 4 (página PÚBLICA do lote, sem login).
// Tenta quebrar: entradas estranhas (SQL, %00, ../, unicode, longas), enumeração, código fraco, vazamento da unidade
// (comprador/preço), campos internos da planta, XSS no texto do admin (página e WhatsApp) e a migração 0147.
// Banco em memória (PGlite), nada toca banco real nem rede.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as React from "react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn() }));
vi.mock("./_core/env.js", () => ({ ENV: { cookieSecret: "segredo-de-teste", anthropicApiKey: "" } }));

import * as schema from "../drizzle/schema.js";
import { getDb } from "./db.js";
import { appRouter } from "./routers.js";
import { MENSAGEM_NAO_ENCONTRADO, novoCodigo } from "./maquete-3d/lotes.js";
import { fonteDoRepo } from "./maquete-3d/itens.js";
import { ALFABETO_CODIGO, WHATSAPP_EMPRESA, linkWhatsAppDoLote, mensagemWhatsAppDoLote } from "../shared/maquete-3d/lote-publico.js";
import { fonteSchema } from "../shared/maquete-3d/fonte.js";

// O vitest deste repo compila .tsx com o JSX clássico (React.createElement).
(globalThis as { React?: typeof React }).React = React;

const TABELAS = ["users", "leads", "leadServices", "operationalProjects", "projectRevisionRequests", "projectDocuments", "incorporationStudies", "incorporationRegistrationDocuments", "incorporationUnits", "paymentOrders", "draws", "products"];
const ANTERIORES = ["0111_maquete_3d.sql", "0112_maquete_3d_comercial.sql", "0113_maquete_3d_pagamento.sql", "0114_maquete_3d_email.sql", "0115_maquete_3d_lead_arquivos.sql", "0121_maquete_3d_revisoes.sql", "0146_maquete_3d_itens_e_lotes.sql"];
const SQL_0147 = readFileSync(new URL("../drizzle/0147_maquete_3d_lote_link.sql", import.meta.url), "utf8");
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
    INSERT INTO users ("openId", name, role, active, email, phone) VALUES ('admin', 'Admin Um', 'admin', true, 'admin@empresa.test', '99988887777');
    INSERT INTO incorporation_studies (name, city) VALUES ('Loteamento Vila Esmeralda', 'Imperatriz');
    INSERT INTO incorporation_units (study_id, code, code_key, kind, status, buyer, sale_price) VALUES
      (1, 'QD 18 LOTE 04', 'QD 18 LOTE 04', 'lote', 'vendida', 'Fulano Comprador da Silva', 254321.77),
      (1, 'QD 18 LOTE 07', 'QD 18 LOTE 07', 'lote', 'bloqueada', 'Beltrana Secreta', 99999.01);`);
  await pg.exec(SQL_0147);
  return { pg, db: drizzle(pg) };
}

let banco: Awaited<ReturnType<typeof criarBanco>>;
const caller = (user: unknown) => appRouter.createCaller({ user, req: {}, res: {} } as never);
const admin = () => caller({ id: 1, role: "admin", permissions: "[]", active: true, name: "Admin Um" }).maquete3d;
const publico = () => caller(null).maquetePublica;
const PLANTA = "lote4-qd18";
const erroDe = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; message?: string }) => ({ code: e.code, message: e.message }));
const NF = { code: "NOT_FOUND", message: MENSAGEM_NAO_ENCONTRADO };
const partes = (c: string) => { const [, , empreendimento, lote] = c.split("/"); return { empreendimento, lote }; };

async function publicarELigar(textos = { empreendimentoNome: "Vila Esmeralda", quadra: "18", lote: "4" }, unitId: number | null = 1) {
  const aberto = await admin().itens.abrir({ planta: PLANTA });
  await admin().itens.salvar({ planta: PLANTA, versaoBase: 0, itens: aberto.fonte.itens });
  await admin().itens.publicar({ planta: PLANTA, versao: 1 });
  const { id } = await admin().lotes.salvar({ planta: PLANTA, empreendimentoSlug: "vila-esmeralda", loteSlug: "qd18-lote4", ...textos, itensVersao: null, unitId, ativo: true });
  const { lotes } = await admin().lotes.listar({ planta: PLANTA });
  return { id, caminho: lotes.find(l => l.id === id)!.caminho! };
}

describe("QA E4 — código do link", () => {
  it("gerado com crypto.randomInt (sem Math.random), 10 símbolos do alfabeto de 31, sem repetição em 5.000", () => {
    const fonte = readFileSync(new URL("./maquete-3d/lotes.ts", import.meta.url), "utf8");
    expect(fonte).toMatch(/import \{ randomInt \} from "node:crypto"/);
    expect(fonte).not.toMatch(/Math\.random/);
    expect(ALFABETO_CODIGO).toHaveLength(31);
    const vistos = new Set<string>();
    for (let i = 0; i < 5000; i++) { const c = novoCodigo(); expect(c).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/); vistos.add(c); }
    expect(vistos.size).toBe(5000);
    expect(10 * Math.log2(31)).toBeGreaterThan(49);
  });
});

describe("QA E4 — rota pública sob ataque", () => {
  beforeEach(async () => {
    banco = await criarBanco();
    vi.mocked(getDb).mockReset();
    vi.mocked(getDb).mockReturnValue(banco.db as never);
  });

  it("entradas hostis (SQL, %00, ../, unicode, NUL, longas): sempre o mesmo NOT_FOUND, nunca 500 e nada muda no banco", async () => {
    const { caminho } = await publicarELigar();
    const { empreendimento, lote } = partes(caminho);
    const codigo = lote.split("-").at(-1)!;
    const hostis = [
      "' OR '1'='1", "x' OR 1=1 --", "vila-esmeralda'; DROP TABLE maquete_3d_lotes; --", "%00", "vila\u0000esmeralda", "../../etc/passwd", "..%2F..%2F",
      "vila-esmeraldá", "ｖｉｌａ", "😀", "VILA-ESMERALDA", " vila-esmeralda", "vila-esmeralda ", "a".repeat(81), "a".repeat(1900), "\\", "<script>alert(1)</script>",
    ];
    const casos = [
      ...hostis.map(h => ({ empreendimento: h, lote })),
      ...hostis.map(h => ({ empreendimento, lote: h })),
      ...hostis.map(h => ({ empreendimento, lote: `${h}-${codigo}` })),
      { empreendimento, lote: `qd18-lote4-${codigo}'--` }, { empreendimento, lote: `qd18-lote4-${codigo}\u0000` }, { empreendimento, lote: `qd18-lote4-${codigo.toUpperCase()}` },
      { empreendimento, lote: `qd18-lote4-${codigo}x` }, { empreendimento, lote: `qd18-lote4--${codigo}` }, { empreendimento, lote: `%25-${codigo}` },
    ];
    for (const c of casos) expect(await erroDe(publico().porLote(c)), JSON.stringify(c).slice(0, 80)).toEqual(NF);
    // Acima do teto do zod (2000) a resposta é BAD_REQUEST: não depende de o lote existir (não é oráculo).
    expect((await erroDe(publico().porLote({ empreendimento: "a".repeat(2001), lote })))?.code).toBe("BAD_REQUEST");
    expect((await erroDe(publico().porLote({ empreendimento: 1 as never, lote })))?.code).toBe("BAD_REQUEST");
    expect((await banco.pg.query<{ n: number }>("SELECT count(*)::int AS n FROM maquete_3d_lotes")).rows[0].n).toBe(1);
    expect(await publico().porLote({ empreendimento, lote })).toBeTruthy();
  });

  it("enumeração: inexistente × código errado × sem publicação × desligado × unidade apagada → idênticos; código não entra antes do lote", async () => {
    // Sem publicação ainda: lote ligado com código.
    const { id } = await admin().lotes.salvar({ planta: PLANTA, empreendimentoSlug: "vila-esmeralda", loteSlug: "qd18-lote4", empreendimentoNome: "Vila Esmeralda", quadra: "18", lote: "4", itensVersao: null, unitId: 1, ativo: true });
    const { lotes } = await admin().lotes.listar({ planta: PLANTA });
    const certo = partes(lotes[0].caminho!);
    const errado = { ...certo, lote: certo.lote.replace(/.$/, c => (c === "a" ? "b" : "a")) };
    const inexistente = { ...certo, lote: certo.lote.replace("qd18-lote4", "qd99-lote1") };
    const semPublicacao = await erroDe(publico().porLote(certo));
    const aberto = await admin().itens.abrir({ planta: PLANTA });
    await admin().itens.salvar({ planta: PLANTA, versaoBase: 0, itens: aberto.fonte.itens });
    await admin().itens.publicar({ planta: PLANTA, versao: 1 });
    expect(await publico().porLote(certo)).toBeTruthy();
    const r = [semPublicacao, await erroDe(publico().porLote(errado)), await erroDe(publico().porLote(inexistente))];
    await admin().lotes.salvar({ planta: PLANTA, id, empreendimentoSlug: "vila-esmeralda", loteSlug: "qd18-lote4", empreendimentoNome: "Vila Esmeralda", quadra: "18", lote: "4", itensVersao: null, unitId: 1, ativo: false });
    r.push(await erroDe(publico().porLote(certo)));
    for (const x of r) expect(x).toEqual(NF);
    // Unidade apagada na Incorporação: a página continua, só sem status (nada da unidade vaza).
    await admin().lotes.salvar({ planta: PLANTA, id, empreendimentoSlug: "vila-esmeralda", loteSlug: "qd18-lote4", empreendimentoNome: "Vila Esmeralda", quadra: "18", lote: "4", itensVersao: null, unitId: 1, ativo: true });
    await banco.pg.exec(`UPDATE incorporation_units SET deleted_at = now() WHERE id = 1`);
    expect((await publico().porLote(certo)).status).toBeNull();
  });

  it("resposta campo a campo: só empreendimento/quadra/lote/status/fonte(schema da planta, sem nota); nada da unidade, do admin ou de ids internos", async () => {
    const { caminho } = await publicarELigar(undefined, 2); // unidade com status desconhecido ('bloqueada')
    const r = await publico().porLote(partes(caminho));
    expect(Object.keys(r).sort()).toEqual(["empreendimento", "fonte", "lote", "quadra", "status"]);
    expect(r.status).toBeNull(); // status desconhecido não aparece
    expect(Object.keys(r.fonte).sort()).toEqual(Object.keys(fonteSchema.shape).sort());
    const texto = JSON.stringify(r);
    for (const p of ["Beltrana", "99999", "Fulano", "254321", "Admin Um", "admin@empresa", "99988887777", "\"nota\"", "maquete_id", "unit_id", "codigo_link", "fonte_slug", "token", "autor", "rascunho", "situacao", "estrutura_hash", "publicada_em", "criado_por"])
      expect(texto, p).not.toContain(p);
    // Fica na resposta (registrado no relatório): as marcas curtas `fonte` ("planta", "dono", "protótipo") e `estimado` da
    // planta. Não são dado pessoal nem comercial, e o JSON inteiro (com notas) já é público em /maquete-demo.
    expect(texto).toContain("\"estimado\"");
    expect(new Set(r.fonte.itens.map(i => i.fonte))).toEqual(new Set(fonteDoRepo(PLANTA).itens.map(i => i.fonte)));
  });

  it("XSS: texto do admin vai cru no JSON, mas a página escapa e o WhatsApp é wa.me/<número fixo> com encodeURIComponent", async () => {
    const xss = { empreendimentoNome: `<script>alert(1)</script>"&'`, quadra: `"><svg onload=x>`, lote: "4?x=1#&text=y" };
    const { caminho } = await publicarELigar(xss);
    const r = await publico().porLote(partes(caminho));
    expect(r.empreendimento).toBe(xss.empreendimentoNome);
    const link = linkWhatsAppDoLote(r);
    const u = new URL(link);
    expect([u.protocol, u.host, u.pathname, [...u.searchParams.keys()]]).toEqual(["https:", "wa.me", `/${WHATSAPP_EMPRESA}`, ["text"]]);
    expect(WHATSAPP_EMPRESA).toBe("5599981392210");
    expect(u.searchParams.get("text")).toBe(mensagemWhatsAppDoLote(r));
    expect(link).not.toMatch(/[<>" #]/); // encodeURIComponent deixa ' ( ) ! * — inofensivos no href entre aspas duplas
    const { VistaDoLote } = await import("../client/src/pages/MaqueteLote");
    const html = renderToString(createElement(VistaDoLote, { dados: r }));
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<svg onload");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // O href do botão é exatamente o link montado (no atributo, & vira &amp; e ' vira &#x27;).
    expect(html).toContain(`href="${link.replace(/&/g, "&amp;").replace(/'/g, "&#x27;")}"`);
  });
});

describe("QA E4 — migração 0147", () => {
  it("só ADD COLUMN IF NOT EXISTS, CHECK recriada e índice IF NOT EXISTS; nenhum comando de dado", () => {
    const comandos = SQL_0147.split("\n").filter(l => l.trim() && !l.trim().startsWith("--")).join(" ").split(";").map(s => s.trim().replace(/\s+/g, " ")).filter(Boolean);
    expect(comandos).toHaveLength(7);
    for (const c of comandos) expect(c).toMatch(/^(ALTER TABLE "maquete_3d_lotes" ADD COLUMN IF NOT EXISTS|ALTER TABLE "maquete_3d_lotes" DROP CONSTRAINT IF EXISTS "maquete_3d_lotes_codigo_ck"$|ALTER TABLE "maquete_3d_lotes" ADD CONSTRAINT "maquete_3d_lotes_codigo_ck" CHECK|CREATE UNIQUE INDEX IF NOT EXISTS)/);
    for (const c of comandos) expect(c).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|INSERT|DROP TABLE|DROP COLUMN|DROP INDEX|ALTER COLUMN|RENAME)\b/i);
  });

  it("depende da 0146: sozinha falha porque a tabela não existe", async () => {
    const pg = new PGlite();
    await expect(pg.exec(SQL_0147)).rejects.toThrow(/maquete_3d_lotes/);
  });
});
