// Maquete 3D (EPIC-022) — carro paramétrico da garagem. Tudo é gerado por código (nenhum modelo nem textura
// externa): um SUV compacto moderno, desenhado no referencial local descrito em tipos.ts.
//
// Referencial do carro: largura em X, comprimento em Z (a FRENTE do carro aponta para +Z, a traseira fica em −Z),
// y = 0 é o piso onde os pneus encostam. O carro é modelado nas medidas nominais 1,80 × 1,48 × 4,30 m e depois
// escalado para a caixa da peça (as rodas usam escala uniforme para continuarem redondas).
//
// Carroceria: uma casca única, "lofteada". Para cada estação ao longo do comprimento monta-se meia seção
// transversal (assoalho, caixa de roda, lateral abaulada, ombro, vidro com tombamento, canto do teto e teto com
// flecha); as estações se concentram nos cantos (planta em superelipse, nada de prisma) e nos arcos das rodas.
// As células da malha são distribuídas por material — pintura, vidro (levemente recuado), plástico escuro —
// compartilhando as mesmas normais suaves, e a metade esquerda é o espelho da direita.
//
// Desempenho: uma geometria por material (poucas chamadas de desenho). O modo padrão fica abaixo de ~6 mil
// triângulos; o modo aprimorado refina a casca, os pneus e as rodas e fica abaixo de ~18 mil.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { CatalogoMoveis, PropsMovel } from "./tipos";

type V3 = [number, number, number];
type Mat = "pintura" | "vidro" | "plastico" | "borracha" | "liga" | "farol" | "lente" | "lanterna" | "cromado" | "inox" | "placa";
type Geos = Partial<Record<Mat, THREE.BufferGeometry>>;

// ── Medidas nominais (metros) ──
const LARGURA_NOMINAL = 1.8, ALTURA_NOMINAL = 1.48, COMPRIMENTO_NOMINAL = 4.3;
const ZP = 2.135;                       // ponta da carroceria (sobra folga para placa e lentes dentro da caixa)
const R_PNEU = 0.335, R_ARO = 0.222, B_PNEU = 0.108;   // raio do pneu, raio do aro, meia largura do pneu
const R_ARCO = 0.395;                   // raio do arco da caixa de roda
const Z_EIXO_F = 1.3, Z_EIXO_T = -1.31; // eixos dianteiro e traseiro
const ZC_F = Z_EIXO_F + R_ARCO;         // onde começa o canto dianteiro (em planta)
const ZC_T = R_ARCO - Z_EIXO_T;         // idem para a traseira (valor absoluto)
const R_OMBRO = 0.05;                   // raio do ombro (encontro da lateral com o capô/linha de cintura)
const TOMB = 0.32;                      // tombamento dos vidros laterais (rad, a partir da vertical)
const Y_CINTURA = 0.6;                  // altura em que a lateral é mais larga
const Z_COLUNA_A = 0.95, Z_TETO_F = 0.17, Z_TETO_T = -1.61, Z_VIGIA = -1.99;   // para-brisa e vidro traseiro
const Z_JANELA_F = 0.74, Z_JANELA_T = -1.56;                                    // vidros laterais
const COLUNAS: [number, number][] = [[-0.24, -0.14], [-1.3, -1.22]];            // colunas B e C (cor da carroceria)
const MEIO_PI = Math.PI / 2, DOIS_PI = Math.PI * 2;

const CAIXA = new THREE.BoxGeometry(1, 1, 1);
const CILINDRO = new THREE.CylinderGeometry(1, 1, 1, 8);
const ESFERA = new THREE.SphereGeometry(1, 8, 5);
const ESPELHAR = new THREE.Matrix4().makeScale(-1, 1, 1);

const limitar = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const suave = (t: number) => { const x = limitar(t, 0, 1); return x * x * (3 - 2 * x); };
/** Quarto de superelipse: 0 em t = 0, 1 em t = 1, chegando com tangente vertical (cantos arredondados). */
const canto = (t: number, p = 2) => 1 - Math.pow(1 - Math.pow(limitar(t, 0, 1), p), 1 / p);
/** Mínimo suavizado (arredonda o encontro de duas linhas do perfil). */
const minSuave = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

// ── Perfil lateral e planta (funções do comprimento z) ──

/** Linha de cintura: altura do ombro da lateral (borda do capô na frente, base dos vidros na cabine). */
function cintura(z: number): number {
  const y = z > Z_COLUNA_A ? 0.975 - 0.185 * Math.pow((z - Z_COLUNA_A) / (ZP - Z_COLUNA_A), 1.6) : 0.975 + 0.06 * Math.pow((Z_COLUNA_A - z) / 2.95, 1.3);
  return y - 0.07 * canto((z - 1.9) / (ZP - 1.9)) - 0.07 * canto((-z - 1.98) / (ZP - 1.98));
}

/** Altura do assoalho (sobe nos para-choques: ângulos de entrada e de saída). */
const assoalho = (z: number) => 0.19 + 0.12 * canto((z - 1.8) / (ZP - 1.8)) + 0.14 * canto((-z - 1.8) / (ZP - 1.8));

/** Meia largura máxima da carroceria: quadris traseiros mais largos e cantos em superelipse na planta. */
function meiaLargura(z: number): number {
  const w = 0.835 + 0.02 * Math.exp(-(((z + 1.25) / 0.55) ** 2)) + 0.01 * Math.exp(-(((z - 1.3) / 0.5) ** 2));
  return w - (w - 0.4) * canto((z - ZC_F) / (ZP - ZC_F), 2.6) - (w - 0.44) * canto((-z - ZC_T) / (ZP - ZC_T), 2.8);
}

