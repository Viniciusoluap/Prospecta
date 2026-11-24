/**
 * Leitura completa (somente leitura) de uma pasta .xls (BIFF8) para desenhar a planilha
 * como ela sai impressa: valores e fórmulas (em tokens), fontes, estilos (XF), paleta,
 * formatos numéricos, larguras de coluna, alturas e linhas ocultas, mesclas, quebras de
 * página, cabeçalho/rodapé, margens e desenhos (imagens e formas simples).
 *
 * Pedido de 24/11/2026: o PDF da PCI tem de sair igual à planilha da CAIXA. O leitor de
 * `biff8.ts` (PastaBiff8) grava células sem perder nada do modelo, mas não lê estilos nem
 * fórmulas; este módulo reaproveita a separação de registros dele e lê o resto.
 */
import { PastaBiff8, R, type Registro } from "./biff8.js";

// ─── utilitários de bytes ────────────────────────────────────────────────────

function u16(d: Uint8Array, o: number) {
  return d[o] | (d[o + 1] << 8);
}
function i16(d: Uint8Array, o: number) {
  const v = u16(d, o);
  return v & 0x8000 ? v - 0x10000 : v;
}
function u32(d: Uint8Array, o: number) {
  return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16)) + d[o + 3] * 0x1000000;
}
function f64(d: Uint8Array, o: number) {
  return new DataView(d.buffer, d.byteOffset + o, 8).getFloat64(0, true);
}
function rkParaNumero(rk: number): number {
  const centesimos = (rk & 1) !== 0;
  let v: number;
  if (rk & 2) {
    v = (rk | 0) >> 2;
  } else {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setUint32(4, (rk & 0xfffffffc) >>> 0, true);
    v = f64(b, 0);
  }
  return centesimos ? v / 100 : v;
}

/** Texto curto (XLUnicodeString com contador de 16 bits) a partir de `o`. */
function textoU16(d: Uint8Array, o: number): { texto: string; fim: number } {
  const cch = u16(d, o);
  const largo = (d[o + 2] & 1) === 1;
  let s = "";
  let p = o + 3;
  for (let k = 0; k < cch && p < d.length; k++) {
    s += String.fromCharCode(largo ? u16(d, p) : d[p]);
    p += largo ? 2 : 1;
  }
  return { texto: s, fim: p };
}

/** Lê dados que atravessam registros CONTINUE (SST). */
class LeitorContinuo {
  private i = 0;
  private o: number;
  constructor(private partes: Uint8Array[], inicio: number) {
    this.o = inicio;
  }
  private garante() {
    while (this.i < this.partes.length && this.o >= this.partes[this.i].length) {
      this.i++;
      this.o = 0;
    }
  }
  fim() {
    this.garante();
    return this.i >= this.partes.length;
  }
  byte() {
    this.garante();
    return this.partes[this.i]?.[this.o++] ?? 0;
  }
  u16() {
    return this.byte() | (this.byte() << 8);
  }
  u32() {
    return this.u16() + this.u16() * 0x10000;
  }
  pula(n: number) {
    for (let k = 0; k < n; k++) this.byte();
  }
  caracteres(qtd: number, largo: boolean): string {
    let s = "";
    let wide = largo;
    for (let k = 0; k < qtd; k++) {
      this.garante();
      if (this.o === 0 && this.i > 0 && k > 0) wide = (this.byte() & 1) === 1;
      s += String.fromCharCode(wide ? this.u16() : this.byte());
    }
    return s;
  }
}

// ─── tipos públicos ──────────────────────────────────────────────────────────

/** Trecho de texto com fonte própria (texto rico do SST). `inicio` = posição do caractere. */
export interface TrechoRico {
  inicio: number;
  fonte: number;
}

export interface TextoXls {
  texto: string;
  trechos: TrechoRico[];
}

export class ErroXls {
  constructor(readonly codigo: string) {}
  toString() {
    return this.codigo;
  }
}

/** Valor bruto de célula. `null` = em branco. */
export type ValorBruto = number | string | boolean | ErroXls | null;

export interface CelulaXls {
  linha: number;
  coluna: number;
  xf: number;
  /** Valor gravado (para fórmulas, o resultado em cache). */
  valor: ValorBruto;
  /** Trechos de fonte (texto rico) quando a célula é texto do SST com formatação. */
  trechos?: TrechoRico[];
  /** Tokens da fórmula (rgce). Para fórmula compartilhada/matricial, os tokens da célula-mãe. */
  formula?: Uint8Array;
  /** Fórmula compartilhada (tokens relativos à própria célula). */
  compartilhada?: boolean;
}

