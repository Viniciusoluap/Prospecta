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
/** `fixo`: no modo aprimorado a parte NÃO ganha mais segmentos (peças miúdas ou repetidas muitas vezes). */
type Extra = Partial<Pick<Parte, "r" | "e" | "s" | "sombra">> & { fixo?: boolean };

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

/**
 * Monta a lista de partes. Em todas as funções, (x, y, z) é o CENTRO da parte. No modo aprimorado (`ap`) as
 * caixas arredondadas e os cilindros ganham mais segmentos sozinhos; o modo normal fica exatamente como era.
 */
function montar(ap: boolean) {
  const l: Parte[] = [];
  /** Número de segmentos de uma curva: dobra no modo aprimorado. */
  const n = (seg: number) => (ap ? Math.min(32, seg * 2) : seg);
  const limpar = (extra?: Extra) => { if (!extra) return undefined; const { fixo: _fixo, ...resto } = extra; return resto; };
  return {
    l, ap, n,
    cx: (w: number, h: number, d: number, x: number, y: number, z: number, mat: Mat, extra?: Extra) => {
      l.push({ g: "cx", t: [w, h, d], p: [x, y, z], mat, ...limpar(extra) });
    },
    rb: (w: number, h: number, d: number, x: number, y: number, z: number, mat: Mat, raio: number, extra?: Extra) => {
      const q: Parte = { g: "rb", t: [w, h, d], p: [x, y, z], mat, raio, ...limpar(extra) };
      if (ap && !extra?.fixo) q.s = Math.min(3, (q.s ?? 2) + 1);
      l.push(q);
    },
    cil: (rTopo: number, rBase: number, h: number, x: number, y: number, z: number, mat: Mat, seg = 14, extra?: Extra) => {
      l.push({ g: "cil", t: [rTopo, rBase, h, extra?.fixo ? seg : n(seg)], p: [x, y, z], mat, ...limpar(extra) });
    },
    outra: (g: Forma, t: number[], x: number, y: number, z: number, mat: Mat, extra?: Extra & { geo?: THREE.BufferGeometry }) => {
      l.push({ g, t, p: [x, y, z], mat, ...limpar(extra), ...(extra?.geo ? { geo: extra.geo } : null) });
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
type Montagem = (p: { peca: PropsMovel["peca"]; m: Materiais; estilo: Estilo; k: K }) => void;
function criar(montagem: Montagem): DesenhoMovel {
  return function Movel({ peca, m, estilo, aprimorado }: PropsMovel) {
    const { largura, altura, profundidade } = peca, ap = aprimorado === true;
    const opcoes = JSON.stringify(peca.opcoes);
    const lista = useMemo(() => {
      const k = montar(ap);
      montagem({ peca, m, estilo, k });
      return k.l;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [largura, altura, profundidade, opcoes, m, estilo, ap]);
    return <group><Partes lista={lista} /></group>;
  };
}

// ── Peças de marcenaria reaproveitadas ──

/**
 * Puxador sobre a face de uma frente (z = face da frente). Moderno: barra fina; escandinavo: botão redondo;
 * luxo: barra roliça dourada sobre dois apoios.
 */
function puxador(k: K, m: Materiais, estilo: Estilo, x: number, y: number, z: number, dir: "v" | "h", comp: number) {
  if (k.ap) {
    // Aprimorado: puxadores "de verdade" — barra afastada sobre apoios, botão torneado com roseta, barra com ponteiras.
    const v = dir === "v", ao = (d: number): [number, number] => [v ? x : x + d, v ? y + d : y];
    if (estilo === "escandinavo") {
      k.cil(0.02, 0.02, 0.003, x, y, z + 0.0015, m.metal, 12, { r: EIXO_Z, fixo: true });
      k.cil(0.008, 0.007, 0.012, x, y, z + 0.008, m.metal, 8, { r: EIXO_Z, fixo: true });
      k.outra("esf", [0.016, 10, 6], x, y, z + 0.018, m.metal, { e: [1, 1, 0.6] });
      return;
    }
    if (estilo === "moderno") {
      k.cx(v ? 0.01 : comp, v ? comp : 0.01, 0.008, x, y, z + 0.022, m.metal);
      for (const s of [-1, 1]) { const [px, py] = ao(s * comp * 0.36); k.cx(0.008, 0.008, 0.018, px, py, z + 0.009, m.metal); }
      return;
    }
    k.cil(0.006, 0.006, comp, x, y, z + 0.02, m.metal, 8, { r: v ? ZERO : EIXO_X, fixo: true });
    for (const s of [-1, 1]) {
      const [px, py] = ao(s * comp * 0.34), [ex, ey] = ao(s * comp * 0.5);
      k.cil(0.004, 0.005, 0.018, px, py, z + 0.009, m.metal, 6, { r: EIXO_Z, fixo: true });
      k.cil(0.011, 0.011, 0.002, px, py, z + 0.001, m.metal, 8, { r: EIXO_Z, fixo: true });
      k.outra("esf", [0.0075, 6, 4], ex, ey, z + 0.02, m.metal);
    }
    return;
  }
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
    // Aprimorado: almofada central em relevo, com a borda adoçada, dentro da moldura.
    if (k.ap && o.w - 2 * b > 0.06 && o.h - 2 * b > 0.05) k.rb(o.w - 2 * b - 0.022, o.h - 2 * b - 0.022, e2 * 0.75, o.x, o.y, o.z + e1 + e2 * 0.375, o.mat, 0.004, { s: 1, fixo: true });
  } else if (k.ap && estilo === "escandinavo" && o.h > 0.3 && o.w > 0.2) {
    // Aprimorado: frente de réguas verticais com friso (junta de 1,5 mm) entre elas.
    const n = Math.max(2, Math.round(o.w / 0.1)), wr = o.w / n;
    for (let i = 0; i < n; i++) k.cx(wr - 0.0015, o.h, e, o.x - o.w / 2 + wr * (i + 0.5), o.y, o.z + e / 2, o.mat);
    k.cx(o.w - 0.004, o.h - 0.004, e * 0.7, o.x, o.y, o.z + e * 0.35, m.madeiraEscura); // fundo do friso
  } else if (k.ap && estilo === "moderno") k.rb(o.w, o.h, e, o.x, o.y, o.z + e / 2, o.mat, 0.0025, { s: 1, fixo: true });
  else if (estilo === "escandinavo") k.rb(o.w, o.h, e, o.x, o.y, o.z + e / 2, o.mat, 0.005, { s: 1 });
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
    if (!k.ap) continue;
    // Aprimorado: sapata niveladora (moderno), ponteira de metal (escandinavo) ou anel torneado (luxo).
    if (estilo === "moderno") k.cil(0.016, 0.018, 0.006, x, 0.003, z, m.metalEscuro, 12, { fixo: true });
    else if (estilo === "escandinavo") k.cil(0.0155, 0.0135, Math.min(0.025, h * 0.25), x, Math.min(0.0125, h * 0.125), z, m.metal, 12, { fixo: true });
    else k.cil(0.033, 0.033, 0.008, x, h - 0.006, z, m.metal, 14, { fixo: true });
  }
}

/** Torneira de bica alta ("pescoço de ganso"): sobe em (x, y, z) e a bica avança `alcance` para +Z. */
function torneira(k: K, m: Materiais, x: number, y: number, z: number, alt: number, alcance: number) {
  const r = 0.011, raio = alcance / 2;
  k.cil(0.02, 0.023, 0.03, x, y + 0.015, z, m.cromado, 12);
  k.cil(r, r, alt, x, y + 0.03 + alt / 2, z, m.cromado, 10);
  k.outra("toro", [raio, r, k.n(6), k.n(10), Math.PI], x, y + 0.03 + alt, z + raio, m.cromado, { r: [0, -Math.PI / 2, 0] });
  k.cil(r, r * 0.9, 0.035, x, y + 0.03 + alt - 0.0175, z + alcance, m.cromado, 10);
  // Alavanca do misturador, ao lado da base.
  k.cil(0.007, 0.007, 0.055, x + 0.045, y + 0.035, z, m.cromado, 8, { r: [0, 0, Math.PI / 2.6] });
  if (!k.ap) return;
  // Aprimorado: canopla na base, corpo do misturador, ponteira da alavanca e arejador na ponta da bica.
  k.cil(0.027, 0.029, 0.004, x, y + 0.002, z, m.cromado, 16, { fixo: true });
  k.cil(0.012, 0.012, 0.03, x + 0.022, y + 0.024, z, m.cromado, 10, { r: EIXO_X, fixo: true });
  k.outra("esf", [0.0095, 10, 8], x + 0.071, y + 0.047, z, m.cromado);
  k.cil(0.0125, 0.0125, 0.012, x, y + 0.03 + alt - 0.036, z + alcance, m.cromado, 14, { fixo: true });
  k.cil(0.0085, 0.0085, 0.002, x, y + 0.03 + alt - 0.043, z + alcance, m.metalEscuro, 12, { fixo: true });
}

type Furo = { x: number; z: number; w: number; d: number };

/** Tampo de pedra, inteiro ou com o recorte da cuba (quatro tiras em volta do furo). */
function tampo(k: K, mat: Mat, L: number, P: number, y: number, e: number, furo?: Furo | null) {
  // Aprimorado: chapa única com a quina adoçada e o recorte da cuba de cantos arredondados.
  if (k.ap) { k.outra("geo", [], 0, y, 0, mat, { geo: geoTampo(L, P, e, furo ?? null, RAIO_CUBA) }); return; }
  if (!furo) { k.cx(L, e, P, 0, y, 0, mat); return; }
  const x0 = furo.x - furo.w / 2, x1 = furo.x + furo.w / 2, z0 = furo.z - furo.d / 2, z1 = furo.z + furo.d / 2;
  k.cx(x0 + L / 2, e, P, (x0 - L / 2) / 2, y, 0, mat);
  k.cx(L / 2 - x1, e, P, (x1 + L / 2) / 2, y, 0, mat);
  k.cx(furo.w, e, z0 + P / 2, furo.x, y, (z0 - P / 2) / 2, mat);
  k.cx(furo.w, e, P / 2 - z1, furo.x, y, (z1 + P / 2) / 2, mat);
}

/** Cuba de embutir: fundo e quatro paredes por fora do furo, descendo `h` a partir do tampo. */
function cuba(k: K, m: Materiais, mat: Mat, f: Furo, yTopo: number, h: number) {
  if (k.ap) {
    // Aprimorado: bojo de verdade — cantos arredondados, paredes levemente inclinadas e fundo caindo para o ralo.
    k.outra("geo", [], f.x, yTopo - 0.004, f.z, mat, { geo: geoCuba(f.w, f.d, h - 0.004, RAIO_CUBA) });
    const yR = yTopo - h - 0.0095;
    k.cil(0.027, 0.024, 0.004, f.x, yR, f.z, m.cromado, 16, { fixo: true });
    for (const r of [0, Math.PI / 2]) k.cx(0.036, 0.0012, 0.005, f.x, yR + 0.0026, f.z, m.metalEscuro, { r: [0, r, 0], sombra: false });
    return;
  }
  const e = 0.012, y = yTopo - h / 2 - 0.001;
  k.cx(f.w + 2 * e, e, f.d + 2 * e, f.x, yTopo - h - e / 2, f.z, mat);
  for (const s of [-1, 1]) {
    k.cx(e, h, f.d + 2 * e, f.x + s * (f.w / 2 + e / 2), y, f.z, mat);
    k.cx(f.w, h, e, f.x, y, f.z + s * (f.d / 2 + e / 2), mat);
  }
  k.cil(0.024, 0.024, 0.004, f.x, yTopo - h + 0.002, f.z, m.cromado, 12); // válvula do ralo
}

/** Sólido de revolução (bacia do vaso, cuba de apoio). O perfil vai de baixo para cima pelo lado de fora. */
function torno(perfil: [number, number][], seg = 16, liso = false): THREE.BufferGeometry {
  let pts = perfil.map(([r, y]) => new THREE.Vector2(r, y));
  // Aprimorado: o perfil vira uma curva suave passando pelos mesmos pontos.
  if (liso) pts = new THREE.SplineCurve(pts).getPoints(perfil.length * 3);
  for (const p of pts) p.x = Math.max(p.x, 0.0001);
  return new THREE.LatheGeometry(pts, seg);
}

// ── Geometrias do modo aprimorado (só são criadas quando `aprimorado` está ligado) ──

/** Raio dos cantos das cubas de embutir (e do recorte do tampo) no modo aprimorado. */
const RAIO_CUBA = 0.045;

/** Recalcula as normais e, se a face do vértice `i` não olhar para `dir`, inverte os triângulos. */
function orientar(g: THREE.BufferGeometry, i: number, dir: V3): THREE.BufferGeometry {
  g.computeVertexNormals();
  const n = g.attributes.normal;
  if (g.index && n.getX(i) * dir[0] + n.getY(i) * dir[1] + n.getZ(i) * dir[2] < 0) {
    const a = g.index.array;
    for (let j = 0; j < a.length; j += 3) { const t = a[j + 1]; a[j + 1] = a[j + 2]; a[j + 2] = t; }
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}

function deMalha(pos: number[], uv: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Índices de uma grade de (nu+1) × (nv+1) vértices que começa no vértice `base`. */
function grade(idx: number[], base: number, nu: number, nv: number, inverter = false) {
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    if (inverter) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
}

/**
 * Travesseiro/almofada: largura em X, espessura em Y e comprimento em Z, centrado na origem. O miolo é abaulado,
 * a borda afina até a costura e os lados encolhem no meio, deixando os cantos em "orelha".
 */
function geoAlmofada(w: number, h: number, d: number, n = 12): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const lado of [1, -1]) for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const u = Math.sin((i / n - 0.5) * Math.PI), v = Math.sin((j / n - 0.5) * Math.PI);
    const cheio = Math.pow(Math.max(0, (1 - u * u) * (1 - v * v)), 0.38);
    pos.push((u * w / 2) * (1 - 0.07 * (1 - v * v)), lado * (h / 2) * cheio, (v * d / 2) * (1 - 0.07 * (1 - u * u)));
    uv.push(i / n, j / n);
  }
  grade(idx, 0, n, n);
  grade(idx, (n + 1) * (n + 1), n, n, true);
  return orientar(deMalha(pos, uv, idx), Math.floor(((n + 1) * (n + 1)) / 2), [0, 1, 0]);
}

/** Meio-perfil de um tecido que cobre uma quina: trecho plano, canto de raio `rc` e queda de `queda`. */
function perfilQueda(meio: number, rc: number, queda: number, nPlano: number, nCanto: number, nQueda: number): [number, number][] {
  const p: [number, number][] = [];
  for (let i = 0; i < nPlano; i++) p.push([((meio - rc) * i) / nPlano, 0]);
  for (let i = 0; i < nCanto; i++) { const t = ((Math.PI / 2) * i) / nCanto; p.push([meio - rc + rc * Math.sin(t), -rc * (1 - Math.cos(t))]); }
  for (let i = 0; i <= nQueda; i++) p.push([meio, -rc - ((queda - rc) * i) / nQueda]);
  return p;
}

/**
 * Edredom ou manta sobre a cama: superfície com ondas suaves em cima, que dobra a quina e cai pelas laterais em
 * pregas (e também pelo pé da cama, se `pe`). Origem no centro do topo; o pé fica em +Z. Nada passa de y = 0
 * nem da largura `w` / do comprimento `d`.
 */
function geoManta(w: number, d: number, queda: number, pe: boolean, o: { rc: number; onda: number; prega: number; nz: number; semente: number }): THREE.BufferGeometry {
  const meio = perfilQueda(w / 2, o.rc, queda, 7, 4, 3);
  const cols: [number, number][] = [...meio.slice(1).reverse().map(([x, y]) => [-x, y] as [number, number]), ...meio];
  const lins: [number, number][] = pe
    ? perfilQueda(d, o.rc, queda, o.nz, 4, 3)
    : Array.from({ length: o.nz + 1 }, (_, j) => [(d * j) / o.nz, 0] as [number, number]);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], nu = cols.length - 1, nv = lins.length - 1, liso = queda - o.rc;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const [ox, yx] = cols[i], [oz, yz] = lins[j];
    let x = ox, z = -d / 2 + oz, y = Math.max(-queda, yx + yz);
    const topo = Math.max(0, 1 + (yx + yz) / o.rc);
    const onda = Math.sin(x * 9 + o.semente) * Math.sin(z * 7 + o.semente * 1.3) * 0.6 + Math.sin((x + z) * 13 + o.semente) * 0.4;
    y += o.onda * topo * (onda - 1) * 0.5;
    const fx = lim((-yx - o.rc) / liso, 0, 1), fz = lim((-yz - o.rc) / liso, 0, 1);
    x -= Math.sign(ox) * o.prega * fx * (0.5 + 0.5 * Math.sin(z * 24 + o.semente));
    z -= o.prega * fz * (0.5 + 0.5 * Math.sin(x * 24 + o.semente * 2));
    pos.push(x, y, z);
    uv.push(i / nu, j / nv);
  }
  grade(idx, 0, nu, nv);
  return orientar(deMalha(pos, uv, idx), Math.floor(nu / 2), [0, 1, 0]);
}

