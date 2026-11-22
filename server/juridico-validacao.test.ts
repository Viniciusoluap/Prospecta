// Conferência automática das assinaturas, relatório gravado por documento e retentativa — ICP sintética, banco PGlite,
// rede SIMULADA (nenhuma chamada real), nenhum e-mail enviado, nenhum contrato real.
import "fake-indexeddb/auto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { jsPDF } from "jspdf";
import { P12Signer, PDF, rgb } from "@libpdf/core";
import { criarPki, rede, URLS, type Pki } from "./__fixtures__/juridico-pki-ca";

const simulado = vi.hoisted(() => ({ rede: null as null | { resolver: (h: string) => Promise<string[]>; transporte: (p: { url: URL }) => Promise<{ status: number; corpo?: Buffer }>; chamadas: string[] } }));
vi.mock("./juridico-pki-download", async original => {
  const m = await original<typeof import("./juridico-pki-download")>();
  class SessaoSimulada extends m.SessaoPki {
    constructor(opcoes: ConstructorParameters<typeof m.SessaoPki>[0] = {}) {
      if (!simulado.rede) throw new Error("rede simulada não configurada");
      super({ ...opcoes, resolver: simulado.rede.resolver, transporte: simulado.rede.transporte as never });
    }
  }
  return { ...m, SessaoPki: SessaoSimulada };
});

import * as banco from "./db";
import { conferirAssinaturas } from "./juridico-verificar-assinaturas";
import { limparCacheLcr, raizesIcp } from "./juridico-pki";
import { juridicoRouter } from "./juridico-router";
import { portalRouter } from "./portal-router";
import { proximaTentativa, RETENTATIVA, sha256Hex, _esquecerTabela } from "./juridico-validacao";
import { revalidarDocumento, revalidarPendentes } from "./juridico-revalidacao";
import { montarCadeiaPublica, _limparLimiteCadeia } from "./juridico-cadeia";
import { _limparEnviosPortal } from "./juridico-workflow";
import { assinarPdf, importarCertificado } from "../client/src/lib/certificados-digitais";

let pki: Pki;
const signers: Record<string, P12Signer> = {};
beforeAll(async () => {
  pki = criarPki();
  raizesIcp.push(pki.raiz); // só neste arquivo: a raiz sintética entra como confiável
  for (const nome of ["empresa", "cliente", "testemunha", "revogado"]) signers[nome] = await P12Signer.create(pki.pfx(nome), "teste-somente", { buildChain: false });
}, 120_000);
afterAll(() => { raizesIcp.splice(raizesIcp.indexOf(pki.raiz), 1); pki?.limpar(); });
beforeEach(() => { limparCacheLcr(); _esquecerTabela(); _limparLimiteCadeia(); _limparEnviosPortal(); simulado.rede = rede(pki); });
afterEach(() => vi.restoreAllMocks());

const contratoBase = () => { const doc = new jsPDF(); doc.text("CONTRATO SINTETICO DE TESTE", 20, 20); return Buffer.from(doc.output("arraybuffer")); };
async function assinar(bytes: Buffer, quem: string) { const pdf = await PDF.load(new Uint8Array(bytes)); return Buffer.from((await pdf.sign({ signer: signers[quem] })).bytes); }
const partes = { partyADocument: "12.345.678/0001-90", partyBDocument: "123.456.789-01", signers: ["CONSTRUTORA — EMPRESA TESTE", "CONTRATANTE — CLIENTE TESTE"] };