export interface FonteXls {
  /** Tamanho em pontos. */
  tamanho: number;
  negrito: boolean;
  italico: boolean;
  sublinhado: boolean;
  tachado: boolean;
  /** Índice de cor (paleta). */
  cor: number;
  nome: string;
  /** 1 sobrescrito, 2 subscrito. */
  posicao: number;
}

export interface BordaXls {
  /** 0 nenhuma, 1 fina, 2 média, 3 tracejada, 4 pontilhada, 5 grossa, 6 dupla, 7 fio, 8+ variações. */
  estilo: number;
  cor: number;
}

export interface EstiloXf {
  fonte: number;
  formato: number;
  /** 0 geral, 1 esquerda, 2 centro, 3 direita, 4 preencher, 5 justificar, 6 centralizar na seleção, 7 distribuído. */
  alinhamentoH: number;
  /** 0 topo, 1 centro, 2 base, 3 justificar, 4 distribuído. */
  alinhamentoV: number;
  quebra: boolean;
  recuo: number;
  rotacao: number;
  reduzir: boolean;
  esquerda: BordaXls;
  direita: BordaXls;
  cima: BordaXls;
  baixo: BordaXls;
  /** 0 sem preenchimento, 1 sólido, 2..18 padrões. */
  padrao: number;
  corFrente: number;
  corFundo: number;
}

export interface DesenhoXls {
  /** "imagem" (JPEG/PNG/outro), "retangulo" (forma preenchida) ou "outro". */
  tipo: "imagem" | "retangulo" | "outro";
  /** Tipo da forma (Escher). */
  forma: number;
  coluna1: number;
  dx1: number;
  linha1: number;
  dy1: number;
  coluna2: number;
  dx2: number;
  linha2: number;
  dy2: number;
  imagem?: { dados: Uint8Array; tipo: "jpeg" | "png" | "outro" };
  /** Cor de preenchimento RGB (#rrggbb) de formas preenchidas. */
  preenchimento?: string | null;
  /** Rotação em graus. */
  rotacao: number;
  imprime: boolean;
}

/** Regra de formatação condicional (só o que o PDF usa: o preenchimento). */
export interface RegraCondicional {
  /** 1 = valor da célula (com operador), 2 = fórmula. */
  tipo: number;
  /** 1 entre, 2 fora de, 3 igual, 4 diferente, 5 maior, 6 menor, 7 maior ou igual, 8 menor ou igual. */
  operador: number;
  formula1: Uint8Array;
  formula2: Uint8Array;
  /** Índice de cor do preenchimento da regra, ou null se a regra não muda o fundo. */
  preenchimento: number | null;
}

export interface FormatacaoCondicional {
  /** Primeira célula do intervalo (referência das fórmulas relativas). */
  base: { linha: number; coluna: number };
  areas: { r1: number; r2: number; c1: number; c2: number }[];
  regras: RegraCondicional[];
}

export interface AbaXls {
  nome: string;
  indice: number;
  celulas: Map<number, CelulaXls>;
  /** Largura em unidades de 1/256 de caractere (COLINFO), por coluna. */
  larguras: Map<number, number>;
  colunasOcultas: Set<number>;
  /** Largura padrão em caracteres (DEFCOLWIDTH). */
  larguraPadrao: number;
  alturas: Map<number, number>;
  linhasOcultas: Set<number>;
  alturaPadrao: number;
  ocultaPorPadrao: boolean;
  mesclas: { r1: number; r2: number; c1: number; c2: number }[];
  quebrasLinha: number[];
  cabecalho: string;
  rodape: string;
  margens: { esquerda: number; direita: number; cima: number; baixo: number; cabecalho: number; rodape: number };
  retrato: boolean;
  ajustarLargura: number;
  ajustarAltura: number;
  ajustarPagina: boolean;
  escala: number;
  centralizarH: boolean;
  centralizarV: boolean;
  imprimeGrade: boolean;
  desenhos: DesenhoXls[];
  condicionais: FormatacaoCondicional[];
}

export interface NomeXls {
  nome: string;
  /** Aba de escopo (0 = pasta toda; senão índice da aba + 1). */
  escopo: number;
  formula: Uint8Array;
  /** Código do nome interno (0x06 Print_Area, 0x07 Print_Titles), ou -1. */
  interno: number;
}

export interface ExternSheet {
  supbook: number;
  primeira: number;
  ultima: number;
}

const PALETA_PADRAO = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

/** Formatos internos do Excel (os que o arquivo não grava em FORMAT). Datas no padrão brasileiro. */
const FORMATOS_INTERNOS: Record<number, string> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  5: '"R$ "#,##0;-"R$ "#,##0',
  6: '"R$ "#,##0;[Red]-"R$ "#,##0',
  7: '"R$ "#,##0.00;-"R$ "#,##0.00',
  8: '"R$ "#,##0.00;[Red]-"R$ "#,##0.00',
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "dd/mm/yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "dd/mm/yyyy hh:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mm:ss.0",
  48: "##0.0E+0",
  49: "@",
};

