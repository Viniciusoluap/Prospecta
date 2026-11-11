// Vias públicas — desmembramento "em faixas", como no projeto aprovado do Lote 01 Qd O
// (SEPLU, processo 1769/2026, memorial descritivo de 60 lotes):
//
// 1. Uma via é a REFERÊNCIA (no aprovado, a Rua das Andorinhas com a rotatória). Os lotes dela
//    têm fundo fixo P = metade da largura entre as duas divisas retas paralelas mais longas
//    (lotes de costas: 33,62 ÷ 2 = 16,81 m) e frente = área mínima ÷ P (125 ÷ 16,81 = 7,44 m).
//    Onde a frente mínima manda (leque da rotatória), a frente fica na mínima e o fundo encolhe
//    até fechar a área (13,5–13,8 m no aprovado).
// 2. O resto do terreno fica para as outras vias (Uirapurus e Marrecos). As laterais desses
//    lotes seguem a mesma direção das laterais da referência, de costas para ela. A frente de
//    cada um é a que fecha a área mínima, nunca abaixo da testada (fundos de 17 a 28 m no aprovado).
// 3. Cada lado é dividido das duas pontas para o meio com lotes de área exata; a sobra fica nos
//    lotes do meio e nas esquinas. Nada sobra: 100% de aproveitamento.
// Determinístico. A via de referência é escolhida pela busca (a que rende mais lotes regulares).

import { difference, featureCollection, intersect, polygon as turfPolygon, union } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { areaPlanar, type LoteFrame, type Ret } from "./geometria-parcelamento.js";

export interface OpcoesFaixas { testada: number; profundidade: number; loteMinimoM2: number }

type P2 = [number, number];
interface Amostra { u: number; s: number; p: P2; th: number }
type Geo = Feature<Polygon | MultiPolygon>;

const EPS = 1e-9;
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P2, k: number): P2 => [a[0] * k, a[1] * k];
const cruz = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0];
const dist = (a: Position, b: Position) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const dir = (th: number): P2 => [Math.cos(th), Math.sin(th)];
const bbox = (a: Position[]): Ret => {
  const xs = a.map((p) => p[0]), ys = a.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
function seguro<T>(fn: () => T): T | null { try { return fn(); } catch { return null; } }

function areaAssinada(pts: P2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}

/** Recorta o polígono (qualquer) pelo quadrilátero convexo anti-horário (Sutherland–Hodgman): devolve a área. */
function areaRecortada(sujeito: P2[], clip: P2[]): number {
  let saida = sujeito;
  for (let i = 0; i < clip.length && saida.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], ab = sub(b, a);
    const dentro = (p: P2) => cruz(ab, sub(p, a)) >= -1e-12;
    const entrada = saida; saida = [];
    for (let k = 0; k < entrada.length; k++) {
      const p = entrada[k], q = entrada[(k + 1) % entrada.length];
      const dp = dentro(p), dq = dentro(q);
      if (dp) saida.push(p);
      if (dp !== dq) {
        const pq = sub(q, p), den = cruz(ab, pq);
        if (Math.abs(den) > EPS) saida.push(add(p, mul(pq, cruz(ab, sub(a, p)) / den)));
      }
    }
  }
  return saida.length >= 3 ? Math.abs(areaAssinada(saida)) : 0;
}

/** Comprimento do segmento [p,q] dentro do quadrilátero convexo (Cyrus–Beck), como sub-segmento. */
function recortarSegmento(p: P2, q: P2, clip: P2[]): [P2, P2] | null {
  let t0 = 0, t1 = 1;
  const d = sub(q, p);
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], ab = sub(b, a);
    const num = cruz(ab, sub(p, a)), den = cruz(ab, d);
    if (Math.abs(den) < EPS) { if (num < -1e-12) return null; continue; }
    const t = -num / den;
    if (den > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return t1 - t0 > 1e-12 ? [add(p, mul(d, t0)), add(p, mul(d, t1))] : null;
}

