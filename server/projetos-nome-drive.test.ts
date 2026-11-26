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
import { ORCAMENTO_ARQUIVO_MS, renomearDocumentosProjetoNoDrive, renomearNomesDriveNoCron, type DependenciasNomesDrive } from "./projetos-nome-drive";

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

/**
 * Drive simulado: `nomes` = nome atual de cada arquivo no Drive (sem entrada: "antigo-<id>"). `leituras` = GETs;
 * `chamadas` = trocas de nome (PATCH) feitas; `prazos` = prazo recebido em cada chamada.
 */
type DriveSimulado = DependenciasNomesDrive & { leituras: string[]; chamadas: [string, string][]; prazos: number[]; nomes: Record<string, string> };
function driveSimulado(nomes: Record<string, string>, extra: Partial<DependenciasNomesDrive> = {}): DriveSimulado {
  const leituras: string[] = [];
  const chamadas: [string, string][] = [];
  const prazos: number[] = [];
  return {
    leituras, chamadas, prazos, nomes,
    configurado: async () => true,
    agora: () => 0,
    ler: vi.fn(async (fileId: string, prazoMs: number) => {
      leituras.push(fileId);
      prazos.push(prazoMs);
      return { nome: nomes[fileId] ?? `antigo-${fileId}`, lixeira: false, podeRenomear: true };
    }),
    trocar: vi.fn(async (fileId: string, nome: string, prazoMs: number) => {
      chamadas.push([fileId, nome]);
      prazos.push(prazoMs);
      nomes[fileId] = nome;
    }),
    ...extra,
  };
}
/** Troca do nome que falha (para um arquivo) e, nos outros, renomeia como o simulado. */
function trocaQueFalha(drive: DriveSimulado, falha: (id: string) => Error | undefined) {
  const original = drive.trocar;
  drive.trocar = vi.fn(async (id: string, nome: string, prazo: number) => {
    const e = falha(id);
    if (e) throw e;
    return original(id, nome, prazo);
  });
}
type Antes = { drive_file_id: string; drive_renamed_at: Date | null; drive_name_before: string | null; drive_name_before_origem: string | null; canonical_name_before: string | null; list_name_before: string | null; list_original_added: boolean | null };
const antesDe = async (id: number) => (await pg.query<Antes>(`SELECT drive_file_id, drive_renamed_at, drive_name_before, drive_name_before_origem,
  canonical_name_before, list_name_before, list_original_added FROM project_documents WHERE id = $1`, [id])).rows[0];
const filesDo = async (projetoId: number) => JSON.parse((await pg.query<{ files: string }>("SELECT files FROM operational_projects WHERE id = $1", [projetoId])).rows[0].files);