const DESENHO_PIB = 0x0104;

/** Chave de célula no mapa (BIFF8 tem até 256 colunas). */
export function chaveCelula(linha: number, coluna: number) {
  return linha * 256 + coluna;
}

/**
 * Pasta BIFF8 lida por inteiro para desenho e cálculo. Não altera nada do arquivo.
 */
export class PlanilhaBiff8 {
  readonly abas: AbaXls[] = [];
  readonly fontes: FonteXls[] = [];
  readonly xfs: EstiloXf[] = [];
  readonly formatos = new Map<number, string>();
  readonly paleta: string[] = [...PALETA_PADRAO];
  readonly nomes: NomeXls[] = [];
  readonly externSheets: ExternSheet[] = [];
  /** SUPBOOKs: `interno` = referência à própria pasta; `nomes` = EXTERNNAMEs (funções de suplemento). */
  readonly supbooks: { interno: boolean; nomes: string[] }[] = [];
  datas1904 = false;
  private sst: TextoXls[] = [];
  private blips: ({ dados: Uint8Array; tipo: "jpeg" | "png" | "outro" } | null)[] = [];

  private constructor(private pasta: PastaBiff8) {}

  static abrir(arquivo: Uint8Array): PlanilhaBiff8 {
    const pasta = PastaBiff8.abrir(arquivo);
    const p = new PlanilhaBiff8(pasta);
    p.lerGlobais();
    pasta.abas.forEach((aba, indice) => p.abas.push(p.lerAba(aba.nome, indice)));
    return p;
  }

  aba(nome: string): AbaXls {
    const a = this.abas.find((x) => x.nome === nome);
    if (!a) throw new Error(`A planilha não tem a aba "${nome}".`);
    return a;
  }

  /** Cor RGB "#rrggbb" de um índice de cor (paleta); `padrao` para cores automáticas. */
  cor(indice: number, padrao = "#000000"): string {
    if (indice >= 0 && indice < this.paleta.length) return `#${this.paleta[indice]}`;
    if (indice === 65) return "#FFFFFF";
    return padrao;
  }

  fonte(indice: number): FonteXls {
    const k = indice >= 4 ? indice - 1 : indice;
    return this.fontes[k] ?? this.fontes[0] ?? { tamanho: 10, negrito: false, italico: false, sublinhado: false, tachado: false, cor: 0x7fff, nome: "Arial", posicao: 0 };
  }

  formato(indice: number): string {
    // 14 e 22 são a "data abreviada" do sistema: no Brasil, dd/mm/aaaa (o arquivo pode trazer m/d/yyyy)
    if (indice === 14 || indice === 22) return FORMATOS_INTERNOS[indice];
    return this.formatos.get(indice) ?? FORMATOS_INTERNOS[indice] ?? "General";
  }

  // ─── globais ──────────────────────────────────────────────────────────────

  private registrosGlobais(): Registro[] {
    const regs = this.pasta.registros;
    const fim = this.pasta.abas.length ? regs.indexOf(this.pasta.abas[0].bof) : regs.length;
    return regs.slice(0, fim < 0 ? regs.length : fim);
  }

