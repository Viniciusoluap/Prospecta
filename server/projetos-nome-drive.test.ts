// EPIC-031 S-2 — renomear no Drive os arquivos antigos de Projetos para o nome padrão (o mesmo da tela).
// Banco real em memória (PGlite) com a migração 0175; o Google Drive é simulado (nada externo é chamado).
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableColumns, type Table } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "./db.js";
import { operationalProjects, projectDocuments, projectRevisionRequests } from "../drizzle/schema";
import { ErroDrive } from "../shared/drive-erro";
import { PROJECT_TYPE_LABELS } from "../shared/operacional";
import { clienteCurtoArquivoProjeto, ehNomePadraoArquivoProjeto, nomePadraoArquivoProjeto, nomesPadraoArquivosProjeto, projectChecklist, type ProjectCheck } from "../shared/projeto-documentos";
import { renomearDocumentosProjetoNoDrive, renomearNomesDriveNoCron, type DependenciasNomesDrive } from "./projetos-nome-drive";

let pg: PGlite;
const ddl = (nome: string, tabela: Table) => `CREATE TABLE ${nome} (${Object.values(getTableColumns(tabela))
  .map(c => `"${c.name}" ${c.name === "id" ? "serial PRIMARY KEY" : c.getSQLType()}${c.hasDefault && c.name.endsWith("_at") ? " DEFAULT now()" : ""}`).join(", ")});`;
const url = (id: string) => `https://drive.google.com/file/d/${id}/view`;
const INS_DOC = `INSERT INTO project_documents (id, project_id, item_id, kind, original_name, canonical_name, mime, size, version, drive_file_id, status, created_at, updated_at) VALUES `;
const INS_PROJ = `INSERT INTO operational_projects (id, name, types, status, client_name, client_phone, engineer, value, paid_value, description, checklist, files, updated_at, created_at)
  VALUES ($1, 'Residência', $2, 'em_elaboracao', $3, '', 'Eng', 0, 0, '', $4, $5, now(), now())`;

async function montar(arquivosExtras = 0) {
  pg = new PGlite();
  await pg.exec(ddl("operational_projects", operationalProjects));
  await pg.exec(ddl("project_documents", projectDocuments));
  await pg.exec(ddl("project_revision_requests", projectRevisionRequests));
  await pg.exec(readFileSync(new URL("../drizzle/0175_projeto_documentos_nome_drive.sql", import.meta.url), "utf8"));
  const checklist = JSON.stringify([{ id: "projeto_eletrico", type: "projeto_eletrico", text: "Projeto Elétrico", done: false }]);
  const files = [
    { name: "PROJETO_TECNICO_MAYLANNE_ELETRICO_V02.pdf", originalName: "PRANCHA FINAL (1) cópia.pdf", version: 2, documentId: 11, itemId: "projeto_eletrico", kind: "pdf", url: url("d11"), driveFileId: "d11" },
    // enviado pelo sistema, já gravado no padrão: nunca tocado
    { name: "Eletrico-Maylanne-Araujo-1.dwg", originalName: "planta.DWG", version: 1, documentId: 12, itemId: "projeto_eletrico", kind: "editable", url: url("d12"), driveFileId: "d12" },
    { name: "Documento antigo muito longo.PDF", url: url("d14") }, // antigo, sem documentId: vínculo pelo arquivo do Drive
    { name: "fora do registro.pdf", url: url("d99") }, // a tela mostra, mas o registro não reconhece
    ...Array.from({ length: arquivosExtras }, (_, i) => ({ name: `extra ${i}.pdf`, documentId: 100 + i, itemId: "x", kind: "pdf", version: i + 1, url: url(`e${i}`), driveFileId: `e${i}` })),
  ];
  await pg.query(INS_PROJ, [7, '["projeto_eletrico"]', "Maylanne 🌻 de Sousa Araújo", checklist, JSON.stringify(files)]);
  await pg.query(`${INS_DOC}
    (11, 7, 'projeto_eletrico', 'pdf', 'PRANCHA FINAL (1) cópia.pdf', 'PROJETO_TECNICO_MAYLANNE_ELETRICO_V02.pdf', 'application/pdf', 1, 2, 'd11', 'active', now(), now()),
    (12, 7, 'projeto_eletrico', 'editable', 'planta.DWG', 'Eletrico-Maylanne-Araujo-1.dwg', 'application/octet-stream', 1, 1, 'd12', 'active', now(), now()),
    (13, 7, 'projeto_eletrico', 'editable', 'apagado.dwg', 'apagado.dwg', 'application/octet-stream', 1, 9, 'd13', 'deleted', now(), now()),
    (14, 7, 'legado', 'pdf', 'Documento antigo muito longo.PDF', 'Documento antigo muito longo.PDF', 'application/pdf', 1, 1, 'd14', 'active', now(), now()),
    (15, 7, 'revisao-4', 'pdf', 'revisão nova.pdf', 'Revisao 4 longa.pdf', 'application/pdf', 1, 3, 'd15', 'active', now(), now()),
    (16, 7, 'projeto_eletrico', 'pdf', 'sumiu da tela.pdf', 'sumiu da tela.pdf', 'application/pdf', 1, 1, 'd16', 'substituted', now(), now())`);
  for (let i = 0; i < arquivosExtras; i++) {
    await pg.query(`${INS_DOC} (${100 + i}, 7, 'x', 'pdf', 'extra ${i}.pdf', 'extra ${i}.pdf', 'application/pdf', 1, ${i + 1}, 'e${i}', 'active', now(), now())`);
  }
  await pg.query(`INSERT INTO project_revision_requests (id, project_id, request_text, status, deliveries, created_at, updated_at)
    VALUES (4, 7, 'Ajustar', 'entregue', $1, now(), now())`, [JSON.stringify([{ nome: "Revisao 4 longa.pdf", nomeOriginal: "revisão nova.pdf", versao: 3, documentId: 15, driveFileId: "d15", tipo: "pdf", url: url("d15") }])]);
  vi.spyOn(db, "getDb").mockReturnValue(drizzle(pg) as never);
}
const linha = async (id: number) => (await pg.query<{ canonical_name: string; original_name: string; drive_renamed_at: Date | null; drive_rename_failures: number; drive_rename_error: string | null }>(
  "SELECT canonical_name, original_name, drive_renamed_at, drive_rename_failures, drive_rename_error FROM project_documents WHERE id = $1", [id])).rows[0];

