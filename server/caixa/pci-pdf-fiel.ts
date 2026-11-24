/**
 * PDF "fiel" da PCI: a aba Proposta_Constr_Individual desenhada como sai impressa pelo Excel/LibreOffice.
 *
 * Pedido do dono em 24/11/2026: o PDF de antes (tabelas simples) saiu "todo errado"; o PDF tem de sair
 * IDÊNTICO à planilha — mesmas células, mesmos lugares, cores, bordas, fontes, logotipo e foto, com os
 * valores calculados. O servidor (Vercel) não tem Excel nem LibreOffice, então o desenho é feito aqui,
 * lendo do próprio .xls gerado: área de impressão, linhas de título repetidas, quebras de página,
 * ajuste à largura, larguras/alturas, linhas ocultas, mesclas, estilos (XF/FONT/PALETTE), formatos
 * numéricos, cabeçalho/rodapé e desenhos. As fórmulas são recalculadas (biff8-formulas.ts); se uma
 * não puder ser calculada, usa-se o valor gravado e um aviso volta para quem chamou.
 *
 * Formatação condicional é ignorada de propósito (alguns leitores escondem valores com ela; no Excel
 * os valores aparecem) e listas suspensas mostram só o valor.
 */
import { jsPDF } from "jspdf";
import { AvaliadorBiff8 } from "./biff8-formulas.js";
import { chaveCelula, ErroXls, letrasDaColuna, PlanilhaBiff8, type AbaXls, type BordaXls, type CelulaXls, type DesenhoXls, type EstiloXf, type FormatacaoCondicional, type FonteXls, type ValorBruto } from "./biff8-planilha.js";
import { formatarValorXls, type TextoFormatado } from "./formato-numero-xls.js";

export const ABA_PCI = "Proposta_Constr_Individual";

/** Área de impressão do modelo oficial (usada se o arquivo não tiver a área gravada). */
const AREA_PADRAO = { r1: 33, c1: 5, r2: 265, c2: 48 };

export interface OpcoesPdfFiel {
  aba?: string;
  /** Data usada por HOJE()/AGORA() (padrão: agora). */
  hoje?: Date;
  /** Comprimir os fluxos do PDF (padrão: sim). Os testes usam `false` para ler o conteúdo. */
  comprimir?: boolean;
}

/** Texto desenhado (para conferência e testes). Coordenadas em pontos, a partir do canto superior esquerdo. */
export interface TextoDesenhado {
  pagina: number;
  texto: string;
  x: number;
  y: number;
  /** Endereço da célula ("AC73"), ou "cabeçalho"/"rodapé". */
  celula: string;
}

export interface ResultadoPdfFiel {
  bytes: Uint8Array;
  paginas: number;
  avisos: string[];
  textos: TextoDesenhado[];
  /** Valores exibidos das fórmulas da área de impressão (endereço → valor recalculado). */
  formulas: Map<string, ValorBruto>;
}

interface Intervalo {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

interface Faixa {
  /** Primeira e última linha (inclusive) da faixa. */
  r1: number;
  r2: number;
  /** Topo da faixa na página (pt). */
  y: number;
  altura: number;
}

interface Pagina {
  faixas: Faixa[];
}

const ERROS_PT: Record<string, string> = {
  "#N/A": "#N/D",
  "#VALUE!": "#VALOR!",
  "#REF!": "#REF!",
  "#NAME?": "#NOME?",
  "#NUM!": "#NÚM!",
  "#NULL!": "#NULO!",
  "#DIV/0!": "#DIV/0!",
};

/** Caracteres fora do Latin-1 que as fontes padrão do PDF (WinAnsi) têm em outra posição. */
const WINANSI: Record<string, string> = {
  "€": "\x80", "‚": "\x82", "ƒ": "\x83", "„": "\x84", "…": "\x85", "†": "\x86", "‡": "\x87", "ˆ": "\x88", "‰": "\x89",
  "Š": "\x8a", "‹": "\x8b", "Œ": "\x8c", "Ž": "\x8e", "‘": "\x91", "’": "\x92", "“": "\x93", "”": "\x94", "•": "\x95",
  "–": "\x96", "—": "\x97", "˜": "\x98", "™": "\x99", "š": "\x9a", "›": "\x9b", "œ": "\x9c", "ž": "\x9e", "Ÿ": "\x9f",
};
const TROCAS: Record<string, string> = { "≥": ">=", "≤": "<=", "≠": "<>", "→": "->", "←": "<-", "✓": "v", "✔": "v", " ": " ", " ": " ", " ": " ", "​": "" };

function paraWinAnsi(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 256 && cp !== 0xa0) out += cp < 32 && ch !== "\n" ? " " : ch;
    else if (WINANSI[ch]) out += WINANSI[ch];
    else if (TROCAS[ch] !== undefined) out += TROCAS[ch];
    else out += ch.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x00-\xff]/g, "?");
  }
  return out;
}

/** Peso de cada estilo de borda: na mesma aresta vale a mais forte. */
const PESO_BORDA: Record<number, number> = { 0: 0, 7: 1, 4: 2, 11: 3, 9: 3, 3: 3, 1: 4, 13: 5, 12: 5, 10: 5, 8: 5, 2: 6, 5: 7, 6: 8 };

interface Aresta {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  borda: BordaXls;
}

interface Trecho {
  texto: string;
  fonte: FonteXls;
}

/** Medidas da grade da aba, em pontos (sem escala). */
class Grade {
  readonly larguras: number[] = [];
  readonly alturas: number[] = [];
  /** Largura do algarismo "0" da fonte padrão da pasta (Arial/Helvetica: 0,556 do corpo). */
  private digito: number;
  constructor(private aba: AbaXls, tamanhoFontePadrao: number) {
    this.digito = 0.556 * (tamanhoFontePadrao || 10);
    for (let c = 0; c < 256; c++) this.larguras.push(this.calcLargura(c));
  }
  private calcLargura(c: number): number {
    if (this.aba.colunasOcultas.has(c)) return 0;
    const w = this.aba.larguras.get(c);
    // COLINFO: largura em 1/256 do algarismo "0" da fonte padrão (mesma conversão do LibreOffice)
    if (w !== undefined) return (w / 256) * this.digito;
    return this.aba.larguraPadrao * this.digito + 3.75;
  }
  altura(r: number): number {
    let h = this.alturas[r];
    if (h !== undefined) return h;
    if (this.aba.linhasOcultas.has(r)) h = 0;
    else h = this.aba.alturas.get(r) ?? (this.aba.ocultaPorPadrao ? 0 : this.aba.alturaPadrao);
    this.alturas[r] = h;
    return h;
  }
  largura(c: number) {
    return this.larguras[c] ?? 0;
  }
}