  private lerGlobais() {
    const regs = this.registrosGlobais();
    for (let k = 0; k < regs.length; k++) {
      const { tipo, dados: d } = regs[k];
      switch (tipo) {
        case 0x0031: {
          // FONT
          const grbit = u16(d, 2);
          const cch = d[14];
          const largo = (d[15] & 1) === 1;
          let nome = "";
          for (let j = 0; j < cch; j++) nome += String.fromCharCode(largo ? u16(d, 16 + j * 2) : d[16 + j]);
          this.fontes.push({
            tamanho: u16(d, 0) / 20,
            italico: (grbit & 0x02) !== 0,
            tachado: (grbit & 0x08) !== 0,
            cor: u16(d, 4),
            negrito: u16(d, 6) >= 600,
            posicao: u16(d, 8),
            sublinhado: d[10] !== 0,
            nome,
          });
          break;
        }
        case 0x041e: {
          // FORMAT
          this.formatos.set(u16(d, 0), textoU16(d, 2).texto);
          break;
        }
        case 0x00e0: {
          // XF
          const alc = d[6];
          const b8 = d[8];
          const bordas = u32(d, 10);
          const b2 = u32(d, 14);
          const cores = u16(d, 18);
          this.xfs.push({
            fonte: u16(d, 0),
            formato: u16(d, 2),
            alinhamentoH: alc & 0x07,
            quebra: (alc & 0x08) !== 0,
            alinhamentoV: (alc >> 4) & 0x07,
            rotacao: d[7],
            recuo: b8 & 0x0f,
            reduzir: (b8 & 0x10) !== 0,
            esquerda: { estilo: bordas & 0x0f, cor: (bordas >>> 16) & 0x7f },
            direita: { estilo: (bordas >>> 4) & 0x0f, cor: (bordas >>> 23) & 0x7f },
            cima: { estilo: (bordas >>> 8) & 0x0f, cor: b2 & 0x7f },
            baixo: { estilo: (bordas >>> 12) & 0x0f, cor: (b2 >>> 7) & 0x7f },
            padrao: (b2 >>> 26) & 0x3f,
            corFrente: cores & 0x7f,
            corFundo: (cores >>> 7) & 0x7f,
          });
          break;
        }
        case 0x0092: {
          // PALETTE (cores 8..)
          const n = u16(d, 0);
          for (let j = 0; j < n; j++) {
            const o = 2 + j * 4;
            const hex = [d[o], d[o + 1], d[o + 2]].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
            this.paleta[8 + j] = hex;
          }
          break;
        }
        case 0x0022:
          this.datas1904 = u16(d, 0) === 1;
          break;
        case R.SST: {
          const partes = [d];
          for (let j = k + 1; regs[j]?.tipo === R.CONTINUE; j++) partes.push(regs[j].dados);
          this.sst = lerSst(partes);
          break;
        }
        case 0x01ae: {
          // SUPBOOK: ctab + cch; cch=0x0401 → própria pasta; 0x3A01 → suplementos
          this.supbooks.push({ interno: u16(d, 2) === 0x0401, nomes: [] });
          break;
        }
        case 0x0023: {
          // EXTERNNAME (nome da função de suplemento, ex.: _xlfn.IFS)
          const sb = this.supbooks[this.supbooks.length - 1];
          if (sb) {
            const cch = d[6];
            const largo = (d[7] & 1) === 1;
            let nome = "";
            for (let j = 0; j < cch; j++) nome += String.fromCharCode(largo ? u16(d, 8 + j * 2) : d[8 + j]);
            sb.nomes.push(nome);
          }
          break;
        }
        case 0x0017: {
          // EXTERNSHEET
          const n = u16(d, 0);
          for (let j = 0; j < n; j++) {
            const o = 2 + j * 6;
            this.externSheets.push({ supbook: u16(d, o), primeira: i16(d, o + 2), ultima: i16(d, o + 4) });
          }
          break;
        }
        case 0x0018: {
          // NAME
          const grbit = u16(d, 0);
          const cch = d[3];
          const cce = u16(d, 4);
          const itab = u16(d, 8);
          const largo = (d[14] & 1) === 1;
          let p = 15;
          let nome = "";
          for (let j = 0; j < cch; j++) {
            nome += String.fromCharCode(largo ? u16(d, p) : d[p]);
            p += largo ? 2 : 1;
          }
          const interno = (grbit & 0x20) !== 0 ? nome.charCodeAt(0) : -1;
          this.nomes.push({ nome, escopo: itab, formula: d.slice(p, p + cce), interno });
          break;
        }
        case R.MSODRAWINGGROUP: {
          const partes = [d];
          for (let j = k + 1; regs[j]?.tipo === R.CONTINUE; j++) partes.push(regs[j].dados);
          this.blips = lerBlips(juntar(partes));
          break;
        }
      }
    }
  }

  private texto(indice: number): TextoXls {
    return this.sst[indice] ?? { texto: "", trechos: [] };
  }

  // ─── abas ─────────────────────────────────────────────────────────────────

