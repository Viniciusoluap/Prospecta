// Maquete 3D (EPIC-022, etapa 2) — móveis paramétricos da área íntima e de serviço: quarto, cozinha, banheiro,
// lavanderia e churrasqueira. Tudo é desenhado por código (caixas, caixas arredondadas, cilindros e tornos), sem
// arquivo de modelo nem textura externa. Cada móvel monta, uma vez por medida/estilo, uma lista de partes simples
// no referencial local da peça (ver tipos.ts): origem no centro da base, costas em -Z e frente em +Z.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { RoundedBox } from "@react-three/drei";
import type { Estilo, Materiais } from "../materiais";
import type { CatalogoMoveis, DesenhoMovel, PropsMovel } from "./tipos";

// ── Partes: a "linguagem" com que os móveis são descritos ──

type V3 = [number, number, number];
type Mat = THREE.Material;
type Forma = "cx" | "rb" | "cil" | "esf" | "toro" | "anel" | "geo";
type Parte = {
  g: Forma;
  /** Argumentos da geometria (medidas da caixa, raios do cilindro etc.). */
  t: number[];
  p: V3; r?: V3; e?: V3; mat: Mat;
  /** Raio do canto e suavidade (só caixa arredondada). */
  raio?: number; s?: number;
  /** false = não projeta sombra (vidro). */
  sombra?: boolean;
  /** Geometria pronta (torno, coifa). */
  geo?: THREE.BufferGeometry;
};
type Extra = Partial<Pick<Parte, "r" | "e" | "s" | "sombra">>;

const ZERO: V3 = [0, 0, 0];
const UM: V3 = [1, 1, 1];
const EIXO_X: V3 = [0, 0, Math.PI / 2]; // cilindro deitado ao longo de X
const EIXO_Z: V3 = [Math.PI / 2, 0, 0]; // cilindro deitado ao longo de Z (o topo aponta para +Z)
const lim = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Espessura das frentes (portas e gavetas) e o quanto o puxador avança além delas. */
const ESP_FRENTE = 0.018;
/** Recuo da caixa do armário em relação à frente da peça: fresta + frente + puxador cabem nele. */
const RECUO_FRENTE = 0.05;
/** Fresta de sombra entre portas e gavetas. */
const FRESTA = 0.003;

/** Monta a lista de partes. Em todas as funções, (x, y, z) é o CENTRO da parte. */
function montar() {
  const l: Parte[] = [];
  return {
    l,
    cx: (w: number, h: number, d: number, x: number, y: number, z: number, mat: Mat, extra?: Extra) => {
      l.push({ g: "cx", t: [w, h, d], p: [x, y, z], mat, ...extra });
    },
    rb: (w: number, h: number, d: number, x: number, y: number, z: number, mat: Mat, raio: number, extra?: Extra) => {
      l.push({ g: "rb", t: [w, h, d], p: [x, y, z], mat, raio, ...extra });
    },
    cil: (rTopo: number, rBase: number, h: number, x: number, y: number, z: number, mat: Mat, seg = 14, extra?: Extra) => {
      l.push({ g: "cil", t: [rTopo, rBase, h, seg], p: [x, y, z], mat, ...extra });
    },
    outra: (g: Forma, t: number[], x: number, y: number, z: number, mat: Mat, extra?: Extra & { geo?: THREE.BufferGeometry }) => {
      l.push({ g, t, p: [x, y, z], mat, ...extra });
    },
  };
}
type K = ReturnType<typeof montar>;

function Peca({ q }: { q: Parte }) {
  const comum = {
    position: q.p, rotation: q.r ?? ZERO, scale: q.e ?? UM, material: q.mat,
    castShadow: q.sombra !== false, receiveShadow: true,
  };
  switch (q.g) {
    case "rb": {
      const raio = Math.max(0.001, Math.min(q.raio ?? 0.01, Math.min(q.t[0], q.t[1], q.t[2]) / 2 - 0.001));
      return <RoundedBox args={q.t as V3} radius={raio} smoothness={q.s ?? 2} {...comum} />;
    }
    case "cil": return <mesh {...comum}><cylinderGeometry args={q.t as ConstructorParameters<typeof THREE.CylinderGeometry>} /></mesh>;
    case "esf": return <mesh {...comum}><sphereGeometry args={q.t as ConstructorParameters<typeof THREE.SphereGeometry>} /></mesh>;
    case "toro": return <mesh {...comum}><torusGeometry args={q.t as ConstructorParameters<typeof THREE.TorusGeometry>} /></mesh>;
    case "anel": return <mesh {...comum}><ringGeometry args={q.t as ConstructorParameters<typeof THREE.RingGeometry>} /></mesh>;
    case "geo": return q.geo ? <mesh {...comum} geometry={q.geo} /> : null;
    default: return <mesh {...comum}><boxGeometry args={q.t as V3} /></mesh>;
  }
}

function Partes({ lista }: { lista: Parte[] }) {
  // As geometrias feitas à mão (torno, coifa) são liberadas quando a lista muda ou o móvel sai de cena.
  useEffect(() => () => { for (const q of lista) q.geo?.dispose(); }, [lista]);
  return <>{lista.map((q, i) => <Peca key={i} q={q} />)}</>;
}

/** Transforma uma função de montagem em componente: a lista só é refeita quando medida, opção ou estilo mudam. */
function criar(montagem: (p: PropsMovel) => Parte[]): DesenhoMovel {
  return function Movel({ peca, m, estilo }: PropsMovel) {
    const { largura, altura, profundidade } = peca;
    const opcoes = JSON.stringify(peca.opcoes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const lista = useMemo(() => montagem({ peca, m, estilo }), [largura, altura, profundidade, opcoes, m, estilo]);
    return <group><Partes lista={lista} /></group>;
  };
}

// ── Peças de marcenaria reaproveitadas ──

/**
 * Puxador sobre a face de uma frente (z = face da frente). Moderno: barra fina; escandinavo: botão redondo;
 * luxo: barra roliça dourada sobre dois apoios.
 */
function puxador(k: K, m: Materiais, estilo: Estilo, x: number, y: number, z: number, dir: "v" | "h", comp: number) {
  if (estilo === "escandinavo") { k.cil(0.016, 0.011, 0.022, x, y, z + 0.011, m.metal, 12, { r: EIXO_Z }); return; }
  if (estilo === "moderno") {
    if (dir === "v") k.cx(0.012, comp, 0.02, x, y, z + 0.01, m.metal); else k.cx(comp, 0.012, 0.02, x, y, z + 0.01, m.metal);
    return;
  }
  k.cil(0.006, 0.006, comp, x, y, z + 0.021, m.metal, 8, dir === "h" ? { r: EIXO_X } : undefined);
  for (const s of [-1, 1]) {
    const d = s * comp * 0.34;
    k.cil(0.004, 0.004, 0.018, dir === "h" ? x + d : x, dir === "v" ? y + d : y, z + 0.009, m.metal, 6, { r: EIXO_Z });
  }
}

type Pux = { lado: -1 | 0 | 1; alt: -1 | 0 | 1; dir: "v" | "h"; comp?: number } | null;

/**
 * Frente de porta ou gaveta: (x, y) é o centro e z a face de TRÁS. Luxo: almofada rebaixada com moldura (estilo
 * shaker); escandinavo: canto adoçado; moderno: chapa lisa. `pux` diz onde fica o puxador (lado e altura).
 */
function frente(k: K, m: Materiais, estilo: Estilo, o: { x: number; y: number; z: number; w: number; h: number; mat: Mat; pux: Pux }) {
  const e = ESP_FRENTE, moldurada = estilo === "luxo" && o.w > 0.16 && o.h > 0.16, e1 = e * 0.55;
  if (moldurada) {
    const b = Math.min(0.065, o.w * 0.2, o.h * 0.28), e2 = e - e1, zq = o.z + e1 + e2 / 2;
    k.cx(o.w, o.h, e1, o.x, o.y, o.z + e1 / 2, o.mat);
    for (const s of [-1, 1]) {
      k.cx(b, o.h, e2, o.x + s * (o.w / 2 - b / 2), o.y, zq, o.mat);
      k.cx(o.w - 2 * b, b, e2, o.x, o.y + s * (o.h / 2 - b / 2), zq, o.mat);
    }
  } else if (estilo === "escandinavo") k.rb(o.w, o.h, e, o.x, o.y, o.z + e / 2, o.mat, 0.005, { s: 1 });
  else k.cx(o.w, o.h, e, o.x, o.y, o.z + e / 2, o.mat);
  if (!o.pux) return;
  const { lado, alt, dir } = o.pux;
  const comp = Math.min(o.pux.comp ?? (dir === "h" ? Math.min(0.18, o.w * 0.5) : Math.min(0.16, o.h * 0.4)), (dir === "h" ? o.w : o.h) - 0.06);
  const px = o.x + lado * (o.w / 2 - (dir === "h" ? 0.04 + comp / 2 : 0.045));
  const py = o.y + alt * (o.h / 2 - (dir === "v" ? 0.045 + comp / 2 : 0.045));
  // No centro de uma frente moldurada o puxador assenta na almofada rebaixada.
  puxador(k, m, estilo, px, py, o.z + (moldurada && lado === 0 && alt === 0 ? e1 : e), dir, comp);
}

/** Quatro pés nos cantos (meia-largura `lx`, meia-profundidade `lz`, em torno de z = `zc`), conforme o estilo. */
function pes(k: K, m: Materiais, estilo: Estilo, lx: number, lz: number, zc: number, h: number) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * lx, z = zc + sz * lz;
    if (estilo === "moderno") k.cx(0.024, h, 0.024, x, h / 2, z, m.metal);
    else if (estilo === "escandinavo") k.cil(0.022, 0.013, h, x, h / 2, z, m.madeira, 10);
    else k.cil(0.03, 0.022, h, x, h / 2, z, m.madeiraEscura, 10);
  }
}

