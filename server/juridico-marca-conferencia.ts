// Jurídico — o PDF assinado pela empresa só pode diferir do documento de origem pela MARCA visível da assinatura
// (achado A1 do portão de QA, 22/11/2026).
//
// O assinador desenha a marca antes de assinar (atualização incremental): a página ganha um envoltório "q … Q" em volta do
// conteúdo original e, depois, fluxos novos com UM retângulo de borda e as linhas de texto da marca. Qualquer outra
// mudança (texto fora do vocabulário da marca, como "VALOR ALTERADO 999", preenchimento, imagem, transformação, fonte
// embutida, desenho fora da caixa, segunda página alterada) faz o vínculo com a origem falhar.
import { PdfArray, PdfDict, PdfRef, PdfStream, type PDF } from "@libpdf/core";
import { dataDaMarca, layoutDaMarca, linhasDaMarca } from "../client/src/lib/marca-assinatura.js";

type Pagina = ReturnType<PDF["getPages"]>[number];
const OPERADORES = new Set(["q", "Q", "w", "RG", "rg", "G", "g", "K", "k", "m", "l", "h", "S", "re", "BT", "ET", "Tf", "TL", "Tm", "Td", "Tj", "TJ"]);
const STANDARD14 = new Set(["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique", "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic", "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"]);
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

/**
 * Decodificação ESTRITA (portão de QA de 23/11/2026, re-revisão): a biblioteca não resolve `/Filter` indireto e devolveria os
 * bytes comprimidos como se fossem o conteúdo — um leitor de PDF resolve e desenha outra coisa. Aqui `/Filter` e
 * `/DecodeParms` precisam estar escritos direto no fluxo (nome, ou array só de nomes/dicionários diretos); qualquer
 * referência indireta, ou descompressão que devolve vazio para entrada não vazia, lança (quem chama recusa o vínculo).
 */
export function decodificarEstrito(stream: PdfStream, opcoes: { imagem?: boolean } = {}): Uint8Array {
  // Preditor (TIFF/PNG) só existe em imagem. Em fluxo de conteúdo a biblioteca e os leitores divergem na linha incompleta
  // (3ª revisão do QA): a biblioteca devolve zeros e o leitor desenha o texto. Fora de imagem, qualquer preditor é recusado.
  if (!opcoes.imagem) {
    const parms = stream.get("DecodeParms");
    const lista = parms instanceof PdfArray ? parms.toArray() : parms ? [parms] : [];
    for (const item of lista) if (item instanceof PdfDict && item.has("Predictor") && item.getNumber("Predictor")?.value !== 1) throw new Error("preditor em fluxo de conteúdo");
  }
  const direto = (v: unknown, aceito: (x: unknown) => boolean) => v === undefined || v === null || aceito(v) || (v instanceof PdfArray && v.toArray().every(aceito));
  const tipo = (x: unknown) => (x as { type?: string } | null)?.type;
  if (!direto(stream.get("Filter"), x => tipo(x) === "name")) throw new Error("filtro indireto");
  if (!direto(stream.get("DecodeParms"), x => tipo(x) === "dict" || tipo(x) === "null")) throw new Error("parâmetros de filtro indiretos");
  for (const k of ["F", "FFilter", "FDecodeParms"]) if (stream.has(k)) throw new Error("fluxo em arquivo externo");
  const dados = stream.getDecodedData();
  if (!dados.length && stream.has("Filter") && stream.data.length > 0) throw new Error("fluxo ilegível");
  return dados;
}