  private lerAba(nome: string, indice: number): AbaXls {
    const aba: AbaXls = {
      nome,
      indice,
      celulas: new Map(),
      larguras: new Map(),
      colunasOcultas: new Set(),
      larguraPadrao: 8,
      alturas: new Map(),
      linhasOcultas: new Set(),
      alturaPadrao: 12.75,
      ocultaPorPadrao: false,
      mesclas: [],
      quebrasLinha: [],
      cabecalho: "",
      rodape: "",
      margens: { esquerda: 0.75, direita: 0.75, cima: 1, baixo: 1, cabecalho: 0.5, rodape: 0.5 },
      retrato: true,
      ajustarLargura: 1,
      ajustarAltura: 1,
      ajustarPagina: false,
      escala: 100,
      centralizarH: false,
      centralizarV: false,
      imprimeGrade: false,
      desenhos: [],
      condicionais: [],
    };
    const regs = this.pasta.registros;
    const [ini, fim] = this.pasta.intervaloDaAba(this.pasta.abas[indice]);
    const compartilhadas: { r1: number; r2: number; c1: number; c2: number; rgce: Uint8Array }[] = [];
    const matriciais: { r1: number; r2: number; c1: number; c2: number; rgce: Uint8Array }[] = [];
    const porExp: CelulaXls[] = [];
    let nivel = 0;
    let ultimaFormula: CelulaXls | null = null;
    let desenhoPendente: DesenhoXls | null = null;
    const por = (c: CelulaXls) => aba.celulas.set(chaveCelula(c.linha, c.coluna), c);
    for (let k = ini; k < fim; k++) {
      const { tipo, dados: d } = regs[k];
      if (tipo === R.BOF) nivel++;
      if (tipo === R.EOF) nivel--;
      if (nivel !== 1) continue;
      switch (tipo) {
        case R.NUMBER:
          por({ linha: u16(d, 0), coluna: u16(d, 2), xf: u16(d, 4), valor: f64(d, 6) });
          break;
        case R.RK:
          por({ linha: u16(d, 0), coluna: u16(d, 2), xf: u16(d, 4), valor: rkParaNumero(u32(d, 6)) });
          break;
        case R.MULRK: {
          const linha = u16(d, 0);
          const primeira = u16(d, 2);
          const n = (d.length - 6) / 6;
          for (let j = 0; j < n; j++) por({ linha, coluna: primeira + j, xf: u16(d, 4 + j * 6), valor: rkParaNumero(u32(d, 6 + j * 6)) });
          break;
        }
        case R.LABELSST: {
          const t = this.texto(u32(d, 6));
          por({ linha: u16(d, 0), coluna: u16(d, 2), xf: u16(d, 4), valor: t.texto, trechos: t.trechos.length ? t.trechos : undefined });
          break;
        }
        case R.LABEL:
          por({ linha: u16(d, 0), coluna: u16(d, 2), xf: u16(d, 4), valor: textoU16(d, 6).texto });
          break;
        case R.BLANK:
          por({ linha: u16(d, 0), coluna: u16(d, 2), xf: u16(d, 4), valor: null });
          break;
        case R.MULBLANK: {
          const linha = u16(d, 0);
          const primeira = u16(d, 2);
          const n = (d.length - 6) / 2;
          for (let j = 0; j < n; j++) por({ linha, coluna: primeira + j, xf: u16(d, 4 + j * 2), valor: null });
          break;
        }
        case R.BOOLERR: {
          const v: ValorBruto = d[7] === 0 ? d[6] === 1 : new ErroXls(codigoErro(d[6]));
          por({ linha: u16(d, 0), coluna: u16(d, 2), xf: u16(d, 4), valor: v });
          break;
        }
        case R.FORMULA: {
          let valor: ValorBruto;
          if (u16(d, 12) !== 0xffff) valor = f64(d, 6);
          else if (d[6] === 0) valor = ""; // texto: vem no STRING seguinte
          else if (d[6] === 1) valor = d[8] === 1;
          else if (d[6] === 2) valor = new ErroXls(codigoErro(d[8]));
          else valor = "";
          const cce = u16(d, 20);
          const cel: CelulaXls = { linha: u16(d, 0), coluna: u16(d, 2), xf: u16(d, 4), valor, formula: d.slice(22, 22 + cce) };
          por(cel);
          ultimaFormula = cel;
          if (cel.formula && cel.formula[0] === 0x01 && cel.formula.length >= 5) porExp.push(cel);
          break;
        }
        case R.STRING: {
          if (ultimaFormula) ultimaFormula.valor = textoU16(d, 0).texto;
          break;
        }
        case 0x04bc: {
          // SHRFMLA
          const cce = u16(d, 8);
          compartilhadas.push({ r1: u16(d, 0), r2: u16(d, 2), c1: d[4], c2: d[5], rgce: d.slice(10, 10 + cce) });
          break;
        }
        case 0x0221: {
          // ARRAY
          const cce = u16(d, 12);
          matriciais.push({ r1: u16(d, 0), r2: u16(d, 2), c1: d[4], c2: d[5], rgce: d.slice(14, 14 + cce) });
          break;
        }
        case 0x007d: {
          // COLINFO
          const ate = Math.min(u16(d, 2), 255);
          for (let c = u16(d, 0); c <= ate; c++) {
            aba.larguras.set(c, u16(d, 4));
            if (u16(d, 8) & 0x01) aba.colunasOcultas.add(c);
          }
          break;
        }
        case 0x0055:
          aba.larguraPadrao = u16(d, 0);
          break;
        case R.ROW: {
          const linha = u16(d, 0);
          const miy = u16(d, 6);
          const grbit = u32(d, 12);
          if (grbit & 0x20) aba.linhasOcultas.add(linha);
          if (!(miy & 0x8000)) aba.alturas.set(linha, (miy & 0x7fff) / 20);
          break;
        }
        case 0x0225: {
          // DEFAULTROWHEIGHT
          aba.ocultaPorPadrao = (u16(d, 0) & 0x02) !== 0;
          aba.alturaPadrao = u16(d, 2) / 20;
          break;
        }
        case 0x00e5: {
          // MERGEDCELLS
          const n = u16(d, 0);
          for (let j = 0; j < n; j++) {
            const o = 2 + j * 8;
            aba.mesclas.push({ r1: u16(d, o), r2: u16(d, o + 2), c1: u16(d, o + 4), c2: u16(d, o + 6) });
          }
          break;
        }
        case 0x001b: {
          // HORIZONTALPAGEBREAKS: primeira linha da página nova
          const n = u16(d, 0);
          for (let j = 0; j < n; j++) aba.quebrasLinha.push(u16(d, 2 + j * 6));
          break;
        }
        case 0x0014:
          aba.cabecalho = d.length ? textoU16(d, 0).texto : "";
          break;
        case 0x0015:
          aba.rodape = d.length ? textoU16(d, 0).texto : "";
          break;
        case 0x0026:
          aba.margens.esquerda = f64(d, 0);
          break;
        case 0x0027:
          aba.margens.direita = f64(d, 0);
          break;
        case 0x0028:
          aba.margens.cima = f64(d, 0);
          break;
        case 0x0029:
          aba.margens.baixo = f64(d, 0);
          break;
        case 0x0083:
          aba.centralizarH = u16(d, 0) === 1;
          break;
        case 0x0084:
          aba.centralizarV = u16(d, 0) === 1;
          break;
        case 0x002b:
          aba.imprimeGrade = u16(d, 0) === 1;
          break;
        case 0x0081:
          aba.ajustarPagina = (u16(d, 0) & 0x0100) !== 0;
          break;
        case 0x00a1: {
          // SETUP
          const grbit = u16(d, 10);
          aba.escala = u16(d, 2) || 100;
          aba.ajustarLargura = u16(d, 6);
          aba.ajustarAltura = u16(d, 8);
          // fNoPls (bit 2): orientação não definida → retrato
          aba.retrato = (grbit & 0x04) !== 0 || (grbit & 0x02) !== 0;
          if (d.length >= 32) {
            aba.margens.cabecalho = f64(d, 16);
            aba.margens.rodape = f64(d, 24);
          }
          break;
        }
        case 0x01b0: {
          // CFHEADER: intervalo (refBound + sqref)
          const n = u16(d, 12);
          const areas: { r1: number; r2: number; c1: number; c2: number }[] = [];
          for (let j = 0; j < n; j++) {
            const o = 14 + j * 8;
            if (o + 8 > d.length) break;
            areas.push({ r1: u16(d, o), r2: u16(d, o + 2), c1: u16(d, o + 4), c2: u16(d, o + 6) });
          }
          aba.condicionais.push({ base: { linha: u16(d, 4), coluna: u16(d, 8) }, areas, regras: [] });
          break;
        }
        case 0x01b1: {
          // CF: regra (tipo, operador, DXFN, fórmulas)
          const fc = aba.condicionais[aba.condicionais.length - 1];
          if (!fc) break;
          const cce1 = u16(d, 2);
          const cce2 = u16(d, 4);
          const lido = lerDxfnPreenchimento(d, 6);
          if (lido.fim + cce1 + cce2 > d.length) break;
          fc.regras.push({
            tipo: d[0],
            operador: d[1],
            preenchimento: lido.preenchimento,
            formula1: d.slice(lido.fim, lido.fim + cce1),
            formula2: d.slice(lido.fim + cce1, lido.fim + cce1 + cce2),
          });
          break;
        }
        case R.MSODRAWING: {
          desenhoPendente = null;
          for (const des of this.lerDesenhos(d)) {
            aba.desenhos.push(des);
            desenhoPendente = des;
          }
          break;
        }
        case R.OBJ: {
          // ftCmo: grbit bit 4 = imprimir o objeto
          if (desenhoPendente && u16(d, 0) === 0x15) desenhoPendente.imprime = (u16(d, 8) & 0x0010) !== 0;
          desenhoPendente = null;
          break;
        }
      }
    }
    // Fórmulas compartilhadas/matriciais: a célula aponta (ptgExp) para a célula-mãe.
    for (const cel of porExp) {
      const rm = u16(cel.formula!, 1);
      const cm = u16(cel.formula!, 3);
      const arr = matriciais.find((m) => m.r1 === rm && m.c1 === cm && cel.linha >= m.r1 && cel.linha <= m.r2 && cel.coluna >= m.c1 && cel.coluna <= m.c2);
      if (arr) {
        cel.formula = arr.rgce;
        continue;
      }
      const sh = compartilhadas.find((s) => s.r1 === rm && s.c1 === cm);
      if (sh) {
        cel.formula = sh.rgce;
        cel.compartilhada = true;
      }
    }
    return aba;
  }

