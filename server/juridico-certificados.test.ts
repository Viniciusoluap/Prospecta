import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsPDF } from "jspdf";
import { abrirCertificado, assinarPdf, conferirValidade, definirCertificadoPadrao, importarCertificado, listarCertificados, removerCertificado, recuperarSenha, esquecerSenha, guardarSenha } from "../client/src/lib/certificados-digitais";

const dir = mkdtempSync(join(tmpdir(), "prospecta-certificado-teste-"));
let file: File;
beforeAll(() => {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", join(dir,"key.pem"), "-out", join(dir,"cert.pem"), "-days", "7", "-nodes", "-subj", "/C=BR/O=TESTE SEM VALIDADE/CN=EMPRESA TESTE:12345678000190"], { stdio:"ignore" });
  execFileSync("openssl", ["pkcs12", "-export", "-inkey", join(dir,"key.pem"), "-in", join(dir,"cert.pem"), "-out", join(dir,"cert.pfx"), "-passout", "pass:teste-somente"]);
  file = new File([readFileSync(join(dir,"cert.pfx"))], "teste.pfx");
});
afterAll(() => rmSync(dir, { recursive:true, force:true }));
function verificarAssinaturas(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes), text = buffer.toString("latin1");
  const ranges = [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
  for (const [index, range] of ranges.entries()) {
    const [a,b,c,d] = range.slice(1).map(Number);
    const signature = Buffer.from(text.slice(a+b+1,c-1), "hex");
    writeFileSync(join(dir,`cms-${index}.der`), signature);
    writeFileSync(join(dir,`data-${index}.bin`), Buffer.concat([buffer.subarray(a,a+b),buffer.subarray(c,c+d)]));
    execFileSync("openssl", ["cms", "-verify", "-inform", "DER", "-in", join(dir,`cms-${index}.der`), "-content", join(dir,`data-${index}.bin`), "-binary", "-noverify", "-out", join(dir,"verified.bin")], { stdio:"ignore" });
  }
  return ranges.length;
}
describe("certificados A1 e assinatura real", () => {
  it("extrai titular, documento, emissor e validade do PFX", async () => {
    const { info } = await abrirCertificado(new Uint8Array(await file.arrayBuffer()), "teste-somente");
    expect(info).toMatchObject({ titular:"EMPRESA TESTE:12345678000190", documento:"12345678000190" });
    expect(info.emissor).toContain("EMPRESA TESTE"); expect(info.fingerprint).toHaveLength(64);
    expect(new Date(info.vencimento).getTime()).toBeGreaterThan(Date.now());
  });
  it("também abre certificado legado RC2/3DES usado em A1 antigos", async () => {
    execFileSync("openssl", ["pkcs12","-export","-legacy","-inkey",join(dir,"key.pem"),"-in",join(dir,"cert.pem"),"-out",join(dir,"legado.pfx"),"-passout","pass:teste-somente"]);
    const { info } = await abrirCertificado(new Uint8Array(readFileSync(join(dir,"legado.pfx"))),"teste-somente");
    expect(info.titular).toBe("EMPRESA TESTE:12345678000190");
  });
  it("a conferência não aceita CPF/CNPJ apenas alegado em certificado não confiável", async()=>{
    const {conferirAssinaturas}=await import("./juridico-verificar-assinaturas");
    const cert=await importarCertificado(99,file,"teste-somente");const pdf=new jsPDF();pdf.text("TESTE",20,20);
    const signed=await assinarPdf(new Uint8Array(pdf.output("arraybuffer")),cert,"teste-somente");
    const result=await conferirAssinaturas(Buffer.from(signed.bytes),{partyADocument:"12345678000190",partyBDocument:"12345678901",signers:[]});
    expect(result.todos).toBe(false);
  });
  it("reconhece todas as partes somente com assinaturas íntegras e raízes confiáveis",async()=>{
    const {conferirAssinaturas}=await import("./juridico-verificar-assinaturas");const {Certificate}=await import("pkijs");const {PDF,rgb}=await import("@libpdf/core");
    execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-keyout",join(dir,"cliente-key.pem"),"-out",join(dir,"cliente.pem"),"-days","7","-nodes","-subj","/C=BR/O=TESTE SEM VALIDADE/CN=CLIENTE TESTE:12345678901"],{stdio:"ignore"});
    execFileSync("openssl",["pkcs12","-export","-inkey",join(dir,"cliente-key.pem"),"-in",join(dir,"cliente.pem"),"-out",join(dir,"cliente.pfx"),"-passout","pass:teste-somente"]);
    const a=await abrirCertificado(new Uint8Array(await file.arrayBuffer()),"teste-somente");
    const b=await abrirCertificado(new Uint8Array(readFileSync(join(dir,"cliente.pfx"))),"teste-somente");
    const base=new jsPDF();base.text("CONTRATO TESTE",20,20);const pdf=await PDF.load(new Uint8Array(base.output("arraybuffer")));
    const primeira=await pdf.sign({signer:a.signer});const final=await pdf.sign({signer:b.signer});
    const {mesmoConteudo}=await import("./juridico-workflow");
    expect(await mesmoConteudo(Buffer.from(primeira.bytes),Buffer.from(final.bytes))).toBe(true);
    const mudado=await PDF.load(primeira.bytes);mudado.getPage(0)!.drawText("TEXTO ALTERADO",{x:20,y:400});const alterado=await mudado.sign({signer:b.signer});
    expect(await mesmoConteudo(Buffer.from(primeira.bytes),Buffer.from(alterado.bytes))).toBe(false);
    const sobreposto=await PDF.load(primeira.bytes);
    sobreposto.getPage(0)!.addSquareAnnotation({rect:{x:0,y:0,width:500,height:700},color:rgb(1,1,1),fillColor:rgb(1,1,1)});
    const opaco=await sobreposto.sign({signer:b.signer});
    expect(await mesmoConteudo(Buffer.from(primeira.bytes),Buffer.from(opaco.bytes))).toBe(false);
    const roots=[a,b].map(c=>Certificate.fromBER(Uint8Array.from(c.signer.certificate).buffer));
    const partes={partyADocument:"12345678000190",partyBDocument:"12345678901",signers:[]};
    const r=await conferirAssinaturas(Buffer.from(final.bytes),partes,roots);expect(r).toMatchObject({todos:true,validas:2});
    expect((await conferirAssinaturas(Buffer.from(final.bytes),{...partes,signers:["1ª TESTEMUNHA — CPF"]},roots)).todos).toBe(false);
    expect((await conferirAssinaturas(Buffer.from(final.bytes),{...partes,signers:["CORRETOR INTERVENIENTE — OUTRO SIGNATÁRIO"]},roots)).todos).toBe(false);
    const tampered=final.bytes.slice();tampered[20]^=1;expect((await conferirAssinaturas(Buffer.from(tampered),partes,roots)).todos).toBe(false);
  });
  it("recusa senha errada, extensão inválida e datas inválidas", async () => {
    await expect(abrirCertificado(new Uint8Array(await file.arrayBuffer()), "errada")).rejects.toThrow("Confira");
    await expect(importarCertificado(5, new File(["pdf"],"teste.pdf"), "teste")).rejects.toThrow(".pfx");
    expect(() => conferirValidade({ inicio:"2020-01-01", vencimento:"2021-01-01" })).toThrow("vencido");
    expect(() => conferirValidade({ inicio:"2099-01-01", vencimento:"2100-01-01" })).toThrow("ainda");
  });
  it("guarda criptografado, separa contas e preserva o padrão ao reimportar", async () => {
    const cert = await importarCertificado(10, file, "teste-somente");
    expect(cert.padrao).toBe(true); expect(Object.keys(cert)).not.toContain("senha");
    expect(Buffer.from(cert.protegido).equals(readFileSync(join(dir,"cert.pfx")))).toBe(false);
    expect(await listarCertificados(11)).toEqual([]);
    await importarCertificado(10,file,"teste-somente");expect(await listarCertificados(10)).toHaveLength(1);
    await definirCertificadoPadrao(10,cert.id); expect((await listarCertificados(10))[0].padrao).toBe(true);
    await removerCertificado(11,cert.id); expect(await listarCertificados(10)).toHaveLength(1);
    const remembered=(await listarCertificados(10))[0];expect(await recuperarSenha(remembered)).toBe("teste-somente");
    expect(await recuperarSenha({...remembered,owner:11})).toBeNull();
    await esquecerSenha(remembered);expect(await recuperarSenha((await listarCertificados(10))[0])).toBeNull();
    await guardarSenha(remembered,"teste-somente");
    await removerCertificado(10,cert.id); expect(await listarCertificados(10)).toEqual([]);
  });
  it("gera CMS verificado por OpenSSL e preserva assinatura anterior em nova revisão", async () => {
    const cert = await importarCertificado(12, file, "teste-somente");
    const pdf = new jsPDF(); pdf.text("DOCUMENTO SINTETICO DE TESTE",20,20);
    const original = new Uint8Array(pdf.output("arraybuffer"));
    await expect(assinarPdf(original,cert,"errada")).rejects.toThrow("Senha");
    const primeira = await assinarPdf(original,cert,"teste-somente",{pagina:0,x:50,y:90,largura:300,altura:70});
    const {PDF,rgb}=await import("@libpdf/core");const loaded=await PDF.load(primeira.bytes);
    expect(loaded.getPage(0)!.extractText().text).toContain("ASSINADO DIGITALMENTE");
    expect(loaded.getPage(0)!.extractText().text).toContain("EMPRESA TESTE");
    await expect(assinarPdf(original,cert,"teste-somente",{pagina:0,x:-10,y:90,largura:300,altura:70})).rejects.toThrow("dentro");
    expect(verificarAssinaturas(primeira.bytes)).toBe(1);
    const segunda = await assinarPdf(primeira.bytes,cert,"teste-somente",{pagina:0,x:50,y:220,largura:300,altura:70});
    expect(verificarAssinaturas(segunda.bytes)).toBe(2);
    expect(Buffer.from(segunda.bytes.subarray(0,primeira.bytes.length)).equals(Buffer.from(primeira.bytes))).toBe(true);
    const alterado = primeira.bytes.slice(); alterado[20] ^= 1;
    expect(() => verificarAssinaturas(alterado)).toThrow();
    expect(new TextDecoder().decode(original)).not.toContain("/ByteRange");
  },30_000);
});
