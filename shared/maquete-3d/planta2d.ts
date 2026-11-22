// Maquete 3D (EPIC-028, Etapa 2) — planta 2D com cotas gerada do MESMO JSON-fonte da cena 3D. Puro: devolve
// polígonos, caminhos SVG (em metros, com y da tela = z da planta) e textos; quem desenha é `Planta2D.tsx`.
// Paredes cortadas (sem os vãos), aberturas com o símbolo do tipo (giro da folha, folhas de correr, portão),
// itens em contorno, cadeias de cotas da casa (as mesmas faixas do JSON), nome/área/medidas de cada ambiente,
// norte, escala e a legenda do que é estimado.
import {
  areaPoligono, contornoDoItem, eixoDaParede, poligonoDoAmbiente, recortar, retanguloNaParede,
  type AberturaFonte, type FontePlanta, type ParedeFonte,
} from "./fonte.js";
import { cortesDasParedes, ehAuxiliar, modeloDaEsquadria, trechosDaParede, type ModeloEsquadria } from "./fonte-cena.js";
import { pontoInterno } from "./geometria3d.js";
import type { Ponto } from "./modelo.js";
import { ROTULOS_MOVEL_FONTE } from "./rotulos-itens.js";

export const fmtM = (n: number, casas = 2) => n.toFixed(casas).replace(".", ",");
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const xy = (p: Ponto) => [r3(p.x), r3(p.y)] as [number, number];

export type Caixa2D = { x0: number; x1: number; z0: number; z1: number };
export type SegmentoCota = { de: number; ate: number; valor: number; tipo: "parede" | "ambiente"; nome?: string };
export type CadeiaCotas = { eixo: "x" | "z"; segmentos: SegmentoCota[]; total: number; esperado: number };
export type LinhaCota = {
  /** Começo e fim da linha de cota (já afastada do desenho). */
  a: [number, number]; b: [number, number];
  texto: string; nivel: number; estimado: boolean;
};
export type SimboloAbertura = {
  id: string; codigo: string; modelo: ModeloEsquadria;
  /** Contorno do vão (fica em branco no meio da parede). */
  vao: [number, number][];
  /** Traços finos (folhas, vidro, marco). */
  tracos: string;
  /** Arco de giro (tracejado). */
  arco: string | null;
  rotulo: { x: number; z: number; texto: string };
  estimado: boolean;
};
export type ItemPlanta = { id: string; tipo: string; rotulo: string; poligono: [number, number][]; x: number; z: number; estimado: boolean; mostrarRotulo: boolean };
export type AmbientePlanta = {
  nome: string; poligono: [number, number][]; x: number; z: number;
  area: number; areaPlanta: number | null; medidas: string | null; estimado: boolean; interno: boolean;
};
export type EsquadriaQuadro = { codigo: string; descricao: string; larg: number; alt: number; peitoril: number; quantidade: number; estimado: boolean };

export type Planta2D = {
  caixa: Caixa2D;
  /** viewBox "x y largura altura" em metros. */
  viewBox: [number, number, number, number];
  paredes: { id: string; muro: boolean; poligonos: [number, number][][]; estimado: boolean }[];
  aberturas: SimboloAbertura[];
  itens: ItemPlanta[];
  ambientes: AmbientePlanta[];
  cadeias: CadeiaCotas[];
  cotas: LinhaCota[];
  norte: { x: number; z: number; angulo: number; estimado: boolean } | null;
  escala: { x: number; z: number; metros: number };
  quadroEsquadrias: EsquadriaQuadro[];
  legenda: string[];
};

// ── Cadeias de cotas (as faixas do JSON) ──

/** Cadeias da largura (x) e da profundidade (z) da casa, com as posições acumuladas a partir de 0. */
export function cadeiasDaCasa(f: FontePlanta): CadeiaCotas[] {
  const { casa } = f.estrutura;
  const cadeia = (eixo: "x" | "z", faixas: typeof casa.faixas_largura, esperado: number): CadeiaCotas => {
    let pos = 0;
    const segmentos = faixas.map(fx => {
      const s: SegmentoCota = { de: r3(pos), ate: r3(pos + fx.medida), valor: fx.medida, tipo: fx.tipo, ...(fx.nome ? { nome: fx.nome } : {}) };
      pos += fx.medida;
      return s;
    });
    return { eixo, segmentos, total: r3(pos), esperado };
  };
  return [cadeia("x", casa.faixas_largura, casa.w), cadeia("z", casa.faixas_profundidade, casa.d)];
}

// ── Aberturas ──