  /** Formas de um registro MSODRAWING (âncoras em células + deslocamentos). */
  private lerDesenhos(d: Uint8Array): DesenhoXls[] {
    const saida: DesenhoXls[] = [];
    const visitar = (o: number, fim: number) => {
      while (o + 8 <= fim) {
        const vi = u16(d, o);
        const tipo = u16(d, o + 2);
        const tam = u32(d, o + 4);
        const fimFilho = Math.min(o + 8 + tam, d.length);
        if (tipo === 0xf002 || tipo === 0xf003) visitar(o + 8, fimFilho);
        else if (tipo === 0xf004) {
          const des = this.lerForma(d, o + 8, fimFilho);
          if (des) saida.push(des);
        }
        if (tam === 0 && (vi & 0xf) !== 0xf && tipo !== 0xf011 && tipo !== 0xf00d) {
          o += 8;
          continue;
        }
        o += 8 + tam;
      }
    };
    visitar(0, d.length);
    return saida;
  }

  private lerForma(d: Uint8Array, o: number, fim: number): DesenhoXls | null {
    let forma = -1;
    let props = new Map<number, number>();
    let ancora: number | null = null;
    let p = o;
    while (p + 8 <= fim) {
      const vi = u16(d, p);
      const tipo = u16(d, p + 2);
      const tam = u32(d, p + 4);
      if (tipo === 0xf00a) forma = vi >> 4;
      else if (tipo === 0xf00b || tipo === 0xf122) {
        const n = vi >> 4;
        for (let j = 0; j < n; j++) {
          const q = p + 8 + j * 6;
          if (q + 6 > d.length) break;
          props.set(u16(d, q) & 0x3fff, u32(d, q + 2));
        }
      } else if (tipo === 0xf010) ancora = p + 8;
      p += 8 + tam;
    }
    if (ancora === null || ancora + 18 > d.length || forma === 0) return null;
    const a = ancora;
    const des: DesenhoXls = {
      tipo: "outro",
      forma,
      coluna1: u16(d, a + 2),
      dx1: u16(d, a + 4),
      linha1: u16(d, a + 6),
      dy1: u16(d, a + 8),
      coluna2: u16(d, a + 10),
      dx2: u16(d, a + 12),
      linha2: u16(d, a + 14),
      dy2: u16(d, a + 16),
      rotacao: props.has(0x0004) ? (props.get(0x0004)! | 0) / 65536 : 0,
      imprime: true,
    };
    // propriedades de grupo (0x03BF): bit 1 oculto, bit 0 imprimir (com bits de "usar" em 16+)
    const grupo = props.get(0x03bf);
    if (grupo !== undefined) {
      if (grupo & 0x20000 && grupo & 0x2) des.imprime = false;
      if (grupo & 0x10000 && !(grupo & 0x1)) des.imprime = false;
    }
    const pib = props.get(DESENHO_PIB);
    if (pib) {
      des.tipo = "imagem";
      des.imagem = this.blips[pib - 1] ?? undefined;
      return des;
    }
    const preench = props.get(0x01bf);
    const preenchido = preench === undefined ? true : !(preench & 0x100000) || (preench & 0x10) !== 0;
    if (forma === 1 || forma === 2) {
      des.tipo = "retangulo";
      const cor = props.get(0x0181);
      des.preenchimento = preenchido ? (cor === undefined || cor & 0xff000000 ? "#FFFFFF" : corEscher(cor)) : null;
    }
    return des;
  }
}

