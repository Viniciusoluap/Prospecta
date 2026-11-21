// Maquete 3D (EPIC-028, Etapa 2) — conversor puro do JSON-fonte (`fonte.ts`) para o que o visualizador desenha.
// Duas saídas:
//   1. `fonteParaModelo` / `pecasDaFonte`: o JSON-fonte como mais uma ORIGEM do `ModeloMaquete` de sempre (o mesmo
//      visualizador do EPIC-022 abre a casa), com os `itens` do JSON no lugar da mobília automática;
//   2. `cenaDaFonte`: a cena detalhada do gerador novo — paredes recortadas (peitoril e verga) com a base e a altura
//      de cada parede, muros, pisos por ambiente e nível, soleiras, esquadrias (modelo, folhas, lado do giro),
//      cobertura (forro, platibanda, duas águas, calhas), entorno, uma luz por cômodo, rótulos e pontos de vista.
// Nada de three.js aqui: tudo é número, para ser testado no servidor. Eixos e unidades: os de `fonte.ts` (metros;
// x = largura, z = profundidade crescendo para a rua; y = altura acima da rua). Nada é inventado: o que não vem do
// JSON é uma constante nomeada abaixo e marcada como estimada.
import {
  areaPoligono, contornoDaParede, ehOrtogonal, eixoDaParede, poligonoDoAmbiente,
  type AberturaFonte, type AcabamentoPiso, type AmbienteFonte, type FontePlanta, type ItemFonte, type ParedeFonte,
} from "./fonte.js";
import { dentroDoPoligono, pontoInterno } from "./geometria3d.js";
import type { PecaMobilia } from "./mobilia.js";
import { modeloSchema, type FuncaoComodo, type ModeloMaquete, type Ponto } from "./modelo.js";
import { ladoDoAmbiente } from "./validacao-fonte.js";

// ── Constantes do gerador (o que a prancha não diz) ──

/** Olhos de quem visita, acima do piso do cômodo (pedido do dono). */
export const ALTURA_OLHOS_TOUR = 1.6;
/** Estrutura do telhado (terças e ripas) acima do forro, no ponto mais baixo da água — como no protótipo. */
export const APOIO_TELHADO = 0.15;
/** Espessura do forro de gesso desenhado. */
export const ESPESSURA_FORRO = 0.04;
/** Vão máximo (m) entre dois pedaços cobertos que o gerador fecha como piso/forro (frestas do desenho). */
export const FRESTA_MAXIMA = 0.05;
/** Calçada e rua na frente do lote: não estão no JSON; medidas do protótipo (estimadas). */
export const CALCADA = { largura: 1.65, nivel: 0.15, estimado: true } as const;
export const RUA = { largura: 6.5, nivel: 0 } as const;
/** Soleiras de granito: espessura e quanto avançam além da face da parede. */
export const SOLEIRA = { espessura: 0.03, avanco: 0.02 } as const;
/** Peitoril (pingadeira) de granito das janelas. */
export const PINGADEIRA = { espessura: 0.025, avanco: 0.025, abas: 0.03 } as const;

const EPS = 1e-6;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

