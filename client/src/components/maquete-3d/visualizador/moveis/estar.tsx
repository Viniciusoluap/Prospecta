// Maquete 3D (EPIC-022, etapa 2) — móveis paramétricos das áreas de estar, jantar, escritório e decoração.
// Tudo é gerado por código (nenhum modelo nem textura externa). Cada móvel é desenhado no referencial local
// descrito em tipos.ts (origem no centro da base, costas em −Z, frente em +Z) e cabe na caixa da peça.
//
// Desempenho (roda em celular): cada móvel junta suas partes em UMA geometria por material (poucas chamadas de
// desenho), as bordas arredondadas usam uma caixa de 108 triângulos e os cilindros têm poucos segmentos.
//
// Modo aprimorado (`aprimorado` nas props, botão "Aprimorar"): a mesma peça ganha mais segmentos, chanfros de
// verdade, almofadas abauladas com vivo de costura, molduras e almofadas nas portas, vasos torneados, franjas,
// argolas e mais folhas. Tudo o que é extra fica atrás de `d.fino`; desligado, a geometria é a enxuta de sempre.
import { useEffect, useMemo, type DependencyList } from "react";
import * as THREE from "three";
import type { PecaMobilia } from "@shared/maquete-3d/mobilia";
import type { Estilo, Materiais, NomeMaterial } from "../materiais";
import type { CatalogoMoveis, DesenhoMovel, PropsMovel } from "./tipos";

type V3 = [number, number, number];
type Geos = Partial<Record<NomeMaterial, THREE.BufferGeometry>>;

// ── Geometrias compartilhadas (unitárias, escaladas por peça) ──
const CAIXA = new THREE.BoxGeometry(1, 1, 1);
const CILINDRO = new THREE.CylinderGeometry(1, 1, 1, 16);
const ESFERA = new THREE.SphereGeometry(1, 12, 8);
const ESFERA_SIMPLES = new THREE.SphereGeometry(1, 6, 4);   // botões, rodízios e enfeites pequenos
// Versões do modo aprimorado (criadas só quando alguém liga o modo).
let cilindroFino: THREE.BufferGeometry | undefined, esferaFina: THREE.BufferGeometry | undefined;
const CILINDRO_FINO = () => (cilindroFino ??= new THREE.CylinderGeometry(1, 1, 1, 32));
const ESFERA_FINA = () => (esferaFina ??= new THREE.SphereGeometry(1, 20, 12));
const EIXO_Y = new THREE.Vector3(0, 1, 0);
const DOIS_PI = Math.PI * 2;

/** Difusores e vidros não projetam sombra. */
const SEM_SOMBRA: ReadonlySet<NomeMaterial> = new Set<NomeMaterial>(["luz", "vidro"]);

const limitar = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Gerador pseudoaleatório fixo: a mesma decoração em toda visita. */
function sorteio(semente: number) {
  let s = semente >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function semente(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Caixa de bordas arredondadas e barata: uma caixa subdividida cujas fileiras são levadas para o arco da borda;
 * os vértices das arestas e dos cantos recebem a normal radial (sombreamento suave). `n` = segmentos do arco
 * (1 no modo enxuto: 108 triângulos) e `meio` = subdivisões da parte plana em cada eixo (para deformar almofadas).
 */
function caixaRedonda(w: number, h: number, p: number, raio: number, n = 1, meio: V3 = [1, 1, 1]): THREE.BufferGeometry {
  const r = Math.max(0.0005, Math.min(raio, w * 0.49, h * 0.49, p * 0.49));
  const seg = [2 * n + meio[0], 2 * n + meio[1], 2 * n + meio[2]];
  const g = new THREE.BoxGeometry(w, h, p, seg[0], seg[1], seg[2]);
  const pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute;
  const metade = [w / 2, h / 2, p / 2], v = [0, 0, 0], dentro = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    v[0] = pos.getX(i); v[1] = pos.getY(i); v[2] = pos.getZ(i);
    let d2 = 0;
    for (let e = 0; e < 3; e++) {
      const lim = metade[e] - r, s = seg[e], k = Math.round((v[e] / (2 * metade[e]) + 0.5) * s);
      // Fileiras da borda: ângulos iguais ao longo do arco; fileiras do meio: espalhadas na parte plana.
      if (k === 0) v[e] = -metade[e];
      else if (k === s) v[e] = metade[e];
      else if (k <= n) v[e] = -lim - r * Math.tan(((n - k) / n) * (Math.PI / 4));
      else if (k >= s - n) v[e] = lim + r * Math.tan(((k - (s - n)) / n) * (Math.PI / 4));
      else v[e] = -lim + (2 * lim * (k - n)) / meio[e];
      dentro[e] = limitar(v[e], -lim, lim);
      d2 += (v[e] - dentro[e]) ** 2;
    }
    const d = Math.sqrt(d2) || 1;
    const nx = (v[0] - dentro[0]) / d, ny = (v[1] - dentro[1]) / d, nz = (v[2] - dentro[2]) / d;
    pos.setXYZ(i, dentro[0] + nx * r, dentro[1] + ny * r, dentro[2] + nz * r);
    nor.setXYZ(i, nx, ny, nz);
  }
  return g;
}

/**
 * Placa de cantos arredondados em planta (tampos e tapete): y de 0 a `esp`, UV 0..1 sobre a face de cima.
 * `fino`: cantos com mais segmentos e chanfro de verdade nas arestas de cima e de baixo.
 */
function placa(L: number, P: number, esp: number, raio: number, fino = false): THREE.BufferGeometry {
  const ch = fino ? Math.min(0.004, esp * 0.3, L * 0.1, P * 0.1) : 0, x = L / 2 - ch, y = P / 2 - ch, q = Math.PI / 2;
  const r = Math.max(0.001, Math.min(raio - ch, x * 0.98, y * 0.98));
  const s = new THREE.Shape();
  s.moveTo(-x + r, -y);
  s.lineTo(x - r, -y); s.absarc(x - r, -y + r, r, -q, 0, false);
  s.lineTo(x, y - r); s.absarc(x - r, y - r, r, 0, q, false);
  s.lineTo(-x + r, y); s.absarc(-x + r, y - r, r, q, 2 * q, false);
  s.lineTo(-x, -y + r); s.absarc(-x + r, -y + r, r, 2 * q, 3 * q, false);
  const g = fino
    ? new THREE.ExtrudeGeometry(s, { depth: esp - 2 * ch, bevelEnabled: true, bevelSize: ch, bevelThickness: ch, bevelSegments: 2, curveSegments: 8 })
    : new THREE.ExtrudeGeometry(s, { depth: esp, bevelEnabled: false, curveSegments: 3 });
  g.rotateX(-q);
  if (fino) g.translate(0, ch, 0);
  const pos = g.attributes.position, uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / L + 0.5, 0.5 - pos.getZ(i) / P);
  return g;
}

/** Recalcula as normais juntando os vértices que ocupam o mesmo ponto (superfície contínua, sem emendas). */
function normaisSuaves(g: THREE.BufferGeometry) {
  const pos = g.attributes.position, idx = g.index!, soma = new Map<string, THREE.Vector3>(), chaves: string[] = [];
  for (let i = 0; i < pos.count; i++) chaves.push(`${Math.round(pos.getX(i) * 2e4)},${Math.round(pos.getY(i) * 2e4)},${Math.round(pos.getZ(i) * 2e4)}`);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let k = 0; k < idx.count; k += 3) {
    const ia = idx.getX(k), ib = idx.getX(k + 1), ic = idx.getX(k + 2);
    a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
    b.sub(a); c.sub(a); b.cross(c);
    for (const i of [ia, ib, ic]) { const t = soma.get(chaves[i]); if (t) t.add(b); else soma.set(chaves[i], b.clone()); }
  }
  const nor = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { const t = soma.get(chaves[i]); if (t) { if (t.lengthSq() < 1e-16) a.fromBufferAttribute(pos, i).normalize(); else a.copy(t).normalize(); nor[i * 3] = a.x; nor[i * 3 + 1] = a.y; nor[i * 3 + 2] = a.z; } else nor[i * 3 + 1] = 1; }
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
}

