// EPIC-031 S-1 — projeto entregue fora da lista padrão e nome padrão e curto dos arquivos.
// Banco real em memória (PGlite); o Google Drive é simulado (nada externo é chamado).
import type { AddressInfo } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableColumns, type Table } from "drizzle-orm";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const driveRange = vi.hoisted(() => vi.fn());
vi.mock("./drive-documents.js", () => ({
  iniciarUploadProjetoDrive: vi.fn(),
  enviarParteProjetoDrive: vi.fn(),
  readPrivateDocumentRange: driveRange,
}));
vi.mock("./_core/auth-utils.js", () => ({
  getTokenFromRequest: (req: { headers: Record<string, string> }) => req.headers["x-teste-token"] || null,
  verifySessionToken: async (token: string) => (token === "ok" ? { userId: 1, sessionVersion: 1 } : token === "corretor" ? { userId: 2, sessionVersion: 1 } : null),
}));

import * as db from "./db.js";
import rotas from "./routes/projeto-documentos.js";
import { operationalProjects, projectDocuments } from "../drizzle/schema";
import { filtrarListaProjetos } from "../shared/projetos-lista";
import { clienteCurtoArquivoProjeto, itemCurtoArquivoProjeto, nomePadraoArquivoProjeto, nomesPadraoArquivosProjeto } from "../shared/projeto-documentos";