describe("conferência das assinaturas do PDF (ICP sintética)", () => {
  it("múltiplas assinaturas íntegras e válidas: todas as partes conferidas", async () => {
    const final = await assinar(await assinar(contratoBase(), "empresa"), "cliente");
    const r = await conferirAssinaturas(final, partes);
    expect(r).toMatchObject({ estado: "valida", todos: true, validas: 2, coberturaTotal: true });
    expect(r.assinaturas.map(a => a.documento)).toEqual(["12345678000190", "12345678901"]);
    expect(r.assinaturas[0].cobertura[1]).toBeLessThan(r.assinaturas[1].cobertura[1]);
  });
  it("testemunha identificada só conta quando ela também assina", async () => {
    const comTestemunha = { ...partes, signers: [...partes.signers, "1ª TESTEMUNHA — TESTEMUNHA TESTE — CPF 987.654.321-00"] };
    const duas = await assinar(await assinar(contratoBase(), "empresa"), "cliente");
    expect((await conferirAssinaturas(duas, comTestemunha)).todos).toBe(false);
    expect((await conferirAssinaturas(await assinar(duas, "testemunha"), comTestemunha))).toMatchObject({ todos: true, validas: 3 });
  });
  it("integridade: um byte alterado dentro da área assinada torna o PDF inválido", async () => {
    const assinado = await assinar(contratoBase(), "empresa");
    const alterado = Buffer.from(assinado); alterado[40] ^= 1;
    expect(await conferirAssinaturas(alterado, partes)).toMatchObject({ estado: "invalida", todos: false });
  });
  it("cobertura: conteúdo acrescentado depois da última assinatura não é aceito", async () => {
    const assinado = await assinar(contratoBase(), "empresa");
    const r = await conferirAssinaturas(Buffer.concat([assinado, Buffer.from("\n% acrescimo\n")]), partes);
    expect(r).toMatchObject({ estado: "invalida", coberturaTotal: false });
  });
  it("revogado → inválido; rede fora → pendente transitório com integridade conferida (não é inválido)", async () => {
    expect((await conferirAssinaturas(await assinar(contratoBase(), "revogado"), partes)).estado).toBe("invalida");
    simulado.rede = rede(pki, { fora: [URLS.interCert, URLS.interCrl] });
    const r = await conferirAssinaturas(await assinar(contratoBase(), "empresa"), partes);
    expect(r).toMatchObject({ estado: "pendente", transitoria: true, todos: false });
    expect(r.assinaturas[0]).toMatchObject({ integridade: true, estado: "pendente" });
  });
  it("ByteRange manipulado é inválido", async () => {
    const assinado = await assinar(contratoBase(), "empresa");
    const texto = assinado.toString("latin1");
    const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(texto)!;
    const ultimo = m[4], trocado = String(Number(ultimo) - 1).padStart(ultimo.length, "0");
    const alterado = Buffer.from(texto.replace(m[0], m[0].replace(new RegExp(`${ultimo}(\\s*\\])$`), `${trocado}$1`)), "latin1");
    expect(alterado.equals(assinado)).toBe(false);
    expect((await conferirAssinaturas(alterado, partes)).estado).toBe("invalida");
  });
  it("algoritmo CMS não suportado permanece pendente sem alegar integridade conferida", async () => {
    const bytes = await assinar(contratoBase(), "empresa");
    const { SignedData } = await import("pkijs");
    vi.spyOn(SignedData.prototype, "verify").mockRejectedValueOnce(new DOMException("Unsupported algorithm", "NotSupportedError"));
    const r = await conferirAssinaturas(bytes, partes);
    expect(r).toMatchObject({ estado: "pendente", transitoria: false, todos: false });
    expect(r.assinaturas[0].integridade).toBe(false);
    expect(r.motivo).not.toContain("íntegra");
  });
  it("CMS com dois signerInfos no mesmo campo é inválido", async () => {
    const assinado = await assinar(contratoBase(), "empresa");
    const texto = assinado.toString("latin1");
    const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(texto)!;
    const [a, b, c, d] = m.slice(1).map(Number);
    writeFileSync(join(pki.dir, "dados.bin"), Buffer.concat([assinado.subarray(a, a + b), assinado.subarray(c, c + d)]));
    execFileSync("openssl", ["cms", "-sign", "-binary", "-outform", "DER", "-in", "dados.bin", "-out", "dois.der",
      "-signer", "empresa.pem", "-inkey", "empresa-chave.pem", "-signer", "cliente.pem", "-inkey", "cliente-chave.pem"], { cwd: pki.dir, stdio: "ignore" });
    const { readFileSync: ler } = await import("node:fs");
    const hex = ler(join(pki.dir, "dois.der")).toString("hex");
    const espaco = c - b - 2;
    expect(hex.length).toBeLessThanOrEqual(espaco);
    const novo = Buffer.from(assinado);
    novo.write(`<${hex.padEnd(espaco, "0")}>`, b, "latin1");
    expect((await conferirAssinaturas(novo, partes))).toMatchObject({ estado: "invalida" });
  });
  it("PDF sem assinatura ou ilegível é inválido", async () => {
    expect((await conferirAssinaturas(contratoBase(), partes)).estado).toBe("invalida");
    expect((await conferirAssinaturas(Buffer.from("%PDF-1.7 lixo"), partes)).estado).toBe("invalida");
  });
});