/** Distância do ponto, na direção `u`, até cruzar o contorno (∞ se não cruza). */
function atravessar(anel: P2[], o: P2, u: P2): number {
  let m = Infinity;
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i], b = anel[(i + 1) % anel.length], ab = sub(b, a);
    const den = cruz(u, ab);
    if (Math.abs(den) < EPS) continue;
    const ao = sub(a, o), t = cruz(ao, ab) / den, w = cruz(ao, u) / den;
    if (t > 1e-6 && w >= -1e-9 && w <= 1 + 1e-9) m = Math.min(m, t);
  }
  return m;
}

/**
 * Largura de referência: distância entre as duas divisas retas paralelas mais longas que se encaram
 * por dentro do terreno (lotes de costas). Sem par paralelo: null.
 */
export function larguraReferencia(anel: P2[], minimo: number): number | null {
  const n = anel.length;
  let melhor: { w: number; peso: number } | null = null;
  for (let i = 0; i < n; i++) {
    const a = anel[i], b = anel[(i + 1) % n], li = dist(a, b);
    if (li < minimo) continue;
    const ti = mul(sub(b, a), 1 / li), ni: P2 = [-ti[1], ti[0]];
    const meio = mul(add(a, b), 0.5);
    const w = atravessar(anel, add(meio, mul(ni, 1e-4)), ni);
    if (!Number.isFinite(w)) continue;
    const alvo = add(meio, mul(ni, w));
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const c = anel[j], d = anel[(j + 1) % n], lj = dist(c, d);
      if (lj < minimo) continue;
      const tj = mul(sub(d, c), 1 / lj);
      if (ti[0] * tj[0] + ti[1] * tj[1] > -Math.cos((3 * Math.PI) / 180)) continue; // opostas (±3°)
      const cd = sub(d, c), k = Math.max(0, Math.min(1, ((alvo[0] - c[0]) * cd[0] + (alvo[1] - c[1]) * cd[1]) / (lj * lj)));
      if (dist(add(c, mul(cd, k)), alvo) > 0.05) continue; // o raio do meio de i encontra j
      const peso = Math.min(li, lj);
      if (!melhor || peso > melhor.peso) melhor = { w, peso };
    }
  }
  return melhor ? melhor.w : null;
}

/**
 * Amostras ao longo da via de referência (arestas consecutivas do anel anti-horário), com extensão
 * `E` além das pontas. `s` = comprimento real ao longo da via; `u` = parâmetro de corte (cresce também
 * nos leques dos vértices côncavos, para que o leque possa ser dividido entre lotes). `th` é o ângulo
 * da normal para dentro; em cantos convexos a normal gira devagar o bastante para as laterais não se
 * cruzarem até `L` metros (ajuste do lado mais curto do canto).
 */