function ponto(w: ParedeFonte, s: number, t: number): [number, number] {
  const { ux, uz, nx, nz } = eixoDaParede(w);
  return [r3(w.x1 + ux * s + nx * t), r3(w.z1 + uz * s + nz * t)];
}
const linha = (a: [number, number], b: [number, number]) => `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
const quadro = (pts: [number, number][]) => `M${pts.map(p => `${p[0]} ${p[1]}`).join("L")}Z`;

function simbolo(w: ParedeFonte, ab: AberturaFonte, giro: 1 | -1 | null, ladoDeFora: 1 | -1 = 1): SimboloAbertura {
  const { modelo, folhas } = modeloDaEsquadria(ab);
  const s0 = ab.offset, s1 = ab.offset + ab.larg, e = w.esp / 2;
  const vao = retanguloNaParede(w, s0, s1, -e, e).map(xy);
  let tracos = "", arco: string | null = null;
  if (modelo === "janela_correr") {
    // Marco nas duas faces e as folhas em dois trilhos.
    tracos += linha(ponto(w, s0, -e), ponto(w, s1, -e)) + linha(ponto(w, s0, e), ponto(w, s1, e));
    const lf = ab.larg / folhas;
    for (let k = 0; k < folhas; k++) {
      const t = (k % 2 === 0 ? -1 : 1) * e * 0.3;
      tracos += linha(ponto(w, s0 + lf * k - (k ? 0.02 : 0), t), ponto(w, s0 + lf * (k + 1) + (k < folhas - 1 ? 0.02 : 0), t));
    }
  } else if (modelo === "porta_correr") {
    const lf = ab.larg / folhas;
    for (let k = 0; k < folhas; k++) {
      const t = (k % 2 === 0 ? -1 : 1) * e * 0.35, a = s0 + lf * k - (k ? 0.03 : 0), b = s0 + lf * (k + 1) + (k < folhas - 1 ? 0.03 : 0);
      tracos += quadro([ponto(w, a, t - 0.02), ponto(w, b, t - 0.02), ponto(w, b, t + 0.02), ponto(w, a, t + 0.02)]);
    }
  } else if (modelo === "portao_gradeado") {
    tracos += linha(ponto(w, s0, 0), ponto(w, s1, 0));
    for (let s = s0 + 0.12; s < s1 - 0.06; s += 0.24) tracos += linha(ponto(w, s, -e * 0.6), ponto(w, s, e * 0.6));
  } else if (giro) {
    // Folha aberta a 90° para o lado do giro e o arco até o batente oposto.
    const sH = ab.abertura === "esq" ? s0 : s1, sO = ab.abertura === "esq" ? s1 : s0, t = giro * e;
    const h = ponto(w, sH, t), o = ponto(w, sO, t), fim = ponto(w, sH, t + giro * ab.larg);
    tracos += linha(h, fim) + linha(ponto(w, sH - 0.02 * Math.sign(sO - sH), t), ponto(w, sH - 0.02 * Math.sign(sO - sH), t + giro * ab.larg));
    const vL = [fim[0] - h[0], fim[1] - h[1]], vO = [o[0] - h[0], o[1] - h[1]];
    const sentido = vL[0] * vO[1] - vL[1] * vO[0] > 0 ? 1 : 0;
    arco = `M${fim[0]} ${fim[1]}A${r3(ab.larg)} ${r3(ab.larg)} 0 0 ${sentido} ${o[0]} ${o[1]}`;
  }
  const lado = giro ? -giro : ladoDeFora;
  const [rx, rz] = ponto(w, (s0 + s1) / 2, lado * (e + 0.22));
  return { id: ab.id, codigo: ab.codigo, modelo, vao, tracos, arco, rotulo: { x: rx, z: rz, texto: ab.codigo }, estimado: !!ab.estimado };
}

// ── Planta ──

const dentroDaCaixa = (pol: [number, number][], c: Caixa2D) => pol.every(([x, z]) => x >= c.x0 - 1e-6 && x <= c.x1 + 1e-6 && z >= c.z0 - 1e-6 && z <= c.z1 + 1e-6);

export function planta2d(f: FontePlanta): Planta2D {
  const { paredes, aberturas, ambientes } = f.estrutura;
  const casaParedes = paredes.filter(w => !w.muro);
  const pts = casaParedes.flatMap(w => [[w.x1, w.z1], [w.x2, w.z2]]);
  const minX = Math.min(...pts.map(p => p[0])) - 0.075, maxX = Math.max(...pts.map(p => p[0])) + 0.075;
  const minZ = Math.min(...pts.map(p => p[1])) - 0.075, maxZ = Math.max(...pts.map(p => p[1])) + 0.075;
  // Região desenhada: a casa, os ambientes externos encostados nela (serviço, varanda) e 0,6 m de quintal e frente.
  const externosPerto = ambientes.filter(a => !a.interno && areaPoligono(poligonoDoAmbiente(a)) < 20).flatMap(a => a.poligono);
  const caixa: Caixa2D = {
    x0: Math.min(0, minX), x1: Math.max(f.estrutura.casa.w, maxX),
    z0: Math.min(minZ, ...externosPerto.map(p => p[1])) - 0.6, z1: Math.max(maxZ, ...externosPerto.map(p => p[1])) + 0.6,
  };
  const janela: Ponto[] = [{ x: caixa.x0, y: caixa.z0 }, { x: caixa.x1, y: caixa.z0 }, { x: caixa.x1, y: caixa.z1 }, { x: caixa.x0, y: caixa.z1 }];
  const recorte = (pol: Ponto[]) => recortar(pol, janela).map(xy);

  const cortes = cortesDasParedes(paredes);
  const paredes2d = paredes.map(w => ({
    id: w.id, muro: !!w.muro, estimado: !!w.estimado,
    poligonos: trechosDaParede(w, aberturas, cortes.get(w.id)).filter(t => t.tipo === "cheio")
      .map(t => recorte(retanguloNaParede(w, t.s0, t.s1, -w.esp / 2, w.esp / 2))).filter(p => p.length >= 3),
  })).filter(w => w.poligonos.length);

  const paredePorId = new Map(paredes.map(w => [w.id, w] as const));
  const simbolos: SimboloAbertura[] = [];
  for (const ab of aberturas) {
    const w = paredePorId.get(ab.parede);
    if (!w) continue;
    const destino = ab.abre_para ? ambientes.find(a => a.nome === ab.abre_para) : undefined;
    // Mesmo lado de giro da cena 3D (validacao-fonte: ladoDoAmbiente).
    let giro: 1 | -1 | null = null;
    if (ab.abertura !== "correr" && destino) {
      const { ux, uz, nx, nz } = eixoDaParede(w), s = ab.offset + ab.larg / 2;
      for (const lado of [1, -1] as const) {
        const t = lado * (w.esp / 2 + 0.05), q = { x: w.x1 + ux * s + nx * t, y: w.z1 + uz * s + nz * t };
        if (dentroPol(q, poligonoDoAmbiente(destino))) { giro = lado; break; }
      }
    }
    // Rótulo de janela e de porta de correr do lado de fora da casa (onde não há ambiente interno).
    const internos = ambientes.filter(a => a.interno).map(poligonoDoAmbiente);
    const { ux: ex, uz: ez, nx: fx, nz: fz } = eixoDaParede(w), sm = ab.offset + ab.larg / 2;
    const fora = ([1, -1] as const).find(l => {
      const t = l * (w.esp / 2 + 0.2), q = { x: w.x1 + ex * sm + fx * t, y: w.z1 + ez * sm + fz * t };
      return !internos.some(pol => dentroPol(q, pol));
    }) ?? 1;
    const sb = simbolo(w, ab, giro, fora);
    if (!dentroDaCaixa(sb.vao, caixa)) continue;
    // Rótulos de portas vizinhas (ex.: P3 do banheiro e P4 do quarto 2, no hall) não se sobrepõem: se o lugar padrão
    // bate num rótulo já posto, o rótulo desliza ao longo do próprio vão e, em último caso, vai para o outro lado.
    const lado = giro ? -giro : fora, e = w.esp / 2 + 0.22, s0 = ab.offset, s1 = ab.offset + ab.larg;
    const candidatos: [number, number][] = [[sb.rotulo.x, sb.rotulo.z], ponto(w, s0 + 0.12, lado * e), ponto(w, s1 - 0.12, lado * e), ponto(w, (s0 + s1) / 2, -lado * e)];
    const livre = candidatos.find(([x, z]) => !simbolos.some(o => Math.abs(o.rotulo.x - x) < 0.26 && Math.abs(o.rotulo.z - z) < 0.17));
    if (livre) sb.rotulo = { ...sb.rotulo, x: livre[0], z: livre[1] };
    simbolos.push(sb);
  }

  const itens: ItemPlanta[] = f.itens.map(i => {
    const pol = contornoDoItem(i).map(xy);
    return { id: i.id, tipo: i.tipo, rotulo: ROTULOS_MOVEL_FONTE[i.tipo] ?? i.tipo, poligono: pol, x: i.x, z: i.z, estimado: !!i.estimado, mostrarRotulo: i.larg * i.prof >= 0.3 };
  }).filter(i => dentroDaCaixa(i.poligono, caixa));

  const ambs: AmbientePlanta[] = ambientes.filter(a => !ehAuxiliar(a)).map(a => {
    const pol = poligonoDoAmbiente(a), visivel = recorte(pol), dentro = recortar(pol, janela);
    const p = pontoInterno(dentro.length >= 3 ? dentro : pol);
    const xs = a.poligono.map(q => q[0]), zs = a.poligono.map(q => q[1]);
    const retangular = a.poligono.length === 4 && dentroDaCaixa(a.poligono, caixa);
    return {
      nome: a.nome, poligono: visivel, x: r3(p.x), z: r3(p.y),
      area: Math.round(areaPoligono(pol) * 100) / 100, areaPlanta: a.area_planta,
      medidas: retangular ? `${fmtM(Math.max(...xs) - Math.min(...xs))} × ${fmtM(Math.max(...zs) - Math.min(...zs))}` : null,
      estimado: !!a.estimado, interno: a.interno,
    };
  }).filter(a => a.poligono.length >= 3);
  // Rótulo de item que cairia em cima do nome do ambiente fica de fora (o contorno continua).
  for (const i of itens) if (ambs.some(a => Math.abs(a.x - i.x) < 0.75 && Math.abs(a.z + 0.1 - i.z) < 0.4)) i.mostrarRotulo = false;

  // Cotas: largura acima do desenho, profundidade à direita; a total um nível mais afastada.
  const cadeias = cadeiasDaCasa(f);
  const cotas: LinhaCota[] = [];
  const zCota = caixa.z0 - 0.35, xCota = caixa.x1 + 0.35, passo = 0.45;
  for (const c of cadeias) {
    for (const s of c.segmentos) cotas.push(c.eixo === "x"
      ? { a: [s.de, zCota], b: [s.ate, zCota], texto: fmtM(s.valor), nivel: 0, estimado: false }
      : { a: [xCota, s.de], b: [xCota, s.ate], texto: fmtM(s.valor), nivel: 0, estimado: false });
    cotas.push(c.eixo === "x"
      ? { a: [0, zCota - passo], b: [c.total, zCota - passo], texto: fmtM(c.total), nivel: 1, estimado: false }
      : { a: [xCota + passo, 0], b: [xCota + passo, c.total], texto: fmtM(c.total), nivel: 1, estimado: false });
  }

  const porCodigo = new Map<string, EsquadriaQuadro>();
  for (const ab of aberturas) {
    const q = porCodigo.get(ab.codigo);
    if (q) { q.quantidade++; q.estimado ||= !!ab.estimado; continue; }
    porCodigo.set(ab.codigo, { codigo: ab.codigo, descricao: ab.descricao ?? ab.tipo, larg: ab.larg, alt: ab.alt, peitoril: ab.peitoril, quantidade: 1, estimado: !!ab.estimado });
  }

  const margem = { esq: 0.35, cima: 1.35, dir: 1.35, baixo: 1.3 };
  const viewBox: [number, number, number, number] = [
    r3(caixa.x0 - margem.esq), r3(caixa.z0 - margem.cima),
    r3(caixa.x1 - caixa.x0 + margem.esq + margem.dir), r3(caixa.z1 - caixa.z0 + margem.cima + margem.baixo),
  ];
  return {
    caixa, viewBox, paredes: paredes2d, aberturas: simbolos, itens, ambientes: ambs, cadeias, cotas,
    norte: f.norte ? { x: r3(caixa.x0 + 0.3), z: r3(caixa.z1 + 0.45), angulo: f.norte.angulo, estimado: !!f.norte.estimado } : null,
    escala: { x: r3(caixa.x0 + 0.9), z: r3(caixa.z1 + 0.3), metros: 2 },
    quadroEsquadrias: Array.from(porCodigo.values()).sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true })),
    legenda: [
      "Medidas em metros. Cotas da casa pelas faixas da prancha.",
      "Linha tracejada: item ou medida estimada (sem cota na prancha). * área ou ambiente estimado.",
      "Itens (móveis, bancadas, balcão) em contorno; o balcão é móvel, não parede.",
    ],
  };
}

function dentroPol(q: Ponto, pol: Ponto[]): boolean {
  let c = false;
  for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
    const a = pol[i], b = pol[j];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