/** Altura da borda lateral do teto: para-brisa inclinado, teto em arco e vidro traseiro (nunca abaixo da cintura). */
function beiral(z: number): number {
  const paraBrisa = 0.975 + (Z_COLUNA_A - z) * 0.587;
  const teto = 1.435 - (z > -0.5 ? 0.061 : 0.035) * (z + 0.5) ** 2;
  const vigia = 1.035 + (z + 2) * 0.95;
  return Math.max(cintura(z), minSuave(minSuave(paraBrisa, teto, 0.06), vigia, 0.05));
}

/** Lateral abaulada: x em função da altura, para meia largura `w` e topo da lateral `yS`. */
function lado(w: number, yS: number, y: number): number {
  return y > Y_CINTURA ? w - 0.03 * ((y - Y_CINTURA) / (yS - Y_CINTURA)) ** 2 : w - 0.045 * ((Y_CINTURA - y) / 0.41) ** 2;
}
/** x da superfície lateral no ponto (z, y) — usado para assentar faróis, lanternas, frisos e maçanetas. */
const ladoEm = (z: number, y: number) => lado(meiaLargura(z), cintura(z) - R_OMBRO, y);

type Secao = {
  w: number; yB: number; yA: number; yS: number; yLo: number; xi: number; th: number; rr: number; cr: number;
  g0x: number; g0y: number; g1x: number; g1y: number; cx: number; cy: number; yRe: number;
};

/** Parâmetros da seção transversal em z (`dentro` = estação dentro de um arco de roda). */
function secao(z: number, dentro: boolean): Secao {
  const w = meiaLargura(z), yD = cintura(z), yB = assoalho(z), yS = yD - R_OMBRO;
  let yA = yB;
  if (dentro) { const dz = z - (z > 0 ? Z_EIXO_F : Z_EIXO_T); yA = Math.max(yB, R_PNEU + Math.sqrt(Math.max(0, R_ARCO * R_ARCO - dz * dz))); }
  const yRe = beiral(z), g = Math.max(0, yRe - yD), k = suave(g / 0.14);
  const th = mix(MEIO_PI, TOMB, k), rr = Math.min(0.085, g * 0.5), xD = w - 0.03;
  const g0x = xD - R_OMBRO + R_OMBRO * Math.cos(th), g0y = yS + R_OMBRO * Math.sin(th);
  const g1y = Math.max(g0y, yRe - rr + rr * Math.sin(TOMB)), g1x = g0x - (g1y - g0y) * Math.tan(TOMB);
  const tp = (Z_COLUNA_A - z) / (Z_COLUNA_A - Z_TETO_F);
  const cr = 0.035 + 0.006 * k + (tp > 0 && tp < 1 ? 0.028 * Math.sin(Math.PI * tp) : 0);   // flecha do teto + curvatura do para-brisa
  return { w, yB, yA, yS, yLo: yA + 0.04, xi: Math.max(0.08, w - 0.3), th, rr, cr, g0x, g0y, g1x, g1y, cx: g1x - rr * Math.cos(TOMB), cy: yRe - rr, yRe };
}

// ── Malhas ──

/** Malha indexada em construção, com vértices reaproveitados por chave. */
class Sub {
  pos: number[] = []; nor: number[] = []; idx: number[] = [];
  private mapa = new Map<number, number>();
  v(chave: number, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    if (chave >= 0) { const e = this.mapa.get(chave); if (e !== undefined) return e; }
    const i = this.pos.length / 3;
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz);
    if (chave >= 0) this.mapa.set(chave, i);
    return i;
  }
  geo(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setIndex(this.idx);
    return g;
  }
}