/** Tubo fino ao longo de uma linha (vivo de costura, bainha, cabo). `ref` não pode ser paralelo à linha. */
function tubo(pts: THREE.Vector3[], fechado: boolean, raio: number, lados: number, ref: THREE.Vector3): THREE.BufferGeometry {
  const n = pts.length, pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const t = new THREE.Vector3(), n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const ant = pts[fechado ? (i - 1 + n) % n : Math.max(0, i - 1)], prox = pts[fechado ? (i + 1) % n : Math.min(n - 1, i + 1)];
    t.subVectors(prox, ant).normalize();
    n1.crossVectors(ref, t).normalize(); n2.crossVectors(t, n1);
    for (let k = 0; k < lados; k++) {
      const a = (k / lados) * DOIS_PI, cx = Math.cos(a), sx = Math.sin(a);
      const dx = n1.x * cx + n2.x * sx, dy = n1.y * cx + n2.y * sx, dz = n1.z * cx + n2.z * sx;
      pos.push(pts[i].x + dx * raio, pts[i].y + dy * raio, pts[i].z + dz * raio); nor.push(dx, dy, dz); uv.push(i / n, k / lados);
    }
  }
  const trechos = fechado ? n : n - 1;
  for (let i = 0; i < trechos; i++) for (let k = 0; k < lados; k++) {
    const a = i * lados + k, b = i * lados + ((k + 1) % lados), c = ((i + 1) % n) * lados + k, e = ((i + 1) % n) * lados + ((k + 1) % lados);
    idx.push(a, c, b, b, c, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * Almofada macia (modo aprimorado): caixa bem arredondada e subdividida, com a face de cima abaulada, os cantos
 * mais finos e um vivo de costura contornando a borda. `eixo` é o eixo da espessura (1 = Y, assento; 2 = Z,
 * encosto) e a face abaulada é a do lado positivo. A almofada continua dentro de w × h × p.
 */
function almofadaMacia(w: number, h: number, p: number, raio: number, eixo: 1 | 2): THREE.BufferGeometry[] {
  const dims = [w, h, p], t = eixo, a = (t + 1) % 3, b = (t + 2) % 3, domo = dims[t] * 0.14;
  dims[t] -= domo;
  const r = Math.max(0.0005, Math.min(raio, dims[0] * 0.49, dims[1] * 0.49, dims[2] * 0.49));
  const meio: V3 = [3, 3, 3]; meio[t] = 1;
  const g = caixaRedonda(dims[0], dims[1], dims[2], r, 2, meio), m = [dims[0] / 2, dims[1] / 2, dims[2] / 2];
  const deformar = (v: number[]) => {
    const u = v[a] / m[a], k = v[b] / m[b], s = v[t] / m[t];
    v[t] += (s > 0 ? domo * (1 - u * u) * (1 - k * k) * s : 0) - 0.24 * m[t] * s * u * u * k * k - domo / 2;
  };
  const pos = g.attributes.position as THREE.BufferAttribute, v = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) { v[0] = pos.getX(i); v[1] = pos.getY(i); v[2] = pos.getZ(i); deformar(v); pos.setXYZ(i, v[0], v[1], v[2]); }
  normaisSuaves(g);
  // Vivo: contorna a almofada na quina da face abaulada (ponto a 45° do arco da borda).
  const ea = m[a] - 0.293 * r, eb = m[b] - 0.293 * r, rc = 0.707 * r, pts: THREE.Vector3[] = [];
  const ponto = (ca: number, cb: number) => { v[a] = ca; v[b] = cb; v[t] = m[t] - 0.293 * r; deformar(v); pts.push(new THREE.Vector3(v[0], v[1], v[2])); };
  const cantos: [number, number, number][] = [[1, 1, 0], [-1, 1, 1], [-1, -1, 2], [1, -1, 3]];
  for (const [sa, sb, q] of cantos) {
    for (let k = 0; k <= 4; k++) { const ang = (q + k / 4) * (Math.PI / 2); ponto(sa * (ea - rc) + Math.cos(ang) * rc, sb * (eb - rc) + Math.sin(ang) * rc); }
    // Trecho reto até o próximo canto, com dois pontos intermediários (acompanha o canto afinado).
    const [na, nb] = cantos[(q + 1) % 4], ang = (q + 1) * (Math.PI / 2);
    const x0 = sa * (ea - rc) + Math.cos(ang) * rc, y0 = sb * (eb - rc) + Math.sin(ang) * rc, x1 = na * (ea - rc) + Math.cos(ang) * rc, y1 = nb * (eb - rc) + Math.sin(ang) * rc;
    for (const f of [1 / 3, 2 / 3]) ponto(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
  }
  const ref = new THREE.Vector3(); ref.setComponent(t, 1);
  return [g, tubo(pts, true, 0.0035, 4, ref)];
}

/** Almofada decorativa de verdade (modo aprimorado): gorda no meio, fina nas bordas, pontas marcadas. No plano XY. */
function travesseiro(lado: number, esp: number): THREE.BufferGeometry {
  const N = 8, pos: number[] = [], uv: number[] = [], idx: number[] = [], m = lado / 2;
  for (const f of [1, -1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const u = (i / N) * 2 - 1, v = (j / N) * 2 - 1;
      // Bordas levemente côncavas entre as pontas e espessura caindo a zero na costura.
      pos.push(m * u * (0.9 + 0.1 * v * v), m * v * (0.9 + 0.1 * u * u), f * (esp / 2) * ((1 - u * u) * (1 - v * v)) ** 0.38);
      uv.push(i / N, j / N);
      if (i < N && j < N) { const a = base + j * (N + 1) + i, b = a + 1, c = a + N + 1, e = c + 1; if (f > 0) idx.push(a, b, e, a, e, c); else idx.push(a, e, b, a, c, e); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  normaisSuaves(g);
  return g;
}

/** Junta várias geometrias (já com sua matriz) em uma só: posição, normal e UV. */
function fundir(partes: { g: THREE.BufferGeometry; M: THREE.Matrix4 }[]): THREE.BufferGeometry {
  let nv = 0, ni = 0;
  for (const q of partes) { nv += q.g.attributes.position.count; ni += q.g.index ? q.g.index.count : q.g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const v = new THREE.Vector3(), N = new THREE.Matrix3();
  let ov = 0, oi = 0;
  for (const { g, M } of partes) {
    const P = g.attributes.position, Nn = g.attributes.normal, U = g.attributes.uv, I = g.index;
    N.getNormalMatrix(M);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(M);
      pos[(ov + i) * 3] = v.x; pos[(ov + i) * 3 + 1] = v.y; pos[(ov + i) * 3 + 2] = v.z;
      if (Nn) { v.fromBufferAttribute(Nn, i).applyMatrix3(N).normalize(); nor[(ov + i) * 3] = v.x; nor[(ov + i) * 3 + 1] = v.y; nor[(ov + i) * 3 + 2] = v.z; }
      if (U) { uv[(ov + i) * 2] = U.getX(i); uv[(ov + i) * 2 + 1] = U.getY(i); }
    }
    const n = I ? I.count : P.count;
    for (let k = 0; k < n; k++) idx[oi + k] = (I ? I.getX(k) : k) + ov;
    ov += P.count; oi += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** Prancheta do móvel: acumula as partes por material e, no fim, entrega uma geometria por material. */
class Desenho {
  private lotes = new Map<NomeMaterial, { g: THREE.BufferGeometry; M: THREE.Matrix4 }[]>();
  private base: THREE.Matrix4 | null = null;

  /** `fino`: modo aprimorado — mais segmentos em tudo e os detalhes extras de cada peça. */
  constructor(readonly fino = false) {}

  /** Desenha um conjunto de partes num referencial próprio (posição + rotação), para objetos compostos. */
  com(p: V3, r: V3 | undefined, desenhar: () => void) {
    const anterior = this.base, q = new THREE.Quaternion();
    if (r) q.setFromEuler(new THREE.Euler(r[0], r[1], r[2]));
    const M = new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1], p[2]), q, new THREE.Vector3(1, 1, 1));
    this.base = anterior ? anterior.clone().multiply(M) : M;
    desenhar();
    this.base = anterior;
  }

  private por(mat: NomeMaterial, g: THREE.BufferGeometry, M: THREE.Matrix4) {
    if (this.base) M.premultiply(this.base);
    const l = this.lotes.get(mat);
    if (l) l.push({ g, M }); else this.lotes.set(mat, [{ g, M }]);
  }

  /** Geometria qualquer, com posição, rotação (Euler XYZ) e escala. */
  geo(mat: NomeMaterial, g: THREE.BufferGeometry, p: V3 = [0, 0, 0], r?: V3, s?: V3) {
    const q = new THREE.Quaternion();
    if (r) q.setFromEuler(new THREE.Euler(r[0], r[1], r[2]));
    this.por(mat, g, new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1], p[2]), q, s ? new THREE.Vector3(s[0], s[1], s[2]) : new THREE.Vector3(1, 1, 1)));
  }

  /** Caixa de quinas vivas: tamanho `t`, centro `p`. */
  caixa(mat: NomeMaterial, t: V3, p: V3, r?: V3) { this.geo(mat, CAIXA, p, r, t); }

  /** Caixa de bordas arredondadas: tamanho `t`, centro `p`, raio da borda. */
  redonda(mat: NomeMaterial, t: V3, p: V3, raio: number, r?: V3) { this.geo(mat, caixaRedonda(t[0], t[1], t[2], raio, !this.fino ? 1 : raio >= 0.06 ? 3 : 2), p, r); }

  /** Bloco de marcenaria: quina viva no modo enxuto, aresta levemente chanfrada no aprimorado. */
  bloco(mat: NomeMaterial, t: V3, p: V3, raio = 0.003, r?: V3) { if (this.fino) this.geo(mat, caixaRedonda(t[0], t[1], t[2], raio), p, r); else this.caixa(mat, t, p, r); }

  /** Almofada: caixa arredondada no modo enxuto; abaulada, de cantos finos e com vivo de costura no aprimorado. */
  almofada(mat: NomeMaterial, t: V3, p: V3, raio: number, eixo: 1 | 2, r?: V3) {
    if (!this.fino) { this.redonda(mat, t, p, raio, r); return; }
    for (const g of almofadaMacia(t[0], t[1], t[2], raio, eixo)) this.geo(mat, g, p, r);
  }

  /** Placa de cantos arredondados em planta, apoiada em `p` (chanfrada no modo aprimorado). */
  placa(mat: NomeMaterial, L: number, P: number, esp: number, raio: number, p: V3 = [0, 0, 0]) { this.geo(mat, placa(L, P, esp, raio, this.fino), p); }

  /** Peça torneada: perfil [raio, y] girado em torno de Y. Subindo, o perfil é a face de fora; descendo, a de dentro. */
  torno(mat: NomeMaterial, perfil: [number, number][], p: V3 = [0, 0, 0], seg = 12) {
    this.geo(mat, new THREE.LatheGeometry(perfil.map(q => new THREE.Vector2(Math.max(0.0005, q[0]), q[1])), this.fino ? seg * 2 : seg), p);
  }

  /** Botão de capitonê e outros pontinhos: esfera mínima nos dois modos. */
  botao(mat: NomeMaterial, raio: V3, p: V3) { this.geo(mat, ESFERA_SIMPLES, p, undefined, raio); }

  /** Cilindro vertical: raio, altura, centro `p`. */
  cil(mat: NomeMaterial, raio: number, alt: number, p: V3) { this.geo(mat, this.fino ? CILINDRO_FINO() : CILINDRO, p, undefined, [raio, alt, raio]); }

  esfera(mat: NomeMaterial, raio: number | V3, p: V3, simples = false) {
    const g = this.fino ? (simples ? ESFERA : ESFERA_FINA()) : simples ? ESFERA_SIMPLES : ESFERA;
    this.geo(mat, g, p, undefined, typeof raio === "number" ? [raio, raio, raio] : raio);
  }

  private entre(mat: NomeMaterial, g: THREE.BufferGeometry, a: V3, b: V3, s: THREE.Vector3) {
    const va = new THREE.Vector3(a[0], a[1], a[2]), dir = new THREE.Vector3(b[0], b[1], b[2]).sub(va), comp = dir.length() || 1e-6;
    const q = new THREE.Quaternion().setFromUnitVectors(EIXO_Y, dir.divideScalar(comp));
    s.y *= comp;
    this.por(mat, g, new THREE.Matrix4().compose(va.addScaledVector(dir, comp / 2), q, s));
  }

  /** Haste redonda de `a` até `b` (raio `ra` em `a`, `rb` em `b`): pés, hastes, varões, troncos. */
  haste(mat: NomeMaterial, a: V3, b: V3, ra: number, rb = ra, seg = 12) {
    if (this.fino) this.entre(mat, new THREE.CylinderGeometry(rb, ra, 1, Math.min(24, seg * 2)), a, b, new THREE.Vector3(1, 1, 1));
    else if (ra === rb && seg === 16) this.entre(mat, CILINDRO, a, b, new THREE.Vector3(ra, 1, ra));
    else this.entre(mat, new THREE.CylinderGeometry(rb, ra, 1, seg), a, b, new THREE.Vector3(1, 1, 1));
  }

  /** Barra de seção retangular de `a` até `b`. */
  barra(mat: NomeMaterial, a: V3, b: V3, lx: number, lz = lx) { this.entre(mat, CAIXA, a, b, new THREE.Vector3(lx, 1, lz)); }

  fechar(): Geos {
    const g: Geos = {};
    this.lotes.forEach((partes, mat) => { g[mat] = fundir(partes); });
    return g;
  }
}

function useDesenho(desenhar: (d: Desenho) => void, fino: boolean, deps: DependencyList): Geos {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const g = useMemo(() => { const d = new Desenho(fino); desenhar(d); return d.fechar(); }, deps);
  useEffect(() => () => { for (const x of Object.values(g)) x.dispose(); }, [g]);
  return g;
}

function Malhas({ g, m }: { g: Geos; m: Materiais }) {
  return (
    <group>
      {(Object.keys(g) as NomeMaterial[]).map(n => (
        <mesh key={n} geometry={g[n]} material={m[n]} castShadow={!SEM_SOMBRA.has(n)} receiveShadow />
      ))}
    </group>
  );
}

type Contexto = { L: number; H: number; P: number; estilo: Estilo; luxo: boolean; esc: boolean; mod: boolean; op: PecaMobilia["opcoes"]; r: () => number };
type Construtor = (d: Desenho, c: Contexto) => void;

/** Transforma um construtor de geometria em componente de móvel (memorizado pelas medidas, estilo e opções). */
function movel(construir: Construtor): DesenhoMovel {
  return function Movel({ peca, m, estilo, aprimorado }: PropsMovel) {
    const { largura: L, altura: H, profundidade: P, opcoes, id } = peca;
    const chave = JSON.stringify(opcoes);
    const g = useDesenho(d => construir(d, {
      L, H, P, estilo, op: opcoes, r: sorteio(semente(id)),
      luxo: estilo === "luxo", esc: estilo === "escandinavo", mod: estilo === "moderno",
    }), aprimorado === true, [L, H, P, estilo, chave, id, aprimorado === true]);
    return <Malhas g={g} m={m} />;
  };
}

// ── Peças de repetição ──

/**
 * Quatro pés nos cantos de um retângulo L×P (posição do pé no piso, recuado `rec` da borda), altura `h`.
 * Moderno: barra metálica fina e reta; escandinavo: pé-palito de madeira, cônico e aberto; luxo: pé torneado de metal.
 */
function pes(d: Desenho, estilo: Estilo, L: number, P: number, h: number, rec: number, o: { xc?: number; zc?: number; esp?: number; mat?: NomeMaterial } = {}) {
  const xc = o.xc ?? 0, zc = o.zc ?? 0, k = o.esp ?? 1;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = xc + sx * (L / 2 - rec), z = zc + sz * (P / 2 - rec);
    if (estilo === "moderno") {
      d.barra(o.mat ?? "metal", [x, 0, z], [x, h, z], 0.026 * k);
      if (d.fino) d.caixa("metalEscuro", [0.03 * k, 0.006, 0.03 * k], [x, 0.003, z]);                        // sapata niveladora
    } else if (estilo === "escandinavo") {
      const a = Math.min(h * 0.16, 0.05);
      d.haste(o.mat ?? "madeira", [x, 0.004, z], [x - sx * a, h, z - sz * a], 0.013 * k, 0.023 * k, 8);
    } else {
      d.haste(o.mat ?? "metal", [x, 0, z], [x, h, z], 0.012 * k, 0.024 * k, 8);
      if (d.fino) {
        // Pé torneado: anel junto ao topo, bola no terço de cima e sapata.
        const ha = Math.min(0.012, h * 0.12);
        d.haste(o.mat ?? "metal", [x, h - 1.5 * ha, z], [x, h - 0.5 * ha, z], 0.028 * k, 0.028 * k, 6);
        if (h > 0.12) d.botao(o.mat ?? "metal", [0.026 * k, 0.02 * k, 0.026 * k], [x, h * 0.78, z]);
        d.haste(o.mat ?? "metal", [x, 0, z], [x, 0.008, z], 0.016 * k, 0.016 * k, 6);
      }
    }
  }
}

/** Tampo com espessura e chanfro por baixo (uma segunda placa recuada faz a sombra do chanfro). */
function tampoMesa(d: Desenho, mat: NomeMaterial, L: number, P: number, H: number, tt: number, raio: number) {
  d.placa(mat, L, P, tt * 0.6, raio, [0, H - tt * 0.6, 0]);
  d.placa(mat, L - 0.03, P - 0.03, tt * 0.4, raio, [0, H - tt, 0]);
}

/** Puxador na frente de porta/gaveta, saindo de `z` para +Z (no máximo 1,8 cm). */
function puxador(d: Desenho, estilo: Estilo, x: number, y: number, z: number, comp: number, vertical: boolean) {
  if (d.fino) {
    if (estilo === "escandinavo") {
      // Botão torneado de madeira: pescoço fino e cabeça abaulada.
      d.haste("madeiraEscura", [x, y, z], [x, y, z + 0.011], 0.009, 0.006, 8);
      d.botao("madeiraEscura", [0.015, 0.015, 0.006], [x, y, z + 0.012]);
      return;
    }
    // Alça em barra com dois espaçadores (dourada no luxo, escura no moderno).
    const m = comp / 2, zb = z + 0.011, rb = estilo === "luxo" ? 0.0055 : 0.0045, a: V3 = vertical ? [x, y - m, zb] : [x - m, y, zb], b: V3 = vertical ? [x, y + m, zb] : [x + m, y, zb];
    d.haste("metal", a, b, rb, rb, 6);
    for (const f of [-0.72, 0.72]) {
      const q: V3 = vertical ? [x, y + f * m, z] : [x + f * m, y, z];
      d.haste("metal", q, [q[0], q[1], zb], 0.004, 0.004, 5);
      if (estilo === "luxo") d.haste("metal", q, [q[0], q[1], z + 0.003], 0.009, 0.009, 4);                 // roseta
    }
    if (estilo === "luxo") for (const e of [a, b]) d.botao("metal", [0.0065, 0.0065, 0.0065], e);
    return;
  }
  if (estilo === "moderno") d.caixa("metal", vertical ? [0.01, comp, 0.012] : [comp, 0.01, 0.012], [x, y, z + 0.006]);
  else if (estilo === "escandinavo") d.haste("madeiraEscura", [x, y, z], [x, y, z + 0.018], 0.011, 0.015, 10);
  else if (vertical) d.haste("metal", [x, y - comp / 2, z + 0.008], [x, y + comp / 2, z + 0.008], 0.006, 0.006, 8);
  else d.haste("metal", [x - comp / 2, y, z + 0.008], [x + comp / 2, y, z + 0.008], 0.006, 0.006, 8);
}

/** Ponto na face da frente de um encosto inclinado `a` rad para trás (centro yc/zc, espessura th). */
function noEncosto(yc: number, zc: number, a: number, th: number, lx: number, ly: number): V3 {
  return [lx, yc + ly * Math.cos(a) + (th / 2) * Math.sin(a), zc - ly * Math.sin(a) + (th / 2) * Math.cos(a)];
}

// ── Estofados (sofá e poltrona) ──

function estofado(d: Desenho, { L, H, P, estilo, luxo, esc }: Contexto, lugares: number, externa: boolean) {
  const e = H / 0.82, fl = limitar(L / 1.6, 0.7, 1);
  const hp = (luxo ? 0.07 : esc ? 0.17 : 0.15) * e;                     // altura dos pés
  const ab = externa ? 0.07 : (luxo ? 0.2 : esc ? 0.1 : 0.12) * fl;     // largura do braço
  const ys = (luxo ? 0.46 : 0.43) * e;                                  // topo do assento
  const tc = (luxo ? 0.19 : 0.15) * e;                                  // espessura da almofada do assento
  const te = Math.min(luxo ? 0.26 : 0.2, P * 0.24);                     // espessura do encosto
  const ya = (luxo ? 0.7 : esc ? 0.6 : 0.64) * H;                       // altura do braço
  const Li = L - 2 * ab, n = Math.max(1, Math.round(lugares));
  const rr = luxo ? 0.05 : esc ? 0.04 : 0.018;
  const zf = externa ? -P / 2 + 0.055 : -P / 2 + te * 0.55;             // frente da estrutura do encosto
  const comManta = d.fino && !externa && n > 1 && (luxo || esc);        // manta dobrada sobre um braço do sofá

  if (externa) {
    // Estrutura de madeira aparente: montantes, braço em régua, estrado e ripas do encosto.
    for (const sx of [-1, 1]) {
      const x = sx * (L / 2 - 0.035);
      d.barra("madeira", [x, 0, P / 2 - 0.035], [x, ya - 0.03, P / 2 - 0.035], 0.05);
      d.barra("madeira", [x, 0, -P / 2 + 0.03], [x, H * 0.9, -P / 2 + 0.03], 0.05);
      d.redonda("madeira", [0.07, 0.03, P - 0.01], [x, ya - 0.015, 0.005], 0.008);
    }
    d.caixa("madeira", [Li + 0.02, 0.05, P - 0.06], [0, ys - tc - 0.025, 0]);
    for (let k = 0; k < 3; k++) d.caixa("madeira", [Li + 0.02, 0.07, 0.024], [0, ys + 0.06 + k * (H * 0.86 - ys - 0.1) / 2, -P / 2 + 0.035]);
  } else {
    d.redonda("tecido", [Li + 0.02, ys - tc - hp, P - 0.02], [0, (hp + ys - tc) / 2, 0], rr * 0.6);
    d.redonda("tecido", [Li + 0.02, H * 0.86 - hp, te * 0.55], [0, (hp + H * 0.86) / 2, -P / 2 + te * 0.275], rr);
    for (const sx of [-1, 1]) {
      // Modo aprimorado: o braço da manta recua 3 cm para a manta caber dentro da caixa da peça.
      const corte = comManta && sx === 1 ? 0.03 : 0, abx = ab - corte, x = sx * (L / 2 - corte - abx / 2);
      if (luxo) {
        // Braço enrolado: corpo + rolo deitado em cima.
        d.redonda("tecido", [abx * 0.92, ya - hp - abx * 0.4, P], [x, (hp + ya - abx * 0.4) / 2, 0], 0.035);
        d.haste("tecido", [x, ya - abx / 2, -P / 2 + 0.004], [x, ya - abx / 2, P / 2 - 0.004], abx / 2, abx / 2, 14);
        if (d.fino) for (const sz of [-1, 1]) d.botao("tecido", [0.02, 0.02, 0.008], [x, ya - abx / 2, sz * (P / 2 - 0.0095)]);   // botão no topo do rolo
      } else d.redonda("tecido", [abx, ya - hp, P], [x, (hp + ya) / 2, 0], Math.min(rr, abx * 0.45));
      if (corte) manta(d, x - abx / 2, x + abx / 2, ya, luxo ? abx / 2 : Math.min(rr, abx * 0.45), Math.min(0.12, ya - ys - 0.015), Math.min(0.3, ya - hp - 0.05), Math.min(0.42, P * 0.45));
    }
    pes(d, estilo, L, P, hp + 0.01, Math.max(0.04, ab * 0.5), { esp: luxo ? 1.5 : 1.15 });
  }

  // Almofadas soltas do assento e do encosto, com uma fresta entre elas (o vivo da costura).
  const folga = 0.012, wa = Li / n - folga, ds = P / 2 - 0.012 - zf;
  const hc = (H - ys) * 0.93, th = te * 0.8, a = 0.13, yc = ys + hc / 2 + 0.004, zc = zf + th / 2 + 0.02;
  for (let i = 0; i < n; i++) {
    const x = -Li / 2 + (Li / n) * (i + 0.5);
    d.almofada("tecido", [wa, tc, ds], [x, ys - tc / 2, zf + ds / 2], tc * (luxo ? 0.46 : esc ? 0.4 : 0.3), 1);
    d.almofada("tecido", [wa, hc, th], [x, yc, zc], th * (luxo ? 0.46 : 0.38), 2, [-a, 0, 0]);
    if (luxo && !externa) {
      // Botões do capitonê.
      for (const bx of [-0.25, 0.25]) for (const by of d.fino ? [-0.14, 0.2] : [0.08]) {
        const p = noEncosto(yc, zc, a, th, 0, by * hc);
        d.botao("tecido", [0.016, 0.016, 0.008], [x + bx * wa, p[1], p[2] - 0.002]);
      }
    }
  }
  // Almofadas decorativas.
  if (!externa) {
    const lado = Math.min(0.36 * e, (H - ys) * 0.82), lista: [number, number][] = n > 1 ? [[-1, 0.2], [1, -0.28]] : [[1, -0.2]];
    for (const [sx, giro] of lista) {
      const x = sx * (Li / 2 - lado * 0.56);
      const pa: V3 = [x, ys + lado * 0.5, zc + th / 2 + 0.075 * e], ra: V3 = [-0.32, 0, giro];
      if (d.fino) d.geo("tecidoAlt", travesseiro(lado, 0.13 * e), pa, ra); else d.redonda("tecidoAlt", [lado, lado, 0.11 * e], pa, 0.05 * e, ra);
    }
  }
}