/** Lê um DXFN (formato diferencial) e devolve a cor de fundo, se a regra mudar o preenchimento. */
function lerDxfnPreenchimento(d: Uint8Array, o: number): { preenchimento: number | null; fim: number } {
  const flags = u32(d, o);
  const flags2 = u16(d, o + 4);
  let p = o + 6;
  let preenchimento: number | null = null;
  if (flags & (1 << 25)) {
    // número: formato do usuário (texto) ou índice
    if (flags2 & 0x0001) p += u16(d, p);
    else p += 2;
  }
  if (flags & (1 << 26)) p += 118; // fonte
  if (flags & (1 << 27)) p += 8; // alinhamento
  if (flags & (1 << 28)) p += 8; // bordas
  if (flags & (1 << 29)) {
    const fls = (u16(d, p) >> 10) & 0x3f;
    const cores = u16(d, p + 2);
    const frente = cores & 0x7f;
    const fundo = (cores >> 7) & 0x7f;
    const semFls = (flags & (1 << 16)) !== 0;
    const semFundo = (flags & (1 << 18)) !== 0;
    const semFrente = (flags & (1 << 17)) !== 0;
    // no formato diferencial do preenchimento sólido a cor vem no "fundo"
    if (!semFundo && (semFls || fls === 1 || fls === 0)) preenchimento = fundo;
    else if (!semFrente && fls > 0) preenchimento = frente;
    p += 4;
  }
  if (flags & (1 << 30)) p += 2; // proteção
  return { preenchimento, fim: p };
}

