// Maquete 3D (EPIC-024, S-03) — tira de um PDF só o que a IA precisa ver de UMA página, sem mandar o arquivo
// inteiro. O caso real: PDF passado pelo iLovePDF que é uma única foto JPEG da prancha (7144 × 5012), sem linhas.
// O JPEG guardado no PDF (filtro DCTDecode) já é um arquivo JPEG pronto: é copiado como está, sem decodificar
// (nada de sharp/canvas no servidor). Sem biblioteca nova: um leitor mínimo de objetos PDF, com `node:zlib` para
// os fluxos de objetos (PDF 1.5+). PDF criptografado, imagem em outro formato (JPEG 2000, PNG comprimido) ou
// estrutura que este leitor não entende: devolve null e quem chama manda o PDF original com a instrução da página.
import { inflateSync } from "node:zlib";

type Ref = { ref: number };
/** Texto literal "(...)" e hexadecimal "<...>" ficam marcados (com os bytes como estão) para poderem ser reescritos. */
type Valor = number | string | boolean | null | Ref | Valor[] | Dic | { nome: string } | { texto: string } | { hex: string };
type Dic = { dic: Record<string, Valor> };

const ehRef = (v: unknown): v is Ref => !!v && typeof v === "object" && "ref" in v;
const ehDic = (v: unknown): v is Dic => !!v && typeof v === "object" && "dic" in v;
const ehNome = (v: unknown): v is { nome: string } => !!v && typeof v === "object" && "nome" in v;
const BRANCO = /[\0\t\n\f\r ]/;
const DELIM = /[()<>[\]{}/%\0\t\n\f\r ]/;

/** Lê um valor PDF a partir de `i` (dicionário, lista, nome, número, referência, texto). */
function lerValor(t: string, i: number): [Valor, number] {
  const pular = () => {
    for (;;) {
      while (i < t.length && BRANCO.test(t[i])) i++;
      if (t[i] === "%") { while (i < t.length && t[i] !== "\n" && t[i] !== "\r") i++; continue; }
      return;
    }
  };
  pular();
  const c = t[i];
  if (c === "<" && t[i + 1] === "<") {
    i += 2;
    const dic: Record<string, Valor> = {};
    for (;;) {
      pular();
      if (t[i] === ">" && t[i + 1] === ">") return [{ dic }, i + 2];
      if (i >= t.length) return [{ dic }, i];
      const [k, j] = lerValor(t, i);
      const [v, f] = lerValor(t, j);
      if (ehNome(k)) dic[k.nome] = v;
      i = f;
    }
  }
  if (c === "[") {
    i++;
    const lista: Valor[] = [];
    for (;;) {
      pular();
      if (t[i] === "]" || i >= t.length) return [lista, i + 1];
      const [v, j] = lerValor(t, i);
      lista.push(v);
      i = j;
      // "n g R" dentro da lista: junta em referência.
      if (lista.length >= 3 && lista[lista.length - 1] === "R" && typeof lista[lista.length - 2] === "number" && typeof lista[lista.length - 3] === "number") {
        lista.splice(lista.length - 3, 3, { ref: lista[lista.length - 3] as number });
      }
    }
  }
  if (c === "/") {
    let j = i + 1;
    while (j < t.length && !DELIM.test(t[j])) j++;
    return [{ nome: t.slice(i + 1, j).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) }, j];
  }
  if (c === "(") {
    let prof = 0, j = i;
    for (; j < t.length; j++) {
      if (t[j] === "\\") { j++; continue; }
      if (t[j] === "(") prof++;
      else if (t[j] === ")" && --prof === 0) break;
    }
    return [{ texto: t.slice(i + 1, j) }, j + 1];
  }
  if (c === "<") { const j = t.indexOf(">", i); return [{ hex: t.slice(i + 1, j) }, j + 1]; }
  let j = i;
  while (j < t.length && !DELIM.test(t[j])) j++;
  const palavra = t.slice(i, j);
  if (!palavra) return [null, i + 1];
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(palavra)) {
    // Referência "n g R" fora de lista.
    const m = /^\s+(\d+)\s+R(?=[()<>[\]{}/%\s]|$)/.exec(t.slice(j, j + 24));
    if (m && /^\d+$/.test(palavra)) return [{ ref: Number(palavra) }, j + m[0].length];
    return [Number(palavra), j];
  }
  if (palavra === "true" || palavra === "false") return [palavra === "true", j];
  if (palavra === "null") return [null, j];
  return [palavra, j];
}

type Objeto = { valor: Valor; fluxo: Buffer | null };