function amostrar(anel: P2[], arestas: number[], ds: number, L: number, E: number, kappa: number): Amostra[] {
  const n = anel.length;
  const cru: { s: number; p: P2; th: number }[] = [];
  let s = 0, phiAnt: number | null = null;
  const angs: number[] = [];
  for (const i of arestas) {
    const a = anel[i], b = anel[(i + 1) % n];
    let phi = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (phiAnt !== null) { let d = phi - phiAnt; d = Math.atan2(Math.sin(d), Math.cos(d)); phi = phiAnt + d; }
    phiAnt = phi; angs.push(phi);
  }
  const e0 = anel[arestas[0]], th0 = angs[0] + Math.PI / 2, t0 = dir(angs[0]);
  for (let k = Math.ceil(E / ds); k >= 1; k--) cru.push({ s: -k * ds, p: sub(e0 as P2, mul(t0, k * ds)), th: th0 });
  arestas.forEach((i, k) => {
    const a = anel[i], b = anel[(i + 1) % n], len = dist(a, b), th = angs[k] + Math.PI / 2, t = dir(angs[k]);
    const passos = Math.max(1, Math.ceil(len / ds));
    for (let j = 0; j <= passos; j++) cru.push({ s: s + (len * j) / passos, p: add(a, mul(t, (len * j) / passos)), th });
    s += len;
  });
  const ult = arestas[arestas.length - 1], eF = anel[(ult + 1) % n], thF = angs[angs.length - 1] + Math.PI / 2, tF = dir(angs[angs.length - 1]);
  for (let k = 1; k <= Math.ceil(E / ds); k++) cru.push({ s: s + k * ds, p: add(eF, mul(tF, k * ds)), th: thF });
  // normais que convergem (canto convexo) não podem girar mais que Δs ÷ L
  const N = cru.length, g = cru.map((a) => a.th - a.s / L);
  const baixo = new Array<number>(N), alto = new Array<number>(N);
  for (let k = 0, m = Infinity; k < N; k++) { m = Math.min(m, g[k]); baixo[k] = m + cru[k].s / L; }
  for (let k = N - 1, m = -Infinity; k >= 0; k--) { m = Math.max(m, g[k]); alto[k] = m + cru[k].s / L; }
  const th = cru.map((a) => a.th);
  for (let i = 0; i < N; i++) {
    if (!(baixo[i] < cru[i].th - 1e-9) || (i > 0 && baixo[i - 1] < cru[i - 1].th - 1e-9)) continue;
    let j = i; while (j + 1 < N && baixo[j + 1] < cru[j + 1].th - 1e-9) j++;
    let h = i - 1; while (h >= 0 && alto[h] > cru[h].th + 1e-9) h--;
    const lenBaixo = cru[j].s - cru[i].s, lenAlto = i - 1 > h ? cru[i - 1].s - cru[h + 1].s : Infinity;
    if (lenAlto < lenBaixo) for (let k = h + 1; k <= i - 1; k++) th[k] = alto[k];
    else for (let k = i; k <= j; k++) th[k] = baixo[k];
  }
  // leques (rotação para fora): sub-amostras a cada 2° e parâmetro u crescendo κ por radiano
  const out: Amostra[] = [];
  let u = 0;
  for (let k = 0; k < N; k++) {
    if (k > 0) {
      const ds_ = cru[k].s - cru[k - 1].s, dth = th[k] - th[k - 1];
      if (ds_ < EPS && dth < -1e-9) {
        const passos = Math.ceil(-dth / ((2 * Math.PI) / 180));
        for (let j = 1; j < passos; j++) { u += (kappa * -dth) / passos; out.push({ u, s: cru[k].s, p: cru[k].p, th: th[k - 1] + (dth * j) / passos }); }
        u += (kappa * -dth) / passos;
      } else u += ds_ + (dth < 0 ? kappa * -dth : 0);
    }
    out.push({ u, s: cru[k].s, p: cru[k].p, th: th[k] });
  }
  return out;
}

/** Ponto e normal no parâmetro `u` (interpolação linear entre amostras). */
function emU(am: Amostra[], u: number): Amostra {
  if (u <= am[0].u) return am[0];
  if (u >= am[am.length - 1].u) return am[am.length - 1];
  let lo = 0, hi = am.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (am[m].u <= u) lo = m; else hi = m; }
  const a = am[lo], b = am[hi], f = b.u - a.u > EPS ? (u - a.u) / (b.u - a.u) : 1;
  return { u, s: a.s + (b.s - a.s) * f, p: add(a.p, mul(sub(b.p, a.p), f)), th: a.th + (b.th - a.th) * f };
}
/** Menor u com s(u) ≥ alvo. */
function uDeS(am: Amostra[], alvo: number): number {
  let lo = 0, hi = am.length - 1;
  if (am[hi].s < alvo) return am[hi].u;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (am[m].s >= alvo) hi = m; else lo = m; }
  const a = am[lo], b = am[hi];
  if (a.s >= alvo) return a.u;
  return a.u + (b.u - a.u) * ((alvo - a.s) / Math.max(b.s - a.s, EPS));
}