function retanguloArredondado(c: THREE.Path, x: number, y: number, w: number, h: number, r: number) {
  const x0 = x - w / 2, y0 = y - h / 2, x1 = x + w / 2, y1 = y + h / 2, q = Math.PI / 2;
  c.moveTo(x0 + r, y0); c.lineTo(x1 - r, y0); c.absarc(x1 - r, y0 + r, r, -q, 0, false);
  c.lineTo(x1, y1 - r); c.absarc(x1 - r, y1 - r, r, 0, q, false);
  c.lineTo(x0 + r, y1); c.absarc(x0 + r, y1 - r, r, q, 2 * q, false);
  c.lineTo(x0, y0 + r); c.absarc(x0 + r, y0 + r, r, 2 * q, 3 * q, false);
}

/** Tampo em chapa única (L × e × P, centrado), de quina adoçada, com o recorte arredondado da cuba. */
function geoTampo(L: number, P: number, e: number, furo: Furo | null, rf: number): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(-L / 2, -P / 2); sh.lineTo(L / 2, -P / 2); sh.lineTo(L / 2, P / 2); sh.lineTo(-L / 2, P / 2); sh.closePath();
  if (furo) { const h = new THREE.Path(); retanguloArredondado(h, furo.x, -furo.z, furo.w, furo.d, Math.min(rf, furo.w / 2 - 0.005, furo.d / 2 - 0.005)); sh.holes.push(h); }
  const b = Math.min(0.004, e * 0.3);
  const g = new THREE.ExtrudeGeometry(sh, { depth: e - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 5, steps: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, b - e / 2, 0);
  return g;
}

/** Chapa com a borda chanfrada (vidro bisotado do espelho), w × h no plano XY, centrada. */
function geoChanfrada(w: number, h: number, d: number, chanfro: number): THREE.BufferGeometry {
  const sh = new THREE.Shape(), bt = d * 0.45;
  sh.moveTo(-w / 2, -h / 2); sh.lineTo(w / 2, -h / 2); sh.lineTo(w / 2, h / 2); sh.lineTo(-w / 2, h / 2); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: d - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: chanfro, bevelOffset: -chanfro, bevelSegments: 1, steps: 1 });
  g.translate(0, 0, bt - d / 2);
  return g;
}

/** Face levemente abaulada (porta de geladeira): w × h no plano XY, com flecha `c` para +Z no meio. */
function geoAbaulada(w: number, h: number, c: number, n = 10): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, n, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const u = p.getX(i) / (w / 2); p.setZ(i, c * (1 - u * u)); }
  g.computeVertexNormals();
  return g;
}

/** Bojo de cuba de embutir: borda em y = 0 (w × d, cantos de raio `rc`), descendo `h` até o ralo no centro. */
function geoCuba(w: number, d: number, h: number, rc: number, m = 5): THREE.BufferGeometry {
  const rf = 0.03, c30 = Math.cos(Math.PI / 6), s30 = 0.5;
  const aneis: [number, number, number][] = [
    [0, 0, 1], [0.003, -h * 0.3, 1], [0.008, -(h - rf), 1],
    [0.008 + rf * (1 - c30), -(h - rf) - rf * s30, 1], [0.008 + rf * (1 - s30), -(h - rf) - rf * c30, 1],
    [0.008 + rf, -h, 1], [0.008 + rf, -h - 0.004, 0.45],
  ];
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], np = 4 * (m + 1);
  const cantos: [number, number, number][] = [[1, 1, 0], [-1, 1, 1], [-1, -1, 2], [1, -1, 3]];
  aneis.forEach(([rec, y, esc], a) => {
    const hx = w / 2 - rec, hz = d / 2 - rec, r = Math.max(0.006, Math.min(rc, w / 2 - 0.005, d / 2 - 0.005) - rec);
    for (const [sx, sz, q] of cantos) for (let i = 0; i <= m; i++) {
      const t = (q + i / m) * (Math.PI / 2);
      pos.push((sx * (hx - r) + r * Math.cos(t)) * esc, y, (sz * (hz - r) + r * Math.sin(t)) * esc);
      uv.push((q * (m + 1) + i) / np, a / aneis.length);
    }
  });
  for (let a = 0; a < aneis.length - 1; a++) for (let i = 0; i < np; i++) {
    const p0 = a * np + i, p1 = a * np + ((i + 1) % np), q0 = p0 + np, q1 = p1 + np;
    idx.push(p0, q0, p1, p1, q0, q1);
  }
  const centro = pos.length / 3, ult = (aneis.length - 1) * np;
  pos.push(0, -h - 0.008, 0); uv.push(0.5, 1);
  for (let i = 0; i < np; i++) idx.push(ult + i, centro, ult + ((i + 1) % np));
  return orientar(deMalha(pos, uv, idx), centro, [0, 1, 0]);
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