// ── Leitura dos ambientes ──

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Identificador de URL a partir de um nome ("Área de serviço" → "area-de-servico"). */
export const slug = (s: string) => semAcento(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Ambiente auxiliar do desenho (ex.: "Divisa cozinha/sala", a faixa do balcão): sem quadro e com menos de 0,5 m². */
export const ehAuxiliar = (a: AmbienteFonte) => a.area_planta == null && areaPoligono(poligonoDoAmbiente(a)) < 0.5;

/** Acabamento do piso: o do JSON ou, se ausente, deduzido do nome e de `interno`. */
export function acabamentoDoAmbiente(a: AmbienteFonte): AcabamentoPiso {
  if (a.acabamento) return a.acabamento;
  const n = semAcento(a.nome);
  if (/banh|lavabo|\bwc\b/.test(n)) return "ceramica";
  if (/quintal|jardim|gramad/.test(n)) return "grama";
  if (/garag/.test(n)) return "concreto";
  return a.interno ? "porcelanato" : "cimentado";
}

/** Função do cômodo no `ModeloMaquete`: a do JSON ou deduzida do nome. */
export function funcaoDoAmbiente(a: AmbienteFonte): FuncaoComodo {
  if (a.funcao) return a.funcao;
  const n = semAcento(a.nome);
  const regras: [RegExp, FuncaoComodo][] = [
    [/suite/, "suite"], [/quarto|dormit/, "quarto"], [/lavabo/, "lavabo"], [/banh/, "banheiro"], [/cozinha/, "cozinha"],
    [/servic|lavand/, "area_servico"], [/varanda|sacada|alpendre/, "varanda"], [/garag/, "garagem"],
    [/hall|circula|corredor|divisa/, "hall"], [/jantar/, "sala_jantar"], [/sala|estar/, "sala"],
    [/quintal|jardim|frente/, "area_externa"],
  ];
  for (const [re, f] of regras) if (re.test(n)) return f;
  return a.interno ? "outro" : "area_externa";
}

const pontosDe = (a: AmbienteFonte): Ponto[] => poligonoDoAmbiente(a);

/** Ambiente que contém o ponto (o menor, se houver sobreposição). */
export function ambienteEm(f: FontePlanta, x: number, z: number): AmbienteFonte | null {
  const p = { x, y: z };
  return f.estrutura.ambientes.filter(a => dentroDoPoligono(p, pontosDe(a)))
    .sort((a, b) => areaPoligono(pontosDe(a)) - areaPoligono(pontosDe(b)))[0] ?? null;
}

const pisoDoItem = (f: FontePlanta, i: ItemFonte) =>
  f.estrutura.ambientes.find(a => a.nome === i.ambiente)?.piso ?? ambienteEm(f, i.x, i.z)?.piso ?? 0;

// ── Paredes: cortes de sobreposição e trechos (peitoril/verga) ──

type Ret = { x0: number; x1: number; z0: number; z1: number };
const topoDaParede = (w: ParedeFonte) => w.base + w.h;

function retDaParede(w: ParedeFonte): Ret | null {
  if (!ehOrtogonal(w)) return null;
  const pts = contornoDaParede(w), xs = pts.map(p => p.x), zs = pts.map(p => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}
const interseccao = (a: Ret, b: Ret): Ret | null => {
  const r = { x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), z0: Math.max(a.z0, b.z0), z1: Math.min(a.z1, b.z1) };
  return r.x1 - r.x0 > 1e-4 && r.z1 - r.z0 > 1e-4 ? r : null;
};
const aoLongoDeX = (w: ParedeFonte) => Math.abs(w.z1 - w.z2) < EPS;

/** O pedaço `i` (interseção) atravessa a espessura inteira da parede `w`? Devolve o intervalo em s, ou null. */
function travessia(w: ParedeFonte, rw: Ret, i: Ret): [number, number] | null {
  const { ux, uz } = eixoDaParede(w);
  if (aoLongoDeX(w)) {
    if (i.z0 > rw.z0 + 1e-4 || i.z1 < rw.z1 - 1e-4) return null;
    const a = (i.x0 - w.x1) * ux, b = (i.x1 - w.x1) * ux;
    return [Math.min(a, b), Math.max(a, b)];
  }
  if (i.x0 > rw.x0 + 1e-4 || i.x1 < rw.x1 - 1e-4) return null;
  const a = (i.z0 - w.z1) * uz, b = (i.z1 - w.z1) * uz;
  return [Math.min(a, b), Math.max(a, b)];
}

/**
 * Trechos (em s, ao longo do eixo) de cada parede que ficam DENTRO de outra parede mais alta ou anterior na lista
 * (encontros em L e T): são tirados do desenho para não haver duas faces no mesmo plano (cintilação). Muro e parede
 * da casa se cortam do mesmo jeito. Paredes oblíquas não são cortadas.
 */
export function cortesDasParedes(paredes: ParedeFonte[]): Map<string, [number, number][]> {
  const rets = paredes.map(retDaParede);
  const out = new Map<string, [number, number][]>();
  paredes.forEach((w, iw) => {
    const rw = rets[iw];
    const cortes: [number, number][] = [];
    if (rw) paredes.forEach((v, iv) => {
      const rv = rets[iv];
      if (iv === iw || !rv) return;
      const i = interseccao(rw, rv);
      if (!i) return;
      const emW = travessia(w, rw, i);
      if (!emW || topoDaParede(v) < topoDaParede(w) - 1e-4) return;
      // Se as duas se cobrem por inteiro (mesma altura, cruzando a espessura uma da outra), corta só a de depois.
      const wCobreV = travessia(v, rv, i) && topoDaParede(w) >= topoDaParede(v) - 1e-4;
      if (wCobreV && iv > iw) return;
      cortes.push(emW);
    });
    out.set(w.id, cortes);
  });
  return out;
}

export type Trecho = {
  s0: number; s1: number; y0: number; y1: number;
  /** cheio: parede inteira; peitoril: embaixo de janela/porta; verga: em cima do vão. */
  tipo: "cheio" | "peitoril" | "verga";
  aberturaId?: string;
};

/** Tira de [s0, s1] os intervalos de `cortes`. */
function subtrair(s0: number, s1: number, cortes: [number, number][]): [number, number][] {
  let partes: [number, number][] = [[s0, s1]];
  for (const [c0, c1] of cortes) {
    partes = partes.flatMap(([a, b]): [number, number][] => {
      if (c1 <= a + 1e-6 || c0 >= b - 1e-6) return [[a, b]];
      const r: [number, number][] = [];
      if (c0 > a + 1e-4) r.push([a, c0]);
      if (c1 < b - 1e-4) r.push([c1, b]);
      return r;
    });
  }
  return partes.filter(([a, b]) => b - a > 1e-3);
}

/**
 * Parede recortada pelas aberturas: cheia entre os vãos; embaixo de cada vão o peitoril (até `base + peitoril`) e em
 * cima a verga (de `base + peitoril + alt` até o topo). Todo trecho começa no chão (y = 0): abaixo do piso interno
 * ele é o embasamento visto por fora.
 */
export function trechosDaParede(w: ParedeFonte, aberturas: AberturaFonte[], cortes: [number, number][] = []): Trecho[] {
  const comp = eixoDaParede(w).comp, topo = topoDaParede(w);
  const brutos: Trecho[] = [];
  let cursor = 0;
  for (const ab of aberturas.filter(a => a.parede === w.id).sort((a, b) => a.offset - b.offset)) {
    const s0 = Math.max(cursor, ab.offset), s1 = Math.min(comp, ab.offset + ab.larg);
    if (s1 - s0 < 1e-3) continue;
    if (s0 > cursor + 1e-4) brutos.push({ s0: cursor, s1: s0, y0: 0, y1: topo, tipo: "cheio" });
    const yPeitoril = w.base + ab.peitoril, yVerga = w.base + ab.peitoril + ab.alt;
    if (yPeitoril > 0.005) brutos.push({ s0, s1, y0: 0, y1: yPeitoril, tipo: "peitoril", aberturaId: ab.id });
    if (topo - yVerga > 0.005) brutos.push({ s0, s1, y0: yVerga, y1: topo, tipo: "verga", aberturaId: ab.id });
    cursor = Math.max(cursor, s1);
  }
  if (comp - cursor > 1e-4) brutos.push({ s0: cursor, s1: comp, y0: 0, y1: topo, tipo: "cheio" });
  return brutos.flatMap(t => subtrair(t.s0, t.s1, cortes).map(([s0, s1]) => ({ ...t, s0, s1 })));
}

/** Caixa orientada: centro em planta, comprimento ao longo do eixo local X (girado de `ang` em torno de y). */
export type BlocoCena = {
  id: string; paredeId: string; muro: boolean;
  cx: number; cz: number; comp: number; esp: number;
  /** Giro em torno de y (radianos) que leva o X local ao eixo da parede: `atan2(−uz, ux)`. */
  ang: number;
  y0: number; y1: number;
  /** Topo deste bloco é o topo cortado da parede da casa (pintado como corte na visão geral). */
  topoCortado: boolean;
};

export const anguloDaParede = (w: Pick<ParedeFonte, "x1" | "z1" | "x2" | "z2">) => {
  const { ux, uz } = eixoDaParede(w);
  return Math.atan2(-uz, ux);
};

function blocoNaParede(w: ParedeFonte, id: string, s0: number, s1: number, y0: number, y1: number, esp = w.esp, topoCortado = false): BlocoCena {
  const { ux, uz } = eixoDaParede(w), s = (s0 + s1) / 2;
  return { id, paredeId: w.id, muro: !!w.muro, cx: r4(w.x1 + ux * s), cz: r4(w.z1 + uz * s), comp: r4(s1 - s0), esp, ang: anguloDaParede(w), y0: r4(y0), y1: r4(y1), topoCortado };
}

// ── Grade de cobertura (contorno da parte coberta da casa) ──

/** Grade comprimida: só as coordenadas que aparecem no desenho. `cel[j * nx + i]` = coberta. */
export type Grade = { xs: number[]; zs: number[]; nx: number; nz: number; cel: Uint8Array };

const unicos = (v: number[]) => Array.from(new Set(v.map(r4))).sort((a, b) => a - b);

/**
 * Parte coberta da casa: ambientes internos e paredes da casa (não os muros), com as frestas de até
 * `FRESTA_MAXIMA` fechadas. `extras` acrescenta linhas de corte (a cumeeira).
 */
export function gradeCoberta(f: FontePlanta, extras: { xs?: number[]; zs?: number[] } = {}): Grade {
  const internos = f.estrutura.ambientes.filter(a => a.interno).map(pontosDe);
  const rets = f.estrutura.paredes.filter(w => !w.muro).map(retDaParede).filter((r): r is Ret => !!r);
  let xs = unicos([...internos.flat().map(p => p.x), ...rets.flatMap(r => [r.x0, r.x1])]);
  let zs = unicos([...internos.flat().map(p => p.y), ...rets.flatMap(r => [r.z0, r.z1])]);
  if (xs.length >= 2) xs = unicos([...xs, ...(extras.xs ?? []).filter(x => x > xs[0] && x < xs[xs.length - 1])]);
  if (zs.length >= 2) zs = unicos([...zs, ...(extras.zs ?? []).filter(z => z > zs[0] && z < zs[zs.length - 1])]);
  const nx = Math.max(0, xs.length - 1), nz = Math.max(0, zs.length - 1), cel = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const p = { x: (xs[i] + xs[i + 1]) / 2, y: (zs[j] + zs[j + 1]) / 2 };
    if (internos.some(pol => dentroDoPoligono(p, pol)) || rets.some(r => p.x > r.x0 && p.x < r.x1 && p.y > r.z0 && p.y < r.z1)) cel[j * nx + i] = 1;
  }
  // Frestas estreitas entre dois pedaços cobertos (ex.: 3 cm entre a sala e o hall) viram cobertas.
  const fechar = (n: number, m: number, lado: (k: number) => number, idx: (k: number, l: number) => number) => {
    for (let l = 0; l < m; l++) {
      let k = 0;
      while (k < n) {
        if (cel[idx(k, l)]) { k++; continue; }
        let fim = k;
        while (fim < n && !cel[idx(fim, l)]) fim++;
        if (k > 0 && fim < n && lado(fim) - lado(k) <= FRESTA_MAXIMA + 1e-6) for (let q = k; q < fim; q++) cel[idx(q, l)] = 2;
        k = fim;
      }
    }
  };
  fechar(nx, nz, k => xs[k], (k, l) => l * nx + k);
  fechar(nz, nx, k => zs[k], (k, l) => k * nx + l);
  return { xs, zs, nx, nz, cel };
}