/**
 * Manta dobrada sobre o braço do sofá (modo aprimorado): uma faixa grossa que sobe pela face de dentro do braço
 * (x0), contorna o topo (raio rc) e desce pela face de fora (x1), com uma segunda dobra por cima.
 */
function manta(d: Desenho, x0: number, x1: number, ya: number, rc: number, desceDentro: number, desceFora: number, larg: number) {
  const contorno = (fora: number, dDentro: number, dFora: number) => {
    const pts: [number, number][] = [[x0 - fora, ya - dDentro]], R = rc + fora, N = 8;
    for (let k = 0; k <= N; k++) { const a = Math.PI - (k / N) * (Math.PI / 2); pts.push([x0 + rc + Math.cos(a) * R, ya - rc + Math.sin(a) * R]); }
    for (let k = 0; k <= N; k++) { const a = Math.PI / 2 - (k / N) * (Math.PI / 2); pts.push([x1 - rc + Math.cos(a) * R, ya - rc + Math.sin(a) * R]); }
    pts.push([x1 + fora, ya - dFora]);
    return pts;
  };
  const faixa = (f0: number, f1: number, dDentro: number, dFora: number, z0: number, w: number) => {
    const s = new THREE.Shape(), ida = contorno(f1, dDentro, dFora), volta = contorno(f0, dDentro, dFora).reverse();
    [...ida, ...volta].forEach((q, i) => (i === 0 ? s.moveTo(q[0], q[1]) : s.lineTo(q[0], q[1])));
    d.geo("tecidoAlt", new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false }), [0, 0, z0]);
  };
  faixa(0.003, 0.015, desceDentro, desceFora, -larg * 0.45, larg);
  faixa(0.015, 0.027, desceDentro * 0.55, desceFora * 0.6, -larg * 0.45 + 0.012, larg * 0.62);
}

const sofa: Construtor = (d, c) => estofado(d, c, Number(c.op.lugares) || (c.L >= 2.1 ? 3 : 2), false);
const poltrona: Construtor = (d, c) => estofado(d, c, 1, c.op.externa === true);

// ── Mesas ──

const mesaCentro: Construtor = (d, { L, H, P, estilo, luxo, esc }) => {
  const tt = luxo ? 0.045 : esc ? 0.03 : 0.022, yt = H - tt;
  if (esc) {
    tampoMesa(d, "madeira", L, P, H, tt, Math.min(L, P) * 0.24);
    pes(d, estilo, L, P, yt + 0.005, 0.11, { esp: 1.25 });
    if (d.fino) {
      // Travessas cruzadas entre os pés e uma bandeja baixa com livros e uma tigela torneada.
      const yx = yt * 0.42, ax = L / 2 - 0.11 - 0.029, az = P / 2 - 0.11 - 0.029;
      d.haste("madeira", [-ax, yx, -az], [ax, yx, az], 0.009, 0.009, 6);
      d.haste("madeira", [-ax, yx, az], [ax, yx, -az], 0.009, 0.009, 6);
      d.placa("madeira", L * 0.5, P * 0.5, 0.014, 0.03, [0, yx + 0.009, 0]);
      livro(d, "tecidoAlt", [Math.min(0.2, L * 0.2), 0.026, Math.min(0.14, P * 0.28)], [-L * 0.1, yx + 0.036, 0], [0, 0.2, 0], true);
      tigela(d, "vasoPlanta", L * 0.12, yx + 0.023, 0, Math.min(0.07, P * 0.14), Math.min(0.05, yt - yx - 0.06));
    }
    return;
  }
  tampoMesa(d, "pedra", L, P, H, tt, luxo ? 0.012 : 0.006);
  const b = luxo ? 0.028 : 0.02, rec = 0.03 + b / 2, ys = luxo ? b : H * 0.3;
  // Quadro metálico: quatro montantes, anel sob o tampo e (no luxo) anel junto ao piso.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) d.barra("metal", [sx * (L / 2 - rec), 0, sz * (P / 2 - rec)], [sx * (L / 2 - rec), yt, sz * (P / 2 - rec)], b);
  for (const y of luxo ? [yt - b / 2, b / 2] : [yt - b / 2]) {
    for (const sz of [-1, 1]) d.caixa("metal", [L - 2 * rec, b, b], [0, y, sz * (P / 2 - rec)]);
    for (const sx of [-1, 1]) d.caixa("metal", [b, b, P - 2 * rec], [sx * (L / 2 - rec), y, 0]);
  }
  d.placa(luxo ? "madeiraEscura" : "madeira", L - 2 * rec - b, P - 2 * rec - b, 0.018, 0.004, [0, ys, 0]);
  // Livros empilhados na prateleira de baixo.
  const yl = ys + 0.018, cores: NomeMaterial[] = ["tecidoAlt", "laminado", "madeiraEscura"];
  let y = yl;
  for (let k = 0; k < 3; k++) {
    const hl = 0.028 + k * 0.004, lw = Math.min(0.26, L * 0.26) - k * 0.02;
    if (y + hl > yt - b - 0.01) break;
    livro(d, cores[k], [lw, hl, Math.min(0.19, P * 0.36) - k * 0.015], [-L * 0.2, y + hl / 2, 0.01], [0, 0.12 * (k - 1), 0], true);
    y += hl;
  }
  if (d.fino) tigela(d, luxo ? "metal" : "vasoPlanta", L * 0.2, yl, -0.01, Math.min(0.09, P * 0.18), Math.min(0.06, yt - b - yl - 0.02));
};

const mesaJantar: Construtor = (d, { L, H, P, estilo, luxo, esc, op }) => {
  const tt = luxo ? 0.06 : esc ? 0.036 : 0.03, yt = H - tt;
  if (esc) {
    tampoMesa(d, "madeira", L, P, H, tt, 0.07);
    // Saia de madeira recuada e pés-palito abertos.
    for (const sz of [-1, 1]) d.caixa("madeira", [L - 0.24, 0.07, 0.022], [0, yt - 0.035, sz * (P / 2 - 0.1)]);
    for (const sx of [-1, 1]) d.caixa("madeira", [0.022, 0.07, P - 0.2], [sx * (L / 2 - 0.12), yt - 0.035, 0]);
    pes(d, estilo, L, P, yt, 0.06, { esp: 1.6 });
    if (d.fino) {
      // Travessa longitudinal alta, presa em duas travessas de topo (não atrapalha as cadeiras).
      const yx = yt * 0.72, ax = L / 2 - 0.06 - 0.05 * 0.28 - 0.03, az = P / 2 - 0.06 - 0.05 * 0.28 - 0.03;
      for (const sx of [-1, 1]) d.haste("madeira", [sx * ax, yx, -az], [sx * ax, yx, az], 0.014, 0.014, 6);
      d.haste("madeira", [-ax, yx, 0], [ax, yx, 0], 0.014, 0.014, 6);
    }
  } else if (luxo) {
    tampoMesa(d, "pedra", L, P, H, tt, 0.015);
    // Pedestais: dois na mesa comprida, um na curta; base e capitel de metal.
    const dois = Number(op.lugares) >= 6 && L >= 1.5, xs = dois ? [-L * 0.27, L * 0.27] : [0];
    const wb = dois ? Math.min(0.5, L * 0.26) : L * 0.5, wcol = dois ? 0.16 : Math.max(0.16, L * 0.2);
    for (const x of xs) {
      d.redonda("metal", [wb, 0.03, P * 0.72], [x, 0.015, 0], 0.01);
      d.redonda("madeiraEscura", [wcol, yt - 0.06, P * 0.42], [x, yt / 2, 0], 0.02);
      d.redonda("metal", [wb * 0.9, 0.03, P * 0.6], [x, yt - 0.015, 0], 0.01);
      if (d.fino) {
        // Frisos dourados na coluna e rodapé escalonado.
        for (const fy of [0.16, 0.84]) d.caixa("metal", [wcol + 0.006, 0.008, P * 0.42 + 0.006], [x, 0.03 + (yt - 0.06) * fy, 0]);
        d.redonda("madeiraEscura", [wcol + 0.05, 0.05, P * 0.42 + 0.05], [x, 0.055, 0], 0.012);
      }
    }
    if (dois) d.caixa("metal", [L * 0.54, 0.04, 0.05], [0, 0.14, 0]);
  } else {
    tampoMesa(d, "pedra", L, P, H, tt, 0.008);
    cavaletes(d, "metal", L, P, yt);
  }
};

/** Dois cavaletes metálicos em quadro (pé em trenó) e uma longarina sob o tampo. */
function cavaletes(d: Desenho, mat: NomeMaterial, L: number, P: number, yt: number) {
  const b = 0.036, zx = P / 2 - 0.07;
  for (const sx of [-1, 1]) {
    const x = sx * (L / 2 - 0.1);
    for (const sz of [-1, 1]) d.barra(mat, [x, 0, sz * zx], [x, yt, sz * zx], b);
    d.caixa(mat, [b, 0.022, 2 * zx], [x, 0.011, 0]);
    d.caixa(mat, [b, 0.022, 2 * zx], [x, yt - 0.011, 0]);
  }
  d.caixa(mat, [L - 0.2, 0.03, 0.04], [0, yt - 0.037, 0]);
}

const mesaExterna: Construtor = (d, { L, H, P, estilo, luxo, esc }) => {
  // Tampo ripado de madeira, com frestas.
  const tt = 0.03, yt = H - tt, n = Math.max(4, Math.round(P / 0.11)), fresta = 0.008, wr = (P - (n - 1) * fresta) / n;
  for (let i = 0; i < n; i++) d.redonda("madeira", [L, tt, wr], [0, H - tt / 2, -P / 2 + wr / 2 + i * (wr + fresta)], 0.006);
  for (const sx of [-1, 1]) d.caixa(luxo || esc ? "madeira" : "metalEscuro", [0.06, 0.025, P - 0.08], [sx * (L / 2 - 0.22), yt - 0.0125, 0]);
  if (esc) {
    for (const sz of [-1, 1]) d.caixa("madeira", [L - 0.26, 0.06, 0.022], [0, yt - 0.055, sz * (P / 2 - 0.1)]);
    pes(d, estilo, L, P, yt - 0.02, 0.06, { esp: 1.6 });
  } else if (luxo) {
    // Pés robustos de madeira com travessas em H e sapatas de metal.
    const b = 0.08, x = L / 2 - 0.09, z = P / 2 - 0.08;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) { d.barra("madeira", [sx * x, 0.02, sz * z], [sx * x, yt - 0.02, sz * z], b); d.caixa("metal", [b + 0.006, 0.022, b + 0.006], [sx * x, 0.011, sz * z]); }
      d.caixa("madeira", [0.05, 0.05, 2 * z], [sx * x, 0.16, 0]);
    }
    d.caixa("madeira", [2 * x, 0.05, 0.05], [0, 0.16, 0]);
  } else cavaletes(d, "metalEscuro", L, P, yt - 0.02);
};

// ── Cadeiras ──