/** Índice dos objetos do arquivo: pelo texto "n g obj" (o último vence, como nas atualizações incrementais). */
class LeitorPdf {
  private texto: string;
  private posicoes = new Map<number, number>();
  private emFluxo = new Map<number, string>();
  private cache = new Map<number, Objeto | null>();
  constructor(private dados: Buffer) {
    this.texto = dados.toString("latin1");
    for (const m of Array.from(this.texto.matchAll(/(?:^|[\s>\]])(\d{1,7})\s+(\d{1,5})\s+obj\b/g))) this.posicoes.set(Number(m[1]), m.index! + m[0].length);
    // Fluxos de objetos (PDF 1.5+): os dicionários de página podem estar comprimidos dentro deles.
    for (const num of Array.from(this.posicoes.keys())) {
      const o = this.objetoDireto(num);
      if (!o?.fluxo || !ehDic(o.valor) || (o.valor.dic.Type as { nome?: string } | undefined)?.nome !== "ObjStm") continue;
      try {
        const bruto = this.decodificar(o.valor, o.fluxo)?.toString("latin1");
        if (!bruto) continue;
        const n = Number(this.resolver(o.valor.dic.N)), primeiro = Number(this.resolver(o.valor.dic.First));
        const cab = bruto.slice(0, primeiro).trim().split(/\s+/).map(Number);
        for (let k = 0; k < n; k++) {
          const numero = cab[2 * k], ini = primeiro + cab[2 * k + 1], fim = k + 1 < n ? primeiro + cab[2 * k + 3] : bruto.length;
          if (!this.emFluxo.has(numero)) this.emFluxo.set(numero, bruto.slice(ini, fim));
        }
      } catch { /* fluxo ilegível: segue sem ele */ }
    }
  }

  get criptografado() { return /\/Encrypt\s/.test(this.texto); }

  private objetoDireto(num: number): Objeto | null {
    const pos = this.posicoes.get(num);
    if (pos === undefined) return null;
    const [valor, fim] = lerValor(this.texto, pos);
    const resto = /^\s*stream(\r\n|\n|\r)/.exec(this.texto.slice(fim, fim + 16));
    if (!resto || !ehDic(valor)) return { valor, fluxo: null };
    const ini = fim + resto[0].length;
    let tam = this.resolverSemFluxo(valor.dic.Length);
    if (typeof tam !== "number" || ini + tam > this.dados.length) {
      const fimFluxo = this.texto.indexOf("endstream", ini);
      tam = fimFluxo < 0 ? 0 : fimFluxo - ini;
    }
    return { valor, fluxo: this.dados.subarray(ini, ini + tam) };
  }

  /** `Length` é quase sempre um número ou uma referência a um número fora de fluxo. */
  private resolverSemFluxo(v: Valor | undefined): Valor | undefined {
    if (!ehRef(v)) return v;
    const pos = this.posicoes.get(v.ref);
    return pos === undefined ? undefined : lerValor(this.texto, pos)[0];
  }

  objeto(num: number): Objeto | null {
    if (this.cache.has(num)) return this.cache.get(num)!;
    let o: Objeto | null = null;
    const comprimido = this.emFluxo.get(num);
    if (comprimido !== undefined && !this.posicoes.has(num)) o = { valor: lerValor(comprimido, 0)[0], fluxo: null };
    else o = this.objetoDireto(num) ?? (comprimido !== undefined ? { valor: lerValor(comprimido, 0)[0], fluxo: null } : null);
    this.cache.set(num, o);
    return o;
  }

  resolver(v: Valor | undefined, prof = 0): Valor | undefined {
    if (!ehRef(v) || prof > 8) return v;
    return this.resolver(this.objeto(v.ref)?.valor, prof + 1);
  }

  dic(v: Valor | undefined): Record<string, Valor> | null {
    const r = this.resolver(v);
    return ehDic(r) ? r.dic : null;
  }

  /** Só FlateDecode (o comum nos fluxos de objetos); outro filtro devolve null. */
  decodificar(d: Dic, fluxo: Buffer): Buffer | null {
    const f = filtros(this, d);
    if (!f.length) return fluxo;
    if (f.length === 1 && f[0] === "FlateDecode") return inflateSync(fluxo);
    return null;
  }

  raiz(): Record<string, Valor> | null {
    // Trailer clássico ou o dicionário do fluxo de referências cruzadas: o último /Root vence.
    const m = Array.from(this.texto.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)).pop();
    return m ? this.dic({ ref: Number(m[1]) }) : null;
  }

  /**
   * Páginas na ordem da árvore, com os recursos herdados do nó de cima. `ref`: o número do objeto da página (quando
   * ela é um objeto indireto); `herdados`: os atributos herdáveis (Resources, MediaBox, CropBox, Rotate) como estão
   * gravados no nó mais próximo que os define (para copiar a página sozinha num PDF novo).
   */
  paginas(): PaginaLida[] {
    const raiz = this.raiz(), saida: PaginaLida[] = [];
    const visitados = new Set<number>();
    const andar = (v: Valor | undefined, recursosAcima: Record<string, Valor> | null, herdadosAcima: Record<string, Valor>, prof: number) => {
      if (prof > 30 || saida.length > 2000) return;
      if (ehRef(v)) { if (visitados.has(v.ref)) return; visitados.add(v.ref); }
      const d = this.dic(v);
      if (!d) return;
      const recursos = this.dic(d.Resources) ?? recursosAcima;
      const herdados = { ...herdadosAcima };
      for (const k of HERDAVEIS) if (d[k] !== undefined) herdados[k] = d[k];
      const tipo = (d.Type as { nome?: string } | undefined)?.nome;
      if (tipo === "Pages" || Array.isArray(this.resolver(d.Kids))) {
        for (const k of (this.resolver(d.Kids) as Valor[]) ?? []) andar(k, recursos, herdados, prof + 1);
      } else saida.push({ dic: d, recursos, ref: ehRef(v) ? v.ref : null, herdados });
    };
    andar(raiz?.Pages, null, {}, 0);
    return saida;
  }
}

