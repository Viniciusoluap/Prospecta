// 11/11: anexos da Due Diligence/registro aceitam qualquer tipo (foto, DWG, Word...),
// até 50 MB, enviados e lidos em partes de 2 MiB. Banco real em memória (PGlite) com a 0101.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db.js", async orig => ({ ...(await orig<typeof import("./db.js")>()), getDb: vi.fn(), getIncorporationStudyById: vi.fn() }));
vi.mock("./drive-documents.js", async orig => ({
  ...(await orig<typeof import("./drive-documents.js")>()),
  driveConfigured: vi.fn(async () => false),
  tryDriveUpload: vi.fn(async () => ({ driveFileId: null, note: null })),
  readPrivateDocumentRange: vi.fn(),
}));

import { getDb, getIncorporationStudyById } from "./db.js";
import { readPrivateDocumentRange, tryDriveUpload } from "./drive-documents.js";
import { incorporacaoDocumentsRouter, mimeConferido } from "./incorporacao-documents-router.js";
import { anexoVisualizavel, mimeDoAnexo, nomeAnexoSeguro, PARTE_ANEXO_BYTES, partesDoAnexo } from "../shared/incorporacao/anexos.js";

const E1 = "11111111-1111-4111-8111-111111111111", D1 = "22222222-2222-4222-8222-222222222222";
const DD = JSON.stringify({ versao: 1, etapas: [{ id: E1, nome: "Etapa", procedimentos: "", observacoes: "", tarefas: [], documentos: [{ id: D1, nome: "Planta", obtido: false }] }] });
const ITEM = `dd_${E1}_${D1}`;