/** Torneira de bica alta ("pescoço de ganso"): sobe em (x, y, z) e a bica avança `alcance` para +Z. */
function torneira(k: K, m: Materiais, x: number, y: number, z: number, alt: number, alcance: number) {
  const r = 0.011, raio = alcance / 2;
  k.cil(0.02, 0.023, 0.03, x, y + 0.015, z, m.cromado, 12);
  k.cil(r, r, alt, x, y + 0.03 + alt / 2, z, m.cromado, 10);
  k.outra("toro", [raio, r, 6, 10, Math.PI], x, y + 0.03 + alt, z + raio, m.cromado, { r: [0, -Math.PI / 2, 0] });
  k.cil(r, r * 0.9, 0.035, x, y + 0.03 + alt - 0.0175, z + alcance, m.cromado, 10);
  // Alavanca do misturador, ao lado da base.
  k.cil(0.007, 0.007, 0.055, x + 0.045, y + 0.035, z, m.cromado, 8, { r: [0, 0, Math.PI / 2.6] });
}

type Furo = { x: number; z: number; w: number; d: number };

/** Tampo de pedra, inteiro ou com o recorte da cuba (quatro tiras em volta do furo). */
function tampo(k: K, mat: Mat, L: number, P: number, y: number, e: number, furo?: Furo | null) {
  if (!furo) { k.cx(L, e, P, 0, y, 0, mat); return; }
  const x0 = furo.x - furo.w / 2, x1 = furo.x + furo.w / 2, z0 = furo.z - furo.d / 2, z1 = furo.z + furo.d / 2;
  k.cx(x0 + L / 2, e, P, (x0 - L / 2) / 2, y, 0, mat);
  k.cx(L / 2 - x1, e, P, (x1 + L / 2) / 2, y, 0, mat);
  k.cx(furo.w, e, z0 + P / 2, furo.x, y, (z0 - P / 2) / 2, mat);
  k.cx(furo.w, e, P / 2 - z1, furo.x, y, (z1 + P / 2) / 2, mat);
}

/** Cuba de embutir: fundo e quatro paredes por fora do furo, descendo `h` a partir do tampo. */
function cuba(k: K, m: Materiais, mat: Mat, f: Furo, yTopo: number, h: number) {
  const e = 0.012, y = yTopo - h / 2 - 0.001;
  k.cx(f.w + 2 * e, e, f.d + 2 * e, f.x, yTopo - h - e / 2, f.z, mat);
  for (const s of [-1, 1]) {
    k.cx(e, h, f.d + 2 * e, f.x + s * (f.w / 2 + e / 2), y, f.z, mat);
    k.cx(f.w, h, e, f.x, y, f.z + s * (f.d / 2 + e / 2), mat);
  }
  k.cil(0.024, 0.024, 0.004, f.x, yTopo - h + 0.002, f.z, m.cromado, 12); // válvula do ralo
}

/** Sólido de revolução (bacia do vaso, cuba de apoio). O perfil vai de baixo para cima pelo lado de fora. */
function torno(perfil: [number, number][], seg = 16): THREE.BufferGeometry {
  return new THREE.LatheGeometry(perfil.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)), seg);
}

/** Tronco de pirâmide de base 1 × 1 e altura 1 (coifa da churrasqueira), com faces planas. */
function troncoPiramide(topo: number): THREE.BufferGeometry {
  const base = new THREE.CylinderGeometry(topo / Math.SQRT2, 1 / Math.SQRT2, 1, 4, 1);
  base.rotateY(Math.PI / 4);
  const g = base.toNonIndexed();
  base.dispose();
  g.computeVertexNormals();
  return g;
}

// ── Quarto ──

const cama = criar(({ peca, m, estilo }) => {
  const { largura: L, altura: H, profundidade: P } = peca, k = montar();
  const lux = estilo === "luxo", esc = estilo === "escandinavo";
  const casal = typeof peca.opcoes.casal === "boolean" ? peca.opcoes.casal : L > 1.3;
  const esp = 0.07, hp = lim(H * 0.2, 0.06, 0.14);
  // A altura da peça é o topo do colchão; a cabeceira sobe além dela (até ~1,1 m).
  const hc = Math.min(1.1, Math.max(H + 0.35, H * 1.9)), zCab = -P / 2;

  if (lux) {
    // Cabeceira estofada em gomos verticais sobre um painel de madeira escura.
    k.cx(L, hc, esp * 0.4, 0, hc / 2, zCab + esp * 0.2, m.madeiraEscura);
    const n = lim(Math.round(L / 0.3), 2, 6), wg = (L - 0.04) / n, y0 = H * 0.45, hg = hc - y0 - 0.02;
    for (let i = 0; i < n; i++) k.rb(wg - 0.006, hg, esp * 0.6, -L / 2 + 0.02 + wg * (i + 0.5), y0 + hg / 2, zCab + esp * 0.7, m.tecido, 0.022, { s: 1 });
  } else if (esc) {
    const h = hc * 0.9 - hp;
    k.rb(L, h, esp * 0.6, 0, hp + h / 2, zCab + esp * 0.3, m.madeira, 0.02);
  } else {
    // Moderno: painel reto de madeira com uma faixa estofada.
    k.cx(L, hc, esp * 0.5, 0, hc / 2, zCab + esp * 0.25, m.madeira);
    const h = hc - H - 0.12;
    k.rb(L - 0.06, h, esp * 0.5, 0, H + 0.04 + h / 2, zCab + esp * 0.75, m.tecido, 0.015, { s: 1 });
  }

  // Estrado/base e pés.
  const yb = H * 0.5, dBase = P - esp - 0.01, zBase = (esp - 0.01) / 2;
  if (esc) k.rb(L - 0.03, yb - hp, dBase, 0, (yb + hp) / 2, zBase, m.madeira, 0.015, { s: 1 });
  else k.cx(L - 0.03, yb - hp, dBase, 0, (yb + hp) / 2, zBase, lux ? m.tecido : m.madeira);
  if (lux) k.cx(L - 0.16, hp, dBase - 0.16, 0, hp / 2, zBase, m.madeiraEscura);
  else pes(k, m, estilo, L / 2 - 0.07, dBase / 2 - 0.07, zBase, hp);

  // Colchão, edredom (≈70% do comprimento, a partir dos pés) e a virada do lençol.
  const yM = H - 0.035, z0 = zCab + esp + 0.005, z1 = P / 2 - 0.025;
  k.rb(L - 0.05, yM - yb, z1 - z0, 0, (yM + yb) / 2, (z0 + z1) / 2, m.travesseiro, 0.05);
  const comp = 0.7 * (P - esp), yD = H - 0.012, yD0 = yb + 0.02;
  k.rb(L - 0.01, yD - yD0, comp, 0, (yD + yD0) / 2, P / 2 - comp / 2, m.roupaDeCama, 0.035);
  k.rb(L, 0.1, 0.2, 0, H - 0.05, P / 2 - comp + 0.1, m.travesseiro, 0.014, { s: 1 });

  // Travesseiros recostados na cabeceira e uma almofada decorativa.
  const n = casal ? 2 : 1, pw = Math.min(0.62, L / n - 0.1), zT = zCab + esp + 0.23;
  for (let i = 0; i < n; i++) k.rb(pw, 0.12, 0.38, casal ? (i ? 1 : -1) * L / 4 : 0, yM + 0.095, zT, m.travesseiro, 0.055, { r: [0.3, 0, 0] });
  const a = Math.min(0.34, L * 0.3);
  k.rb(a, a, 0.1, 0, yM + a * 0.5, zT + 0.25, m.tecidoAlt, 0.045, { s: 1, r: [-0.5, 0, 0] });
  return k.l;
});