/** Atributos que a página herda do nó "Pages" de cima (PDF 1.7, 7.7.3.4). */
const HERDAVEIS = ["Resources", "MediaBox", "CropBox", "Rotate"] as const;
type PaginaLida = { dic: Record<string, Valor>; recursos: Record<string, Valor> | null; ref: number | null; herdados: Record<string, Valor> };

function filtros(l: LeitorPdf, d: Dic): string[] {
  const f = l.resolver(d.dic.Filter);
  const lista = Array.isArray(f) ? f : f ? [f] : [];
  return lista.map(x => l.resolver(x)).filter(ehNome).map(x => x.nome);
}

export type ImagemDaPagina = { jpeg: Buffer; largura: number; altura: number; componentes: number };

/** Lados de um JPEG pelo marcador SOF (confere que os bytes são mesmo um JPEG). */
export function ladosDoJpeg(b: Buffer): { largura: number; altura: number; componentes: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
    const tam = b.readUInt16BE(i + 2);
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
      return { altura: b.readUInt16BE(i + 5), largura: b.readUInt16BE(i + 7), componentes: b[i + 9] };
    }
    i += 2 + tam;
  }
  return null;
}

/**
 * O maior JPEG desenhado na página `pagina` (1 = primeira), procurando também dentro de formulários (XObject Form).
 * Null quando a página não tem JPEG, o PDF é criptografado ou a estrutura não pôde ser lida.
 */
export function jpegDaPagina(dados: Buffer, pagina: number): ImagemDaPagina | null {
  try {
    const l = new LeitorPdf(dados);
    if (l.criptografado) return null;
    const pg = l.paginas()[pagina - 1];
    if (!pg) return null;
    let melhor: ImagemDaPagina | null = null;
    const vistos = new Set<number>();
    const procurar = (recursos: Record<string, Valor> | null, prof: number) => {
      const xo = recursos ? l.dic(recursos.XObject) : null;
      if (!xo || prof > 4) return;
      for (const v of Object.values(xo)) {
        if (!ehRef(v) || vistos.has(v.ref)) continue;
        vistos.add(v.ref);
        const o = l.objeto(v.ref);
        if (!o || !ehDic(o.valor)) continue;
        const sub = (o.valor.dic.Subtype as { nome?: string } | undefined)?.nome;
        if (sub === "Form") { procurar(l.dic(o.valor.dic.Resources) ?? recursos, prof + 1); continue; }
        if (sub !== "Image" || !o.fluxo) continue;
        const f = filtros(l, o.valor);
        if (f[f.length - 1] !== "DCTDecode" || f.slice(0, -1).some(x => x !== "FlateDecode")) continue;
        const jpeg = f.length > 1 ? inflateSync(o.fluxo) : Buffer.from(o.fluxo);
        const lados = ladosDoJpeg(jpeg);
        if (!lados) continue;
        if (!melhor || lados.largura * lados.altura > melhor.largura * melhor.altura) melhor = { jpeg, ...lados };
      }
    };
    procurar(pg.recursos, 0);
    return melhor;
  } catch {
    return null;
  }
}