const cama = criar(({ peca, m, estilo, k }) => {
  const { largura: L, altura: H, profundidade: P } = peca, ap = k.ap;
  const lux = estilo === "luxo", esc = estilo === "escandinavo";
  const casal = typeof peca.opcoes.casal === "boolean" ? peca.opcoes.casal : L > 1.3;
  const esp = 0.07, hp = lim(H * 0.2, 0.06, 0.14);
  // A altura da peça é o topo do colchão; a cabeceira sobe além dela (até ~1,1 m).
  const hc = Math.min(1.1, Math.max(H + 0.35, H * 1.9)), zCab = -P / 2;

  if (lux) {
    // Cabeceira estofada em gomos verticais sobre um painel de madeira escura.
    k.cx(L, hc, esp * 0.4, 0, hc / 2, zCab + esp * 0.2, m.madeiraEscura);
    const n = lim(Math.round(L / 0.3), 2, 6), wg = (L - 0.04) / n, y0 = H * 0.45, hg = hc - y0 - 0.02;
    if (ap) {
      // Aprimorado: gomos roliços (capitonê em canais) com botões nas costuras.
      for (let i = 0; i < n; i++) k.cil(wg / 2, wg / 2, hg, -L / 2 + 0.02 + wg * (i + 0.5), y0 + hg / 2, zCab + esp * 0.5, m.tecido, 18, { e: [1, 1, (esp * 0.5) / (wg / 2)], fixo: true });
      for (let i = 1; i < n; i++) for (const f of [0.3, 0.68]) k.outra("esf", [0.013, 8, 6], -L / 2 + 0.02 + wg * i, y0 + hg * f, zCab + esp * 0.5 + 0.004, m.tecidoAlt);
    } else for (let i = 0; i < n; i++) k.rb(wg - 0.006, hg, esp * 0.6, -L / 2 + 0.02 + wg * (i + 0.5), y0 + hg / 2, zCab + esp * 0.7, m.tecido, 0.022, { s: 1 });
  } else if (esc) {
    const h = hc * 0.9 - hp;
    if (ap) {
      // Aprimorado: cabeceira ripada — montantes, travessas e ripas verticais de madeira.
      const yT = hp + h, yB = H * 0.62, e = esp * 0.6, z = zCab + e / 2, mt = 0.05;
      for (const s of [-1, 1]) k.rb(mt, h, e, s * (L / 2 - mt / 2), hp + h / 2, z, m.madeira, 0.012, { s: 1, fixo: true });
      k.rb(L - 2 * mt, 0.06, e, 0, yT - 0.03, z, m.madeira, 0.012, { s: 1, fixo: true });
      k.cx(L - 2 * mt, 0.05, e * 0.8, 0, yB, z, m.madeira);
      const nr = Math.max(3, Math.round((L - 2 * mt) / 0.085)), passo = (L - 2 * mt) / nr;
      for (let i = 0; i < nr; i++) k.cx(passo * 0.6, yT - 0.06 - yB - 0.025, e * 0.5, -L / 2 + mt + passo * (i + 0.5), (yT - 0.06 + yB + 0.025) / 2, z, m.madeira);
    } else k.rb(L, h, esp * 0.6, 0, hp + h / 2, zCab + esp * 0.3, m.madeira, 0.02);
  } else {
    // Moderno: painel reto de madeira com uma faixa estofada.
    k.cx(L, hc, esp * 0.5, 0, hc / 2, zCab + esp * 0.25, m.madeira);
    const h = hc - H - 0.12;
    if (ap) {
      // Aprimorado: a faixa estofada vira três almofadas com costura entre elas.
      const w3 = (L - 0.06) / 3;
      for (let i = 0; i < 3; i++) k.rb(w3 - 0.005, h, esp * 0.5, (i - 1) * w3, H + 0.04 + h / 2, zCab + esp * 0.75, m.tecido, 0.016, { fixo: true });
    } else k.rb(L - 0.06, h, esp * 0.5, 0, H + 0.04 + h / 2, zCab + esp * 0.75, m.tecido, 0.015, { s: 1 });
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
  const n = casal ? 2 : 1, pw = Math.min(0.62, L / n - 0.1), zT = zCab + esp + 0.23, a = Math.min(0.34, L * 0.3);
  if (ap) {
    // Aprimorado: vivo (debrum) nas bordas do colchão, edredom com ondas e pregas caindo pelos lados e pelo pé,
    // manta dobrada atravessada no pé da cama, travesseiros e almofada com forma de verdade.
    for (const y of [yM - 0.012, yb + 0.02]) k.rb(L - 0.044, 0.012, z1 - z0 + 0.006, 0, y, (z0 + z1) / 2, m.travesseiro, 0.005, { s: 1, fixo: true });
    k.outra("geo", [], 0, yD, P / 2 - comp / 2, m.roupaDeCama, { geo: geoManta(L - 0.012, comp, yD - yD0, true, { rc: 0.07, onda: 0.007, prega: 0.012, nz: 14, semente: L * 3 }) });
    const cm = Math.min(0.45, comp * 0.35);
    k.outra("geo", [], 0, H, P / 2 - 0.12 - cm / 2, m.tecidoAlt, { geo: geoManta(L, cm, Math.min(0.3, yD - yD0 + 0.03), false, { rc: 0.078, onda: 0.004, prega: 0.0015, nz: 6, semente: 1.7 }) });
    k.rb(L, 0.1, 0.2, 0, H - 0.05, P / 2 - comp + 0.1, m.travesseiro, 0.014, { s: 1 });
    for (let i = 0; i < n; i++) k.outra("geo", [], casal ? (i ? 1 : -1) * L / 4 : 0, yM + 0.095, zT, m.travesseiro, { r: [0.3, 0, 0], geo: geoAlmofada(pw, 0.17, 0.4) });
    k.outra("geo", [], 0, yM + a * 0.5, zT + 0.25, m.tecidoAlt, { r: [Math.PI / 2 - 0.5, 0, 0], geo: geoAlmofada(a, 0.13, a, 10) });
    return;
  }
  k.rb(L - 0.01, yD - yD0, comp, 0, (yD + yD0) / 2, P / 2 - comp / 2, m.roupaDeCama, 0.035);
  k.rb(L, 0.1, 0.2, 0, H - 0.05, P / 2 - comp + 0.1, m.travesseiro, 0.014, { s: 1 });

  // Travesseiros recostados na cabeceira e uma almofada decorativa.
  for (let i = 0; i < n; i++) k.rb(pw, 0.12, 0.38, casal ? (i ? 1 : -1) * L / 4 : 0, yM + 0.095, zT, m.travesseiro, 0.055, { r: [0.3, 0, 0] });
  k.rb(a, a, 0.1, 0, yM + a * 0.5, zT + 0.25, m.tecidoAlt, 0.045, { s: 1, r: [-0.5, 0, 0] });
});

const criadoMudo = criar(({ peca, m, estilo, k }) => {
  const { largura: L, altura: H, profundidade: P } = peca, ap = k.ap;
  const lux = estilo === "luxo", esc = estilo === "escandinavo";
  const hp = H * (lux ? 0.1 : esc ? 0.3 : 0.24), et = lux ? 0.035 : 0.02;
  const corpo = esc ? m.madeira : m.laminado, zF = P / 2 - RECUO_FRENTE, wc = L - 0.02, hCorpo = H - et - hp;

  if (lux) k.cx(wc - 0.04, hp, P - RECUO_FRENTE - 0.05, 0, hp / 2, -RECUO_FRENTE / 2 - 0.005, m.madeiraEscura);
  else pes(k, m, estilo, wc / 2 - 0.035, (P - RECUO_FRENTE) / 2 - 0.035, -RECUO_FRENTE / 2, hp);
  k.cx(wc, hCorpo, P - RECUO_FRENTE, 0, hp + hCorpo / 2, -RECUO_FRENTE / 2, corpo);
  if (esc) k.rb(L, et, P, 0, H - et / 2, 0, m.madeira, 0.008, { s: 1 });
  else if (ap) k.rb(L, et, P, 0, H - et / 2, 0, lux ? m.madeiraEscura : m.madeira, lux ? 0.008 : 0.004, { s: 1 }); // tampo de quina adoçada
  else k.cx(L, et, P, 0, H - et / 2, 0, lux ? m.madeiraEscura : m.madeira);
  if (ap) {
    // Aprimorado: um livro sobre o tampo (capa, miolo e contracapa).
    const xl = L * 0.2, zl = P * 0.2, r: V3 = [0, 0.25, 0];
    k.cx(0.105, 0.02, 0.15, xl, H + 0.013, zl, m.travesseiro, { r });
    for (const y of [H + 0.0015, H + 0.0245]) k.cx(0.11, 0.003, 0.155, xl, y, zl, m.tecidoAlt, { r });
  }

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
      k.outra("esf", [0.055 * s, k.n(12), k.n(8)], 0, H + 0.012 + 0.066 * s, z, m.metal, { e: [1, 1.2, 1] });
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
});

const guardaRoupa = criar(({ peca, m, estilo, k }) => {
  const { largura: L, altura: H, profundidade: P } = peca, ap = k.ap;
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
      if (ap) for (const s of [-1, 1]) k.cx(0.008, hd, ep + 0.004, xc + s * (wd / 2 - 0.004), yc, zc, m.metal); // perfis de alumínio da folha
      if (i === iEspelho && ap) k.outra("geo", [], xc, yc, zf + 0.0025, m.espelho, { geo: geoChanfrada(wd - 0.05, hd - 0.05, 0.005, 0.014) }); // espelho bisotado
      else if (i === iEspelho) k.cx(wd - 0.05, hd - 0.05, 0.004, xc, yc, zf + 0.002, m.espelho);
      else if (lux) {
        // Folha almofadada: moldura em volta e uma travessa no meio.
        const b = Math.min(0.07, wd * 0.14);
        for (const s of [-1, 1]) {
          k.cx(b, hd, 0.006, xc + s * (wd / 2 - b / 2), yc, zf + 0.003, corPorta);
          k.cx(wd - 2 * b, b, 0.006, xc, yc + s * (hd / 2 - b / 2), zf + 0.003, corPorta);
        }
        k.cx(wd - 2 * b, b, 0.006, xc, yc, zf + 0.003, corPorta);
        // Aprimorado: almofadas em relevo nos dois quadros da folha.
        if (ap) for (const s of [-1, 1]) k.rb(wd - 2 * b - 0.03, (hd - 3 * b) / 2 - 0.03, 0.005, xc, yc + s * (hd - b) / 4, zf + 0.0025, corPorta, 0.004, { s: 1, fixo: true });
      }
      // Puxador vertical fino na borda de fechamento da folha.
      const lado = i < n / 2 ? -1 : 1, xp = xc + lado * (wd / 2 - 0.035), yp = Math.min(1.05, hr + hd * 0.48);
      if (esc) k.cil(0.028, 0.028, 0.008, xp, yp, zf + 0.004, m.madeiraEscura, 14, { r: EIXO_Z });
      else k.cx(lux ? 0.016 : 0.012, Math.min(lux ? 1.1 : 0.9, hd * 0.45), 0.012, xp, yp, zf + 0.006, m.metal);
    }
    return;
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
      if (ap) {
        // Aprimorado: caixa organizadora no maleiro e fita de luz sob ele.
        const wc = Math.min(0.3, wm * 0.36), hcx = Math.min(0.2, H - et - yMal - e - 0.04);
        k.rb(wc, hcx, dInt * 0.6, xc + wm * 0.22, yMal + e / 2 + hcx / 2, zInt + 0.02, m.tapete, 0.01, { s: 1, fixo: true });
        k.cx(wc + 0.008, 0.02, dInt * 0.6 + 0.008, xc + wm * 0.22, yMal + e / 2 + hcx - 0.004, zInt + 0.02, m.madeira);
        k.cx(wm - 0.06, 0.006, 0.014, xc, yMal - e / 2 - 0.003, dInt / 2 - 0.05, m.luz, { sombra: false });
      }
      k.cil(0.012, 0.012, wm, xc, yVarao, 0, m.cromado, 10, { r: EIXO_X });
      const livre = Math.min(1.15, yVarao - 0.06 - (yBase + hGav + 0.05)), ng = lim(Math.floor(wm / 0.16), 2, 4);
      for (let j = 0; j < ng; j++) {
        const x = xc - wm / 2 + (wm * (j + 0.5)) / ng + (((i * 7 + j * 3) % 5) - 2) * 0.006;
        const comp = livre * [0.95, 0.62, 0.8, 0.7][(i + j) % 4];
        k.cx(0.006, 0.05, 0.006, x, yVarao - 0.03, 0, m.cromado);
        if (ap) {
          // Aprimorado: cabide de madeira e a roupa com ombros (parte de cima mais larga que o corpo).
          k.cx(0.012, 0.014, dInt * 0.62, x, yVarao - 0.052, 0, m.madeira);
          k.rb(0.05, 0.1, dInt * 0.66, x, yVarao - 0.105, 0, tecidos[(i * 2 + j) % 4], 0.022, { s: 1, fixo: true });
          k.rb(0.044, comp - 0.07, dInt * 0.56, x, yVarao - 0.125 - (comp - 0.07) / 2, 0, tecidos[(i * 2 + j) % 4], 0.018, { s: 1, fixo: true });
          continue;
        }
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
      if (ap) {
        // Aprimorado: par de sapatos na prateleira vazia mais baixa e fita de luz no alto do módulo.
        const sv = [0, 1, 2].find(v => (v + i) % 3 === 2) ?? 2, ys = sv === 0 ? yBase : yBase + sv * passo + e / 2;
        for (const sx of [-1, 1]) {
          k.rb(0.085, 0.05, 0.25, xc + sx * 0.06, ys + 0.025, zInt + 0.04, m.metalEscuro, 0.02, { s: 1, fixo: true });
          k.rb(0.08, 0.045, 0.1, xc + sx * 0.06, ys + 0.07, zInt - 0.03, m.metalEscuro, 0.02, { s: 1, fixo: true });
        }
        k.cx(wm - 0.06, 0.006, 0.014, xc, H - et - 0.003, dInt / 2 - 0.05, m.luz, { sombra: false });
      }
    }
  }
});

