// Maquete 3D (EPIC-022, etapa 2) — móveis paramétricos das áreas de estar, jantar, escritório e decoração.
// Tudo é gerado por código (nenhum modelo nem textura externa). Cada móvel é desenhado no referencial local
// descrito em tipos.ts (origem no centro da base, costas em −Z, frente em +Z) e cabe na caixa da peça.
//
// Desempenho (roda em celular): cada móvel junta suas partes em UMA geometria por material (poucas chamadas de
// desenho), as bordas arredondadas usam uma caixa de 108 triângulos e os cilindros têm poucos segmentos.
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
 * Caixa de bordas arredondadas e barata: uma caixa 3×3×3 cujas fileiras internas são levadas até o início do
 * raio; os vértices das arestas e dos cantos vão para o arco e recebem a normal radial (sombreamento suave).
 */
function caixaRedonda(w: number, h: number, p: number, raio: number): THREE.BufferGeometry {
  const r = Math.max(0.0005, Math.min(raio, w * 0.49, h * 0.49, p * 0.49));
  const g = new THREE.BoxGeometry(w, h, p, 3, 3, 3);
  const pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute;
  const meio = [w / 2, h / 2, p / 2], v = [0, 0, 0], dentro = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    v[0] = pos.getX(i); v[1] = pos.getY(i); v[2] = pos.getZ(i);
    let d2 = 0;
    for (let e = 0; e < 3; e++) {
      const lim = meio[e] - r;
      // Fileira interna (em ±meio/3) vai para o início do arredondamento.
      if (Math.abs(v[e]) < meio[e] * 0.6) v[e] = Math.sign(v[e]) * lim;
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

/** Placa de cantos arredondados em planta (tampos e tapete): y de 0 a `esp`, UV 0..1 sobre a face de cima. */
function placa(L: number, P: number, esp: number, raio: number): THREE.BufferGeometry {
  const r = Math.max(0.001, Math.min(raio, L * 0.49, P * 0.49)), x = L / 2, y = P / 2, q = Math.PI / 2;
  const s = new THREE.Shape();
  s.moveTo(-x + r, -y);
  s.lineTo(x - r, -y); s.absarc(x - r, -y + r, r, -q, 0, false);
  s.lineTo(x, y - r); s.absarc(x - r, y - r, r, 0, q, false);
  s.lineTo(-x + r, y); s.absarc(-x + r, y - r, r, q, 2 * q, false);
  s.lineTo(-x, -y + r); s.absarc(-x + r, -y + r, r, 2 * q, 3 * q, false);
  const g = new THREE.ExtrudeGeometry(s, { depth: esp, bevelEnabled: false, curveSegments: 3 });
  g.rotateX(-q);
  const pos = g.attributes.position, uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / L + 0.5, 0.5 - pos.getZ(i) / P);
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

  private por(mat: NomeMaterial, g: THREE.BufferGeometry, M: THREE.Matrix4) {
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
  redonda(mat: NomeMaterial, t: V3, p: V3, raio: number, r?: V3) { this.geo(mat, caixaRedonda(t[0], t[1], t[2], raio), p, r); }

  /** Cilindro vertical: raio, altura, centro `p`. */
  cil(mat: NomeMaterial, raio: number, alt: number, p: V3) { this.geo(mat, CILINDRO, p, undefined, [raio, alt, raio]); }

  esfera(mat: NomeMaterial, raio: number | V3, p: V3, simples = false) { this.geo(mat, simples ? ESFERA_SIMPLES : ESFERA, p, undefined, typeof raio === "number" ? [raio, raio, raio] : raio); }

  private entre(mat: NomeMaterial, g: THREE.BufferGeometry, a: V3, b: V3, s: THREE.Vector3) {
    const va = new THREE.Vector3(a[0], a[1], a[2]), dir = new THREE.Vector3(b[0], b[1], b[2]).sub(va), comp = dir.length() || 1e-6;
    const q = new THREE.Quaternion().setFromUnitVectors(EIXO_Y, dir.divideScalar(comp));
    s.y *= comp;
    this.por(mat, g, new THREE.Matrix4().compose(va.addScaledVector(dir, comp / 2), q, s));
  }

  /** Haste redonda de `a` até `b` (raio `ra` em `a`, `rb` em `b`): pés, hastes, varões, troncos. */
  haste(mat: NomeMaterial, a: V3, b: V3, ra: number, rb = ra, seg = 12) {
    if (ra === rb && seg === 16) this.entre(mat, CILINDRO, a, b, new THREE.Vector3(ra, 1, ra));
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

function useDesenho(desenhar: (d: Desenho) => void, deps: DependencyList): Geos {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const g = useMemo(() => { const d = new Desenho(); desenhar(d); return d.fechar(); }, deps);
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
  return function Movel({ peca, m, estilo }: PropsMovel) {
    const { largura: L, altura: H, profundidade: P, opcoes, id } = peca;
    const chave = JSON.stringify(opcoes);
    const g = useDesenho(d => construir(d, {
      L, H, P, estilo, op: opcoes, r: sorteio(semente(id)),
      luxo: estilo === "luxo", esc: estilo === "escandinavo", mod: estilo === "moderno",
    }), [L, H, P, estilo, chave, id]);
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
    if (estilo === "moderno") d.barra(o.mat ?? "metal", [x, 0, z], [x, h, z], 0.026 * k);
    else if (estilo === "escandinavo") {
      const a = Math.min(h * 0.16, 0.05);
      d.haste(o.mat ?? "madeira", [x, 0.004, z], [x - sx * a, h, z - sz * a], 0.013 * k, 0.023 * k, 8);
    } else d.haste(o.mat ?? "metal", [x, 0, z], [x, h, z], 0.012 * k, 0.024 * k, 8);
  }
}

/** Tampo com espessura e chanfro por baixo (uma segunda placa recuada faz a sombra do chanfro). */
function tampoMesa(d: Desenho, mat: NomeMaterial, L: number, P: number, H: number, tt: number, raio: number) {
  d.geo(mat, placa(L, P, tt * 0.6, raio), [0, H - tt * 0.6, 0]);
  d.geo(mat, placa(L - 0.03, P - 0.03, tt * 0.4, raio), [0, H - tt, 0]);
}

/** Puxador na frente de porta/gaveta, saindo de `z` para +Z (no máximo 1,8 cm). */
function puxador(d: Desenho, estilo: Estilo, x: number, y: number, z: number, comp: number, vertical: boolean) {
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
      const x = sx * (L / 2 - ab / 2);
      if (luxo) {
        // Braço enrolado: corpo + rolo deitado em cima.
        d.redonda("tecido", [ab * 0.92, ya - hp - ab * 0.4, P], [x, (hp + ya - ab * 0.4) / 2, 0], 0.035);
        d.haste("tecido", [x, ya - ab / 2, -P / 2 + 0.004], [x, ya - ab / 2, P / 2 - 0.004], ab / 2, ab / 2, 14);
      } else d.redonda("tecido", [ab, ya - hp, P], [x, (hp + ya) / 2, 0], Math.min(rr, ab * 0.45));
    }
    pes(d, estilo, L, P, hp + 0.01, Math.max(0.04, ab * 0.5), { esp: luxo ? 1.5 : 1.15 });
  }

  // Almofadas soltas do assento e do encosto, com uma fresta entre elas (o vivo da costura).
  const folga = 0.012, wa = Li / n - folga, ds = P / 2 - 0.012 - zf;
  const hc = (H - ys) * 0.93, th = te * 0.8, a = 0.13, yc = ys + hc / 2 + 0.004, zc = zf + th / 2 + 0.02;
  for (let i = 0; i < n; i++) {
    const x = -Li / 2 + (Li / n) * (i + 0.5);
    d.redonda("tecido", [wa, tc, ds], [x, ys - tc / 2, zf + ds / 2], tc * (luxo ? 0.46 : esc ? 0.4 : 0.3));
    d.redonda("tecido", [wa, hc, th], [x, yc, zc], th * (luxo ? 0.46 : 0.38), [-a, 0, 0]);
    if (luxo && !externa) {
      // Botões do capitonê.
      for (const bx of [-0.25, 0.25]) for (const by of [0.08]) {
        const p = noEncosto(yc, zc, a, th, 0, by * hc);
        d.esfera("tecido", [0.016, 0.016, 0.008], [x + bx * wa, p[1], p[2] - 0.002], true);
      }
    }
  }
  // Almofadas decorativas.
  if (!externa) {
    const lado = Math.min(0.36 * e, (H - ys) * 0.82), lista: [number, number][] = n > 1 ? [[-1, 0.2], [1, -0.28]] : [[1, -0.2]];
    for (const [sx, giro] of lista) {
      const x = sx * (Li / 2 - lado * 0.56);
      d.redonda("tecidoAlt", [lado, lado, 0.11 * e], [x, ys + lado * 0.5, zc + th / 2 + 0.075 * e], 0.05 * e, [-0.32, 0, giro]);
    }
  }
}

const sofa: Construtor = (d, c) => estofado(d, c, Number(c.op.lugares) || (c.L >= 2.1 ? 3 : 2), false);
const poltrona: Construtor = (d, c) => estofado(d, c, 1, c.op.externa === true);

// ── Mesas ──

const mesaCentro: Construtor = (d, { L, H, P, estilo, luxo, esc }) => {
  const tt = luxo ? 0.045 : esc ? 0.03 : 0.022, yt = H - tt;
  if (esc) {
    tampoMesa(d, "madeira", L, P, H, tt, Math.min(L, P) * 0.24);
    pes(d, estilo, L, P, yt + 0.005, 0.11, { esp: 1.25 });
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
  d.geo(luxo ? "madeiraEscura" : "madeira", placa(L - 2 * rec - b, P - 2 * rec - b, 0.018, 0.004), [0, ys, 0]);
  // Livros empilhados na prateleira de baixo.
  const yl = ys + 0.018, cores: NomeMaterial[] = ["tecidoAlt", "laminado", "madeiraEscura"];
  let y = yl;
  for (let k = 0; k < 3; k++) {
    const hl = 0.028 + k * 0.004, lw = Math.min(0.26, L * 0.26) - k * 0.02;
    if (y + hl > yt - b - 0.01) break;
    d.caixa(cores[k], [lw, hl, Math.min(0.19, P * 0.36) - k * 0.015], [-L * 0.2, y + hl / 2, 0.01], [0, 0.12 * (k - 1), 0]);
    y += hl;
  }
};

const mesaJantar: Construtor = (d, { L, H, P, estilo, luxo, esc, op }) => {
  const tt = luxo ? 0.06 : esc ? 0.036 : 0.03, yt = H - tt;
  if (esc) {
    tampoMesa(d, "madeira", L, P, H, tt, 0.07);
    // Saia de madeira recuada e pés-palito abertos.
    for (const sz of [-1, 1]) d.caixa("madeira", [L - 0.24, 0.07, 0.022], [0, yt - 0.035, sz * (P / 2 - 0.1)]);
    for (const sx of [-1, 1]) d.caixa("madeira", [0.022, 0.07, P - 0.2], [sx * (L / 2 - 0.12), yt - 0.035, 0]);
    pes(d, estilo, L, P, yt, 0.06, { esp: 1.6 });
  } else if (luxo) {
    tampoMesa(d, "pedra", L, P, H, tt, 0.015);
    // Pedestais: dois na mesa comprida, um na curta; base e capitel de metal.
    const dois = Number(op.lugares) >= 6 && L >= 1.5, xs = dois ? [-L * 0.27, L * 0.27] : [0];
    const wb = dois ? Math.min(0.5, L * 0.26) : L * 0.5, wcol = dois ? 0.16 : Math.max(0.16, L * 0.2);
    for (const x of xs) {
      d.redonda("metal", [wb, 0.03, P * 0.72], [x, 0.015, 0], 0.01);
      d.redonda("madeiraEscura", [wcol, yt - 0.06, P * 0.42], [x, yt / 2, 0], 0.02);
      d.redonda("metal", [wb * 0.9, 0.03, P * 0.6], [x, yt - 0.015, 0], 0.01);
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
    d.redonda("tecido", [L * 0.98, ta, P * 0.9], [0, hs - ta / 2, P * 0.04], ta * 0.45);
    d.redonda("tecido", [L * 0.94, hb, th], [0, yc, zc], th * 0.45, [-a, 0, 0]);
    for (const bx of [-0.2, 0.2]) for (const by of [-0.12, 0.22]) {
      const p = noEncosto(yc, zc, a, th, 0, by * hb);
      d.esfera("tecido", [0.014, 0.014, 0.007], [bx * L, p[1], p[2] - 0.002], true);
    }
    for (const sx of [-1, 1]) d.haste("madeiraEscura", [sx * L * 0.3, hl - 0.02, zBase - 0.01], [sx * L * 0.3, yc, zc - 0.005], 0.014, 0.012, 8);
  } else if (esc) {
    pes(d, estilo, L, P, hl + 0.005, 0.035, { esp: 1.1 });
    d.redonda("madeira", [L * 0.96, 0.028, P * 0.9], [0, hl + 0.014, P * 0.03], 0.012);
    d.redonda("tecido", [L * 0.86, ta - 0.026, P * 0.8], [0, hs - (ta - 0.026) / 2, P * 0.035], 0.012);
    // Encosto: dois montantes inclinados, travessa curva em cima e três palitos.
    const yB = hl, yT = H - 0.02, zT = -P / 2 + 0.02, zEm = (y: number) => zBase + ((y - yB) / (yT - yB)) * (zT - zBase);
    for (const sx of [-1, 1]) d.haste("madeira", [sx * (L / 2 - 0.045), yB, zBase], [sx * (L / 2 - 0.045), yT, zT], 0.015, 0.012, 10);
    d.redonda("madeira", [L * 0.96, 0.11, 0.026], [0, H - 0.08, zEm(H - 0.08)], 0.012, [-a, 0, 0]);
    for (const fx of [-0.2, 0, 0.2]) d.haste("madeira", [fx * L, hl + 0.02, zEm(hl + 0.02)], [fx * L, H - 0.1, zEm(H - 0.1)], 0.007, 0.007, 8);
  } else {
    pes(d, estilo, L, P, hl, 0.03, { esp: 0.85 });
    for (const sz of [-1, 1]) d.caixa("metal", [L - 0.06, 0.018, 0.018], [0, hl - 0.009, sz * (P / 2 - 0.03)]);
    d.redonda("tecido", [L * 0.96, ta, P * 0.88], [0, hs - ta / 2, P * 0.04], 0.022);
    // Encosto estofado baixo, preso por duas hastes metálicas.
    const hp = hb * 0.62, off = (hb - hp) / 2;
    d.redonda("tecido", [L * 0.9, hp, th], [0, yc + off * Math.cos(a), zc - off * Math.sin(a)], 0.018, [-a, 0, 0]);
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
  d.redonda("tecido", [wS, ta, P * 0.8], [0, hs - ta / 2, P * 0.06], ta * (luxo ? 0.45 : 0.36));
  const th = luxo ? 0.09 : esc ? 0.05 : 0.04, vao = luxo ? 0.03 : 0.1;
  const hb = H - hs - vao - 0.012, yc = hs + vao + hb / 2, zc = -P / 2 + th / 2 + 0.006 + (hb / 2) * Math.sin(a);
  d.redonda("tecido", [L * (luxo ? 0.78 : 0.72), hb, th], [0, yc, zc], luxo ? th * 0.45 : esc ? 0.04 : 0.02, [-a, 0, 0]);
  d.barra("metalEscuro", [0, hs - ta - 0.018, -P * 0.22], [0, yc, zc - th * 0.25], 0.05, 0.018);
  if (luxo) for (const bx of [-0.18, 0.18]) for (const by of [-0.2, 0.05, 0.3]) {
    const p = noEncosto(yc, zc, a, th, 0, by * hb);
    d.esfera("tecido", [0.014, 0.014, 0.007], [bx * L, p[1], p[2] - 0.002], true);
  }
  if (comBraco) for (const sx of [-1, 1]) {
    const x = sx * (L / 2 - 0.03);
    d.barra("metalEscuro", [sx * (wS / 2 - 0.02), hs - ta * 0.6, 0.02], [x, hs + 0.17, 0.02], 0.022, 0.03);
    d.redonda(luxo ? "tecido" : "metalEscuro", [0.05, luxo ? 0.035 : 0.022, P * 0.42], [x, hs + 0.18, 0.02], 0.01);
  }
};

// ── Armários baixos ──

/**
 * Corpo de armário baixo com frentes sobrepostas (frestas de sombra), puxadores e base conforme o estilo.
 * `colunas`: para cada módulo, o número de gavetas (0 = porta).
 */
function gabinete(d: Desenho, { L, H, P, estilo, luxo, esc, mod }: Contexto, colunas: number[]) {
  const hp = Math.min(luxo ? 0.09 : esc ? 0.16 : 0.07, H * 0.3), tt = luxo ? 0.035 : 0.022, pf = 0.018, pux = 0.018;
  const corpo: NomeMaterial = luxo ? "madeiraEscura" : esc ? "laminado" : "madeira";
  const frente: NomeMaterial = mod ? "laminado" : "madeira";
  const Lc = luxo ? L - 0.04 : L - 0.004, Pc = P - pf - pux, zc = -P / 2 + Pc / 2, zf = -P / 2 + Pc, hc = H - tt - hp;
  d.caixa(corpo, [Lc, hc, Pc], [0, hp + hc / 2, zc]);
  const Pt = luxo ? P : Pc + pf;
  d.redonda(luxo ? "pedra" : esc ? "madeira" : corpo, [L, tt, Pt], [0, H - tt / 2, -P / 2 + Pt / 2], luxo ? 0.008 : 0.004);
  const fresta = 0.005, li = Lc - 0.012, wc = li / colunas.length, hf = hc - 0.012;
  colunas.forEach((ng, j) => {
    const x = -li / 2 + wc * (j + 0.5), n = Math.max(1, ng), hg = hf / n, porta = ng === 0;
    for (let k = 0; k < n; k++) {
      const y = hp + 0.006 + hg * (k + 0.5), t: V3 = [wc - fresta, hg - fresta, pf], p: V3 = [x, y, zf + pf / 2];
      if (esc && porta) d.redonda(frente, t, p, 0.006); else d.caixa(frente, t, p);
      if (porta) puxador(d, estilo, x + (j < colunas.length / 2 ? 1 : -1) * (wc / 2 - 0.035), y + hg * 0.18, zf + pf, Math.min(0.16, hg * 0.4), true);
      else puxador(d, estilo, x, mod ? y + hg / 2 - 0.022 : y, zf + pf, Math.min(0.18, wc * 0.42), false);
    }
  });
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
    d.caixa("metalEscuro", [w * 0.3, h * 0.3, 0.012], [0, y, -P / 2 + 0.004]);
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
    d.caixa(luxo || esc ? "madeira" : "laminado", [wg - 0.006, hsaia - 0.03, 0.012], [x, yt - hsaia / 2, zf + 0.006]);
    puxador(d, estilo, x, yt - hsaia / 2, zf + 0.012, Math.min(0.14, wg * 0.35), false);
  }
  const hl = yt - hsaia + 0.004;
  pes(d, estilo, Ls, Ps, hl, 0.03, { zc: -0.012, esp: 1.1 });
  if (!esc) d.geo(corpo, placa(Ls - 0.07, Ps - 0.07, 0.02, 0.004), [0, 0.16, -0.012]);
  else for (const sz of [-1, 1]) d.haste("madeira", [-Ls / 2 + 0.045, hl * 0.3, -0.012 + sz * (Ps / 2 - 0.045)], [Ls / 2 - 0.045, hl * 0.3, -0.012 + sz * (Ps / 2 - 0.045)], 0.009, 0.009, 8);
};

/** Bloco de gavetas (frente em +Z) entre y0 e y1, centrado em x. */
function gaveteiro(d: Desenho, estilo: Estilo, x: number, w: number, y0: number, y1: number, P: number, n: number, corpo: NomeMaterial, frente: NomeMaterial) {
  const pf = 0.016, Pc = P - 0.07 - pf, zc = -P / 2 + 0.025 + Pc / 2, zf = zc + Pc / 2, hg = (y1 - y0 - 0.008) / n;
  d.caixa(corpo, [w, y1 - y0, Pc], [x, (y0 + y1) / 2, zc]);
  for (let k = 0; k < n; k++) {
    const y = y0 + 0.004 + hg * (k + 0.5);
    d.caixa(frente, [w - 0.008, hg - 0.005, pf], [x, y, zf + pf / 2]);
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

function vaso(d: Desenho, x: number, y: number, z: number, raio: number, alt: number) {
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
      d.caixa(cor(), [lw - 0.002, lh, lp], [x + lw / 2, y + lh / 2, z0 + 0.02 + lp / 2]);
      x += lw;
    }
    const inc = 0.28;
    if (r() > 0.45 && x + lh * Math.sin(inc) + 0.05 < x1) {
      d.caixa(cor(), [0.028, lh, lp], [x + 0.014 * Math.cos(inc) + (lh / 2) * Math.sin(inc) + 0.002, y + (lh / 2) * Math.cos(inc) + 0.014 * Math.sin(inc), z0 + 0.02 + lp / 2], [0, 0, -inc]);
      x += lh * Math.sin(inc) + 0.04;
    }
    if (x1 - x > 0.2 && r() > 0.35) vaso(d, (x + x1) / 2 + 0.02, y, zm, Math.min(0.055, prof * 0.2), Math.min(alt * 0.75, 0.2));
  } else if (tipo < 0.82) {
    // Pilha de livros deitados com um objeto em cima e um vaso ao lado.
    const xs = x0 + w * 0.3, n = 2 + Math.floor(r() * 3);
    let yy = y;
    for (let k = 0; k < n; k++) {
      const hl = 0.025 + r() * 0.02;
      if (yy + hl > y + alt * 0.7) break;
      d.caixa(cor(), [Math.min(w * 0.5, 0.2 + r() * 0.05), hl, Math.min(prof * 0.78, 0.15 + r() * 0.04)], [xs, yy + hl / 2, zm], [0, (r() - 0.5) * 0.3, 0]);
      yy += hl;
    }
    if (yy + 0.07 < y + alt) d.esfera("metal", 0.03, [xs, yy + 0.03, zm], true);
    if (w > 0.42) vaso(d, x0 + w * 0.76, y, zm, Math.min(0.06, prof * 0.2), Math.min(alt * 0.8, 0.24));
  } else {
    // Caixa organizadora e um vaso baixo.
    const wb = Math.min(w * 0.5, 0.3), hb = Math.min(alt * 0.6, 0.18);
    d.redonda(r() > 0.5 ? "tecidoAlt" : "tecido", [wb, hb, prof * 0.72], [x0 + 0.03 + wb / 2, y + hb / 2, zm], 0.012);
    if (w - wb > 0.2) vaso(d, x0 + wb + (w - wb) * 0.55, y, zm, Math.min(0.05, prof * 0.18), Math.min(alt * 0.5, 0.14));
  }
}

const estante: Construtor = (d, { L, H, P, estilo, luxo, esc, mod, r }) => {
  if (mod) {
    // Estrutura metálica aberta com prateleiras de madeira.
    const b = 0.025, n = Math.max(3, Math.round(H / 0.4)), y0 = 0.08, passo = (H - 0.03 - y0) / n;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) d.barra("metal", [sx * (L / 2 - b / 2), 0, sz * (P / 2 - b / 2)], [sx * (L / 2 - b / 2), H, sz * (P / 2 - b / 2)], b);
    for (let k = 0; k <= n; k++) {
      const y = y0 + k * passo;
      d.caixa("madeira", [L - 0.006, 0.03, P - 0.006], [0, y + 0.015, 0]);
      if (k < n) enfeitar(d, r, -L / 2 + b + 0.01, L / 2 - b - 0.01, y + 0.03, -P / 2 + 0.02, P - 0.05, passo - 0.035);
    }
    return;
  }
  const e = luxo ? 0.034 : 0.024, hp = luxo ? 0.08 : 0.14, Lc = luxo ? L - 0.03 : L, hc = H - hp - (luxo ? 0.05 : 0);
  const corpo: NomeMaterial = luxo ? "madeiraEscura" : "madeira", fundo: NomeMaterial = luxo ? "madeira" : "laminado";
  for (const sx of [-1, 1]) d.caixa(corpo, [e, hc, P - 0.01], [sx * (Lc / 2 - e / 2), hp + hc / 2, 0]);
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
    d.caixa(corpo, [li + 0.002, e, P - (k === 0 || k === n ? 0.01 : 0.035)], [0, y + e / 2, k === 0 || k === n ? 0 : -0.0075]);
    if (luxo && k > 0 && k < n) d.caixa("metal", [li, 0.006, 0.004], [0, y + e / 2, P / 2 - 0.023]);
    if (k === n) break;
    const baias: [number, number][] = meio ? [[-li / 2, -0.01], [0.01, li / 2]] : [[-li / 2, li / 2]];
    if (esc && k === 0) {
      // Escandinavo: o nicho de baixo é fechado por portas.
      const wpt = li / 2;
      for (const sx of [-1, 1]) {
        d.redonda("laminado", [wpt - 0.005, passo - e - 0.005, 0.016], [sx * wpt / 2, y + e + (passo - e) / 2, P / 2 - 0.027], 0.005);
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
    d.caixa(tabua, [L - 0.008, 0.03, P - 0.012], [0, y + 0.015, 0]);
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
          d.caixa(r() > 0.5 ? "plastico" : "tecido", [w - 0.01, h - 0.02, pz], [x + w / 2, yb + (h - 0.02) / 2, 0]);
          d.caixa(r() > 0.5 ? "tecidoAlt" : "metalEscuro", [w, 0.022, pz + 0.012], [x + w / 2, yb + h - 0.011, 0]);
          x += w + 0.03;
        } else if (t < 0.8) {
          // Latas e potes.
          const rr = 0.045 + r() * 0.03, h = Math.min(livre * 0.7, 0.12 + r() * 0.1);
          if (x + 2 * rr > x1) break;
          const zl = (r() - 0.5) * P * 0.3;
          d.haste(r() > 0.5 ? "inox" : esc ? "tecidoAlt" : "metal", [x + rr, yb, zl], [x + rr, yb + h, zl], rr, rr, 8);
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
  peciolo: (t: number) => (t < 0.42 ? 0.09 : Math.max(t < 0.9 ? 0.09 : 0, Math.sin(Math.PI * ((t - 0.42) / 0.58) ** 0.8)) ** 0.7),
};

/**
 * Folhas arqueadas em uma só geometria. Cada folha é uma fita dobrada em V que nasce em `o`, segue `dir` e
 * pende com a gravidade; o comprimento é encurtado para a folha não sair do raio/altura da caixa da peça.
 */
function folhagem(fs: Folha[], lim: { R: number; H: number; piso: number }): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const lado = new THREE.Vector3(), nor = new THREE.Vector3();
  for (const f of fs) {
    const pts: THREE.Vector3[] = [new THREE.Vector3()], tg: THREE.Vector3[] = [];
    let mh = 1e-6, sobe = 1e-6, desce = 1e-6;
    for (let k = 0; k < f.seg; k++) {
      const u = (k + 0.5) / f.seg, t = new THREE.Vector3(f.dir[0], f.dir[1] - f.caida * u * u, f.dir[2]).normalize();
      const p = pts[k].clone().addScaledVector(t, 1 / f.seg);
      tg.push(t); pts.push(p);
      mh = Math.max(mh, Math.hypot(p.x, p.z)); sobe = Math.max(sobe, p.y); desce = Math.max(desce, -p.y);
    }
    const r0 = Math.hypot(f.o[0], f.o[2]);
    const comp = Math.max(0.02, Math.min(f.comp, (lim.R - f.larg * 0.3 - r0) / mh, (lim.H - f.o[1]) / sobe, (f.o[1] - lim.piso) / desce));
    const base = pos.length / 3;
    for (let k = 0; k <= f.seg; k++) {
      const u = k / f.seg, t = tg[Math.min(k, f.seg - 1)];
      lado.crossVectors(t, EIXO_Y);
      if (lado.lengthSq() < 1e-6) lado.set(1, 0, 0);
      lado.normalize(); nor.crossVectors(lado, t).normalize();
      const w = (f.larg * PERFIS[f.perfil](u)) / 2, dob = w * 0.36;
      const cx = f.o[0] + pts[k].x * comp, cy = f.o[1] + pts[k].y * comp, cz = f.o[2] + pts[k].z * comp;
      pos.push(cx - lado.x * w + nor.x * dob, cy - lado.y * w + nor.y * dob, cz - lado.z * w + nor.z * dob, cx, cy, cz,
        cx + lado.x * w + nor.x * dob, cy + lado.y * w + nor.y * dob, cz + lado.z * w + nor.z * dob);
      uv.push(0, u, 0.5, u, 1, u);
      if (k < f.seg) { const a = base + k * 3; idx.push(a, a + 1, a + 4, a, a + 4, a + 3, a + 1, a + 2, a + 5, a + 1, a + 5, a + 4); }
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
  d.geo("vasoPlanta", new THREE.TorusGeometry(rb, 0.011, 6, 16), [0, hv, 0], [Math.PI / 2, 0, 0]);
  d.cil("terra", rb * 0.92, 0.012, [0, hv + 0.001, 0]);

  const fs: Folha[] = [], lim = { R: R - 0.008, H: H - 0.004, piso: hv * 0.75 }, hf = H - hv;
  const emLeque = (n: number, f: (fr: number) => Omit<Folha, "o" | "dir"> & { inc: number }) => {
    for (let i = 0; i < n; i++) {
      const fr = n > 1 ? i / (n - 1) : 0, q = f(fr), az = i * 2.39996 + r() * 0.4, inc = q.inc;
      fs.push({ ...q, o: [Math.cos(az) * rb * 0.3 * fr, hv, Math.sin(az) * rb * 0.3 * fr], dir: [Math.sin(inc) * Math.cos(az), Math.cos(inc), Math.sin(inc) * Math.sin(az)] });
    }
  };
  if (grande && esc) {
    // Arvoreta: tronco fino, alguns galhos e uma copa de folhas largas.
    const yc = hv + hf * 0.66, Rv = hf * 0.33;
    d.haste("madeiraEscura", [0, hv, 0], [R * 0.1, hv + hf * 0.33, 0.01], 0.02, 0.016, 8);
    d.haste("madeiraEscura", [R * 0.1, hv + hf * 0.33, 0.01], [0, yc + Rv * 0.2, 0], 0.016, 0.009, 8);
    for (let i = 0; i < 5; i++) {
      const a = (i * DOIS_PI) / 5 + r(), yg = hv + hf * (0.4 + r() * 0.2), fx = R * 0.1 * Math.min(1, (yc - yg) / (hf * 0.33));
      d.haste("madeiraEscura", [fx, yg, 0], [Math.cos(a) * R * 0.4, yg + Rv * (0.4 + r() * 0.4), Math.sin(a) * R * 0.4], 0.008, 0.004, 6);
    }
    for (let i = 0; i < 64; i++) {
      const az = r() * DOIS_PI, uy = -0.5 + r() * 1.5, ur = Math.sqrt(Math.max(0.05, 1 - Math.min(1, uy * uy))), ux = Math.cos(az) * ur, uz = Math.sin(az) * ur;
      const dir = new THREE.Vector3(ux, uy * 0.6 + 0.35, uz).normalize();
      fs.push({ o: [ux * R * 0.38, yc + uy * Rv * 0.45, uz * R * 0.38], dir: [dir.x, dir.y, dir.z], comp: R * (0.5 + r() * 0.25), larg: R * 0.44, caida: 0.6 + r() * 0.7, seg: 3, perfil: "oval" });
    }
    d.geo("folha", folhagem(fs, { R: lim.R, H: lim.H, piso: yc - Rv }));
    return;
  }
  if (grande && luxo) emLeque(30, fr => ({ inc: 0.08 + fr * 0.8, comp: hf * (1.3 - 0.4 * fr), larg: R * 0.2, caida: 0.45 + fr * 2.2, seg: 6, perfil: "lamina" }));        // palmeira de folhas finas
  else if (grande) emLeque(14, fr => ({ inc: 0.08 + fr * 0.55, comp: hf * (1.25 - 0.35 * fr), larg: R * 0.46, caida: 0.5 + fr * 1.0, seg: 7, perfil: "peciolo" }));      // folhas largas em hastes
  else if (mod) emLeque(13, fr => ({ inc: 0.03 + fr * 0.24, comp: hf * (1.02 - 0.35 * fr * r()), larg: R * 0.34, caida: 0.05, seg: 4, perfil: "lamina" }));              // espada-de-são-jorge
  else emLeque(36, fr => ({ inc: 0.12 + fr * 1.05, comp: hf * (1.15 - 0.5 * fr), larg: R * (luxo ? 0.22 : 0.32), caida: 0.7 + fr * 1.3, seg: 5, perfil: "oval" }));      // touceira cheia
  d.geo("folha", folhagem(fs, lim));
};

// ── Iluminação ──

const luminariaPiso: Construtor = (d, { L, H, P, luxo, esc }) => {
  const R = Math.min(L, P) / 2, hc = limitar(H * 0.19, 0.18, 0.34), yb = H - hc;
  if (esc) {
    // Tripé de madeira com cúpula de tecido.
    for (let i = 0; i < 3; i++) {
      const a = (i * DOIS_PI) / 3 + Math.PI / 6;
      d.haste("madeira", [Math.cos(a) * (R - 0.014), 0, Math.sin(a) * (R - 0.014)], [Math.cos(a) * 0.02, yb - 0.01, Math.sin(a) * 0.02], 0.012, 0.014, 8);
    }
    d.cil("madeira", 0.036, 0.05, [0, yb - 0.035, 0]);
    d.haste("luz", [0, yb, 0], [0, H, 0], R * 0.97, R * 0.9, 16);
  } else if (luxo) {
    d.cil("metal", R * 0.72, 0.02, [0, 0.01, 0]);
    d.cil("metal", R * 0.46, 0.02, [0, 0.03, 0]);
    d.haste("metal", [0, 0.04, 0], [0, yb + 0.03, 0], 0.012, 0.012, 10);
    d.esfera("metal", 0.03, [0, H * 0.42, 0]);
    d.esfera("metal", 0.022, [0, yb - 0.05, 0]);
    d.haste("luz", [0, yb, 0], [0, H - 0.03, 0], R * 0.98, R * 0.55, 16);        // cúpula cônica
    d.cil("metal", R * 0.99, 0.008, [0, yb + 0.004, 0]);
    d.esfera("metal", 0.015, [0, H - 0.015, 0]);
  } else {
    d.cil("metal", R * 0.74, 0.016, [0, 0.008, 0]);
    d.haste("metal", [0, 0.016, 0], [0, yb + 0.03, 0], 0.009, 0.009, 10);
    d.haste("luz", [0, yb, 0], [0, H, 0], R * 0.62, R * 0.62, 16);               // cúpula cilíndrica esbelta
    for (const y of [yb + 0.003, H - 0.003]) d.cil("metal", R * 0.635, 0.006, [0, y, 0]);
  }
};

const pendente: Construtor = (d, { L, H, P, luxo, esc }) => {
  const R = Math.min(L, P) / 2, hc = Math.min(0.3, H * 0.45);
  d.cil("metal", 0.05, 0.02, [0, H - 0.01, 0]);                                  // canopla no teto
  if (esc) {
    // Globo leitoso com tampa de madeira.
    const rg = Math.min(R, hc / 2);
    d.esfera("luz", rg, [0, rg, 0]);
    d.cil("madeira", rg * 0.38, 0.05, [0, 2 * rg - 0.005, 0]);
    d.haste("metalEscuro", [0, 2 * rg, 0], [0, H - 0.01, 0], 0.004, 0.004, 6);
  } else if (luxo) {
    // Tambor com aros dourados, suspenso por três tirantes.
    d.haste("luz", [0, 0.01, 0], [0, hc - 0.01, 0], R * 0.93, R * 0.93, 16);
    for (const y of [0.01, hc - 0.01]) d.cil("metal", R, 0.02, [0, y, 0]);
    const yj = Math.min(H - 0.1, hc + R * 1.1);
    for (let i = 0; i < 3; i++) { const a = (i * DOIS_PI) / 3; d.haste("metal", [Math.cos(a) * R * 0.9, hc, Math.sin(a) * R * 0.9], [0, yj, 0], 0.003, 0.003, 6); }
    d.esfera("metal", 0.014, [0, yj, 0]);
    d.haste("metal", [0, yj, 0], [0, H - 0.01, 0], 0.005, 0.005, 6);
  } else {
    // Cúpula metálica cônica com difusor embaixo.
    d.haste("metal", [0, 0.016, 0], [0, hc, 0], R, 0.05, 16);
    d.cil("luz", R * 0.88, 0.016, [0, 0.009, 0]);
    d.cil("metal", 0.03, 0.05, [0, hc + 0.02, 0]);
    d.haste("metalEscuro", [0, hc, 0], [0, H - 0.01, 0], 0.004, 0.004, 6);
  }
};

const plafon: Construtor = (d, { L, H, P, luxo, esc }) => {
  const R = Math.min(L, P) / 2;
  if (esc) {
    d.cil("madeira", R, H * 0.45, [0, H * 0.775, 0]);
    d.esfera("luz", [R * 0.9, H * 0.5, R * 0.9], [0, H * 0.5, 0]);              // difusor abaulado
  } else if (luxo) {
    d.cil("metal", R, H * 0.35, [0, H * 0.825, 0]);
    d.cil("luz", R * 0.86, H * 0.5, [0, H * 0.42, 0]);
    d.cil("metal", R * 0.9, H * 0.06, [0, H * 0.66, 0]);
    d.cil("luz", R * 0.5, H * 0.17, [0, H * 0.085, 0]);
    d.cil("metal", R * 0.54, H * 0.05, [0, H * 0.17, 0]);
  } else {
    // Quadrado e fino, com moldura metálica.
    d.redonda("metal", [L, H * 0.4, P], [0, H * 0.8, 0], 0.008);
    d.redonda("luz", [L * 0.9, H * 0.7, P * 0.9], [0, H * 0.35, 0], 0.012);
  }
};

// ── Decoração ──

const tapete: Construtor = (d, { L, H, P, luxo, esc }) => {
  d.geo("tapete", placa(L, P, H, esc ? 0.1 : luxo ? 0.035 : 0.02));
};

const quadro: Construtor = (d, { L, H, P, luxo, esc, mod }) => {
  const b = luxo ? 0.055 : esc ? 0.03 : 0.016, margem = esc ? Math.min(0.08, H * 0.12) : luxo ? 0.012 : 0;
  // Moderno: parede larga recebe um díptico; os demais, um quadro só (com passe-partout no escandinavo).
  const n = mod && L >= 1.2 ? 2 : 1, vao = 0.06, w = (L - (n - 1) * vao) / n, zf = -P / 2 + P * 0.4;
  for (let k = 0; k < n; k++) {
    const x = -L / 2 + w / 2 + k * (w + vao);
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

/** Pano de cortina com pregas em onda (seção senoidal), do lado de fora (`xFora`) até a borda interna. */
function pano(xFora: number, xDentro: number, y0: number, y1: number, amp: number, ondas: number, linhas: number, prende: number, irregular: boolean): THREE.BufferGeometry {
  const cols = ondas * 4, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= linhas; j++) {
    const v = j / linhas, y = y0 + (y1 - y0) * v;
    const aperto = prende * Math.exp(-(((v - 0.42) / 0.17) ** 2));          // abraçadeira (luxo) recolhe o pano
    const a = amp * (0.65 + 0.35 * (1 - v)) * (1 - aperto * 0.3);
    for (let i = 0; i <= cols; i++) {
      const u = i / cols, x = xFora + (xDentro - xFora) * u * (1 - aperto);
      const z = a * Math.sin(u * ondas * DOIS_PI) + (irregular ? a * 0.22 * Math.sin(u * ondas * 2.3 + v * 2) : 0);
      pos.push(x, y, z); uv.push(u, v);
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
  }
  // Dois panos recolhidos para os lados, deixando parte da janela à vista.
  const abertura = limitar(vao * 0.55, 0.15, Math.max(0.15, L - 0.5)), xo = L / 2 - 0.045, wp = xo - abertura / 2;
  if (wp < 0.08) return;
  const amp = Math.min(0.036, P * 0.3), ondas = limitar(Math.round(wp / 0.11), 2, 9), linhas = luxo ? 8 : 3;
  for (const sx of [-1, 1]) {
    d.geo("cortina", pano(sx * xo, sx * abertura / 2, 0.015, yv - rv - 0.002, amp, ondas, linhas, luxo ? 0.5 : 0, esc));
    if (luxo) {
      const yt = 0.015 + (yv - 0.03) * 0.42, larg = wp * 0.5;
      d.caixa("metal", [larg + 0.02, 0.03, amp * 2 + 0.014], [sx * (xo - larg / 2), yt, 0]);
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