const criadoMudo = criar(({ peca, m, estilo }) => {
  const { largura: L, altura: H, profundidade: P } = peca, k = montar();
  const lux = estilo === "luxo", esc = estilo === "escandinavo";
  const hp = H * (lux ? 0.1 : esc ? 0.3 : 0.24), et = lux ? 0.035 : 0.02;
  const corpo = esc ? m.madeira : m.laminado, zF = P / 2 - RECUO_FRENTE, wc = L - 0.02, hCorpo = H - et - hp;

  if (lux) k.cx(wc - 0.04, hp, P - RECUO_FRENTE - 0.05, 0, hp / 2, -RECUO_FRENTE / 2 - 0.005, m.madeiraEscura);
  else pes(k, m, estilo, wc / 2 - 0.035, (P - RECUO_FRENTE) / 2 - 0.035, -RECUO_FRENTE / 2, hp);
  k.cx(wc, hCorpo, P - RECUO_FRENTE, 0, hp + hCorpo / 2, -RECUO_FRENTE / 2, corpo);
  if (esc) k.rb(L, et, P, 0, H - et / 2, 0, m.madeira, 0.008, { s: 1 }); else k.cx(L, et, P, 0, H - et / 2, 0, lux ? m.madeiraEscura : m.madeira);

  // Gavetas: uma a cada ~17 cm de corpo.
  const n = Math.max(1, Math.round(hCorpo / 0.17)), hg = (hCorpo - FRESTA * (n + 1)) / n;
  for (let i = 0; i < n; i++) {
    frente(k, m, estilo, { x: 0, y: hp + FRESTA + hg / 2 + i * (hg + FRESTA), z: zF + 0.002, w: wc - 2 * FRESTA, h: hg, mat: esc ? m.madeira : m.laminado, pux: { lado: 0, alt: 0, dir: "h", comp: Math.min(0.14, L * 0.35) } });
  }

  if (peca.opcoes.abajur === true) {
    // Abajur: passa da altura da peça, como a cabeceira da cama.
    const s = Math.min(L, P) / 0.42, z = -P * 0.1;
    if (lux) {
      k.cil(0.04 * s, 0.045 * s, 0.012, 0, H + 0.006, z, m.metal, 14);
      k.outra("esf", [0.055 * s, 12, 8], 0, H + 0.012 + 0.066 * s, z, m.metal, { e: [1, 1.2, 1] });
      k.cil(0.008, 0.008, 0.06 * s, 0, H + 0.012 + 0.16 * s, z, m.metal, 8);
      k.cil(0.075 * s, 0.11 * s, 0.15 * s, 0, H + 0.012 + 0.255 * s, z, m.luz, 16);
    } else if (esc) {
      k.cil(0.022 * s, 0.05 * s, 0.13 * s, 0, H + 0.065 * s, z, m.madeira, 12);
      k.cil(0.006, 0.006, 0.07 * s, 0, H + 0.165 * s, z, m.metal, 8);
      k.cil(0.06 * s, 0.1 * s, 0.14 * s, 0, H + 0.25 * s, z, m.luz, 16);
    } else {
      k.cil(0.055 * s, 0.055 * s, 0.012, 0, H + 0.006, z, m.metal, 14);
      k.cil(0.007, 0.007, 0.2 * s, 0, H + 0.012 + 0.1 * s, z, m.metal, 8);
      k.cil(0.075 * s, 0.075 * s, 0.14 * s, 0, H + 0.012 + 0.25 * s, z, m.luz, 16);
    }
  }
  return k.l;
});