/** Os passos do "Como desfazer" da story, para UM registro. */
async function desfazer(id: number, drive: DriveSimulado) {
  const [r] = (await pg.query<Antes & { project_id: number }>(`SELECT project_id, drive_file_id, drive_renamed_at, drive_name_before, drive_name_before_origem,
    canonical_name_before, list_name_before, list_original_added FROM project_documents WHERE id = $1`, [id])).rows;
  // 2. Drive: só se a rotina o renomeou e o nome anterior foi lido no Drive
  if (r.drive_renamed_at && r.drive_name_before_origem === "drive") drive.nomes[r.drive_file_id] = r.drive_name_before!;
  // 3. lista (ou entrega)
  const volta = (el: Record<string, unknown>, nome: string, original: string) => {
    el[nome] = r.list_name_before;
    if (r.list_original_added) delete el[original];
  };
  const files = await filesDo(r.project_id);
  const i = files.findIndex((f: { documentId?: number; driveFileId?: string; url?: string }) => f.documentId === id || f.driveFileId === r.drive_file_id || f.url === url(r.drive_file_id));
  if (i >= 0) {
    volta(files[i], "name", "originalName");
    await pg.query("UPDATE operational_projects SET files = $1 WHERE id = $2", [JSON.stringify(files), r.project_id]);
  } else {
    for (const rev of (await pg.query<{ id: number; deliveries: string }>("SELECT id, deliveries FROM project_revision_requests WHERE project_id = $1", [r.project_id])).rows) {
      const entregas = JSON.parse(rev.deliveries);
      const j = entregas.findIndex((d: { documentId?: number; driveFileId?: string }) => d.documentId === id || d.driveFileId === r.drive_file_id);
      if (j < 0) continue;
      volta(entregas[j], "nome", "nomeOriginal");
      await pg.query("UPDATE project_revision_requests SET deliveries = $1 WHERE id = $2", [JSON.stringify(entregas), rev.id]);
    }
  }
  // 4. registro
  await pg.query(`UPDATE project_documents SET canonical_name = canonical_name_before, drive_renamed_at = NULL, drive_name_before = NULL,
    drive_name_before_origem = NULL, canonical_name_before = NULL, list_name_before = NULL, list_original_added = NULL WHERE id = $1`, [id]);
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
    expect(r.colisoes).toBe(0);
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
    expect(drive.leituras).toEqual(["d11", "d14", "d15"]);
    expect(drive.chamadas).toEqual([["d11", "Eletrico-Maylanne-Araujo-2.pdf"], ["d15", "Rev1-Maylanne-Araujo-3.pdf"]]); // d14 já estava
    expect(r).toMatchObject({ pendentes: 3, renomeados: 2, jaEstavam: 1, falhas: 0, colisoes: 0, restante: false });
    const a = await linha(11);
    expect(a.canonical_name).toBe("Eletrico-Maylanne-Araujo-2.pdf");
    expect(a.original_name).toBe("PRANCHA FINAL (1) cópia.pdf");
    expect(a.drive_renamed_at).not.toBeNull();
    expect((await linha(14)).drive_renamed_at).toBeNull(); // já estava certo no Drive: só gravado
    expect((await linha(13)).canonical_name).toBe("apagado.dwg");
    expect((await linha(16)).canonical_name).toBe("sumiu da tela.pdf");
    expect([...drive.leituras, ...drive.chamadas.map(([id]) => id)].some(id => ["d12", "d13", "d16", "d99"].includes(id))).toBe(false);
    expect(drive.prazos.every(p => p > 0 && p <= 8_000)).toBe(true);
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
    const antes = drive.chamadas.length + drive.leituras.length;
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(drive.chamadas.length + drive.leituras.length).toBe(antes);
    expect(r).toMatchObject({ pendentes: 0, renomeados: 0, restante: false });
    expect(await nomesDaTela(7)).toEqual(tela);
  });
  it("falha num arquivo não interrompe os outros e fica registrada (só o código); nada é gravado dele", async () => {
    const drive = driveSimulado({});
    trocaQueFalha(drive, id => (id === "d11" ? new ErroDrive("upload", 404, "notFound", "detalhe") : undefined));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(r).toMatchObject({ renomeados: 2, falhas: 1, restante: true });
    expect(await linha(11)).toMatchObject({ canonical_name: "PROJETO_TECNICO_MAYLANNE_ELETRICO_V02.pdf", drive_rename_failures: 1, drive_rename_error: "upload:404:notFound" });
    const files = JSON.parse((await pg.query<{ files: string }>("SELECT files FROM operational_projects WHERE id = 7")).rows[0].files);
    expect(files[0].name).toBe("PROJETO_TECNICO_MAYLANNE_ELETRICO_V02.pdf");
    // depois do limite de falhas, a rotina desiste dele
    await pg.query("UPDATE project_documents SET drive_rename_failures = 5 WHERE id = 11");
    const depois = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(depois).toMatchObject({ pendentes: 0, desistidos: 1 });
  });
  it("lixeira e sem permissão: não toca e registra", async () => {
    const drive = driveSimulado({});
    drive.ler = vi.fn(async (id: string) => ({ nome: `antigo-${id}`, lixeira: id === "d11", podeRenomear: id !== "d14" }));
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(drive.chamadas.map(([id]) => id)).toEqual(["d15"]);
    expect(r).toMatchObject({ renomeados: 1, naoTocados: 2 });
    expect((await linha(11)).drive_rename_error).toBe("lixeira");
    expect((await linha(14)).drive_rename_error).toBe("sem_permissao");
  });
  it("limite de taxa do Google para o lote sem contar como falha do arquivo", async () => {
    const drive = driveSimulado({}, { trocar: vi.fn(async () => { throw new ErroDrive("upload", 403, "userRateLimitExceeded", undefined); }) });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(drive.trocar).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ falhas: 0, restante: true });
    expect((await linha(11)).drive_rename_failures).toBe(0);
  });
  it("5xx e tempo esgotado: registram o código, mas não contam para as 5 falhas", async () => {
    const tempo = Object.assign(new Error("tempo"), { name: "TimeoutError" });
    const drive = driveSimulado({});
    trocaQueFalha(drive, id => (id === "d11" ? new ErroDrive("upload", 503, "backendError", undefined) : id === "d14" ? tempo : undefined));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(r).toMatchObject({ renomeados: 1, falhas: 0, falhasTemporarias: 2, restante: true });
    expect(await linha(11)).toMatchObject({ drive_rename_failures: 0, drive_rename_error: "upload:503:backendError" });
    expect(await linha(14)).toMatchObject({ drive_rename_failures: 0, drive_rename_error: "tempo_esgotado" });
    // 4xx de verdade (fora limite de taxa) conta
    const drive2 = driveSimulado({}, { trocar: vi.fn(async () => { throw new ErroDrive("upload", 403, "insufficientFilePermissions", undefined); }) });
    const r2 = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive2);
    expect(r2).toMatchObject({ falhas: 2, falhasTemporarias: 0 });
    expect((await linha(11)).drive_rename_failures).toBe(1);
  });
  it("nome já usado no Drive por outro arquivo do projeto: não renomeia (nunca dois iguais)", async () => {
    // o registro 16 (fora da tela) já tem no Drive o nome que a tela daria ao 11
    await pg.query("UPDATE project_documents SET canonical_name = 'Eletrico-Maylanne-Araujo-2.pdf' WHERE id = 16");
    const drive = driveSimulado({});
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(r).toMatchObject({ colisoes: 1, renomeados: 2, restante: true });
    expect(drive.chamadas.some(([id]) => id === "d11")).toBe(false);
  });
  it.each(["deleted", "uploading"])("nome-alvo já é de um registro %s do projeto (o arquivo continua no Drive): não renomeia e conta colisão", async status => {
    await pg.query("UPDATE project_documents SET canonical_name = 'Eletrico-Maylanne-Araujo-2.pdf', status = $1 WHERE id = 13", [status]);
    const conferido = await renomearDocumentosProjetoNoDrive({ conferir: true }, driveSimulado({}));
    expect(conferido.colisoes).toBe(1);
    const drive = driveSimulado({});
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(r).toMatchObject({ colisoes: 1, renomeados: 2, restante: true });
    expect(drive.chamadas.some(([id]) => id === "d11")).toBe(false);
    expect((await linha(11)).canonical_name).toBe("PROJETO_TECNICO_MAYLANNE_ELETRICO_V02.pdf");
  });
  it("guarda o nome anterior (Drive, registro e lista) e se o original foi acrescentado; rodar de novo não sobrescreve", async () => {
    const so = (x: Antes) => ({ drive_name_before: x.drive_name_before, drive_name_before_origem: x.drive_name_before_origem, canonical_name_before: x.canonical_name_before, list_name_before: x.list_name_before, list_original_added: x.list_original_added });
    // d14 já está com o nome novo no Drive e nada foi lido antes: o "antes" do Drive é o canonical_name (ESTIMADO)
    const drive = driveSimulado({ d11: "PRANCHA NO DRIVE.pdf", d14: "Doc-Maylanne-Araujo-1.pdf" });
    await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(so(await antesDe(11))).toEqual({ drive_name_before: "PRANCHA NO DRIVE.pdf", drive_name_before_origem: "drive", canonical_name_before: "PROJETO_TECNICO_MAYLANNE_ELETRICO_V02.pdf", list_name_before: "PROJETO_TECNICO_MAYLANNE_ELETRICO_V02.pdf", list_original_added: false });
    expect(so(await antesDe(14))).toEqual({ drive_name_before: "Documento antigo muito longo.PDF", drive_name_before_origem: "registro", canonical_name_before: "Documento antigo muito longo.PDF", list_name_before: "Documento antigo muito longo.PDF", list_original_added: true });
    expect((await antesDe(14)).drive_renamed_at).toBeNull();
    expect(so(await antesDe(15))).toEqual({ drive_name_before: "antigo-d15", drive_name_before_origem: "drive", canonical_name_before: "Revisao 4 longa.pdf", list_name_before: "Revisao 4 longa.pdf", list_original_added: false });
    // mesmo se o registro voltar a ser processado (lista desfeita à mão), o "antes" já guardado não muda
    const files = await filesDo(7);
    files[0] = { ...files[0], name: "outro nome.pdf", originalName: undefined };
    await pg.query("UPDATE operational_projects SET files = $1 WHERE id = 7", [JSON.stringify(files)]);
    drive.nomes.d11 = "renomeado de novo.pdf";
    await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(drive.chamadas.filter(([id]) => id === "d11").length).toBe(2);
    expect(so(await antesDe(11))).toMatchObject({ drive_name_before: "PRANCHA NO DRIVE.pdf", drive_name_before_origem: "drive", canonical_name_before: "PROJETO_TECNICO_MAYLANNE_ELETRICO_V02.pdf", list_name_before: "PROJETO_TECNICO_MAYLANNE_ELETRICO_V02.pdf" });
  });
  it("(a) banco falha DEPOIS do PATCH: o nome real antigo já estava confirmado; a passagem seguinte grava drive_renamed_at e o desfazer volta ao estado exato", async () => {
    vi.stubEnv("PROJETOS_NOME_DRIVE_ESCREVER", "1");
    const drive = driveSimulado({ d11: "PRANCHA NO DRIVE.pdf" });
    const filesAntes = await filesDo(7);
    // a gravação do nome novo no registro falha (depois de o Drive já ter sido renomeado)
    await pg.exec(`CREATE FUNCTION barra() RETURNS trigger AS $$ BEGIN
      IF NEW.canonical_name IS DISTINCT FROM OLD.canonical_name THEN RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'barrado'; END IF;
      RETURN NEW; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER barra BEFORE UPDATE ON project_documents FOR EACH ROW EXECUTE FUNCTION barra();`);
    const logs: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { logs.push(a.map(x => (x instanceof Error ? `${x.message} ${String(x.cause)}` : String(x))).join(" ")); });
    expect(await renomearNomesDriveNoCron(true, 30_000, drive)).toEqual({ erro: true });
    expect(drive.nomes.d11).toBe("Eletrico-Maylanne-Araujo-2.pdf"); // o Google aplicou
    expect(await antesDe(11)).toMatchObject({ drive_name_before: "PRANCHA NO DRIVE.pdf", drive_name_before_origem: "drive", drive_renamed_at: null });
    expect((await linha(11)).canonical_name).toBe("PROJETO_TECNICO_MAYLANNE_ELETRICO_V02.pdf"); // a transação foi desfeita
    // LGPD: o log tem só o código, nunca a mensagem do Drizzle (que traz os parâmetros com nomes)
    expect(logs).toEqual(["[projetos/nome-drive] banco:40001"]);
    expect(logs.join(" ")).not.toMatch(/Maylanne|PRANCHA|Eletrico|Failed query/i);
    await pg.exec("DROP TRIGGER barra ON project_documents");
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(r).toMatchObject({ renomeados: 3, jaEstavam: 0 });
    expect(await antesDe(11)).toMatchObject({ drive_name_before: "PRANCHA NO DRIVE.pdf", drive_name_before_origem: "drive" });
    expect((await antesDe(11)).drive_renamed_at).not.toBeNull();
    await desfazer(11, drive);
    expect(drive.nomes.d11).toBe("PRANCHA NO DRIVE.pdf");
    expect((await filesDo(7))[0]).toEqual(filesAntes[0]);
    expect((await linha(11)).canonical_name).toBe("PROJETO_TECNICO_MAYLANNE_ELETRICO_V02.pdf");
    vi.unstubAllEnvs();
  });
  it("(b) tempo esgotado depois de o Google aplicar o PATCH: a passagem seguinte não perde o nome antigo; o desfazer volta ao estado exato", async () => {
    const drive = driveSimulado({ d14: "nome antigo no drive.PDF" });
    const filesAntes = await filesDo(7);
    const original = drive.trocar;
    drive.trocar = vi.fn(async (id: string, nome: string, prazo: number) => {
      await original(id, nome, prazo);
      if (id === "d14") throw Object.assign(new Error("tempo"), { name: "TimeoutError" });
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r1 = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(r1).toMatchObject({ falhasTemporarias: 1, renomeados: 2 });
    expect(drive.nomes.d14).toBe("Doc-Maylanne-Araujo-1.pdf");
    expect(await antesDe(14)).toMatchObject({ drive_name_before: "nome antigo no drive.PDF", drive_name_before_origem: "drive", drive_renamed_at: null, list_original_added: true });
    drive.trocar = original;
    const r2 = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(r2).toMatchObject({ renomeados: 1, jaEstavam: 0, restante: false });
    expect(drive.chamadas.filter(([id]) => id === "d14").length).toBe(1); // já estava: sem novo PATCH
    expect(await antesDe(14)).toMatchObject({ drive_name_before: "nome antigo no drive.PDF", drive_name_before_origem: "drive" });
    expect((await antesDe(14)).drive_renamed_at).not.toBeNull();
    await desfazer(14, drive);
    expect(drive.nomes.d14).toBe("nome antigo no drive.PDF");
    expect((await filesDo(7))[2]).toEqual(filesAntes[2]); // originalName acrescentado pela rotina foi retirado
    expect((await linha(14)).canonical_name).toBe("Documento antigo muito longo.PDF");
    // e a entrega de revisão também volta exata
    const [entregaAntes] = [{ nome: "Revisao 4 longa.pdf", nomeOriginal: "revisão nova.pdf", versao: 3, documentId: 15, driveFileId: "d15", tipo: "pdf", url: url("d15") }];
    await desfazer(15, drive);
    expect(JSON.parse((await pg.query<{ deliveries: string }>("SELECT deliveries FROM project_revision_requests WHERE id = 4")).rows[0].deliveries)[0]).toEqual(entregaAntes);
    expect(drive.nomes.d15).toBe("antigo-d15");
  });
  it("trava do projeto ocupada por mais de 2 s (lock_timeout): pula o projeto sem contar falha do arquivo", async () => {
    const banco = db.getDb();
    const ocupada = Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" }) });
    const tx = vi.spyOn(banco, "transaction").mockRejectedValue(ocupada);
    const drive = driveSimulado({});
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false }, drive);
    expect(tx).toHaveBeenCalledTimes(1); // os outros arquivos do mesmo projeto ficam para a próxima
    expect(drive.leituras).toEqual(["d11"]);
    expect(r).toMatchObject({ ocupados: 1, falhas: 0, renomeados: 0, restante: true });
    expect((await linha(11)).drive_rename_failures).toBe(0);
    expect(drive.chamadas).toEqual([]);
    tx.mockRejectedValue(new Error("outro erro"));
    await expect(renomearDocumentosProjetoNoDrive({ conferir: false }, drive)).rejects.toThrow("outro erro");
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
  it("só começa um arquivo se ainda couber o pior caso inteiro (2 × (8 s do Drive + 2 s de trava) = 20 s)", async () => {
    expect(ORCAMENTO_ARQUIVO_MS).toBe(20_000);
    let t = 0;
    const drive = driveSimulado({}, { agora: () => t });
    trocaQueFalha(drive, () => { t += 1_000; return undefined; });
    // começa em t = 0, 1, 2 e 3 s (3 + 20 = 23, ainda cabe); em t = 4 s já não cabe
    const r = await renomearDocumentosProjetoNoDrive({ conferir: false, prazoMs: 23_000 }, drive);
    expect(r.renomeados).toBe(4);
    expect(r.restante).toBe(true);
    expect(drive.prazos).toEqual(Array(8).fill(8_000)); // leitura e troca de cada um
    // prazo menor que o pior caso de um arquivo: nem começa
    const r2 = await renomearDocumentosProjetoNoDrive({ conferir: false, prazoMs: 19_999 }, driveSimulado({}));
    expect(r2.renomeados).toBe(0);
    // pior caso no cron: até 30 s depois de no máximo 20 s dos avisos (total até 50 s < 60 s da Vercel)
  });
});