/** Grade de colunas (cada coluna = lista de pontos xyz): triângulos voltados para (linha × coluna), normais suaves. */
function grade(colunas: number[][]): THREE.BufferGeometry {
  const nl = colunas[0].length / 3, pos: number[] = [], idx: number[] = [];
  for (const c of colunas) pos.push(...c);
  for (let i = 0; i + 1 < colunas.length; i++) for (let j = 0; j + 1 < nl; j++) {
    const a = i * nl + j, b = a + 1, c = a + nl, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Junta várias geometrias (já com sua matriz) em uma só: posição e normal. Matriz espelhada inverte os triângulos. */
function fundir(partes: { g: THREE.BufferGeometry; M: THREE.Matrix4 }[]): THREE.BufferGeometry {
  let nv = 0, ni = 0;
  for (const q of partes) { nv += q.g.attributes.position.count; ni += q.g.index ? q.g.index.count : q.g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const v = new THREE.Vector3(), N = new THREE.Matrix3();
  let ov = 0, oi = 0;
  for (const { g, M } of partes) {
    const P = g.attributes.position, Nn = g.attributes.normal, I = g.index, virar = M.determinant() < 0;
    N.getNormalMatrix(M);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(M);
      pos[(ov + i) * 3] = v.x; pos[(ov + i) * 3 + 1] = v.y; pos[(ov + i) * 3 + 2] = v.z;
      if (Nn) { v.fromBufferAttribute(Nn, i).applyMatrix3(N).normalize(); nor[(ov + i) * 3] = v.x; nor[(ov + i) * 3 + 1] = v.y; nor[(ov + i) * 3 + 2] = v.z; }
    }
    const n = I ? I.count : P.count;
    for (let k = 0; k < n; k += 3) {
      const a = (I ? I.getX(k) : k) + ov, b = (I ? I.getX(k + 1) : k + 1) + ov, c = (I ? I.getX(k + 2) : k + 2) + ov;
      idx[oi + k] = a; idx[oi + k + 1] = virar ? c : b; idx[oi + k + 2] = virar ? b : c;
    }
    ov += P.count; oi += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

function matriz(p: V3, r?: V3, s?: V3): THREE.Matrix4 {
  const q = new THREE.Quaternion();
  if (r) q.setFromEuler(new THREE.Euler(r[0], r[1], r[2]));
  return new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1], p[2]), q, s ? new THREE.Vector3(s[0], s[1], s[2]) : new THREE.Vector3(1, 1, 1));
}

/** Prancheta do carro: acumula as partes por material (em medidas nominais) e aplica a escala da peça. */
class Lote {
  private lotes = new Map<Mat, { g: THREE.BufferGeometry; M: THREE.Matrix4 }[]>();
  constructor(private escala: THREE.Matrix4) {}

  /** Parte já em coordenadas finais (rodas, que têm escala própria). */
  cru(mat: Mat, g: THREE.BufferGeometry, M: THREE.Matrix4) {
    const l = this.lotes.get(mat);
    if (l) l.push({ g, M }); else this.lotes.set(mat, [{ g, M }]);
  }
  /** Parte em medidas nominais; `par` repete a parte espelhada no outro lado do carro. */
  por(mat: Mat, g: THREE.BufferGeometry, M?: THREE.Matrix4, par = false) {
    const base = M ?? new THREE.Matrix4();
    this.cru(mat, g, this.escala.clone().multiply(base));
    if (par) this.cru(mat, g, this.escala.clone().multiply(ESPELHAR).multiply(base));
  }
  caixa(mat: Mat, t: V3, p: V3, par = false, r?: V3) { this.por(mat, CAIXA, matriz(p, r, t), par); }
  /** Cilindro deitado ao longo de Z (raio, comprimento, centro). */
  cilZ(mat: Mat, raio: number, comp: number, p: V3, par = false) { this.por(mat, CILINDRO, matriz(p, [MEIO_PI, 0, 0], [raio, comp, raio]), par); }

  fechar(): Geos {
    const g: Geos = {};
    this.lotes.forEach((partes, mat) => { g[mat] = fundir(partes); });
    return g;
  }
}

// ── Carroceria ──

type Nivel = { fS: number[]; nSh: number; fG: number[]; nR: number; fT: number[]; iVid: number; nc: number; na: number; passo: number };
/** Resolução da casca. fS = fileiras da lateral, fG = fileiras do vidro lateral, fT = faixas do teto (1 = borda, 0 = centro). */
const NIVEL_PADRAO: Nivel = { fS: [0, 0.14, 0.42, 0.71, 1], nSh: 2, fG: [0, 0.08, 0.5, 0.92, 1], nR: 2, fT: [1, 0.88, 0.45, 0], iVid: 1, nc: 5, na: 8, passo: 0.34 };
const NIVEL_APRIMORADO: Nivel = {
  fS: [0, 0.13, 0.27, 0.42, 0.57, 0.72, 0.87, 1], nSh: 4, fG: [0, 0.08, 0.29, 0.5, 0.71, 0.92, 1], nR: 5,
  fT: [1, 0.94, 0.88, 0.72, 0.54, 0.36, 0.18, 0], iVid: 2, nc: 9, na: 14, passo: 0.15,
};

type Estacao = { z: number; dentro: boolean };

/** Estações ao longo do comprimento: concentradas nos cantos e nos arcos de roda, com as linhas dos vidros. */
function estacoes(n: Nivel): Estacao[] {
  const E: Estacao[] = [];
  for (let k = n.nc; k >= 0; k--) E.push({ z: -(ZC_T + (ZP - ZC_T) * Math.pow(Math.sin((k / n.nc) * MEIO_PI), 2 / 2.8)), dentro: false });
  const arco = (zc: number) => { for (let k = 0; k <= n.na; k++) E.push({ z: zc - R_ARCO * Math.cos((Math.PI * k) / n.na), dentro: true }); };
  arco(Z_EIXO_T);
  const cortes = [Z_EIXO_T + R_ARCO, COLUNAS[0][0], COLUNAS[0][1], Z_TETO_F, Z_JANELA_F, Z_EIXO_F - R_ARCO];
  E.push({ z: cortes[0], dentro: false });
  for (let c = 1; c < cortes.length; c++) {
    const a = cortes[c - 1], b = cortes[c], q = Math.max(1, Math.ceil((b - a) / n.passo - 1e-6));
    for (let s = 1; s <= q; s++) E.push({ z: a + ((b - a) * s) / q, dentro: false });
  }
  arco(Z_EIXO_F);
  for (let k = 0; k <= n.nc; k++) E.push({ z: ZC_F + (ZP - ZC_F) * Math.pow(Math.sin((k / n.nc) * MEIO_PI), 2 / 2.6), dentro: false });
  // Linhas dos vidros que caem dentro de um arco ou de um canto (só entram se não ficarem coladas a outra estação).
  for (const c of [Z_VIGIA, Z_TETO_T, Z_JANELA_T, COLUNAS[1][0], COLUNAS[1][1], Z_COLUNA_A]) {
    for (let i = 0; i + 1 < E.length; i++) if (E[i].z < c - 0.02 && E[i + 1].z > c + 0.02) { E.splice(i + 1, 0, { z: c, dentro: E[i].dentro && E[i + 1].dentro }); break; }
  }
  return E;
}

/** Casca da carroceria (metade direita, espelhada): pintura, vidros recuados, plásticos e assoalho escuro. */
function carroceria(d: Lote, n: Nivel) {
  const E = estacoes(n), NS = E.length;
  const nSc = n.fS.length - 1, nGc = n.fG.length - 1, nTc = n.fT.length - 1;
  const jOmb = 4 + nSc, jVid = jOmb + n.nSh, jArc = jVid + nGc, jTop = jArc + n.nR, NP = jTop + nTc + 1, NV = NS * NP;

  // Pontos da meia seção, do centro do assoalho (j = 0) ao centro do teto (j = NP − 1).
  const P = new Float64Array(NV * 3);
  for (let i = 0; i < NS; i++) {
    const z = E[i].z, s = secao(z, E[i].dentro);
    let o = i * NP * 3;
    const p = (x: number, y: number) => { P[o++] = x; P[o++] = y; P[o++] = z; };
    p(0, s.yB); p(s.xi, s.yB); p(s.xi, s.yA); p(lado(s.w, s.yS, s.yLo) - 0.03, s.yA);
    for (const f of n.fS) { const y = mix(s.yLo, s.yS, f); p(lado(s.w, s.yS, y), y); }
    for (let k = 1; k <= n.nSh; k++) { const a = (s.th * k) / n.nSh; p(s.w - 0.03 - R_OMBRO + R_OMBRO * Math.cos(a), s.yS + R_OMBRO * Math.sin(a)); }
    for (let k = 1; k <= nGc; k++) p(mix(s.g0x, s.g1x, n.fG[k]), mix(s.g0y, s.g1y, n.fG[k]));
    for (let k = 1; k <= n.nR; k++) { const a = mix(TOMB, MEIO_PI, k / n.nR); p(s.cx + s.rr * Math.cos(a), s.cy + s.rr * Math.sin(a)); }
    for (let k = 1; k <= nTc; k++) p(s.cx * n.fT[k], s.yRe + s.cr * (1 - n.fT[k] ** 2));
  }

  // Material de cada célula (entre os pontos j e j+1, entre as estações i e i+1).
  const material = (j: number, zm: number): Mat => {
    if (j <= 4) return "plastico";                       // assoalho, caixa de roda, soleira e saia lateral
    if (j < jVid) return "pintura";
    if (j < jArc) {
      const k = j - jVid;
      if (zm < Z_JANELA_T || zm > Z_JANELA_F) return "pintura";
      if (k === 0) return "plastico";                    // friso preto da linha de cintura
      if (k === nGc - 1 || COLUNAS.some(c => zm > c[0] && zm < c[1])) return "pintura";
      return "vidro";
    }
    if (j < jTop || j - jTop < n.iVid) return "pintura";  // canto do teto e colunas A/D
    return (zm < Z_COLUNA_A && zm > Z_TETO_F) || (zm > Z_VIGIA && zm < Z_TETO_T) ? "vidro" : "pintura";
  };

  // Triângulos e normais (ponderadas pela área). Dois grupos de normais: A = por baixo do carro, B = exterior —
  // assim a quina da soleira e das caixas de roda fica viva e todo o resto, suave.
  const nA = new Float64Array(NV * 3), nB = new Float64Array(NV * 3);
  const tris: number[] = [], triMat: Mat[] = [], triA: boolean[] = [];
  const acumular = (N: Float64Array, a: number, b: number, c: number): boolean => {
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-16) return false;   // célula colapsada (ex.: vidros sobre o capô)
    for (const q of [a, b, c]) { N[q * 3] += nx; N[q * 3 + 1] += ny; N[q * 3 + 2] += nz; }
    return true;
  };
  for (let i = 0; i + 1 < NS; i++) {
    const dupla = Math.abs(E[i + 1].z - E[i].z) < 1e-6, zm = (E[i].z + E[i + 1].z) / 2;   // dupla = borda de um arco de roda
    for (let j = 0; j + 1 < NP; j++) {
      if (dupla && j > 3) continue;
      const grupoA = j < 3 || dupla, mat = material(j, zm);
      const a = i * NP + j, b = a + 1, c = a + NP, e = c + 1;
      for (const t of [[a, b, c], [b, e, c]]) if (acumular(grupoA ? nA : nB, t[0], t[1], t[2])) { tris.push(t[0], t[1], t[2]); triMat.push(mat); triA.push(grupoA); }
    }
  }
  // Tampas planas da frente e da traseira (leque a partir do centro), somadas às normais do exterior.
  const tampas = [0, NS - 1].map(i => {
    const o = i * NP, frente = i > 0, t: number[] = [];
    for (let j = 0; j + 1 < NP; j++) {
      const a = o + j, b = a + 1;
      const area = Math.abs(P[a * 3] * P[b * 3 + 1] - P[b * 3] * P[a * 3 + 1]);
      if (area < 1e-10) continue;
      t.push(frente ? a : b, frente ? b : a);
      for (const q of [a, b]) if (q - o >= 3) nB[q * 3 + 2] += (frente ? 1 : -1) * area;
    }
    return { i, frente, t };
  });
  // Solda as normais dos pontos coincidentes (fileiras colapsadas e estações duplicadas) e normaliza.
  const igual = (a: number, b: number) => Math.abs(P[a * 3] - P[b * 3]) + Math.abs(P[a * 3 + 1] - P[b * 3 + 1]) + Math.abs(P[a * 3 + 2] - P[b * 3 + 2]) < 1e-7;
  const soldar = (ids: number[]) => {
    for (let e = 0; e < 3; e++) { let s = 0; for (const q of ids) s += nB[q * 3 + e]; for (const q of ids) nB[q * 3 + e] = s; }
  };
  for (let i = 0; i < NS; i++) for (let j = 3; j + 1 < NP;) {
    let f = j;
    while (f + 1 < NP && igual(i * NP + f, i * NP + f + 1)) f++;
    if (f > j) soldar(Array.from({ length: f - j + 1 }, (_, k) => i * NP + j + k));
    j = f + 1;
  }
  for (let i = 0; i + 1 < NS; i++) if (Math.abs(E[i + 1].z - E[i].z) < 1e-6) for (let j = 4; j < NP; j++) if (igual(i * NP + j, (i + 1) * NP + j)) soldar([i * NP + j, (i + 1) * NP + j]);
  for (const N of [nA, nB]) for (let q = 0; q < NV; q++) {
    if (q % NP === 0 || q % NP === NP - 1) N[q * 3] = 0;   // linha de centro: a normal não pende para um lado
    const l = Math.hypot(N[q * 3], N[q * 3 + 1], N[q * 3 + 2]) || 1;
    N[q * 3] /= l; N[q * 3 + 1] /= l; N[q * 3 + 2] /= l;
  }

  // Distribui os triângulos pelas malhas de cada material; o vidro fica 6 mm recuado (aparece a borracha).
  const subs: Record<"pintura" | "vidro" | "plastico", Sub> = { pintura: new Sub(), vidro: new Sub(), plastico: new Sub() };
  for (let t = 0; t < triMat.length; t++) {
    const mat = triMat[t] as "pintura" | "vidro" | "plastico", s = subs[mat], N = triA[t] ? nA : nB, rec = mat === "vidro" ? 0.006 : 0;
    for (let k = 0; k < 3; k++) {
      const q = tris[t * 3 + k];
      s.idx.push(s.v((triA[t] ? NV : 0) + q, P[q * 3] - N[q * 3] * rec, P[q * 3 + 1] - N[q * 3 + 1] * rec, P[q * 3 + 2] - N[q * 3 + 2] * rec, N[q * 3], N[q * 3 + 1], N[q * 3 + 2]));
    }
  }
  for (const { i, frente, t } of tampas) {
    const o = i * NP, s = subs.pintura, nz = frente ? 1 : -1;
    const centro = s.v(-1, 0, (P[o * 3 + 1] + P[(o + NP - 1) * 3 + 1]) / 2, P[o * 3 + 2], 0, 0, nz);
    const v = (q: number) => (q - o >= 3 ? s.v(q, P[q * 3], P[q * 3 + 1], P[q * 3 + 2], nB[q * 3], nB[q * 3 + 1], nB[q * 3 + 2]) : s.v(2 * NV + q, P[q * 3], P[q * 3 + 1], P[q * 3 + 2], 0, 0, nz));
    for (let k = 0; k < t.length; k += 2) s.idx.push(centro, v(t[k]), v(t[k + 1]));
  }
  d.por("pintura", subs.pintura.geo(), undefined, true);
  d.por("vidro", subs.vidro.geo(), undefined, true);
  d.por("plastico", subs.plastico.geo(), undefined, true);
}