/** Monta um PDF de uma página só com o JPEG ocupando a página inteira (o JPEG não é recomprimido). */
export function pdfDeUmJpeg(img: ImagemDaPagina): Buffer {
  // Página com o maior lado em 1684 pt (A1 em pé ou deitado); a proporção é a da imagem.
  const k = 1684 / Math.max(img.largura, img.altura);
  const w = Math.max(1, Math.round(img.largura * k)), h = Math.max(1, Math.round(img.altura * k));
  const conteudo = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  const partes: Buffer[] = [];
  const offsets: number[] = [];
  let tam = 0;
  const por = (b: Buffer | string) => { const x = typeof b === "string" ? Buffer.from(b, "latin1") : b; partes.push(x); tam += x.length; };
  por("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const obj = (n: number, corpo: string, fluxo?: Buffer) => {
    offsets[n] = tam;
    if (fluxo) { por(`${n} 0 obj\n${corpo}\nstream\n`); por(fluxo); por("\nendstream\nendobj\n"); }
    else por(`${n} 0 obj\n${corpo}\nendobj\n`);
  };
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, `<< /Type /XObject /Subtype /Image /Width ${img.largura} /Height ${img.altura} /ColorSpace /${img.componentes === 1 ? "DeviceGray" : img.componentes === 4 ? "DeviceCMYK" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>`, img.jpeg);
  obj(5, `<< /Length ${conteudo.length} >>`, Buffer.from(conteudo, "latin1"));
  const xref = tam;
  por(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  por(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(partes);
}

// ── Uma página só (EPIC-027 C1): a prancha vetorial vai à IA sem o resto do arquivo ──

const numeroPdf = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/\.?0+$/, "") || "0");
const nomePdf = (s: string) => `/${Array.from(s).map(c => {
  const k = c.charCodeAt(0);
  return k < 0x21 || k > 0x7e || "#()<>[]{}/%".includes(c) ? `#${k.toString(16).padStart(2, "0")}` : c;
}).join("")}`;
/** Subtipos de anotação que não fazem parte do desenho (link, campo de formulário, balão): ficam fora da página copiada. */
const ANOTACOES_FORA = new Set(["Link", "Widget", "Popup"]);
/** Em anotações, chaves que apontam para outras páginas ou ações (puxariam o arquivo inteiro). */
const CHAVES_DE_ANOTACAO_FORA = ["P", "Dest", "A", "AA", "Popup", "IRT"];

export type PaginaExtraida = { pdf: Buffer } | { motivo: string };

/**
 * Copia a página `pagina` (1 = primeira) num PDF novo de uma página só: o dicionário da página (com os atributos
 * herdados), o conteúdo e tudo o que ele usa (fontes, imagens, formulários, camadas), com os fluxos copiados byte a
 * byte (sem recomprimir). Ficam de fora as outras páginas, a árvore de páginas, links e campos de formulário.
 * Sem biblioteca nova: o mesmo leitor mínimo de objetos de `jpegDaPagina`. PDF criptografado ou estrutura que este
 * leitor não entende: devolve o motivo, e quem chama manda o PDF original com a instrução da página.
 */
export function pdfDaPagina(dados: Buffer, pagina: number): PaginaExtraida {
  try {
    const l = new LeitorPdf(dados);
    if (l.criptografado) return { motivo: "o PDF é protegido (criptografado)" };
    const paginas = l.paginas();
    const pg = paginas[pagina - 1];
    if (!pg) return { motivo: `a página ${pagina} não foi encontrada na estrutura do arquivo (${paginas.length} página(s) lidas)` };
    const raiz = l.raiz();
    // Números novos: 1 catálogo, 2 árvore de páginas, 3 a página; o resto na ordem em que aparece.
    const novos = new Map<number, number>();
    const fila: number[] = [];
    if (pg.ref !== null) novos.set(pg.ref, 3);
    let proximo = 4;
    const ehPaginaOuArvore = (d: Record<string, Valor> | null) => {
      const tipo = (d?.Type as { nome?: string } | undefined)?.nome;
      return tipo === "Page" || tipo === "Pages";
    };
    const escrever = (v: Valor | undefined, prof = 0): string => {
      if (prof > 60) throw new Error("estrutura funda demais");
      if (v === undefined || v === null) return "null";
      if (typeof v === "number") return numeroPdf(v);
      if (typeof v === "boolean") return String(v);
      if (typeof v === "string") return v === "R" ? "null" : v;
      if (Array.isArray(v)) return `[${v.map(x => escrever(x, prof + 1)).join(" ")}]`;
      if (ehRef(v)) {
        const ja = novos.get(v.ref);
        if (ja) return `${ja} 0 R`;
        const o = l.objeto(v.ref);
        if (!o) return "null";
        // Outra página (ou a árvore delas): nunca entra, senão o arquivo inteiro viria junto.
        if (ehDic(o.valor) && ehPaginaOuArvore(o.valor.dic)) return "null";
        const n = proximo++;
        novos.set(v.ref, n);
        fila.push(v.ref);
        return `${n} 0 R`;
      }
      if (ehNome(v)) return nomePdf(v.nome);
      if ("texto" in v) return `(${v.texto})`;
      if ("hex" in v) return `<${v.hex}>`;
      if (ehDic(v)) return ehPaginaOuArvore(v.dic) ? "null" : escreverDic(v.dic, prof);
      return "null";
    };
    const escreverDic = (d: Record<string, Valor>, prof: number): string => {
      const anotacao = (d.Type as { nome?: string } | undefined)?.nome === "Annot" || (d.Rect !== undefined && d.Subtype !== undefined);
      const partes: string[] = [];
      for (const [k, x] of Object.entries(d)) {
        if (k === "Parent" && ehRef(x)) continue;
        if (anotacao && CHAVES_DE_ANOTACAO_FORA.includes(k)) continue;
        partes.push(`${nomePdf(k)} ${escrever(x, prof + 1)}`);
      }
      return `<<${partes.join(" ")}>>`;
    };

    // A página: o próprio dicionário, sem a ligação à árvore, com os atributos herdados e só as anotações do desenho.
    const dicPagina: Record<string, Valor> = { ...pg.herdados, ...pg.dic, Type: { nome: "Page" } };
    delete dicPagina.Parent;
    delete dicPagina.Thumb;
    delete dicPagina.B;
    const anotacoes = l.resolver(dicPagina.Annots);
    if (Array.isArray(anotacoes)) {
      const ficam = anotacoes.filter(a => !ANOTACOES_FORA.has(((l.dic(a)?.Subtype as { nome?: string } | undefined)?.nome) ?? ""));
      if (ficam.length) dicPagina.Annots = ficam; else delete dicPagina.Annots;
    } else delete dicPagina.Annots;
    const corpoPagina = escreverDic(dicPagina, 0).replace(/^<</, "<</Parent 2 0 R ");

    const ocProps = raiz?.OCProperties !== undefined ? escrever(raiz.OCProperties) : null;
    const corpos = new Map<number, { texto: string; fluxo?: Buffer }>();
    for (let i = 0; i < fila.length; i++) {
      if (fila.length > 20_000) return { motivo: "a página usa objetos demais" };
      const num = fila[i];
      const o = l.objeto(num)!;
      if (o.fluxo && ehDic(o.valor)) {
        const dic: Record<string, Valor> = { ...o.valor.dic, Length: o.fluxo.length };
        corpos.set(novos.get(num)!, { texto: escreverDic(dic, 0), fluxo: o.fluxo });
      } else corpos.set(novos.get(num)!, { texto: escrever(o.valor) });
    }

    const partes: Buffer[] = [];
    const offsets: number[] = [];
    let tam = 0;
    const por = (b: Buffer | string) => { const x = typeof b === "string" ? Buffer.from(b, "latin1") : b; partes.push(x); tam += x.length; };
    const obj = (n: number, corpo: string, fluxo?: Buffer) => {
      offsets[n] = tam;
      if (fluxo) { por(`${n} 0 obj\n${corpo}\nstream\n`); por(fluxo); por("\nendstream\nendobj\n"); }
      else por(`${n} 0 obj\n${corpo}\nendobj\n`);
    };
    por("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");
    obj(1, `<</Type /Catalog /Pages 2 0 R${ocProps ? ` /OCProperties ${ocProps}` : ""}>>`);
    obj(2, "<</Type /Pages /Kids [3 0 R] /Count 1>>");
    obj(3, corpoPagina);
    for (let n = 4; n < proximo; n++) {
      const c = corpos.get(n);
      obj(n, c?.texto ?? "null", c?.fluxo);
    }
    const xref = tam;
    por(`xref\n0 ${proximo}\n0000000000 65535 f \n${offsets.slice(1, proximo).map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
    por(`trailer\n<< /Size ${proximo} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return { pdf: Buffer.concat(partes) };
  } catch (e) {
    return { motivo: `a estrutura do PDF não pôde ser copiada (${e instanceof Error ? e.message.slice(0, 120) : "erro"})` };
  }
}