const cadeira: Construtor = (d, { L, H, P, estilo, luxo, esc }) => {
  const hs = H * 0.52, a = 0.14;                                  // topo do assento, inclinação do encosto
  const ta = luxo ? 0.1 : esc ? 0.055 : 0.065, th = luxo ? 0.08 : esc ? 0.028 : 0.045;
  const hl = hs - ta, hb = H - hs - 0.05, yc = hs + 0.035 + hb / 2;
  const zc = -P / 2 + th / 2 + 0.006 + (hb / 2) * Math.sin(a), zBase = zc + (hb / 2) * Math.sin(a);

  if (luxo) {
    pes(d, estilo, L, P, hl, 0.04, { mat: "madeiraEscura", esp: 1.15 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) d.haste("metal", [sx * (L / 2 - 0.04), 0, sz * (P / 2 - 0.04)], [sx * (L / 2 - 0.04), 0.07, sz * (P / 2 - 0.04)], 0.016, 0.018, 10);
    d.caixa("madeiraEscura", [L * 0.92, 0.04, P * 0.84], [0, hl - 0.02, 0.01]);
    d.almofada("tecido", [L * 0.98, ta, P * 0.9], [0, hs - ta / 2, P * 0.04], ta * 0.45, 1);
    d.almofada("tecido", [L * 0.94, hb, th], [0, yc, zc], th * 0.45, 2, [-a, 0, 0]);
    if (d.fino) d.caixa("metal", [L * 0.92 + 0.004, 0.006, P * 0.84 + 0.004], [0, hl - 0.037, 0.01]);       // friso dourado na saia
    for (const bx of [-0.2, 0.2]) for (const by of [-0.12, 0.22]) {
      const p = noEncosto(yc, zc, a, th, 0, by * hb);
      d.botao("tecido", [0.014, 0.014, 0.007], [bx * L, p[1], p[2] - 0.002]);
    }
    for (const sx of [-1, 1]) d.haste("madeiraEscura", [sx * L * 0.3, hl - 0.02, zBase - 0.01], [sx * L * 0.3, yc, zc - 0.005], 0.014, 0.012, 8);
  } else if (esc) {
    pes(d, estilo, L, P, hl + 0.005, 0.035, { esp: 1.1 });
    d.redonda("madeira", [L * 0.96, 0.028, P * 0.9], [0, hl + 0.014, P * 0.03], 0.012);
    d.almofada("tecido", [L * 0.86, ta - 0.026, P * 0.8], [0, hs - (ta - 0.026) / 2, P * 0.035], 0.012, 1);
    // Encosto: dois montantes inclinados, travessa curva em cima e três palitos.
    const yB = hl, yT = H - 0.02, zT = -P / 2 + 0.02, zEm = (y: number) => zBase + ((y - yB) / (yT - yB)) * (zT - zBase);
    for (const sx of [-1, 1]) d.haste("madeira", [sx * (L / 2 - 0.045), yB, zBase], [sx * (L / 2 - 0.045), yT, zT], 0.015, 0.012, 10);
    d.redonda("madeira", [L * 0.96, 0.11, 0.026], [0, H - 0.08, zEm(H - 0.08)], 0.012, [-a, 0, 0]);
    for (const fx of d.fino ? [-0.3, -0.15, 0, 0.15, 0.3] : [-0.2, 0, 0.2]) d.haste("madeira", [fx * L, hl + 0.02, zEm(hl + 0.02)], [fx * L, H - 0.1, zEm(H - 0.1)], 0.007, 0.007, 8);
    if (d.fino) {
      // Travessas entre os pés (em H) — os pés abrem ~16% da altura para fora.
      const yx = hl * 0.38, ax = L / 2 - 0.035 - Math.min(hl * 0.16, 0.05) * 0.38 - 0.01, az = P / 2 - 0.035 - Math.min(hl * 0.16, 0.05) * 0.38 - 0.01;
      for (const sx of [-1, 1]) d.haste("madeira", [sx * ax, yx, -az], [sx * ax, yx, az], 0.008, 0.008, 6);
      d.haste("madeira", [-ax, yx, 0], [ax, yx, 0], 0.008, 0.008, 6);
    }
  } else {
    pes(d, estilo, L, P, hl, 0.03, { esp: 0.85 });
    for (const sz of [-1, 1]) d.caixa("metal", [L - 0.06, 0.018, 0.018], [0, hl - 0.009, sz * (P / 2 - 0.03)]);
    d.almofada("tecido", [L * 0.96, ta, P * 0.88], [0, hs - ta / 2, P * 0.04], 0.022, 1);
    // Encosto estofado baixo, preso por duas hastes metálicas.
    const hp = hb * 0.62, off = (hb - hp) / 2;
    d.almofada("tecido", [L * 0.9, hp, th], [0, yc + off * Math.cos(a), zc - off * Math.sin(a)], 0.018, 2, [-a, 0, 0]);
    if (d.fino) for (const sx of [-1, 1]) d.caixa("metal", [0.018, 0.018, P - 0.078], [sx * (L / 2 - 0.03), hl - 0.009, 0]);   // quadro completo sob o assento
    for (const sx of [-1, 1]) d.haste("metal", [sx * L * 0.34, hl - 0.01, zBase - 0.012], [sx * L * 0.34, yc + off, zc - off * Math.sin(a) - 0.008], 0.01, 0.01, 8);
  }
};

const cadeiraEscritorio: Construtor = (d, { L, H, P, luxo, esc }) => {
  const R = Math.min(L, P) / 2, hs = H * 0.49, ta = luxo ? 0.1 : 0.07, a = 0.12;
  // Base em estrela com cinco rodízios e pistão a gás.
  for (let i = 0; i < 5; i++) {
    const ang = (i * DOIS_PI) / 5 + Math.PI / 2, x = Math.cos(ang) * (R - 0.032), z = Math.sin(ang) * (R - 0.032);
    d.haste("metal", [x, 0.065, z], [0, 0.1, 0], 0.012, 0.02, 8);
    d.esfera("metalEscuro", 0.03, [x, 0.03, z], true);
  }
  d.cil("metal", 0.036, 0.05, [0, 0.1, 0]);
  d.haste("cromado", [0, 0.1, 0], [0, hs - ta - 0.025, 0], 0.024, 0.016, 12);
  d.caixa("metalEscuro", [L * 0.32, 0.03, P * 0.36], [0, hs - ta - 0.015, 0]);
  // Assento e encosto.
  const comBraco = !esc, wS = L * (comBraco ? 0.76 : 0.86);
  d.almofada("tecido", [wS, ta, P * 0.8], [0, hs - ta / 2, P * 0.06], ta * (luxo ? 0.45 : 0.36), 1);
  if (d.fino) {
    // Alavanca de regulagem, anel do pistão e garfos dos rodízios.
    d.haste("metalEscuro", [L * 0.12, hs - ta - 0.02, 0.02], [L * 0.3, hs - ta - 0.03, 0.04], 0.005, 0.005, 5);
    d.esfera("metalEscuro", 0.011, [L * 0.3, hs - ta - 0.03, 0.04], true);
    d.cil("metalEscuro", 0.03, 0.03, [0, hs - ta - 0.06, 0]);
    for (let i = 0; i < 5; i++) {
      const ang = (i * DOIS_PI) / 5 + Math.PI / 2, x = Math.cos(ang) * (R - 0.032), z = Math.sin(ang) * (R - 0.032);
      d.haste("metal", [x, 0.03, z], [x, 0.07, z], 0.008, 0.008, 5);
    }
  }
  const th = luxo ? 0.09 : esc ? 0.05 : 0.04, vao = luxo ? 0.03 : 0.1;
  const hb = H - hs - vao - 0.012, yc = hs + vao + hb / 2, zc = -P / 2 + th / 2 + 0.006 + (hb / 2) * Math.sin(a);
  d.almofada("tecido", [L * (luxo ? 0.78 : 0.72), hb, th], [0, yc, zc], luxo ? th * 0.45 : esc ? 0.04 : 0.02, 2, [-a, 0, 0]);
  d.barra("metalEscuro", [0, hs - ta - 0.018, -P * 0.22], [0, yc, zc - th * 0.25], 0.05, 0.018);
  if (luxo) for (const bx of [-0.18, 0.18]) for (const by of [-0.2, 0.05, 0.3]) {
    const p = noEncosto(yc, zc, a, th, 0, by * hb);
    d.botao("tecido", [0.014, 0.014, 0.007], [bx * L, p[1], p[2] - 0.002]);
  }
  if (comBraco) for (const sx of [-1, 1]) {
    const x = sx * (L / 2 - 0.03);
    d.barra("metalEscuro", [sx * (wS / 2 - 0.02), hs - ta * 0.6, 0.02], [x, hs + 0.17, 0.02], 0.022, 0.03);
    d.redonda(luxo ? "tecido" : "metalEscuro", [0.05, luxo ? 0.035 : 0.022, P * 0.42], [x, hs + 0.18, 0.02], 0.01);
  }
};

// ── Armários baixos ──

/**
 * Frente de porta ou gaveta. Modo enxuto: uma chapa. Aprimorado: chapa chanfrada (moderno) ou quadro com
 * almofada rebaixada (escandinavo e luxo, este com filete dourado).
 */
function frenteMovel(d: Desenho, { esc, mod, luxo }: Contexto, mat: NomeMaterial, t: V3, p: V3, porta: boolean) {
  if (!d.fino) { if (esc && porta) d.redonda(mat, t, p, 0.006); else d.caixa(mat, t, p); return; }
  if (mod) { d.bloco(mat, t, p, 0.0025); return; }
  const [w, h, e] = t, q = Math.min(0.05, w * 0.2, h * 0.24);
  d.caixa(mat, [w - 2 * q + 0.002, h - 2 * q + 0.002, e * 0.5], [p[0], p[1], p[2] - e * 0.25]);
  for (const sy of [-1, 1]) d.bloco(mat, [w, q, e], [p[0], p[1] + sy * (h / 2 - q / 2), p[2]], 0.0025);
  for (const sx of [-1, 1]) d.bloco(mat, [q, h - 2 * q, e], [p[0] + sx * (w / 2 - q / 2), p[1], p[2]], 0.0025);
  if (luxo) {
    const f = 0.004, z = p[2] + 0.001;
    for (const sy of [-1, 1]) d.caixa("metal", [w - 2 * q, f, 0.002], [p[0], p[1] + sy * (h / 2 - q - f / 2), z]);
    for (const sx of [-1, 1]) d.caixa("metal", [f, h - 2 * q, 0.002], [p[0] + sx * (w / 2 - q - f / 2), p[1], z]);
  }
}

/**
 * Corpo de armário baixo com frentes sobrepostas (frestas de sombra), puxadores e base conforme o estilo.
 * `colunas`: para cada módulo, o número de gavetas (0 = porta).
 */
function gabinete(d: Desenho, c: Contexto, colunas: number[]) {
  const { L, H, P, estilo, luxo, esc, mod } = c;
  const hp = Math.min(luxo ? 0.09 : esc ? 0.16 : 0.07, H * 0.3), tt = luxo ? 0.035 : 0.022, pf = 0.018, pux = 0.018;
  const corpo: NomeMaterial = luxo ? "madeiraEscura" : esc ? "laminado" : "madeira";
  const frente: NomeMaterial = mod ? "laminado" : "madeira";
  const Lc = luxo ? L - 0.04 : L - 0.004, Pc = P - pf - pux, zc = -P / 2 + Pc / 2, zf = -P / 2 + Pc, hc = H - tt - hp;
  d.bloco(corpo, [Lc, hc, Pc], [0, hp + hc / 2, zc]);
  const Pt = luxo ? P : Pc + pf;
  d.redonda(luxo ? "pedra" : esc ? "madeira" : corpo, [L, tt, Pt], [0, H - tt / 2, -P / 2 + Pt / 2], luxo ? 0.008 : 0.004);
  const fresta = 0.005, li = Lc - 0.012, wc = li / colunas.length, hf = hc - 0.012;
  colunas.forEach((ng, j) => {
    const x = -li / 2 + wc * (j + 0.5), n = Math.max(1, ng), hg = hf / n, porta = ng === 0;
    for (let k = 0; k < n; k++) {
      const y = hp + 0.006 + hg * (k + 0.5), t: V3 = [wc - fresta, hg - fresta, pf], p: V3 = [x, y, zf + pf / 2];
      frenteMovel(d, c, frente, t, p, porta);
      if (porta) puxador(d, estilo, x + (j < colunas.length / 2 ? 1 : -1) * (wc / 2 - 0.035), y + hg * 0.18, zf + pf, Math.min(0.16, hg * 0.4), true);
      else puxador(d, estilo, x, mod ? y + hg / 2 - 0.022 : y, zf + pf, Math.min(0.18, wc * 0.42), false);
    }
  });
  if (d.fino && luxo) d.caixa("metal", [Lc + 0.004, 0.008, Pc + 0.002], [0, hp + 0.012, zc]);   // friso dourado na base
  if (mod) d.caixa("metalEscuro", [Lc - 0.08, hp, Pc - 0.07], [0, hp / 2, zc - 0.005]);        // rodapé recuado
  else {
    pes(d, estilo, Lc, Pc, hp + 0.004, 0.05, { zc, esp: 1.25 });
    if (L > 1.5) for (const sz of [-1, 1]) d.haste(luxo ? "metal" : "madeira", [0, 0, zc + sz * (Pc / 2 - 0.05)], [0, hp + 0.004, zc + sz * (Pc / 2 - 0.05)], luxo ? 0.015 : 0.016, luxo ? 0.03 : 0.028);
  }
}

const rackTv: Construtor = (d, c) => {
  const { L, P } = c, nm = Math.max(2, Math.round(L / 0.5));
  gabinete(d, c, Array.from({ length: nm }, (_, j) => (nm > 2 && j > 0 && j < nm - 1 ? 2 : 0)));
  if (c.op.tv === true) {
    // TV fina fixada na parede, acima do rack (passa da altura da peça: o rack tem só 0,5 m).
    const w = Math.min(L * 0.6, 1.6), h = w * 0.5625, y = Math.max(1.15, c.H + 0.12 + h / 2);
    d.redonda("metalEscuro", [w, h, 0.026], [0, y, -P / 2 + 0.015], 0.006);
    d.caixa("tela", [w - 0.02, h - 0.02, 0.004], [0, y, -P / 2 + 0.03]);
    d.caixa("metalEscuro", [w * 0.3, h * 0.3, 0.012], [0, y, -P / 2 + 0.006]);
  }
  if (d.fino) {
    // Enfeites sobre o rack (passam da altura da peça, como a TV): porta-retratos, vaso, livros e uma plantinha.
    const H = c.H, zm = -0.02;
    for (const [fx, giro, hq] of [[-0.4, 0.25, 0.2], [-0.31, -0.2, 0.15]] as const) portaRetrato(d, fx * L, H, zm - 0.03, hq * 0.78, hq, giro);
    vaso(d, L * 0.4, H, zm, 0.055, 0.22);
    livro(d, "tecidoAlt", [0.22, 0.03, 0.16], [L * 0.24, H + 0.015, zm], [0, 0.15, 0], true);
    livro(d, "laminado", [0.19, 0.025, 0.14], [L * 0.24, H + 0.0425, zm], [0, -0.1, 0], true);
    if (L >= 1.6) plantinha(d, c.r, -L * 0.18, H, zm, 0.05, 0.2);
  }
};

const buffet: Construtor = (d, c) => {
  const nm = Math.max(2, Math.round(c.L / 0.45));
  gabinete(d, c, Array.from({ length: nm }, (_, j) => (nm > 2 && j > 0 && j < nm - 1 ? 3 : 0)));
};

const aparador: Construtor = (d, { L, H, P, estilo, luxo, esc }) => {
  const tt = luxo ? 0.04 : 0.025, hsaia = 0.13, yt = H - tt, Ls = L - 0.06, Ps = P - 0.056;
  const corpo: NomeMaterial = luxo ? "madeiraEscura" : esc ? "laminado" : "madeira";
  tampoMesa(d, luxo ? "pedra" : "madeira", L, P, H, tt, esc ? 0.03 : 0.006);
  d.caixa(corpo, [Ls, hsaia, Ps], [0, yt - hsaia / 2, -0.012]);
  const ng = L >= 1 ? 2 : 1, wg = (Ls - 0.02) / ng, zf = -0.012 + Ps / 2;
  for (let i = 0; i < ng; i++) {
    const x = -(Ls - 0.02) / 2 + wg * (i + 0.5);
    d.bloco(luxo || esc ? "madeira" : "laminado", [wg - 0.006, hsaia - 0.03, 0.012], [x, yt - hsaia / 2, zf + 0.006], 0.0025);
    puxador(d, estilo, x, yt - hsaia / 2, zf + 0.012, Math.min(0.14, wg * 0.35), false);
  }
  const hl = yt - hsaia + 0.004;
  pes(d, estilo, Ls, Ps, hl, 0.03, { zc: -0.012, esp: 1.1 });
  if (!esc) {
    d.placa(corpo, Ls - 0.07, Ps - 0.07, 0.02, 0.004, [0, 0.16, -0.012]);
    if (d.fino) {
      // Prateleira de baixo arrumada: cesto de tecido, livros deitados e um vaso.
      d.redonda("tecido", [Math.min(0.3, Ls * 0.3), Math.min(0.2, hl - 0.24), Ps * 0.6], [-Ls * 0.25, 0.18 + Math.min(0.2, hl - 0.24) / 2, -0.012], 0.02);
      livro(d, "madeiraEscura", [0.2, 0.03, Ps * 0.5], [Ls * 0.12, 0.195, -0.012], [0, 0.1, 0], true);
      livro(d, "tecidoAlt", [0.17, 0.025, Ps * 0.45], [Ls * 0.12, 0.2225, -0.012], [0, -0.12, 0], true);
      vaso(d, Ls * 0.34, 0.18, -0.012, Math.min(0.05, Ps * 0.18), Math.min(0.22, hl - 0.22));
    }
  } else if (d.fino) {
    // Escandinavo: prateleira de ripas apoiada nas travessas.
    for (let i = 0; i < 4; i++) d.bloco("madeira", [Ls - 0.1, 0.012, (Ps - 0.12) / 4 - 0.012], [0, hl * 0.3 + 0.014, -0.012 - (Ps - 0.12) / 2 + ((Ps - 0.12) / 4) * (i + 0.5)], 0.003);
  }
  if (esc) for (const sz of [-1, 1]) d.haste("madeira", [-Ls / 2 + 0.045, hl * 0.3, -0.012 + sz * (Ps / 2 - 0.045)], [Ls / 2 - 0.045, hl * 0.3, -0.012 + sz * (Ps / 2 - 0.045)], 0.009, 0.009, 8);
};

/** Bloco de gavetas (frente em +Z) entre y0 e y1, centrado em x. */
function gaveteiro(d: Desenho, estilo: Estilo, x: number, w: number, y0: number, y1: number, P: number, n: number, corpo: NomeMaterial, frente: NomeMaterial) {
  const pf = 0.016, Pc = P - 0.07 - pf, zc = -P / 2 + 0.025 + Pc / 2, zf = zc + Pc / 2, hg = (y1 - y0 - 0.008) / n;
  d.bloco(corpo, [w, y1 - y0, Pc], [x, (y0 + y1) / 2, zc]);
  for (let k = 0; k < n; k++) {
    const y = y0 + 0.004 + hg * (k + 0.5);
    d.bloco(frente, [w - 0.008, hg - 0.005, pf], [x, y, zf + pf / 2], 0.0025);
    puxador(d, estilo, x, y, zf + pf, Math.min(0.14, w * 0.4), false);
  }
}

const escrivaninha: Construtor = (d, { L, H, P, estilo, luxo, esc }) => {
  const tt = luxo ? 0.04 : 0.028, yt = H - tt, wg = Math.min(0.42, L * 0.34);
  tampoMesa(d, luxo ? "madeiraEscura" : "madeira", L, P, H, tt, esc ? 0.04 : 0.008);
  if (esc) {
    // Pés-palito e um gaveteiro suspenso sob o tampo.
    pes(d, estilo, L, P, yt + 0.004, 0.07, { esp: 1.35 });
    gaveteiro(d, estilo, L / 2 - wg / 2 - 0.17, wg, yt - 0.2, yt, P, 2, "madeira", "laminado");
    d.caixa("madeira", [L - 0.3, 0.06, 0.02], [0, yt - 0.03, -P / 2 + 0.1]);
  } else if (luxo) {
    // Escrivaninha de pedestais: dois na mesa larga; um pedestal e dois pés de metal na estreita.
    const dois = L >= 1.3, wp = dois ? Math.min(0.38, L * 0.28) : wg, xp = L / 2 - wp / 2 - 0.03;
    for (const sx of dois ? [-1, 1] : [1]) {
      gaveteiro(d, estilo, sx * xp, wp, 0.08, yt, P, 3, "madeiraEscura", "madeira");
      pes(d, estilo, wp, P - 0.07, 0.084, 0.035, { xc: sx * xp, zc: -0.01, esp: 1.3 });
    }
    if (!dois) for (const sz of [-1, 1]) d.haste("metal", [-L / 2 + 0.06, 0, sz * (P / 2 - 0.06)], [-L / 2 + 0.06, yt, sz * (P / 2 - 0.06)], 0.014, 0.024);
    const x0 = dois ? -xp + wp / 2 : -L / 2 + 0.09, x1 = xp - wp / 2, wm = x1 - x0;
    d.caixa("madeira", [wm - 0.02, 0.07, 0.016], [(x0 + x1) / 2, yt - 0.04, P / 2 - 0.07]);
    puxador(d, estilo, (x0 + x1) / 2, yt - 0.04, P / 2 - 0.062, Math.min(0.14, wm * 0.3), false);
    d.caixa("madeira", [wm, yt * 0.55, 0.018], [(x0 + x1) / 2, yt - yt * 0.275, -P / 2 + 0.05]);
  } else {
    // Gaveteiro até o piso de um lado, cavalete metálico do outro e painel frontal.
    const xg = L / 2 - wg / 2 - 0.03, xl = -L / 2 + 0.05, zx = P / 2 - 0.06;
    gaveteiro(d, estilo, xg, wg, 0.06, yt, P, 3, "laminado", "laminado");
    d.caixa("metalEscuro", [wg - 0.04, 0.06, P - 0.16], [xg, 0.03, -0.015]);
    for (const sz of [-1, 1]) d.barra("metal", [xl, 0, sz * zx], [xl, yt, sz * zx], 0.03);
    d.caixa("metal", [0.03, 0.02, 2 * zx], [xl, 0.01, 0]);
    d.caixa("metal", [0.03, 0.02, 2 * zx], [xl, yt - 0.01, 0]);
    const x1 = xg - wg / 2;
    d.caixa("laminado", [x1 - xl - 0.02, 0.28, 0.016], [(xl + x1) / 2, yt - 0.16, -P / 2 + 0.06]);
  }
};

// ── Estantes ──

const CAPAS: NomeMaterial[] = ["tecidoAlt", "madeiraEscura", "laminado", "tecido", "metalEscuro", "plastico"];

/**
 * Livro. Modo enxuto: uma caixa. Aprimorado: capas, lombada e o miolo de páginas recuado.
 * Em pé: t = [espessura, altura, profundidade], lombada para a frente (+Z). Deitado: t = [comprimento, espessura, profundidade].
 */
function livro(d: Desenho, cor: NomeMaterial, t: V3, p: V3, r: V3 | undefined, deitado: boolean) {
  if (!d.fino) { d.caixa(cor, t, p, r); return; }
  const [w, h, pr] = t, e = Math.min(0.003, (deitado ? h : w) * 0.18);
  d.com(p, r, () => {
    if (deitado) {
      for (const sy of [-1, 1]) d.caixa(cor, [w, e, pr], [0, sy * (h / 2 - e / 2), 0]);
      d.caixa(cor, [e, h, pr], [-w / 2 + e / 2, 0, 0]);
      d.caixa("plastico", [w - e - 0.004, h - 2 * e, pr - 0.008], [e / 2 - 0.002, 0, 0]);
    } else {
      for (const sx of [-1, 1]) d.caixa(cor, [e, h, pr], [sx * (w / 2 - e / 2), 0, 0]);
      d.caixa(cor, [w, h, e], [0, 0, pr / 2 - e / 2]);
      d.caixa("plastico", [w - 2 * e, h - 0.008, pr - e - 0.004], [0, 0, -e / 2 - 0.002]);
    }
  });
}

/** Tigela torneada (modo aprimorado), apoiada em y. */
function tigela(d: Desenho, mat: NomeMaterial, x: number, y: number, z: number, raio: number, alt: number) {
  if (alt < 0.015 || raio < 0.02) return;
  d.torno(mat, [[0.001, 0], [raio * 0.45, 0], [raio * 0.8, alt * 0.45], [raio, alt], [raio * 0.94, alt], [raio * 0.74, alt * 0.5], [raio * 0.4, alt * 0.2], [0.001, alt * 0.16]], [x, y, z], 10);
}

/** Porta-retrato de mesa (modo aprimorado), levemente inclinado para trás e girado `giro` em torno de Y. */
function portaRetrato(d: Desenho, x: number, y: number, z: number, w: number, h: number, giro: number) {
  d.com([x, y, z], [0, giro, 0], () => d.com([0, 0, 0], [-0.18, 0, 0], () => {
    const b = 0.012;
    for (const sy of [-1, 1]) d.bloco("moldura", [w, b, 0.014], [0, h / 2 + sy * (h / 2 - b / 2), 0], 0.002);
    for (const sx of [-1, 1]) d.bloco("moldura", [b, h - 2 * b, 0.014], [sx * (w / 2 - b / 2), h / 2, 0], 0.002);
    d.caixa("plastico", [w - 2 * b, h - 2 * b, 0.004], [0, h / 2, -0.003]);
    d.caixa("arte", [w - 2 * b - 0.024, h - 2 * b - 0.024, 0.002], [0, h / 2, 0]);
    d.barra("moldura", [0, h * 0.55, -0.006], [0, 0.004, -h * 0.3], 0.02, 0.004);                           // pé de apoio
  }));
}

/** Plantinha de prateleira (modo aprimorado): cachepô torneado e um tufo de folhas. */
function plantinha(d: Desenho, r: () => number, x: number, y: number, z: number, raio: number, alt: number) {
  const hv = alt * 0.38, fs: Folha[] = [];
  d.torno("vasoPlanta", [[0.001, 0], [raio * 0.7, 0], [raio, hv], [raio * 0.88, hv], [raio * 0.84, hv * 0.9], [0.001, hv * 0.88]], [x, y, z], 8);
  d.cil("terra", raio * 0.86, 0.006, [x, y + hv * 0.9, z]);
  for (let i = 0; i < 12; i++) {
    const az = i * 2.39996 + r(), inc = 0.15 + (i / 11) * 0.95;
    fs.push({ o: [x, y + hv * 0.9, z], dir: [Math.sin(inc) * Math.cos(az), Math.cos(inc), Math.sin(inc) * Math.sin(az)], comp: (alt - hv) * (1.2 - 0.4 * (i / 11)), larg: raio * 0.7, caida: 0.6 + r(), seg: 4, perfil: "oval" });
  }
  d.geo("folha", folhagem(fs, { R: raio * 1.7, H: y + alt, piso: y + hv * 0.6 }, false, [x, z]));
}

function vaso(d: Desenho, x: number, y: number, z: number, raio: number, alt: number) {
  if (d.fino) {
    // Vaso torneado, com boca aberta e parede interna.
    const R = raio, h = alt;
    d.torno("vasoPlanta", [[0.001, 0], [R * 0.55, 0], [R * 0.9, h * 0.22], [R, h * 0.42], [R * 0.82, h * 0.66], [R * 0.46, h * 0.86], [R * 0.52, h], [R * 0.42, h], [R * 0.36, h * 0.86], [0.001, h * 0.8]], [x, y, z], 8);
    return;
  }
  d.haste("vasoPlanta", [x, y, z], [x, y + alt * 0.62, z], raio * 0.6, raio, 8);
  d.haste("vasoPlanta", [x, y + alt * 0.62, z], [x, y + alt, z], raio, raio * 0.45, 8);
}

/** Enfeita um nicho de estante (de x0 a x1, apoiado em y, fundo em z0): livros, pilhas, vasos e caixas. */
function enfeitar(d: Desenho, r: () => number, x0: number, x1: number, y: number, z0: number, prof: number, alt: number) {
  const w = x1 - x0, tipo = r(), zm = z0 + prof / 2, cor = () => CAPAS[Math.floor(r() * CAPAS.length) % CAPAS.length];
  if (w < 0.16 || alt < 0.1) return;
  if (tipo < 0.55) {
    // Livros em pé, de larguras e alturas variadas; às vezes o último encostado de lado.
    let x = x0 + 0.015 + r() * w * 0.12, lh = 0.2, lp = prof * 0.7;
    const fim = x0 + w * (0.5 + r() * 0.4);
    while (x < fim) {
      const lw = 0.022 + r() * 0.03;
      lh = Math.min(alt * 0.92, 0.19 + r() * 0.1); lp = prof * (0.6 + r() * 0.2);
      if (x + lw > x1 - 0.015) break;
      livro(d, cor(), [lw - 0.002, lh, lp], [x + lw / 2, y + lh / 2, z0 + 0.02 + lp / 2], undefined, false);
      x += lw;
    }
    const inc = 0.28;
    if (r() > 0.45 && x + lh * Math.sin(inc) + 0.05 < x1) {
      livro(d, cor(), [0.028, lh, lp], [x + 0.014 * Math.cos(inc) + (lh / 2) * Math.sin(inc) + 0.002, y + (lh / 2) * Math.cos(inc) + 0.014 * Math.sin(inc), z0 + 0.02 + lp / 2], [0, 0, -inc], false);
      x += lh * Math.sin(inc) + 0.04;
    }
    if (x1 - x > 0.2 && r() > 0.35) {
      const rv = Math.min(0.055, prof * 0.2), hv = Math.min(alt * 0.75, 0.2);
      if (d.fino && r() > 0.55) plantinha(d, r, (x + x1) / 2 + 0.02, y, zm, rv * 0.85, hv); else vaso(d, (x + x1) / 2 + 0.02, y, zm, rv, hv);
    }
  } else if (tipo < 0.82) {
    // Pilha de livros deitados com um objeto em cima e um vaso ao lado.
    const xs = x0 + w * 0.3, n = 2 + Math.floor(r() * 3);
    let yy = y;
    for (let k = 0; k < n; k++) {
      const hl = 0.025 + r() * 0.02;
      if (yy + hl > y + alt * 0.7) break;
      livro(d, cor(), [Math.min(w * 0.5, 0.2 + r() * 0.05), hl, Math.min(prof * 0.78, 0.15 + r() * 0.04)], [xs, yy + hl / 2, zm], [0, (r() - 0.5) * 0.3, 0], true);
      yy += hl;
    }
    if (d.fino && yy + 0.07 < y + alt) tigela(d, "metal", xs, yy, zm, 0.05, 0.035);
    else if (yy + 0.07 < y + alt) d.esfera("metal", 0.03, [xs, yy + 0.03, zm], true);
    if (w > 0.42) vaso(d, x0 + w * 0.76, y, zm, Math.min(0.06, prof * 0.2), Math.min(alt * 0.8, 0.24));
  } else {
    // Caixa organizadora e um vaso baixo.
    const wb = Math.min(w * 0.5, 0.3), hb = Math.min(alt * 0.6, 0.18);
    d.redonda(r() > 0.5 ? "tecidoAlt" : "tecido", [wb, hb, prof * 0.72], [x0 + 0.03 + wb / 2, y + hb / 2, zm], 0.012);
    if (d.fino) d.caixa("metal", [0.05, 0.022, 0.004], [x0 + 0.03 + wb / 2, y + hb * 0.62, zm + prof * 0.36 + 0.002]);   // etiqueta da caixa
    if (w - wb > 0.2) vaso(d, x0 + wb + (w - wb) * 0.55, y, zm, Math.min(0.05, prof * 0.18), Math.min(alt * 0.5, 0.14));
  }
}

const estante: Construtor = (d, c) => {
  const { L, H, P, estilo, luxo, esc, mod, r } = c;
  if (mod) {
    // Estrutura metálica aberta com prateleiras de madeira.
    const b = 0.025, n = Math.max(3, Math.round(H / 0.4)), y0 = 0.08, passo = (H - 0.03 - y0) / n;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) d.barra("metal", [sx * (L / 2 - b / 2), 0, sz * (P / 2 - b / 2)], [sx * (L / 2 - b / 2), H, sz * (P / 2 - b / 2)], b);
    for (let k = 0; k <= n; k++) {
      const y = y0 + k * passo;
      d.bloco("madeira", [L - 0.006, 0.03, P - 0.006], [0, y + 0.015, 0]);
      if (d.fino && k < n) for (const sx of [-1, 1]) d.barra("metal", [sx * (L / 2 - b / 2), y + 0.04, -P / 2 + b / 2], [sx * (L / 2 - b / 2), y + 0.04, P / 2 - b / 2], 0.012, 0.012);   // travessas laterais
      if (k < n) enfeitar(d, r, -L / 2 + b + 0.01, L / 2 - b - 0.01, y + 0.03, -P / 2 + 0.02, P - 0.05, passo - 0.035);
    }
    return;
  }
  const e = luxo ? 0.034 : 0.024, hp = luxo ? 0.08 : 0.14, Lc = luxo ? L - 0.03 : L, hc = H - hp - (luxo ? 0.05 : 0);
  const corpo: NomeMaterial = luxo ? "madeiraEscura" : "madeira", fundo: NomeMaterial = luxo ? "madeira" : "laminado";
  for (const sx of [-1, 1]) d.bloco(corpo, [e, hc, P - 0.01], [sx * (Lc / 2 - e / 2), hp + hc / 2, 0]);
  d.caixa(fundo, [Lc - 2 * e, hc, 0.008], [0, hp + hc / 2, -P / 2 + 0.012]);
  if (luxo) {
    d.caixa(corpo, [L - 0.02, hp, P - 0.03], [0, hp / 2, -0.005]);          // rodapé
    d.redonda(corpo, [L, 0.05, P], [0, H - 0.025, 0], 0.012);               // cornija
    d.caixa("metal", [L, 0.008, 0.004], [0, H - 0.052, P / 2 - 0.006]);
  } else pes(d, estilo, L, P, hp + 0.004, 0.05, { esp: 1.2 });
  const n = Math.max(3, Math.round(hc / 0.38)), passo = (hc - e) / n, meio = L >= 1.0, li = Lc - 2 * e;
  if (meio) d.caixa(corpo, [0.02, hc - e, P - 0.04], [0, hp + hc / 2, -0.005]);
  for (let k = 0; k <= n; k++) {
    const y = hp + k * passo;
    d.bloco(corpo, [li + 0.002, e, P - (k === 0 || k === n ? 0.01 : 0.035)], [0, y + e / 2, k === 0 || k === n ? 0 : -0.0075]);
    if (luxo && k > 0 && k < n) d.caixa("metal", [li, 0.006, 0.004], [0, y + e / 2, P / 2 - 0.023]);
    if (k === n) break;
    const baias: [number, number][] = meio ? [[-li / 2, -0.01], [0.01, li / 2]] : [[-li / 2, li / 2]];
    if (esc && k === 0) {
      // Escandinavo: o nicho de baixo é fechado por portas.
      const wpt = li / 2;
      for (const sx of [-1, 1]) {
        if (d.fino) frenteMovel(d, c, "laminado", [wpt - 0.005, passo - e - 0.005, 0.016], [sx * wpt / 2, y + e + (passo - e) / 2, P / 2 - 0.027], true);
        else d.redonda("laminado", [wpt - 0.005, passo - e - 0.005, 0.016], [sx * wpt / 2, y + e + (passo - e) / 2, P / 2 - 0.027], 0.005);
        puxador(d, estilo, sx * 0.04, y + e + (passo - e) * 0.7, P / 2 - 0.019, 0.1, true);
      }
      continue;
    }
    for (const [x0, x1] of baias) enfeitar(d, r, x0 + 0.01, x1 - 0.01, y + e, -P / 2 + 0.02, P - 0.07, passo - e - 0.01);
  }
};