/** O que a TELA mostra hoje para um projeto (mesmas chamadas de AdminProjetos.tsx e ProjetoRevisoes.tsx). */
async function nomesDaTela(projetoId: number): Promise<string[]> {
  const [p] = (await pg.query<{ client_name: string; types: string; checklist: string; files: string }>("SELECT client_name, types, checklist, files FROM operational_projects WHERE id = $1", [projetoId])).rows;
  const checklist = projectChecklist(JSON.parse(p.types), JSON.parse(p.checklist) as ProjectCheck[], PROJECT_TYPE_LABELS);
  const lista = nomesPadraoArquivosProjeto(JSON.parse(p.files), { clientName: p.client_name, checklist });
  const revs = (await pg.query<{ id: number; deliveries: string }>("SELECT id, deliveries FROM project_revision_requests WHERE project_id = $1", [projetoId])).rows;
  const ordem = new Map(revs.map(r => r.id).sort((a, b) => a - b).map((id, i) => [id, i + 1]));
  const entregas = revs.flatMap(r => (JSON.parse(r.deliveries) as { nome: string; nomeOriginal?: string; versao?: number; tipo?: string }[]).map(d =>
    d.nomeOriginal && ehNomePadraoArquivoProjeto(d.nome) ? d.nome : nomePadraoArquivoProjeto({ item: `Rev${ordem.get(r.id) ?? r.id}`, cliente: clienteCurtoArquivoProjeto(p.client_name), n: d.versao || 1, originalName: d.nomeOriginal || d.nome, mime: d.tipo === "pdf" ? "application/pdf" : "" })));
  return [...lista, ...entregas];
}

function driveSimulado(nomes: Record<string, string>, extra: Partial<DependenciasNomesDrive> = {}): DependenciasNomesDrive & { chamadas: [string, string][]; nomes: Record<string, string> } {
  const chamadas: [string, string][] = [];
  return {
    chamadas, nomes,
    configurado: async () => true,
    agora: () => 0,
    renomear: vi.fn(async (fileId: string, nome: string) => {
      chamadas.push([fileId, nome]);
      if (nomes[fileId] === nome) return "ja_estava" as const;
      nomes[fileId] = nome;
      return "renomeado" as const;
    }),
    ...extra,
  };
}

afterEach(async () => { vi.restoreAllMocks(); await pg?.close(); });