// ── Peças assentadas sobre a lateral ──

/** Vetor normal (não normalizado) da lateral em (z, y), por diferenças finitas. */
function normalLado(z: number, y: number): V3 {
  const h = 0.002, z0 = Math.max(-ZP, z - h), z1 = Math.min(ZP, z + h);
  const xz = (ladoEm(z1, y) - ladoEm(z0, y)) / (z1 - z0), xy = (ladoEm(z, y + h) - ladoEm(z, y - h)) / (2 * h);
  const l = Math.hypot(1, xy, xz);
  return [1 / l, -xy / l, -xz / l];
}

/**
 * Remendo que acompanha a lateral e dobra o canto (faróis e lanternas): colunas em z crescente, altura dada por
 * `faixa`, afastado `folga` da lataria. Coluna com `rec` > 0 fica na face plana da ponta, `rec` metros para dentro.
 */
function remendo(colunas: { z: number; rec: number }[], faixa: (z: number) => [number, number], nl: number, folga: number): THREE.BufferGeometry {
  const s = new Sub();
  for (const { z, rec } of colunas) {
    const [y0, y1] = faixa(z);
    for (let l = 0; l <= nl; l++) {
      const y = mix(y0, y1, l / nl), x = ladoEm(z, y);
      if (rec > 0) s.v(-1, x - rec, y, z + Math.sign(z) * folga, 0, 0, Math.sign(z));
      else { const n = normalLado(z, y); s.v(-1, x + n[0] * folga, y + n[1] * folga, z + n[2] * folga, n[0], n[1], n[2]); }
    }
  }
  for (let i = 0; i + 1 < colunas.length; i++) for (let j = 0; j < nl; j++) {
    const a = i * (nl + 1) + j, b = a + 1, c = a + nl + 1, e = c + 1;
    s.idx.push(a, b, c, b, e, c);
  }
  return s.geo();
}

