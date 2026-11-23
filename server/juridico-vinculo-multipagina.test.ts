// Jurídico — vínculo com o documento de origem em contrato de VÁRIAS páginas (23/11/2026).
// Defeito de produção: o jsPDF usa um dicionário de recursos comum a todas as páginas; ao desenhar a marca da assinatura,
// todas "ganhavam" a fonte da marca e a conferência dizia "o PDF assinado não corresponde ao documento de origem".
import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { PDF, P12Signer, PdfArray, PdfDict, PdfName, PdfNumber, PdfRef, PdfStream } from "@libpdf/core";
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

// Portão de QA de 23/11/2026 (re-revisão): referência adormecida escondida em Form XObject e filtro indireto.
describe("vínculo com a origem — XObject e filtro indireto", () => {
  const OCULTO = "BT /F0 28 Tf 1 0 0 1 60 400 Tm (VALOR ALTERADO 999) Tj ET";
  const fluxo = (pdf: PDF, entradas: Record<string, never>, dados: Uint8Array) => pdf.register(PdfStream.fromDict(entradas, dados));
  const form = (extra: Record<string, unknown> = {}) => ({ Type: PdfName.of("XObject"), Subtype: PdfName.of("Form"),
    BBox: PdfArray.of(PdfNumber.of(0), PdfNumber.of(0), PdfNumber.of(600), PdfNumber.of(900)), ...extra }) as Record<string, never>;
  function acrescentar(pdf: PDF, pagina: number, conteudo: PdfRef, xobject?: PdfRef) {
    const page = pdf.getPage(pagina)!;
    if (xobject) {
      const r = page.dict.get("Resources"); const res = (r instanceof PdfRef ? pdf.getObject(r) : r) as PdfDict;
      const x = res.get("XObject"); let xo = (x instanceof PdfRef ? pdf.getObject(x) : x) as PdfDict | undefined;
      if (!xo) { xo = PdfDict.of({}); res.set("XObject", xo); }
      xo.set("FxQA", xobject);
    }
    const c = page.dict.get("Contents"); const lista = c instanceof PdfArray ? c : PdfArray.of(c as PdfRef);
    lista.push(conteudo); page.dict.set("Contents", lista);
  }
  const chamaForm = (pdf: PDF) => fluxo(pdf, {}, new TextEncoder().encode("\nq /FxQA Do Q\n"));
  it.each([
    ["Form XObject sem /Resources (herda os da página)", (pdf: PDF) => acrescentar(pdf, 1, chamaForm(pdf), fluxo(pdf, form(), new TextEncoder().encode(OCULTO)))],
    ["Form XObject aninhado", (pdf: PDF) => {
      const dentro = fluxo(pdf, form(), new TextEncoder().encode(OCULTO));
      acrescentar(pdf, 1, chamaForm(pdf), fluxo(pdf, form({ Resources: PdfDict.of({ XObject: PdfDict.of({ In: dentro }) }) }), new TextEncoder().encode("/In Do")));
    }],
    ["Form XObject com /Filter indireto", (pdf: PDF) => acrescentar(pdf, 1, chamaForm(pdf),
      fluxo(pdf, form({ Filter: pdf.register(PdfName.of("FlateDecode")) }), new Uint8Array(deflateSync(Buffer.from(OCULTO)))))],
    ["fluxo de página com /Filter indireto", (pdf: PDF) => acrescentar(pdf, 1,
      fluxo(pdf, { Filter: pdf.register(PdfName.of("FlateDecode")) } as Record<string, never>, new Uint8Array(deflateSync(Buffer.from(`\n${OCULTO}\n`)))))],
    ["fluxo da página da marca com /Filter indireto", (pdf: PDF) => acrescentar(pdf, 0,
      fluxo(pdf, { Filter: PdfArray.of(pdf.register(PdfName.of("FlateDecode"))) } as Record<string, never>, new Uint8Array(deflateSync(Buffer.from(`\n${OCULTO}\n`)))))],
  ])("origem com texto escondido (%s): recusado", async (_nome, montar) => {
    const pdf = await PDF.load(new Uint8Array(contrato(30))); montar(pdf);
    const original = Buffer.from(await pdf.save());
    const { assinado, titular } = await assinarComMarca(original, 0);
    expect(await mesmoConteudo(original, assinado, { titular })).toBe(false);
  }, 120_000);

  it("PDF assinado que troca o /Filter de um fluxo por referência indireta: recusado (com e sem marca)", async () => {
    // Origem: fluxo que é só um comentário com o texto em hexadecimal (nada aparece). No assinado, o mesmo fluxo ganha
    // /Filter -> objeto /ASCIIHexDecode; os bytes não mudam, mas o leitor (pdf.js) passa a desenhar o texto.
    const pdf = await PDF.load(new Uint8Array(contrato(30)));
    const alvo = fluxo(pdf, {}, new TextEncoder().encode(`%${Buffer.from("BT /F1 28 Tf 1 0 0 1 60 400 Tm (VALOR ALTERADO 999) Tj ET").toString("hex")}\n`));
    acrescentar(pdf, 1, alvo);
    const original = Buffer.from(await pdf.save());
    const editado = await PDF.load(new Uint8Array(original));
    (editado.getObject(alvo) as PdfStream).set("Filter", editado.register(PdfName.of("ASCIIHexDecode")));
    const trocado = Buffer.from(await editado.save({ incremental: true }));
    expect(trocado.subarray(0, original.length).equals(original)).toBe(true);
    expect(await mesmoConteudo(original, trocado)).toBe(false);
    const { assinado, titular } = await assinarComMarca(trocado, 0);
    expect(await mesmoConteudo(original, assinado, { titular })).toBe(false);
  }, 120_000);

  it("troca do /Filter por nome DIRETO também é recusada (o conteúdo decodificado muda)", async () => {
    const pdf = await PDF.load(new Uint8Array(contrato(30)));
    const alvo = fluxo(pdf, {}, new TextEncoder().encode(`%${Buffer.from("BT /F1 28 Tf 1 0 0 1 60 400 Tm (VALOR ALTERADO 999) Tj ET").toString("hex")}\n`));
    acrescentar(pdf, 1, alvo);
    const original = Buffer.from(await pdf.save());
    const editado = await PDF.load(new Uint8Array(original));
    (editado.getObject(alvo) as PdfStream).set("Filter", PdfName.of("ASCIIHexDecode"));
    const trocado = Buffer.from(await editado.save({ incremental: true }));
    expect(await mesmoConteudo(original, trocado)).toBe(false);
  }, 120_000);
});