const prateleira: Construtor = (d, { L, H, P, luxo, esc, mod, r }) => {
  // Estante utilitária de despensa/garagem: montantes, prateleiras e caixas organizadoras.
  const b = mod ? 0.032 : 0.045, mont: NomeMaterial = mod ? "metalEscuro" : luxo ? "madeiraEscura" : "madeira";
  const tabua: NomeMaterial = mod ? "laminado" : "madeira", nx = L > 1.6 ? 3 : 2, zx = P / 2 - b / 2 - 0.003;
  for (let i = 0; i < nx; i++) {
    const x = -L / 2 + b / 2 + 0.003 + (i * (L - b - 0.006)) / (nx - 1);
    for (const sz of [-1, 1]) {
      d.barra(mont, [x, 0, sz * zx], [x, H, sz * zx], b, mod ? b * 0.6 : b);
      if (luxo) d.caixa("metal", [b + 0.006, 0.03, b + 0.006], [x, 0.015, sz * zx]);
    }
    if (!mod) for (const y of [0.3, H - 0.3]) d.caixa(mont, [b * 0.5, 0.05, P - 2 * b], [x, y, 0]);
  }
  const n = Math.max(4, Math.round(H / 0.42)), y0 = 0.12, passo = (H - 0.03 - y0) / (n - 1), vaoX = (L - b) / (nx - 1);
  if (mod) {
    // Contraventamento em X no fundo.
    const xa = -L / 2 + b, xb = -L / 2 + vaoX, ya = y0 + 0.03, yb = y0 + 2 * passo, z = -P / 2 + 0.008;
    d.barra("metalEscuro", [xa, ya, z], [xb, yb, z], 0.016, 0.004);
    d.barra("metalEscuro", [xb, ya, z], [xa, yb, z], 0.016, 0.004);
  }
  for (let k = 0; k < n; k++) {
    const y = y0 + k * passo;
    d.bloco(tabua, [L - 0.008, 0.03, P - 0.012], [0, y + 0.015, 0]);
    if (d.fino && mod) for (const sz of [-1, 1]) d.caixa("metalEscuro", [L - 0.012, 0.035, 0.004], [0, y + 0.0125, sz * (P / 2 - 0.006)]);   // longarinas de aço
    if (k === n - 1) break;
    const livre = passo - 0.04, yb = y + 0.03;
    for (let i = 0; i < nx - 1; i++) {
      const x0 = -L / 2 + b + i * vaoX + 0.02, x1 = x0 + vaoX - b - 0.04;
      let x = x0;
      while (x < x1 - 0.14) {
        const t = r();
        if (t < 0.5) {
          // Caixa organizadora com tampa.
          const w = Math.min(x1 - x, 0.26 + r() * 0.16), h = Math.min(livre * (0.5 + r() * 0.4), 0.3), pz = P * (0.62 + r() * 0.15);
          d.bloco(r() > 0.5 ? "plastico" : "tecido", [w - 0.01, h - 0.02, pz], [x + w / 2, yb + (h - 0.02) / 2, 0], 0.01);
          d.caixa(r() > 0.5 ? "tecidoAlt" : "metalEscuro", [w, 0.022, pz + 0.012], [x + w / 2, yb + h - 0.011, 0]);
          if (d.fino) { d.caixa("metalEscuro", [0.07, 0.012, 0.006], [x + w / 2, yb + h * 0.55, pz / 2 + 0.003]); d.caixa("laminado", [0.06, 0.03, 0.002], [x + w / 2, yb + h * 0.3, pz / 2 + 0.001]); }   // alça e etiqueta
          x += w + 0.03;
        } else if (t < 0.8) {
          // Latas e potes.
          const rr = 0.045 + r() * 0.03, h = Math.min(livre * 0.7, 0.12 + r() * 0.1);
          if (x + 2 * rr > x1) break;
          const zl = (r() - 0.5) * P * 0.3;
          d.haste(r() > 0.5 ? "inox" : esc ? "tecidoAlt" : "metal", [x + rr, yb, zl], [x + rr, yb + h, zl], rr, rr, 8);
          if (d.fino) { d.haste("metalEscuro", [x + rr, yb + h - 0.01, zl], [x + rr, yb + h + 0.002, zl], rr * 1.03, rr * 1.03, 8); d.haste("laminado", [x + rr, yb + h * 0.25, zl], [x + rr, yb + h * 0.65, zl], rr * 1.01, rr * 1.01, 8); }   // tampa e rótulo
          x += 2 * rr + 0.025;
        } else x += 0.1 + r() * 0.15;
      }
    }
  }
};