/** Retângulos [x0, z0, x1, z1] das células cobertas (que passam no filtro), juntados por linha. */
export function retangulosDaGrade(g: Grade, filtro: (i: number, j: number, v: number) => boolean = (_i, _j, v) => v > 0): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let j = 0; j < g.nz; j++) {
    let i = 0;
    while (i < g.nx) {
      if (!filtro(i, j, g.cel[j * g.nx + i])) { i++; continue; }
      let fim = i;
      while (fim < g.nx && filtro(fim, j, g.cel[j * g.nx + fim])) fim++;
      out.push([g.xs[i], g.zs[j], g.xs[fim], g.zs[j + 1]]);
      i = fim;
    }
  }
  return out;
}

/** Borda da parte coberta: trechos retos, com o lado de dentro (+1 = coordenada crescente). */
export type Borda = { eixo: "x" | "z"; /** coordenada fixa */ em: number; de: number; ate: number; dentro: 1 | -1 };

export function bordasDaGrade(g: Grade): Borda[] {
  const cob = (i: number, j: number) => i >= 0 && j >= 0 && i < g.nx && j < g.nz && g.cel[j * g.nx + i] > 0;
  const out: Borda[] = [];
  // Bordas paralelas a z (x fixo), varrendo cada linha vertical da grade.
  for (let i = 0; i <= g.nx; i++) {
    let atual: Borda | null = null;
    for (let j = 0; j < g.nz; j++) {
      const a = cob(i - 1, j), b = cob(i, j), dentro: 1 | -1 | 0 = a === b ? 0 : b ? 1 : -1;
      if (dentro && atual && atual.dentro === dentro && Math.abs(atual.ate - g.zs[j]) < 1e-6) atual.ate = g.zs[j + 1];
      else if (dentro) { atual = { eixo: "z", em: g.xs[i], de: g.zs[j], ate: g.zs[j + 1], dentro }; out.push(atual); }
      else atual = null;
    }
  }
  for (let j = 0; j <= g.nz; j++) {
    let atual: Borda | null = null;
    for (let i = 0; i < g.nx; i++) {
      const a = cob(i, j - 1), b = cob(i, j), dentro: 1 | -1 | 0 = a === b ? 0 : b ? 1 : -1;
      if (dentro && atual && atual.dentro === dentro && Math.abs(atual.ate - g.xs[i]) < 1e-6) atual.ate = g.xs[i + 1];
      else if (dentro) { atual = { eixo: "x", em: g.zs[j], de: g.xs[i], ate: g.xs[i + 1], dentro }; out.push(atual); }
      else atual = null;
    }
  }
  return out;
}