// ── Cozinha ──

const bancadaCozinha = criar(({ peca, m, estilo, k }) => {
  const { largura: L, altura: H, profundidade: P } = peca, ap = k.ap;
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
  if (ap) {
    // Aprimorado: frontão de quina adoçada e a junta de silicone visível no encontro com o tampo.
    k.rb(L, hFrontao, 0.02, 0, H + hFrontao / 2, -P / 2 + 0.01, m.pedra, 0.004, { s: 1, fixo: true });
    k.cil(0.004, 0.004, L - 0.004, 0, H + 0.0015, -P / 2 + 0.021, m.plastico, 6, { r: EIXO_X, fixo: true });
  } else k.cx(L, hFrontao, 0.02, 0, H + hFrontao / 2, -P / 2 + 0.01, m.pedra);
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
      k.outra("anel", [rr - 0.006, rr, k.n(18)], xCook + sx * cw * 0.24, H + 0.0065, 0.01 + sz * cd * 0.24, m.inox, { r: [-Math.PI / 2, 0, 0], sombra: false });
      // Aprimorado: segundo anel e a cruz de centragem de cada boca.
      if (ap) {
        k.outra("anel", [rr * 0.5 - 0.003, rr * 0.5, 24], xCook + sx * cw * 0.24, H + 0.0065, 0.01 + sz * cd * 0.24, m.inox, { r: [-Math.PI / 2, 0, 0], sombra: false });
        for (const r of [0, Math.PI / 2]) k.cx(0.02, 0.0006, 0.002, xCook + sx * cw * 0.24, H + 0.0064, 0.01 + sz * cd * 0.24, m.inox, { r: [0, r, 0], sombra: false });
      }
    }
    if (ap) {
      // Aprimorado: painel de toque na borda da frente (teclas e luz de ligado) e filete de inox em volta do vidro.
      const zp = 0.01 + cd / 2 - 0.03;
      for (let i = -2; i <= 2; i++) k.cx(0.014, 0.0006, 0.014, xCook + i * 0.034, H + 0.0064, zp, m.inox, { sombra: false });
      k.cx(0.008, 0.0008, 0.008, xCook + 3 * 0.034, H + 0.0065, zp, m.luz, { sombra: false });
      for (const s of [-1, 1]) k.cx(cw + 0.006, 0.0055, 0.003, xCook, H + 0.0028, 0.01 + s * (cd / 2 + 0.0015), m.inox);
    }
  }
  if (ap) {
    // Aprimorado: objetos de uso sobre o trecho livre do tampo (tábua, aparelho e fruteira), conforme o espaço.
    const ini = furo ? furo.x + furo.w / 2 + 0.09 : -L / 2 + 0.1, fim = temCooktop ? xCook - cw / 2 - 0.05 : L / 2 - 0.1;
    const itens: ["tabua" | "aparelho" | "tigela", number][] = [];
    let livre = fim - ini;
    for (const it of [["tabua", 0.28], ["aparelho", 0.24], ["tigela", 0.24]] as ["tabua" | "aparelho" | "tigela", number][]) if (livre >= it[1] + 0.015) { itens.push(it); livre -= it[1] + 0.04; }
    const vao = (fim - ini - itens.reduce((t, it) => t + it[1], 0)) / (itens.length + 1);
    let x = ini + vao;
    for (const [tipo, w] of itens) {
      const xc = x + w / 2;
      x += w + vao;
      if (tipo === "tabua") {
        k.rb(0.26, 0.02, Math.min(0.2, P * 0.36), xc, H + 0.01, 0.04, m.madeira, 0.006, { s: 1, fixo: true, r: [0, 0.1, 0] });
        k.cx(0.16, 0.002, 0.024, xc - 0.02, H + 0.021, 0.05, m.inox, { r: [0, 0.5, 0] });
        k.cx(0.09, 0.012, 0.02, xc + 0.085, H + 0.026, -0.007, m.metalEscuro, { r: [0, 0.5, 0] });
      } else if (tipo === "aparelho") {
        // Torradeira: base escura, corpo de inox, duas fendas e o botão.
        const za = -P / 2 + 0.03 + 0.09;
        k.cx(0.2, 0.014, 0.15, xc, H + 0.007, za, m.metalEscuro);
        k.rb(0.21, 0.16, 0.16, xc, H + 0.014 + 0.08, za, m.inox, 0.03, { s: 1, fixo: true });
        for (const s of [-1, 1]) k.cx(0.14, 0.002, 0.022, xc, H + 0.1745, za + s * 0.03, m.metalEscuro, { sombra: false });
        k.cil(0.012, 0.012, 0.01, xc + 0.06, H + 0.05, za + 0.085, m.cromado, 10, { r: EIXO_Z, fixo: true });
      } else {
        // Fruteira de louça com três frutas.
        const rt = 0.105, ht = 0.075;
        k.outra("geo", [], xc, H, 0.02, m.louca, { geo: torno([[0.35 * rt, 0], [0.38 * rt, 0.008], [0.8 * rt, 0.55 * ht], [rt, ht], [rt - 0.008, ht], [0.75 * rt, 0.6 * ht], [0.3 * rt, 0.018], [0, 0.014]], 18) });
        for (let i = 0; i < 3; i++) k.outra("esf", [0.034, 8, 6], xc + Math.cos(i * 2.1) * 0.038, H + 0.05, 0.02 + Math.sin(i * 2.1) * 0.038, i === 1 ? m.folha : m.tecidoAlt);
      }
    }
  }
});