// ── Plantas ──

type Folha = { o: V3; dir: V3; comp: number; larg: number; caida: number; seg: number; perfil: keyof typeof PERFIS };

/** Largura relativa da folha ao longo do comprimento (0 na base, 1 na ponta). */
const PERFIS = {
  oval: (t: number) => Math.sin(Math.PI * t ** 0.75) ** 0.8,
  lamina: (t: number) => Math.min(1, 0.35 + t * 4) * Math.max(0, 1 - t ** 3) ** 0.9,
  ovalHaste: (t: number) => (t < 0.3 ? 0.1 : Math.max(0.1 * (t < 0.9 ? 1 : 0), Math.sin(Math.PI * ((t - 0.3) / 0.7) ** 0.75) ** 0.8)),
  peciolo: (t: number) => (t < 0.42 ? 0.09 : Math.max(t < 0.9 ? 0.09 : 0, Math.sin(Math.PI * ((t - 0.42) / 0.58) ** 0.8)) ** 0.7),
};

/**
 * Folhas arqueadas em uma só geometria. Cada folha é uma fita dobrada em V que nasce em `o`, segue `dir` e
 * pende com a gravidade; o comprimento é encurtado para a folha não sair do raio/altura da caixa da peça.
 * `fino` (modo aprimorado): seção curva com cinco pontos e a nervura central marcada, e mais segmentos ao longo.
 */