const guardaRoupa = criar(({ peca, m, estilo }) => {
  const { largura: L, altura: H, profundidade: P } = peca, k = montar();
  const lux = estilo === "luxo", esc = estilo === "escandinavo";
  const e = 0.022, et = lux ? 0.04 : e, hr = lim(H * 0.035, 0.05, 0.09), vao = L - 2 * e;
  const aberto = peca.opcoes.portas === "aberto";

  // Caixa: laterais, teto e rodapé recuado.
  for (const s of [-1, 1]) k.cx(e, H, P, s * (L / 2 - e / 2), H / 2, 0, m.madeira);
  k.cx(vao, et, P, 0, H - et / 2, 0, lux ? m.madeiraEscura : m.madeira);
  k.cx(vao, hr, P - 0.05, 0, hr / 2, -0.025, m.madeiraEscura);

  if (!aberto) {
    // Portas de correr em dois trilhos: a sobreposição entre folhas fica visível pelo degrau entre elas.
    const corPorta = esc ? m.madeira : m.laminado, ep = 0.022, sob = 0.03;
    const n = Math.max(2, Math.round(vao / 0.9)), wd = (vao + sob * (n - 1)) / n;
    const y0 = hr + 0.012, y1 = H - et - 0.012, hd = y1 - y0, yc = (y0 + y1) / 2;
    const iEspelho = esc ? -1 : n >= 3 ? 1 : n - 1;
    k.cx(vao, H - hr - et, P - 0.09, 0, (H + hr - et) / 2, -0.045, m.madeira); // miolo (fecha o fundo das frestas)
    for (const y of [hr + 0.006, H - et - 0.006]) k.cx(vao, 0.012, 0.07, 0, y, P / 2 - 0.047, m.metal); // trilhos
    for (let i = 0; i < n; i++) {
      const xc = -vao / 2 + wd / 2 + i * (wd - sob), zc = P / 2 - (i % 2 === 0 ? 0.062 : 0.036), zf = zc + ep / 2;
      k.cx(wd, hd, ep, xc, yc, zc, corPorta);
      if (i === iEspelho) k.cx(wd - 0.05, hd - 0.05, 0.004, xc, yc, zf + 0.002, m.espelho);
      else if (lux) {
        // Folha almofadada: moldura em volta e uma travessa no meio.
        const b = Math.min(0.07, wd * 0.14);
        for (const s of [-1, 1]) {
          k.cx(b, hd, 0.006, xc + s * (wd / 2 - b / 2), yc, zf + 0.003, corPorta);
          k.cx(wd - 2 * b, b, 0.006, xc, yc + s * (hd / 2 - b / 2), zf + 0.003, corPorta);
        }
        k.cx(wd - 2 * b, b, 0.006, xc, yc, zf + 0.003, corPorta);
      }
      // Puxador vertical fino na borda de fechamento da folha.
      const lado = i < n / 2 ? -1 : 1, xp = xc + lado * (wd / 2 - 0.035), yp = Math.min(1.05, hr + hd * 0.48);
      if (esc) k.cil(0.028, 0.028, 0.008, xp, yp, zf + 0.004, m.madeiraEscura, 14, { r: EIXO_Z });
      else k.cx(lux ? 0.016 : 0.012, Math.min(lux ? 1.1 : 0.9, hd * 0.45), 0.012, xp, yp, zf + 0.006, m.metal);
    }
    return k.l;
  }

  // Closet aberto: fundo, base, divisórias, cabideiro com roupas e prateleiras com pilhas dobradas.
  const tecidos: Mat[] = [m.tecido, m.roupaDeCama, m.tecidoAlt, m.tecido, m.travesseiro];
  const yBase = hr + e, dInt = P - 0.03, zInt = -0.01;
  k.cx(vao, H - hr - et, 0.01, 0, (H + hr - et) / 2, -P / 2 + 0.005, m.madeira);
  k.cx(vao, e, P - 0.01, 0, hr + e / 2, -0.005, m.madeira);
  const nm = Math.max(1, Math.round(vao / 0.85)), wm = (vao - e * (nm - 1)) / nm;
  const pilha = (x: number, y: number, w: number, semente: number) => {
    const np = 2 + (semente % 2);
    for (let j = 0; j < np; j++) {
      const h = 0.04 + ((semente + j) % 3) * 0.008;
      k.cx(w - j * 0.012, h, dInt * 0.55, x, y + h / 2, zInt + 0.03 - (j % 2) * 0.01, tecidos[(semente + j) % tecidos.length]);
      y += h + 0.001;
    }
  };
  for (let i = 0; i < nm; i++) {
    const xc = -vao / 2 + wm / 2 + i * (wm + e);
    if (i > 0) k.cx(e, H - yBase - et, dInt, xc - wm / 2 - e / 2, (H + yBase - et) / 2, zInt, m.madeira);
    if (i % 2 === 0) {
      // Módulo de cabideiro: maleiro em cima, varão cromado, roupas penduradas e gaveteiro embaixo.
      const yMal = H - et - 0.34, yVarao = yMal - 0.09, hGav = Math.min(0.4, (yVarao - yBase) * 0.3);
      k.cx(wm, e, dInt, xc, yMal, zInt, m.madeira);
      pilha(xc - wm * 0.2, yMal + e / 2, Math.min(0.32, wm * 0.4), i + 1);
      k.cil(0.012, 0.012, wm, xc, yVarao, 0, m.cromado, 10, { r: EIXO_X });
      const livre = Math.min(1.15, yVarao - 0.06 - (yBase + hGav + 0.05)), ng = lim(Math.floor(wm / 0.16), 2, 4);
      for (let j = 0; j < ng; j++) {
        const x = xc - wm / 2 + (wm * (j + 0.5)) / ng + (((i * 7 + j * 3) % 5) - 2) * 0.006;
        const comp = livre * [0.95, 0.62, 0.8, 0.7][(i + j) % 4];
        k.cx(0.006, 0.05, 0.006, x, yVarao - 0.03, 0, m.cromado);
        k.rb(0.05, comp, dInt * 0.66, x, yVarao - 0.055 - comp / 2, 0, tecidos[(i * 2 + j) % 4], 0.02, { s: 1 });
      }
      k.cx(wm, hGav, P - 0.06, xc, yBase + hGav / 2, -0.03, m.madeira);
      const hg = (hGav - FRESTA * 3) / 2;
      for (let j = 0; j < 2; j++) {
        frente(k, m, estilo, { x: xc, y: yBase + FRESTA + hg / 2 + j * (hg + FRESTA), z: P / 2 - 0.058, w: wm - 2 * FRESTA, h: hg, mat: esc ? m.madeira : m.laminado, pux: { lado: 0, alt: 0, dir: "h" } });
      }
    } else {
      // Módulo de prateleiras com roupas dobradas.
      const ns = Math.max(2, Math.round((H - et - yBase) / 0.4) - 1), passo = (H - et - yBase) / (ns + 1), wp = Math.min(0.32, wm * 0.4);
      for (let s = 1; s <= ns; s++) k.cx(wm, e, dInt, xc, yBase + s * passo, zInt, m.madeira);
      for (let s = 0; s <= ns; s++) {
        if ((s + i) % 3 === 2) continue;
        const y = s === 0 ? yBase : yBase + s * passo + e / 2;
        pilha(wm > 0.75 ? xc - wm * 0.23 : xc, y, wp, s + i);
        if (wm > 0.75 && s % 2 === 0) pilha(xc + wm * 0.23, y, wp, s + i + 2);
      }
    }
  }
  return k.l;
});

// ── Cozinha ──

const bancadaCozinha = criar(({ peca, m, estilo }) => {
  const { largura: L, altura: H, profundidade: P } = peca, k = montar();
  const lux = estilo === "luxo", mod = estilo === "moderno";
  const temPia = peca.opcoes.pia === true, temCooktop = peca.opcoes.cooktop === true;
  const et = lux ? 0.05 : 0.03, hr = lim(H * 0.11, 0.07, 0.12), yT = H - et, zF = P / 2 - RECUO_FRENTE;
  const dCaixa = P - RECUO_FRENTE, zCaixa = -RECUO_FRENTE / 2;

  // Pia para um lado, cooktop para o outro.
  const sw = lim(L * 0.3, 0.34, 0.7), sd = Math.min(0.4, P - 0.2), hCuba = 0.16;
  const furo: Furo | null = temPia ? { x: -L / 2 + Math.max(sw / 2 + 0.12, L * 0.24), z: 0.02, w: sw, d: sd } : null;
  const cw = lim(L * 0.3, 0.34, 0.6), cd = Math.min(0.5, P - 0.14), xCook = L / 2 - Math.max(cw / 2 + 0.1, L * 0.24);

  // Rodapé recuado e caixas (a caixa sob a pia é mais baixa, para a cuba ficar de fato rebaixada).
  k.cx(L, hr, dCaixa - 0.06, 0, hr / 2, zCaixa - 0.03, mod ? m.metalEscuro : m.madeiraEscura);
  const caixa = (x0: number, x1: number, y1: number) => { if (x1 - x0 > 0.005) k.cx(x1 - x0, y1 - hr, dCaixa, (x0 + x1) / 2, (y1 + hr) / 2, zCaixa, m.laminado); };
  if (furo) {
    const a = furo.x - furo.w / 2 - 0.012, b = furo.x + furo.w / 2 + 0.012;
    caixa(-L / 2, a, yT); caixa(a, b, yT - hCuba - 0.014); caixa(b, L / 2, yT);
  } else caixa(-L / 2, L / 2, yT);

  // Frentes: um módulo a cada ~55 cm; gaveteiro sob o cooktop (ou na ponta), portas no resto.
  const n = Math.max(1, Math.round(L / 0.55)), mw = L / n, y0 = hr + FRESTA, hf = yT - FRESTA - y0;
  const iGav = temCooktop ? lim(Math.floor((xCook + L / 2) / mw), 0, n - 1) : n >= 2 && !temPia ? 0 : -1;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + mw * (i + 0.5), w = mw - FRESTA * 2;
    if (i === iGav) {
      let y = y0;
      for (const f of [0.39, 0.39, 0.22]) {
        const h = hf * f - FRESTA;
        frente(k, m, estilo, { x, y: y + h / 2, z: zF + 0.002, w, h, mat: m.laminado, pux: mod ? { lado: 0, alt: 1, dir: "h", comp: w * 0.6 } : { lado: 0, alt: 0, dir: "h" } });
        y += h + FRESTA * 1.5;
      }
    } else {
      frente(k, m, estilo, { x, y: y0 + hf / 2, z: zF + 0.002, w, h: hf, mat: m.laminado, pux: mod ? { lado: 0, alt: 1, dir: "h", comp: w * 0.6 } : { lado: i % 2 === 0 ? 1 : -1, alt: 1, dir: "v" } });
    }
  }

  // Tampo de pedra com leve balanço na frente e frontão baixo nas costas (o frontão sobe além da altura da peça).
  tampo(k, m.pedra, L, P, H - et / 2, et, furo);
  const hFrontao = lux ? 0.1 : 0.08;
  k.cx(L, hFrontao, 0.02, 0, H + hFrontao / 2, -P / 2 + 0.01, m.pedra);
  if (furo) {
    cuba(k, m, m.inox, furo, H, hCuba);
    torneira(k, m, furo.x, H, furo.z - furo.d / 2 - 0.05, 0.24, 0.15);
  }
  if (temCooktop) {
    // Cooktop de vidro preto com quatro bocas.
    k.cx(cw, 0.006, cd, xCook, H + 0.003, 0.01, m.tela);
    const r = Math.min(cw, cd) * 0.17;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const rr = sx * sz > 0 ? r : r * 0.8;
      k.outra("anel", [rr - 0.006, rr, 18], xCook + sx * cw * 0.24, H + 0.0065, 0.01 + sz * cd * 0.24, m.inox, { r: [-Math.PI / 2, 0, 0], sombra: false });
    }
  }
  return k.l;
});