const armarioAereo = criar(({ peca, m, estilo, k }) => {
  const { largura: L, altura: H, profundidade: P } = peca, ap = k.ap;
  const lux = estilo === "luxo", mod = estilo === "moderno";
  // Moderno não tem puxador (cava embaixo da porta), então a caixa vai mais perto da frente.
  const recuo = mod ? 0.022 : RECUO_FRENTE - 0.002, zF = P / 2 - recuo, yCx = 0.012, cimalha = lux ? 0.03 : 0;
  k.cx(L, H - yCx - cimalha, P - recuo, 0, (H + yCx - cimalha) / 2, -recuo / 2, m.laminado);
  if (lux) k.cx(L, cimalha, P, 0, H - cimalha / 2, 0, m.madeiraEscura);
  const cava = mod ? 0.03 : 0;
  if (mod) k.cx(L - 0.004, cava, 0.006, 0, yCx + cava / 2, zF + 0.003, m.metalEscuro);
  if (mod && ap) k.cx(L - 0.004, 0.003, 0.014, 0, yCx + cava + 0.0015, zF + 0.007, m.metal); // perfil de alumínio da cava
  const n = Math.max(1, Math.round(L / 0.5)), mw = L / n, y0 = yCx + cava + FRESTA, hf = H - cimalha - FRESTA - y0;
  for (let i = 0; i < n; i++) {
    frente(k, m, estilo, { x: -L / 2 + mw * (i + 0.5), y: y0 + hf / 2, z: zF + 0.002, w: mw - FRESTA * 2, h: hf, mat: m.laminado, pux: mod ? null : { lado: i % 2 === 0 ? 1 : -1, alt: -1, dir: "v" } });
  }
  // Fita de luz sob o armário.
  k.cx(Math.max(0.1, L - 0.08), 0.01, 0.025, 0, 0.006, zF - Math.min(0.08, P * 0.25), m.luz, { sombra: false });
  if (ap) {
    // Aprimorado: calha de alumínio em volta da fita de luz e painéis laterais de acabamento.
    const zl = zF - Math.min(0.08, P * 0.25), wl = Math.max(0.1, L - 0.08);
    for (const s of [-1, 1]) k.cx(wl + 0.008, 0.011, 0.004, 0, 0.0065, zl + s * 0.0145, m.inox);
    for (const s of [-1, 1]) k.cx(0.004, 0.011, 0.033, s * (wl / 2 + 0.002), 0.0065, zl, m.inox);
    k.cx(L, 0.006, P - recuo - 0.004, 0, yCx - 0.003 + 0.006, -recuo / 2 - 0.002, m.laminado);
  }
});

const geladeira = criar(({ peca, m, estilo, k }) => {
  const { largura: L, altura: H, profundidade: P } = peca, ap = k.ap;
  const lux = estilo === "luxo", mod = estilo === "moderno";
  const hp = Math.min(0.03, H * 0.02), dPorta = 0.05, zPorta0 = P / 2 - 0.07, zc = zPorta0 + dPorta / 2, zFace = zPorta0 + dPorta, g = 0.006;
  // Corpo, gaxeta escura (aparece nas frestas das portas) e pés.
  k.rb(L, H - hp, P - 0.075, 0, hp + (H - hp) / 2, -0.0375, m.inox, 0.015, { s: 1 });
  k.cx(L - 0.02, H - hp - 0.03, 0.006, 0, hp + (H - hp) / 2, P / 2 - 0.0725, m.metalEscuro);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cil(0.02, 0.02, hp, sx * (L / 2 - 0.05), hp / 2, -0.0375 + sz * ((P - 0.075) / 2 - 0.05), m.metalEscuro, 10);
  // Aprimorado: a porta ganha uma leve "barriga" (face abaulada de 6 mm) — o corpo da porta recua o mesmo tanto.
  const flecha = 0.006;
  const barriga = (x: number, xPorta: number, w: number) => { const u = (x - xPorta) / ((w - 0.016) / 2); return flecha * Math.max(0, 1 - u * u); };
  const porta = (x: number, w: number, y0: number, y1: number) => {
    if (!ap) { k.rb(w, y1 - y0, dPorta, x, (y0 + y1) / 2, zc, m.inox, 0.012, { s: 1 }); return; }
    k.rb(w, y1 - y0, dPorta - flecha, x, (y0 + y1) / 2, zc - flecha / 2, m.inox, 0.012, { s: 1 });
    k.outra("geo", [], x, (y0 + y1) / 2, zFace - flecha - 0.0005, m.inox, { geo: geoAbaulada(w - 0.016, y1 - y0 - 0.016, flecha) });
  };
  const alca = (x: number, y: number, comp: number, dir: "v" | "h", xPorta = 0, wPorta = L) => {
    if (ap) {
      const zb = zFace - flecha - 0.0005 + (dir === "v" ? barriga(x, xPorta, wPorta) : 0);
      if (mod) {
        // Puxador embutido: cava escura com filete cromado.
        const v = dir === "v";
        k.cx(v ? 0.024 : comp, v ? comp : 0.024, 0.003, x, y, zb + (v ? 0 : flecha) + 0.001, m.metalEscuro, { sombra: false });
        k.cx(v ? 0.004 : comp, v ? comp : 0.004, 0.006, v ? x - 0.014 : x, v ? y : y + 0.014, zb + (v ? 0 : flecha) + 0.002, m.cromado);
        return;
      }
      const zh = dir === "v" ? zb : zb + flecha * 0.6;
      k.cil(0.008, 0.008, comp, x, y, zFace + 0.011, m.cromado, 12, { r: dir === "h" ? EIXO_X : ZERO, fixo: true });
      for (const s of [-1, 1]) {
        const px = dir === "h" ? x + s * comp * 0.4 : x, py = dir === "v" ? y + s * comp * 0.4 : y;
        k.cil(0.006, 0.007, zFace + 0.011 - zh, px, py, (zFace + 0.011 + zh) / 2, m.cromado, 10, { r: EIXO_Z, fixo: true });
        k.outra("esf", [0.009, 8, 6], dir === "h" ? x + s * comp * 0.5 : x, dir === "v" ? y + s * comp * 0.5 : y, zFace + 0.011, m.cromado);
      }
      return;
    }
    if (mod) { if (dir === "v") k.cx(0.014, comp, 0.02, x, y, zFace + 0.01, m.cromado); else k.cx(comp, 0.014, 0.02, x, y, zFace + 0.01, m.cromado); return; }
    k.cil(0.008, 0.008, comp, x, y, zFace + 0.012, m.cromado, 8, dir === "h" ? { r: EIXO_X } : undefined);
    for (const s of [-1, 1]) k.cx(0.012, 0.012, 0.012, dir === "h" ? x + s * comp * 0.4 : x, dir === "v" ? y + s * comp * 0.4 : y, zFace + 0.006, m.cromado);
  };
  const y0 = hp + 0.02, y1 = H - 0.004, util = y1 - y0;
  /** Painel do dispenser de água na porta: moldura escura, nicho, bica, bandeja e luz. */
  const dispenser = (x: number, y: number, xPorta: number, wPorta: number) => {
    const wp = Math.min(0.17, wPorta * 0.46), hpn = wp * 1.7, z = zFace - flecha - 0.0005 + barriga(x, xPorta, wPorta) + 0.0005;
    k.rb(wp, hpn, 0.004, x, y, z + 0.001, m.tela, 0.0018, { s: 1, fixo: true, sombra: false });
    k.cx(wp * 0.72, hpn * 0.5, 0.002, x, y - hpn * 0.17, z + 0.0035, m.metalEscuro, { sombra: false });
    k.cil(0.007, 0.009, 0.02, x, y + hpn * 0.03, z + 0.008, m.cromado, 10, { fixo: true });
    k.cx(wp * 0.72, 0.006, 0.012, x, y - hpn * 0.42, z + 0.008, m.inox);
    for (let i = -1; i <= 1; i++) k.cx(0.012, 0.012, 0.0008, x + i * wp * 0.22, y + hpn * 0.33, z + 0.0034, i === 0 ? m.luz : m.inox, { sombra: false });
  };
  if (lux) {
    // Modelo "french door": duas portas em cima e gavetão do freezer embaixo.
    const yDiv = y0 + util * 0.36, w = (L - g) / 2;
    porta(0, L, y0, yDiv - g / 2);
    alca(0, yDiv - g / 2 - 0.07, L * 0.6, "h");
    for (const s of [-1, 1]) {
      porta(s * (w + g) / 2, w, yDiv + g / 2, y1);
      alca(s * 0.04, yDiv + (y1 - yDiv) * 0.42, (y1 - yDiv) * 0.5, "v", s * (w + g) / 2, w);
    }
    if (ap) dispenser(-(w + g) / 2 - w * 0.08, yDiv + (y1 - yDiv) * 0.52, -(w + g) / 2, w);
  } else {
    // Duplex: freezer em cima, geladeira embaixo, alças do lado oposto à dobradiça.
    const yDiv = y0 + util * 0.7, xa = L / 2 - 0.06;
    porta(0, L, y0, yDiv - g / 2);
    porta(0, L, yDiv + g / 2, y1);
    alca(xa, yDiv - g / 2 - 0.06 - util * 0.14, util * 0.28, "v");
    alca(xa, yDiv + g / 2 + 0.05 + (y1 - yDiv) * 0.2, (y1 - yDiv) * 0.4, "v");
    if (mod && !ap) k.cx(L * 0.16, 0.05, 0.002, -L * 0.12, yDiv + (y1 - yDiv) * 0.6, zFace + 0.001, m.tela, { sombra: false });
    if (ap) dispenser(-L * 0.14, y0 + (yDiv - y0) * 0.68, 0, L);
  }
  if (ap) {
    // Aprimorado: grade de ventilação no rodapé, capas das dobradiças e friso de vedação entre as portas.
    const zr = P / 2 - 0.075;
    k.cx(L - 0.05, 0.014, 0.004, 0, hp + 0.01, zr + 0.002, m.metalEscuro);
    for (let i = 0; i < 3; i++) k.cx(L - 0.07, 0.0015, 0.003, 0, hp + 0.006 + i * 0.004, zr + 0.0045, m.inox, { sombra: false });
    for (const s of lux ? [-1, 1] : [-1]) k.rb(0.05, 0.004, 0.04, s * (L / 2 - 0.035), H - 0.002, zPorta0 + 0.012, m.metalEscuro, 0.0018, { s: 1, fixo: true });
  }
});

// ── Banheiro ──