/** Moldura escura do arco de roda: aba que entra na caixa, face saliente e retorno até a lataria. */
function moldura(zc: number, seg: number): THREE.BufferGeometry {
  const perfil: [number, number][] = [[R_ARCO - 0.014, -0.05], [R_ARCO - 0.014, 0.012], [R_ARCO + 0.05, 0.012], [R_ARCO + 0.064, 0]];
  const colunas: number[][] = [];
  for (let i = 0; i <= seg; i++) {
    const a = mix(Math.PI + 0.3, -0.3, i / seg), col: number[] = [];
    for (const [r, folga] of perfil) { const z = zc + r * Math.cos(a), y = R_PNEU + r * Math.sin(a); col.push(ladoEm(z, y) + folga, y, z); }
    colunas.push(col);
  }
  return grade(colunas);
}

/** Vinco de porta: fita escura e fina que desce pela lateral em z. */
function vinco(z: number, seg: number): THREE.BufferGeometry {
  const y0 = 0.235, y1 = cintura(z) - R_OMBRO + 0.012, colunas: number[][] = [];
  for (const dz of [-0.004, 0.004]) {
    const col: number[] = [];
    for (let k = 0; k <= seg; k++) { const y = mix(y0, y1, k / seg); col.push(ladoEm(z + dz, y) + 0.008, y, z + dz); }
    colunas.push(col);
  }
  return grade(colunas);
}

