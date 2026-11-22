// Jurídico — o PDF assinado pela empresa só pode diferir do documento de origem pela MARCA visível da assinatura
// (achado A1 do portão de QA, 22/11/2026).
//
// O assinador desenha a marca antes de assinar (atualização incremental): a página ganha um envoltório "q … Q" em volta do
// conteúdo original e, depois, fluxos novos com UM retângulo de borda e as linhas de texto da marca. Qualquer outra
// mudança (texto fora do vocabulário da marca, como "VALOR ALTERADO 999", preenchimento, imagem, transformação, fonte
// embutida, desenho fora da caixa, segunda página alterada) faz o vínculo com a origem falhar.
import { measureText, PdfArray, PdfDict, PdfRef, PdfStream, type PDF } from "@libpdf/core";

type Pagina = ReturnType<PDF["getPages"]>[number];
const OPERADORES = new Set(["q", "Q", "w", "RG", "rg", "G", "g", "K", "k", "m", "l", "h", "S", "re", "BT", "ET", "Tf", "TL", "Tm", "Td", "Tj", "TJ"]);
const STANDARD14 = new Set(["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique", "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic", "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"]);
const VOCABULARIO_FIXO = "ASSINADO DIGITALMENTE CPF/CNPJ: Ver certificado Consulte o certificado";
const TOLERANCIA = 2;

type Token = { t: "num"; v: number } | { t: "nome"; v: string } | { t: "str"; v: string } | { t: "arr"; v: Token[] } | { t: "op"; v: string };