/** Lê a área de impressão e as linhas de título dos nomes internos da pasta. */
function areaETitulos(p: PlanilhaBiff8, aba: AbaXls, av: AvaliadorBiff8): { area: Intervalo; titulos: { r1: number; r2: number } | null; avisos: string[] } {
  const avisos: string[] = [];
  let area: Intervalo | null = null;
  let titulos: { r1: number; r2: number } | null = null;
  for (const n of p.nomes) {
    if (n.escopo !== aba.indice + 1 || (n.interno !== 6 && n.interno !== 7)) continue;
    let arv;
    try {
      arv = av.montar(n.formula, aba.indice, null);
    } catch {
      continue;
    }
    const areas: Intervalo[] = [];
    const coletar = (no: unknown) => {
      const x = no as { k: string; r1?: number; c1?: number; r2?: number; c2?: number; r?: number; c?: number; a?: unknown; b?: unknown };
      if (!x) return;
      if (x.k === "area") areas.push({ r1: x.r1!, c1: x.c1!, r2: x.r2!, c2: x.c2! });
      else if (x.k === "ref") areas.push({ r1: x.r!, c1: x.c!, r2: x.r!, c2: x.c! });
      else if (x.k === "op") {
        coletar(x.a);
        coletar(x.b);
      }
    };
    coletar(arv);
    if (n.interno === 6 && areas[0]) area = areas[0];
    if (n.interno === 7) {
      const linhas = areas.find((a) => a.c1 === 0 && a.c2 >= 255);
      if (linhas) titulos = { r1: linhas.r1, r2: linhas.r2 };
    }
  }
  if (!area) {
    avisos.push("A planilha não tem área de impressão gravada; foi usada a área padrão do modelo (F34:AW266).");
    area = AREA_PADRAO;
  }
  return { area, titulos, avisos };
}

/** Divide o cabeçalho/rodapé do Excel ("&L…&C…&R…") em seções com linhas de trechos formatados. */
interface TrechoCab {
  texto: string;
  tamanho: number;
  negrito: boolean;
  italico: boolean;
}
function lerCabecalho(fonte: string, ctx: { pagina: number; total: number; aba: string; data: Date }): Record<"L" | "C" | "R", TrechoCab[][]> {
  const secoes: Record<"L" | "C" | "R", TrechoCab[][]> = { L: [[]], C: [[]], R: [[]] };
  let atual: "L" | "C" | "R" = "C";
  let tamanho = 10;
  let negrito = false;
  let italico = false;
  let buf = "";
  const descarrega = () => {
    if (buf) secoes[atual][secoes[atual].length - 1].push({ texto: buf, tamanho, negrito, italico });
    buf = "";
  };
  for (let i = 0; i < fonte.length; i++) {
    const ch = fonte[i];
    if (ch === "\n") {
      descarrega();
      secoes[atual].push([]);
      continue;
    }
    if (ch !== "&") {
      buf += ch;
      continue;
    }
    const cod = fonte[i + 1];
    if (cod === undefined) break;
    if (cod === "&") {
      buf += "&";
      i++;
      continue;
    }
    if (/\d/.test(cod)) {
      descarrega();
      let j = i + 1;
      let num = "";
      while (j < fonte.length && /\d/.test(fonte[j]) && num.length < 3) num += fonte[j++];
      tamanho = Number(num) || tamanho;
      i = j - 1;
      continue;
    }
    if (cod === '"') {
      descarrega();
      const fim = fonte.indexOf('"', i + 2);
      const def = fonte.slice(i + 2, fim < 0 ? fonte.length : fim).toLowerCase();
      negrito = /bold|negrito/.test(def);
      italico = /italic|itálico|oblique/.test(def);
      i = fim < 0 ? fonte.length : fim;
      continue;
    }
    i++;
    switch (cod.toUpperCase()) {
      case "L":
      case "C":
      case "R":
        descarrega();
        atual = cod.toUpperCase() as "L" | "C" | "R";
        tamanho = 10;
        negrito = false;
        italico = false;
        break;
      case "P":
        buf += String(ctx.pagina);
        break;
      case "N":
        buf += String(ctx.total);
        break;
      case "A":
        buf += ctx.aba;
        break;
      case "D":
        buf += ctx.data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
        break;
      case "T":
        buf += ctx.data.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
        break;
      case "B":
        descarrega();
        negrito = !negrito;
        break;
      case "I":
        descarrega();
        italico = !italico;
        break;
      case "K":
        i += 6; // cor
        break;
      default:
        break; // sublinhado, tachado, imagem, nome do arquivo: ignorados
    }
  }
  descarrega();
  return secoes;
}

function nomeFontePdf(f: { nome: string }): string {
  if (/times|serif|roman|georgia|garamond|cambria/i.test(f.nome) && !/sans/i.test(f.nome)) return "times";
  if (/courier|mono|consolas/i.test(f.nome)) return "courier";
  return "helvetica";
}
function estiloFontePdf(f: { negrito: boolean; italico: boolean }): string {
  return f.negrito && f.italico ? "bolditalic" : f.negrito ? "bold" : f.italico ? "italic" : "normal";
}