const vasoSanitario = criar(({ peca, m, estilo, k }) => {
  const { largura: L, altura: H, profundidade: P } = peca, ap = k.ap;
  const mod = estilo === "moderno", lux = estilo === "luxo";
  const hb = H * 0.5, R = (L / 2) * 0.95, comp = P * 0.74, zB = P / 2 - comp / 2, oval: V3 = [1, 1, comp / 2 / R];
  // Caixa acoplada encostada na parede, com tampa e botão de descarga.
  const wt = L * 0.92, dt = P * 0.27, zt = -P / 2 + dt / 2 + 0.006, yt0 = hb * 0.98, yt1 = H - 0.041;
  k.rb(wt, yt1 - yt0, dt, 0, (yt0 + yt1) / 2, zt, m.louca, mod ? 0.012 : 0.03);
  k.rb(wt + 0.012, 0.035, dt + 0.012, 0, H - 0.0235, zt, m.louca, lux ? 0.016 : 0.01, { s: 1 });
  if (ap) {
    // Aprimorado: acionamento de duplo fluxo numa placa cromada embutida na tampa.
    k.rb(0.1, 0.004, 0.056, 0, H - 0.0045, zt, m.cromado, 0.0018, { s: 1, fixo: true });
    k.cil(0.018, 0.018, 0.003, -0.02, H - 0.0015, zt, m.inox, 14, { fixo: true });
    k.cil(0.012, 0.012, 0.003, 0.026, H - 0.0015, zt, m.inox, 12, { fixo: true });
  } else {
    k.cil(0.022, 0.022, 0.006, mod ? -0.012 : 0, H - 0.003, zt, m.cromado, 12);
    if (mod) k.cil(0.012, 0.012, 0.006, 0.026, H - 0.003, zt, m.cromado, 10);
  }
  // Coluna de trás (liga a bacia à caixa) e bacia oval torneada.
  k.rb(L * 0.6, hb, P * 0.34, 0, hb / 2, -P / 2 + P * 0.17 + 0.01, m.louca, 0.03, { s: 1 });
  const perfil: [number, number][] = mod
    ? [[0.7 * R, 0], [0.7 * R, 0.3 * hb], [0.8 * R, 0.6 * hb], [0.95 * R, 0.9 * hb], [0.97 * R, hb]]
    : [[0.62 * R, 0], [0.57 * R, 0.06 * hb], [0.5 * R, 0.3 * hb], [0.62 * R, 0.6 * hb], [0.92 * R, 0.88 * hb], [0.97 * R, hb]];
  k.outra("geo", [], 0, 0, zB, m.louca, { e: oval, geo: torno(perfil, ap ? 36 : 16, ap) });
  if (ap) {
    // Aprimorado: contorno do sifão nas laterais da base, capas dos parafusos de fixação, capas das dobradiças
    // do assento e o registro com flexível de alimentação da caixa.
    for (const s of [-1, 1]) {
      k.outra("toro", [Math.min(0.075, hb * 0.2), 0.022, 8, 14, Math.PI], s * R * 0.5, hb * 0.2, zB - comp * 0.12, m.louca, { r: [0, Math.PI / 2, 0], e: [1, 1, 0.6] });
      k.outra("esf", [0.011, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2], s * R * 0.72, 0, zB + comp * 0.05, m.louca);
      k.outra("esf", [0.014, 8, 6], s * R * 0.4, hb + 0.03, zB - comp / 2 + 0.035, m.cromado, { e: [1.3, 1, 1] });
    }
    const xr = -L * 0.38, zr = -P / 2 + 0.018;
    k.cil(0.02, 0.02, 0.004, xr, hb * 0.45, -P / 2 + 0.002, m.cromado, 12, { r: EIXO_Z, fixo: true });
    k.cil(0.011, 0.011, 0.03, xr, hb * 0.45, zr, m.cromado, 10, { r: EIXO_Z, fixo: true });
    k.cil(0.005, 0.005, yt0 - hb * 0.45, xr, (yt0 + hb * 0.45) / 2, zr + 0.012, m.inox, 8, { fixo: true });
  }
  // Assento e tampa fechada, com as dobradiças.
  k.cil(R, R, 0.02, 0, hb + 0.01, zB, m.plastico, 18, { e: oval });
  k.cil(R * 0.9, R * 0.98, 0.018, 0, hb + 0.029, zB, m.louca, 18, { e: oval });
  for (const s of [-1, 1]) k.cil(0.012, 0.012, 0.03, s * R * 0.4, hb + 0.03, zB - comp / 2 + 0.035, m.cromado, 8, { r: EIXO_X });
});

const lavatorio = criar(({ peca, m, estilo, k }) => {
  const { largura: L, altura: H, profundidade: P } = peca, ap = k.ap;
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
    k.outra("geo", [], 0, yTopo, zc, m.louca, { geo: torno(perfil, ap ? 32 : 16, ap) });
    k.cil(0.022, 0.022, 0.004, 0, yTopo + 0.028, zc, m.cromado, 10);
    if (ap) k.cil(0.012, 0.014, 0.004, 0, yTopo + 0.032, zc, m.cromado, 12, { fixo: true }); // tampão "click" do ralo
    torneira(k, m, 0, yTopo, zt, hv + 0.06, Math.max(0.1, zc - zt - 0.03));
  }
  if (ap) {
    // Aprimorado: frontão baixo com junta (só quando o tampo desce, para não passar da altura da peça),
    // saboneteira líquida e toalha dobrada sobre o tampo.
    if (apoio) {
      const hF = Math.min(0.06, hv - 0.02);
      k.rb(L, hF, 0.015, 0, yTopo + hF / 2, -P / 2 + 0.0075, m.pedra, 0.004, { s: 1, fixo: true });
      k.cil(0.0035, 0.0035, L - 0.004, 0, yTopo + 0.0012, -P / 2 + 0.016, m.plastico, 6, { r: EIXO_X, fixo: true });
    }
    if (L >= 0.58) {
      const xs = L / 2 - 0.075, zs = -P / 2 + 0.085;
      k.cil(0.026, 0.03, 0.1, xs, yTopo + 0.05, zs, m.louca, 14);
      k.cil(0.012, 0.012, 0.02, xs, yTopo + 0.11, zs, m.cromado, 10, { fixo: true });
      k.cil(0.004, 0.004, 0.035, xs, yTopo + 0.1375, zs, m.cromado, 6, { fixo: true });
      k.cx(0.01, 0.008, 0.04, xs, yTopo + 0.155, zs + 0.012, m.cromado);
    }
    if (L >= 0.8) {
      const xt = -L / 2 + 0.1, zt2 = P / 2 - 0.12;
      k.rb(0.13, 0.03, 0.17, xt, yTopo + 0.015, zt2, m.travesseiro, 0.012, { fixo: true });
      k.rb(0.125, 0.025, 0.165, xt, yTopo + 0.0425, zt2, m.tecidoAlt, 0.011, { fixo: true });
    }
  }
});

const espelho = criar(({ peca, m, estilo, k }) => {
  const { largura: L, altura: H, profundidade: P } = peca, ap = k.ap;
  // Moldura fina de metal no moderno, mais larga (madeira clara ou dourado) nos outros estilos.
  const b = Math.min(estilo === "moderno" ? 0.012 : estilo === "escandinavo" ? 0.03 : 0.045, L * 0.12, H * 0.12);
  const cor = estilo === "moderno" ? m.metal : m.moldura, dFundo = P * 0.4;
  k.cx(L - b, H - b, dFundo, 0, H / 2, -P / 2 + dFundo / 2, cor);
  for (const s of [-1, 1]) {
    k.cx(b, H, P, s * (L / 2 - b / 2), H / 2, 0, cor);
    k.cx(L - 2 * b, b, P, 0, H / 2 + s * (H / 2 - b / 2), 0, cor);
  }
  if (!ap) { k.cx(L - 2 * b, H - 2 * b, 0.004, 0, H / 2, -P / 2 + dFundo + 0.002, m.espelho); return; }
  // Aprimorado: vidro bisotado (borda chanfrada) e moldura perfilada em degraus, com filete por dentro.
  const eV = Math.min(0.006, P * 0.2), bi = Math.max(0.003, b * 0.4);
  k.outra("geo", [], 0, H / 2, -P / 2 + dFundo + eV / 2, m.espelho, { geo: geoChanfrada(L - 2 * b, H - 2 * b, eV, Math.min(0.016, L * 0.03, H * 0.03)) });
  for (const s of [-1, 1]) {
    k.cx(bi, H - 2 * b, P * 0.78, s * (L / 2 - b - bi / 2), H / 2, -P * 0.11, cor);
    k.cx(L - 2 * b - 2 * bi, bi, P * 0.78, 0, H / 2 + s * (H / 2 - b - bi / 2), -P * 0.11, cor);
    if (estilo !== "moderno") {
      k.cx(b * 0.3, H - b * 0.7, P * 0.12, s * (L / 2 - b * 0.5), H / 2, P * 0.44, m.madeiraEscura, { sombra: false });
      k.cx(L - b * 0.7, b * 0.3, P * 0.12, 0, H / 2 + s * (H / 2 - b * 0.5), P * 0.44, m.madeiraEscura, { sombra: false });
    }
  }
});