// ── Esquadrias ──

export type ModeloEsquadria = "janela_correr" | "porta_correr" | "pivotante" | "abrir" | "portao_gradeado";

export type EsquadriaCena = {
  id: string; codigo: string; tipo: AberturaFonte["tipo"]; modelo: ModeloEsquadria;
  /** Folhas (correr) — vem da descrição ("4 folhas", "2 painéis"). */
  folhas: number;
  vidro: boolean;
  material: "madeira" | "aluminio" | "aco";
  /** Centro do vão no eixo da parede e giro (igual ao da parede: X local ao longo do vão, Z local na normal). */
  cx: number; cz: number; ang: number;
  larg: number; alt: number; esp: number;
  /** Altura do pé do vão (base da parede + peitoril). */
  y0: number;
  /** Lado da dobradiça no X local (−1 = começo do vão, +1 = fim) e lado do giro no Z local (+1 / −1). */
  dobradica: -1 | 1 | null; giro: -1 | 1 | null;
  estimado: boolean;
};

export function modeloDaEsquadria(ab: AberturaFonte): { modelo: ModeloEsquadria; folhas: number; vidro: boolean; material: EsquadriaCena["material"] } {
  const d = semAcento(`${ab.descricao ?? ""}`);
  const n = Number(/(\d+)\s*(folhas|paineis|painel)/.exec(d)?.[1] ?? 0);
  let modelo: ModeloEsquadria;
  if (ab.tipo === "portao") modelo = "portao_gradeado";
  else if (/pivot/.test(d)) modelo = "pivotante";
  else if (ab.abertura === "correr") modelo = ab.tipo === "janela" ? "janela_correr" : "porta_correr";
  else modelo = "abrir";
  const folhas = modelo === "janela_correr" || modelo === "porta_correr" ? Math.max(2, n || 2) : 1;
  const vidro = ab.tipo === "janela" || (modelo === "porta_correr" && /vidro|alumin/.test(d));
  const material = /madeira/.test(d) ? "madeira" : modelo === "portao_gradeado" ? "aco" : vidro || /alumin/.test(d) ? "aluminio" : "madeira";
  return { modelo, folhas, vidro, material };
}

// ── Saídas da cena ──