const armarioAereo = criar(({ peca, m, estilo }) => {
  const { largura: L, altura: H, profundidade: P } = peca, k = montar();
  const lux = estilo === "luxo", mod = estilo === "moderno";
  // Moderno não tem puxador (cava embaixo da porta), então a caixa vai mais perto da frente.
  const recuo = mod ? 0.022 : RECUO_FRENTE - 0.002, zF = P / 2 - recuo, yCx = 0.012, cimalha = lux ? 0.03 : 0;
  k.cx(L, H - yCx - cimalha, P - recuo, 0, (H + yCx - cimalha) / 2, -recuo / 2, m.laminado);
  if (lux) k.cx(L, cimalha, P, 0, H - cimalha / 2, 0, m.madeiraEscura);
  const cava = mod ? 0.03 : 0;
  if (mod) k.cx(L - 0.004, cava, 0.006, 0, yCx + cava / 2, zF + 0.003, m.metalEscuro);
  const n = Math.max(1, Math.round(L / 0.5)), mw = L / n, y0 = yCx + cava + FRESTA, hf = H - cimalha - FRESTA - y0;
  for (let i = 0; i < n; i++) {
    frente(k, m, estilo, { x: -L / 2 + mw * (i + 0.5), y: y0 + hf / 2, z: zF + 0.002, w: mw - FRESTA * 2, h: hf, mat: m.laminado, pux: mod ? null : { lado: i % 2 === 0 ? 1 : -1, alt: -1, dir: "v" } });
  }
  // Fita de luz sob o armário.
  k.cx(Math.max(0.1, L - 0.08), 0.01, 0.025, 0, 0.006, zF - Math.min(0.08, P * 0.25), m.luz, { sombra: false });
  return k.l;
});

const geladeira = criar(({ peca, m, estilo }) => {
  const { largura: L, altura: H, profundidade: P } = peca, k = montar();
  const lux = estilo === "luxo", mod = estilo === "moderno";
  const hp = Math.min(0.03, H * 0.02), dPorta = 0.05, zPorta0 = P / 2 - 0.07, zc = zPorta0 + dPorta / 2, zFace = zPorta0 + dPorta, g = 0.006;
  // Corpo, gaxeta escura (aparece nas frestas das portas) e pés.
  k.rb(L, H - hp, P - 0.075, 0, hp + (H - hp) / 2, -0.0375, m.inox, 0.015, { s: 1 });
  k.cx(L - 0.02, H - hp - 0.03, 0.006, 0, hp + (H - hp) / 2, P / 2 - 0.0725, m.metalEscuro);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cil(0.02, 0.02, hp, sx * (L / 2 - 0.05), hp / 2, -0.0375 + sz * ((P - 0.075) / 2 - 0.05), m.metalEscuro, 10);
  const porta = (x: number, w: number, y0: number, y1: number) => k.rb(w, y1 - y0, dPorta, x, (y0 + y1) / 2, zc, m.inox, 0.012, { s: 1 });
  const alca = (x: number, y: number, comp: number, dir: "v" | "h") => {
    if (mod) { if (dir === "v") k.cx(0.014, comp, 0.02, x, y, zFace + 0.01, m.cromado); else k.cx(comp, 0.014, 0.02, x, y, zFace + 0.01, m.cromado); return; }
    k.cil(0.008, 0.008, comp, x, y, zFace + 0.013, m.cromado, 8, dir === "h" ? { r: EIXO_X } : undefined);
    for (const s of [-1, 1]) k.cx(0.012, 0.012, 0.012, dir === "h" ? x + s * comp * 0.4 : x, dir === "v" ? y + s * comp * 0.4 : y, zFace + 0.006, m.cromado);
  };
  const y0 = hp + 0.02, y1 = H - 0.004, util = y1 - y0;
  if (lux) {
    // Modelo "french door": duas portas em cima e gavetão do freezer embaixo.
    const yDiv = y0 + util * 0.36, w = (L - g) / 2;
    porta(0, L, y0, yDiv - g / 2);
    alca(0, yDiv - g / 2 - 0.07, L * 0.6, "h");
    for (const s of [-1, 1]) {
      porta(s * (w + g) / 2, w, yDiv + g / 2, y1);
      alca(s * 0.04, yDiv + (y1 - yDiv) * 0.42, (y1 - yDiv) * 0.5, "v");
    }
  } else {
    // Duplex: freezer em cima, geladeira embaixo, alças do lado oposto à dobradiça.
    const yDiv = y0 + util * 0.7, xa = L / 2 - 0.06;
    porta(0, L, y0, yDiv - g / 2);
    porta(0, L, yDiv + g / 2, y1);
    alca(xa, yDiv - g / 2 - 0.06 - util * 0.14, util * 0.28, "v");
    alca(xa, yDiv + g / 2 + 0.05 + (y1 - yDiv) * 0.2, (y1 - yDiv) * 0.4, "v");
    if (mod) k.cx(L * 0.16, 0.05, 0.002, -L * 0.12, yDiv + (y1 - yDiv) * 0.6, zFace + 0.001, m.tela, { sombra: false });
  }
  return k.l;
});

// ── Banheiro ──

const vasoSanitario = criar(({ peca, m, estilo }) => {
  const { largura: L, altura: H, profundidade: P } = peca, k = montar();
  const mod = estilo === "moderno", lux = estilo === "luxo";
  const hb = H * 0.5, R = (L / 2) * 0.95, comp = P * 0.74, zB = P / 2 - comp / 2, oval: V3 = [1, 1, comp / 2 / R];
  // Caixa acoplada encostada na parede, com tampa e botão de descarga.
  const wt = L * 0.92, dt = P * 0.27, zt = -P / 2 + dt / 2 + 0.006, yt0 = hb * 0.98, yt1 = H - 0.041;
  k.rb(wt, yt1 - yt0, dt, 0, (yt0 + yt1) / 2, zt, m.louca, mod ? 0.012 : 0.03);
  k.rb(wt + 0.012, 0.035, dt + 0.012, 0, H - 0.0235, zt, m.louca, lux ? 0.016 : 0.01, { s: 1 });
  k.cil(0.022, 0.022, 0.006, mod ? -0.012 : 0, H - 0.003, zt, m.cromado, 12);
  if (mod) k.cil(0.012, 0.012, 0.006, 0.026, H - 0.003, zt, m.cromado, 10);
  // Coluna de trás (liga a bacia à caixa) e bacia oval torneada.
  k.rb(L * 0.6, hb, P * 0.34, 0, hb / 2, -P / 2 + P * 0.17 + 0.01, m.louca, 0.03, { s: 1 });
  const perfil: [number, number][] = mod
    ? [[0.7 * R, 0], [0.7 * R, 0.3 * hb], [0.8 * R, 0.6 * hb], [0.95 * R, 0.9 * hb], [0.97 * R, hb]]
    : [[0.62 * R, 0], [0.57 * R, 0.06 * hb], [0.5 * R, 0.3 * hb], [0.62 * R, 0.6 * hb], [0.92 * R, 0.88 * hb], [0.97 * R, hb]];
  k.outra("geo", [], 0, 0, zB, m.louca, { e: oval, geo: torno(perfil) });
  // Assento e tampa fechada, com as dobradiças.
  k.cil(R, R, 0.02, 0, hb + 0.01, zB, m.plastico, 18, { e: oval });
  k.cil(R * 0.9, R * 0.98, 0.018, 0, hb + 0.029, zB, m.louca, 18, { e: oval });
  for (const s of [-1, 1]) k.cil(0.012, 0.012, 0.03, s * R * 0.4, hb + 0.03, zB - comp / 2 + 0.035, m.cromado, 8, { r: EIXO_X });
  return k.l;
});

