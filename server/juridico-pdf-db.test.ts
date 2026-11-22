import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as banco from "./db";
import { gerarESalvarContratoPdf } from "./juridico-pdf";
import { juridicoRouter } from "./juridico-router";

afterEach(() => vi.restoreAllMocks());
async function preparar() {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE portal_contracts (id serial primary key, lead_id integer, number text, type text, status text default 'ativo', party_a text, party_a_document text, party_b text, party_b_document text, property_id integer, value numeric, due_at timestamp, signature_date date, project_id integer, contractor_id integer, broker_id integer, signers jsonb, description text, clauses text, signature_status text default 'pendente', signature_gov_id text, signed_document_url text, created_at timestamp default now(), updated_at timestamp default now());
    CREATE TABLE portal_contract_documents (id serial primary key, contract_id integer references portal_contracts(id) on delete cascade, name text, type text, url text, drive_file_id text, created_at timestamp default now());
    CREATE TABLE portal_contract_file_data (document_id integer primary key references portal_contract_documents(id) on delete cascade, mime text, size_bytes integer check(size_bytes>0), data bytea);
    INSERT INTO portal_contracts (id, number, type, signature_date, signers, clauses) VALUES (1,'TESTE-1','construcao_atc','2026-11-21','["EMPRESA TESTE","CLIENTE TESTE"]','CLÁUSULA TESTE');`);
  const real = drizzle(pg);
  const fake = { select:real.select.bind(real), insert:real.insert.bind(real), execute:real.execute.bind(real), update:real.update.bind(real), batch: async (ops: { execute(): Promise<unknown> }[]) => {
    await pg.exec("BEGIN"); try { const out=[]; for(const op of ops) out.push(await op.execute()); await pg.exec("COMMIT"); return out; }
    catch(e) { await pg.exec("ROLLBACK"); throw e; }
  } };
  vi.spyOn(banco,"getDb").mockReturnValue(fake as never);
  return pg;
}
const caller = (role = "admin") => juridicoRouter.createCaller({ user:{ id:1, role, active:true }, req:{}, res:{} } as never);
describe("geração salva o contrato no mesmo clique", () => {
  it("salva PDF privado, reutiliza na repetição e mantém anexos/status", async () => {
    const pg = await preparar();
    try {
      await pg.exec("INSERT INTO portal_contract_documents (contract_id,name,type) VALUES (1,'outro.pdf','anexo')");
      const doc = await caller().generatePdf({ id:1 });
      expect(doc).toMatchObject({ contractId:1, name:"TESTE-1.pdf", type:"contrato_gerado", url:null });
      const bytes = (await pg.query<{ data:Uint8Array }>("SELECT data FROM portal_contract_file_data WHERE document_id=$1",[doc.id])).rows[0].data;
      expect(Buffer.from(bytes).subarray(0,4).toString()).toBe("%PDF");
      expect((await gerarESalvarContratoPdf(1)).id).toBe(doc.id);
      await pg.query("UPDATE portal_contract_documents SET url='https://exemplo.invalid/legado' WHERE id=$1",[doc.id]);
      // Uma URL antiga não esconde a cópia privada, nem é acessada pelo servidor.
      const content = await caller().documentContent({ id:doc.id });
      expect(Buffer.from(content.base64,"base64").equals(Buffer.from(bytes))).toBe(true);
      expect((await pg.query("SELECT * FROM portal_contract_documents")).rows).toHaveLength(2);
      expect((await pg.query("SELECT signature_status FROM portal_contracts")).rows[0]).toEqual({ signature_status:"pendente" });
    } finally { await pg.close(); }
  },30_000);
  it("falha de armazenamento desfaz o documento e não deixa anexo vazio", async () => {
    const pg = await preparar();
    try {
      await pg.exec("ALTER TABLE portal_contract_file_data ADD CONSTRAINT teste_falha CHECK (size_bytes=0)");
      await expect(gerarESalvarContratoPdf(1)).rejects.toThrow();
      expect((await pg.query("SELECT * FROM portal_contract_documents")).rows).toEqual([]);
    } finally { await pg.close(); }
  },30_000);
  it("não gera modelo ausente e recusa usuário sem acesso administrativo", async () => {
    const pg = await preparar();
    try {
      await expect(gerarESalvarContratoPdf(99)).rejects.toMatchObject({ code:"NOT_FOUND" });
      await expect(caller("corretor").generatePdf({ id:1 })).rejects.toMatchObject({ code:"FORBIDDEN" });
      expect((await pg.query("SELECT * FROM portal_contract_documents")).rows).toEqual([]);
    } finally { await pg.close(); }
  },30_000);
  it("assinatura digital de uma parte não altera a conclusão de todas as partes", async () => {
    const pg = await preparar();
    try {
      const result = await caller().uploadDocument({ contractId:1,name:"teste-assinado.pdf",type:"assinatura_digital",base64:Buffer.from("%PDF-1.7 teste").toString("base64") });
      expect(result.type).toBe("assinatura_digital");
      expect((await pg.query("SELECT signature_status FROM portal_contracts")).rows[0]).toEqual({ signature_status:"pendente" });
    } finally { await pg.close(); }
  },30_000);
});