// ── Banco ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const MIGRACAO = readFileSync(new URL("../drizzle/0161_juridico_validacao_assinaturas.sql", import.meta.url), "utf8");
async function preparar(migrar = true) {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE portal_contracts (id serial primary key, lead_id integer, number text, type text, status text default 'ativo', party_a text, party_a_document text, party_b text, party_b_document text, property_id integer, value numeric, due_at timestamp, signature_date date, project_id integer, contractor_id integer, broker_id integer, signers jsonb, description text, clauses text, signature_status text default 'pendente', signature_gov_id text, signed_document_url text, created_at timestamp default now(), updated_at timestamp default now());
    CREATE TABLE portal_contract_documents (id serial primary key, contract_id integer references portal_contracts(id) on delete cascade, name text, type text, url text, drive_file_id text, created_at timestamp default now());
    CREATE TABLE portal_contract_file_data (document_id integer primary key references portal_contract_documents(id) on delete cascade, mime text, size_bytes integer check(size_bytes>0), data bytea);
    INSERT INTO portal_contracts (id, number, type, signature_date, lead_id, party_b, party_a_document, party_b_document, signers, clauses) VALUES (1,'TESTE-1','construcao_atc','2026-11-21',20,'Cliente Teste','12.345.678/0001-90','123.456.789-01','["CONSTRUTORA — EMPRESA TESTE","CONTRATANTE — CLIENTE TESTE"]','CLÁUSULA TESTE');`);
  if (migrar) { await pg.exec(MIGRACAO); await pg.exec(MIGRACAO); }
  const real = drizzle(pg);
  const fake = { select: real.select.bind(real), insert: real.insert.bind(real), execute: real.execute.bind(real), update: real.update.bind(real), batch: async (ops: { execute(): Promise<unknown> }[]) => {
    await pg.exec("BEGIN"); try { const out = []; for (const op of ops) out.push(await op.execute()); await pg.exec("COMMIT"); return out; }
    catch (e) { await pg.exec("ROLLBACK"); throw e; }
  } };
  vi.spyOn(banco, "getDb").mockReturnValue(fake as never);
  return pg;
}
const admin = () => juridicoRouter.createCaller({ user: { id: 1, role: "admin", active: true }, req: {}, res: {} } as never);
const cliente = () => portalRouter.createCaller({ user: { id: 9, role: "cliente", leadId: 20 }, req: {}, res: {} } as never);
const b64 = (b: Buffer) => b.toString("base64");
async function gerado(pg: PGlite, bytes: Buffer) {
  const id = (await pg.query<{ id: number }>("INSERT INTO portal_contract_documents (contract_id,name,type) VALUES (1,'gerado.pdf','contrato_gerado') RETURNING id")).rows[0].id;
  await pg.query("INSERT INTO portal_contract_file_data VALUES ($1,'application/pdf',$2,$3)", [id, bytes.length, bytes]);
  return id;
}
const linhaValidacao = async (pg: PGlite, id: number) => (await pg.query<{ estado: string; origem: string; sha256: string; tentativas: number; proxima_tentativa: Date | null; relatorio: Record<string, unknown> }>("SELECT * FROM portal_contract_document_validacoes WHERE document_id=$1", [id])).rows[0];

describe("migração 0161", () => {
  it("é aditiva e idempotente e recusa estado/sha inválidos", async () => {
    const pg = await preparar();
    try {
      await pg.exec(MIGRACAO);
      await pg.exec("INSERT INTO portal_contract_documents (id,contract_id,name,type) VALUES (50,1,'x','anexo')");
      await expect(pg.exec(`INSERT INTO portal_contract_document_validacoes (document_id,estado,origem,sha256,relatorio,verificado_em) VALUES (50,'verde','retorno_admin','${"a".repeat(64)}','{}',now())`)).rejects.toThrow();
      await expect(pg.exec("INSERT INTO portal_contract_document_validacoes (document_id,estado,origem,sha256,relatorio,verificado_em) VALUES (50,'valida','retorno_admin','abc','{}',now())")).rejects.toThrow();
      await pg.exec("DELETE FROM portal_contract_documents WHERE id=50");
    } finally { await pg.close(); }
  });
});

describe("upload da assinatura da empresa: conferência no servidor e relatório gravado junto", () => {
  it("válida: titular = Parte A, vínculo com o documento de origem, SHA-256 e origem gravados no mesmo lote", async () => {
    const pg = await preparar();
    try {
      const original = contratoBase(); const origemId = await gerado(pg, original);
      const assinado = await assinar(original, "empresa");
      const doc = await admin().uploadDocument({ contractId: 1, name: "x.pdf", type: "assinatura_digital", base64: b64(assinado), documentoOrigemId: origemId });
      expect(doc.validacao).toMatchObject({ estado: "valida", origem: "assinatura_empresa", vinculoOrigem: "conferido", parteA: { conferida: true } });
      expect(doc.validacao?.aviso).toMatch(/Não é o relatório oficial do VALIDAR\/ITI/);
      const linha = await linhaValidacao(pg, doc.id);
      expect(linha).toMatchObject({ estado: "valida", origem: "assinatura_empresa", sha256: sha256Hex(assinado), tentativas: 0, proxima_tentativa: null });
      expect((await pg.query("SELECT signature_status FROM portal_contracts")).rows[0]).toEqual({ signature_status: "parcial" });
      const detalhe = await admin().getById({ id: 1 });
      expect(detalhe?.validacoes).toEqual([expect.objectContaining({ documentId: doc.id, estado: "valida", titulares: [expect.objectContaining({ documento: "12345678000190" })] })]);
      // O original continua intacto.
      expect(Buffer.from((await pg.query<{ data: Uint8Array }>("SELECT data FROM portal_contract_file_data WHERE document_id=$1", [origemId])).rows[0].data).equals(original)).toBe(true);
    } finally { await pg.close(); }
  }, 60_000);
  it("titular diferente da Parte A, PDF de outro documento ou origem de outro contrato: nunca validado", async () => {
    const pg = await preparar();
    try {
      const original = contratoBase(); const origemId = await gerado(pg, original);
      const outroTitular = await admin().uploadDocument({ contractId: 1, name: "x.pdf", type: "assinatura_digital", base64: b64(await assinar(original, "cliente")), documentoOrigemId: origemId });
      expect(outroTitular.validacao).toMatchObject({ estado: "invalida", parteA: { conferida: false } });
      const outroDoc = new jsPDF(); outroDoc.text("OUTRO DOCUMENTO", 20, 20);
      const divergente = await admin().uploadDocument({ contractId: 1, name: "x.pdf", type: "assinatura_digital", base64: b64(await assinar(Buffer.from(outroDoc.output("arraybuffer")), "empresa")), documentoOrigemId: origemId });
      expect(divergente.validacao).toMatchObject({ estado: "invalida", vinculoOrigem: "divergente" });
      await pg.exec("INSERT INTO portal_contracts (id, number) VALUES (2,'OUTRO')");
      await expect(admin().uploadDocument({ contractId: 2, name: "x.pdf", type: "assinatura_digital", base64: b64(await assinar(original, "empresa")), documentoOrigemId: origemId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      // Origem que não é contrato gerado/anexo (ex.: outra assinatura) também é recusada.
      await expect(admin().uploadDocument({ contractId: 1, name: "x.pdf", type: "assinatura_digital", base64: b64(await assinar(original, "empresa")), documentoOrigemId: outroTitular.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    } finally { await pg.close(); }
  }, 60_000);
  it("A1: texto acrescentado à página antes de assinar ('VALOR ALTERADO 999') quebra o vínculo com a origem", async () => {
    const pg = await preparar();
    try {
      const original = contratoBase(); const origemId = await gerado(pg, original);
      const pdf = await PDF.load(new Uint8Array(original));
      pdf.getPage(0)!.drawText("VALOR ALTERADO 999", { x: 20, y: 700, size: 12 });
      const adulterado = Buffer.from((await pdf.sign({ signer: signers.empresa })).bytes);
      expect(adulterado.subarray(0, original.length).equals(original)).toBe(true); // o prefixo sozinho não basta
      const doc = await admin().uploadDocument({ contractId: 1, name: "x.pdf", type: "assinatura_digital", base64: b64(adulterado), documentoOrigemId: origemId });
      expect(doc.validacao).toMatchObject({ estado: "invalida", vinculoOrigem: "divergente" });
      // A marca legítima do assinador (retângulo + linhas do titular) continua aceita.
      const salvo = await importarCertificado(31, new File([pki.pfx("empresa")], "empresa.pfx"), "teste-somente");
      const { bytes } = await assinarPdf(new Uint8Array(original), salvo, "teste-somente", { pagina: 0, x: 60, y: 80, largura: 300, altura: 84 });
      const marcado = await admin().uploadDocument({ contractId: 1, name: "x.pdf", type: "assinatura_digital", base64: b64(Buffer.from(bytes)), documentoOrigemId: origemId });
      expect(marcado.validacao).toMatchObject({ estado: "valida", vinculoOrigem: "conferido" });
      // Marca com retângulo preenchido (capaz de cobrir cláusulas) não é aceita.
      const cobre = await PDF.load(new Uint8Array(original));
      cobre.getPage(0)!.drawRectangle({ x: 0, y: 0, width: 300, height: 300, color: rgb(1, 1, 1) });
      const coberto = Buffer.from((await cobre.sign({ signer: signers.empresa })).bytes);
      expect((await admin().uploadDocument({ contractId: 1, name: "x.pdf", type: "assinatura_digital", base64: b64(coberto), documentoOrigemId: origemId })).validacao).toMatchObject({ estado: "invalida" });
    } finally { await pg.close(); }
  }, 60_000);
  it("A2: assinatura da empresa exige o documento de origem", async () => {
    const pg = await preparar();
    try {
      await expect(admin().uploadDocument({ contractId: 1, name: "x.pdf", type: "assinatura_digital", base64: b64(await assinar(contratoBase(), "empresa")) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    } finally { await pg.close(); }
  }, 60_000);
  it("falha ao gravar o relatório desfaz documento, arquivo e status (atômico)", async () => {
    const pg = await preparar();
    try {
      const original = contratoBase(); const origemId = await gerado(pg, original);
      await pg.exec("ALTER TABLE portal_contract_document_validacoes ADD CONSTRAINT teste_falha CHECK (tentativas < 0)");
      await expect(admin().uploadDocument({ contractId: 1, name: "x.pdf", type: "assinatura_digital", base64: b64(await assinar(original, "empresa")), documentoOrigemId: origemId })).rejects.toThrow();
      expect((await pg.query("SELECT id FROM portal_contract_documents WHERE type='assinatura_digital'")).rows).toEqual([]);
      expect((await pg.query("SELECT signature_status FROM portal_contracts WHERE id=1")).rows[0]).toEqual({ signature_status: "pendente" });
    } finally { await pg.close(); }
  }, 60_000);
  it("sem a migração aplicada: o upload continua funcionando e a conferência volta na resposta", async () => {
    const pg = await preparar(false);
    try {
      const original = contratoBase(); const origemId = await gerado(pg, original);
      const doc = await admin().uploadDocument({ contractId: 1, name: "x.pdf", type: "assinatura_digital", base64: b64(await assinar(original, "empresa")), documentoOrigemId: origemId });
      expect(doc.validacao).toMatchObject({ estado: "valida", proximaTentativa: null });
      expect((await admin().getById({ id: 1 }))?.validacoes).toEqual([]);
    } finally { await pg.close(); }
  }, 60_000);
});

describe("pendência de rede e retentativa automática", () => {
  it("rede fora → pendente com próxima tentativa; nova rodada com rede de volta → válida; timeout nunca vira verde", async () => {
    const pg = await preparar();
    try {
      const original = contratoBase(); const origemId = await gerado(pg, original);
      simulado.rede = rede(pki, { fora: [URLS.interCert] });
      const doc = await admin().uploadDocument({ contractId: 1, name: "x.pdf", type: "assinatura_digital", base64: b64(await assinar(original, "empresa")), documentoOrigemId: origemId });
      expect(doc.validacao).toMatchObject({ estado: "pendente", transitoria: true });
      expect(doc.validacao?.proximaTentativa).not.toBeNull();
      // Antes da hora: não confere de novo.
      expect(await revalidarDocumento(doc.id)).toMatchObject({ estado: "pendente", tentativas: 0 });
      const depois = new Date(Date.now() + 11 * 60_000);
      // Ainda fora do ar: continua pendente (não vira válida por timeout) e agenda a próxima.
      const aindaFora = await revalidarDocumento(doc.id, { agora: depois });
      expect(aindaFora).toMatchObject({ estado: "pendente", tentativas: 1, transitoria: true });
      simulado.rede = rede(pki);
      const volta = await revalidarDocumento(doc.id, { agora: new Date(Date.now() + 3 * 3600_000) });
      expect(volta).toMatchObject({ estado: "valida", tentativas: 2, proximaTentativa: null });
      expect((await linhaValidacao(pg, doc.id)).estado).toBe("valida");
    } finally { await pg.close(); }
  }, 60_000);
  it("duas rodadas simultâneas: só uma confere e grava", async () => {
    const pg = await preparar();
    try {
      const original = contratoBase(); const origemId = await gerado(pg, original);
      simulado.rede = rede(pki, { fora: [URLS.interCert] });
      const doc = await admin().uploadDocument({ contractId: 1, name: "x.pdf", type: "assinatura_digital", base64: b64(await assinar(original, "empresa")), documentoOrigemId: origemId });
      simulado.rede = rede(pki);
      const agora = new Date(Date.now() + 11 * 60_000);
      const [a, b] = await Promise.all([revalidarDocumento(doc.id, { agora }), revalidarDocumento(doc.id, { agora })]);
      expect([a?.estado, b?.estado]).toContain("valida");
      const linha = await linhaValidacao(pg, doc.id);
      expect(linha.tentativas).toBe(1);
    } finally { await pg.close(); }
  }, 60_000);
  it("limites: no máximo 6 tentativas e 7 dias; pendência manual não é repetida", () => {
    const inicio = new Date("2026-11-22T10:00:00Z");
    expect(proximaTentativa({ estado: "pendente", transitoria: true }, 0, inicio, inicio)?.getTime()).toBe(inicio.getTime() + RETENTATIVA.esperasMs[0]);
    expect(proximaTentativa({ estado: "pendente", transitoria: true }, RETENTATIVA.maxTentativas, inicio, inicio)).toBeNull();
    expect(proximaTentativa({ estado: "pendente", transitoria: true }, 2, inicio, new Date(inicio.getTime() + 7 * 86_400_000))).toBeNull();
    expect(proximaTentativa({ estado: "pendente", transitoria: false }, 0, inicio, inicio)).toBeNull();
    expect(proximaTentativa({ estado: "invalida", transitoria: true }, 0, inicio, inicio)).toBeNull();
  });
  it("M3: no teto (6 tentativas ou 7 dias) a reserva não acontece, nada é baixado e a pendência vira manual", async () => {
    const pg = await preparar();
    try {
      const original = contratoBase(); const origemId = await gerado(pg, original);
      simulado.rede = rede(pki, { fora: [URLS.interCert] });
      const doc = await admin().uploadDocument({ contractId: 1, name: "x.pdf", type: "assinatura_digital", base64: b64(await assinar(original, "empresa")), documentoOrigemId: origemId });
      await pg.query("UPDATE portal_contract_document_validacoes SET tentativas = 6, proxima_tentativa = now() - interval '1 minute' WHERE document_id = $1", [doc.id]);
      simulado.rede = rede(pki);
      const r = await revalidarDocumento(doc.id);
      expect(r).toMatchObject({ estado: "pendente", transitoria: false, proximaTentativa: null, tentativas: 6 });
      expect(r?.motivo).toMatch(/Prazo das novas tentativas esgotado/);
      expect(simulado.rede.chamadas).toEqual([]);
      await pg.query("UPDATE portal_contract_document_validacoes SET tentativas = 1, primeira_em = now() - interval '8 days', proxima_tentativa = now() - interval '1 minute' WHERE document_id = $1", [doc.id]);
      expect(await revalidarDocumento(doc.id)).toMatchObject({ estado: "pendente", proximaTentativa: null });
      expect(simulado.rede.chamadas).toEqual([]);
    } finally { await pg.close(); }
  }, 60_000);
  it("rodada do cron respeita o prazo e nunca lança", async () => {
    const pg = await preparar();
    try {
      expect(await revalidarPendentes(1_000)).toEqual({ conferidos: 0 });
      expect(await revalidarPendentes(10_000)).toEqual({ conferidos: 0 });
    } finally { await pg.close(); }
  });
});

describe("retorno pelo portal", () => {
  async function empresaAssinou(pg: PGlite) {
    const original = contratoBase(); const origemId = await gerado(pg, original);
    const empresa = await assinar(original, "empresa");
    await admin().uploadDocument({ contractId: 1, name: "x.pdf", type: "assinatura_digital", base64: b64(empresa), documentoOrigemId: origemId });
    await pg.exec("UPDATE portal_contracts SET signature_status='solicitado'");
    return empresa;
  }
  it("conclui sozinho só com identidades conferidas e revisão da empresa conservada", async () => {
    const pg = await preparar();
    try {
      const empresa = await empresaAssinou(pg);
      const r = await cliente().uploadSignedContract({ contractId: 1, fileName: "r.pdf", mimeType: "application/pdf", base64: b64(await assinar(empresa, "cliente")) });
      expect(r.todos).toBe(true);
      expect((await pg.query("SELECT signature_status FROM portal_contracts")).rows[0]).toEqual({ signature_status: "assinado" });
      const doc = (await pg.query<{ id: number; type: string }>("SELECT id, type FROM portal_contract_documents WHERE type='assinado'")).rows[0];
      expect(await linhaValidacao(pg, doc.id)).toMatchObject({ estado: "valida", origem: "retorno_portal" });
    } finally { await pg.close(); }
  }, 60_000);
  it("conclusão inicial não usa a revisão antiga se outra assinatura da empresa foi salva durante a conferência", async () => {
    const pg = await preparar();
    try {
      const empresa = await empresaAssinou(pg);
      const retorno = await assinar(empresa, "cliente");
      const db = banco.getDb();
      const batch = db.batch.bind(db);
      vi.spyOn(db, "batch").mockImplementationOnce(async ops => {
        await pg.exec("INSERT INTO portal_contract_documents (contract_id,name,type) VALUES (1,'nova-revisao.pdf','assinatura_digital')");
        return batch(ops);
      });
      const r = await cliente().uploadSignedContract({ contractId: 1, fileName: "r.pdf", mimeType: "application/pdf", base64: b64(retorno) });
      expect(r.todos).toBe(false);
      expect((await pg.query("SELECT type FROM portal_contract_documents WHERE type='recebido_assinado'")).rows).toEqual([{ type: "recebido_assinado" }]);
      expect((await pg.query("SELECT signature_status FROM portal_contracts")).rows[0]).toEqual({ signature_status: "em_conferencia" });
    } finally { await pg.close(); }
  }, 60_000);
  it("anotação opaca por cima (P1 da PR #297) continua em conferência, mesmo com assinaturas válidas", async () => {
    const pg = await preparar();
    try {
      const empresa = await empresaAssinou(pg);
      const pdf = await PDF.load(new Uint8Array(empresa));
      pdf.getPage(0)!.addSquareAnnotation({ rect: { x: 0, y: 0, width: 500, height: 700 }, color: rgb(1, 1, 1), fillColor: rgb(1, 1, 1) });
      const sobreposto = Buffer.from((await pdf.sign({ signer: signers.cliente })).bytes);
      const r = await cliente().uploadSignedContract({ contractId: 1, fileName: "r.pdf", mimeType: "application/pdf", base64: b64(sobreposto) });
      expect(r.todos).toBe(false);
      expect((await pg.query("SELECT signature_status FROM portal_contracts")).rows[0]).toEqual({ signature_status: "em_conferencia" });
    } finally { await pg.close(); }
  }, 60_000);
  it("pendente por rede no envio → a retentativa conclui quando a conferência passa", async () => {
    const pg = await preparar();
    try {
      const empresa = await empresaAssinou(pg);
      const retorno = await assinar(empresa, "cliente");
      limparCacheLcr();
      simulado.rede = rede(pki, { fora: [URLS.interCrl] });
      const r = await cliente().uploadSignedContract({ contractId: 1, fileName: "r.pdf", mimeType: "application/pdf", base64: b64(retorno) });
      expect(r.todos).toBe(false);
      expect(r.message).toMatch(/pendente e será repetida/);
      const doc = (await pg.query<{ id: number }>("SELECT id FROM portal_contract_documents WHERE type='recebido_assinado'")).rows[0];
      expect(await linhaValidacao(pg, doc.id)).toMatchObject({ estado: "pendente", origem: "retorno_portal" });
      simulado.rede = rede(pki);
      expect(await revalidarDocumento(doc.id, { agora: new Date(Date.now() + 11 * 60_000) })).toMatchObject({ estado: "valida", conservaEmpresa: true });
      expect((await pg.query("SELECT type FROM portal_contract_documents WHERE id=$1", [doc.id])).rows[0]).toEqual({ type: "assinado" });
      expect((await pg.query("SELECT signature_status FROM portal_contracts")).rows[0]).toEqual({ signature_status: "assinado" });
    } finally { await pg.close(); }
  }, 60_000);
  it("A2: se a assinatura da empresa não foi conferida como válida, o retorno nunca conclui sozinho", async () => {
    const pg = await preparar();
    try {
      const original = contratoBase(); const origemId = await gerado(pg, original);
      simulado.rede = rede(pki, { fora: [URLS.interCert, URLS.interCrl] });
      const empresa = await assinar(original, "empresa");
      await admin().uploadDocument({ contractId: 1, name: "x.pdf", type: "assinatura_digital", base64: b64(empresa), documentoOrigemId: origemId }); // fica pendente
      await pg.exec("UPDATE portal_contracts SET signature_status='solicitado'");
      simulado.rede = rede(pki);
      const r = await cliente().uploadSignedContract({ contractId: 1, fileName: "r.pdf", mimeType: "application/pdf", base64: b64(await assinar(empresa, "cliente")) });
      expect(r.todos).toBe(false);
      expect((await pg.query("SELECT signature_status FROM portal_contracts")).rows[0]).toEqual({ signature_status: "em_conferencia" });
    } finally { await pg.close(); }
  }, 60_000);
  it("M2: a retentativa não conclui se a empresa assinou de novo (outra base) ou se o contrato saiu de 'em conferência'", async () => {
    const pg = await preparar();
    try {
      const empresa = await empresaAssinou(pg);
      const retorno = await assinar(empresa, "cliente");
      limparCacheLcr();
      simulado.rede = rede(pki, { fora: [URLS.interCrl] });
      await cliente().uploadSignedContract({ contractId: 1, fileName: "r.pdf", mimeType: "application/pdf", base64: b64(retorno) });
      const doc = (await pg.query<{ id: number }>("SELECT id FROM portal_contract_documents WHERE type='recebido_assinado'")).rows[0];
      simulado.rede = rede(pki);
      // A empresa assina outra vez: a base usada no envio deixa de ser a última.
      const origemId = (await pg.query<{ id: number }>("SELECT id FROM portal_contract_documents WHERE type='contrato_gerado'")).rows[0].id;
      const original = Buffer.from((await pg.query<{ data: Uint8Array }>("SELECT data FROM portal_contract_file_data WHERE document_id=$1", [origemId])).rows[0].data);
      await admin().uploadDocument({ contractId: 1, name: "x.pdf", type: "assinatura_digital", base64: b64(await assinar(original, "empresa")), documentoOrigemId: origemId });
      await pg.exec("UPDATE portal_contracts SET signature_status='em_conferencia'");
      const r = await revalidarDocumento(doc.id, { agora: new Date(Date.now() + 11 * 60_000) });
      expect(r?.estado).toBe("valida");
      expect((await pg.query("SELECT type FROM portal_contract_documents WHERE id=$1", [doc.id])).rows[0]).toEqual({ type: "recebido_assinado" });
      expect((await pg.query("SELECT signature_status FROM portal_contracts")).rows[0]).toEqual({ signature_status: "em_conferencia" });
    } finally { await pg.close(); }
  }, 60_000);
  it("M2: contrato já concluído/alterado por outra via não é sobrescrito pela retentativa", async () => {
    const pg = await preparar();
    try {
      const empresa = await empresaAssinou(pg);
      limparCacheLcr();
      simulado.rede = rede(pki, { fora: [URLS.interCrl] });
      await cliente().uploadSignedContract({ contractId: 1, fileName: "r.pdf", mimeType: "application/pdf", base64: b64(await assinar(empresa, "cliente")) });
      const doc = (await pg.query<{ id: number }>("SELECT id FROM portal_contract_documents WHERE type='recebido_assinado'")).rows[0];
      await pg.exec("UPDATE portal_contracts SET signature_status='solicitado'"); // mudou de estado no meio do caminho
      simulado.rede = rede(pki);
      await revalidarDocumento(doc.id, { agora: new Date(Date.now() + 11 * 60_000) });
      expect((await pg.query("SELECT type FROM portal_contract_documents WHERE id=$1", [doc.id])).rows[0]).toEqual({ type: "recebido_assinado" });
      expect((await pg.query("SELECT signature_status FROM portal_contracts")).rows[0]).toEqual({ signature_status: "solicitado" });
    } finally { await pg.close(); }
  }, 60_000);
  it("B1: envios pelo portal têm limite por cliente", async () => {
    const pg = await preparar();
    try {
      await pg.exec("UPDATE portal_contracts SET signature_status='solicitado'");
      for (let i = 0; i < 6; i++) await cliente().uploadSignedContract({ contractId: 1, fileName: "r.pdf", mimeType: "application/pdf", base64: b64(Buffer.from("%PDF-1.7 SEM ASSINATURA")) });
      await expect(cliente().uploadSignedContract({ contractId: 1, fileName: "r.pdf", mimeType: "application/pdf", base64: b64(Buffer.from("%PDF-1.7 SEM ASSINATURA")) })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    } finally { await pg.close(); }
  }, 60_000);
  it("retorno anexado pelo admin nunca conclui sozinho (continua exigindo a confirmação)", async () => {
    const pg = await preparar();
    try {
      const empresa = await empresaAssinou(pg);
      const r = await admin().uploadDocument({ contractId: 1, name: "r.pdf", type: "assinado", base64: b64(await assinar(empresa, "cliente")) });
      expect(r.todos).toBe(false);
      expect((await pg.query("SELECT signature_status FROM portal_contracts")).rows[0]).toEqual({ signature_status: "em_conferencia" });
      expect(await linhaValidacao(pg, r.id)).toMatchObject({ estado: "valida", origem: "retorno_admin" });
    } finally { await pg.close(); }
  }, 60_000);
});

describe("montagem da cadeia antes de assinar (só certificado público)", () => {
  it("devolve os intermediários pelo AIA", async () => {
    const r = await montarCadeiaPublica(1, b64(pki.der.empresa), []);
    expect(r).toMatchObject({ estado: "valida", intermediarios: [b64(pki.der.inter)] });
  });
  it("recusa PFX, bytes extras ou texto qualquer, e limita as chamadas por usuário", async () => {
    await expect(montarCadeiaPublica(1, b64(Buffer.from(pki.pfx("empresa"))), [])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(montarCadeiaPublica(1, b64(Buffer.concat([pki.der.empresa, Buffer.from([0])])), [])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(montarCadeiaPublica(1, "não é base64!", [])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (let i = 0; i < 12; i++) await montarCadeiaPublica(2, b64(pki.der.empresa), [b64(pki.der.inter)]);
    await expect(montarCadeiaPublica(2, b64(pki.der.empresa), [])).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  }, 60_000);
});