export type PisoCena = { nome: string; poligono: [number, number][]; y0: number; y1: number; acabamento: AcabamentoPiso; estimado: boolean };
export type CaixaCena = { id: string; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
export type LuzCena = { ambiente: string; x: number; y: number; z: number };
export type RotuloCena = { ambiente: string; texto: string; x: number; y: number; z: number };
export type VistaCena = {
  id: string; nome: string; tipo: "geral" | "comodo";
  ambiente: string | null;
  /** Área calculada pelo polígono e a do quadro da prancha (m²). */
  area: number | null; areaPlanta: number | null;
  pos: [number, number, number]; alvo: [number, number, number];
  estimado: boolean;
};
export type CoberturaCena = {
  /** Forro de gesso: retângulos [x0, z0, x1, z1] na altura `yForro` (espessura `ESPESSURA_FORRO`). */
  forro: [number, number, number, number][]; yForro: number;
  /** Platibanda: caixas alinhadas aos eixos, por cima das paredes, por dentro do contorno coberto. */
  platibanda: CaixaCena[];
  /** Telhas: triângulos em sequência (x, y, z) e coordenadas de textura (u, v em metros). */
  telhas: { posicoes: number[]; uvs: number[] };
  calhas: CaixaCena[];
  yBeiral: number; yCumeeira: number; yPlatibanda: number;
  inclinacao: number; material: string;
  avisos: string[];
};
export type CenaFonte = {
  nome: string;
  blocos: BlocoCena[];
  pisos: PisoCena[];
  soleiras: BlocoCena[];
  pingadeiras: BlocoCena[];
  esquadrias: EsquadriaCena[];
  cobertura: CoberturaCena;
  entorno: { solo: CaixaCena; calcada: CaixaCena; rua: CaixaCena; lote: Ret };
  luzes: LuzCena[];
  rotulos: RotuloCena[];
  vistas: VistaCena[];
  /** Caixa da casa (paredes que não são muro) e nível do piso interno. */
  casa: Ret & { piso: number; topo: number };
};

const nivelInterno = (f: FontePlanta) =>
  f.niveis.interno?.valor ?? Math.max(...f.estrutura.ambientes.filter(a => a.interno).map(a => a.piso), 0);

function caixaDaCasa(f: FontePlanta): Ret {
  const rets = f.estrutura.paredes.filter(w => !w.muro).map(retDaParede).filter((r): r is Ret => !!r);
  if (!rets.length) return { x0: 0, x1: f.estrutura.casa.w, z0: 0, z1: f.estrutura.casa.d };
  return { x0: Math.min(...rets.map(r => r.x0)), x1: Math.max(...rets.map(r => r.x1)), z0: Math.min(...rets.map(r => r.z0)), z1: Math.max(...rets.map(r => r.z1)) };
}

function caixaDoLote(f: FontePlanta): Ret {
  const rets = f.estrutura.paredes.filter(w => w.muro).map(retDaParede).filter((r): r is Ret => !!r);
  if (!rets.length) return { x0: 0, x1: f.lote.w, z0: 0, z1: f.lote.d };
  return { x0: Math.min(...rets.map(r => r.x0)), x1: Math.max(...rets.map(r => r.x1)), z0: Math.min(...rets.map(r => r.z0)), z1: Math.max(...rets.map(r => r.z1)) };
}

/** Pisos dos dois lados de um vão (ambientes a 10 cm de cada face). */
function pisosDosLados(f: FontePlanta, w: ParedeFonte, s: number): number[] {
  const { ux, uz, nx, nz } = eixoDaParede(w), out: number[] = [];
  for (const lado of [1, -1]) {
    const t = lado * (w.esp / 2 + 0.1);
    const a = ambienteEm(f, w.x1 + ux * s + nx * t, w.z1 + uz * s + nz * t);
    if (a) out.push(a.piso);
  }
  return out;
}

function cobertura(f: FontePlanta): CoberturaCena {
  const c = f.estrutura.cobertura, topo = c.topo_paredes, avisos: string[] = [];
  const ridgeEmZ = c.cumeeira.eixo === "x"; // cumeeira paralela a x: as águas caem em z
  const g = gradeCoberta(f, ridgeEmZ ? { zs: [c.cumeeira.em] } : { xs: [c.cumeeira.em] });
  const coord = (x: number, z: number) => (ridgeEmZ ? z : x);
  const cobertas = retangulosDaGrade(g);
  const cs = cobertas.flatMap(([x0, z0, x1, z1]) => [coord(x0, z0), coord(x1, z1)]);
  const cMin = cs.length ? Math.min(...cs) : 0, cMax = cs.length ? Math.max(...cs) : 0;
  const yBeiral = topo + APOIO_TELHADO;
  const yCumeeira = yBeiral + c.inclinacao * Math.max(c.cumeeira.em - cMin, cMax - c.cumeeira.em, 0);
  const yPlatibanda = topo + c.platibanda.altura;
  const alturaEm = (v: number) => yCumeeira - c.inclinacao * Math.abs(v - c.cumeeira.em);
  if (yCumeeira > yPlatibanda + 1e-6)
    avisos.push(`A cumeeira (+${yCumeeira.toFixed(2).replace(".", ",")}) passa do topo da platibanda (+${yPlatibanda.toFixed(2).replace(".", ",")}): o telhado aparece por cima dela.`);

  // Telhas: cada retângulo coberto vira dois triângulos, com a altura da água em cada canto (a cumeeira é linha da grade).
  const posicoes: number[] = [], uvs: number[] = [], k = Math.sqrt(1 + c.inclinacao * c.inclinacao);
  const v = (x: number, z: number) => {
    const cc = coord(x, z), y = alturaEm(cc);
    posicoes.push(r4(x), r4(y), r4(z));
    uvs.push(ridgeEmZ ? x : z, Math.abs(cc - c.cumeeira.em) * k);
  };
  for (const [x0, z0, x1, z1] of cobertas) {
    // Sentido anti-horário visto de cima (normal para +y).
    v(x0, z0); v(x0, z1); v(x1, z1);
    v(x0, z0); v(x1, z1); v(x1, z0);
  }

  // Platibanda: por dentro de cada borda; calha nas bordas baixas (as que olham para a cumeeira).
  const esp = c.platibanda.esp, platibanda: CaixaCena[] = [], calhas: CaixaCena[] = [];
  bordasDaGrade(g).forEach((b, n) => {
    const a = b.em, d = b.em + b.dentro * esp, eps = n * 0.0002; // tops um pouco diferentes: sem cintilação nos cantos
    const [p0, p1] = [Math.min(a, d), Math.max(a, d)];
    platibanda.push(b.eixo === "z"
      ? { id: `platibanda-${n}`, x0: p0, x1: p1, z0: b.de, z1: b.ate, y0: topo, y1: yPlatibanda + eps }
      : { id: `platibanda-${n}`, x0: b.de, x1: b.ate, z0: p0, z1: p1, y0: topo, y1: yPlatibanda + eps });
    const perpendicularAQueda = (b.eixo === "x") === ridgeEmZ;
    const olhaParaCumeeira = (b.dentro > 0 && b.em < c.cumeeira.em) || (b.dentro < 0 && b.em > c.cumeeira.em);
    if (c.calhas && perpendicularAQueda && olhaParaCumeeira) {
      const q0 = b.em + b.dentro * esp, q1 = b.em + b.dentro * (esp + 0.15), y = alturaEm((q0 + q1) / 2);
      const [m0, m1] = [Math.min(q0, q1), Math.max(q0, q1)];
      calhas.push(b.eixo === "x"
        ? { id: `calha-${n}`, x0: b.de, x1: b.ate, z0: m0, z1: m1, y0: y - 0.12, y1: y - 0.01 }
        : { id: `calha-${n}`, x0: m0, x1: m1, z0: b.de, z1: b.ate, y0: y - 0.12, y1: y - 0.01 });
    }
  });
  return {
    forro: cobertas, yForro: topo, platibanda, telhas: { posicoes, uvs }, calhas,
    yBeiral, yCumeeira, yPlatibanda, inclinacao: c.inclinacao, material: c.material, avisos,
  };
}

const ORDEM_TOUR: FuncaoComodo[] = [
  "sala", "sala_jantar", "cozinha", "quarto", "suite", "escritorio", "hall", "circulacao", "banheiro", "lavabo",
  "area_servico", "varanda", "garagem", "area_externa",
];

/** Cena completa para o visualizador do JSON-fonte. */
export function cenaDaFonte(f: FontePlanta): CenaFonte {
  const { paredes, aberturas, ambientes } = f.estrutura;
  const paredePorId = new Map(paredes.map(w => [w.id, w] as const));
  const cortes = cortesDasParedes(paredes);
  const piso = nivelInterno(f);

  // Paredes e muros.
  const blocos: BlocoCena[] = paredes.flatMap(w => trechosDaParede(w, aberturas, cortes.get(w.id)).map((t, k) =>
    blocoNaParede(w, `${w.id}-${k}`, t.s0, t.s1, t.y0, t.y1, w.esp, !w.muro && t.tipo !== "peitoril" && t.y1 >= topoDaParede(w) - 1e-6)));

  // Pisos por ambiente (do chão até o nível) e o enchimento das frestas cobertas no nível interno.
  const pisos: PisoCena[] = ambientes.map(a => ({
    nome: a.nome, poligono: a.poligono.map(([x, z]) => [x, z] as [number, number]),
    y0: 0, y1: Math.max(a.piso, 0.01), acabamento: acabamentoDoAmbiente(a), estimado: !!a.estimado,
  }));
  const g = gradeCoberta(f);
  for (const [x0, z0, x1, z1] of retangulosDaGrade(g, (_i, _j, v) => v === 2))
    pisos.push({ nome: "Ajuste entre ambientes", poligono: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], y0: 0, y1: piso, acabamento: "porcelanato", estimado: true });

  // Soleiras (portas e portões) e pingadeiras (janelas).
  const soleiras: BlocoCena[] = [], pingadeiras: BlocoCena[] = [];
  for (const ab of aberturas) {
    const w = paredePorId.get(ab.parede);
    if (!w) continue;
    const s0 = ab.offset, s1 = ab.offset + ab.larg;
    if (ab.tipo === "janela") {
      const y1 = w.base + ab.peitoril;
      pingadeiras.push(blocoNaParede(w, `pingadeira-${ab.id}`, s0 - PINGADEIRA.abas, s1 + PINGADEIRA.abas, y1 - PINGADEIRA.espessura, y1, w.esp + 2 * PINGADEIRA.avanco));
    } else {
      const lados = pisosDosLados(f, w, (s0 + s1) / 2), topo = lados.length ? Math.max(...lados) : w.base + ab.peitoril;
      const y0 = Math.min(w.base + ab.peitoril, topo - SOLEIRA.espessura);
      soleiras.push(blocoNaParede(w, `soleira-${ab.id}`, s0, s1, Math.max(0, y0), topo + 0.004, w.esp + 2 * SOLEIRA.avanco));
    }
  }

  // Esquadrias.
  const esquadrias: EsquadriaCena[] = aberturas.flatMap(ab => {
    const w = paredePorId.get(ab.parede);
    if (!w) return [];
    const { ux, uz } = eixoDaParede(w), s = ab.offset + ab.larg / 2;
    const tipo = modeloDaEsquadria(ab);
    const destino = ab.abre_para ? ambientes.find(a => a.nome === ab.abre_para) : undefined;
    const giro = ab.abertura !== "correr" && destino ? ladoDoAmbiente(w, s, destino) : null;
    return [{
      id: ab.id, codigo: ab.codigo, tipo: ab.tipo, ...tipo,
      cx: r4(w.x1 + ux * s), cz: r4(w.z1 + uz * s), ang: anguloDaParede(w),
      larg: ab.larg, alt: ab.alt, esp: w.esp, y0: r4(w.base + ab.peitoril),
      dobradica: ab.abertura === "esq" ? -1 : ab.abertura === "dir" ? 1 : null,
      giro, estimado: !!ab.estimado,
    } satisfies EsquadriaCena];
  });

  // Entorno: o lote pelos muros; calçada e rua na frente (z crescente), fora do JSON (estimadas).
  const lote = caixaDoLote(f), margem = 4;
  const entorno = {
    lote,
    solo: { id: "solo", x0: lote.x0 - margem, x1: lote.x1 + margem, z0: lote.z0 - margem, z1: lote.z1 + CALCADA.largura + RUA.largura + margem, y0: -0.03, y1: 0 },
    calcada: { id: "calcada", x0: lote.x0 - margem, x1: lote.x1 + margem, z0: lote.z1, z1: lote.z1 + CALCADA.largura, y0: 0, y1: CALCADA.nivel },
    rua: { id: "rua", x0: lote.x0 - margem, x1: lote.x1 + margem, z0: lote.z1 + CALCADA.largura, z1: lote.z1 + CALCADA.largura + RUA.largura, y0: -0.02, y1: RUA.nivel + 0.005 },
  };

  // Luz, rótulo e vista de cada cômodo.
  const uteis = ambientes.filter(a => !ehAuxiliar(a));
  const topoCasa = f.estrutura.cobertura.topo_paredes;
  const luzes: LuzCena[] = uteis.filter(a => a.interno).map(a => {
    const p = pontoInterno(pontosDe(a));
    return { ambiente: a.nome, x: r4(p.x), y: r4(topoCasa - 0.35), z: r4(p.y) };
  });
  const rotulos: RotuloCena[] = uteis.map(a => {
    const p = pontoInterno(pontosDe(a));
    return { ambiente: a.nome, texto: a.nome, x: r4(p.x), y: r4(a.piso + (a.interno ? 1.2 : 0.6)), z: r4(p.y) };
  });
  const casa = caixaDaCasa(f), cx = (casa.x0 + casa.x1) / 2, cz = (casa.z0 + casa.z1) / 2;
  const diag = Math.hypot(casa.x1 - casa.x0, casa.z1 - casa.z0);
  // Direção da vista geral do protótipo validado pelo dono: (8,5; 12,1; 8,9) a partir do centro da casa.
  const dir = [8.5, 12.1, 8.9], nd = Math.hypot(dir[0], dir[1], dir[2]), dist = diag * 1.6;
  const vistas: VistaCena[] = [{
    id: "geral", nome: "Visão geral", tipo: "geral", ambiente: null, area: null, areaPlanta: null,
    pos: [r4(cx + (dir[0] / nd) * dist), r4(piso + (dir[1] / nd) * dist), r4(cz + (dir[2] / nd) * dist)],
    alvo: [r4(cx), piso, r4(cz)], estimado: false,
  }];
  const comCamera = uteis.filter(a => a.camera);
  // Ordem dos botões do tour: da sala para os fundos e, por último, a área externa (como no protótipo).
  const ordem = (a: AmbienteFonte) => {
    const k = ORDEM_TOUR.indexOf(funcaoDoAmbiente(a));
    return k < 0 ? ORDEM_TOUR.length : k;
  };
  const doTour = (comCamera.length ? comCamera : uteis.filter(x => x.area_planta != null)).map((a, k) => ({ a, k }))
    .sort((p, q) => ordem(p.a) - ordem(q.a) || p.k - q.k).map(x => x.a);
  for (const a of doTour) {
    const pts = pontosDe(a), area = Math.round(areaPoligono(pts) * 100) / 100;
    let pos: [number, number, number], alvo: [number, number, number];
    if (a.camera) {
      pos = [a.camera.x, r4(a.piso + ALTURA_OLHOS_TOUR), a.camera.z];
      alvo = [...a.camera.alvo];
    } else {
      const p = pontoInterno(pts), longe = pts.reduce((m, q) => (Math.hypot(q.x - p.x, q.y - p.y) > Math.hypot(m.x - p.x, m.y - p.y) ? q : m), pts[0]);
      pos = [r4(p.x), r4(a.piso + ALTURA_OLHOS_TOUR), r4(p.y)];
      alvo = [r4(longe.x), r4(a.piso + 1.1), r4(longe.y)];
    }
    vistas.push({ id: slug(a.nome), nome: a.nome, tipo: "comodo", ambiente: a.nome, area, areaPlanta: a.area_planta, pos, alvo, estimado: !!a.camera?.estimado || !a.camera });
  }

  return {
    nome: f.nome, blocos, pisos, soleiras, pingadeiras, esquadrias, cobertura: cobertura(f), entorno, luzes, rotulos, vistas,
    casa: { ...casa, piso, topo: topoCasa },
  };
}

