// EPIC-031 S-1 — projeto entregue fora da lista padrão e nome padrão e curto dos arquivos.
// Banco real em memória (PGlite); o Google Drive é simulado (nada externo é chamado).
import type { AddressInfo } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableColumns, type Table } from "drizzle-orm";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const iniciarUpload = vi.hoisted(() => vi.fn());
vi.mock("./drive-documents.js", () => ({
  iniciarUploadProjetoDrive: iniciarUpload,
  enviarParteProjetoDrive: vi.fn(),
}));
vi.mock("./_core/secret-vault.js", () => ({ encryptSecret: (v: string) => v, decryptSecret: (v: string) => v }));
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
  iniciarUpload.mockResolvedValue("https://www.googleapis.com/upload/sessao-simulada");
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
    expect(itemCurtoArquivoProjeto({ type: "projeto_arquitetonico", text: "Projeto Arquitetônico" })).toBe("Planta");
    expect(itemCurtoArquivoProjeto({ text: "Projeto Arquitetônico" })).toBe("Planta");
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

describe("envio novo já grava o nome padrão; o antigo não é alterado", () => {
  async function comServidor(teste: (base: string) => Promise<void>) {
    const app = express();
    app.use(express.json());
    app.use("/api", rotas);
    const server = app.listen(0);
    try { await teste(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projetos/7/documentos`); }
    finally { server.close(); }
  }
  const iniciar = (base: string, itemId: string, name: string, kind: "pdf" | "editable", token = "ok") => fetch(base, {
    method: "POST", headers: { "Content-Type": "application/json", "x-teste-token": token },
    body: JSON.stringify({ action: "start", itemId, name, size: 10, kind, mime: kind === "pdf" ? "application/pdf" : "application/acad" }),
  });

  it("item do tipo: nome padrão na reserva e no Drive, com a versão seguinte; original guardado", async () => {
    await comServidor(async base => {
      const r = await iniciar(base, "projeto_eletrico", "PRANCHA nova (2) cópia FINAL.PDF", "pdf");
      expect(r.status).toBe(200);
      const novo = await pg.query<{ original_name: string; canonical_name: string; version: number }>("SELECT original_name, canonical_name, version FROM project_documents WHERE project_id = 7 AND item_id = 'projeto_eletrico' AND version = 3");
      expect(novo.rows[0]).toEqual({ original_name: "PRANCHA nova (2) cópia FINAL.PDF", canonical_name: "Eletrico-Maylanne-Araujo-3.pdf", version: 3 });
      expect(iniciarUpload).toHaveBeenLastCalledWith(expect.objectContaining({ canonicalName: "Eletrico-Maylanne-Araujo-3.pdf", name: "PRANCHA nova (2) cópia FINAL.PDF" }));
      const antigo = await pg.query<{ canonical_name: string }>("SELECT canonical_name FROM project_documents WHERE id = 11");
      expect(antigo.rows[0].canonical_name).toBe("PROJETO_TECNICO_RESIDENCIA_MAYLANNE_DE_SOUSA_ARAUJO_PROJETO_ELETRICO_V02.pdf");
    });
  });
  it("item de texto livre e sem permissão", async () => {
    await comServidor(async base => {
      expect((await iniciar(base, "x1", "planta situação.DWG", "editable")).status).toBe(200);
      expect(iniciarUpload).toHaveBeenLastCalledWith(expect.objectContaining({ canonicalName: "Planta-Situacao-Maylanne-Araujo-3.dwg" }));
      expect((await iniciar(base, "x1", "a.dwg", "editable", "corretor")).status).toBe(403);
    });
  });
  it("arquivo antigo na lista: nome padrão calculado na leitura a partir dos metadados", () => {
    const checklist = [{ id: "projeto_eletrico", type: "projeto_eletrico", text: "Projeto Elétrico", done: false }];
    expect(nomesPadraoArquivosProjeto([{ itemId: "projeto_eletrico", kind: "pdf", version: 2, name: "PROJETO_TECNICO_RESIDENCIA_MAYLANNE_DE_SOUSA_ARAUJO_PROJETO_ELETRICO_V02.pdf", originalName: "PRANCHA FINAL revisada 03 (1) cópia.pdf" }], { clientName: "Maylanne 🌻 de Sousa Araújo", checklist }))
      .toEqual(["Eletrico-Maylanne-Araujo-2.pdf"]);
  });
});
