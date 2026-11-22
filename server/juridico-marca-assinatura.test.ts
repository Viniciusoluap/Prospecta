import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jsPDF } from "jspdf";
import {
  ENTRELINHA, ESCALA_MAX, ESCALA_MIN, MARCA_BASE, caixaNaEscala, escalaDaCaixa, layoutDaMarca, linhasDaMarca, medirHelvetica, moverCaixa,
  type CaixaRelativa, type LayoutDaMarca,
} from "../client/src/lib/marca-assinatura";
import { assinarPdf, importarCertificado } from "../client/src/lib/certificados-digitais";

const DATA = new Date("2026-11-22T15:30:00Z");
const CURTO = linhasDaMarca("EMPRESA TESTE:12345678000190", "12345678000190", DATA);
const LONGO = linhasDaMarca("CONSTRUTORA E INCORPORADORA DE IMOVEIS FINANCIADOS DO NORDESTE LTDA:12345678000190", "12345678000190", DATA);
const PAGINAS = { "A4 retrato": [595.28, 841.89], "A4 paisagem": [841.89, 595.28], "Carta retrato": [612, 792], "Ofício paisagem": [1008, 612], "A5 retrato": [419.53, 595.28] } as const;

function caixaPt(pagina: readonly [number, number], escala: number) {
  return { largura: MARCA_BASE.w * escala * pagina[0], altura: MARCA_BASE.h * escala * pagina[1] };
}
function confereQueCabe(m: LayoutDaMarca, largura: number, altura: number) {
  for (const l of m.linhas) {
    expect(l.x).toBeGreaterThanOrEqual(m.borda);
    expect(l.x + medirHelvetica(l.texto, m.fonte)).toBeLessThanOrEqual(largura - m.margem + 1e-6);
    expect(l.topo).toBeGreaterThanOrEqual(m.margem - 1e-9);
  }
  const ultima = m.linhas[m.linhas.length - 1];
  expect(ultima.topo + m.entrelinha).toBeLessThanOrEqual(altura - m.margem + 1e-6);
  expect(m.entrelinha).toBeCloseTo(m.fonte * ENTRELINHA, 9);
}