const lavatorio = criar(({ peca, m, estilo }) => {
  const { largura: L, altura: H, profundidade: P } = peca, k = montar();
  const lux = estilo === "luxo", esc = estilo === "escandinavo", mod = estilo === "moderno";
  const temCuba = peca.opcoes.cuba === true;
  // Cuba de apoio (escandinavo e luxo): o tampo desce para a borda da cuba ficar na altura da peça.
  const apoio = temCuba && !mod, hv = lim(H * 0.14, 0.09, 0.13), yTopo = apoio ? H - hv : H;
  const et = lux ? 0.05 : 0.03, yT = yTopo - et, zF = P / 2 - RECUO_FRENTE, dCaixa = P - RECUO_FRENTE, zCaixa = -RECUO_FRENTE / 2;
  const corCaixa = lux ? m.laminado : m.madeira, corFrente = esc ? m.madeira : m.laminado;
  const h0 = esc ? Math.min(0.2, H * 0.24) : lim(H * 0.1, 0.06, 0.09);
  if (esc) pes(k, m, estilo, L / 2 - 0.04, dCaixa / 2 - 0.04, zCaixa, h0);
  else k.cx(L - 0.02, h0, dCaixa - 0.06, 0, h0 / 2, zCaixa - 0.03, mod ? m.metalEscuro : m.madeiraEscura);

  // Cuba de embutir (moderno): a caixa fica mais baixa e as laterais fecham até o tampo.
  const hCuba = 0.12, embutida = temCuba && mod;
  const furo: Furo | null = embutida ? { x: 0, z: 0.03, w: Math.min(L - 0.16, 0.5), d: Math.min(P - 0.2, 0.3) } : null;
  const yCaixa = furo ? yT - hCuba - 0.014 : yT;
  k.cx(L, yCaixa - h0, dCaixa, 0, (yCaixa + h0) / 2, zCaixa, corCaixa);
  if (furo) for (const s of [-1, 1]) k.cx(0.018, yT - yCaixa, dCaixa, s * (L / 2 - 0.009), (yT + yCaixa) / 2, zCaixa, corCaixa);

  const n = Math.max(1, Math.round(L / 0.45)), mw = L / n, y0 = h0 + FRESTA, hf = yT - FRESTA - y0;
  for (let i = 0; i < n; i++) {
    const lado = n === 1 ? 1 : i < n / 2 ? 1 : -1;
    frente(k, m, estilo, { x: -L / 2 + mw * (i + 0.5), y: y0 + hf / 2, z: zF + 0.002, w: mw - FRESTA * 2, h: hf, mat: corFrente, pux: mod ? { lado: 0, alt: 1, dir: "h", comp: (mw - 0.01) * 0.5 } : { lado, alt: 1, dir: "v" } });
  }
  tampo(k, m.pedra, L, P, yTopo - et / 2, et, furo);

  if (furo) {
    cuba(k, m, m.louca, furo, yTopo, hCuba);
    torneira(k, m, 0, yTopo, furo.z - furo.d / 2 - 0.045, 0.1, 0.11);
  } else if (apoio) {
    // Cuba de apoio torneada (por fora e por dentro) e torneira de bica alta atrás dela.
    const r = Math.min(0.18, P * 0.34, L * 0.3), zc = P / 2 - r - 0.03, zt = -P / 2 + 0.045;
    const perfil: [number, number][] = lux
      ? [[0.45 * r, 0], [0.8 * r, 0.35 * hv], [r, hv], [r - 0.012, hv], [0.75 * r, 0.4 * hv], [0.35 * r, 0.03], [0, 0.025]]
      : [[0.8 * r, 0], [0.97 * r, 0.25 * hv], [r, hv], [r - 0.012, hv], [0.9 * r, 0.3 * hv], [0.6 * r, 0.03], [0, 0.025]];
    k.outra("geo", [], 0, yTopo, zc, m.louca, { geo: torno(perfil, 16) });
    k.cil(0.022, 0.022, 0.004, 0, yTopo + 0.028, zc, m.cromado, 10);
    torneira(k, m, 0, yTopo, zt, hv + 0.06, Math.max(0.1, zc - zt - 0.03));
  }
  return k.l;
});

const espelho = criar(({ peca, m, estilo }) => {
  const { largura: L, altura: H, profundidade: P } = peca, k = montar();
  // Moldura fina de metal no moderno, mais larga (madeira clara ou dourado) nos outros estilos.
  const b = Math.min(estilo === "moderno" ? 0.012 : estilo === "escandinavo" ? 0.03 : 0.045, L * 0.12, H * 0.12);
  const cor = estilo === "moderno" ? m.metal : m.moldura, dFundo = P * 0.4;
  k.cx(L - b, H - b, dFundo, 0, H / 2, -P / 2 + dFundo / 2, cor);
  for (const s of [-1, 1]) {
    k.cx(b, H, P, s * (L / 2 - b / 2), H / 2, 0, cor);
    k.cx(L - 2 * b, b, P, 0, H / 2 + s * (H / 2 - b / 2), 0, cor);
  }
  k.cx(L - 2 * b, H - 2 * b, 0.004, 0, H / 2, -P / 2 + dFundo + 0.002, m.espelho);
  return k.l;
});

