// Tipologia "VIAS PÚBLICAS": desmembramento de terreno cujas divisas JÁ são vias públicas.
//
// Não há via interna: toda divisa (do lado de fora e do lado de dentro, como a de uma rua com
// balão que entra no terreno) é frente de lote. Os lotes são implantados ao longo de cada trecho
// da divisa (quebras em cantos vivos), com frente ≥ testada sobre a via, fundo até a profundidade
// informada e área ≥ mínima (a frente cresce onde a faixa é rasa). Depois, toda sobra é
// incorporada: o que tem frente e área próprias vira lote; o resto é anexado ao lote vizinho —
// 100% de aproveitamento. Determinístico.

import { difference, featureCollection, polygon as turfPolygon, union } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { areaPlanar, type LoteFrame, type Ret } from "./geometria-parcelamento.js";
import { implantarNaDivisa, type ImplantacaoViaDivisa } from "./rua-divisa.js";

export interface OpcoesViasPublicas { testada: number; profundidade: number; loteMinimoM2: number }

type Geo = Feature<Polygon | MultiPolygon>;
const comprimento = (a: Position, b: Position) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const poligonos = (g: Polygon | MultiPolygon): Position[][][] => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
const bbox = (a: Position[]): Ret => {
  const xs = a.map((p) => p[0]), ys = a.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
function seguro<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }

/** Trechos contínuos da divisa (quebra nos cantos com deflexão > `quebraGraus`). Anel suave: duas metades. */
export function trechosDaDivisa(anelFechado: Position[], quebraGraus = 45): number[][] {
  const v = anelFechado.slice(0, -1);
  const n = v.length;
  const rumo = (i: number) => Math.atan2(v[(i + 1) % n][1] - v[i][1], v[(i + 1) % n][0] - v[i][0]);
  const quebras: number[] = [];
  for (let i = 0; i < n; i++) {
    let d = ((rumo(i) - rumo((i - 1 + n) % n)) * 180) / Math.PI;
    d = ((d + 540) % 360) - 180;
    if (Math.abs(d) > quebraGraus) quebras.push(i);
  }
  if (quebras.length === 0) {
    const meio = Math.floor(n / 2);
    return [Array.from({ length: meio }, (_, i) => i), Array.from({ length: n - meio }, (_, i) => meio + i)];
  }
  const out: number[][] = [];
  for (let k = 0; k < quebras.length; k++) {
    const a = quebras[k], b = quebras[(k + 1) % quebras.length];
    const arestas: number[] = [];
    for (let i = a; i !== b || arestas.length === 0; i = (i + 1) % n) { arestas.push(i); if (arestas.length > n) break; }
    out.push(arestas);
  }
  return out;
}

/** Distância do ponto ao contorno da gleba. */
function distContorno(anel: Position[], p: Position): number {
  let m = Infinity;
  for (let i = 0; i < anel.length - 1; i++) {
    const a = anel[i], b = anel[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    m = Math.min(m, Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)));
  }
  return m;
}

/** Comprimento do contorno da peça que coincide com a divisa da gleba (= frente para a via pública). */
export function frenteNaDivisa(gleba: Position[], peca: Position[]): number {
  let f = 0;
  for (let i = 0; i < peca.length - 1; i++) {
    const a = peca[i], b = peca[i + 1];
    const meio: Position = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (distContorno(gleba, a) < 0.05 && distContorno(gleba, b) < 0.05 && distContorno(gleba, meio) < 0.05) f += comprimento(a, b);
  }
  return f;
}

