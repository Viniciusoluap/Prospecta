import { measureText } from "@libpdf/core";

/**
 * Marca visível da assinatura digital: uma única conta, usada pela prévia (px) e pelo desenho
 * real no PDF (pt). A conta é homogênea: multiplicar largura e altura por k multiplica fonte,
 * entrelinha, margem interna, borda e posição das linhas por k. Por isso a prévia e o PDF ficam
 * iguais em proporção, qualquer que seja a unidade.
 */

/** Caixa relativa à página (0–1), origem no canto superior esquerdo, como na tela. */
export type CaixaRelativa = { x: number; y: number; w: number; h: number };

export const MARCA_BASE = { w: 0.52, h: 0.11 } as const;
export const ESCALA_MIN = 0.5;
export const ESCALA_MAX = 1.6;

/** Proporções da marca em relação ao menor lado da caixa. */
const MARGEM = 0.08;
const BORDA = 0.008;
/** Entrelinha em relação à fonte, e posição da linha de base dentro dela (Helvetica). */
export const ENTRELINHA = 1.2;
const BASE_NA_LINHA = 0.856;

export type Medir = (texto: string, tamanho: number) => number;
/** Largura real do texto na fonte padrão usada no PDF (Helvetica). */
export const medirHelvetica: Medir = (texto, tamanho) => measureText(texto, "Helvetica", tamanho);

export type LinhaDaMarca = {
  texto: string;
  /** Distância da borda esquerda da caixa. */
  x: number;
  /** Distância do topo da caixa até o topo da linha. */
  topo: number;
  /** Distância do topo da caixa até a linha de base do texto. */
  base: number;
};
export type LayoutDaMarca = {
  fonte: number; entrelinha: number; margem: number; borda: number; linhas: LinhaDaMarca[];
};

/** Textos da marca; o nome é um bloco só e é quebrado pela largura disponível. */
export function dataDaMarca(data: Date): string {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Fortaleza", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(data);
  const campo = (tipo: Intl.DateTimeFormatPartTypes) => partes.find(parte => parte.type === tipo)?.value;
  return `${campo("day")}/${campo("month")}/${campo("year")}, ${campo("hour")}:${campo("minute")}:${campo("second")}`;
}

export function linhasDaMarca(titular: string, documento: string, data: Date): string[] {
  const nome = titular.replace(/[^ -ÿ]/g, "").replace(/\s+/g, " ").trim() || "Consulte o certificado";
  return [
    "ASSINADO DIGITALMENTE",
    nome,
    `CPF/CNPJ: ${documento || "Ver certificado"}`,
    dataDaMarca(data),
  ];
}

function quebrar(texto: string, limite: number, tamanho: number, medir: Medir): string[] {
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of texto.split(" ").filter(Boolean)) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (medir(tentativa, tamanho) <= limite) { atual = tentativa; continue; }
    if (atual) linhas.push(atual);
    atual = "";
    // Palavra que sozinha não cabe (ex.: CNPJ colado no nome) é quebrada por caractere.
    let resto = palavra;
    while (medir(resto, tamanho) > limite && resto.length > 1) {
      let n = resto.length - 1;
      while (n > 1 && medir(resto.slice(0, n), tamanho) > limite) n--;
      linhas.push(resto.slice(0, n));
      resto = resto.slice(n);
    }
    atual = resto;
  }
  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [""];
}

/**
 * Calcula a marca inteira para uma caixa de `largura` × `altura` (px na prévia, pt no PDF).
 * Escolhe a maior fonte com a qual todas as linhas cabem na caixa, sem estourar.
 */
export function layoutDaMarca(largura: number, altura: number, blocos: string[], medir: Medir = medirHelvetica): LayoutDaMarca {
  if (!(largura > 0 && altura > 0) || !blocos.length) throw new Error("Caixa da assinatura inválida.");
  const lado = Math.min(largura, altura);
  const margem = lado * MARGEM, borda = lado * BORDA;
  const util = { w: largura - 2 * margem, h: altura - 2 * margem };
  // Começa pela maior fonte possível (um bloco por linha) e reduz até tudo caber.
  let fonte = util.h / (blocos.length * ENTRELINHA);
  let linhas: string[] = [];
  for (let i = 0; i < 40; i++) {
    linhas = blocos.flatMap(b => quebrar(b, util.w, fonte, medir));
    const maior = Math.max(...linhas.map(l => medir(l, 1)));
    const cabe = Math.min(util.h / (linhas.length * ENTRELINHA), maior > 0 ? util.w / maior : Infinity);
    if (cabe >= fonte) break;
    fonte = cabe * 0.999;
  }
  const entrelinha = fonte * ENTRELINHA;
  return {
    fonte, entrelinha, margem, borda,
    linhas: linhas.map((texto, i) => ({ texto, x: margem, topo: margem + i * entrelinha, base: margem + (i + BASE_NA_LINHA / ENTRELINHA) * entrelinha })),
  };
}

const limitar = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function escalaDaCaixa(caixa: CaixaRelativa) {
  return caixa.w / MARCA_BASE.w;
}

/** Redimensiona a marca inteira pela escala, preservando o centro e mantendo-a dentro da página. */
export function caixaNaEscala(caixa: CaixaRelativa, escala: number): CaixaRelativa {
  const e = limitar(Number.isFinite(escala) ? escala : 1, ESCALA_MIN, ESCALA_MAX);
  const w = MARCA_BASE.w * e, h = MARCA_BASE.h * e;
  const cx = caixa.x + caixa.w / 2, cy = caixa.y + caixa.h / 2;
  return { w, h, x: limitar(cx - w / 2, 0, 1 - w), y: limitar(cy - h / 2, 0, 1 - h) };
}

/** Centraliza a marca no ponto tocado/arrastado (fração da página), sem sair da página. */
export function moverCaixa(caixa: CaixaRelativa, fx: number, fy: number): CaixaRelativa {
  return { ...caixa, x: limitar(fx - caixa.w / 2, 0, 1 - caixa.w), y: limitar(fy - caixa.h / 2, 0, 1 - caixa.h) };
}