describe("marca da assinatura — layout proporcional", () => {
  it("escala por inteiro: fonte, entrelinha, margem, borda e linhas acompanham a caixa", () => {
    const base = layoutDaMarca(300, 90, CURTO);
    for (const k of [0.5, 1.37, 1.6, 2.5]) {
      const m = layoutDaMarca(300 * k, 90 * k, CURTO);
      expect(m.linhas.map(l => l.texto)).toEqual(base.linhas.map(l => l.texto));
      expect(m.fonte).toBeCloseTo(base.fonte * k, 6);
      expect(m.entrelinha).toBeCloseTo(base.entrelinha * k, 6);
      expect(m.margem).toBeCloseTo(base.margem * k, 9);
      expect(m.borda).toBeCloseTo(base.borda * k, 9);
      m.linhas.forEach((l, i) => {
        expect(l.x).toBeCloseTo(base.linhas[i].x * k, 6);
        expect(l.topo).toBeCloseTo(base.linhas[i].topo * k, 6);
        expect(l.base).toBeCloseTo(base.linhas[i].base * k, 6);
      });
    }
  });

  it("prévia em px e PDF em pt dão a mesma marca em proporção", () => {
    const pt = caixaPt(PAGINAS["A4 retrato"], 1);
    const fatorTela = 0.73; // ex.: página exibida a 73% do tamanho em pontos
    const pdf = layoutDaMarca(pt.largura, pt.altura, LONGO);
    const tela = layoutDaMarca(pt.largura * fatorTela, pt.altura * fatorTela, LONGO);
    expect(tela.linhas.map(l => l.texto)).toEqual(pdf.linhas.map(l => l.texto));
    expect(tela.fonte / pdf.fonte).toBeCloseTo(fatorTela, 6);
    expect(tela.borda / pdf.borda).toBeCloseTo(fatorTela, 9);
  });

  it("o texto sempre cabe, inclusive nome longo e palavra sem espaço", () => {
    const semEspaco = linhasDaMarca("X".repeat(120), "", DATA);
    for (const [w, h] of [[50, 25], [80, 200], [600, 30], [155, 46], [952, 148]] as const) {
      for (const blocos of [CURTO, LONGO, semEspaco]) {
        const m = layoutDaMarca(w, h, blocos);
        expect(m.fonte).toBeGreaterThan(0);
        confereQueCabe(m, w, h);
        expect(m.linhas.map(l => l.texto).join("").replace(/\s/g, "")).toBe(blocos.join("").replace(/\s/g, ""));
      }
    }
  });

  it("nos limites de 50% e 160% continua legível em páginas retrato e paisagem", () => {
    for (const [nome, pagina] of Object.entries(PAGINAS)) {
      for (const escala of [ESCALA_MIN, 1, ESCALA_MAX]) {
        const { largura, altura } = caixaPt(pagina, escala);
        for (const blocos of [CURTO, LONGO]) {
          const m = layoutDaMarca(largura, altura, blocos);
          confereQueCabe(m, largura, altura);
          // 4 pt é o menor corpo aceito para leitura em impressão nos formatos de contrato (A4, Carta, Ofício).
          // Em A5 a 50% com razão social longa (5 linhas numa caixa de ~109 × 33 pt) o corpo fica em ~3,8 pt.
          expect(m.fonte, `${nome} ${escala * 100}%`).toBeGreaterThanOrEqual(nome.startsWith("A5") ? 3.5 : 4);
        }
      }
      const pequena = layoutDaMarca(caixaPt(pagina, ESCALA_MIN).largura, caixaPt(pagina, ESCALA_MIN).altura, CURTO);
      const grande = layoutDaMarca(caixaPt(pagina, ESCALA_MAX).largura, caixaPt(pagina, ESCALA_MAX).altura, CURTO);
      expect(grande.fonte / pequena.fonte).toBeCloseTo(ESCALA_MAX / ESCALA_MIN, 4);
    }
  });

  it("rejeita caixa inválida", () => {
    expect(() => layoutDaMarca(0, 50, CURTO)).toThrow();
    expect(() => layoutDaMarca(100, Number.NaN, CURTO)).toThrow();
    expect(() => layoutDaMarca(100, 50, [])).toThrow();
  });
});

describe("marca da assinatura — coordenadas", () => {
  const dentro = (c: CaixaRelativa) => {
    expect(c.x).toBeGreaterThanOrEqual(0); expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.x + c.w).toBeLessThanOrEqual(1 + 1e-12); expect(c.y + c.h).toBeLessThanOrEqual(1 + 1e-12);
  };
  const inicial: CaixaRelativa = { x: 0.1, y: 0.7, w: MARCA_BASE.w, h: MARCA_BASE.h };

  it("redimensionar preserva o centro e as proporções da base", () => {
    const c = caixaNaEscala(inicial, 1.3);
    expect(c.x + c.w / 2).toBeCloseTo(inicial.x + inicial.w / 2, 12);
    expect(c.y + c.h / 2).toBeCloseTo(inicial.y + inicial.h / 2, 12);
    expect(c.w / c.h).toBeCloseTo(MARCA_BASE.w / MARCA_BASE.h, 12);
    expect(escalaDaCaixa(c)).toBeCloseTo(1.3, 12);
    expect(escalaDaCaixa(caixaNaEscala(inicial, 9))).toBeCloseTo(ESCALA_MAX, 12);
    expect(escalaDaCaixa(caixaNaEscala(inicial, 0.1))).toBeCloseTo(ESCALA_MIN, 12);
    expect(escalaDaCaixa(caixaNaEscala(inicial, Number.NaN))).toBeCloseTo(1, 12);
  });

  it("nunca sai da página ao redimensionar e arrastar, inclusive nos cantos", () => {
    for (const [fx, fy] of [[0, 0], [1, 1], [0, 1], [1, 0], [0.5, 0.5], [-3, 7], [0.99, 0.02]]) {
      let c = moverCaixa(inicial, fx, fy); dentro(c);
      for (const e of [ESCALA_MAX, ESCALA_MIN, 1.2]) { c = caixaNaEscala(c, e); dentro(c); }
      c = moverCaixa(c, fx, fy); dentro(c);
    }
  });

  it("arrastar centraliza no toque e redimensionar depois mantém esse centro", () => {
    const c = moverCaixa(caixaNaEscala(inicial, ESCALA_MIN), 0.5, 0.4);
    expect(c.x + c.w / 2).toBeCloseTo(0.5, 12); expect(c.y + c.h / 2).toBeCloseTo(0.4, 12);
    const maior = caixaNaEscala(c, ESCALA_MAX);
    expect(maior.x + maior.w / 2).toBeCloseTo(0.5, 12); expect(maior.y + maior.h / 2).toBeCloseTo(0.4, 12);
    // Encostada na borda direita, crescer empurra para dentro em vez de sair da página.
    const borda = moverCaixa(inicial, 1, 0.5), cresceu = caixaNaEscala(borda, ESCALA_MAX);
    expect(cresceu.x + cresceu.w).toBeCloseTo(1, 12);
  });
});