/** Incorpora toda a sobra: vira lote quando tem frente e área próprias; senão vai para o lote vizinho. */
export function completarAproveitamento(gleba: Position[], lotes: LoteFrame[], o: OpcoesViasPublicas): LoteFrame[] {
  if (lotes.length === 0) return lotes;
  const glebaF = turfPolygon([gleba]);
  const uniao = seguro(() => (lotes.length === 1 ? turfPolygon([lotes[0].anel]) : union(featureCollection(lotes.map((l) => turfPolygon([l.anel]))))));
  if (!uniao) return lotes;
  const sobra = seguro(() => difference(featureCollection([glebaF, uniao as Geo])) as Geo | null);
  if (!sobra) return lotes;
  const pecas = poligonos(sobra.geometry as Polygon | MultiPolygon).map((rs) => rs[0]).filter((a) => areaPlanar(a) > 0.01)
    .sort((a, b) => areaPlanar(b) - areaPlanar(a));
  const out = lotes.map((l) => ({ ...l }));
  for (const peca of pecas) {
    const area = areaPlanar(peca);
    const frente = frenteNaDivisa(gleba, peca);
    if (area >= o.loteMinimoM2 && frente >= o.testada - 1e-6) {
      out.push({ anel: peca, area, ret: bbox(peca), linha: 0, faixa: 0, segmento: 0, ordem: out.length, testada: frente, profundidadeMedia: area / frente });
      continue;
    }
    // vizinho: o lote cuja união com a peça é um polígono só (encostam); fica com o menor deles
    const rp = bbox(peca);
    let melhor: { i: number; anel: Position[] } | null = null;
    out.forEach((l, i) => {
      if (l.ret[2] < rp[0] - 0.01 || rp[2] < l.ret[0] - 0.01 || l.ret[3] < rp[1] - 0.01 || rp[3] < l.ret[1] - 0.01) return;
      const u = seguro(() => union(featureCollection([turfPolygon([l.anel]), turfPolygon([peca])])));
      if (!u || u.geometry.type !== "Polygon" || u.geometry.coordinates.length > 1) return;
      if (!melhor || out[melhor.i].area > l.area) melhor = { i, anel: u.geometry.coordinates[0] };
    });
    const m = melhor as { i: number; anel: Position[] } | null;
    if (m) {
      const novo = areaPlanar(m.anel);
      const t = out[m.i].testada ?? o.testada;
      out[m.i] = { ...out[m.i], anel: m.anel, area: novo, ret: bbox(m.anel), testada: Math.max(t, frenteNaDivisa(gleba, m.anel) || t), profundidadeMedia: novo / Math.max(t, 1e-9) };
    }
  }
  return out.map((l, i) => ({ ...l, ordem: i }));
}