function fluxos(pdf: PDF, pagina: Pagina): string[] | null {
  const bruto = pagina.dict.get("Contents");
  const itens = bruto instanceof PdfArray ? bruto.toArray() : bruto ? [bruto] : [];
  const out: string[] = [];
  for (const item of itens) {
    const obj = item instanceof PdfRef ? pdf.getObject(item) : item;
    if (!(obj instanceof PdfStream)) return null;
    out.push(Buffer.from(decodificarEstrito(obj)).toString("latin1"));
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

/** Nomes das fontes que entraram nos recursos da página (existem em `pb` e não em `pa`). */
function fontesNovas(a: PDF, pa: Pagina, b: PDF, pb: Pagina): { nome: string; fonte: PdfDict | null }[] {
  const lista = (pdf: PDF, pg: Pagina) => {
    const r = dict(pdf, pg.dict.get("Resources")), f = r && r.has("Font") ? dict(pdf, r.get("Font")) : null;
    return f ? Array.from(f as unknown as Iterable<[unknown, unknown]>).map(([k, v]) => ({ nome: chave(k), fonte: dict(pdf, v) })) : [];
  };
  const antigas = new Set(lista(a, pa).map(f => f.nome));
  return lista(b, pb).filter(f => !antigas.has(f.nome));
}
/** Só a fonte que o assinador usa: Helvetica padrão, sem arquivo, larguras, ToUnicode ou codificação fora do comum. */
function fonteDaMarca(pdf: PDF, fonte: PdfDict | null): boolean {
  if (!fonte) return false;
  const encoding = fonte.get("Encoding");
  return fonte.getName("Subtype")?.value === "Type1" && fonte.getName("BaseFont")?.value === "Helvetica"
    && !fonte.has("FontDescriptor") && !fonte.has("Widths") && !fonte.has("ToUnicode")
    && (!encoding || ["WinAnsiEncoding", "StandardEncoding"].includes(fonte.getName("Encoding")?.value || ""));
}
const nomeDecodificado = (bruto: string) => bruto.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
/**
 * Portão de QA de 23/11/2026 (achados 1 a 3): "referência adormecida". O documento de ORIGEM não pode citar, em nenhum
 * fluxo alcançável a partir da página (conteúdo, Form XObjects, padrões, CharProcs de Type3, aparências de anotações), o
 * nome de uma fonte que só passa a existir depois da assinatura — senão um texto invisível na origem aparece no assinado.
 * Conservador de propósito: procura o nome (com `#xx` decodificado) em qualquer lugar do fluxo, inclusive dentro de
 * strings, e também na emenda entre fluxos do mesmo conteúdo. Imagens ficam de fora (não são fluxo de conteúdo).
 */
export function origemCitaNome(pdf: PDF, pagina: Pagina, nomes: string[]): boolean {
  if (!nomes.length) return false;
  const alvo = new Set(nomes);
  const cita = (texto: string) => { for (const m of Array.from(texto.matchAll(/\/([^\s\0/[\]()<>{}%]*)/g))) if (alvo.has(nomeDecodificado(m[1]))) return true; return false; };
  const vistos = new Set<unknown>();
  let visitados = 0;
  // `podeSerImagem`: só o valor direto de um dicionário /XObject (o que o operador Do chama) pode ser pulado como imagem.
  // Aparência de anotação, padrão, CharProc e conteúdo são executados como conteúdo pelo leitor, diga o /Subtype o que disser.
  const andar = (valor: unknown, podeSerImagem = false): boolean => {
    const obj = valor instanceof PdfRef ? pdf.getObject(valor) : valor;
    if (!obj || typeof obj !== "object") return false;
    if (++visitados > 20_000) throw new Error("documento grande demais para conferir");
    if (obj instanceof PdfStream && podeSerImagem && (obj.get("Subtype") as { type?: string; value?: string } | undefined)?.type === "name" && obj.getName("Subtype")?.value === "Image") {
      // Imagem chamada por Do: os dados não são conteúdo. Máscaras e afins (dicionário da imagem) ainda são percorridos abaixo.
      for (const [k, v] of Array.from(obj as unknown as Iterable<[unknown, unknown]>)) if (["SMask", "Mask", "Alternates", "OPI"].includes(chave(k)) && andar(v, true)) return true;
      return false;
    }
    if (vistos.has(obj)) return false;
    vistos.add(obj);
    if (obj instanceof PdfArray) return obj.toArray().some(v => andar(v));
    if (obj instanceof PdfStream && cita(Buffer.from(decodificarEstrito(obj)).toString("latin1"))) return true;
    if (obj instanceof PdfDict) {
      for (const [k, v] of Array.from(obj as unknown as Iterable<[unknown, unknown]>)) {
        const nome = chave(k);
        if (nome === "Parent" || nome === "P") continue;
        if (nome === "XObject") {
          const xo = dict(pdf, v);
          if (xo) { for (const [, x] of Array.from(xo as unknown as Iterable<[unknown, unknown]>)) if (andar(x, true)) return true; continue; }
        }
        if (andar(v)) return true;
      }
    }
    return false;
  };
  const conteudo = fluxos(pdf, pagina);
  if (!conteudo) throw new Error("conteúdo ilegível");
  // Nome partido entre dois fluxos do mesmo conteúdo (leitores que emendam sem separador).
  if (cita(conteudo.join("")) || cita(conteudo.join("\n"))) return true;
  return andar(pagina.dict);
}

/**
 * Página que NÃO recebeu a marca, num PDF em que as páginas dividem o mesmo dicionário de recursos (jsPDF): desenhar a
 * marca numa página acrescenta a fonte padrão ao dicionário comum, e todas as outras "ganham" essa fonte sem mudar de
 * conteúdo. Aceito só isso: recursos antigos intactos, entrada nova = a Helvetica da marca, e nada na origem cita o nome
 * da fonte nova — fonte que ninguém usa não desenha nada.
 */
export function paginaSoGanhouFonteSemUso(a: PDF, pa: Pagina, b: PDF, pb: Pagina, serial: (pdf: PDF, v: unknown) => string): boolean {
  try {
    if (!recursosSoComFontePadrao(a, pa, b, pb, serial)) return false;
    const novas = fontesNovas(a, pa, b, pb);
    if (novas.some(f => !fonteDaMarca(b, f.fonte))) return false;
    return !origemCitaNome(a, pa, novas.map(f => f.nome));
  } catch { return false; }
}

/** Os fluxos acrescentados desenham só a marca: um retângulo de borda e texto do vocabulário da marca dentro dele. */
export function desenhoSoDaMarca(acrescentados: string[], titular: string, pagina: { x: number; y: number; width: number; height: number }, fontesPermitidas?: Set<string>): boolean {
  const pontos: [number, number][] = [], textos: { x: number; y: number; tamanho: number; texto: string }[] = [];
  let larguraLinha = 1, nivel = 0, emTexto = false, fonte = 12, entrelinha = 0, tx = 0, ty = 0, linhaX = 0, linhaY = 0, contornos = 0;
  const espessuras: number[] = [], estadoGrafico: number[] = [];
  const caminho: string[] = [];
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
        case "m": case "l": if (emTexto || nums.length !== 2 || nums.some(n => !Number.isFinite(n))) return false; caminho.push(op); pontos.push([nums[0], nums[1]]); break;
        case "re": if (emTexto || nums.length !== 4 || nums.some(n => !Number.isFinite(n))) return false; caminho.push(op); pontos.push([nums[0], nums[1]], [nums[0] + nums[2], nums[1] + nums[3]]); break;
        case "h": if (emTexto || args.length) return false; caminho.push(op); break;
        case "S": if (emTexto || args.length) return false; contornos++; espessuras.push(larguraLinha); break;
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
          if (textos.length >= 48) return false;
          textos.push({ x: tx, y: ty, tamanho: fonte, texto });
          break;
        }
        default: break; // cores
      }
    }
    if (pilha.length) return false;
  }
  if (nivel !== 0 || emTexto || contornos !== 1 || pontos.length < 2 || !textos.length) return false;
  // Só o perímetro de um retângulo, sem subcaminhos ou segmentos interiores.
  const formato = caminho.join(" ");
  if (formato !== "re" && formato !== "m l l l h") return false;
  if (formato === "m l l l h") {
    const [a, b, c, d] = pontos;
    if (!a || !b || !c || !d || pontos.length !== 4) return false;
    const horizontal = (p: number[], q: number[]) => p[1] === q[1] && p[0] !== q[0];
    const vertical = (p: number[], q: number[]) => p[0] === q[0] && p[1] !== q[1];
    if (!(horizontal(a, b) && vertical(b, c) && horizontal(c, d) && vertical(d, a))
      && !(vertical(a, b) && horizontal(b, c) && vertical(c, d) && horizontal(d, a))) return false;
  }
  void entrelinha;
  const xs = pontos.map(p => p[0]), ys = pontos.map(p => p[1]);
  const caixa = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  const lado = Math.min(caixa.x1 - caixa.x0, caixa.y1 - caixa.y0);
  if (!(lado > 0) || espessuras.some(espessura => espessura > Math.max(0.6, lado * 0.02))) return false;
  // A caixa fica dentro da página e ocupa no máximo 30% dela.
  if (caixa.x0 < pagina.x - TOLERANCIA || caixa.y0 < pagina.y - TOLERANCIA || caixa.x1 > pagina.x + pagina.width + TOLERANCIA || caixa.y1 > pagina.y + pagina.height + TOLERANCIA) return false;
  if ((caixa.x1 - caixa.x0) * (caixa.y1 - caixa.y0) > 0.3 * pagina.width * pagina.height) return false;
  // A data é só uma informação visual. Aceite apenas o formato produzido pelo assinador,
  // mesmo quando a quebra de linha separar a data e a hora.
  const fim = textos.map(t => t.texto).join("").replace(/\s/g, "");
  const dataTexto = /(\d{2})\/(\d{2})\/(\d{4}),(\d{2}):(\d{2}):(\d{2})$/.exec(fim);
  if (!dataTexto) return false;
  const [, dia, mes, ano, hora, minuto, segundo] = dataTexto;
  const data = new Date(`${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo}-03:00`);
  if (!Number.isFinite(data.getTime()) || dataDaMarca(data) !== `${dia}/${mes}/${ano}, ${hora}:${minuto}:${segundo}`) return false;
  const documento = /(?:^|:)\s*(\d{14}|\d{11})\s*$/.exec(titular)?.[1] || "";
  const esperado = layoutDaMarca(caixa.x1 - caixa.x0, caixa.y1 - caixa.y0, linhasDaMarca(titular, documento, data));
  // A biblioteca serializa coordenadas com precisão finita. Compare com margem abaixo de um centésimo de ponto.
  const perto = (a: number, b: number) => Math.abs(a - b) < 0.005;
  if (textos.length !== esperado.linhas.length || !perto(espessuras[0], esperado.borda)) return false;
  return textos.every((t, i) => {
    const linha = esperado.linhas[i];
    return t.texto === linha.texto && perto(t.x, caixa.x0 + linha.x)
      && perto(t.y, caixa.y1 - linha.base) && perto(t.tamanho, esperado.fonte);
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
    // A origem não pode já citar a fonte que a marca traz (texto escondido que apareceria depois de assinar).
    if (origemCitaNome(a, pa, fontesNovas(a, pa, b, pb).map(f => f.nome))) return false;
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