// ── JSON-fonte → ModeloMaquete (o visualizador do EPIC-022 abre a mesma casa) ──

const origemDe = (x: { estimado?: boolean }) => (x.estimado ? "estimada" : "confirmada") as "estimada" | "confirmada";

/** Parede da casa com um dos lados fora de qualquer ambiente interno e de outra parede (fachada). */
function ehExterna(f: FontePlanta, w: ParedeFonte): boolean {
  const { comp, ux, uz, nx, nz } = eixoDaParede(w);
  const internos = f.estrutura.ambientes.filter(a => a.interno).map(pontosDe);
  const outras = f.estrutura.paredes.filter(v => v !== w && !v.muro).map(retDaParede).filter((r): r is Ret => !!r);
  for (let k = 0; k <= 8; k++) {
    const s = (comp * (k + 0.5)) / 9.5;
    for (const lado of [1, -1]) {
      const t = lado * (w.esp / 2 + 0.06), x = w.x1 + ux * s + nx * t, z = w.z1 + uz * s + nz * t;
      const p = { x, y: z };
      if (!internos.some(pol => dentroDoPoligono(p, pol)) && !outras.some(r => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1)) return true;
    }
  }
  return false;
}

/**
 * Estrutura do JSON-fonte como `ModeloMaquete` (tipo casa, um pavimento). Muros, portão e P1 ficam de fora do
 * pavimento (são da implantação); o lote entra na implantação. Os itens vão à parte em `pecasDaFonte`.
 */