/** Desmembra a gleba com frente para as vias públicas existentes. Devolve as melhores variações. */
export function buscarViasPublicas(anelFechado: Position[], o: OpcoesViasPublicas, max = 4, onProgress?: (f: number) => void): ImplantacaoViaDivisa[] {
  // ordem: trechos convexos/retos (do maior para o menor) e, por último, os côncavos — como o contorno de
  // um balão de retorno que entra no terreno, onde os lotes ficam em leque e só ocupam o que sobrou
  const v = anelFechado.slice(0, -1), n = v.length;
  let s2 = 0;
  for (let i = 0; i < n; i++) s2 += v[i][0] * v[(i + 1) % n][1] - v[(i + 1) % n][0] * v[i][1];
  const ccw = s2 > 0;
  const rumo = (i: number) => Math.atan2(v[(i + 1) % n][1] - v[i][1], v[(i + 1) % n][0] - v[i][0]);
  const giro = (c: number[]) => {
    let g = 0;
    for (let k = 1; k < c.length; k++) { let d = rumo(c[k]) - rumo(c[k - 1]); d = Math.atan2(Math.sin(d), Math.cos(d)); g += d; }
    return ccw ? g : -g; // > 0: convexo; < 0: côncavo (reentrante)
  };
  const info = trechosDaDivisa(anelFechado)
    .map((c, pos) => ({ c, pos, m: c.reduce((s, i) => s + comprimento(anelFechado[i], anelFechado[i + 1]), 0), concavo: giro(c) < -0.3 }))
    .filter((x) => x.m >= o.testada);
  if (info.length === 0) return [];
  const porTamanho = [...info].sort((a, b) => Number(a.concavo) - Number(b.concavo) || b.m - a.m || a.pos - b.pos);
  // 2ª ordem: o maior trecho e depois os vizinhos na sequência do contorno (côncavos sempre por último)
  const k0 = porTamanho[0].pos, N = info.length;
  const porContorno = [...info].sort((a, b) => Number(a.concavo) - Number(b.concavo) || ((a.pos - k0 + N) % N) - ((b.pos - k0 + N) % N));
  const ordens = [porTamanho.map((x) => x.c)];
  if (porContorno.some((x, i) => x !== porTamanho[i])) ordens.push(porContorno.map((x) => x.c));
  const opc = { testada: o.testada, profundidade: o.profundidade, via: 0, loteMinimoM2: o.loteMinimoM2 };
  const extras = (ocupados: Position[][]) => ({ semVia: true, ocupados, fundoMaxM: o.profundidade });
  const t = o.testada;
  const iniciais: { reverso: boolean; fase: number; raio: number; ordem: number }[] = [];
  ordens.forEach((_, ordem) => { for (const raio of [0, 2 * t]) for (const reverso of [false, true]) iniciais.push({ reverso, fase: 0, raio, ordem }); });
  const total = iniciais.length * info.length;
  let feitos = 0;
  const resultados: ImplantacaoViaDivisa[] = [];
  for (const ini of iniciais) {
    const lotes: LoteFrame[] = [];
    const chaves: string[] = [];
    const trechos = ordens[ini.ordem];
    trechos.forEach((tr, k) => {
      const variantes = k === 0 ? [ini, { ...ini, fase: t / 2 }]
        : [false, true].flatMap((reverso) => [0, t / 2].map((fase) => ({ reverso, fase, raio: ini.raio })));
      let melhor: ImplantacaoViaDivisa | null = null;
      for (const v of variantes) {
        const r = implantarNaDivisa(anelFechado, tr, v.reverso, v.fase, opc, v.raio, extras(lotes.map((l) => l.anel)));
        if (r && (!melhor || r.lotes.length > melhor.lotes.length)) melhor = r;
      }
      feitos += k === 0 ? 1 : 1;
      onProgress?.(Math.min(1, feitos / total));
      const m = melhor as ImplantacaoViaDivisa | null;
      if (m) { lotes.push(...m.lotes); chaves.push(m.chave); }
    });
    const completos = completarAproveitamento(anelFechado, lotes, o);
    if (completos.length === 0) continue;
    const perimetro = anelFechado.slice(0, -1).reduce((s, p, i) => s + comprimento(p, anelFechado[i + 1]), 0);
    resultados.push({
      lotes: completos, corredores: [], baloes: [], viasLivres: [], candidatos: completos.length,
      arestasDivisa: ordens[ini.ordem].flat(), comprimentoViaM: 0, comprimentoDisponivelM: perimetro,
      chave: `vp|o${ini.ordem}|${ini.reverso ? "r" : "d"}|${ini.fase}|r${ini.raio}|${chaves.join("/")}`,
      limitacoes: [
        `Vias públicas: todas as divisas da gleba (por fora e por dentro) já são frente para via pública — sem via interna. Lotes com frente ≥ ${t.toLocaleString("pt-BR")} m sobre a divisa (maior onde a faixa é rasa), fundo de até ${o.profundidade.toLocaleString("pt-BR")} m e área ≥ ${o.loteMinimoM2.toLocaleString("pt-BR")} m²; as sobras são incorporadas aos lotes vizinhos (100% de aproveitamento).`,
        "Confirme em projeto que todas as divisas são de fato vias públicas oficiais (testada para logradouro existente).",
      ],
    });
  }
  const somaArea = (r: ImplantacaoViaDivisa) => r.lotes.reduce((s, l) => s + l.area, 0);
  resultados.sort((a, b) => b.lotes.length - a.lotes.length || somaArea(b) - somaArea(a) || (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0));
  // todas aproveitam 100% da área: o que diferencia é a quantidade de lotes — só seguem as de maior quantidade
  const maxLotes = resultados[0]?.lotes.length ?? 0;
  return resultados.filter((r) => r.lotes.length === maxLotes).slice(0, max);
}