/** Amostras do intervalo [u0, u1] (com as pontas exatas). */
function trecho(am: Amostra[], u0: number, u1: number): Amostra[] {
  const out: Amostra[] = [emU(am, u0)];
  let lo = 0, hi = am.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (am[m].u <= u0 + EPS) lo = m + 1; else hi = m; }
  for (let k = lo; k < am.length && am[k].u < u1 - EPS; k++) out.push(am[k]);
  out.push(emU(am, u1));
  return out;
}

const topo = (a: Amostra, d: number): P2 => add(a.p, mul(dir(a.th), d));
const quad = (a: Amostra, b: Amostra, d: number): P2[] => [a.p, b.p, topo(b, d), topo(a, d)];

/** Polígono entre u0 e u1, da profundidade `d0(a)` até `d1(a)` (base na via de referência). */
function faixa(am: Amostra[], u0: number, u1: number, d0: (u: number, lado: -1 | 1) => number, d1: number, quebras: number[] = []): P2[] {
  const t = trecho(am, u0, u1);
  // nas quebras de fundo (divisa entre lotes da referência) entram dois pontos: fundo de cada lado
  const base: P2[] = [];
  for (const q of quebras) if (q > u0 + EPS && q < u1 - EPS && !t.some((a) => Math.abs(a.u - q) < EPS)) t.push(emU(am, q));
  t.sort((x, y) => x.u - y.u);
  for (const a of t) {
    const e = d0(a.u, -1), d = d0(a.u, 1);
    base.push(topo(a, e));
    if (Math.abs(e - d) > 1e-9) base.push(topo(a, d));
  }
  const pts: P2[] = [...base, ...[...t].reverse().map((a) => topo(a, d1))];
  const limpo: P2[] = [];
  for (const p of pts) if (!limpo.length || dist(limpo[limpo.length - 1], p) > 1e-7) limpo.push(p);
  if (limpo.length > 1 && dist(limpo[0], limpo[limpo.length - 1]) < 1e-7) limpo.pop();
  return limpo;
}

interface LoteRef { u0: number; u1: number; d: number }

function poligonoGeo(pts: P2[]): Geo | null {
  if (pts.length < 3) return null;
  const anel = areaAssinada(pts) < 0 ? [...pts].reverse() : pts;
  return seguro(() => turfPolygon([[...anel, anel[0]]]));
}
function pecas(g: Geo | null): Position[][] {
  if (!g) return [];
  const gm = g.geometry;
  return (gm.type === "Polygon" ? [gm.coordinates] : gm.coordinates).map((r) => r[0]).filter((r) => areaPlanar(r) > 1e-4);
}

/** Menor x em [lo, hi] com f(x) ≥ alvo (f não decrescente); null se nem f(hi) chega. */
function busca(f: (x: number) => number, alvo: number, lo: number, hi: number): number | null {
  if (hi < lo || f(hi) < alvo) return null;
  for (let it = 0; it < 50; it++) { const m = (lo + hi) / 2; if (f(m) >= alvo) hi = m; else lo = m; }
  return hi;
}