/** Leitor mínimo de fluxo de conteúdo (números, nomes, strings literais/hex, arrays e operadores). Lança no inesperado. */
export function lerConteudo(texto: string): Token[] {
  let i = 0;
  const ws = () => { while (i < texto.length && /[\s\0]/.test(texto[i])) i++; };
  const token = (): Token => {
    const c = texto[i];
    if (c === "[") { i++; const itens: Token[] = []; for (;;) { ws(); if (i >= texto.length) throw new Error("array"); if (texto[i] === "]") { i++; break; } itens.push(token()); } return { t: "arr", v: itens }; }
    if (c === "(") {
      i++; let nivel = 1, out = "";
      while (i < texto.length && nivel) {
        const ch = texto[i++];
        if (ch === "\\") { const n = texto[i++]; const mapa: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
          if (/[0-7]/.test(n)) { let oct = n; while (oct.length < 3 && /[0-7]/.test(texto[i])) oct += texto[i++]; out += String.fromCharCode(parseInt(oct, 8)); } else out += mapa[n] ?? n; }
        else if (ch === "(") { nivel++; out += ch; } else if (ch === ")") { nivel--; if (nivel) out += ch; } else out += ch;
      }
      if (nivel) throw new Error("string");
      return { t: "str", v: out };
    }
    if (c === "<") { const fim = texto.indexOf(">", i); if (fim < 0 || texto[i + 1] === "<") throw new Error("hex"); const hex = texto.slice(i + 1, fim).replace(/\s/g, ""); i = fim + 1; if (!/^[0-9a-fA-F]*$/.test(hex)) throw new Error("hex"); return { t: "str", v: Buffer.from(hex.length % 2 ? hex + "0" : hex, "hex").toString("latin1") }; }
    if (c === "/") { const m = /^\/[^\s/[\]()<>{}%]*/.exec(texto.slice(i))!; i += m[0].length; return { t: "nome", v: m[0].slice(1) }; }
    const num = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(texto.slice(i));
    if (num) { i += num[0].length; return { t: "num", v: Number(num[0]) }; }
    const op = /^[A-Za-z'"*]+/.exec(texto.slice(i));
    if (op) { i += op[0].length; return { t: "op", v: op[0] }; }
    throw new Error(`token inesperado em ${i}`);
  };
  const tokens: Token[] = [];
  for (;;) { ws(); if (i >= texto.length) break; if (texto[i] === "%") { while (i < texto.length && texto[i] !== "\n" && texto[i] !== "\r") i++; continue; } tokens.push(token()); }
  return tokens;
}

function fluxos(pdf: PDF, pagina: Pagina): string[] | null {
  const bruto = pagina.dict.get("Contents");
  const itens = bruto instanceof PdfArray ? bruto.toArray() : bruto ? [bruto] : [];
  const out: string[] = [];
  for (const item of itens) {
    const obj = item instanceof PdfRef ? pdf.getObject(item) : item;
    if (!(obj instanceof PdfStream)) return null;
    out.push(Buffer.from(obj.getDecodedData()).toString("latin1"));
  }
  return out;
}
function dict(pdf: PDF, valor: unknown): PdfDict | null {
  const obj = valor instanceof PdfRef ? pdf.getObject(valor) : valor;
  return obj instanceof PdfDict ? obj : null;
}
const chave = (k: unknown) => String((k as { value?: string }).value ?? k).replace(/^\//, "");

/** Recursos: tudo o que existia continua igual; só pode entrar fonte padrão (Type1 Standard 14, sem arquivo embutido). */
function recursosSoComFontePadrao(a: PDF, pa: Pagina, b: PDF, pb: Pagina, serial: (pdf: PDF, v: unknown) => string): boolean {
  const ra = dict(a, pa.dict.get("Resources")), rb = dict(b, pb.dict.get("Resources"));
  if (!ra || !rb) return false;
  const entradas = (d: PdfDict) => new Map(Array.from(d as unknown as Iterable<[unknown, unknown]>).map(([k, v]) => [chave(k), v]));
  const ea = entradas(ra), eb = entradas(rb);
  for (const [k, v] of Array.from(eb.entries())) {
    if (k === "Font") continue;
    if (!ea.has(k) || serial(a, ea.get(k)) !== serial(b, v)) return false;
  }
  for (const k of Array.from(ea.keys())) if (!eb.has(k)) return false;
  const fa = ea.has("Font") ? dict(a, ea.get("Font")) : null, fb = eb.has("Font") ? dict(b, eb.get("Font")) : null;
  if (fa && !fb) return false;
  const fontesA = fa ? entradas(fa) : new Map<string, unknown>(), fontesB = fb ? entradas(fb) : new Map<string, unknown>();
  for (const [nome, v] of Array.from(fontesA.entries())) if (!fontesB.has(nome) || serial(a, v) !== serial(b, fontesB.get(nome))) return false;
  for (const [nome, v] of Array.from(fontesB.entries())) {
    if (fontesA.has(nome)) continue;
    const f = dict(b, v);
    if (!f || f.getName("Subtype")?.value !== "Type1" || !STANDARD14.has(f.getName("BaseFont")?.value || "") || f.has("FontDescriptor") || f.has("Widths")) return false;
  }
  return true;
}

/** Os fluxos acrescentados desenham só a marca: um retângulo de borda e texto do vocabulário da marca dentro dele. */
export function desenhoSoDaMarca(acrescentados: string[], titular: string, pagina: { x: number; y: number; width: number; height: number }, fontesPermitidas?: Set<string>): boolean {
  const vocabulario = new Set(`${VOCABULARIO_FIXO} ${titular.replace(/[^ -ÿ]/g, "")}`.split(/\s+/).filter(Boolean));
  const palavraOk = (p: string) => vocabulario.has(p) || /^[\d/:,.\-]+$/.test(p);
  const pontos: [number, number][] = [], textos: { x: number; y: number; tamanho: number; texto: string }[] = [];
  let larguraLinha = 1, nivel = 0, emTexto = false, fonte = 12, entrelinha = 0, tx = 0, ty = 0, linhaX = 0, linhaY = 0, contornos = 0;
  const espessuras: number[] = [], estadoGrafico: number[] = [];
  let textoDesenhado = false;
  let fonteDefinida = false, posicaoDefinida = false;
  for (const fluxo of acrescentados) {
    const pilha: Token[] = [];
    for (const tk of lerConteudo(fluxo)) {
      if (tk.t !== "op") { pilha.push(tk); continue; }
      const op = tk.v, args = pilha.splice(0), nums = args.map(a => a.t === "num" ? a.v : NaN);
      if (!OPERADORES.has(op)) return false;
      switch (op) {
        case "q": if (emTexto) return false; nivel++; estadoGrafico.push(larguraLinha); break;
        case "Q": if (emTexto || --nivel < 0) return false; larguraLinha = estadoGrafico.pop()!; break;
        case "w": if (nums.length !== 1 || !Number.isFinite(nums[0]) || nums[0] <= 0) return false; larguraLinha = nums[0]; break;
        // A marca do assinador usa somente cores escuras, sem preenchimento de fundo.
        case "RG": case "rg": if (nums.length !== 3 || nums.some(n => !Number.isFinite(n) || n < 0 || n > 0.5)) return false; break;
        case "G": case "g": if (nums.length !== 1 || !Number.isFinite(nums[0]) || nums[0] < 0 || nums[0] > 0.5) return false; break;
        case "K": case "k": return false;
        case "m": case "l": if (emTexto || nums.length !== 2 || nums.some(n => !Number.isFinite(n))) return false; pontos.push([nums[0], nums[1]]); break;
        case "re": if (emTexto || nums.length !== 4 || nums.some(n => !Number.isFinite(n))) return false; pontos.push([nums[0], nums[1]], [nums[0] + nums[2], nums[1] + nums[3]]); break;
        case "S": contornos++; espessuras.push(larguraLinha); break;
        case "BT": if (emTexto) return false; emTexto = true; textoDesenhado = false; fonteDefinida = false; posicaoDefinida = false; tx = ty = linhaX = linhaY = 0; break;
        case "ET": if (!emTexto) return false; emTexto = false; break;
        case "Tf": if (!emTexto || args.length !== 2 || args[0].t !== "nome" || fontesPermitidas && !fontesPermitidas.has(args[0].v) || !Number.isFinite(nums[1]) || !(nums[1] > 0)) return false; fonte = nums[1]; fonteDefinida = true; break;
        case "TL": entrelinha = nums[0]; break;
        case "Tm": if (!emTexto || nums.length !== 6 || nums.some(n => !Number.isFinite(n)) || nums[0] !== 1 || nums[1] !== 0 || nums[2] !== 0 || nums[3] !== 1) return false; tx = linhaX = nums[4]; ty = linhaY = nums[5]; posicaoDefinida = true; break;
        case "Td": if (!emTexto || nums.length !== 2 || nums.some(n => !Number.isFinite(n))) return false; tx = linhaX = linhaX + nums[0]; ty = linhaY = linhaY + nums[1]; break;
        // O assinador emite uma linha Tj por BT/ET. Outros avanços ou ajustes não pertencem à marca suportada.
        case "TJ": return false;
        case "Tj": {
          if (!emTexto || !fonteDefinida || !posicaoDefinida || textoDesenhado || args.length !== 1 || args[0].t !== "str") return false;
          textoDesenhado = true;
          const texto = args[0].v;
          if (!texto.trim().split(/\s+/).every(palavraOk)) return false;
          textos.push({ x: tx, y: ty, tamanho: fonte, texto });
          break;
        }
        default: break; // cores
      }
    }
    if (pilha.length) return false;
  }
  if (nivel !== 0 || emTexto || contornos !== 1 || pontos.length < 2 || !textos.length) return false;
  void entrelinha;
  const xs = pontos.map(p => p[0]), ys = pontos.map(p => p[1]);
  const caixa = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  const lado = Math.min(caixa.x1 - caixa.x0, caixa.y1 - caixa.y0);
  if (!(lado > 0) || espessuras.some(espessura => espessura > Math.max(0.6, lado * 0.02))) return false;
  // A caixa fica dentro da página e ocupa no máximo 30% dela.
  if (caixa.x0 < pagina.x - TOLERANCIA || caixa.y0 < pagina.y - TOLERANCIA || caixa.x1 > pagina.x + pagina.width + TOLERANCIA || caixa.y1 > pagina.y + pagina.height + TOLERANCIA) return false;
  if ((caixa.x1 - caixa.x0) * (caixa.y1 - caixa.y0) > 0.3 * pagina.width * pagina.height) return false;
  return textos.every(t => {
    let largura = t.texto.length * t.tamanho;
    try { largura = measureText(t.texto, "Helvetica", t.tamanho); } catch { /* usa a estimativa larga */ }
    return t.x >= caixa.x0 - TOLERANCIA && t.y >= caixa.y0 - TOLERANCIA && t.x + largura <= caixa.x1 + TOLERANCIA && t.y + t.tamanho <= caixa.y1 + TOLERANCIA;
  });
}

/** A página `pb` (assinada) é a página `pa` (origem) + a marca, e nada mais. */
export function paginaComMarca(a: PDF, pa: Pagina, b: PDF, pb: Pagina, titular: string, serial: (pdf: PDF, v: unknown) => string): boolean {
  try {
    const antes = fluxos(a, pa), depois = fluxos(b, pb);
    if (!antes || !depois || depois.length < antes.length + 3) return false;
    if (depois[0].trim() !== "q" || depois[antes.length + 1].trim() !== "Q") return false;
    for (let i = 0; i < antes.length; i++) if (depois[i + 1] !== antes[i]) return false;
    if (!recursosSoComFontePadrao(a, pa, b, pb, serial)) return false;
    const recursos = dict(b, pb.dict.get("Resources"));
    const fontes = recursos && dict(b, recursos.get("Font"));
    const permitidas = new Set<string>();
    if (fontes) for (const [nome, valor] of Array.from(fontes)) {
      const fonte = dict(b, valor), encoding = fonte?.get("Encoding");
      if (fonte?.getName("Subtype")?.value === "Type1" && fonte.getName("BaseFont")?.value === "Helvetica"
        && !fonte.has("FontDescriptor") && !fonte.has("Widths") && !fonte.has("ToUnicode")
        && (!encoding || ["WinAnsiEncoding", "StandardEncoding"].includes(fonte.getName("Encoding")?.value || ""))) permitidas.add(chave(nome));
    }
    const mb = pb.getMediaBox();
    return desenhoSoDaMarca(depois.slice(antes.length + 2), titular, { x: mb.x, y: mb.y, width: mb.width, height: mb.height }, permitidas);
  } catch { return false; }
}
