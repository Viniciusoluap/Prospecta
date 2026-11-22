import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as banco from "./db";
import { confirmarTodasAssinaturas } from "./juridico-workflow";
import * as email from "./_core/email-smtp";
import { gerarESalvarContratoPdf } from "./juridico-pdf";
import { portalRouter } from "./portal-router";
import { juridicoRouter } from "./juridico-router";

afterEach(() => vi.restoreAllMocks());
export async function preparar() {
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
export const caller = (role = "admin") => juridicoRouter.createCaller({ user:{ id:1, role, active:true }, req:{}, res:{} } as never);
describe("geração salva o contrato no mesmo clique", () => {
  it("salva PDF privado, reutiliza na repetição e mantém anexos/status", async () => {
    const pg = await preparar();
    try {
      await pg.exec("INSERT INTO portal_contract_documents (contract_id,name,type) VALUES (1,'outro.pdf','anexo')");
      const doc = await caller().generatePdf({ id:1 });
      expect(doc).toMatchObject({ contractId:1, name:"Contrato - Cliente - Contrato gerado.pdf", type:"contrato_gerado", url:null });
      const bytes = (await pg.query<{ data:Uint8Array }>("SELECT data FROM portal_contract_file_data WHERE document_id=$1",[doc.id])).rows[0].data;
      expect(Buffer.from(bytes).subarray(0,4).toString()).toBe("%PDF");
      expect((await gerarESalvarContratoPdf(1)).id).toBe(doc.id);
      await pg.query("UPDATE portal_contract_documents SET name='TESTE-1.pdf' WHERE id=$1",[doc.id]);
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
      // Desde o portão de QA de 22/11 (A2), a assinatura da empresa sempre informa o documento de origem.
      await pg.exec("INSERT INTO portal_contract_documents (id,contract_id,name,type) VALUES (900,1,'gerado.pdf','contrato_gerado')");
      const result = await caller().uploadDocument({ contractId:1,name:"teste-assinado.pdf",type:"assinatura_digital",documentoOrigemId:900,base64:Buffer.from("%PDF-1.7 teste").toString("base64") });
      expect(result.type).toBe("assinatura_digital");
      expect((await pg.query("SELECT signature_status FROM portal_contracts")).rows[0]).toEqual({ signature_status:"parcial" });
    } finally { await pg.close(); }
  },30_000);
  it("o retorno externo aguarda confirmação e apenas admin pode concluir",async()=>{
    const pg=await preparar();try{
      const r=await caller().uploadDocument({contractId:1,name:"retorno.pdf",type:"assinado",base64:Buffer.from("%PDF-1.7 TESTE").toString("base64")});
      expect((await pg.query("SELECT signature_status FROM portal_contracts")).rows[0]).toEqual({signature_status:"em_conferencia"});
      expect((await pg.query("SELECT type FROM portal_contract_documents WHERE id=$1",[r.id])).rows[0]).toEqual({type:"recebido_assinado"});
      await expect(caller("corretor").confirmarAssinaturas({documentId:r.id,confirmado:true})).rejects.toMatchObject({code:"FORBIDDEN"});
      await caller().confirmarAssinaturas({documentId:r.id,confirmado:true});
      expect((await pg.query("SELECT signature_status FROM portal_contracts")).rows[0]).toEqual({signature_status:"assinado"});
    }finally{await pg.close();}
  },30000);
  it("upload pelo portal é aceito para modelos novos e não inventa assinaturas",async()=>{
    const pg=await preparar();try{
      await pg.exec("UPDATE portal_contracts SET lead_id=20,signature_status='solicitado'");
      const client=portalRouter.createCaller({user:{id:9,role:"cliente",leadId:20},req:{},res:{}} as never);
      const r=await client.uploadSignedContract({contractId:1,fileName:"retorno.pdf",mimeType:"application/pdf",base64:Buffer.from("%PDF-1.7 SEM ASSINATURA").toString("base64")});
      expect(r.todos).toBe(false);expect(r.message).toContain("conferir");
      const outro=portalRouter.createCaller({user:{id:10,role:"cliente",leadId:21},req:{},res:{}} as never);
      await expect(outro.uploadSignedContract({contractId:1,fileName:"retorno.pdf",mimeType:"application/pdf",base64:Buffer.from("%PDF-1.7 OUTRO").toString("base64")})).rejects.toMatchObject({code:"NOT_FOUND"});
    }finally{await pg.close();}
  },30000);

  it("envio usa e-mail cadastrado, PDF certo e deixa o cliente aguardando assinatura",async()=>{
    const pg=await preparar();try{
      await pg.exec("CREATE TABLE leads(id integer primary key,email text);INSERT INTO leads VALUES(20,'cliente@example.test');UPDATE portal_contracts SET lead_id=20,party_b='Cliente Teste'");
      await pg.exec("INSERT INTO portal_contract_documents (id,contract_id,name,type) VALUES (900,1,'gerado.pdf','contrato_gerado')");
      await caller().uploadDocument({contractId:1,name:"empresa.pdf",type:"assinatura_digital",documentoOrigemId:900,base64:Buffer.from("%PDF-1.7 EMPRESA TESTE").toString("base64")});
      const mail=vi.spyOn(email,"sendEmail").mockResolvedValue(true);
      await caller().enviarParaAssinatura({id:1,email:true});
      expect(mail).toHaveBeenCalledWith(expect.objectContaining({to:"cliente@example.test",attachments:[expect.objectContaining({filename:"Contrato - Cliente Teste - Assinado pela empresa.pdf"})]}));
      expect((await pg.query("SELECT signature_status FROM portal_contracts")).rows[0]).toEqual({signature_status:"solicitado"});
      mail.mockResolvedValue(false);
      await expect(caller().enviarParaAssinatura({id:1,email:true})).rejects.toMatchObject({code:"INTERNAL_SERVER_ERROR"});
    }finally{await pg.close();}
  },30000);

  it("vínculo de arquivo por URL também não pode declarar todas as partes assinadas",async()=>{
    const pg=await preparar();try{
      const doc=await caller().addDocument({contractId:1,name:"retorno.pdf",url:"https://example.test/retorno.pdf",type:"assinado"});
      expect(doc.type).toBe("recebido_assinado");
      await expect(confirmarTodasAssinaturas(doc.id,"colaborador")).rejects.toMatchObject({code:"FORBIDDEN"});
      expect((await pg.query("SELECT signature_status FROM portal_contracts")).rows[0]).toEqual({signature_status:"pendente"});
    }finally{await pg.close();}
  },30000);

});