describe("conferir (dry-run)", () => {
  beforeEach(() => montar());
  it("conta e mostra exemplos sem tocar no Drive nem no banco", async () => {
    const drive = driveSimulado({});
    const r = await renomearDocumentosProjetoNoDrive({ conferir: true }, drive);
    expect(r.pendentes).toBe(3);
    expect(r.exemplos).toEqual([
      { id: 11, antes: "PROJETO_TECNICO_MAYLANNE_ELETRICO_V02.pdf", depois: "Eletrico-Maylanne-Araujo-2.pdf" },
      { id: 14, antes: "Documento antigo muito longo.PDF", depois: "Doc-Maylanne-Araujo-1.pdf" },
      { id: 15, antes: "Revisao 4 longa.pdf", depois: "Rev1-Maylanne-Araujo-3.pdf" },
    ]);
    expect(r.semVinculoNaTela).toBe(1); // id 16: substituído que a tela não mostra
    expect(drive.chamadas).toEqual([]);
    expect((await linha(11)).canonical_name).toBe("PROJETO_TECNICO_MAYLANNE_ELETRICO_V02.pdf");
  });
});

describe("renomear", () => {
  beforeEach(() => montar());
  it("renomeia só os antigos, com o nome da tela; já gravado no padrão, apagado e sem registro nunca; original_name intacto", async () => {
    const tela = await nomesDaTela(7);
    const drive = driveSimulado({ d14: "Doc-Maylanne-Araujo-1.pdf" });
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(drive.chamadas).toEqual([["d11", "Eletrico-Maylanne-Araujo-2.pdf"], ["d14", "Doc-Maylanne-Araujo-1.pdf"], ["d15", "Rev1-Maylanne-Araujo-3.pdf"]]);
    expect(r).toMatchObject({ pendentes: 3, renomeados: 2, jaEstavam: 1, falhas: 0, colisoes: 0, restante: false });
    const a = await linha(11);
    expect(a.canonical_name).toBe("Eletrico-Maylanne-Araujo-2.pdf");
    expect(a.original_name).toBe("PRANCHA FINAL (1) cópia.pdf");
    expect(a.drive_renamed_at).not.toBeNull();
    expect((await linha(14)).drive_renamed_at).toBeNull(); // já estava certo no Drive: só gravado
    expect((await linha(13)).canonical_name).toBe("apagado.dwg");
    expect((await linha(16)).canonical_name).toBe("sumiu da tela.pdf");
    expect(drive.chamadas.some(([id]) => ["d12", "d13", "d16", "d99"].includes(id))).toBe(false);
    // (d) a tela mostra EXATAMENTE os mesmos nomes depois, e o Drive tem esses nomes
    expect(await nomesDaTela(7)).toEqual(tela);
    expect([drive.nomes.d11, drive.nomes.d14, drive.nomes.d15]).toEqual([tela[0], tela[2], tela[4]]);
  });
  it("grava o nome na lista do projeto e na entrega (com o original), para a tela não recalcular", async () => {
    await renomearDocumentosProjetoNoDrive({ conferir: false }, driveSimulado({}));
    const files = JSON.parse((await pg.query<{ files: string }>("SELECT files FROM operational_projects WHERE id = 7")).rows[0].files);
    expect(files[0]).toMatchObject({ name: "Eletrico-Maylanne-Araujo-2.pdf", originalName: "PRANCHA FINAL (1) cópia.pdf", documentId: 11, url: url("d11") });
    expect(files[2]).toMatchObject({ name: "Doc-Maylanne-Araujo-1.pdf", originalName: "Documento antigo muito longo.PDF", url: url("d14") });
    expect(files[3]).toEqual({ name: "fora do registro.pdf", url: url("d99") });
    const [entrega] = JSON.parse((await pg.query<{ deliveries: string }>("SELECT deliveries FROM project_revision_requests WHERE id = 4")).rows[0].deliveries);
    expect(entrega).toMatchObject({ nome: "Rev1-Maylanne-Araujo-3.pdf", nomeOriginal: "revisão nova.pdf", documentId: 15 });
  });
  it("estável: depois de renomeado, apagar outro arquivo do projeto não muda o nome", async () => {
    await renomearDocumentosProjetoNoDrive({ conferir: false }, driveSimulado({}));
    const p = (await pg.query<{ files: string }>("SELECT files FROM operational_projects WHERE id = 7")).rows[0];
    const semPrimeiro = JSON.parse(p.files).slice(1);
    await pg.query("UPDATE operational_projects SET files = $1 WHERE id = 7", [JSON.stringify(semPrimeiro)]);
    expect((await nomesDaTela(7)).slice(0, 2)).toEqual(["Eletrico-Maylanne-Araujo-1.dwg", "Doc-Maylanne-Araujo-1.pdf"]);
  });
  it("(e) idempotente: rodar de novo não chama o Drive nem muda nada", async () => {
    const drive = driveSimulado({});
    await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    const tela = await nomesDaTela(7);
    const antes = drive.chamadas.length;
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(drive.chamadas.length).toBe(antes);
    expect(r).toMatchObject({ pendentes: 0, renomeados: 0, restante: false });
    expect(await nomesDaTela(7)).toEqual(tela);
  });
  it("falha num arquivo não interrompe os outros e fica registrada (só o código); nada é gravado dele", async () => {
    const drive = driveSimulado({});
    drive.renomear = vi.fn(async (id: string, nome: string) => {
      if (id === "d11") throw new ErroDrive("upload", 500, "backendError", "detalhe");
      drive.chamadas.push([id, nome]);
      return "renomeado" as const;
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(r).toMatchObject({ renomeados: 2, falhas: 1, restante: true });
    expect(await linha(11)).toMatchObject({ canonical_name: "PROJETO_TECNICO_MAYLANNE_ELETRICO_V02.pdf", drive_rename_failures: 1, drive_rename_error: "upload:500:backendError" });
    const files = JSON.parse((await pg.query<{ files: string }>("SELECT files FROM operational_projects WHERE id = 7")).rows[0].files);
    expect(files[0].name).toBe("PROJETO_TECNICO_MAYLANNE_ELETRICO_V02.pdf");
    // depois do limite de falhas, a rotina desiste dele
    await pg.query("UPDATE project_documents SET drive_rename_failures = 5 WHERE id = 11");
    const depois = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(depois).toMatchObject({ pendentes: 0, desistidos: 1 });
  });
  it("lixeira e sem permissão: não toca e registra", async () => {
    const drive = driveSimulado({}, { renomear: vi.fn(async (id: string) => (id === "d11" ? "lixeira" as const : id === "d14" ? "sem_permissao" as const : "renomeado" as const)) });
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(r).toMatchObject({ renomeados: 1, naoTocados: 2 });
    expect((await linha(11)).drive_rename_error).toBe("lixeira");
    expect((await linha(14)).drive_rename_error).toBe("sem_permissao");
  });
  it("limite de taxa do Google para o lote sem contar como falha do arquivo", async () => {
    const drive = driveSimulado({}, { renomear: vi.fn(async () => { throw new ErroDrive("upload", 403, "userRateLimitExceeded", undefined); }) });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(drive.renomear).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ falhas: 0, restante: true });
    expect((await linha(11)).drive_rename_failures).toBe(0);
  });
  it("nome já usado no Drive por outro arquivo do projeto: não renomeia (nunca dois iguais)", async () => {
    // o registro 16 (fora da tela) já tem no Drive o nome que a tela daria ao 11
    await pg.query("UPDATE project_documents SET canonical_name = 'Eletrico-Maylanne-Araujo-2.pdf' WHERE id = 16");
    const drive = driveSimulado({});
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(r).toMatchObject({ colisoes: 1, renomeados: 2, restante: true });
    expect(drive.chamadas.some(([id]) => id === "d11")).toBe(false);
  });
  it("Drive não configurado: não faz nada", async () => {
    const drive = driveSimulado({}, { configurado: async () => false });
    expect(await renomearDocumentosProjetoNoDrive({ conferir: false }, drive)).toMatchObject({ pulado: "drive_nao_configurado" });
    expect(drive.chamadas).toEqual([]);
  });
});