const boxChuveiro = criar(({ peca, m, estilo, k }) => {
  const { largura: L, altura: H, profundidade: P } = peca, ap = k.ap;
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
  if (!ap) return;

  // Aprimorado — vidro com espessura aparente: bordas polidas, dobradiças, vedação e rodo da porta.
  const borda = { sombra: false }, xLivre = xPorta + sd * (wd / 2 + 0.01), xDob = xPorta - sd * (wd / 2 + 0.01), zP = zG + 0.012;
  k.cx(wd + 0.02, 0.003, eg + 0.002, xPorta, hs + hv - 0.005 + 0.0015, zP, m.espelho, borda);
  for (const x of [xLivre, xDob]) k.cx(0.003, hv - 0.01, eg + 0.002, x, hs + hv / 2, zP, m.espelho, borda);
  if (wf > 0.08) k.cx(0.003, hv, eg + 0.002, sd > 0 ? xb - wf : xa + wf, hs + hv / 2, zG, m.espelho, borda);
  for (const f of [0.14, 0.86]) {
    k.rb(0.055, 0.075, 0.03, xDob + sd * 0.02, hs + hv * f, zP, m.cromado, 0.005, { s: 1, fixo: true });
    k.cil(0.007, 0.007, 0.085, xDob - sd * 0.004, hs + hv * f, zP, m.cromado, 8, { fixo: true });
  }
  k.cx(0.005, hv - 0.012, 0.014, xLivre + sd * 0.004, hs + hv / 2, zP - 0.004, m.plastico, borda);
  k.cx(wd, 0.012, 0.01, xPorta, hs + 0.012, zP, m.plastico, borda);

  // Crivo do chuveiro de teto com disco de bicos; ralo linear com grelha.
  const zCr = -P / 2 + la, rCr = estilo === "moderno" ? 0.09 : estilo === "luxo" ? 0.11 : 0.088;
  if (estilo === "moderno") k.cx(0.18, 0.002, 0.18, 0, yCh - 0.053, zCr, m.metalEscuro, borda);
  else k.cil(rCr, rCr, 0.002, 0, yCh - 0.055, zCr, m.metalEscuro, 20, { fixo: true, sombra: false });
  for (const f of [0.35, 0.62, 0.88]) k.outra("anel", [rCr * f - 0.004, rCr * f, 20], 0, yCh - 0.0565, zCr, m.cromado, { r: [Math.PI / 2, 0, 0], sombra: false });
  k.cx(0.11, 0.004, 0.11, 0, 0.0235, -P * 0.1, m.inox);
  for (let i = -2; i <= 2; i++) k.cx(0.09, 0.0008, 0.008, 0, 0.0259, -P * 0.1 + i * 0.019, m.metalEscuro, borda);

  // Ducha manual em barra deslizante, com flexível até o registro.
  const xB = -sd * L * 0.27, zBar = -P / 2 + 0.045, yB0 = Math.min(0.95, H * 0.48), yB1 = Math.min(1.6, H * 0.8), ySup = yB1 - 0.14;
  k.cil(0.009, 0.009, yB1 - yB0, xB, (yB0 + yB1) / 2, zBar, m.cromado, 10, { fixo: true });
  for (const y of [yB0 + 0.02, yB1 - 0.02]) k.cil(0.008, 0.008, 0.045, xB, y, -P / 2 + 0.0225, m.cromado, 8, { r: EIXO_Z, fixo: true });
  k.rb(0.03, 0.05, 0.036, xB, ySup, zBar + 0.006, m.cromado, 0.006, { s: 1, fixo: true });
  k.cil(0.012, 0.01, 0.17, xB, ySup + 0.03, zBar + 0.055, m.cromado, 10, { r: [0.5, 0, 0], fixo: true });
  k.cil(0.04, 0.03, 0.02, xB, ySup + 0.115, zBar + 0.103, m.cromado, 16, { r: [0.5 + 1.25, 0, 0], fixo: true });
  const yF = yReg + 0.1, rF = Math.abs(xB) / 2;
  k.cil(0.005, 0.005, Math.max(0.01, ySup - 0.05 - yF), xB, (ySup - 0.05 + yF) / 2, zBar + 0.012, m.inox, 6, { fixo: true });
  k.outra("toro", [rF, 0.005, 6, 20, Math.PI], xB / 2, yF, zBar + 0.012, m.inox, { r: [0, 0, Math.PI], e: [1, Math.min(1, (yF - yB0 * 0.7) / rF), 1] });
  k.cil(0.005, 0.005, yF - yReg, 0, (yF + yReg) / 2, zBar + 0.012, m.inox, 6, { fixo: true });

  // Nicho com dois frascos na parede das costas.
  const xN = sd * L * 0.25, wN = Math.min(0.3, L * 0.3), hN = 0.32, dN = 0.09, yN = Math.min(1.3, H * 0.62), zN = -P / 2 + dN / 2;
  k.cx(wN, hN, 0.008, xN, yN, -P / 2 + 0.004, m.pisoMolhado);
  for (const s of [-1, 1]) {
    k.cx(wN, 0.02, dN, xN, yN + s * (hN / 2 - 0.01), zN, m.pedra);
    k.cx(0.02, hN - 0.04, dN, xN + s * (wN / 2 - 0.01), yN, zN, m.pedra);
  }
  const yPr = yN - hN / 2 + 0.02;
  k.cil(0.026, 0.028, 0.15, xN - wN * 0.18, yPr + 0.075, zN, m.louca, 12);
  k.cil(0.011, 0.013, 0.03, xN - wN * 0.18, yPr + 0.165, zN, m.cromado, 8, { fixo: true });
  k.cil(0.022, 0.024, 0.11, xN + wN * 0.18, yPr + 0.055, zN + 0.005, m.tecidoAlt, 12);
  k.cil(0.012, 0.012, 0.022, xN + wN * 0.18, yPr + 0.121, zN + 0.005, m.metalEscuro, 8, { fixo: true });
});

// ── Lavanderia ──

const tanque = criar(({ peca, m, estilo, k }) => {
  const { largura: L, altura: H, profundidade: P } = peca, ap = k.ap;
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
  // Aprimorado: o esfregador ganha o dobro de frisos.
  for (let i = 0; i < (ap ? 8 : 4); i++) {
    const t = ap ? -0.36 + i * 0.1 : -0.32 + i * 0.2; // posição ao longo do esfregador
    k.cx(L - 2 * e - 0.05, 0.008, 0.012, 0, yE - t * compT * Math.sin(ang) + 0.01, zE + t * compT * Math.cos(ang), m.louca, { r: [ang, 0, 0] });
  }
  k.cil(0.024, 0.024, 0.004, 0, y0 + e + 0.002, -P * 0.15, m.cromado, 12);
  torneira(k, m, 0, H, -P / 2 + 0.03, 0.14, Math.min(0.14, P * 0.28));
  if (ap) {
    // Aprimorado: grelha do ralo, sabão em barra na borda e o sifão com a saída para a parede.
    for (const r of [0, Math.PI / 2]) k.cx(0.04, 0.0012, 0.005, 0, y0 + e + 0.0046, -P * 0.15, m.metalEscuro, { r: [0, r, 0], sombra: false });
    k.rb(0.07, 0.022, 0.026, L * 0.3, H + 0.011, -P / 2 + 0.015, m.tecidoAlt, 0.008, { s: 1, fixo: true });
    if (esc) {
      // Sem gabinete, o sifão fica à mostra: desce do ralo, faz a curva e sai para a parede.
      const zs = -P * 0.15, ys = y0 - 0.11;
      k.cil(0.02, 0.02, 0.11, 0, y0 - 0.055, zs, m.plastico, 10, { fixo: true });
      k.outra("toro", [0.035, 0.02, 6, 10, Math.PI], 0, ys, zs - 0.035, m.plastico, { r: [0, Math.PI / 2, Math.PI] });
      k.cil(0.02, 0.02, 0.05, 0, ys + 0.025, zs - 0.07, m.plastico, 10, { fixo: true });
      k.cil(0.02, 0.02, P / 2 + zs - 0.07, 0, ys + 0.05, (zs - 0.07 - P / 2) / 2, m.plastico, 10, { r: EIXO_Z, fixo: true });
    }
  }

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
});

const maquinaLavar = criar(({ peca, m, estilo, k }) => {
  const { largura: L, altura: H, profundidade: P } = peca, ap = k.ap;
  const hp = 0.02, zB = P / 2 - 0.03, hPainel = lim(H * 0.12, 0.08, 0.12);
  // Corpo branco, pés e a faixa do painel de comandos.
  // Aprimorado: o corpo recua 3 cm da parede para as mangueiras passarem por trás.
  const folga = ap ? 0.03 : 0, dCorpo = P - 0.03 - folga, zCorpo = -0.015 + folga / 2;
  k.rb(L, H - hp, dCorpo, 0, hp + (H - hp) / 2, zCorpo, m.plastico, estilo === "escandinavo" ? 0.03 : 0.018);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cil(0.022, 0.022, hp, sx * (L / 2 - 0.06), hp / 2, zCorpo + sz * (dCorpo / 2 - 0.06), m.metalEscuro, 10);
  const yP = H - 0.014 - hPainel / 2, corPainel = estilo === "moderno" ? m.inox : estilo === "luxo" ? m.metalEscuro : m.plastico;
  k.cx(L - 0.03, hPainel - 0.012, 0.006, 0, yP, zB + 0.003, corPainel);
  k.cx(L * 0.25, hPainel * 0.55, 0.004, -L * 0.3, yP, zB + 0.008, m.plastico); // gaveta do sabão
  k.cx(L * 0.2, hPainel * 0.4, 0.003, L * 0.1, yP, zB + 0.0075, m.tela, { sombra: false }); // visor
  k.cil(hPainel * 0.27, hPainel * 0.3, 0.02, L * 0.33, yP, zB + 0.014, m.cromado, 14, { r: EIXO_Z }); // seletor
  k.cx(L - 0.03, 0.004, 0.004, 0, yP - hPainel / 2 - 0.002, zB + 0.001, m.metalEscuro);
  // Porta redonda: aro cromado, tambor escuro ao fundo e o vidro abaulado.
  const R = Math.min(L * 0.31, (H - hp - hPainel) * 0.3), yD = hp + (H - hp - hPainel) * 0.54;
  k.outra("toro", [R, 0.02, k.n(8), k.n(20)], 0, yD, zB + 0.008, m.cromado);
  k.cil(R - 0.012, R - 0.012, 0.006, 0, yD, zB + 0.003, m.metalEscuro, 18, { r: EIXO_Z });
  k.outra("esf", [R - 0.02, k.n(14), k.n(5), 0, Math.PI * 2, 0, Math.PI / 2], 0, yD, zB + 0.004, m.vidro, { r: EIXO_Z, e: [1, 0.026 / (R - 0.02), 1], sombra: false });
  k.cx(0.02, 0.07, 0.012, R, yD, zB + 0.02, m.cromado); // trinco
  k.cx(L - 0.03, 0.004, 0.004, 0, hp + 0.1, zB + 0.001, m.metalEscuro);
  if (!ap) return;

  // Aprimorado — por trás do vidro: borracha da porta, boca e fundo do tambor de inox com as três pás.
  const frente = { r: EIXO_Z, fixo: true, sombra: false }, plano = { sombra: false };
  k.outra("toro", [R - 0.028, 0.012, 6, 28], 0, yD, zB + 0.008, m.metalEscuro, plano);
  k.outra("anel", [R * 0.6, R * 0.7, 28], 0, yD, zB + 0.0066, m.inox, plano);
  k.cil(R * 0.36, R * 0.36, 0.001, 0, yD, zB + 0.0066, m.inox, 20, frente);
  for (const f of [0.44, 0.52]) k.outra("anel", [R * f, R * f + 0.003, 24], 0, yD, zB + 0.0064, m.inox, plano);
  for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; k.cx(0.014, R * 0.24, 0.004, Math.sin(a) * R * 0.48, yD + Math.cos(a) * R * 0.48, zB + 0.008, m.inox, { r: [0, 0, -a], sombra: false }); }

  // Painel: puxador e junta da gaveta do sabão, traços do seletor, teclas e dígitos acesos do visor.
  k.cx(L * 0.12, 0.006, 0.003, -L * 0.3, yP - hPainel * 0.16, zB + 0.0105, m.metalEscuro, plano);
  k.cx(L * 0.25 + 0.004, hPainel * 0.55 + 0.004, 0.002, -L * 0.3, yP, zB + 0.0065, m.metalEscuro, plano);
  const rS = hPainel * 0.3;
  k.cx(0.004, rS * 0.8, 0.002, L * 0.33, yP + rS * 0.45, zB + 0.0245, m.metalEscuro, plano);
  for (let i = 0; i < 9; i++) { const a = -2.1 + i * 0.525; k.cx(0.003, 0.007, 0.001, L * 0.33 + Math.sin(a) * (rS + 0.009), yP + Math.cos(a) * (rS + 0.009), zB + 0.0065, m.metalEscuro, { r: [0, 0, -a], sombra: false }); }
  for (let i = 0; i < 3; i++) k.cil(0.007, 0.007, 0.004, -L * 0.08 + i * 0.026, yP - hPainel * 0.12, zB + 0.008, m.cromado, 10, { r: EIXO_Z, fixo: true });
  for (let i = 0; i < 3; i++) k.cx(0.012, hPainel * 0.2, 0.0006, L * 0.1 + (i - 1) * 0.022, yP, zB + 0.0092, m.luz, plano);
  k.cil(0.028, 0.028, 0.004, L * 0.34, hp + 0.05, zB + 0.002, m.metalEscuro, 16, { r: EIXO_Z, fixo: true }); // tampa do filtro

  // Atrás: torneira de parede com a mangueira de entrada e a mangueira de saída enganchada no tubo de esgoto.
  const zM = -P / 2 + 0.015, xE = -L * 0.3, xS = L * 0.26;
  k.cil(0.012, 0.012, 0.028, xE, H - 0.07, -P / 2 + 0.014, m.cromado, 10, { r: EIXO_Z, fixo: true });
  k.cx(0.035, 0.008, 0.008, xE, H - 0.052, -P / 2 + 0.02, m.cromado);
  k.cil(0.007, 0.007, H * 0.3, xE, H - 0.08 - H * 0.15, zM + 0.004, m.inox, 8, { fixo: true });
  k.cil(0.014, 0.014, H * 0.62, xS + 0.06, H * 0.31, zM, m.plastico, 10, { fixo: true });
  k.cil(0.011, 0.011, H * 0.3, xS, H * 0.62 - H * 0.15 + 0.03, zM, m.metalEscuro, 8, { fixo: true });
  k.outra("toro", [0.03, 0.011, 6, 12, Math.PI], xS + 0.03, H * 0.62 + 0.03, zM, m.metalEscuro);
});