function corEscher(v: number): string {
  const r = v & 0xff;
  const g = (v >> 8) & 0xff;
  const b = (v >> 16) & 0xff;
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function codigoErro(c: number): string {
  return { 0x00: "#NULL!", 0x07: "#DIV/0!", 0x0f: "#VALUE!", 0x17: "#REF!", 0x1d: "#NAME?", 0x24: "#NUM!", 0x2a: "#N/A" }[c] ?? "#N/A";
}

function juntar(partes: Uint8Array[]) {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const b = new Uint8Array(total);
  let o = 0;
  for (const p of partes) {
    b.set(p, o);
    o += p.length;
  }
  return b;
}

function lerSst(partes: Uint8Array[]): TextoXls[] {
  const unicos = u32(partes[0], 4);
  const leitor = new LeitorContinuo(partes, 8);
  const strings: TextoXls[] = [];
  for (let k = 0; k < unicos && !leitor.fim(); k++) {
    const qtd = leitor.u16();
    const flags = leitor.byte();
    const rico = (flags & 0x08) !== 0;
    const ext = (flags & 0x04) !== 0;
    const runs = rico ? leitor.u16() : 0;
    const cbExt = ext ? leitor.u32() : 0;
    const texto = leitor.caracteres(qtd, (flags & 1) === 1);
    const trechos: TrechoRico[] = [];
    for (let j = 0; j < runs; j++) trechos.push({ inicio: leitor.u16(), fonte: leitor.u16() });
    leitor.pula(cbExt);
    strings.push({ texto, trechos });
  }
  return strings;
}

/** Imagens do armazenamento de desenhos (BStore), na ordem do índice `pib` (1 = primeira). */
function lerBlips(g: Uint8Array): ({ dados: Uint8Array; tipo: "jpeg" | "png" | "outro" } | null)[] {
  const saida: ({ dados: Uint8Array; tipo: "jpeg" | "png" | "outro" } | null)[] = [];
  if (g.length < 8 || u16(g, 2) !== 0xf000) return saida;
  const fimRaiz = Math.min(8 + u32(g, 4), g.length);
  let o = 8;
  while (o + 8 <= fimRaiz) {
    const tipo = u16(g, o + 2);
    const tam = u32(g, o + 4);
    if (tipo === 0xf001) {
      let q = o + 8;
      const fimB = Math.min(o + 8 + tam, g.length);
      while (q + 8 <= fimB) {
        const tq = u16(g, q + 2);
        const tamq = u32(g, q + 4);
        if (tq === 0xf007 && q + 8 + 36 + 8 <= g.length) {
          const btWin = g[q + 8];
          const blip = q + 8 + 36;
          const instB = u16(g, blip) >> 4;
          const tamB = u32(g, blip + 4);
          if (btWin === 5 || btWin === 6) {
            const uid2 = btWin === 6 ? instB === 0x6e1 : instB === 0x46b || instB === 0x6e3;
            const ini = blip + 8 + (uid2 ? 33 : 17);
            saida.push({ dados: g.slice(ini, Math.min(blip + 8 + tamB, g.length)), tipo: btWin === 6 ? "png" : "jpeg" });
          } else {
            saida.push({ dados: new Uint8Array(0), tipo: "outro" });
          }
        } else {
          saida.push(null);
        }
        q += 8 + tamq;
      }
    }
    o += 8 + tam;
  }
  return saida;
}

/** Converte o índice de coluna em letras ("AB"). */
export function letrasDaColuna(c: number): string {
  let s = "";
  let n = c + 1;
  while (n) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** "AB12" → {linha, coluna} base zero. */
export function posicaoDoEndereco(endereco: string): { linha: number; coluna: number } {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(endereco.trim().toUpperCase());
  if (!m) throw new Error(`Endereço de célula inválido: ${endereco}`);
  let coluna = 0;
  for (const letra of m[1]) coluna = coluna * 26 + (letra.charCodeAt(0) - 64);
  return { linha: Number(m[2]) - 1, coluna: coluna - 1 };
}