export function fonteParaModelo(f: FontePlanta): ModeloMaquete {
  const piso = nivelInterno(f), cob = f.estrutura.cobertura;
  const paredes = f.estrutura.paredes.filter(w => !w.muro);
  const ids = new Set(paredes.map(w => w.id));
  const aberturas = f.estrutura.aberturas.filter(a => ids.has(a.parede));
  const lote = caixaDoLote(f);
  // Entrada principal: a passagem numa parede externa mais perto da rua (maior z).
  const externas = new Set(paredes.filter(w => ehExterna(f, w)).map(w => w.id));
  const passagens = aberturas.filter(a => a.tipo !== "janela" && externas.has(a.parede));
  const zDe = (a: AberturaFonte) => { const w = paredes.find(p => p.id === a.parede)!; return (w.z1 + w.z2) / 2; };
  const principal = passagens.sort((a, b) => zDe(b) - zDe(a))[0]?.id;
  const carros = (nome: string) => f.itens.filter(i => i.tipo === "carro" && i.ambiente === nome).length;
  return modeloSchema.parse({
    tipo: "casa",
    edificacoes: [{
      id: "casa", nome: "Casa",
      pavimentos: [{
        id: "terreo", nome: "Térreo", nivel: piso, peDireito: Math.max(1.8, cob.topo_paredes - piso), origemPeDireito: "confirmada",
        paredes: paredes.map(w => ({ id: w.id, a: { x: w.x1, y: w.z1 }, b: { x: w.x2, y: w.z2 }, espessura: w.esp, externa: externas.has(w.id), origem: origemDe(w) })),
        aberturas: aberturas.map(a => {
          const t = modeloDaEsquadria(a);
          return {
            id: a.id, paredeId: a.parede,
            tipo: a.tipo === "janela" ? "janela" : t.modelo === "porta_correr" && t.vidro ? "porta_janela" : "porta",
            posicao: a.offset + a.larg / 2, largura: a.larg, altura: a.alt, peitoril: a.peitoril,
            entradaPrincipal: a.id === principal, origem: origemDe(a),
          };
        }),
        comodos: f.estrutura.ambientes.filter(a => !ehAuxiliar(a)).map(a => ({
          id: slug(a.nome), nome: a.nome, funcao: funcaoDoAmbiente(a),
          poligono: a.poligono.map(([x, z]) => ({ x, y: z })),
          areaInformada: a.area_planta, origem: origemDe(a),
          ...(funcaoDoAmbiente(a) === "garagem" ? { vagas: carros(a.nome) } : {}),
        })),
      }],
      cobertura: { tipo: cob.tipo, inclinacao: cob.inclinacao * 100, beiral: 0, origem: origemDe(cob) },
    }],
    implantacao: {
      terreno: [{ x: lote.x0, y: lote.z0 }, { x: lote.x1, y: lote.z0 }, { x: lote.x1, y: lote.z1 }, { x: lote.x0, y: lote.z1 }],
      lotes: [{ id: "lote", nome: f.nome.slice(0, 40), poligono: [{ x: lote.x0, y: lote.z0 }, { x: lote.x1, y: lote.z0 }, { x: lote.x1, y: lote.z1 }, { x: lote.x0, y: lote.z1 }], areaInformada: f.lote.w * f.lote.d }],
      posicoes: [{ id: "casa-1", edificacaoId: "casa", nome: "Casa", x: 0, y: 0, rotacao: 0 }],
    },
  });
}

/** Item do JSON como peça do catálogo de móveis, com a altura do piso do ambiente (`y`). */
export type PecaFonte = PecaMobilia & { y: number; estimado: boolean };

/** Os `itens` do JSON-fonte, prontos para o catálogo (substituem a mobília automática). */
export function pecasDaFonte(f: FontePlanta): PecaFonte[] {
  return f.itens.map(i => ({
    id: i.id, tipo: i.tipo, comodoId: slug(i.ambiente),
    x: i.x, z: i.z, rot: (i.rot * Math.PI) / 180,
    largura: i.larg, profundidade: i.prof, altura: i.alt, elevacao: i.elev ?? 0,
    opcoes: { ...(i.opcoes ?? {}) },
    y: pisoDoItem(f, i), estimado: !!i.estimado,
  }));
}