describe("no cron (permissão)", () => {
  beforeEach(async () => { await montar(); vi.stubEnv("PROJETOS_NOME_DRIVE_ESCREVER", "1"); });
  afterEach(() => { vi.unstubAllEnvs(); });
  it("sem o segredo do cron ou sem tempo, não faz nada", async () => {
    const drive = driveSimulado({});
    expect(await renomearNomesDriveNoCron(false, 15_000, drive)).toEqual({ pulado: true });
    expect(await renomearNomesDriveNoCron(true, 1_000, drive)).toEqual({ pulado: true });
    expect(drive.chamadas).toEqual([]);
  });
  it("com o segredo, um lote; sem as colunas da migração, nunca lança", async () => {
    const drive = driveSimulado({});
    expect(await renomearNomesDriveNoCron(true, 30_000, drive)).toMatchObject({ renomeados: 3 });
    await pg.exec("ALTER TABLE project_documents DROP COLUMN drive_rename_failures");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await renomearNomesDriveNoCron(true, 30_000, drive)).toEqual({ erro: true });
  });
  it.each([undefined, "0", "sim"])("sem PROJETOS_NOME_DRIVE_ESCREVER=1 (%s): só confere e devolve SÓ contagens, sem exemplos", async valor => {
    if (valor === undefined) vi.stubEnv("PROJETOS_NOME_DRIVE_ESCREVER", undefined as unknown as string); else vi.stubEnv("PROJETOS_NOME_DRIVE_ESCREVER", valor);
    await pg.query("UPDATE project_documents SET canonical_name = 'Eletrico-Maylanne-Araujo-2.pdf' WHERE id = 13");
    const drive = driveSimulado({});
    const r = await renomearNomesDriveNoCron(true, 30_000, drive);
    expect(r).toEqual({ conferir: true, pendentes: 3, semVinculoNaTela: 1, desistidos: 0, colisoes: 1 });
    expect(JSON.stringify(r)).not.toMatch(/Maylanne|exemplos/);
    expect(drive.chamadas).toEqual([]);
    expect((await linha(11)).canonical_name).toBe("PROJETO_TECNICO_MAYLANNE_ELETRICO_V02.pdf");
  });
});