// Portão de QA de 23/11/2026 (3ª revisão): preditor com linha parcial e fluxo marcado como /Image fora de /XObject.
describe("vínculo com a origem — preditor e /Subtype /Image", () => {
  const OCULTO = "BT /F0 40 Tf 1 0 0 1 60 400 Tm (VALOR ALTERADO 999) Tj ET";
  const caixa = () => PdfArray.of(PdfNumber.of(0), PdfNumber.of(0), PdfNumber.of(600), PdfNumber.of(900));
  const texto = (s: string) => new TextEncoder().encode(s);
  const noConteudo = (pdf: PDF, pagina: number, ref: PdfRef) => {
    const page = pdf.getPage(pagina)!; const c = page.dict.get("Contents");
    const lista = c instanceof PdfArray ? c : PdfArray.of(c as PdfRef); lista.push(ref); page.dict.set("Contents", lista);
  };
  // Preditor TIFF (2) com /Columns maior que o fluxo: a biblioteca devolve só zeros; o leitor decodifica a linha parcial.
  const tiff = (s: string) => { const b = Buffer.from(s), o = Buffer.alloc(b.length); for (let i = 0; i < b.length; i++) o[i] = (b[i] - (i ? b[i - 1] : 0)) & 255; return o; };
  const comPreditor = (pdf: PDF) => pdf.register(PdfStream.fromDict({ Filter: PdfName.of("FlateDecode"),
    DecodeParms: PdfDict.of({ Predictor: PdfNumber.of(2), Columns: PdfNumber.of(100000) }) }, new Uint8Array(deflateSync(tiff(`\n${OCULTO}\n`)))));
  it.each([
    ["preditor TIFF com linha parcial, outra página", (pdf: PDF) => noConteudo(pdf, 1, comPreditor(pdf))],
    ["preditor TIFF com linha parcial, página da marca", (pdf: PDF) => noConteudo(pdf, 0, comPreditor(pdf))],
    ["aparência de anotação marcada como /Subtype /Image", (pdf: PDF) => {
      const ap = pdf.register(PdfStream.fromDict({ Type: PdfName.of("XObject"), Subtype: PdfName.of("Image"), BBox: caixa() }, texto(OCULTO)));
      pdf.getPage(1)!.dict.set("Annots", PdfArray.of(pdf.register(PdfDict.of({ Type: PdfName.of("Annot"), Subtype: PdfName.of("Square"),
        Rect: caixa(), F: PdfNumber.of(4), AP: PdfDict.of({ N: ap }) }))));
    }],
    ["padrão (tiling) marcado como /Subtype /Image", (pdf: PDF) => {
      const padrao = pdf.register(PdfStream.fromDict({ Type: PdfName.of("Pattern"), Subtype: PdfName.of("Image"), PatternType: PdfNumber.of(1),
        PaintType: PdfNumber.of(1), TilingType: PdfNumber.of(1), BBox: caixa(), XStep: PdfNumber.of(600), YStep: PdfNumber.of(900) }, texto(OCULTO)));
      const r = pdf.getPage(1)!.dict.get("Resources"); const recursos = (r instanceof PdfRef ? pdf.getObject(r) : r) as PdfDict;
      recursos.set("Pattern", PdfDict.of({ PQA: padrao }));
      noConteudo(pdf, 1, pdf.register(PdfStream.fromDict({}, texto("\nq /Pattern cs /PQA scn 0 0 600 900 re f Q\n"))));
    }],
  ])("origem com texto escondido (%s): recusado", async (_nome, montar) => {
    const pdf = await PDF.load(new Uint8Array(contrato(30))); montar(pdf);
    const original = Buffer.from(await pdf.save());
    const { assinado, titular } = await assinarComMarca(original, 0);
    expect(await mesmoConteudo(original, assinado, { titular })).toBe(false);
  }, 120_000);

  it("contrato legítimo com logo PNG (imagem com preditor) em todas as páginas continua conferido", async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    // PNG 8x8 vermelho, só para existir um XObject de imagem com /DecodeParms do jsPDF.
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGM4ISeHFTEMLQkAkL9BAbKfPiIAAAAASUVORK5CYII=";
    for (let p = 0; p < 4; p++) { if (p) doc.addPage(); doc.addImage(png, "PNG", 15, 10, 20, 20); doc.text(`Página ${p + 1} do contrato de teste`, 20, 50); }
    const original = Buffer.from(doc.output("arraybuffer"));
    for (const pagina of [0, 3]) {
      const { assinado, titular } = await assinarComMarca(original, pagina);
      expect(await mesmoConteudo(original, assinado, { titular })).toBe(true);
    }
  }, 120_000);
});