describe("itens com o mesmo nome curto e revisões Rev<N>", () => {
  beforeEach(async () => {
    await montar();
    const checklist = [{ id: "a", text: "Projeto Elétrico Bloco A", done: false }, { id: "b", text: "Projeto Elétrico Bloco B", done: false }];
    const files = [
      { name: "eletrico bloco A versao final.pdf", url: url("b1"), itemId: "a", kind: "pdf" },
      { name: "eletrico bloco B versao final.pdf", url: url("b2"), itemId: "b", kind: "pdf" },
    ];
    await pg.query(INS_PROJ, [8, "[]", "Ana Maria Lima", JSON.stringify(checklist), JSON.stringify(files)]);
    await pg.query(`${INS_DOC}
      (21, 8, 'a', 'pdf', 'a.pdf', 'eletrico bloco A versao final.pdf', 'application/pdf', 1, 1, 'b1', 'active', now(), now()),
      (22, 8, 'b', 'pdf', 'b.pdf', 'eletrico bloco B versao final.pdf', 'application/pdf', 1, 1, 'b2', 'active', now(), now()),
      (23, 8, 'revisao-30', 'pdf', 'r1.pdf', 'revisao trinta.pdf', 'application/pdf', 1, 1, 'r30', 'active', now(), now()),
      (24, 8, 'revisao-50', 'editable', 'r2.dwg', 'revisao cinquenta.dwg', 'application/octet-stream', 1, 1, 'r50', 'active', now(), now())`);
    await pg.query(`INSERT INTO project_revision_requests (id, project_id, request_text, status, deliveries, created_at, updated_at) VALUES
      (30, 8, 'x', 'entregue', $1, now(), now()), (50, 8, 'y', 'entregue', $2, now(), now())`, [
      JSON.stringify([{ nome: "revisao trinta.pdf", versao: 1, documentId: 23, driveFileId: "r30", tipo: "pdf" }]),
      JSON.stringify([{ nome: "revisao cinquenta.dwg", versao: 1, documentId: 24, driveFileId: "r50", tipo: "editable" }]),
    ]);
  });
  it("(b) nomes distintos no Drive e iguais aos da tela; (c) revisões Rev1 e Rev2 pela ordem no projeto", async () => {
    const tela = await nomesDaTela(8);
    expect(tela).toEqual(["Eletrico-BlocoA-Ana-Lima-1.pdf", "Eletrico-BlocoB-Ana-Lima-1.pdf", "Rev1-Ana-Lima-1.pdf", "Rev2-Ana-Lima-1.dwg"]);
    const drive = driveSimulado({});
    await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect([drive.nomes.b1, drive.nomes.b2, drive.nomes.r30, drive.nomes.r50]).toEqual(tela);
    expect(new Set(Object.values(drive.nomes)).size).toBe(Object.values(drive.nomes).length);
    expect(await nomesDaTela(8)).toEqual(tela);
  });
});