let pg: PGlite;
const ddl = (nome: string, tabela: Table) => `CREATE TABLE ${nome} (${Object.values(getTableColumns(tabela))
  .map(c => `"${c.name}" ${c.name === "id" ? "serial PRIMARY KEY" : c.getSQLType()}${c.hasDefault && c.name.endsWith("_at") ? " DEFAULT now()" : ""}`).join(", ")});`;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(ddl("operational_projects", operationalProjects));
  await pg.exec(ddl("project_documents", projectDocuments));
  const checklist = JSON.stringify([{ id: "projeto_eletrico", type: "projeto_eletrico", text: "Projeto Elétrico", done: false }, { id: "x1", text: "Planta de situação e localização", done: false }]);
  await pg.query(`INSERT INTO operational_projects (id, name, types, status, client_name, client_phone, engineer, value, paid_value, description, checklist, files, updated_at, created_at)
    VALUES (7, 'Projeto técnico — residência', '["projeto_eletrico"]', 'em_elaboracao', 'Maylanne 🌻 de Sousa Araújo', '', 'Eng', 0, 0, '', $1, '[]', now(), now())`, [checklist]);
  // arquivo ANTIGO: nome canônico longo do padrão anterior, gravado antes desta story
  await pg.query(`INSERT INTO project_documents (id, project_id, item_id, kind, original_name, canonical_name, mime, size, version, drive_file_id, status, created_at, updated_at)
    VALUES (11, 7, 'projeto_eletrico', 'pdf', 'PRANCHA FINAL revisada 03 (1) cópia.pdf', 'PROJETO_TECNICO_RESIDENCIA_MAYLANNE_DE_SOUSA_ARAUJO_PROJETO_ELETRICO_V02.pdf', 'application/pdf', 1500000, 2, 'drive-antigo', 'active', now(), now()),
           (12, 7, 'x1', 'editable', 'planta situação.DWG', 'Planta-Situacao-Maylanne-Araujo-1.dwg', 'application/octet-stream', 10, 1, 'drive-novo', 'active', now(), now()),
           (13, 7, 'x1', 'editable', 'apagado.dwg', 'x', 'application/octet-stream', 10, 2, 'drive-apagado', 'deleted', now(), now())`);
});
beforeEach(() => {
  vi.spyOn(db, "getDb").mockReturnValue(drizzle(pg) as never);
  vi.spyOn(db, "getUserById").mockImplementation(async (id: number) =>
    ({ id, role: id === 1 ? "admin" : "corretor", active: true, sessionVersion: 1, permissions: null }) as never);
  driveRange.mockImplementation(async (_id: string, inicio: number, fim: number) => Buffer.alloc(fim - inicio, 7));
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => pg.close());

describe("lista de Projetos: entregue sai da lista", () => {
  const rows = [
    { id: 1, name: "Casa A", clientName: "Keilane Costa", engineer: "Ana", status: "em_elaboracao" },
    { id: 2, name: "Casa B", clientName: "Marcio Paiva", engineer: "Ana", status: "entregue" },
    { id: 3, name: "Casa C", clientName: "Keilane Costa", engineer: "Bia", status: "revisao" },
  ];
  it("sem filtro, com outro status e na busca, entregue não aparece", () => {
    expect(filtrarListaProjetos(rows, { busca: "", status: "" }).map(r => r.id)).toEqual([1, 3]);
    expect(filtrarListaProjetos(rows, { busca: "marcio", status: "" })).toEqual([]);
    expect(filtrarListaProjetos(rows, { busca: "", status: "revisao" }).map(r => r.id)).toEqual([3]);
    expect(filtrarListaProjetos(rows, { busca: "ana", status: "" }).map(r => r.id)).toEqual([1]);
  });
  it("com o filtro Entregue, só os entregues (e a busca vale dentro deles)", () => {
    expect(filtrarListaProjetos(rows, { busca: "", status: "entregue" }).map(r => r.id)).toEqual([2]);
    expect(filtrarListaProjetos(rows, { busca: "MARCIO", status: "entregue" }).map(r => r.id)).toEqual([2]);
    expect(filtrarListaProjetos(rows, { busca: "keilane", status: "entregue" })).toEqual([]);
  });
});

describe("nome padrão e curto", () => {
  it("cliente: primeiro e último nome, sem acento nem emoji; uma palavra; vazio", () => {
    expect(clienteCurtoArquivoProjeto("Maylanne 🌻")).toBe("Maylanne");
    expect(clienteCurtoArquivoProjeto("  joão d'ávila  ")).toBe("Joao-Avila");
    expect(clienteCurtoArquivoProjeto("KEILANE DA SILVA COSTA")).toBe("Keilane-Costa");
    expect(clienteCurtoArquivoProjeto("🌻🌻")).toBe("Cliente");
    expect(clienteCurtoArquivoProjeto(null)).toBe("Cliente");
  });
  it("item: tabela fixa, texto livre curto, revisão e sem item", () => {
    expect(itemCurtoArquivoProjeto({ type: "projeto_hidrossanitario", text: "Projeto Hidrossanitário" })).toBe("Hidrossanitario");
    expect(itemCurtoArquivoProjeto({ text: "ART / RRT" })).toBe("ART");
    expect(itemCurtoArquivoProjeto({ text: "Planta de situação e localização" })).toBe("Planta-Situacao");
    expect(itemCurtoArquivoProjeto({ text: "Memorial descritivo completo da obra" })).toBe("Memorial");
    expect(itemCurtoArquivoProjeto({ itemId: "revisao-4", text: "Revisão 4" })).toBe("Revisao");
    expect(itemCurtoArquivoProjeto(null)).toBe("Doc");
  });
  it("até 40 caracteres antes da extensão; extensão minúscula, ausente ou dupla", () => {
    const longo = nomePadraoArquivoProjeto({ item: "Hidrossanitario", cliente: clienteCurtoArquivoProjeto("Maximilianoooooo Wolfeschlegelsteinhausen"), n: 12, originalName: "a.PDF" });
    expect(longo.replace(/\.pdf$/, "").length).toBeLessThanOrEqual(40);
    expect(longo).toMatch(/^[A-Za-z0-9-]+-12\.pdf$/);
    expect(nomePadraoArquivoProjeto({ item: "ART", cliente: "Marcio-Paiva", n: 1, originalName: "sem extensao", mime: "application/pdf" })).toBe("ART-Marcio-Paiva-1.pdf");
    expect(nomePadraoArquivoProjeto({ item: "ART", cliente: "Marcio-Paiva", n: 1, originalName: "sem extensao" })).toBe("ART-Marcio-Paiva-1.bin");
    expect(nomePadraoArquivoProjeto({ item: "Eletrico", cliente: "Marcio-Paiva", n: 3, originalName: "planta.final.v2.DWG" })).toBe("Eletrico-Marcio-Paiva-3.dwg");
  });
  it("lista: versão estável, posição para arquivo antigo sem versão e colisão resolvida", () => {
    const checklist = [{ id: "projeto_eletrico", type: "projeto_eletrico", text: "Projeto Elétrico", done: false }];
    const nomes = nomesPadraoArquivosProjeto([
      { itemId: "projeto_eletrico", kind: "pdf", version: 2, name: "X.pdf" },
      { itemId: "projeto_eletrico", kind: "editable", version: 1, name: "a.dwg" },
      { name: "Documento antigo muito muito longo.PDF" },
      { name: "outro antigo.pdf" },
      { name: "mais um.pdf", version: 1 },
    ], { clientName: "Keilane Costa", checklist });
    expect(nomes).toEqual(["Eletrico-Keilane-Costa-2.pdf", "Eletrico-Keilane-Costa-1.dwg", "Doc-Keilane-Costa-1.pdf", "Doc-Keilane-Costa-2.pdf", "Doc-Keilane-Costa-3.pdf"]);
  });
});

describe("download com o nome padrão (arquivo novo e antigo)", () => {
  async function comServidor(teste: (base: string) => Promise<void>) {
    const app = express();
    app.use("/api", rotas);
    const server = app.listen(0);
    try { await teste(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projetos/7/documentos`); }
    finally { server.close(); }
  }
  it("arquivo antigo: nome padrão no cabeçalho, sem alterar o que está gravado; partes de 1 MB", async () => {
    await comServidor(async base => {
      const r = await fetch(`${base}/11/arquivo`, { headers: { "x-teste-token": "ok" } });
      expect(r.status).toBe(200);
      expect(r.headers.get("content-disposition")).toBe('attachment; filename="Eletrico-Maylanne-Araujo-2.pdf"');
      expect(r.headers.get("x-document-name")).toBe("Eletrico-Maylanne-Araujo-2.pdf");
      expect(r.headers.get("x-document-size")).toBe("1500000");
      expect((await r.arrayBuffer()).byteLength).toBe(1024 * 1024);
      const resto = await fetch(`${base}/11/arquivo?offset=${1024 * 1024}`, { headers: { "x-teste-token": "ok" } });
      expect((await resto.arrayBuffer()).byteLength).toBe(1500000 - 1024 * 1024);
      expect(driveRange).toHaveBeenLastCalledWith("drive-antigo", 1024 * 1024, 1500000);
      const gravado = await pg.query<{ original_name: string; canonical_name: string }>("SELECT original_name, canonical_name FROM project_documents WHERE id = 11");
      expect(gravado.rows[0]).toEqual({ original_name: "PRANCHA FINAL revisada 03 (1) cópia.pdf", canonical_name: "PROJETO_TECNICO_RESIDENCIA_MAYLANNE_DE_SOUSA_ARAUJO_PROJETO_ELETRICO_V02.pdf" });
    });
  });
  it("arquivo novo de item livre: nome padrão; apagado, outro projeto, sem sessão e sem permissão são recusados", async () => {
    await comServidor(async base => {
      const r = await fetch(`${base}/12/arquivo`, { headers: { "x-teste-token": "ok" } });
      expect(r.headers.get("x-document-name")).toBe("Planta-Situacao-Maylanne-Araujo-1.dwg");
      expect((await fetch(`${base}/13/arquivo`, { headers: { "x-teste-token": "ok" } })).status).toBe(404);
      expect((await fetch(`${base.replace("/7/", "/8/")}/11/arquivo`, { headers: { "x-teste-token": "ok" } })).status).toBe(404);
      expect((await fetch(`${base}/11/arquivo?offset=1500000`, { headers: { "x-teste-token": "ok" } })).status).toBe(400);
      expect((await fetch(`${base}/11/arquivo`)).status).toBe(401);
      expect((await fetch(`${base}/11/arquivo`, { headers: { "x-teste-token": "corretor" } })).status).toBe(403);
    });
  });
});