// ── Rodas (referencial local: eixo em X, face de fora em +X, centro na origem) ──

/** Raio da roda: prisma afilado do cubo até o aro, levemente abaulado no modo aprimorado. */
function raio(largura0: number, largura1: number, ap: boolean): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, 1, ap ? 3 : 1, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) + 0.5;
    const a = mix(B_PNEU - 0.03, B_PNEU - 0.036, t) + (ap ? 0.01 * Math.sin(Math.PI * t) : 0) + p.getZ(i) * 0.02;
    p.setXYZ(i, a, mix(0.04, R_ARO - 0.018, t), -p.getX(i) * mix(largura0, largura1, t));
  }
  g.computeVertexNormals();
  return g;
}

function roda(ap: boolean): { mat: Mat; g: THREE.BufferGeometry; M?: THREE.Matrix4 }[] {
  const seg = ap ? 32 : 20, b = B_PNEU, R = R_PNEU, v = (r: number, a: number) => new THREE.Vector2(r, a);
  const partes: { mat: Mat; g: THREE.BufferGeometry; M?: THREE.Matrix4 }[] = [];
  const torno = (pts: THREE.Vector2[]) => new THREE.LatheGeometry(pts, seg).rotateZ(-MEIO_PI);   // o eixo do torno vira o eixo X

  // Pneu: flanco de dentro, ombro, banda de rodagem, ombro arredondado e flanco de fora.
  let perfil: THREE.Vector2[];
  if (ap) {
    const ro = 0.036;
    perfil = [v(R_ARO, -b), v(R - ro, -b)];
    for (let k = 1; k <= 4; k++) { const a = (k / 4) * MEIO_PI; perfil.push(v(R - ro + ro * Math.sin(a), -b + ro - ro * Math.cos(a))); }
    for (let k = 0; k <= 4; k++) { const a = (k / 4) * MEIO_PI; perfil.push(v(R - ro + ro * Math.cos(a), b - ro + ro * Math.sin(a))); }
    perfil.push(v(R_ARO + 0.05, b + 0.004), v(R_ARO, b - 0.002));
  } else perfil = [v(R_ARO, -b), v(R - 0.03, -b), v(R, -b + 0.03), v(R, b - 0.036), v(R - 0.011, b - 0.012), v(R - 0.04, b), v(R_ARO, b)];
  partes.push({ mat: "borracha", g: torno(perfil) });

  // Aro de liga: borda, degrau e tambor por dentro; fundo escuro para não se ver através da roda.
  partes.push({ mat: "liga", g: torno([v(R_ARO + 0.004, b - 0.008), v(R_ARO - 0.012, b - 0.008), v(R_ARO - 0.022, b - 0.035), v(R_ARO - 0.026, -b + 0.03)]) });
  partes.push({ mat: "plastico", g: new THREE.CircleGeometry(R_ARO - 0.02, seg).rotateY(MEIO_PI).translate(-b + 0.03, 0, 0) });

  // Disco de freio atrás dos raios (com chapéu e pinça no modo aprimorado).
  if (ap) {
    partes.push({ mat: "inox", g: new THREE.CylinderGeometry(0.168, 0.168, 0.02, 28).rotateZ(-MEIO_PI).translate(b - 0.09, 0, 0) });
    partes.push({ mat: "liga", g: CAIXA, M: matriz([b - 0.088, 0.1, -0.1], [Math.PI / 4, 0, 0], [0.05, 0.07, 0.13]) });
  } else partes.push({ mat: "inox", g: new THREE.CircleGeometry(0.168, 14).rotateY(MEIO_PI).translate(b - 0.085, 0, 0) });

  // Raios, cubo, calota central e (aprimorado) parafusos.
  const nr = ap ? 7 : 5, haste = raio(ap ? 0.044 : 0.052, ap ? 0.03 : 0.036, ap);
  for (let k = 0; k < nr; k++) partes.push({ mat: "liga", g: haste, M: new THREE.Matrix4().makeRotationX((k / nr) * DOIS_PI) });
  partes.push({ mat: "liga", g: new THREE.CylinderGeometry(0.05, 0.06, 0.05, ap ? 20 : 8, 1, !ap).rotateZ(-MEIO_PI).translate(b - 0.045, 0, 0) });
  partes.push({ mat: "cromado", g: new THREE.CylinderGeometry(0.026, 0.032, 0.008, ap ? 16 : 8).rotateZ(-MEIO_PI).translate(b - 0.016, 0, 0) });
  if (ap) for (let k = 0; k < 5; k++) {
    const a = ((k + 0.5) / 5) * DOIS_PI;
    partes.push({ mat: "cromado", g: CILINDRO, M: matriz([b - 0.017, 0.041 * Math.cos(a), 0.041 * Math.sin(a)], [0, 0, -MEIO_PI], [0.006, 0.008, 0.006]) });
  }
  return partes;
}

// ── Montagem ──