/** Desmembramento em faixas com a via de referência `arestas` (índices do anel anti-horário). */
function implantarFaixas(anel: P2[], arestas: number[], o: OpcoesFaixas, P: number): { lotes: LoteFrame[]; regulares: number } | null {
  const A = o.loteMinimoM2, t = o.testada;
  const comp = arestas.reduce((s, i) => s + dist(anel[i], anel[(i + 1) % anel.length]), 0);
  if (comp < 2 * t) return null;
  // comprimento das laterais: alcança o ponto da gleba mais distante da via de referência
  const viaPts = arestas.map((i) => anel[i]).concat([anel[(arestas[arestas.length - 1] + 1) % anel.length]]);
  const distVia = (q: P2) => {
    let m = Infinity;
    for (let k = 0; k + 1 < viaPts.length; k++) {
      const a = viaPts[k], b = viaPts[k + 1], ab = sub(b, a), L2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
      const f = Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / L2));
      m = Math.min(m, dist(q, add(a, mul(ab, f))));
    }
    return m;
  };
  const Lg = Math.max(P, ...anel.map(distVia)) * 1.15 + 2;
  const am = amostrar(anel, arestas, 0.5, Lg, Lg, P);
  if (process.env.DBG_FAIXAS) { const ruins = []; for (let k = 1; k < am.length; k++) { const d = am[k].th - am[k - 1].th - (am[k].s - am[k - 1].s) / Lg; if (d > 1e-6) ruins.push(`${am[k].s.toFixed(2)}:${(d * 180 / Math.PI).toFixed(2)}`); } console.log('cruzam', ruins.length, ruins.slice(0, 12).join(' ')); }
  const uIni = am[0].u, uFim = am[am.length - 1].u;
  const u0Via = uDeS(am, 0), u1Via = uDeS(am, comp);
  const sDe = (u: number) => emU(am, u).s;
  const alvoA = A + 0.005;

  // ── 1. lotes da via de referência ──
  const areaRef = (u0: number, u1: number, d: number) => {
    const tr = trecho(am, u0, u1);
    let soma = 0;
    for (let k = 0; k + 1 < tr.length; k++) soma += areaRecortada(anel, quad(tr[k], tr[k + 1], d));
    return soma;
  };
  const fundoQueFecha = (a: number, b: number) => (areaRef(a, b, P) > alvoA + 0.01 ? (busca((y) => areaRef(a, b, y), alvoA, 0, P) ?? P) : P);
  /** Lote a partir de `de` no sentido dado: área exata, frente ≥ testada, fundo ≤ P. */
  const loteRef = (de: number, lim: number, sentido: 1 | -1): LoteRef | null => {
    const ar = (x: number) => (sentido > 0 ? areaRef(de, de + x, P) : areaRef(de - x, de, P));
    const span = Math.abs(lim - de);
    const xa = busca(ar, alvoA, 0, span);
    if (xa === null) return null;
    // frente mínima: comprimento real (s) ≥ testada
    const sDe0 = sDe(de);
    const uFrente = sentido > 0 ? uDeS(am, sDe0 + t) : (() => { const r = busca((y) => sDe0 - sDe(de - y), t, 0, span); return r === null ? lim : de - r; })();
    const xf = Math.abs(uFrente - de);
    if (xf > span + EPS) return null;
    const x = Math.max(xa, xf);
    const [a, b] = sentido > 0 ? [de, de + x] : [de - x, de];
    return { u0: a, u1: b, d: x > xa + EPS ? fundoQueFecha(a, b) : P };
  };
  const esquerda: LoteRef[] = [], direita: LoteRef[] = [];
  let L = u0Via, R = u1Via;
  for (let lado = 0; ; lado++) {
    if (areaRef(L, R, P) < 3 * A || sDe(R) - sDe(L) < 3 * t) break;
    const l = lado % 2 === 0 ? loteRef(L, R, 1) : loteRef(R, L, -1);
    if (!l) break;
    if (lado % 2 === 0) { esquerda.push(l); L = l.u1; } else { direita.push(l); R = l.u0; }
  }
  // meio: frentes iguais; o fundo de cada um fecha a área (≤ P)
  const meio: LoteRef[] = [];
  const sL = sDe(L), sR = sDe(R);
  for (let m = Math.min(Math.floor((sR - sL) / t + EPS), Math.floor(areaRef(L, R, P) / A + EPS)); m >= 1; m--) {
    const cortes = Array.from({ length: m + 1 }, (_, k) => (k === 0 ? L : k === m ? R : uDeS(am, sL + ((sR - sL) * k) / m)));
    const tent: LoteRef[] = [];
    let ok = true;
    for (let k = 0; k < m && ok; k++) {
      const a = cortes[k], b = cortes[k + 1];
      if (areaRef(a, b, P) < alvoA) ok = false;
      else tent.push({ u0: a, u1: b, d: fundoQueFecha(a, b) });
    }
    if (ok) { meio.push(...tent); break; }
  }
  let refs = [...esquerda, ...meio, ...[...direita].reverse()];
  if (!meio.length && refs.length) {
    // sem lote no meio: a sobra vai para o vizinho (fundo até P)
    const i = esquerda.length - 1;
    if (i >= 0) refs[i] = { ...refs[i], u1: R, d: P };
    else { refs[0] = { ...refs[0], u0: L, d: P }; }
  }
  refs = refs.filter((r) => r.u1 - r.u0 > EPS);
  if (!refs.length) return null;

  // ── 2. o resto (lado de trás), com as laterais na direção das da referência ──
  const fundoEm = (u: number, lado: -1 | 1 = 1) => {
    for (const r of refs) if (lado > 0 ? u >= r.u0 - EPS && u < r.u1 - EPS : u > r.u0 + EPS && u <= r.u1 + EPS) return r.d;
    return 0;
  };
  const quebras = refs.flatMap((r) => [r.u0, r.u1]);
  const lista: Amostra[] = [...am];
  for (const q of quebras) if (!am.some((a) => Math.abs(a.u - q) < EPS)) lista.push(emU(am, q));
  lista.sort((a, b) => a.u - b.u);
  const cel: { a: Amostra; b: Amostra; area: number; frente: number }[] = [];
  for (let k = 0; k + 1 < lista.length; k++) {
    const a = lista[k], b = lista[k + 1];
    if (b.u - a.u <= EPS) continue;
    const d = fundoEm((a.u + b.u) / 2);
    const qG = quad(a, b, Lg);
    const area = Math.max(0, areaRecortada(anel, qG) - (d > 0 ? areaRecortada(anel, quad(a, b, d)) : 0));
    // frente: contorno da gleba dentro da célula, além do fundo do lote da referência
    let frente = 0;
    const nm = dir((a.th + b.th) / 2), base = a.p;
    for (let i = 0; i < anel.length; i++) {
      const seg = recortarSegmento(anel[i], anel[(i + 1) % anel.length], qG);
      if (!seg) continue;
      const h0 = (seg[0][0] - base[0]) * nm[0] + (seg[0][1] - base[1]) * nm[1];
      const h1 = (seg[1][0] - base[0]) * nm[0] + (seg[1][1] - base[1]) * nm[1];
      const lim = d + 1e-6, len = dist(seg[0], seg[1]);
      if (h0 > lim && h1 > lim) frente += len;
      else if (h0 > lim || h1 > lim) frente += (len * (Math.max(h0, h1) - lim)) / Math.max(Math.abs(h1 - h0), EPS);
    }
    cel.push({ a, b, area, frente });
  }
  const acA = [0], acF = [0];
  for (const c of cel) { acA.push(acA[acA.length - 1] + c.area); acF.push(acF[acF.length - 1] + c.frente); }
  const idx = (u: number) => { let lo = 0, hi = cel.length; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cel[m].a.u <= u) lo = m; else hi = m; } return lo; };
  const parcial = (c: (typeof cel)[number], u0: number, u1: number) => Math.max(0, Math.min(u1, c.b.u) - Math.max(u0, c.a.u)) / (c.b.u - c.a.u);
  const acum = (ac: number[], campo: "area" | "frente", u0: number, u1: number) => {
    if (u1 <= u0) return 0;
    const i0 = idx(u0), i1 = idx(u1);
    if (i0 === i1) return cel[i0][campo] * parcial(cel[i0], u0, u1);
    return cel[i0][campo] * parcial(cel[i0], u0, u1) + ac[i1] - ac[i0 + 1] + cel[i1][campo] * parcial(cel[i1], u0, u1);
  };
  const areaZ = (u0: number, u1: number) => acum(acA, "area", u0, u1);
  const frenteZ = (u0: number, u1: number) => acum(acF, "frente", u0, u1);
  const alvoZ = A + 0.3; // folga da aproximação por células (conferida no polígono final)
  const passo = (de: number, lim: number, sentido: 1 | -1) => {
    const span = Math.abs(lim - de);
    const xa = busca((x) => (sentido > 0 ? areaZ(de, de + x) : areaZ(de - x, de)), alvoZ, 0, span);
    const xf = busca((x) => (sentido > 0 ? frenteZ(de, de + x) : frenteZ(de - x, de)), t + 0.02, 0, span);
    if (xa === null || xf === null) return null;
    return de + sentido * Math.max(xa, xf);
  };
  const cortesE = [uIni], cortesD = [uFim];
  let LZ = uIni, RZ = uFim;
  for (let lado = 0; ; lado++) {
    if (areaZ(LZ, RZ) < 3 * A) break;
    const x = lado % 2 === 0 ? passo(LZ, RZ, 1) : passo(RZ, LZ, -1);
    if (x === null) break;
    if (lado % 2 === 0) { LZ = x; cortesE.push(x); } else { RZ = x; cortesD.push(x); }
  }
  let cortesMeio: number[] = [];
  const restoZ = areaZ(LZ, RZ);
  for (let m = Math.floor(restoZ / alvoZ + EPS); m >= 1; m--) {
    const c = [LZ];
    let ok = true;
    for (let k = 1; k < m && ok; k++) {
      const x = busca((y) => areaZ(LZ, y), (restoZ * k) / m, c[k - 1], RZ);
      if (x === null) ok = false; else c.push(x);
    }
    c.push(RZ);
    for (let k = 0; k < m && ok; k++) if (frenteZ(c[k], c[k + 1]) < t + 0.02 || areaZ(c[k], c[k + 1]) < alvoZ - 1e-6) ok = false;
    if (ok) { cortesMeio = c; break; }
  }
  let cortes = cortesMeio.length ? [...cortesE, ...cortesMeio.slice(1, -1), ...[...cortesD].reverse()] : [...cortesE.slice(0, -1), ...[...cortesD].reverse()];
  cortes = cortes.filter((x, i) => i === 0 || x > cortes[i - 1] + EPS);
  if (process.env.DBG_FAIXAS) console.log("dbg", { comp, Lg, areaTot: areaZ(uIni, uFim), frTot: frenteZ(uIni, uFim), cortes: cortes.length, refs: refs.length });

  // ── 3. polígonos ──
  const glebaGeo = poligonoGeo(anel);
  if (!glebaGeo) return null;
  const lotesRef: LoteFrame[] = [];
  for (const r of refs) {
    const g = poligonoGeo(faixa(am, r.u0, r.u1, () => 0, r.d));
    const pc = pecas(g && (seguro(() => intersect(featureCollection([glebaGeo, g]))) as Geo | null));
    if (pc.length !== 1) return null;
    const area = areaPlanar(pc[0]), frente = sDe(r.u1) - sDe(r.u0);
    lotesRef.push({ anel: pc[0], area, ret: bbox(pc[0]), linha: 0, faixa: 0, segmento: 0, ordem: 0, testada: frente, profundidadeMedia: area / frente });
  }
  const lotesResto: LoteFrame[] = [];
  for (let k = 0; k + 1 < cortes.length; k++) {
    const g = poligonoGeo(faixa(am, cortes[k], cortes[k + 1], fundoEm, Lg, quebras));
    const pc = pecas(g && (seguro(() => intersect(featureCollection([glebaGeo, g]))) as Geo | null)).sort((x, y) => areaPlanar(y) - areaPlanar(x));
    if (process.env.DBG_FAIXAS) console.log("lote", k, cortes[k].toFixed(2), cortes[k + 1].toFixed(2), "est", areaZ(cortes[k], cortes[k + 1]).toFixed(2), "fr", frenteZ(cortes[k], cortes[k + 1]).toFixed(2), pc.map((x) => areaPlanar(x).toFixed(2)).join(","));
    if (!pc.length) continue;
    if (pc.length > 1 && areaPlanar(pc[1]) > 0.5) return null; // lote partido em dois
    const area = areaPlanar(pc[0]);
    lotesResto.push({ anel: pc[0], area, ret: bbox(pc[0]), linha: 1, faixa: 1, segmento: 0, ordem: 0 });
  }
  // numeração como no aprovado: o lado de trás a partir da ponta final, depois a referência do início ao fim
  const lotes = [...lotesResto.reverse(), ...lotesRef].map((l, i) => ({ ...l, ordem: i }));
  return { lotes, regulares: lotes.filter((l) => Math.abs(l.area - A) < 0.5).length };
}