describe("lote e limite de tempo", () => {
  beforeEach(() => montar(30));
  it("no máximo 25 por chamada; o resto fica para a próxima; tela igual no fim", async () => {
    const tela = await nomesDaTela(7);
    const drive = driveSimulado({});
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false, limite: 25 }, drive);
    expect(drive.chamadas.length).toBe(25);
    expect(r).toMatchObject({ pendentes: 33, renomeados: 25, restante: true });
    expect(await nomesDaTela(7)).toEqual(tela); // no meio do caminho também
    const r2 = await renomearDocumentosProjetoNoDrive({ conferir: false, limite: 25 }, drive);
    expect(r2).toMatchObject({ pendentes: 8, renomeados: 8, restante: false });
    expect(await nomesDaTela(7)).toEqual(tela);
  });
  it("para ao passar do prazo", async () => {
    let t = 0;
    const drive = driveSimulado({}, { agora: () => t });
    const original = drive.renomear;
    drive.renomear = vi.fn(async (id: string, nome: string) => { t += 1_000; return original(id, nome); });
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false, prazoMs: 3_000 }, drive);
    expect(r.renomeados).toBe(3);
    expect(r.restante).toBe(true);
  });
});

describe("no cron (permissão)", () => {
  beforeEach(() => montar());
  it("sem o segredo do cron ou sem tempo, não faz nada", async () => {
    const drive = driveSimulado({});
    expect(await renomearNomesDriveNoCron(false, 15_000, drive)).toEqual({ pulado: true });
    expect(await renomearNomesDriveNoCron(true, 1_000, drive)).toEqual({ pulado: true });
    expect(drive.chamadas).toEqual([]);
  });
  it("com o segredo, um lote; sem as colunas da migração, nunca lança", async () => {
    const drive = driveSimulado({});
    expect(await renomearNomesDriveNoCron(true, 15_000, drive)).toMatchObject({ renomeados: 3 });
    await pg.exec("ALTER TABLE project_documents DROP COLUMN drive_rename_failures");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await renomearNomesDriveNoCron(true, 15_000, drive)).toEqual({ erro: true });
  });
});