function folhagem(fs: Folha[], lim: { R: number; H: number; piso: number }, fino = false, centro: [number, number] = [0, 0]): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const lado = new THREE.Vector3(), nor = new THREE.Vector3();
  const cortes = fino ? [-1, -0.5, 0, 0.5, 1] : [-1, 0, 1], nc = cortes.length;
  for (const f of fs) {
    const seg = fino ? Math.ceil(f.seg * 1.5) : f.seg;
    const pts: THREE.Vector3[] = [new THREE.Vector3()], tg: THREE.Vector3[] = [];
    let mh = 1e-6, sobe = 1e-6, desce = 1e-6;
    for (let k = 0; k < seg; k++) {
      const u = (k + 0.5) / seg, t = new THREE.Vector3(f.dir[0], f.dir[1] - f.caida * u * u, f.dir[2]).normalize();
      const p = pts[k].clone().addScaledVector(t, 1 / seg);
      tg.push(t); pts.push(p);
      mh = Math.max(mh, Math.hypot(p.x, p.z)); sobe = Math.max(sobe, p.y); desce = Math.max(desce, -p.y);
    }
    const r0 = Math.hypot(f.o[0] - centro[0], f.o[2] - centro[1]);
    const comp = Math.max(0.02, Math.min(f.comp, (lim.R - f.larg * 0.3 - r0) / mh, (lim.H - f.o[1]) / sobe, (f.o[1] - lim.piso) / desce));
    const base = pos.length / 3;
    for (let k = 0; k <= seg; k++) {
      const u = k / seg, t = tg[Math.min(k, seg - 1)];
      lado.crossVectors(t, EIXO_Y);
      if (lado.lengthSq() < 1e-6) lado.set(1, 0, 0);
      lado.normalize(); nor.crossVectors(lado, t).normalize();
      const w = (f.larg * Math.max(0.03, PERFIS[f.perfil](u))) / 2, dob = w * 0.36;
      const cx = f.o[0] + pts[k].x * comp, cy = f.o[1] + pts[k].y * comp, cz = f.o[2] + pts[k].z * comp;
      for (let j = 0; j < nc; j++) {
        // Seção: bordas erguidas (parábola) e, no modo fino, a nervura central afundada.
        const q = cortes[j], sobeBorda = dob * q * q - (fino && q === 0 ? w * 0.07 : 0);
        pos.push(cx + lado.x * w * q + nor.x * sobeBorda, cy + lado.y * w * q + nor.y * sobeBorda, cz + lado.z * w * q + nor.z * sobeBorda);
        uv.push(j / (nc - 1), u);
        if (k < seg && j < nc - 1) { const a = base + k * nc + j; idx.push(a, a + 1, a + nc + 1, a, a + nc + 1, a + nc); }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const planta: Construtor = (d, { L, H, P, luxo, esc, mod, op, r }) => {
  const grande = op.porte !== "medio", R = Math.min(L, P) / 2;
  const hv = grande ? limitar(H * 0.24, 0.2, 0.42) : limitar(H * 0.3, 0.16, 0.34), rv = R * (grande ? 0.62 : 0.72);
  // Vaso: cilindro reto (moderno), cônico sobre suporte de madeira (escandinavo) ou ânfora de metal (luxo).
  if (esc) {
    const y0 = Math.min(0.1, hv * 0.35);
    for (let i = 0; i < 3; i++) {
      const a = (i * DOIS_PI) / 3 + 0.5;
      d.haste("madeira", [Math.cos(a) * rv * 0.95, 0.003, Math.sin(a) * rv * 0.95], [Math.cos(a) * rv * 0.7, y0 + hv * 0.3, Math.sin(a) * rv * 0.7], 0.011, 0.013, 8);
    }
    d.haste("vasoPlanta", [0, y0, 0], [0, hv, 0], rv * 0.72, rv, 16);
  } else if (luxo) {
    d.haste("vasoPlanta", [0, 0, 0], [0, hv * 0.1, 0], rv * 0.55, rv * 0.42, 16);
    d.haste("vasoPlanta", [0, hv * 0.1, 0], [0, hv * 0.68, 0], rv * 0.42, rv, 16);
    d.haste("vasoPlanta", [0, hv * 0.68, 0], [0, hv, 0], rv, rv * 0.9, 16);
  } else d.haste("vasoPlanta", [0, 0, 0], [0, hv, 0], rv * 0.9, rv, 16);
  const rb = luxo ? rv * 0.9 : rv;
  d.geo("vasoPlanta", d.fino ? new THREE.TorusGeometry(rb, 0.013, 10, 32) : new THREE.TorusGeometry(rb, 0.011, 6, 16), [0, hv, 0], [Math.PI / 2, 0, 0]);
  d.cil("terra", rb * 0.92, 0.012, [0, hv + 0.001, 0]);
  if (d.fino) {
    // Pires sob o vaso e torrões na terra.
    const rp = Math.min(R * 0.96, rv * 1.22);
    d.torno("vasoPlanta", [[0.001, 0], [rp * 0.86, 0], [rp, 0.022], [rp * 0.95, 0.022], [rp * 0.84, 0.008], [0.001, 0.008]], [0, 0, 0], 12);
    for (let i = 0; i < 7; i++) { const a = r() * DOIS_PI, q = r() * rb * 0.75; d.esfera("terra", [0.014 + r() * 0.012, 0.007, 0.014 + r() * 0.012], [Math.cos(a) * q, hv + 0.007, Math.sin(a) * q], true); }
  }

  const fs: Folha[] = [], lim = { R: R - 0.008, H: H - 0.004, piso: hv * 0.75 }, hf = H - hv;
  const emLeque = (n0: number, f: (fr: number) => Omit<Folha, "o" | "dir"> & { inc: number }) => {
    const n = d.fino ? Math.round(n0 * 1.8) : n0;
    for (let i = 0; i < n; i++) {
      const fr = n > 1 ? i / (n - 1) : 0, q = f(fr), az = i * 2.39996 + r() * 0.4, inc = q.inc;
      // Modo aprimorado: cada folha pende um pouco diferente e as touceiras mostram o talo.
      if (d.fino) { q.caida *= 0.7 + r() * 0.6; q.comp *= 0.88 + r() * 0.12; if (q.perfil === "oval") q.perfil = "ovalHaste"; }
      fs.push({ ...q, o: [Math.cos(az) * rb * 0.3 * fr, hv, Math.sin(az) * rb * 0.3 * fr], dir: [Math.sin(inc) * Math.cos(az), Math.cos(inc), Math.sin(inc) * Math.sin(az)] });
    }
  };
  if (grande && esc) {
    // Arvoreta: tronco fino, alguns galhos e uma copa de folhas largas.
    const yc = hv + hf * 0.66, Rv = hf * 0.33;
    d.haste("madeiraEscura", [0, hv, 0], [R * 0.1, hv + hf * 0.33, 0.01], 0.02, 0.016, 8);
    d.haste("madeiraEscura", [R * 0.1, hv + hf * 0.33, 0.01], [0, yc + Rv * 0.2, 0], 0.016, 0.009, 8);
    const ng = d.fino ? 9 : 5;
    for (let i = 0; i < ng; i++) {
      const a = (i * DOIS_PI) / ng + r(), yg = hv + hf * (0.4 + r() * 0.2), fx = R * 0.1 * Math.min(1, (yc - yg) / (hf * 0.33));
      d.haste("madeiraEscura", [fx, yg, 0], [Math.cos(a) * R * 0.4, yg + Rv * (0.4 + r() * 0.4), Math.sin(a) * R * 0.4], 0.008, 0.004, 6);
    }
    for (let i = 0, nf = d.fino ? 130 : 64; i < nf; i++) {
      const az = r() * DOIS_PI, uy = -0.5 + r() * 1.5, ur = Math.sqrt(Math.max(0.05, 1 - Math.min(1, uy * uy))), ux = Math.cos(az) * ur, uz = Math.sin(az) * ur;
      const dir = new THREE.Vector3(ux, uy * 0.6 + 0.35, uz).normalize();
      fs.push({ o: [ux * R * 0.38, yc + uy * Rv * 0.45, uz * R * 0.38], dir: [dir.x, dir.y, dir.z], comp: R * (0.5 + r() * 0.25), larg: R * 0.44, caida: 0.6 + r() * 0.7, seg: 3, perfil: "oval" });
    }
    d.geo("folha", folhagem(fs, { R: lim.R, H: lim.H, piso: yc - Rv }, d.fino));
    return;
  }
  if (grande && luxo) emLeque(30, fr => ({ inc: 0.08 + fr * 0.8, comp: hf * (1.3 - 0.4 * fr), larg: R * 0.2, caida: 0.45 + fr * 2.2, seg: 6, perfil: "lamina" }));        // palmeira de folhas finas
  else if (grande) emLeque(14, fr => ({ inc: 0.08 + fr * 0.55, comp: hf * (1.25 - 0.35 * fr), larg: R * 0.46, caida: 0.5 + fr * 1.0, seg: 7, perfil: "peciolo" }));      // folhas largas em hastes
  else if (mod) emLeque(13, fr => ({ inc: 0.03 + fr * 0.24, comp: hf * (1.02 - 0.35 * fr * r()), larg: R * 0.34, caida: 0.05, seg: 4, perfil: "lamina" }));              // espada-de-são-jorge
  else emLeque(36, fr => ({ inc: 0.12 + fr * 1.05, comp: hf * (1.15 - 0.5 * fr), larg: R * (luxo ? 0.22 : 0.32), caida: 0.7 + fr * 1.3, seg: 5, perfil: "oval" }));      // touceira cheia
  d.geo("folha", folhagem(fs, lim, d.fino));
};

// ── Iluminação ──

/**
 * Cúpula de abajur entre yb e yt (raios rb e rt). Modo enxuto: um tronco de cone fechado. Aprimorado: parede fina
 * com face de dentro e de fora, aros de arame, lâmpada visível e soquete.
 */
function cupula(d: Desenho, yb: number, yt: number, rb: number, rt: number, aro: NomeMaterial = "metal") {
  if (!d.fino) { d.haste("luz", [0, yb, 0], [0, yt, 0], rb, rt, 16); return; }
  const e = 0.004;
  d.torno("luz", [[rb, yb], [rt, yt], [rt - e, yt], [rb - e, yb], [rb, yb]], [0, 0, 0], 16);
  for (const [raio, y] of [[rb, yb + 0.0035], [rt, yt - 0.0035]] as const) d.geo(aro, new THREE.TorusGeometry(raio - 0.0035, 0.0035, 6, 32), [0, y, 0], [Math.PI / 2, 0, 0]);
  // Aranha (três arames até o soquete), soquete e lâmpada.
  const ym = yb + (yt - yb) * 0.45, rl = Math.min(0.035, rt * 0.45, (yt - yb) * 0.22);
  for (let i = 0; i < 3; i++) { const a = (i * DOIS_PI) / 3; d.haste(aro, [0, ym - rl, 0], [Math.cos(a) * (rb - e), yb + 0.004, Math.sin(a) * (rb - e)], 0.002, 0.002, 3); }
  d.cil(aro, rl * 0.5, rl * 0.9, [0, ym - rl * 1.3, 0]);
  d.esfera("luz", [rl, rl * 1.2, rl], [0, ym, 0], true);
}

const luminariaPiso: Construtor = (d, { L, H, P, luxo, esc }) => {
  const R = Math.min(L, P) / 2, hc = limitar(H * 0.19, 0.18, 0.34), yb = H - hc;
  if (esc) {
    // Tripé de madeira com cúpula de tecido.
    for (let i = 0; i < 3; i++) {
      const a = (i * DOIS_PI) / 3 + Math.PI / 6;
      d.haste("madeira", [Math.cos(a) * (R - 0.014), 0, Math.sin(a) * (R - 0.014)], [Math.cos(a) * 0.02, yb - 0.01, Math.sin(a) * 0.02], 0.012, 0.014, 8);
    }
    d.cil("madeira", 0.036, 0.05, [0, yb - 0.035, 0]);
    cupula(d, yb, H, R * 0.97, R * 0.9);
    if (d.fino) {
      // Anel de travamento do tripé, ponteiras de borracha e cordão do interruptor.
      const fy = 0.42, rr = (R - 0.014) * (1 - fy) + 0.02 * fy;
      d.geo("metal", new THREE.TorusGeometry(rr, 0.004, 6, 24), [0, (yb - 0.01) * fy, 0], [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 3; i++) { const a = (i * DOIS_PI) / 3 + Math.PI / 6; d.cil("metalEscuro", 0.013, 0.012, [Math.cos(a) * (R - 0.014), 0.006, Math.sin(a) * (R - 0.014)]); }
      d.haste("metalEscuro", [0.02, yb - 0.01, 0.02], [0.02, yb - 0.14, 0.02], 0.0015, 0.0015, 3);
      d.esfera("madeira", 0.007, [0.02, yb - 0.145, 0.02], true);
    }
  } else if (luxo) {
    if (d.fino) {
      // Base pesada torneada (escalonada, de borda arredondada) e coluna com anéis.
      const rb = R * 0.72;
      d.torno("metal", [[0.001, 0], [rb, 0], [rb, 0.012], [rb * 0.94, 0.02], [rb * 0.66, 0.024], [rb * 0.6, 0.036], [rb * 0.3, 0.044], [0.014, 0.07], [0.001, 0.07]], [0, 0, 0], 16);
      for (const fy of [0.2, 0.6, 0.8]) d.cil("metal", 0.017, 0.012, [0, yb * fy, 0]);
    } else {
      d.cil("metal", R * 0.72, 0.02, [0, 0.01, 0]);
      d.cil("metal", R * 0.46, 0.02, [0, 0.03, 0]);
    }
    d.haste("metal", [0, 0.04, 0], [0, yb + 0.03, 0], 0.012, 0.012, 10);
    d.esfera("metal", 0.03, [0, H * 0.42, 0]);
    d.esfera("metal", 0.022, [0, yb - 0.05, 0]);
    cupula(d, yb, H - 0.03, R * 0.98, R * 0.55);                                 // cúpula cônica
    if (d.fino) d.haste("metal", [0, yb + 0.03, 0], [0, H - 0.02, 0], 0.003, 0.003, 4);
    else d.cil("metal", R * 0.99, 0.008, [0, yb + 0.004, 0]);
    d.esfera("metal", 0.015, [0, H - 0.015, 0]);
  } else {
    if (d.fino) {
      // Base pesada de borda boleada, luva na haste e interruptor de pé.
      const rb = R * 0.74;
      d.torno("metal", [[0.001, 0], [rb - 0.004, 0], [rb, 0.004], [rb, 0.012], [rb - 0.004, 0.016], [0.02, 0.018], [0.014, 0.05], [0.001, 0.05]], [0, 0, 0], 16);
      d.cil("metal", 0.013, 0.03, [0, yb - 0.02, 0]);
    } else d.cil("metal", R * 0.74, 0.016, [0, 0.008, 0]);
    d.haste("metal", [0, 0.016, 0], [0, yb + 0.03, 0], 0.009, 0.009, 10);
    cupula(d, yb, H, R * 0.62, R * 0.62);                                        // cúpula cilíndrica esbelta
    if (!d.fino) for (const y of [yb + 0.003, H - 0.003]) d.cil("metal", R * 0.635, 0.006, [0, y, 0]);
  }
};

const pendente: Construtor = (d, { L, H, P, luxo, esc }) => {
  const R = Math.min(L, P) / 2, hc = Math.min(0.3, H * 0.45);
  if (d.fino) d.torno("metal", [[0.001, H - 0.045], [0.012, H - 0.045], [0.016, H - 0.03], [0.05, H - 0.02], [0.055, H - 0.008], [0.055, H], [0.001, H]], [0, 0, 0], 12);   // canopla torneada
  else d.cil("metal", 0.05, 0.02, [0, H - 0.01, 0]);                             // canopla no teto
  if (esc) {
    // Globo leitoso com tampa de madeira.
    const rg = Math.min(R, hc / 2);
    d.esfera("luz", rg, [0, rg, 0]);
    if (d.fino) {
      // Tampa de madeira torneada com anel metálico e prensa-cabo.
      d.torno("madeira", [[rg * 0.42, 2 * rg - 0.035], [rg * 0.4, 2 * rg + 0.01], [rg * 0.3, 2 * rg + 0.02], [0.001, 2 * rg + 0.02]], [0, 0, 0], 12);
      d.geo("metal", new THREE.TorusGeometry(rg * 0.42, 0.004, 6, 24), [0, 2 * rg - 0.035 + rg * 0.03, 0], [Math.PI / 2, 0, 0]);
      d.cil("metal", 0.008, 0.03, [0, 2 * rg + 0.03, 0]);
    } else d.cil("madeira", rg * 0.38, 0.05, [0, 2 * rg - 0.005, 0]);
    d.haste("metalEscuro", [0, 2 * rg, 0], [0, H - 0.01, 0], 0.004, 0.004, 6);
  } else if (luxo) {
    // Tambor com aros dourados, suspenso por três tirantes.
    if (d.fino) {
      // Tambor de parede fina (dentro e fora), aros dourados vazados, difusor embaixo e lâmpada.
      const e = 0.004, rt = R * 0.93;
      d.torno("luz", [[rt, 0.012], [rt, hc - 0.012], [rt - e, hc - 0.012], [rt - e, 0.012], [rt, 0.012]], [0, 0, 0], 16);
      for (const y of [0, hc - 0.02]) d.torno("metal", [[rt - 0.008, y], [R, y], [R, y + 0.02], [rt - 0.008, y + 0.02], [rt - 0.008, y]], [0, 0, 0], 16);
      d.cil("luz", rt - 0.008, 0.004, [0, 0.016, 0]);
      d.esfera("luz", [0.035, 0.045, 0.035], [0, hc * 0.5, 0], true);
      d.cil("metal", 0.016, 0.04, [0, hc * 0.5 + 0.06, 0]);
    } else {
      d.haste("luz", [0, 0.01, 0], [0, hc - 0.01, 0], R * 0.93, R * 0.93, 16);
      for (const y of [0.01, hc - 0.01]) d.cil("metal", R, 0.02, [0, y, 0]);
    }
    const yj = Math.min(H - 0.1, hc + R * 1.1);
    for (let i = 0; i < 3; i++) { const a = (i * DOIS_PI) / 3; d.haste("metal", [Math.cos(a) * R * 0.9, hc, Math.sin(a) * R * 0.9], [0, yj, 0], 0.003, 0.003, 6); }
    d.esfera("metal", 0.014, [0, yj, 0]);
    d.haste("metal", [0, yj, 0], [0, H - 0.01, 0], 0.005, 0.005, 6);
  } else {
    // Cúpula metálica cônica com difusor embaixo.
    if (d.fino) {
      // Cúpula de chapa com face de fora e de dentro, borda virada, lâmpada à vista e soquete.
      const e = 0.004;
      d.torno("metal", [[R - 0.003, 0], [R, 0.004], [R * 0.82, hc * 0.5], [0.05, hc], [0.001, hc], [0.001, hc - e], [0.05 - e, hc - e], [R * 0.82 - e, hc * 0.5], [R - e, 0.006], [R - 0.003, 0]], [0, 0, 0], 16);
      d.torno("luz", [[0.001, hc * 0.5], [R * 0.3, hc * 0.52], [R * 0.6, hc * 0.62], [R * 0.74, hc * 0.5 + 0.02]], [0, -hc * 0.06, 0], 12);   // refletor claro por dentro
      d.esfera("luz", [0.032, 0.04, 0.032], [0, hc * 0.36, 0], true);
      d.cil("metalEscuro", 0.016, hc * 0.3, [0, hc * 0.36 + 0.04 + hc * 0.15, 0]);
    } else {
      d.haste("metal", [0, 0.016, 0], [0, hc, 0], R, 0.05, 16);
      d.cil("luz", R * 0.88, 0.016, [0, 0.009, 0]);
    }
    d.cil("metal", 0.03, 0.05, [0, hc + 0.02, 0]);
    d.haste("metalEscuro", [0, hc, 0], [0, H - 0.01, 0], 0.004, 0.004, 6);
  }
};

const plafon: Construtor = (d, { L, H, P, luxo, esc }) => {
  const R = Math.min(L, P) / 2;
  if (esc) {
    if (d.fino) {
      // Aro de madeira torneado (boleado) com filete metálico entre o aro e o difusor.
      d.torno("madeira", [[R * 0.9, H * 0.55], [R * 0.985, H * 0.58], [R, H * 0.68], [R, H], [0.001, H]], [0, 0, 0], 16);
      d.geo("metal", new THREE.TorusGeometry(R * 0.9, Math.min(0.004, H * 0.04), 6, 32), [0, H * 0.55, 0], [Math.PI / 2, 0, 0]);
    } else d.cil("madeira", R, H * 0.45, [0, H * 0.775, 0]);
    d.esfera("luz", [R * 0.9, H * 0.5, R * 0.9], [0, H * 0.5, 0]);              // difusor abaulado
  } else if (luxo) {
    d.cil("metal", R, H * 0.35, [0, H * 0.825, 0]);
    d.cil("luz", R * 0.86, H * 0.5, [0, H * 0.42, 0]);
    d.cil("metal", R * 0.9, H * 0.06, [0, H * 0.66, 0]);
    d.cil("luz", R * 0.5, H * 0.17, [0, H * 0.085, 0]);
    d.cil("metal", R * 0.54, H * 0.05, [0, H * 0.17, 0]);
    if (d.fino) {
      // Frisos boleados nos aros e florão central.
      for (const [raio, y] of [[R - 0.005, H * 0.66], [R * 0.9 - 0.004, H * 0.63], [R * 0.54 - 0.003, H * 0.145]] as const) d.geo("metal", new THREE.TorusGeometry(raio, Math.min(0.005, H * 0.045), 6, 32), [0, y, 0], [Math.PI / 2, 0, 0]);
      d.esfera("metal", [R * 0.09, H * 0.08, R * 0.09], [0, H * 0.08, 0], true);
    }
  } else {
    // Quadrado e fino, com moldura metálica.
    d.redonda("metal", [L, H * 0.4, P], [0, H * 0.8, 0], 0.008);
    d.redonda("luz", [L * 0.9, H * 0.7, P * 0.9], [0, H * 0.35, 0], 0.012);
    if (d.fino) {
      // Moldura fina em volta do difusor e base de fixação no teto.
      const f = Math.min(0.006, H * 0.06);
      for (const sz of [-1, 1]) d.caixa("metal", [L * 0.9 + 2 * f, f, f], [0, H * 0.6 - f / 2, sz * (P * 0.45 + f / 2)]);
      for (const sx of [-1, 1]) d.caixa("metal", [f, f, P * 0.9], [sx * (L * 0.45 + f / 2), H * 0.6 - f / 2, 0]);
    }
  }
};

// ── Decoração ──

/**
 * Tapete do modo aprimorado: contorno levemente irregular (o pelo não acaba numa linha reta), borda boleada e
 * franja nas duas pontas curtas. O corpo encolhe o comprimento da franja para tudo caber na caixa da peça.
 */
function tapeteFino(d: Desenho, L: number, H: number, P: number, raio: number, r: () => number) {
  const aoLongoX = L >= P, fr = Math.min(0.045, (aoLongoX ? L : P) * 0.04), ch = Math.min(0.003, H * 0.3);
  const mx = (aoLongoX ? L / 2 - fr : L / 2) - ch, mz = (aoLongoX ? P / 2 : P / 2 - fr) - ch, rc = Math.max(0.004, Math.min(raio, mx * 0.5, mz * 0.5));
  // Contorno do retângulo arredondado, amostrado a cada ~6 cm, com um recuo aleatório de até 3 mm.
  const pts: [number, number][] = [], q = Math.PI / 2;
  const reta = (x0: number, z0: number, x1: number, z1: number) => { const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.06)); for (let i = 0; i < n; i++) pts.push([x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n]); };
  const arco = (cx: number, cz: number, a0: number) => { for (let i = 0; i < 6; i++) { const a = a0 + (i / 6) * q; pts.push([cx + Math.cos(a) * rc, cz + Math.sin(a) * rc]); } };
  reta(-mx + rc, -mz, mx - rc, -mz); arco(mx - rc, -mz + rc, -q);
  reta(mx, -mz + rc, mx, mz - rc); arco(mx - rc, mz - rc, 0);
  reta(mx - rc, mz, -mx + rc, mz); arco(-mx + rc, mz - rc, q);
  reta(-mx, mz - rc, -mx, -mz + rc); arco(-mx + rc, -mz + rc, 2 * q);
  const forma = new THREE.Shape();
  pts.forEach(([x, z], i) => { const k = 1 - (r() * 0.003) / Math.hypot(x, z); if (i === 0) forma.moveTo(x * k, z * k); else forma.lineTo(x * k, z * k); });
  const g = new THREE.ExtrudeGeometry(forma, { depth: Math.max(0.0005, H - 2 * ch), bevelEnabled: true, bevelSize: ch, bevelThickness: ch, bevelSegments: 1 });
  g.rotateX(-q); g.translate(0, ch, 0);
  const pos = g.attributes.position, uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / L + 0.5, 0.5 - pos.getZ(i) / P);
  d.geo("tapete", g);
  // Franja: fios chatos deitados no piso, com comprimento e direção levemente variados.
  const fp: number[] = [], fu: number[] = [], fn: number[] = [], fi: number[] = [];
  const largPonta = (aoLongoX ? mz : mx) - rc * 0.3, borda = (aoLongoX ? mx : mz) + ch - 0.004, nf = Math.min(260, Math.floor((2 * largPonta) / 0.011));
  for (const sp of [-1, 1]) for (let i = 0; i < nf; i++) {
    const t = -largPonta + ((i + 0.5) / nf) * 2 * largPonta, comp = (fr - 0.002) * (0.8 + r() * 0.2), desvio = (r() - 0.5) * 0.012, w = 0.0035;
    const base = fp.length / 3, y0 = Math.min(H * 0.5, 0.006), y1 = 0.0012;
    // (a, b) = (ao longo da ponta, para fora); converte para x/z conforme a orientação do tapete.
    for (const [a, b, y] of [[t - w, borda, y0], [t + w, borda, y0], [t + w + desvio, borda + comp, y1], [t - w + desvio, borda + comp, y1]] as const) {
      const x = aoLongoX ? sp * b : a, z = aoLongoX ? a : sp * b;
      fp.push(x, y, z); fn.push(0, 1, 0); fu.push(x / L + 0.5, 0.5 - z / P);
    }
    // Face voltada para cima nas duas pontas.
    if ((aoLongoX ? sp : -sp) > 0) fi.push(base, base + 2, base + 1, base, base + 3, base + 2); else fi.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const f = new THREE.BufferGeometry();
  f.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
  f.setAttribute("normal", new THREE.Float32BufferAttribute(fn, 3));
  f.setAttribute("uv", new THREE.Float32BufferAttribute(fu, 2));
  f.setIndex(fi);
  d.geo("tapete", f);
}

const tapete: Construtor = (d, { L, H, P, luxo, esc, r }) => {
  const raio = esc ? 0.1 : luxo ? 0.035 : 0.02;
  if (d.fino) tapeteFino(d, L, H, P, raio, r); else d.geo("tapete", placa(L, P, H, raio));
};

/** Retângulo vazado (moldura ou passe-partout) extrudado em Z com chanfro: o chanfro faz o perfil da moldura. */
function aroPerfilado(w: number, h: number, borda: number, prof: number, chanfro: number, passos: number): THREE.BufferGeometry {
  const c = Math.min(chanfro, borda * 0.45, prof * 0.45), x = w / 2 - c, y = h / 2 - c, xi = w / 2 - borda + c, yi = h / 2 - borda + c;
  const s = new THREE.Shape();
  s.moveTo(-x, -y); s.lineTo(x, -y); s.lineTo(x, y); s.lineTo(-x, y); s.lineTo(-x, -y);
  const furo = new THREE.Path();
  furo.moveTo(-xi, -yi); furo.lineTo(-xi, yi); furo.lineTo(xi, yi); furo.lineTo(xi, -yi); furo.lineTo(-xi, -yi);
  s.holes.push(furo);
  const g = new THREE.ExtrudeGeometry(s, { depth: prof - 2 * c, bevelEnabled: true, bevelSize: c, bevelThickness: c, bevelSegments: passos });
  g.translate(0, 0, c);
  return g;
}

/** Quadro do modo aprimorado: moldura perfilada, filete interno, passe-partout de janela chanfrada e a arte ao fundo. */
function quadroFino(d: Desenho, x: number, w: number, H: number, P: number, b: number, margem: number, luxo: boolean) {
  const z0 = -P / 2, wi = w - 2 * b + 0.004, hi = H - 2 * b + 0.004, mg = Math.max(margem, luxo ? 0.02 : 0.035);
  d.geo("moldura", aroPerfilado(w, H, b, P, luxo ? b * 0.42 : b * 0.3, luxo ? 4 : 2), [x, H / 2, z0]);
  if (luxo) d.geo("madeiraEscura", aroPerfilado(wi + 0.002, hi + 0.002, 0.012, P * 0.72, 0.004, 1), [x, H / 2, z0]);
  d.caixa("plastico", [wi, hi, P * 0.2], [x, H / 2, z0 + P * 0.1]);                                           // fundo
  d.caixa("arte", [wi - 2 * mg + 0.01, hi - 2 * mg + 0.01, 0.003], [x, H / 2, z0 + P * 0.2 + 0.0015]);
  d.geo("plastico", aroPerfilado(wi, hi, mg, P * 0.2, 0.003, 1), [x, H / 2, z0 + P * 0.2 + 0.001]);            // passe-partout
}

const quadro: Construtor = (d, { L, H, P, luxo, esc, mod }) => {
  const b = luxo ? 0.055 : esc ? 0.03 : 0.016, margem = esc ? Math.min(0.08, H * 0.12) : luxo ? 0.012 : 0;
  // Moderno: parede larga recebe um díptico; os demais, um quadro só (com passe-partout no escandinavo).
  const n = mod && L >= 1.2 ? 2 : 1, vao = 0.06, w = (L - (n - 1) * vao) / n, zf = -P / 2 + P * 0.4;
  for (let k = 0; k < n; k++) {
    const x = -L / 2 + w / 2 + k * (w + vao);
    if (d.fino) { quadroFino(d, x, w, H, P, b, margem, luxo); continue; }
    for (const sy of [-1, 1]) {
      const t: V3 = [w, b, P], p: V3 = [x, H / 2 + sy * (H / 2 - b / 2), 0];
      if (luxo) d.redonda("moldura", t, p, 0.012); else d.caixa("moldura", t, p);
    }
    for (const sx of [-1, 1]) {
      const t: V3 = [b, H - 2 * b + 0.002, P], p: V3 = [x + sx * (w / 2 - b / 2), H / 2, 0];
      if (luxo) d.redonda("moldura", t, p, 0.012); else d.caixa("moldura", t, p);
    }
    const wi = w - 2 * b, hi = H - 2 * b;
    d.caixa("plastico", [wi, hi, P * 0.4 - 0.002], [x, H / 2, -P / 2 + P * 0.2 + 0.001]);
    d.caixa("arte", [wi - 2 * margem, hi - 2 * margem, 0.004], [x, H / 2, zf + 0.002]);
    if (luxo) {
      // Filete interno escuro, dando profundidade à moldura.
      for (const sy of [-1, 1]) d.caixa("madeiraEscura", [wi, 0.01, P * 0.72], [x, H / 2 + sy * (hi / 2 - 0.005), -P / 2 + P * 0.36]);
      for (const sx of [-1, 1]) d.caixa("madeiraEscura", [0.01, hi, P * 0.72], [x + sx * (wi / 2 - 0.005), H / 2, -P / 2 + P * 0.36]);
    }
  }
};

/**
 * Pano de cortina com pregas em onda (seção senoidal), do lado de fora (`xFora`) até a borda interna.
 * `fino` (modo aprimorado): pregas com mais pontos e profundidade variando de uma prega para a outra.
 * `faixa` desenha só um trecho da altura (0..1) com um deslocamento em Z — é a bainha dobrada.
 */
function pano(xFora: number, xDentro: number, y0: number, y1: number, amp: number, ondas: number, linhas: number, prende: number, irregular: boolean,
  fino = false, faixa?: { de: number; ate: number; dz: number }): THREE.BufferGeometry {
  const cols = ondas * (fino ? 8 : 4), pos: number[] = [], uv: number[] = [], idx: number[] = [];
  // Profundidade de cada prega (fixa por índice, para os dois panos ficarem coerentes).
  const fundo = (k: number) => 0.72 + 0.5 * Math.abs(Math.sin(k * 12.9898 + 4.1));
  for (let j = 0; j <= linhas; j++) {
    const v = faixa ? faixa.de + ((faixa.ate - faixa.de) * j) / linhas : j / linhas, y = y0 + (y1 - y0) * v;
    const aperto = prende * Math.exp(-(((v - 0.42) / 0.17) ** 2));          // abraçadeira (luxo) recolhe o pano
    const a = amp * (0.65 + 0.35 * (1 - v)) * (1 - aperto * 0.3);
    for (let i = 0; i <= cols; i++) {
      const u = i / cols, x = xFora + (xDentro - xFora) * u * (1 - aperto), fase = u * ondas;
      let z = a * Math.sin(fase * DOIS_PI) + (irregular ? a * 0.22 * Math.sin(u * ondas * 2.3 + v * 2) : 0);
      if (fino) {
        // Mistura a profundidade das duas pregas vizinhas e solta um pouco a barra (mais aberta embaixo).
        const k = Math.floor(fase), f = fase - k, mist = fundo(k) * (1 - f) + fundo(k + 1) * f;
        z = Math.max(-amp * 1.2, Math.min(amp * 1.2, z * mist * 0.86 + a * 0.1 * (1 - v) * Math.sin(fase * Math.PI + 1.7)));
      }
      pos.push(x, y, z + (faixa ? faixa.dz : 0)); uv.push(u, v);
      if (i < cols && j < linhas) { const p = j * (cols + 1) + i, q = p + cols + 1; idx.push(p, p + 1, q + 1, p, q + 1, q); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const cortina: Construtor = (d, { L, H, P, luxo, esc, op }) => {
  const rv = luxo ? 0.015 : 0.011, yv = H - 0.03, vao = Number(op.vao) || Math.max(0.4, L - 0.5);
  // Varão com ponteiras e suportes até a parede.
  d.haste("metal", [-L / 2 + 0.03, yv, 0], [L / 2 - 0.03, yv, 0], rv, rv, 10);
  for (const sx of [-1, 1]) {
    d.esfera("metal", luxo ? 0.026 : 0.018, [sx * (L / 2 - 0.027), yv, 0]);
    d.caixa("metal", [0.014, 0.014, P / 2], [sx * (L / 2 - Math.min(0.14, L * 0.12)), yv, -P / 4]);
    if (d.fino) {
      // Ponteira torneada (colar + gola) e roseta do suporte na parede.
      d.haste("metal", [sx * (L / 2 - 0.062), yv, 0], [sx * (L / 2 - 0.05), yv, 0], rv + 0.005, rv + 0.005, 8);
      d.haste("metal", [sx * (L / 2 - 0.05), yv, 0], [sx * (L / 2 - 0.04), yv, 0], rv + 0.002, rv * 0.7, 8);
      d.haste("metal", [sx * (L / 2 - Math.min(0.14, L * 0.12)), yv, -P / 2], [sx * (L / 2 - Math.min(0.14, L * 0.12)), yv, -P / 2 + 0.006], 0.022, 0.022, 8);
    }
  }
  // Dois panos recolhidos para os lados, deixando parte da janela à vista.
  const abertura = limitar(vao * 0.55, 0.15, Math.max(0.15, L - 0.5)), xo = L / 2 - 0.045, wp = xo - abertura / 2;
  if (wp < 0.08) return;
  const amp = Math.min(0.036, P * 0.3), ondas = limitar(Math.round(wp / 0.11), 2, 9), linhas = luxo ? 8 : 3, topo = yv - rv - 0.002;
  for (const sx of [-1, 1]) {
    if (d.fino) {
      const ampF = amp * 0.8, nl = luxo ? 14 : 10;
      d.geo("cortina", pano(sx * xo, sx * abertura / 2, 0.015, topo, ampF, ondas, nl, luxo ? 0.5 : 0, esc, true));
      // Bainha: a barra dobrada (pano em dobro, um fio à frente) e a franzida do cabeçote junto às argolas.
      d.geo("cortina", pano(sx * xo, sx * abertura / 2, 0.015, topo, ampF, ondas, 1, luxo ? 0.5 : 0, esc, true, { de: 0, ate: 0.09 / (topo - 0.015), dz: 0.0025 }));
      d.geo("cortina", pano(sx * xo, sx * abertura / 2, 0.015, topo, ampF, ondas, 1, luxo ? 0.5 : 0, esc, true, { de: 1 - 0.05 / (topo - 0.015), ate: 1, dz: 0.0025 }));
      // Argolas no varão, uma por prega.
      for (let k = 0; k < ondas; k++) {
        const x = sx * (xo + (abertura / 2 - xo) * ((k + 0.25) / ondas));
        d.geo("metal", new THREE.TorusGeometry(rv + 0.006, 0.003, 5, 10), [x, yv, 0], [0, Math.PI / 2, 0]);
      }
    } else d.geo("cortina", pano(sx * xo, sx * abertura / 2, 0.015, topo, amp, ondas, linhas, luxo ? 0.5 : 0, esc));
    if (luxo) {
      const yt = 0.015 + (yv - 0.03) * 0.42, larg = wp * 0.5;
      d.caixa("metal", [larg + 0.02, 0.03, amp * 2 + 0.014], [sx * (xo - larg / 2), yt, 0]);
      if (d.fino) {
        // Borla pendurada na abraçadeira.
        d.haste("metal", [sx * (xo - larg - 0.01), yt - 0.015, amp + 0.004], [sx * (xo - larg - 0.01), yt - 0.09, amp + 0.004], 0.002, 0.002, 4);
        d.esfera("metal", 0.012, [sx * (xo - larg - 0.01), yt - 0.1, amp + 0.004], true);
        d.haste("tecidoAlt", [sx * (xo - larg - 0.01), yt - 0.105, amp + 0.004], [sx * (xo - larg - 0.01), yt - 0.17, amp + 0.004], 0.009, 0.012, 6);
      }
    }
  }
};

// ── Catálogo ──

export const MOVEIS_ESTAR: CatalogoMoveis = {
  sofa: movel(sofa),
  poltrona: movel(poltrona),
  mesa_centro: movel(mesaCentro),
  rack_tv: movel(rackTv),
  tapete: movel(tapete),
  mesa_jantar: movel(mesaJantar),
  cadeira: movel(cadeira),
  buffet: movel(buffet),
  aparador: movel(aparador),
  escrivaninha: movel(escrivaninha),
  cadeira_escritorio: movel(cadeiraEscritorio),
  estante: movel(estante),
  mesa_externa: movel(mesaExterna),
  prateleira: movel(prateleira),
  planta: movel(planta),
  luminaria_piso: movel(luminariaPiso),
  quadro: movel(quadro),
  cortina: movel(cortina),
  pendente: movel(pendente),
  plafon: movel(plafon),
};
