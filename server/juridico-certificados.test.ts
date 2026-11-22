import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsPDF } from "jspdf";
import { abrirCertificado, assinarPdf, conferirValidade, definirCertificadoPadrao, importarCertificado, listarCertificados, removerCertificado } from "../client/src/lib/certificados-digitais";

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
    await removerCertificado(10,cert.id); expect(await listarCertificados(10)).toEqual([]);
  });
  it("gera CMS verificado por OpenSSL e preserva assinatura anterior em nova revisão", async () => {
    const cert = await importarCertificado(12, file, "teste-somente");
    const pdf = new jsPDF(); pdf.text("DOCUMENTO SINTETICO DE TESTE",20,20);
    const original = new Uint8Array(pdf.output("arraybuffer"));
    await expect(assinarPdf(original,cert,"errada")).rejects.toThrow("Senha");
    const primeira = await assinarPdf(original,cert,"teste-somente");
    expect(verificarAssinaturas(primeira.bytes)).toBe(1);
    const segunda = await assinarPdf(primeira.bytes,cert,"teste-somente");
    expect(verificarAssinaturas(segunda.bytes)).toBe(2);
    expect(Buffer.from(segunda.bytes.subarray(0,primeira.bytes.length)).equals(Buffer.from(primeira.bytes))).toBe(true);
    const alterado = primeira.bytes.slice(); alterado[20] ^= 1;
    expect(() => verificarAssinaturas(alterado)).toThrow();
    expect(new TextDecoder().decode(original)).not.toContain("/ByteRange");
  },30_000);
});