let pg: PGlite;
async function novoBanco() {
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE users (id serial PRIMARY KEY);
    INSERT INTO users DEFAULT VALUES; INSERT INTO users DEFAULT VALUES;
    CREATE TABLE incorporation_studies (id serial PRIMARY KEY, survey_url text, updated_at timestamp);
    INSERT INTO incorporation_studies DEFAULT VALUES;
    CREATE TABLE incorporation_registration_documents (
      id serial PRIMARY KEY, study_id integer NOT NULL REFERENCES incorporation_studies(id), item_id varchar(120) NOT NULL,
      action varchar(12) NOT NULL, drive_file_id text, file_name varchar(255), mime_type varchar(40), file_size integer,
      sha256 varchar(64), storage varchar(10) DEFAULT 'drive' NOT NULL, storage_note varchar(400),
      performed_by_user_id integer NOT NULL REFERENCES users(id), created_at timestamp DEFAULT now() NOT NULL);
    CREATE TABLE incorporation_registration_file_data (
      document_id integer PRIMARY KEY REFERENCES incorporation_registration_documents(id) ON DELETE CASCADE,
      mime varchar(120) NOT NULL, size_bytes integer NOT NULL, data bytea NOT NULL);
  `);
  await pg.exec(readFileSync(new URL("../drizzle/0101_anexos_qualquer_tipo.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
  vi.mocked(getDb).mockReturnValue(drizzle(pg) as never);
}
const caller = (userId = 1) => incorporacaoDocumentsRouter.createCaller({ user: { id: userId, role: "admin", active: true }, req: {}, res: {} } as never);

/** Mesmo protocolo do cliente (compat/acoes.ts): partes de 2 MiB + finalização. */
async function enviar(data: Buffer, fileName: string, mimeType: string, uploadId = "envio-de-teste-0001") {
  const c = caller();
  for (let part = 0; part < partesDoAnexo(data.length); part++)
    await c.uploadPart({ studyId: 1, itemId: ITEM, uploadId, part, base64: data.subarray(part * PARTE_ANEXO_BYTES, (part + 1) * PARTE_ANEXO_BYTES).toString("base64") });
  return c.uploadFinish({ studyId: 1, itemId: ITEM, uploadId, fileName, mimeType, size: data.length });
}
async function baixar() {
  const c = caller();
  const primeira = await c.contentPart({ studyId: 1, itemId: ITEM, part: 0 });
  const blocos = [Buffer.from(primeira.base64, "base64")];
  for (let part = 1; part < primeira.parts; part++) blocos.push(Buffer.from((await c.contentPart({ studyId: 1, itemId: ITEM, part })).base64, "base64"));
  return { ...primeira, data: Buffer.concat(blocos) };
}

describe("Tipos de anexo", () => {
  it("usa o tipo do navegador; sem ele, a extensão (iPad); senão genérico", () => {
    expect(mimeDoAnexo("planta.dwg", "")).toBe("image/vnd.dwg");
    expect(mimeDoAnexo("Memorial.DOCX", "")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(mimeDoAnexo("IMG_0001.HEIC", "")).toBe("image/heic");
    expect(mimeDoAnexo("foto.jpg", "image/jpeg")).toBe("image/jpeg");
    expect(mimeDoAnexo("sem-extensao", "")).toBe("application/octet-stream");
    expect(mimeDoAnexo("x.bin", "tipo inválido")).toBe("application/octet-stream");
  });
  it("só PDF/foto/texto abrem na aba; HTML/SVG nunca (seriam executados)", () => {
    expect(anexoVisualizavel("application/pdf")).toBe(true);
    expect(anexoVisualizavel("image/png")).toBe(true);
    for (const m of ["text/html", "image/svg+xml", "application/xml", "image/vnd.dwg", "application/msword"]) expect(anexoVisualizavel(m)).toBe(false);
  });
  it("arquivo que diz ser PDF sem assinatura vira genérico", () => {
    expect(mimeConferido("application/pdf", Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    expect(mimeConferido("application/pdf", Buffer.from("<html>"))).toBe("application/octet-stream");
    expect(mimeConferido("image/vnd.dwg", Buffer.from("AC1032"))).toBe("image/vnd.dwg");
  });
  it("nome seguro mantém a extensão", () => {
    expect(nomeAnexoSeguro("../a/b\u0000.dwg")).toBe(".._a_b_.dwg");
  });
});

describe("Envio e leitura em partes (banco em memória)", () => {
  beforeEach(async () => {
    vi.mocked(getIncorporationStudyById).mockResolvedValue({ id: 1, dueDiligenceJson: DD } as never);
    vi.mocked(tryDriveUpload).mockResolvedValue({ driveFileId: null, note: null });
    await novoBanco();
  });

  it("Word com MIME longo (71 caracteres) e DWG grande (5 MiB, 3 partes) chegam íntegros", async () => {
    const docx = Buffer.from("PK\u0003\u0004 conteudo do word");
    const mimeDocx = mimeDoAnexo("Memorial.docx", "");
    const r1 = await enviar(docx, "Memorial.docx", mimeDocx);
    expect(r1).toMatchObject({ duplicate: false, storage: "banco" });
    let b = await baixar();
    expect(b).toMatchObject({ fileName: "Memorial.docx", mimeType: mimeDocx, parts: 1 });
    expect(b.data.equals(docx)).toBe(true);

    const dwg = Buffer.alloc(5 * 1024 * 1024 + 123);
    for (let i = 0; i < dwg.length; i++) dwg[i] = (i * 31 + 7) % 256;
    await enviar(dwg, "Planta baixa.dwg", "image/vnd.dwg", "envio-de-teste-0002");
    b = await baixar();
    expect(b).toMatchObject({ fileName: "Planta baixa.dwg", mimeType: "image/vnd.dwg", parts: 3, size: dwg.length });
    expect(b.data.equals(dwg)).toBe(true);
    // a área temporária fica vazia depois de finalizar
    expect((await pg.query("SELECT count(*)::int AS n FROM incorporation_upload_parts")).rows[0]).toEqual({ n: 0 });
  });

  it("no Drive, a mesma montagem é enviada inteira e a leitura usa trecho (Range)", async () => {
    const foto = Buffer.alloc(3 * 1024 * 1024, 9);
    vi.mocked(tryDriveUpload).mockResolvedValue({ driveFileId: "drive-1", note: null });
    await enviar(foto, "IMG_0001.HEIC", "image/heic");
    vi.mocked(readPrivateDocumentRange).mockImplementation(async (_id, ini, fim) => foto.subarray(ini, fim));
    const b = await baixar();
    expect(vi.mocked(readPrivateDocumentRange).mock.calls.map((c) => c.slice(1))).toEqual([[0, PARTE_ANEXO_BYTES], [PARTE_ANEXO_BYTES, foto.length]]);
    expect(b).toMatchObject({ mimeType: "image/heic", parts: 2 });
    expect(b.data.equals(foto)).toBe(true);
  });

  it("recusa envio incompleto, parte de outro usuário e o levantamento por esta via", async () => {
    const c = caller();
    await c.uploadPart({ studyId: 1, itemId: ITEM, uploadId: "envio-incompleto-01", part: 0, base64: Buffer.alloc(PARTE_ANEXO_BYTES, 1).toString("base64") });
    await expect(c.uploadFinish({ studyId: 1, itemId: ITEM, uploadId: "envio-incompleto-01", fileName: "a.zip", mimeType: "application/zip", size: PARTE_ANEXO_BYTES + 10 }))
      .rejects.toThrow(/incompleto/);
    await caller(1).uploadPart({ studyId: 1, itemId: ITEM, uploadId: "envio-de-outro-0001", part: 0, base64: Buffer.from("abc").toString("base64") });
    await expect(caller(2).uploadPart({ studyId: 1, itemId: ITEM, uploadId: "envio-de-outro-0001", part: 0, base64: Buffer.from("xyz").toString("base64") }))
      .rejects.toThrow();
    await expect(caller(2).uploadFinish({ studyId: 1, itemId: ITEM, uploadId: "envio-de-outro-0001", fileName: "a.txt", mimeType: "text/plain", size: 3 }))
      .rejects.toThrow(/incompleto/);
    await expect(c.uploadPart({ studyId: 1, itemId: "levantamento_topografico", uploadId: "envio-levantamento-1", part: 0, base64: "YWJj" }))
      .rejects.toThrow(/levantamento/);
    // item que não existe na Due Diligence salva
    await expect(c.uploadPart({ studyId: 1, itemId: `dd_${E1}_33333333-3333-4333-8333-333333333333`, uploadId: "envio-item-errado-1", part: 0, base64: "YWJj" })).rejects.toThrow(/não encontrado/);
  });

  it("envio pequeno (rota antiga) também aceita qualquer tipo", async () => {
    const r = await caller().upload({ studyId: 1, itemId: ITEM, fileName: "planta.dwg", mimeType: "image/vnd.dwg", base64: Buffer.from("AC1032").toString("base64") });
    expect(r).toMatchObject({ storage: "banco" });
    expect((await baixar()).data.toString()).toBe("AC1032");
  });
});