function construir(L: number, H: number, P: number, ap: boolean): Geos {
  const sx = L / LARGURA_NOMINAL, sy = H / ALTURA_NOMINAL, sz = P / COMPRIMENTO_NOMINAL;
  const d = new Lote(new THREE.Matrix4().makeScale(sx, sy, sz));
  const nv = ap ? NIVEL_APRIMORADO : NIVEL_PADRAO;

  carroceria(d, nv);

  // Rodas: escala uniforme (continuam redondas) e pneu encostado no piso.
  const sr = Math.min(sy, sz), pecas = roda(ap);
  for (const zc of [Z_EIXO_F, Z_EIXO_T]) for (const s of [1, -1]) {
    const x = (ladoEm(zc, 0.45) - 0.02) * sx - B_PNEU * sr;
    const M = new THREE.Matrix4().compose(new THREE.Vector3(s * x, R_PNEU * sr, zc * sz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s > 0 ? 0 : Math.PI), new THREE.Vector3(sr, sr, sr));
    for (const q of pecas) d.cru(q.mat, q.g, q.M ? M.clone().multiply(q.M) : M);
  }
  for (const zc of [Z_EIXO_F, Z_EIXO_T]) d.por("plastico", moldura(zc, ap ? 22 : 10), undefined, true);

  // Faróis: fundo aceso sob lente transparente, dobrando o canto e entrando na face da frente.
  const amostras = (z0: number, n: number, p: number) => Array.from({ length: n + 1 }, (_, k) => ({ z: z0 + (ZP - z0) * Math.pow(Math.sin((k / n) * MEIO_PI), 2 / p), rec: 0 }));
  const nf = ap ? 12 : 6;
  const colFarol = [...amostras(1.93, nf, 2.6), { z: ZP, rec: 0.12 }];
  const faixaFarol = (z: number): [number, number] => { const y1 = cintura(z) - R_OMBRO - 0.012; return [y1 - 0.03 - 0.085 * suave((z - 1.93) / 0.17), y1]; };
  d.por("farol", remendo(colFarol, faixaFarol, ap ? 3 : 1, 0.004), undefined, true);
  d.por("lente", remendo(colFarol, faixaFarol, ap ? 3 : 1, 0.01), undefined, true);
  if (ap) for (const [x, y] of [[0.31, 0.64], [0.37, 0.645]]) d.cilZ("cromado", 0.022, 0.006, [x, y, ZP + 0.006], true);   // projetores

  // Lanternas traseiras: mesma ideia, do canto para a tampa do porta-malas.
  const colLanterna = [{ z: -ZP, rec: 0.1 }, ...amostras(1.88, nf, 2.8).map(c => ({ z: -c.z, rec: 0 })).reverse()];
  const faixaLanterna = (z: number): [number, number] => { const y1 = cintura(z) - R_OMBRO - 0.015; return [y1 - 0.05 - 0.08 * suave((-z - 1.88) / 0.2), y1]; };
  d.por("lanterna", remendo(colLanterna, faixaLanterna, ap ? 3 : 1, 0.005), undefined, true);

  // Frente: grade superior com friso cromado e emblema, tomada de ar inferior e placa.
  d.caixa("plastico", [0.6, 0.13, 0.005], [0, 0.595, ZP + 0.0025]);
  d.caixa("cromado", [0.6, 0.012, 0.004], [0, 0.666, ZP + 0.006]);
  d.cilZ("cromado", 0.034, 0.005, [0, 0.595, ZP + 0.0065]);
  d.caixa("plastico", [0.7, 0.175, 0.005], [0, 0.412, ZP + 0.0025]);
  d.caixa("placa", [0.4, 0.13, 0.007], [0, 0.42, ZP + 0.0085]);
  if (ap) for (const y of [0.565, 0.625]) d.caixa("liga", [0.58, 0.008, 0.003], [0, y, ZP + 0.006]);

  // Traseira: placa, friso cromado, saia escura do para-choque e ponteira do escapamento.
  d.caixa("placa", [0.4, 0.13, 0.007], [0, 0.7, -ZP - 0.0035]);
  d.caixa("cromado", [0.46, 0.014, 0.005], [0, 0.795, -ZP - 0.0025]);
  d.caixa("plastico", [0.78, 0.125, 0.005], [0, 0.4, -ZP - 0.0025]);
  d.cilZ("cromado", 0.028, 0.1, [-0.3, 0.232, -ZP + 0.085]);
  if (ap) d.cilZ("plastico", 0.022, 0.004, [-0.3, 0.232, -ZP + 0.034]);

  // Laterais: vincos das portas, maçanetas e retrovisores (casca na cor do carro sobre haste escura).
  for (const z of [0.82, -0.19, -0.88]) d.por("plastico", vinco(z, ap ? 10 : 6), undefined, true);
  for (const z of [0, -0.72]) { const y = cintura(z) - 0.135; d.caixa("cromado", [0.022, 0.026, 0.15], [ladoEm(z, y) + 0.004, y, z], true); }
  d.por("pintura", ESFERA, matriz([0.834, 1.035, 0.8], undefined, [0.063, 0.05, 0.048]), true);
  d.caixa("cromado", [0.086, 0.064, 0.004], [0.836, 1.035, 0.765], true);
  d.caixa("plastico", [0.05, 0.03, 0.05], [0.79, 0.99, 0.8], true);

  // Barras de teto (longarinas) com pés.
  const trilho = [0.02, -0.7, -1.42].map((z): V3 => { const s = secao(z, false), x = s.cx - 0.05; return [x, s.yRe + s.cr * (1 - (x / s.cx) ** 2) + 0.022, z]; });
  for (let k = 0; k + 1 < trilho.length; k++) {
    const a = trilho[k], b = trilho[k + 1], comp = Math.hypot(b[1] - a[1], b[2] - a[2]);
    d.caixa("liga", [0.024, 0.016, comp + 0.02], [a[0], (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], true, [Math.atan2(a[1] - b[1], b[2] - a[2]), 0, 0]);
  }
  for (const p of trilho) d.caixa("liga", [0.028, 0.03, 0.07], [p[0], p[1] - 0.012, p[2]], true);

  // Interior visto pelos vidros: tampa na altura da cintura, painel, bancos com encosto de cabeça e forro do teto.
  d.caixa("plastico", [1.46, 0.1, 2.62], [0, 0.86, -0.44]);
  d.caixa("plastico", [1.2, 0.08, 0.26], [0, 0.93, -1.86]);
  d.caixa("plastico", [1.36, 0.07, 0.36], [0, 0.925, 0.7]);
  d.caixa("plastico", [0.44, 0.5, 0.11], [0.36, 1.16, -0.12], true, [-0.12, 0, 0]);
  d.caixa("plastico", [0.24, 0.15, 0.08], [0.36, 1.33, -0.16], true);
  d.caixa("plastico", [1.2, 0.42, 0.11], [0, 1.12, -1.02], false, [-0.14, 0, 0]);
  d.caixa("plastico", [0.22, 0.13, 0.08], [0.36, 1.31, -1.06], true);
  if (ap) d.por("plastico", new THREE.TorusGeometry(0.17, 0.014, 6, 18), matriz([0.36, 1.02, 0.44], [-0.45, 0, 0]));   // volante (motorista à esquerda)
  const forro = new Sub(), zf = [-1.55, -1.05, -0.5, 0.1];
  for (const z of zf) { const s = secao(z, false); forro.v(-1, s.cx - 0.05, s.yRe - 0.035, z, 0, -1, 0); forro.v(-1, 0, s.yRe + s.cr - 0.03, z, 0, -1, 0); }
  for (let i = 0; i + 1 < zf.length; i++) forro.idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  d.por("plastico", forro.geo(), undefined, true);

  return d.fechar();
}

// ── Materiais próprios do carro (criados uma vez e reaproveitados) ──

const CORES: Record<string, { cor: string; metal: number }> = {
  prata: { cor: "#C2C6CA", metal: 0.65 }, grafite: { cor: "#3A3E43", metal: 0.65 }, branco: { cor: "#F1F2F0", metal: 0.25 },
  preto: { cor: "#0B0C0E", metal: 0.55 }, vermelho: { cor: "#9C1A1E", metal: 0.5 }, azul: { cor: "#1D3C70", metal: 0.6 },
};
const pinturas = new Map<string, THREE.MeshPhysicalMaterial>();

/** Pintura automotiva: base metálica sob verniz. */
function pintura(nome: string): THREE.MeshPhysicalMaterial {
  // EPIC-028 (Etapa 3): a cor do item do JSON-fonte (#rrggbb) também vale, como pintura metálica.
  const hex = /^#[0-9a-fA-F]{6}$/.test(nome);
  const chave = hex ? nome.toLowerCase() : nome in CORES ? nome : "prata";
  let p = pinturas.get(chave);
  if (!p) {
    p = hex
      ? new THREE.MeshPhysicalMaterial({ color: chave, metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 })
      : new THREE.MeshPhysicalMaterial({ color: CORES[chave].cor, metalness: CORES[chave].metal, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
    pinturas.set(chave, p);
  }
  return p;
}

type Proprios = Record<"vidro" | "plastico" | "borracha" | "liga" | "farol" | "lente" | "lanterna", THREE.Material>;
let proprios: Proprios | null = null;

function acabamentos(): Proprios {
  proprios ??= {
    vidro: new THREE.MeshPhysicalMaterial({ color: "#10161B", roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.55, depthWrite: false }),
    plastico: new THREE.MeshStandardMaterial({ color: "#17181A", roughness: 0.72, metalness: 0.05 }),
    borracha: new THREE.MeshStandardMaterial({ color: "#0E0E0F", roughness: 0.92 }),
    liga: new THREE.MeshStandardMaterial({ color: "#C9CCD0", roughness: 0.28, metalness: 0.9 }),
    farol: new THREE.MeshStandardMaterial({ color: "#E9ECEE", roughness: 0.25, metalness: 0.6, emissive: "#FFEFD2", emissiveIntensity: 0.45 }),
    lente: new THREE.MeshPhysicalMaterial({ color: "#FFFFFF", roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.28, depthWrite: false }),
    lanterna: new THREE.MeshPhysicalMaterial({ color: "#8E0E12", roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05, emissive: "#C01016", emissiveIntensity: 0.35 }),
  };
  return proprios;
}

/** Vidros e lentes não projetam sombra. */
const SEM_SOMBRA: ReadonlySet<Mat> = new Set<Mat>(["vidro", "lente", "farol", "lanterna"]);

/** Carro da garagem: SUV compacto, frente em +Z. `peca.opcoes.cor`: prata (padrão), grafite, branco, preto, vermelho ou azul. */
function Carro({ peca, m, aprimorado }: PropsMovel) {
  const { largura: L, altura: H, profundidade: P } = peca;
  const cor = typeof peca.opcoes?.cor === "string" ? peca.opcoes.cor : "prata", ap = aprimorado === true;
  const g = useMemo(() => construir(L, H, P, ap), [L, H, P, ap]);
  useEffect(() => () => { for (const x of Object.values(g)) x.dispose(); }, [g]);
  const mats = useMemo((): Record<Mat, THREE.Material> => ({ ...acabamentos(), pintura: pintura(cor), cromado: m.cromado, inox: m.inox, placa: m.plastico }), [cor, m]);
  return (
    <group>
      {(Object.keys(g) as Mat[]).map(n => (
        <mesh key={n} geometry={g[n]} material={mats[n]} castShadow={!SEM_SOMBRA.has(n)} receiveShadow />
      ))}
    </group>
  );
}

export const MOVEIS_GARAGEM: CatalogoMoveis = { carro: Carro };