/** Arestas (no anel anti-horário) de cada via candidata a referência: sequências contíguas de trechos. */
function candidatas(trechos: number[][]): number[][] {
  const N = trechos.length, out: number[][] = [];
  for (let i = 0; i < N; i++) for (let k = 1; k < N; k++) {
    const arestas: number[] = [];
    for (let j = 0; j < k; j++) arestas.push(...trechos[(i + j) % N]);
    out.push(arestas);
  }
  return out;
}

export interface ResultadoFaixas { lotes: LoteFrame[]; chave: string; profundidadeRef: number }

/**
 * Busca o desmembramento em faixas: cada via (ou sequência de trechos) como referência, com
 * P = metade da largura de referência (limitada pela profundidade informada). `trechos` usa os
 * índices do anel recebido. Devolve as melhores, da maior quantidade de lotes para a menor.
 */
export function buscarFaixas(anelFechado: Position[], trechos: number[][], o: OpcoesFaixas): ResultadoFaixas[] {
  const v = anelFechado.slice(0, -1).map((p) => [p[0], p[1]] as P2);
  const n = v.length;
  const ccw = areaAssinada(v) > 0;
  // anel anti-horário: índice de aresta i (de v[i] a v[i+1]) vira n−1−i (de v'[n−1−i] a v'[n−i])
  const anel = ccw ? v : [...v].reverse();
  const mapa = (i: number) => (ccw ? i : n - 1 - i);
  const tr = ccw ? trechos : [...trechos].reverse().map((c) => [...c].reverse().map(mapa));
  const W = larguraReferencia(anel, 2 * o.testada);
  const Ps = new Set<number>();
  if (W) Ps.add(Math.min(o.profundidade, W / 2));
  Ps.add(o.profundidade);
  const res: (ResultadoFaixas & { regulares: number })[] = [];
  for (const P of Array.from(Ps)) {
    if (P * o.testada < o.loteMinimoM2 * 0.25) continue;
    for (const arestas of candidatas(tr)) {
      if (process.env.SO_ARESTAS && arestas.join(",") !== process.env.SO_ARESTAS) continue;
      const r = implantarFaixas(anel, arestas, o, P);
      if (!r) continue;
      const okArea = r.lotes.every((l) => l.area >= o.loteMinimoM2 - 0.01);
      if (!okArea) continue;
      res.push({ lotes: r.lotes, regulares: r.regulares, profundidadeRef: P, chave: `faixas|P${P.toFixed(2)}|${arestas.map((i) => (ccw ? i : n - 1 - i)).join(",")}` });
    }
  }
  res.sort((a, b) => b.lotes.length - a.lotes.length || b.regulares - a.regulares || (a.chave < b.chave ? -1 : 1));
  return res.map(({ lotes, chave, profundidadeRef }) => ({ lotes, chave, profundidadeRef }));
}