describe("marca da assinatura — desenho real no PDF (bytes sintéticos)", () => {
  const dir = mkdtempSync(join(tmpdir(), "prospecta-marca-teste-"));
  let file: File;
  beforeAll(() => {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "7", "-nodes", "-subj", "/C=BR/O=TESTE SEM VALIDADE/CN=EMPRESA TESTE:12345678000190"], { stdio: "ignore" });
    execFileSync("openssl", ["pkcs12", "-export", "-inkey", join(dir, "key.pem"), "-in", join(dir, "cert.pem"), "-out", join(dir, "cert.pfx"), "-passout", "pass:teste-somente"]);
    file = new File([readFileSync(join(dir, "cert.pfx"))], "teste.pfx");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("desenha a marca inteira em 50% e 160%, retrato e paisagem, sem estourar a caixa", async () => {
    const cert = await importarCertificado(31, file, "teste-somente");
    const { PDF } = await import("@libpdf/core");
    for (const orientacao of ["portrait", "landscape"] as const) {
      const doc = new jsPDF({ orientation: orientacao, unit: "pt", format: "a4" }); doc.text("DOCUMENTO SINTETICO DE TESTE", 40, 40);
      const original = new Uint8Array(doc.output("arraybuffer"));
      const pagina = [doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight()] as const;
      for (const escala of [ESCALA_MIN, ESCALA_MAX]) {
        const { largura, altura } = caixaPt(pagina, escala);
        const x = 20, y = 30;
        const assinado = await assinarPdf(original, cert, "teste-somente", { pagina: 0, x, y, largura, altura });
        const texto = (await PDF.load(assinado.bytes)).getPage(0)!.extractText();
        expect(texto.text).toContain("ASSINADO DIGITALMENTE");
        expect(texto.text).toContain("EMPRESA TESTE");
        const esperado = layoutDaMarca(largura, altura, linhasDaMarca("EMPRESA TESTE:12345678000190", "12345678000190", new Date()));
        const linhas = texto.lines.filter(l => l.text.includes("ASSINADO DIGITALMENTE") || l.text.includes("EMPRESA TESTE"));
        expect(linhas.length).toBeGreaterThan(0);
        for (const l of linhas) {
          expect(l.bbox.x).toBeGreaterThanOrEqual(x - 0.5);
          expect(l.bbox.x + l.bbox.width).toBeLessThanOrEqual(x + largura + 0.5);
          expect(l.bbox.y).toBeGreaterThanOrEqual(y - 0.5);
          expect(l.bbox.y + l.bbox.height).toBeLessThanOrEqual(y + altura + 0.5);
          expect(l.bbox.height).toBeGreaterThan(esperado.fonte * 0.5);
        }
      }
    }
  }, 60_000);
});