const armarioServico = criar(({ peca, m, estilo, k }) => {
  const { largura: L, altura: H, profundidade: P } = peca, ap = k.ap;
  const lux = estilo === "luxo", mod = estilo === "moderno";
  const recuo = RECUO_FRENTE - 0.002, zF = P / 2 - recuo, hr = lim(H * 0.04, 0.05, 0.09), cimalha = lux ? 0.035 : 0;
  k.cx(L - 0.02, hr, P - recuo - 0.05, 0, hr / 2, -recuo / 2 - 0.025, mod ? m.metalEscuro : m.madeiraEscura);
  k.cx(L, H - hr - cimalha, P - recuo, 0, (H + hr - cimalha) / 2, -recuo / 2, m.laminado);
  if (lux) k.cx(L, cimalha, P, 0, H - cimalha / 2, 0, m.madeiraEscura);
  // Duas portas altas, com puxadores junto ao encontro delas.
  const w = (L - FRESTA * 3) / 2, y0 = hr + FRESTA, hf = H - cimalha - FRESTA - y0;
  for (const s of [-1, 1] as const) {
    frente(k, m, estilo, { x: s * (w + FRESTA) / 2, y: y0 + hf / 2, z: zF + 0.002, w, h: hf, mat: m.laminado, pux: { lado: s === -1 ? 1 : -1, alt: 0, dir: "v", comp: Math.min(0.32, hf * 0.2) } });
    // Aprimorado: venezianas de ventilação embaixo e em cima de cada porta (armário de produtos de limpeza).
    if (ap && estilo !== "luxo") for (const yv of [y0 + 0.09, y0 + hf - 0.13]) for (let i = 0; i < 4; i++) k.cx(w * 0.45, 0.004, 0.001, s * (w + FRESTA) / 2, yv + i * 0.012, zF + 0.002 + ESP_FRENTE + 0.0005, m.metalEscuro, { sombra: false });
  }
  if (ap) {
    // Aprimorado: sapatas niveladoras à mostra no rodapé e friso de topo com a quina adoçada.
    for (const s of [-1, 1]) k.cil(0.014, 0.018, hr, s * (L / 2 - 0.06), hr / 2, P / 2 - recuo - 0.03, m.metalEscuro, 10, { fixo: true });
    k.rb(L, 0.012, P - recuo + 0.002, 0, H - cimalha - 0.006, -recuo / 2 + 0.001, lux ? m.madeiraEscura : m.laminado, 0.004, { s: 1, fixo: true });
  }
});

// ── Área gourmet ──

const churrasqueira = criar(({ peca, m, estilo, k }) => {
  const { largura: L, altura: H, profundidade: P } = peca, ap = k.ap;
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
  if (ap) {
    // Aprimorado — fiadas de tijolo sugeridas por juntas rasas na frente dos pilares, da fornalha e da verga.
    const junta = m.pisoExterno, fiada = 0.072, sem = { sombra: false };
    const fiadas = (xc: number, w: number, ya: number, yb2: number, zFace: number) => {
      const nf = Math.max(1, Math.round((yb2 - ya) / fiada)), hf2 = (yb2 - ya) / nf, nt = Math.max(1, Math.round(w / 0.2));
      for (let i = 0; i < nf; i++) {
        if (i > 0) k.cx(w, 0.005, 0.002, xc, ya + i * hf2, zFace + 0.0008, junta, sem);
        for (let j = 0; j < nt + (i % 2); j++) {
          const xj = xc - w / 2 + (w * (j + (i % 2 ? 0 : 0.5))) / nt;
          if (xj > xc - w / 2 + 0.02 && xj < xc + w / 2 - 0.02) k.cx(0.005, hf2, 0.002, xj, ya + (i + 0.5) * hf2, zFace + 0.0008, junta, sem);
        }
      }
    };
    for (const s of [-1, 1]) {
      fiadas(xf + s * (wf / 2 - pw / 2), pw, 0, yB, P / 2 - RECUO_FRENTE);
      fiadas(xf + s * (wf / 2 - pw / 2), pw, hb, hb + hf, zPar + dPar / 2);
    }
    fiadas(xf, vao, yB - 0.12, yB, P / 2 - RECUO_FRENTE);
    // Grelha com cabos de madeira, brasa, e o suporte com três espetos.
    for (const s of [-1, 1]) k.cil(0.011, 0.011, 0.09, xf + s * vao * 0.25, yG + 0.012, zG + dG / 2 + 0.024, m.madeira, 8, { r: EIXO_X, fixo: true });
    for (let i = 0; i < 7; i++) k.outra("esf", [0.03 + (i % 3) * 0.006, 6, 4], xf + (i - 3) * vao * 0.12, hb + 0.022, zG + ((i * 5) % 3 - 1) * dG * 0.22, m.metalEscuro, { e: [1, 0.6, 1] });
    const yE = hb + hf * 0.74;
    for (const s of [-1, 1]) k.cx(vao - 0.02, 0.014, 0.012, xf, yE, zG + s * dG * 0.42, m.metalEscuro);
    for (let i = -1; i <= 1; i++) {
      const xe = xf + i * vao * 0.24;
      k.cil(0.003, 0.003, dG * 0.92, xe, yE + 0.01, zG - 0.02, m.inox, 6, { r: EIXO_Z, fixo: true });
      k.cil(0.008, 0.008, 0.06, xe, yE + 0.01, zG - 0.02 + dG * 0.46 + 0.03, m.madeira, 8, { r: EIXO_Z, fixo: true });
      for (let j = -1; j <= 1; j++) k.cx(0.03, 0.026, 0.035, xe, yE + 0.01, zG - 0.03 + j * dG * 0.16, m.madeiraEscura, { r: [0, 0, 0.4 * j] });
    }
    // Tábua de corte com faca na bancada de apoio.
    if (comApoio) {
      const xa = xf + wf / 2 + (L - wf) / 2, wt = Math.min(0.36, (L - wf) * 0.6);
      k.rb(wt, 0.026, Math.min(0.26, P * 0.42), xa, hb + 0.013, 0.03, m.madeira, 0.007, { s: 1, fixo: true, r: [0, 0.1, 0] });
      k.cx(wt * 0.5, 0.002, 0.03, xa - 0.02, hb + 0.027, 0.04, m.inox, { r: [0, 0.6, 0] });
      k.cx(wt * 0.28, 0.014, 0.022, xa + wt * 0.3, hb + 0.033, -0.035, m.madeiraEscura, { r: [0, 0.6, 0] });
    }
  }

  // Coifa: laje de arremate, tronco que afunila e chaminé até a altura total, com chapéu de pedra.
  const y1 = hb + hf + 0.07, topo = mod ? 0.62 : lux ? 0.4 : 0.46, y2 = y1 + (H - y1) * (mod ? 0.35 : 0.6);
  k.cx(wf, 0.07, P, xf, y1 - 0.035, 0, mod ? alv : m.pedra);
  k.outra("geo", [], xf, (y1 + y2) / 2, 0, alv, { e: [wf, y2 - y1, P], geo: troncoPiramide(topo) });
  k.cx(wf * topo, H - 0.05 - y2, P * topo, xf, (H - 0.05 + y2) / 2, 0, alv);
  k.cx(Math.min(wf, wf * topo + 0.06), 0.05, Math.min(P, P * topo + 0.06), xf, H - 0.025, 0, m.pedra);
  // Aprimorado: boca da chaminé escura sob o chapéu e pingadeira de pedra na laje da coifa.
  if (ap) {
    k.cx(wf * topo * 0.7, 0.03, P * topo + 0.004, xf, H - 0.085, 0, m.metalEscuro, { sombra: false });
    k.cx(wf, 0.012, 0.012, xf, y1 - 0.076, P / 2 - 0.006, mod ? alv : m.pedra);
  }
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