const boxChuveiro = criar(({ peca, m, estilo }) => {
  const { largura: L, altura: H, profundidade: P } = peca, k = montar();
  // Lado do vidro lateral: "direita" (+X, padrão), "esquerda", "ambas" ou "nenhuma" (box entre duas paredes).
  const lateral = typeof peca.opcoes.lateral === "string" ? peca.opcoes.lateral : "direita";
  const lados = lateral === "ambas" ? [-1, 1] : lateral === "nenhuma" ? [] : lateral === "esquerda" ? [-1] : [1];
  const sd = lados.length === 1 ? lados[0] : 1; // lado onde fica o vidro fixo da frente
  const zG = P / 2 - 0.05, eg = 0.008, pr = 0.022, hs = 0.05, xS = L / 2 - 0.03, vidro = { sombra: false };

  // Piso do box, soleiras e ralo.
  k.cx(L, 0.02, P, 0, 0.01, 0, m.pisoMolhado);
  k.cx(L, hs, 0.05, 0, hs / 2, zG, m.louca);
  for (const s of lados) k.cx(0.05, hs, zG + P / 2 - 0.025, s * xS, hs / 2, (zG - 0.025 - P / 2) / 2, m.louca);
  k.cil(0.04, 0.04, 0.004, 0, 0.022, -P * 0.1, m.cromado, 12);

  // Frente: perfis, vidro fixo e porta (levemente à frente do fixo, com puxador).
  const xa = lados.includes(-1) ? -xS : -L / 2 + pr, xb = lados.includes(1) ? xS : L / 2 - pr, vao = xb - xa;
  const wd = lim(vao * 0.58, Math.min(0.5, vao), 0.75), wf = vao - wd, hv = H - hs - pr;
  k.cx(L, pr, pr, 0, H - pr / 2, zG, m.cromado);
  k.cx(L, 0.012, pr, 0, hs + 0.006, zG, m.cromado);
  for (const x of [-L / 2 + pr / 2, L / 2 - pr / 2]) k.cx(pr, H - hs, pr, x, (H + hs) / 2, zG, m.cromado);
  const xPorta = sd > 0 ? xa + wd / 2 : xb - wd / 2;
  if (wf > 0.08) k.cx(wf, hv, eg, sd > 0 ? xb - wf / 2 : xa + wf / 2, hs + hv / 2, zG, m.vidro, vidro);
  k.cx(wd + 0.02, hv - 0.01, eg, xPorta, hs + hv / 2, zG + 0.012, m.vidro, vidro);
  const xPux = xPorta + sd * (wd / 2 - 0.06), yPux = Math.min(1.05, H * 0.52), zPux = zG + 0.016 + 0.024;
  k.cil(0.008, 0.008, 0.32, xPux, yPux, zPux, m.cromado, 8);
  for (const s of [-1, 1]) k.cil(0.005, 0.005, 0.024, xPux, yPux + s * 0.12, zPux - 0.012, m.cromado, 6, { r: EIXO_Z });

  // Vidro(s) lateral(is) com perfis.
  for (const s of lados) {
    const d = zG + P / 2 - pr, zc = (zG - P / 2) / 2;
    k.cx(eg, hv, d, s * xS, hs + hv / 2, zc, m.vidro, vidro);
    k.cx(pr, pr, d + pr, s * xS, H - pr / 2, zc, m.cromado);
    k.cx(pr, H - hs, pr, s * xS, (H + hs) / 2, -P / 2 + pr / 2, m.cromado);
  }

  // Chuveiro: braço saindo da parede das costas, crivo e registro misturador.
  const la = Math.min(0.38, P * 0.42), yCh = H - 0.12;
  k.cil(0.035, 0.035, 0.008, 0, yCh, -P / 2 + 0.004, m.cromado, 12, { r: EIXO_Z });
  k.cil(0.011, 0.011, la, 0, yCh, -P / 2 + la / 2, m.cromado, 8, { r: EIXO_Z });
  k.cil(0.012, 0.012, 0.04, 0, yCh - 0.02, -P / 2 + la, m.cromado, 8);
  if (estilo === "moderno") k.cx(0.2, 0.012, 0.2, 0, yCh - 0.046, -P / 2 + la, m.cromado);
  else k.cil(estilo === "luxo" ? 0.125 : 0.1, estilo === "luxo" ? 0.11 : 0.09, 0.014, 0, yCh - 0.047, -P / 2 + la, m.cromado, 16);
  const yReg = Math.min(1.1, H * 0.55);
  k.cil(0.055, 0.055, 0.01, 0, yReg, -P / 2 + 0.005, m.cromado, 14, { r: EIXO_Z });
  k.cil(0.02, 0.024, 0.04, 0, yReg, -P / 2 + 0.03, m.cromado, 10, { r: EIXO_Z });
  k.cx(0.012, 0.06, 0.012, 0, yReg + 0.035, -P / 2 + 0.044, m.cromado);
  return k.l;
});

// ── Lavanderia ──

const tanque = criar(({ peca, m, estilo }) => {
  const { largura: L, altura: H, profundidade: P } = peca, k = montar();
  const esc = estilo === "escandinavo", mod = estilo === "moderno";
  // Cuba funda de louça: fundo, quatro paredes (a da frente mais baixa) e o esfregador inclinado.
  const ht = lim(H * 0.33, 0.22, 0.32), e = 0.03, y0 = H - ht, rc = esc ? 0.014 : 0.008;
  k.cx(L - 0.01, e, P - 0.01, 0, y0 + e / 2, 0, m.louca);
  k.rb(L, ht, e, 0, y0 + ht / 2, -P / 2 + e / 2, m.louca, rc, { s: 1 });
  k.rb(L, ht - 0.03, e, 0, y0 + (ht - 0.03) / 2, P / 2 - e / 2, m.louca, rc, { s: 1 });
  for (const s of [-1, 1]) k.rb(e, ht, P, s * (L / 2 - e / 2), y0 + ht / 2, 0, m.louca, rc, { s: 1 });
  const dz = ht * 0.55, dy = ht - 0.04 - e, compT = Math.hypot(dz, dy), ang = -Math.atan2(dy, dz);
  const zE = P / 2 - e - dz / 2, yE = y0 + e + dy / 2;
  k.cx(L - 2 * e, 0.015, compT, 0, yE, zE, m.louca, { r: [ang, 0, 0] });
  for (let i = 0; i < 4; i++) {
    const t = -0.32 + i * 0.2; // posição ao longo do esfregador
    k.cx(L - 2 * e - 0.05, 0.008, 0.012, 0, yE - t * compT * Math.sin(ang) + 0.01, zE + t * compT * Math.cos(ang), m.louca, { r: [ang, 0, 0] });
  }
  k.cil(0.024, 0.024, 0.004, 0, y0 + e + 0.002, -P * 0.15, m.cromado, 12);
  torneira(k, m, 0, H, -P / 2 + e / 2, 0.14, Math.min(0.14, P * 0.28));

  if (esc) {
    // Sobre pés de madeira, com uma prateleira baixa.
    pes(k, m, estilo, L / 2 - 0.045, P / 2 - 0.045, 0, y0);
    k.cx(L - 0.09, 0.02, P - 0.09, 0, Math.min(0.22, y0 * 0.35), 0, m.madeira);
  } else {
    // Sobre gabinete com rodapé recuado e portas.
    const hr = lim(H * 0.1, 0.06, 0.1), zF = P / 2 - RECUO_FRENTE, dCaixa = P - RECUO_FRENTE;
    k.cx(L - 0.02, hr, dCaixa - 0.06, 0, hr / 2, -RECUO_FRENTE / 2 - 0.03, mod ? m.metalEscuro : m.madeiraEscura);
    k.cx(L, y0 - hr, dCaixa, 0, (y0 + hr) / 2, -RECUO_FRENTE / 2, m.laminado);
    const n = L > 0.75 ? 2 : 1, mw = L / n, yf = hr + FRESTA, hf = y0 - FRESTA - yf;
    for (let i = 0; i < n; i++) {
      frente(k, m, estilo, { x: -L / 2 + mw * (i + 0.5), y: yf + hf / 2, z: zF + 0.002, w: mw - FRESTA * 2, h: hf, mat: m.laminado, pux: { lado: n === 1 || i === 0 ? 1 : -1, alt: 1, dir: "v" } });
    }
  }
  return k.l;
});

const maquinaLavar = criar(({ peca, m, estilo }) => {
  const { largura: L, altura: H, profundidade: P } = peca, k = montar();
  const hp = 0.02, zB = P / 2 - 0.03, hPainel = lim(H * 0.12, 0.08, 0.12);
  // Corpo branco, pés e a faixa do painel de comandos.
  k.rb(L, H - hp, P - 0.03, 0, hp + (H - hp) / 2, -0.015, m.plastico, estilo === "escandinavo" ? 0.03 : 0.018);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cil(0.022, 0.022, hp, sx * (L / 2 - 0.06), hp / 2, -0.015 + sz * ((P - 0.03) / 2 - 0.06), m.metalEscuro, 10);
  const yP = H - 0.014 - hPainel / 2, corPainel = estilo === "moderno" ? m.inox : estilo === "luxo" ? m.metalEscuro : m.plastico;
  k.cx(L - 0.03, hPainel - 0.012, 0.006, 0, yP, zB + 0.003, corPainel);
  k.cx(L * 0.25, hPainel * 0.55, 0.004, -L * 0.3, yP, zB + 0.008, m.plastico); // gaveta do sabão
  k.cx(L * 0.2, hPainel * 0.4, 0.003, L * 0.1, yP, zB + 0.0075, m.tela, { sombra: false }); // visor
  k.cil(hPainel * 0.27, hPainel * 0.3, 0.02, L * 0.33, yP, zB + 0.014, m.cromado, 14, { r: EIXO_Z }); // seletor
  k.cx(L - 0.03, 0.004, 0.004, 0, yP - hPainel / 2 - 0.002, zB + 0.001, m.metalEscuro);
  // Porta redonda: aro cromado, tambor escuro ao fundo e o vidro abaulado.
  const R = Math.min(L * 0.31, (H - hp - hPainel) * 0.3), yD = hp + (H - hp - hPainel) * 0.54;
  k.outra("toro", [R, 0.02, 8, 20], 0, yD, zB + 0.008, m.cromado);
  k.cil(R - 0.012, R - 0.012, 0.006, 0, yD, zB + 0.003, m.metalEscuro, 18, { r: EIXO_Z });
  k.outra("esf", [R - 0.02, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2], 0, yD, zB + 0.004, m.vidro, { r: EIXO_Z, e: [1, 0.026 / (R - 0.02), 1], sombra: false });
  k.cx(0.02, 0.07, 0.012, R, yD, zB + 0.02, m.cromado); // trinco
  k.cx(L - 0.03, 0.004, 0.004, 0, hp + 0.1, zB + 0.001, m.metalEscuro);
  return k.l;
});