function luminancia(cor: string): number {
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(cor.slice(k, k + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function misturar(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((k) => parseInt(a.slice(k, k + 2), 16));
  const pb = [1, 3, 5].map((k) => parseInt(b.slice(k, k + 2), 16));
  return `#${pa.map((x, k) => Math.round(x * t + pb[k] * (1 - t)).toString(16).padStart(2, "0")).join("")}`;
}

/** Densidade aproximada de cada padrão de preenchimento do Excel (fração da cor da frente). */
const DENSIDADE: Record<number, number> = { 1: 1, 2: 0.5, 3: 0.75, 4: 0.25, 5: 0.5, 6: 0.5, 7: 0.5, 8: 0.5, 9: 0.5, 10: 0.5, 11: 0.25, 12: 0.25, 13: 0.25, 14: 0.25, 15: 0.25, 16: 0.25, 17: 0.125, 18: 0.0625 };

class Desenhista {
  readonly avisos: string[] = [];
  readonly textos: TextoDesenhado[] = [];
  readonly formulas = new Map<string, ValorBruto>();
  private pdf: jsPDF;
  private grade: Grade;
  private av: AvaliadorBiff8;
  private mescla = new Map<number, Intervalo>();
  private exibicao = new Map<number, { valor: ValorBruto; formatado: TextoFormatado } | null>();
  private escala = 1;
  private x0 = 0;
  private colX: number[] = [];
  private paginaAtual = 0;
  private aliasImagem = new Map<DesenhoXls, string>();
  private condicionais: Map<number, FormatacaoCondicional[]> | null = null;
  private fundos = new Map<number, string | null>();
  /** Fundo da célula cujo texto está sendo escrito (para a cor automática da fonte). */
  private fundoTexto: string | null = null;
  private larguraPagina: number;
  private alturaPagina: number;

  constructor(
    private p: PlanilhaBiff8,
    private aba: AbaXls,
    private area: Intervalo,
    private titulos: { r1: number; r2: number } | null,
    private opcoes: OpcoesPdfFiel,
  ) {
    this.pdf = new jsPDF({ unit: "pt", format: "a4", orientation: aba.retrato ? "portrait" : "landscape", compress: opcoes.comprimir !== false });
    this.larguraPagina = this.pdf.internal.pageSize.getWidth();
    this.alturaPagina = this.pdf.internal.pageSize.getHeight();
    this.grade = new Grade(aba, p.fonte(0).tamanho);
    this.av = new AvaliadorBiff8(p);
    if (opcoes.hoje) this.av.hoje = opcoes.hoje;
    for (const m of aba.mesclas) {
      for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) this.mescla.set(chaveCelula(r, c), m);
    }
  }

  // ─── valores ──────────────────────────────────────────────────────────────

  private celula(r: number, c: number): CelulaXls | undefined {
    return this.aba.celulas.get(chaveCelula(r, c));
  }

  private xf(r: number, c: number): EstiloXf | null {
    const cel = this.celula(r, c);
    if (cel) return this.p.xfs[cel.xf] ?? null;
    return null;
  }

  /** Valor e texto exibido da célula (fórmulas recalculadas). */
  private exibido(r: number, c: number): { valor: ValorBruto; formatado: TextoFormatado } | null {
    const k = chaveCelula(r, c);
    if (this.exibicao.has(k)) return this.exibicao.get(k)!;
    const cel = this.celula(r, c);
    let res: { valor: ValorBruto; formatado: TextoFormatado } | null = null;
    if (cel) {
      let valor = cel.valor;
      if (cel.formula) {
        const rr = this.av.resultado(this.aba, r, c);
        valor = rr.valor;
        if (rr.cache) this.avisos.push(`${letrasDaColuna(c)}${r + 1}: fórmula não recalculada (${rr.motivo}); foi usado o valor gravado no arquivo.`);
        this.formulas.set(`${letrasDaColuna(c)}${r + 1}`, valor);
      }
      if (valor !== null) {
        const xf = this.p.xfs[cel.xf];
        let formatado: TextoFormatado;
        if (valor instanceof ErroXls) formatado = { texto: ERROS_PT[valor.codigo] ?? valor.codigo };
        else {
          try {
            formatado = formatarValorXls(valor, this.p.formato(xf?.formato ?? 0));
          } catch {
            formatado = { texto: String(valor) };
          }
        }
        res = { valor, formatado };
      }
    }
    this.exibicao.set(k, res);
    return res;
  }

  /** Célula vazia (para o texto da vizinha transbordar). Fórmula com "" não é vazia, como no Excel. */
  private vazia(r: number, c: number): boolean {
    if (this.mescla.has(chaveCelula(r, c))) return false;
    const cel = this.celula(r, c);
    if (!cel) return true;
    if (cel.formula) return false;
    return cel.valor === null || cel.valor === "";
  }

  // ─── paginação ────────────────────────────────────────────────────────────

  private paginar(): Pagina[] {
    const a = this.aba;
    const pol = 72;
    const mT = a.margens.cima * pol;
    const mB = a.margens.baixo * pol;
    const mL = a.margens.esquerda * pol;
    const mR = a.margens.direita * pol;
    const largUtil = this.larguraPagina - mL - mR;
    const altUtil = this.alturaPagina - mT - mB;
    let W = 0;
    this.colX = [];
    for (let c = this.area.c1; c <= this.area.c2 + 1; c++) {
      this.colX[c] = W;
      if (c <= this.area.c2) W += this.grade.largura(c);
    }
    let H = 0;
    for (let r = this.area.r1; r <= this.area.r2; r++) H += this.grade.altura(r);
    let s = (a.escala || 100) / 100;
    if (a.ajustarPagina) {
      s = 1;
      if (a.ajustarLargura > 0 && W > 0) s = Math.min(s, (largUtil * a.ajustarLargura) / W);
      if (a.ajustarAltura > 0 && H > 0) s = Math.min(s, (altUtil * a.ajustarAltura) / H);
    }
    if (W * s > largUtil + 0.5) this.avisos.push("A área de impressão é mais larga que a página; o excesso à direita foi cortado.");
    this.escala = s;
    this.x0 = mL + (a.centralizarH ? Math.max(0, (largUtil - W * s) / 2) : 0);
    const quebras = new Set(a.quebrasLinha);
    const titH = this.titulos ? this.alturaLinhas(this.titulos.r1, this.titulos.r2) * s : 0;
    const paginas: Pagina[] = [];
    let r = this.area.r1;
    while (r <= this.area.r2) {
      const faixas: Faixa[] = [];
      let y = mT;
      let usado = 0;
      if (paginas.length && this.titulos && this.titulos.r1 < r) {
        faixas.push({ r1: this.titulos.r1, r2: this.titulos.r2, y, altura: titH });
        y += titH;
        usado += titH;
      }
      const inicio = r;
      while (r <= this.area.r2) {
        const h = this.grade.altura(r) * s;
        if (r > inicio && (quebras.has(r) || usado + h > altUtil + 0.01)) break;
        usado += h;
        r++;
      }
      const altura = this.alturaLinhas(inicio, r - 1) * s;
      faixas.push({ r1: inicio, r2: r - 1, y, altura });
      // página só com linhas ocultas no fim da área: não vira página
      if (altura > 0 || !paginas.length) paginas.push({ faixas });
    }
    return paginas;
  }

  private alturaLinhas(r1: number, r2: number) {
    let h = 0;
    for (let r = r1; r <= r2; r++) h += this.grade.altura(r);
    return h;
  }

  // ─── coordenadas ──────────────────────────────────────────────────────────

  private X(c: number): number {
    return this.x0 + (this.colX[Math.max(this.area.c1, Math.min(this.area.c2 + 1, c))] ?? 0) * this.escala;
  }
  /** Topo da linha `r` dentro da faixa (pode cair fora da faixa). */
  private Y(f: Faixa, r: number): number {
    let y = f.y;
    if (r >= f.r1) for (let k = f.r1; k < r; k++) y += this.grade.altura(k) * this.escala;
    else for (let k = r; k < f.r1; k++) y -= this.grade.altura(k) * this.escala;
    return y;
  }

  // ─── desenho ──────────────────────────────────────────────────────────────

  gerar(): Uint8Array {
    const paginas = this.paginar();
    const total = paginas.length;
    const agora = this.opcoes.hoje ?? new Date();
    // todas as fórmulas das linhas visíveis da área (inclusive as que não aparecem por estarem vazias)
    for (const cel of Array.from(this.aba.celulas.values())) {
      if (!cel.formula || cel.linha < this.area.r1 || cel.linha > this.area.r2 || cel.coluna < this.area.c1 || cel.coluna > this.area.c2) continue;
      if (this.grade.altura(cel.linha) > 0 && this.grade.largura(cel.coluna) > 0) this.exibido(cel.linha, cel.coluna);
    }
    paginas.forEach((pag, i) => {
      if (i > 0) this.pdf.addPage("a4", this.aba.retrato ? "portrait" : "landscape");
      this.paginaAtual = i + 1;
      for (const f of pag.faixas) this.desenharFaixa(f);
      this.desenharCabecalho(this.aba.cabecalho, true, { pagina: i + 1, total, aba: this.aba.nome, data: agora });
      this.desenharCabecalho(this.aba.rodape, false, { pagina: i + 1, total, aba: this.aba.nome, data: agora });
    });
    return new Uint8Array(this.pdf.output("arraybuffer"));
  }

  get paginas() {
    return this.pdf.getNumberOfPages();
  }

  private clip(x: number, y: number, w: number, h: number) {
    this.pdf.rect(x, y, w, h, null as unknown as string);
    this.pdf.clip();
    this.pdf.discardPath();
  }

  private desenharFaixa(f: Faixa) {
    if (f.altura <= 0) return;
    const pdf = this.pdf;
    const larg = this.X(this.area.c2 + 1) - this.X(this.area.c1);
    pdf.saveGraphicsState();
    this.clip(this.X(this.area.c1), f.y, larg, f.altura);
    const linhas: number[] = [];
    for (let r = f.r1; r <= f.r2; r++) if (this.grade.altura(r) > 0) linhas.push(r);
    // mesclas que tocam a faixa (desenhadas como uma célula só)
    const mesclas = this.aba.mesclas.filter((m) => m.r2 >= f.r1 && m.r1 <= f.r2 && m.c2 >= this.area.c1 && m.c1 <= this.area.c2 && this.alturaLinhas(Math.max(m.r1, f.r1), Math.min(m.r2, f.r2)) > 0);
    // 1) preenchimentos
    for (const m of mesclas) this.preencher(m.r1, m.c1, this.X(m.c1), this.Y(f, m.r1), this.X(m.c2 + 1) - this.X(m.c1), this.Y(f, m.r2 + 1) - this.Y(f, m.r1));
    for (const r of linhas) {
      for (let c = this.area.c1; c <= this.area.c2; c++) {
        if (this.mescla.has(chaveCelula(r, c)) || this.grade.largura(c) === 0) continue;
        this.preencher(r, c, this.X(c), this.Y(f, r), this.X(c + 1) - this.X(c), this.grade.altura(r) * this.escala);
      }
    }
    // 2) desenhos que ficam atrás? (o Excel desenha imagens por cima de tudo) → depois do texto
    // 3) textos
    for (const m of mesclas) {
      this.texto(f, m.r1, m.c1, { x: this.X(m.c1), y: this.Y(f, m.r1), w: this.X(m.c2 + 1) - this.X(m.c1), h: this.Y(f, m.r2 + 1) - this.Y(f, m.r1) }, true);
    }
    for (const r of linhas) {
      for (let c = this.area.c1; c <= this.area.c2; c++) {
        if (this.mescla.has(chaveCelula(r, c)) || this.grade.largura(c) === 0) continue;
        this.texto(f, r, c, { x: this.X(c), y: this.Y(f, r), w: this.X(c + 1) - this.X(c), h: this.grade.altura(r) * this.escala }, false);
      }
    }
    // 4) bordas
    this.bordas(f, linhas);
    // 5) imagens e formas
    this.desenhos(f);
    pdf.restoreGraphicsState();
  }

  /**
   * Fundo vindo da formatação condicional (ex.: campo de digitação vazio fica lilás). Só o fundo é
   * usado; cor de fonte da formatação condicional é ignorada de propósito (há regras que escondem
   * valores pintando a fonte de branco).
   */
  private fundoCondicional(r: number, c: number): string | null {
    if (!this.condicionais) {
      this.condicionais = new Map();
      for (const fc of this.aba.condicionais) {
        if (!fc.regras.some((g) => g.preenchimento !== null)) continue;
        for (const a of fc.areas) {
          for (let rr = Math.max(a.r1, this.area.r1); rr <= Math.min(a.r2, this.area.r2); rr++) {
            for (let cc = Math.max(a.c1, this.area.c1); cc <= Math.min(a.c2, this.area.c2); cc++) {
              const k = chaveCelula(rr, cc);
              const lista = this.condicionais.get(k) ?? [];
              lista.push(fc);
              this.condicionais.set(k, lista);
            }
          }
        }
      }
    }
    for (const fc of this.condicionais.get(chaveCelula(r, c)) ?? []) {
      for (const regra of fc.regras) {
        if (regra.preenchimento === null) continue;
        if (this.av.condicao(this.aba, regra, fc.base, r, c)) return this.p.cor(regra.preenchimento, "#FFFFFF");
      }
    }
    return null;
  }

  /** Cor de fundo da célula (formatação condicional ou XF), ou null sem preenchimento. */
  private corDeFundo(r: number, c: number): string | null {
    const k = chaveCelula(r, c);
    if (this.fundos.has(k)) return this.fundos.get(k)!;
    let cor = this.fundoCondicional(r, c);
    if (!cor) {
      const xf = this.xf(r, c);
      if (xf && xf.padrao) {
        const frente = this.p.cor(xf.corFrente, "#000000");
        const fundo = this.p.cor(xf.corFundo, "#FFFFFF");
        const d = DENSIDADE[xf.padrao] ?? 0.5;
        cor = d >= 1 ? frente : misturar(frente, fundo, d);
      }
    }
    this.fundos.set(k, cor);
    return cor;
  }

  private preencher(r: number, c: number, x: number, y: number, w: number, h: number) {
    if (w <= 0 || h <= 0) return;
    const cor = this.corDeFundo(r, c);
    if (!cor) return;
    this.pdf.setFillColor(cor);
    // pequena sobra para não aparecer fresta entre células vizinhas
    this.pdf.rect(x, y, w + 0.05, h + 0.05, "F");
  }

  /** Trechos de texto da célula (texto rico do SST ou valor formatado com a fonte do XF). */
  private trechos(cel: CelulaXls, texto: string): Trecho[] {
    const xf = this.p.xfs[cel.xf];
    const base = this.p.fonte(xf?.fonte ?? 0);
    if (!cel.trechos || cel.formula || typeof cel.valor !== "string") return [{ texto, fonte: base }];
    const out: Trecho[] = [];
    let pos = 0;
    let fonte = base;
    for (const t of [...cel.trechos].sort((a, b) => a.inicio - b.inicio)) {
      if (t.inicio > pos) out.push({ texto: texto.slice(pos, t.inicio), fonte });
      pos = Math.max(pos, t.inicio);
      fonte = this.p.fonte(t.fonte);
    }
    if (pos < texto.length) out.push({ texto: texto.slice(pos), fonte });
    return out.filter((t) => t.texto.length);
  }

  private usarFonte(f: FonteXls, tamanho: number) {
    this.pdf.setFont(nomeFontePdf(f), estiloFontePdf(f));
    this.pdf.setFontSize(Math.max(1, tamanho));
  }

  private largura(t: string, f: FonteXls, tamanho: number) {
    this.usarFonte(f, tamanho);
    return this.pdf.getTextWidth(paraWinAnsi(t));
  }

  private texto(f: Faixa, r: number, c: number, caixa: { x: number; y: number; w: number; h: number }, mesclada: boolean) {
    const ex = this.exibido(r, c);
    if (!ex || ex.formatado.texto === "") return;
    const cel = this.celula(r, c)!;
    const xf = this.p.xfs[cel.xf];
    if (!xf) return;
    const s = this.escala;
    const pad = 1.5 * s;
    const fonteBase = this.p.fonte(xf.fonte);
    let alH = xf.alinhamentoH;
    const numero = typeof ex.valor === "number";
    if (alH === 0) alH = numero ? 3 : typeof ex.valor === "boolean" || ex.valor instanceof ErroXls ? 2 : 1;
    let { x, w } = caixa;
    const { y, h } = caixa;
    const texto = ex.formatado.texto.replace(/\r\n?/g, "\n");
    const quebra = xf.quebra || alH === 5 || xf.alinhamentoV === 3;
    let trechos = this.trechos(cel, texto);
    let tam = (t: Trecho) => t.fonte.tamanho * s;
    const recuo = xf.recuo * 7.5 * s;
    // centralizar na seleção: estende sobre vizinhas vazias com o mesmo alinhamento
    if (!mesclada && alH === 6) {
      let c2 = c;
      while (c2 + 1 <= this.area.c2 && this.vazia(r, c2 + 1) && this.xf(r, c2 + 1)?.alinhamentoH === 6) c2++;
      w = this.X(c2 + 1) - x;
      alH = 2;
    }
    if (alH === 6 || alH === 7) alH = 2;
    if (alH === 4) alH = 1;
    // linhas
    let linhas: Trecho[][];
    const larguraUtil = Math.max(1, w - 2 * pad - recuo);
    if (quebra) linhas = this.quebrar(trechos, larguraUtil, s);
    else linhas = this.separarLinhas(trechos);
    const larguraLinha = (l: Trecho[]) => l.reduce((acc, t) => acc + this.largura(t.texto, t.fonte, tam(t)), 0);
    let maior = Math.max(...linhas.map(larguraLinha));
    if (!quebra && xf.reduzir && maior > larguraUtil) {
      const fator = larguraUtil / maior;
      const tamOrig = tam;
      tam = (t: Trecho) => tamOrig(t) * fator;
      maior = larguraUtil;
    }
    // número que não cabe: ### (como o Excel)
    if (numero && !quebra && !mesclada && maior > w - pad && !ex.formatado.preenchimento) {
      const um = this.largura("#", fonteBase, fonteBase.tamanho * s);
      const n = Math.max(1, Math.floor((w - pad) / um));
      linhas = [[{ texto: "#".repeat(n), fonte: fonteBase }]];
      trechos = linhas[0];
      maior = n * um;
    }
    // transbordo para as vizinhas vazias (só texto sem quebra e célula não mesclada)
    let clipX = x;
    let clipW = w;
    if (!quebra && !mesclada && maior > w - 2 * pad && !numero) {
      let c1 = c;
      let c2 = c;
      const precisa = maior + 2 * pad;
      if (alH === 1) {
        while (this.X(c2 + 1) - x < precisa && c2 + 1 <= this.area.c2 && this.vazia(r, c2 + 1)) c2++;
      } else if (alH === 3) {
        while (x + w - this.X(c1) < precisa && c1 - 1 >= this.area.c1 && this.vazia(r, c1 - 1)) c1--;
      } else {
        let lado = 0;
        while (this.X(c2 + 1) - this.X(c1) < precisa && lado < 60) {
          const podeD = c2 + 1 <= this.area.c2 && this.vazia(r, c2 + 1);
          const podeE = c1 - 1 >= this.area.c1 && this.vazia(r, c1 - 1);
          if (!podeD || !podeE) break;
          c2++;
          c1--;
          lado++;
        }
      }
      clipX = this.X(c1);
      clipW = this.X(c2 + 1) - clipX;
    }
    // altura de linha ~1,15× o maior corpo da linha
    const alturaDe = (l: Trecho[]) => Math.max(...l.map((t) => tam(t))) * 1.15;
    const alturasL = linhas.map((l) => (l.length ? alturaDe(l) : fonteBase.tamanho * s * 1.15));
    const bloco = alturasL.reduce((a, b) => a + b, 0);
    let topo: number;
    if (xf.alinhamentoV === 0) topo = y + 0.5 * s;
    else if (xf.alinhamentoV === 1 || xf.alinhamentoV === 3 || xf.alinhamentoV === 4) topo = y + (h - bloco) / 2;
    else topo = y + h - bloco - 0.5 * s;
    const pdf = this.pdf;
    this.fundoTexto = this.corDeFundo(r, c);
    pdf.saveGraphicsState();
    // Texto com quebra de linha que não cabe na altura da célula/mescla: fica PRESO à célula (como na planilha), começando do topo —
    // nunca é desenhado por cima das seções seguintes (revisão do Codex no PR #338). Uma linha só mantém a folga de sempre.
    const estoura = linhas.length > 1 && bloco > h + 0.5;
    if (estoura) {
      topo = y + 0.5 * s;
      this.clip(clipX, y, clipW, h);
    } else this.clip(clipX, Math.min(y, topo) - 0.5, clipW, Math.max(h, bloco) + 1);
    let yy = topo;
    linhas.forEach((l, i) => {
      const lh = alturasL[i];
      const base = yy + lh * 0.8;
      yy += lh;
      if (!l.length) return;
      if (estoura && yy - lh >= y + h - 0.01) return; // linha inteira fora da célula: não desenha
      const lw = larguraLinha(l);
      // preenchimento ("* "): parte esquerda presa à esquerda, resto à direita
      if (ex.formatado.preenchimento && linhas.length === 1) {
        const esq = ex.formatado.preenchimento.esquerda;
        const dir = ex.formatado.preenchimento.direita;
        const fnt = l[0].fonte;
        if (esq.trim()) this.escrever(esq, fnt, tam(l[0]), x + pad, base, r, c);
        this.escrever(dir, fnt, tam(l[0]), x + w - pad - this.largura(dir, fnt, tam(l[0])), base, r, c);
        return;
      }
      let xx: number;
      if (alH === 3) xx = x + w - pad - lw - recuo;
      else if (alH === 2) xx = x + (w - lw) / 2;
      else xx = x + pad + recuo;
      for (const t of l) {
        this.escrever(t.texto, t.fonte, tam(t), xx, base, r, c);
        xx += this.largura(t.texto, t.fonte, tam(t));
      }
    });
    pdf.restoreGraphicsState();
  }

  private escrever(t: string, fonte: FonteXls, tamanho: number, x: number, base: number, r: number, c: number) {
    if (!t) return;
    this.usarFonte(fonte, tamanho);
    // cor automática: preta, ou branca sobre fundo escuro (como o LibreOffice imprime as faixas de título)
    const automatica = fonte.cor === 0x7fff || fonte.cor === 64;
    const cor = automatica ? (this.fundoTexto && luminancia(this.fundoTexto) < 0.45 ? "#FFFFFF" : "#000000") : this.p.cor(fonte.cor);
    this.pdf.setTextColor(cor);
    const txt = paraWinAnsi(t);
    this.pdf.text(txt, x, base, { baseline: "alphabetic" });
    if (fonte.sublinhado) {
      const w = this.pdf.getTextWidth(txt);
      this.pdf.setDrawColor(cor);
      this.pdf.setLineWidth(Math.max(0.3, tamanho * 0.05));
      this.pdf.line(x, base + tamanho * 0.12, x + w, base + tamanho * 0.12);
    }
    if (t.trim()) this.textos.push({ pagina: this.paginaAtual, texto: t, x, y: base, celula: `${letrasDaColuna(c)}${r + 1}` });
  }

  private separarLinhas(trechos: Trecho[]): Trecho[][] {
    const linhas: Trecho[][] = [[]];
    for (const t of trechos) {
      const partes = t.texto.split("\n");
      partes.forEach((parte, i) => {
        if (i > 0) linhas.push([]);
        if (parte) linhas[linhas.length - 1].push({ texto: parte, fonte: t.fonte });
      });
    }
    return linhas;
  }

  /** Quebra de linha por palavras, respeitando trechos de fontes diferentes. */
  private quebrar(trechos: Trecho[], largura: number, s: number): Trecho[][] {
    const linhas: Trecho[][] = [];
    for (const linha of this.separarLinhas(trechos)) {
      // palavras (com o espaço que as segue) de cada trecho
      const pedacos: Trecho[] = [];
      for (const t of linha) for (const p of t.texto.match(/[^ ]+ *| +/g) ?? []) pedacos.push({ texto: p, fonte: t.fonte });
      let atual: Trecho[] = [];
      let w = 0;
      const tam = (t: Trecho) => t.fonte.tamanho * s;
      for (const p of pedacos) {
        const pw = this.largura(p.texto.trimEnd(), p.fonte, tam(p));
        const pwEspaco = this.largura(p.texto, p.fonte, tam(p));
        if (atual.length && w + pw > largura) {
          linhas.push(atual);
          atual = [];
          w = 0;
        }
        // palavra maior que a linha: corta por caracteres
        if (!atual.length && pw > largura && p.texto.trim().length > 1) {
          let resto = p.texto;
          while (resto.length) {
            let n = resto.length;
            while (n > 1 && this.largura(resto.slice(0, n).trimEnd(), p.fonte, tam(p)) > largura) n--;
            const pedaco = resto.slice(0, n);
            resto = resto.slice(n);
            if (resto.length) linhas.push([{ texto: pedaco, fonte: p.fonte }]);
            else {
              atual = [{ texto: pedaco, fonte: p.fonte }];
              w = this.largura(pedaco, p.fonte, tam(p));
            }
          }
          continue;
        }
        atual.push(p);
        w += pwEspaco;
      }
      // tira espaços do fim de cada linha
      if (atual.length) linhas.push(atual);
      else if (!linha.length) linhas.push([]);
    }
    for (const l of linhas) {
      const ult = l[l.length - 1];
      if (ult) ult.texto = ult.texto.trimEnd();
    }
    return linhas.length ? linhas : [[]];
  }

  // ─── bordas ───────────────────────────────────────────────────────────────

  private bordas(f: Faixa, linhas: number[]) {
    const horiz = new Map<string, Aresta>();
    const vert = new Map<string, Aresta>();
    const poe = (mapa: Map<string, Aresta>, chave: string, a: Aresta) => {
      if (!a.borda.estilo) return;
      const atual = mapa.get(chave);
      if (!atual || (PESO_BORDA[a.borda.estilo] ?? 4) > (PESO_BORDA[atual.borda.estilo] ?? 4)) mapa.set(chave, a);
    };
    const s = this.escala;
    for (const r of linhas) {
      const y1 = this.Y(f, r);
      const y2 = y1 + this.grade.altura(r) * s;
      for (let c = this.area.c1; c <= this.area.c2; c++) {
        if (this.grade.largura(c) === 0) continue;
        const xf = this.xf(r, c);
        if (!xf) continue;
        const x1 = this.X(c);
        const x2 = this.X(c + 1);
        const m = this.mescla.get(chaveCelula(r, c));
        const kx1 = Math.round(x1 * 20);
        const kx2 = Math.round(x2 * 20);
        const ky1 = Math.round(y1 * 20);
        const ky2 = Math.round(y2 * 20);
        if (!m || r === m.r1 || !this.linhaVisivelEntre(m.r1, r)) poe(horiz, `${ky1}|${kx1}`, { x1, y1, x2, y2: y1, borda: xf.cima });
        if (!m || r === m.r2 || !this.linhaVisivelEntre(r + 1, m.r2 + 1)) poe(horiz, `${ky2}|${kx1}`, { x1, y1: y2, x2, y2, borda: xf.baixo });
        if (!m || c === m.c1) poe(vert, `${kx1}|${ky1}`, { x1, y1, x2: x1, y2, borda: xf.esquerda });
        if (!m || c === m.c2) poe(vert, `${kx2}|${ky1}`, { x1: x2, y1, x2, y2, borda: xf.direita });
      }
    }
    for (const a of Array.from(horiz.values()).concat(Array.from(vert.values()))) this.linha(a);
  }

  /** Há linha visível entre r1 (inclusive) e r2 (exclusive)? */
  private linhaVisivelEntre(r1: number, r2: number) {
    for (let r = r1; r < r2; r++) if (this.grade.altura(r) > 0) return true;
    return false;
  }

  private linha(a: Aresta) {
    const pdf = this.pdf;
    const est = a.borda.estilo;
    const cor = a.borda.cor === 64 || a.borda.cor === 0x7f ? "#000000" : this.p.cor(a.borda.cor);
    pdf.setDrawColor(cor);
    const larg: Record<number, number> = { 1: 0.5, 2: 1.25, 3: 0.5, 4: 0.5, 5: 2, 6: 0.4, 7: 0.25, 8: 1.25, 9: 0.5, 10: 1.25, 11: 0.5, 12: 1.25, 13: 1.25 };
    pdf.setLineWidth(larg[est] ?? 0.5);
    const tracos: Record<number, number[]> = { 3: [2, 1], 4: [0.5, 1], 8: [3, 1.5], 9: [3, 1, 1, 1], 10: [3, 1.5, 1, 1.5], 11: [3, 1, 1, 1, 1, 1], 12: [3, 1.5, 1, 1.5, 1, 1.5], 13: [3, 1, 1, 1] };
    pdf.setLineDashPattern(tracos[est] ?? [], 0);
    pdf.setLineCap(est === 4 ? "round" : "butt");
    if (est === 6) {
      const d = 0.6;
      if (a.y1 === a.y2) {
        pdf.line(a.x1, a.y1 - d, a.x2, a.y2 - d);
        pdf.line(a.x1, a.y1 + d, a.x2, a.y2 + d);
      } else {
        pdf.line(a.x1 - d, a.y1, a.x2 - d, a.y2);
        pdf.line(a.x1 + d, a.y1, a.x2 + d, a.y2);
      }
    } else {
      pdf.line(a.x1, a.y1, a.x2, a.y2);
    }
    pdf.setLineDashPattern([], 0);
    pdf.setLineCap("butt");
  }

  // ─── imagens e formas ─────────────────────────────────────────────────────

  private posicaoAncora(f: Faixa, col: number, dx: number, lin: number, dy: number) {
    const x = this.X(col) + (Math.min(dx, 1024) / 1024) * this.grade.largura(col) * this.escala;
    const y = this.Y(f, lin) + (Math.min(dy, 256) / 256) * this.grade.altura(lin) * this.escala;
    return { x, y };
  }

  private desenhos(f: Faixa) {
    for (const d of this.aba.desenhos) {
      if (!d.imprime) continue;
      if (d.linha2 < f.r1 || d.linha1 > f.r2 || d.coluna2 < this.area.c1 || d.coluna1 > this.area.c2) continue;
      const a = this.posicaoAncora(f, d.coluna1, d.dx1, d.linha1, d.dy1);
      const b = this.posicaoAncora(f, d.coluna2, d.dx2, d.linha2, d.dy2);
      const w = b.x - a.x;
      const h = b.y - a.y;
      if (w <= 0.5 || h <= 0.5) continue;
      if (d.tipo === "imagem") {
        const img = d.imagem;
        const onde = `${letrasDaColuna(d.coluna1)}${d.linha1 + 1}`;
        if (!img || img.tipo === "outro" || !img.dados.length) {
          this.avisoUnico(`Imagem em ${onde} em formato que o PDF não desenha; ficou de fora.`);
          continue;
        }
        try {
          let alias = this.aliasImagem.get(d);
          if (!alias) {
            alias = `img${this.aliasImagem.size + 1}`;
            this.aliasImagem.set(d, alias);
          }
          this.pdf.addImage(img.dados, img.tipo === "png" ? "PNG" : "JPEG", a.x, a.y, w, h, alias, "FAST");
        } catch {
          this.avisoUnico(`Imagem em ${onde} não pôde ser desenhada no PDF.`);
        }
      } else if (d.tipo === "retangulo" && d.preenchimento) {
        this.retangulo(a.x, a.y, w, h, d.rotacao, d.preenchimento);
      }
    }
  }

  private avisoUnico(msg: string) {
    if (!this.avisos.includes(msg)) this.avisos.push(msg);
  }

  /** Retângulo preenchido, girado em torno do centro (rotação do Excel: sentido horário). */
  private retangulo(x: number, y: number, w: number, h: number, rotacao: number, cor: string) {
    const graus = ((rotacao % 360) + 360) % 360;
    let ww = w;
    let hh = h;
    // entre 45° e 135° (e 225°–315°) a âncora guarda a caixa já girada de 90°
    if ((graus >= 45 && graus < 135) || (graus >= 225 && graus < 315)) {
      ww = h;
      hh = w;
    }
    const cx = x + w / 2;
    const cy = y + h / 2;
    const t = (graus * Math.PI) / 180;
    const pts = [
      [-ww / 2, -hh / 2],
      [ww / 2, -hh / 2],
      [ww / 2, hh / 2],
      [-ww / 2, hh / 2],
    ].map(([px, py]) => [cx + px * Math.cos(t) - py * Math.sin(t), cy + px * Math.sin(t) + py * Math.cos(t)]);
    this.pdf.setFillColor(cor);
    const rel: number[][] = [];
    for (let k = 1; k < pts.length; k++) rel.push([pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]]);
    this.pdf.lines(rel, pts[0][0], pts[0][1], [1, 1], "F", true);
  }

  // ─── cabeçalho e rodapé ──────────────────────────────────────────────────

  private desenharCabecalho(fonte: string, topo: boolean, ctx: { pagina: number; total: number; aba: string; data: Date }) {
    if (!fonte) return;
    const secoes = lerCabecalho(fonte, ctx);
    const pol = 72;
    const mL = this.aba.margens.esquerda * pol;
    const mR = this.aba.margens.direita * pol;
    const yRef = topo ? this.aba.margens.cabecalho * pol : this.alturaPagina - this.aba.margens.rodape * pol;
    for (const lado of ["L", "C", "R"] as const) {
      const linhas = secoes[lado].filter((l, i, arr) => l.length || i < arr.length - 1);
      if (!linhas.some((l) => l.length)) continue;
      const alturas = linhas.map((l) => Math.max(...(l.length ? l.map((t) => t.tamanho) : [10])) * 1.15);
      const total = alturas.reduce((a, b) => a + b, 0);
      let y = topo ? yRef : yRef - total;
      linhas.forEach((l, i) => {
        const lh = alturas[i];
        const base = y + lh * 0.8;
        y += lh;
        if (!l.length) return;
        const fontes = l.map((t) => ({ f: { nome: "Arial", negrito: t.negrito, italico: t.italico, tamanho: t.tamanho, sublinhado: false, tachado: false, cor: 0x7fff, posicao: 0 } as FonteXls, t }));
        const lw = fontes.reduce((acc, { f, t }) => acc + this.largura(t.texto, f, t.tamanho), 0);
        let x = lado === "L" ? mL : lado === "R" ? this.larguraPagina - mR - lw : (this.larguraPagina - lw) / 2;
        for (const { f, t } of fontes) {
          this.usarFonte(f, t.tamanho);
          this.pdf.setTextColor("#000000");
          this.pdf.text(paraWinAnsi(t.texto), x, base, { baseline: "alphabetic" });
          if (t.texto.trim()) this.textos.push({ pagina: this.paginaAtual, texto: t.texto, x, y: base, celula: topo ? "cabeçalho" : "rodapé" });
          x += this.largura(t.texto, f, t.tamanho);
        }
      });
    }
  }
}

/**
 * Gera o PDF da área de impressão da aba da PCI a partir dos bytes do .xls (o mesmo arquivo que o
 * usuário baixa). Não lança por causa de uma célula: o que não puder ser calculado ou desenhado vira
 * aviso. Lança só se o arquivo não puder ser lido.
 */
export function gerarPdfFielPci(xls: Uint8Array, opcoes: OpcoesPdfFiel = {}): ResultadoPdfFiel {
  const p = PlanilhaBiff8.abrir(xls);
  const aba = p.aba(opcoes.aba ?? ABA_PCI);
  const av = new AvaliadorBiff8(p);
  const { area, titulos, avisos } = areaETitulos(p, aba, av);
  const d = new Desenhista(p, aba, area, titulos, opcoes);
  const bytes = d.gerar();
  return { bytes, paginas: d.paginas, avisos: [...avisos, ...d.avisos], textos: d.textos, formulas: d.formulas };
}
