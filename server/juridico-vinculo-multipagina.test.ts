// Jurídico — vínculo com o documento de origem em contrato de VÁRIAS páginas (23/11/2026).
// Defeito de produção: o jsPDF usa um dicionário de recursos comum a todas as páginas; ao desenhar a marca da assinatura,
// todas "ganhavam" a fonte da marca e a conferência dizia "o PDF assinado não corresponde ao documento de origem".
import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDF, P12Signer } from "@libpdf/core";
import { criarPki, type Pki } from "./__fixtures__/juridico-pki-ca";
import { gerarPdfModelo } from "../shared/contratos/pdf";
import { mesmoConteudo } from "./juridico-workflow";
import { assinarPdf, importarCertificado } from "../client/src/lib/certificados-digitais";

let pki: Pki; let signer: P12Signer;
beforeAll(async () => { pki = criarPki(); signer = await P12Signer.create(pki.pfx("empresa"), "teste-somente", { buildChain: false }); }, 120_000);
afterAll(() => pki?.limpar());

const contrato = (clausulas: number) => Buffer.from(gerarPdfModelo({ numero: "CT-1", titulo: "CONSTRUÇÃO ATC", data: new Date("2026-11-23"),
  clausulas: Array.from({ length: clausulas }, (_, i) => `CLÁUSULA ${i + 1}\n` + "Texto da cláusula com acentuação e valor de R$ 215.000,00. ".repeat(12)).join("\n"),
  assinaturas: ["PROSPECTA", "Cliente de Teste"] }).output("arraybuffer"));
const paginas = async (b: Buffer) => (await PDF.load(new Uint8Array(b))).getPages().length;
async function assinarComMarca(original: Buffer, pagina: number) {
  const salvo = await importarCertificado(31, new File([pki.pfx("empresa")], "e.pfx"), "teste-somente");
  const { bytes, info } = await assinarPdf(new Uint8Array(original), salvo, "teste-somente", { pagina, x: 60, y: 80, largura: 300, altura: 84 });
  return { assinado: Buffer.from(bytes), titular: info.titular };
}

describe("vínculo com a origem — contrato de várias páginas", () => {
  it("marca na primeira, numa do meio ou na última página: vínculo conferido", async () => {
    const original = contrato(30); const n = await paginas(original);
    expect(n).toBeGreaterThan(3);
    for (const p of [0, 2, n - 1]) {
      const { assinado, titular } = await assinarComMarca(original, p);
      expect(assinado.subarray(0, original.length).equals(original)).toBe(true);
      expect(await mesmoConteudo(original, assinado, { titular })).toBe(true);
    }
  }, 120_000);

  it("texto acrescentado em OUTRA página além da marca continua recusado", async () => {
    const original = contrato(30); const n = await paginas(original);
    const salvo = await importarCertificado(31, new File([pki.pfx("empresa")], "e.pfx"), "teste-somente");
    void salvo;
    // Marca legítima na última página + texto estranho na segunda: assina por fora, com a mesma chave.
    const { assinado: comMarca, titular } = await assinarComMarca(original, n - 1);
    expect(await mesmoConteudo(original, comMarca, { titular })).toBe(true);
    const pdf = await PDF.load(new Uint8Array(original));
    pdf.getPage(1)!.drawText("VALOR ALTERADO 999", { x: 20, y: 700, size: 12 });
    const adulterado = Buffer.from((await pdf.sign({ signer })).bytes);
    expect(await mesmoConteudo(original, adulterado, { titular })).toBe(false);
  }, 120_000);

  it("sem a marca (retorno do cliente), página que ganhou fonte não é aceita por esta regra", async () => {
    const original = contrato(30);
    const { assinado } = await assinarComMarca(original, 0);
    expect(await mesmoConteudo(original, assinado)).toBe(false);
  }, 120_000);

  // Portão de QA de 23/11/2026: "referência adormecida" — a origem cita uma fonte que só passa a existir depois de assinar
  // (o assinador sempre a chama de /F0), então um texto invisível na origem apareceria no PDF assinado.
  const comTextoEscondido = (operadores: string, pagina: number) => {
    const doc = gerarPdfModelo({ numero: "CT-1", titulo: "CONSTRUÇÃO ATC", data: new Date("2026-11-23"),
      clausulas: Array.from({ length: 30 }, (_, i) => `CLÁUSULA ${i + 1}\n` + "Texto da cláusula. ".repeat(40)).join("\n"), assinaturas: ["PROSPECTA", "Cliente"] });
    doc.setPage(pagina + 1);
    (doc.internal as unknown as { write: (s: string) => void }).write(operadores);
    return Buffer.from(doc.output("arraybuffer"));
  };
  it.each([
    ["na página da marca, nome escrito normalmente", "BT /F0 28 Tf 50 700 Td (VALOR ALTERADO 999) Tj ET", 0],
    ["em outra página, nome escrito normalmente", "BT /F0 28 Tf 50 700 Td (VALOR ALTERADO 999) Tj ET", 1],
    ["em outra página, nome com escape #xx", "BT /#460 28 Tf 50 700 Td (VALOR ALTERADO 999) Tj ET", 1],
    ["na página da marca, nome com escape #xx", "BT /F#30 28 Tf 50 700 Td (VALOR ALTERADO 999) Tj ET", 0],
  ])("origem com texto escondido que cita a fonte da marca (%s): recusado", async (_nome, operadores, pagina) => {
    const original = comTextoEscondido(operadores, pagina);
    const { assinado, titular } = await assinarComMarca(original, 0);
    expect(assinado.subarray(0, original.length).equals(original)).toBe(true);
    expect(await mesmoConteudo(original, assinado, { titular })).toBe(false);
  }, 120_000);
});