const armarioServico = criar(({ peca, m, estilo }) => {
  const { largura: L, altura: H, profundidade: P } = peca, k = montar();
  const lux = estilo === "luxo", mod = estilo === "moderno";
  const recuo = RECUO_FRENTE - 0.002, zF = P / 2 - recuo, hr = lim(H * 0.04, 0.05, 0.09), cimalha = lux ? 0.035 : 0;
  k.cx(L - 0.02, hr, P - recuo - 0.05, 0, hr / 2, -recuo / 2 - 0.025, mod ? m.metalEscuro : m.madeiraEscura);
  k.cx(L, H - hr - cimalha, P - recuo, 0, (H + hr - cimalha) / 2, -recuo / 2, m.laminado);
  if (lux) k.cx(L, cimalha, P, 0, H - cimalha / 2, 0, m.madeiraEscura);
  // Duas portas altas, com puxadores junto ao encontro delas.
  const w = (L - FRESTA * 3) / 2, y0 = hr + FRESTA, hf = H - cimalha - FRESTA - y0;
  for (const s of [-1, 1] as const) {
    frente(k, m, estilo, { x: s * (w + FRESTA) / 2, y: y0 + hf / 2, z: zF + 0.002, w, h: hf, mat: m.laminado, pux: { lado: s === -1 ? 1 : -1, alt: 0, dir: "v", comp: Math.min(0.32, hf * 0.2) } });
  }
  return k.l;
});

// ── Área gourmet ──

const churrasqueira = criar(({ peca, m, estilo }) => {
  const { largura: L, altura: H, profundidade: P } = peca, k = montar();
  const lux = estilo === "luxo", mod = estilo === "moderno";
  const alv = m.paredeExterna, et = lux ? 0.06 : 0.04, hb = lim(H * 0.39, 0.7, 0.9), yB = hb - et;
  // A coluna da churrasqueira (fornalha + coifa) fica para um lado; o resto é bancada de apoio.
  const comApoio = L > 1.25, wf = comApoio ? lim(L * 0.55, 0.8, 1.0) : L, xf = comApoio ? -L / 2 + wf / 2 : 0;
  const pw = Math.min(0.12, wf * 0.14), vao = wf - 2 * pw, dBase = P - RECUO_FRENTE, zBase = -RECUO_FRENTE / 2;

  // Base de alvenaria com nicho de lenha.
  for (const s of [-1, 1]) k.cx(pw, yB, dBase, xf + s * (wf / 2 - pw / 2), yB / 2, zBase, alv);
  k.cx(vao, 0.12, dBase, xf, yB - 0.06, zBase, alv);
  k.cx(vao, yB - 0.12, 0.1, xf, (yB - 0.12) / 2, -P / 2 + 0.05, alv);
  const rl = Math.min(0.05, vao * 0.08), cl = dBase * 0.7, nl = lim(Math.floor(vao / (rl * 2.2)), 2, 4);
  for (let i = 0; i < nl; i++) k.cil(rl, rl * 0.9, cl, xf + (i - (nl - 1) / 2) * rl * 2.1, rl, zBase + 0.03, m.madeira, 8, { r: EIXO_Z });
  for (let i = 0; i < nl - 1; i++) k.cil(rl * 0.9, rl, cl, xf + (i - (nl - 2) / 2) * rl * 2.1, rl * 2.7, zBase + 0.03, m.madeira, 8, { r: EIXO_Z });
  if (comApoio) {
    // Bancada de apoio: alvenaria com portas de madeira.
    const wa = L - wf, xa = xf + wf / 2 + wa / 2, n = Math.max(1, Math.round((wa - 0.1) / 0.5)), mw = (wa - 0.1) / n, hf = yB - 0.2;
    k.cx(wa, yB, dBase, xa, yB / 2, zBase, alv);
    for (let i = 0; i < n; i++) {
      frente(k, m, estilo, { x: xa - (wa - 0.1) / 2 + mw * (i + 0.5), y: 0.1 + hf / 2, z: P / 2 - RECUO_FRENTE + 0.001, w: mw - 0.006, h: hf, mat: m.madeira, pux: { lado: i % 2 === 0 ? 1 : -1, alt: 1, dir: "v" } });
    }
  }
  k.cx(L, et, P, 0, hb - et / 2, 0, m.pedra);

  // Fornalha: paredes de alvenaria, interior escuro e grelha.
  const hf = lim(H * 0.25, 0.42, 0.6), dPar = P - 0.02, zPar = -0.01;
  for (const s of [-1, 1]) {
    k.cx(pw, hf, dPar, xf + s * (wf / 2 - pw / 2), hb + hf / 2, zPar, alv);
    k.cx(0.01, hf, dPar - 0.11, xf + s * (vao / 2 - 0.005), hb + hf / 2, zPar + 0.055, m.metalEscuro);
  }
  k.cx(vao, hf, 0.1, xf, hb + hf / 2, -P / 2 + 0.05, alv);
  k.cx(vao, hf, 0.01, xf, hb + hf / 2, -P / 2 + 0.105, m.metalEscuro);
  k.cx(vao, 0.012, dPar - 0.11, xf, hb + 0.006, zPar + 0.055, m.metalEscuro);
  const yG = hb + hf * 0.38, dG = P - 0.2, zG = 0.03, nb = lim(Math.round(vao / 0.065), 6, 12);
  for (const s of [-1, 1]) k.cx(vao - 0.02, 0.01, 0.01, xf, yG, zG + s * dG / 2, m.inox);
  for (let i = 0; i < nb; i++) k.cx(0.006, 0.006, dG, xf - vao / 2 + 0.03 + ((vao - 0.06) * i) / (nb - 1), yG, zG, m.inox);

  // Coifa: laje de arremate, tronco que afunila e chaminé até a altura total, com chapéu de pedra.
  const y1 = hb + hf + 0.07, topo = mod ? 0.62 : lux ? 0.4 : 0.46, y2 = y1 + (H - y1) * (mod ? 0.35 : 0.6);
  k.cx(wf, 0.07, P, xf, y1 - 0.035, 0, mod ? alv : m.pedra);
  k.outra("geo", [], xf, (y1 + y2) / 2, 0, alv, { e: [wf, y2 - y1, P], geo: troncoPiramide(topo) });
  k.cx(wf * topo, H - 0.05 - y2, P * topo, xf, (H - 0.05 + y2) / 2, 0, alv);
  k.cx(Math.min(wf, wf * topo + 0.06), 0.05, Math.min(P, P * topo + 0.06), xf, H - 0.025, 0, m.pedra);
  return k.l;
});

/** Móveis da área íntima (quarto, banheiro) e de serviço (cozinha, lavanderia, churrasqueira). */
export const MOVEIS_INTIMO_SERVICO: CatalogoMoveis = {
  cama,
  criado_mudo: criadoMudo,
  guarda_roupa: guardaRoupa,
  bancada_cozinha: bancadaCozinha,
  armario_aereo: armarioAereo,
  geladeira,
  vaso_sanitario: vasoSanitario,
  lavatorio,
  espelho,
  box_chuveiro: boxChuveiro,
  tanque,
  maquina_lavar: maquinaLavar,
  armario_servico: armarioServico,
  churrasqueira,
};
