// Maquete 3D (EPIC-024, S-04, 16/11/2026) — muro de divisa do condomínio como geometria de verdade: o contorno
// externo do terreno (KML/KMZ ou implantação) vira um muro extrudado com altura e espessura, por dentro da divisa,
// com cantos fechados (meia-esquadria), assentado no relevo e aberto nos portões. Nunca há muro entre lotes.
//   • Portões automáticos: em TODA rua que chega à divisa (acesso do estudo de massa, ponta de rua junto da divisa
//     ou rua que a atravessa), alinhados com o eixo da rua e da largura do leito (pista + calçadas) — a principal
//     é a portaria, as outras, portões secundários; sem nenhuma, no ponto da divisa mais perto da rua principal.
//   • Relevo: a base acompanha a MESMA malha do terreno do visualizador (alturaNaMalha), com estações a cada 2 m e
//     estações também onde a face cruza as arestas da malha e 50 cm de fundação enterrada (nunca flutua nem abre
//     fresta); o topo segue o chão a altura constante. Um muro em cada área do terreno (KML com várias áreas).
// Saída: malhas já juntas por material (uma chamada de desenho cada) em coordenadas do three.js — [x, altura, y].
// Módulo puro: nada de three.js aqui.
import { areasDoTerreno, assinaturaDoContorno, type Implantacao, type Muro, type PortaoMuro, type Ponto, type TipoPortao } from "./modelo.js";
import { alturaNaMalha, caixaDoTerreno, dentroDe, LADO_MALHA, sistemaViario, type CaixaTerreno, type SistemaViario, type Trecho } from "./vias.js";

// ── Medidas (m) ──

/**
 * Fundação abaixo do chão (saia que não aparece): o muro nunca flutua nem abre fresta. Com relevo, as estações
 * também caem onde a linha do muro cruza as arestas da malha do terreno, então o pé segue a malha exatamente.
 */
export const ENTERRO_MURO = 0.5;
/** Distância máxima entre estações ao longo do muro (o pé acompanha o relevo nesse passo). */
export const PASSO_MURO = 2;
/** Capa (rufo) do topo: altura e quanto passa da face do muro. */
export const ALTURA_CAPA = 0.06, SOBRA_CAPA = 0.03;
/** Pilares de amarração na face interna. */
export const ESPACO_PILASTRA = 3, LARGURA_PILASTRA = 0.22, SALIENCIA_PILASTRA = 0.06;
/** Pilar do portão: comprimento ao longo do muro e quanto sobe acima do muro. */
export const PILAR_PORTAO = 0.4, SOBE_PILAR = 0.25;
/** Largura do portão de veículos (perpendicular à rua): limites e o padrão quando não há rua para medir. */
export const LARGURA_PORTAO_VEICULOS: readonly [number, number] = [3, 20];
export const LARGURA_PORTAO_PADRAO = 6;
/** Folga de cada lado do portão: o muro não encosta no meio-fio. */
export const FOLGA_PORTAO = 0.3;
const LIMITE_MITRA = 4;

export type MaterialMuro = "muro" | "capa" | "portao";
export type MalhaMuro = { posicoes: Float32Array; normais: Float32Array; uvs: Float32Array; tons: Float32Array; indices: Uint32Array };
export type AberturaMuro = { id: string; tipo: TipoPortao; posicao: number; largura: number; principal: boolean; area: number };
export type ResumoMuro = {
  /** Perímetro da divisa e comprimento de muro construído (eixo, já sem os portões), somando todas as áreas. */
  perimetro: number; comprimento: number;
  /** O mesmo, por área do terreno (`indice` = `portao.area`). */
  areas: { indice: number; perimetro: number; comprimento: number }[];
  altura: number; espessura: number; recuo: number;
  aberturas: AberturaMuro[];
  notas: string[];
  vertices: number;
};
export type GeometriaMuro = {
  malhas: Partial<Record<MaterialMuro, MalhaMuro>>;
  resumo: ResumoMuro;
  /** Eixo de cada trecho contínuo de muro, em planta (para conferência e para a planta 2D). */
  trechos: Ponto[][];
};
export type PortoesAutomaticos = {
  /** Os portões automáticos: um em cada rua que chega à divisa, em todas as áreas (a portaria de cada área primeiro). */
  portoes: PortaoMuro[];
  /** Todos os acessos de rua achados na divisa, para a pessoa reabrir o portão que tirou. */
  candidatos: PortaoMuro[];
  notas: string[];
};

// ── Vetores ──

const sub = (a: Ponto, b: Ponto): Ponto => ({ x: a.x - b.x, y: a.y - b.y });
const soma = (a: Ponto, b: Ponto): Ponto => ({ x: a.x + b.x, y: a.y + b.y });
const esc = (a: Ponto, k: number): Ponto => ({ x: a.x * k, y: a.y * k });
const pe = (a: Ponto, b: Ponto) => a.x * b.x + a.y * b.y;
const cruz = (a: Ponto, b: Ponto) => a.x * b.y - a.y * b.x;
const dist = (a: Ponto, b: Ponto) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (a: Ponto): Ponto => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };
const lerp = (a: Ponto, b: Ponto, t: number): Ponto => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const r2 = (n: number) => Math.round(n * 100) / 100;
const limitar = (v: number, [a, b]: readonly [number, number]) => Math.min(b, Math.max(a, v));
const modulo = (v: number, m: number) => ((v % m) + m) % m;

// ── O contorno ──

/**
 * Divisa preparada: pontos no sentido anti-horário (interior à esquerda), sem repetidos nem pontos alinhados, cada
 * um com a distância `u` ao longo da divisa a partir do vértice 1 — no sentido INTERNO. `paraInterno` converte a
 * posição salva (sentido em que o contorno foi desenhado) para `u`, e `paraSalvo` faz o contrário.
 */
type Anel = { pts: Ponto[]; u: number[]; total: number; invertido: boolean; mitras: Ponto[] };

/** Desvio (m) abaixo do qual um ponto quase alinhado é dispensado — o muro segue o contorno com folga de 2 cm. */
const TOLERANCIA_ALINHADO = 0.02;
/** O muro começa esta folga para dentro da divisa: a corda que substitui os pontos alinhados nunca a ultrapassa. */
export const FOLGA_DIVISA = TOLERANCIA_ALINHADO + 0.005;

function prepararAnel(terreno: Ponto[]): Anel | null {
  const limpo: Ponto[] = [];
  for (const p of terreno) if (Number.isFinite(p.x) && Number.isFinite(p.y) && (!limpo.length || dist(limpo[limpo.length - 1], p) > 0.01)) limpo.push(p);
  while (limpo.length > 2 && dist(limpo[0], limpo[limpo.length - 1]) < 0.01) limpo.pop();
  if (limpo.length < 3) return null;
  let area2 = 0;
  for (let i = 0; i < limpo.length; i++) area2 += cruz(limpo[i], limpo[(i + 1) % limpo.length]);
  if (Math.abs(area2) < 2) return null;
  const invertido = area2 < 0;
  // Sentido interno: começa no mesmo vértice 1 e anda ao contrário quando o desenho é horário.
  const base = invertido ? [limpo[0], ...limpo.slice(1).reverse()] : limpo;
  const uBase = [0];
  for (let i = 1; i < base.length; i++) uBase.push(uBase[i - 1] + dist(base[i - 1], base[i]));
  const total = uBase[uBase.length - 1] + dist(base[base.length - 1], base[0]);
  // Tira os pontos alinhados (contorno de KML denso), sem mudar a medida ao longo da divisa.
  const pts: Ponto[] = [base[0]], u: number[] = [0];
  let pulados: Ponto[] = [];
  for (let i = 1; i < base.length; i++) {
    const prox = base[(i + 1) % base.length], ultimo = pts[pts.length - 1];
    const seg = sub(prox, ultimo), l = Math.hypot(seg.x, seg.y);
    const desvio = (p: Ponto) => (l < 1e-9 ? dist(p, ultimo) : Math.abs(cruz(seg, sub(p, ultimo))) / l);
    const naFrente = (p: Ponto) => { const t = pe(sub(p, ultimo), seg) / (l * l || 1); return t > 0 && t < 1; };
    const candidatos = [...pulados, base[i]];
    if (i < base.length - 1 && pulados.length < 60 && candidatos.every(p => desvio(p) < TOLERANCIA_ALINHADO && naFrente(p))) { pulados = candidatos; continue; }
    pts.push(base[i]); u.push(uBase[i]); pulados = [];
  }
  if (pts.length < 3) return null;
  // Meia-esquadria de cada vértice: deslocar δ para dentro é somar δ × mitra (limitada nas pontas muito agudas).
  const n = pts.length, mitras: Ponto[] = [];
  for (let k = 0; k < n; k++) {
    const a = pts[(k - 1 + n) % n], p = pts[k], b = pts[(k + 1) % n];
    const d0 = unit(sub(p, a)), d1 = unit(sub(b, p));
    const n0 = { x: -d0.y, y: d0.x }, n1 = { x: -d1.y, y: d1.x };
    const den = 1 + pe(n0, n1);
    let m = den < 1e-6 ? n0 : esc(soma(n0, n1), 1 / den);
    const lm = Math.hypot(m.x, m.y);
    if (lm > LIMITE_MITRA) m = esc(m, LIMITE_MITRA / lm);
    mitras.push(m);
  }
  return { pts, u, total, invertido, mitras };
}

const paraInterno = (a: Anel, s: number) => (a.invertido ? modulo(a.total - s, a.total) : modulo(s, a.total));
const paraSalvo = paraInterno; // a mesma reflexão nos dois sentidos

/** Aresta que contém a posição `u` (índice k: do vértice k ao k+1) e o parâmetro t nela. */
function arestaEm(a: Anel, u: number): { k: number; t: number } {
  const n = a.pts.length, uu = modulo(u, a.total);
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (a.u[mid] <= uu) lo = mid; else hi = mid - 1; }
  const fim = lo === n - 1 ? a.total : a.u[lo + 1];
  return { k: lo, t: fim - a.u[lo] < 1e-9 ? 0 : (uu - a.u[lo]) / (fim - a.u[lo]) };
}
/**
 * Linha da aresta k deslocada δ para dentro: do canto A ao canto B (meias-esquadrias) e o trecho [t0, t1] dela que
 * corresponde à aresta da divisa. Num canto convexo a linha de dentro é mais curta: os pontos perto dele param no
 * canto (o muro é cortado no esquadro); num reentrante ela é mais longa e vai até a esquadria, sem fresta.
 */
function linhaDaAresta(a: Anel, k: number, delta: number) {
  const k2 = (k + 1) % a.pts.length, P = a.pts[k], Q = a.pts[k2], d = unit(sub(Q, P)), nn = { x: -d.y, y: d.x };
  const A = soma(P, esc(a.mitras[k], delta)), B = soma(Q, esc(a.mitras[k2], delta)), ab = sub(B, A), l2 = pe(ab, ab);
  const par = (X: Ponto) => (l2 < 1e-12 ? 0 : pe(sub(X, A), ab) / l2);
  return { A, ab, l2, t0: Math.min(0, par(soma(P, esc(nn, delta)))), t1: Math.max(1, par(soma(Q, esc(nn, delta)))), par };
}
function naLinha(a: Anel, k: number, t: number, delta: number): Ponto {
  const l = linhaDaAresta(a, k, delta);
  return soma(l.A, esc(l.ab, Math.max(0, Math.min(1, l.t0 + (l.t1 - l.t0) * t))));
}
/** Posição `u` do ponto X da linha da aresta k deslocada δ (o inverso de naLinha). */
function uNaAresta(a: Anel, k: number, X: Ponto, delta: number): number {
  const n = a.pts.length, l = linhaDaAresta(a, k, delta), fim = k === n - 1 ? a.total : a.u[(k + 1) % n];
  const t = Math.max(0, Math.min(1, (l.par(X) - l.t0) / (l.t1 - l.t0 || 1)));
  return a.u[k] + t * (fim - a.u[k]);
}
/** Ponto da linha deslocada δ para dentro, na posição `u`. */
function pontoEm(a: Anel, delta: number, u: number): Ponto {
  const { k, t } = arestaEm(a, u);
  return naLinha(a, k, t, delta);
}
/** Direção da divisa (sentido interno) na posição `u`. */
function direcaoEm(a: Anel, u: number): Ponto {
  const { k } = arestaEm(a, u);
  return unit(sub(a.pts[(k + 1) % a.pts.length], a.pts[k]));
}

/** Projeção de um ponto na linha deslocada δ: posição `u`, distância e a direção da aresta. */
function projetar(a: Anel, delta: number, p: Ponto): { u: number; d: number; dir: Ponto } {
  const n = a.pts.length;
  let melhor = { u: 0, d: Infinity, dir: { x: 1, y: 0 } };
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n, A = soma(a.pts[k], esc(a.mitras[k], delta)), B = soma(a.pts[k2], esc(a.mitras[k2], delta));
    const ab = sub(B, A), l2 = pe(ab, ab) || 1, t = Math.max(0, Math.min(1, pe(sub(p, A), ab) / l2));
    const X = lerp(A, B, t), d = dist(p, X);
    if (d < melhor.d) melhor = { u: uNaAresta(a, k, X, delta), d, dir: unit(sub(a.pts[k2], a.pts[k])) };
  }
  return melhor;
}

/** Onde a reta p + s·d corta a linha deslocada δ, com |s| ≤ alcance: a posição mais perto de p. */
function cruzamento(a: Anel, delta: number, p: Ponto, d: Ponto, alcance: number): { u: number; dir: Ponto; s: number } | null {
  const n = a.pts.length;
  let melhor: { u: number; dir: Ponto; s: number } | null = null;
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n, A = soma(a.pts[k], esc(a.mitras[k], delta)), B = soma(a.pts[k2], esc(a.mitras[k2], delta));
    const e = sub(B, A), den = cruz(d, e);
    if (Math.abs(den) < 1e-9) continue;
    const s = cruz(sub(A, p), e) / den, t = cruz(sub(A, p), d) / den;
    if (t < -1e-9 || t > 1 + 1e-9 || Math.abs(s) > alcance) continue;
    if (!melhor || Math.abs(s) < Math.abs(melhor.s)) melhor = { u: uNaAresta(a, k, lerp(A, B, t), delta), dir: unit(e), s };
  }
  return melhor;
}

export const perimetroDoTerreno = (terreno: Ponto[]) => prepararAnel(terreno)?.total ?? 0;

// ── Áreas do terreno ──

/** Área do terreno pronta para o muro: o índice em areasDoTerreno (= `portao.area`), o anel e o contorno original. */
type AreaMuro = { indice: number; anel: Anel; contorno: Ponto[] };
function areasDoMuro(imp: Implantacao): AreaMuro[] {
  return areasDoTerreno(imp).flatMap((contorno, indice) => { const anel = prepararAnel(contorno); return anel ? [{ indice, anel, contorno }] : []; });
}
/** Perímetro de cada área do terreno (0 quando o contorno não serve), na ordem de `portao.area`. */
export const perimetrosDasAreas = (imp: Implantacao) => areasDoTerreno(imp).map(c => prepararAnel(c)?.total ?? 0);

/** Ponto da divisa (delta 0) na posição salva `posicao` da área. */
function pontoNaDivisa(a: Anel, posicao: number): Ponto { return pontoEm(a, 0, paraInterno(a, posicao)); }

/** Ponto da divisa onde fica o centro de cada portão (para a planta e para reposicionar quando o contorno muda). */
export function pontosDosPortoes(imp: Implantacao, portoes: PortaoMuro[]): (Ponto | null)[] {
  const aneis = areasDoTerreno(imp).map(c => prepararAnel(c));
  return portoes.map(p => { const a = aneis[p.area ?? 0]; return a ? pontoNaDivisa(a, p.posicao) : null; });
}

/** Vértice 1 de cada área (onde começa a medida "a partir do vértice 1"). */
export const verticesIniciais = (imp: Implantacao): (Ponto | null)[] => areasDoTerreno(imp).map(c => (prepararAnel(c) ? c[0] : null));

/**
 * O contorno mudou (estudo atualizado) e os portões tinham sido editados: cada um vai para o ponto da NOVA divisa
 * mais perto de onde estava (em qualquer área), e o muro fica marcado para a pessoa conferir. Sem mudança no
 * contorno (ou sem portões editados), devolve o muro como está.
 */
export function reancorarPortoes(antiga: Implantacao | null | undefined, nova: Implantacao, muro: Muro | null): { muro: Muro | null; mudou: boolean } {
  if (!muro?.portoesEditados || !muro.portoes.length) return { muro, mudou: false };
  const assinatura = assinaturaDoContorno(nova);
  const anterior = muro.contorno ?? (antiga ? assinaturaDoContorno(antiga) : null);
  if (anterior === assinatura) return { muro: { ...muro, contorno: assinatura }, mudou: false };
  const velhos = antiga ? pontosDosPortoes(antiga, muro.portoes) : muro.portoes.map(() => null);
  const areas = areasDoMuro(nova);
  if (!areas.length) return { muro, mudou: false };
  const portoes = muro.portoes.map((p, k) => {
    const q = velhos[k];
    if (!q) return p;
    let melhor = { area: areas[0], u: 0, d: Infinity };
    for (const ar of areas) { const pr = projetar(ar.anel, 0, q); if (pr.d < melhor.d) melhor = { area: ar, u: pr.u, d: pr.d }; }
    return { ...p, area: melhor.area.indice, posicao: r2(paraSalvo(melhor.area.anel, melhor.u)) };
  });
  return { muro: { ...muro, portoes, contorno: assinatura, reancorado: true }, mudou: true };
}

// ── Portões automáticos ──

/** Eixo da linha do muro (meio da espessura). */
const deltaEixo = (muro: Pick<Muro, "recuo" | "espessura">) => FOLGA_DIVISA + muro.recuo + muro.espessura / 2;

type Candidato = { u: number; largura: number; trecho: Trecho | null; via: boolean; distanciaVia: number | null };

const larguraNaDivisa = (t: Trecho, seno: number) => Math.min(limitar(t.largura, LARGURA_PORTAO_VEICULOS) / seno + 2 * FOLGA_PORTAO, LARGURA_PORTAO_VEICULOS[1] * 1.3);

/** Portão onde a rua termina junto da divisa: centro no eixo da rua, largura do leito medida ao longo do muro. */
function portaoNaRua(a: Anel, delta: number, t: Trecho, ponta: "inicio" | "fim"): Candidato | null {
  const e = t.eixo, fim = ponta === "fim" ? e[e.length - 1] : e[0], antes = ponta === "fim" ? e[e.length - 2] : e[1];
  if (!fim || !antes) return null;
  const dir = unit(sub(fim, antes));
  const x = cruzamento(a, delta, fim, dir, t.largura / 2 + 6);
  if (!x) return null;
  const seno = Math.abs(cruz(dir, x.dir));
  if (seno < 0.5) return null; // rua correndo junto da divisa não sai por ela
  return { u: x.u, largura: larguraNaDivisa(t, seno), trecho: t, via: false, distanciaVia: null };
}

/** Onde o eixo da rua atravessa a linha do muro no meio de um trecho (rua que passa pela divisa e segue). */
function travessias(a: Anel, delta: number, t: Trecho): Candidato[] {
  const out: Candidato[] = [], n = a.pts.length;
  for (let i = 0; i < t.eixo.length - 1; i++) {
    const p0 = t.eixo[i], d = sub(t.eixo[i + 1], p0), ld = Math.hypot(d.x, d.y);
    if (ld < 1e-9) continue;
    for (let k = 0; k < n; k++) {
      const A = soma(a.pts[k], esc(a.mitras[k], delta)), B = soma(a.pts[(k + 1) % n], esc(a.mitras[(k + 1) % n], delta)), e = sub(B, A), den = cruz(d, e);
      if (Math.abs(den) < 1e-9) continue;
      const s = cruz(sub(A, p0), e) / den, r = cruz(sub(A, p0), d) / den;
      if (s < 0 || s > 1 || r < 0 || r > 1) continue;
      const seno = Math.abs(cruz(esc(d, 1 / ld), unit(e)));
      if (seno < 0.5) continue;
      out.push({ u: uNaAresta(a, k, lerp(A, B, r), delta), largura: larguraNaDivisa(t, seno), trecho: t, via: false, distanciaVia: null });
    }
  }
  return out;
}

const distanciaNoAnel = (a: Anel, u: number, v: number) => Math.abs(modulo(u - v + a.total / 2, a.total) - a.total / 2);

/**
 * Portões automáticos do muro, em CADA área do terreno. Regra: toda rua da malha que chega à divisa ganha abertura
 * (nunca há muro atravessando o corredor de uma rua): os acessos do estudo de massa, as pontas de rua junto da
 * divisa e as ruas que a atravessam. Em cada área, o acesso principal vira a portaria (veículos) — o que tem via
 * pública mapeada (o mais perto dela), senão o da rua mais larga — e os outros, portões secundários. Área sem
 * nenhuma rua na divisa: o portão vai no ponto da divisa mais perto da rua principal (ou do centro), com nota.
 */
export function portoesAutomaticos(imp: Implantacao, muro: Pick<Muro, "recuo" | "espessura"> = { recuo: 0, espessura: 0.2 }, sv?: SistemaViario): PortoesAutomaticos {
  const areas = areasDoMuro(imp);
  if (!areas.length) return { portoes: [], candidatos: [], notas: ["Sem o contorno do terreno: não há muro nem portão."] };
  const delta = deltaEixo(muro), sistema = sv ?? sistemaViario(imp), notas: string[] = [];
  const pontas = sistema.trechos.flatMap(t => (["inicio", "fim"] as const).map(ponta => ({ t, ponta, p: ponta === "inicio" ? t.eixo[0] : t.eixo[t.eixo.length - 1] })));
  const varias = areas.length > 1;
  // Cada acesso do estudo vai para a área de divisa mais perto.
  const acessosDa = new Map<number, NonNullable<Implantacao["acessos"]>>();
  for (const ac of imp.acessos ?? []) {
    const q = { x: ac.x, y: ac.y };
    const dono = areas.map(ar => ({ ar, d: projetar(ar.anel, delta, q).d })).sort((x, y) => x.d - y.d)[0].ar;
    acessosDa.set(dono.indice, [...(acessosDa.get(dono.indice) ?? []), ac]);
  }
  const lista: PortaoMuro[] = [];
  for (const ar of areas) {
    const a = ar.anel, cands: Candidato[] = [], prefixo = varias ? `Área ${ar.indice + 1}: ` : "";
    for (const ac of acessosDa.get(ar.indice) ?? []) {
      const q = { x: ac.x, y: ac.y };
      const perto = pontas.map(pt => ({ ...pt, d: dist(pt.p, q) })).filter(pt => pt.d < Math.max(pt.t.largura, 8)).sort((x, y) => x.d - y.d);
      const naRua = perto.map(pt => portaoNaRua(a, delta, pt.t, pt.ponta)).find(Boolean) ?? null;
      const c = naRua ?? { u: projetar(a, delta, q).u, largura: LARGURA_PORTAO_PADRAO + 2 * FOLGA_PORTAO, trecho: null, via: false, distanciaVia: null };
      cands.push({ ...c, via: ac.viaExistente, distanciaVia: ac.distancia });
    }
    // Toda rua que chega à divisa, com ou sem acesso salvo: a ponta junto dela e a travessia.
    for (const pt of pontas) {
      if (projetar(a, delta, pt.p).d > pt.t.largura / 2 + 1.5) continue;
      const c = portaoNaRua(a, delta, pt.t, pt.ponta);
      if (c) cands.push(c);
    }
    for (const t of sistema.trechos) cands.push(...travessias(a, delta, t));
    // Dois candidatos no mesmo lugar (as duas pontas de uma rua curta, o acesso e a ponta da rua dele): fica um.
    const unicos: Candidato[] = [];
    for (const c of cands) {
      const igual = unicos.find(o => distanciaNoAnel(a, o.u, c.u) < (o.largura + c.largura) / 2);
      if (!igual) unicos.push(c);
      else if (c.via && !igual.via) Object.assign(igual, c);
      else if (!igual.trecho && c.trecho) Object.assign(igual, { u: c.u, largura: c.largura, trecho: c.trecho });
    }
    const centro = esc(a.pts.reduce((s, p) => soma(s, p), { x: 0, y: 0 }), 1 / a.pts.length);
    const pontoDo = (c: Candidato) => pontoEm(a, delta, c.u);
    unicos.sort((x, y) => (Number(y.via) - Number(x.via)) || ((x.distanciaVia ?? Infinity) - (y.distanciaVia ?? Infinity))
      || ((y.trecho?.largura ?? 0) - (x.trecho?.largura ?? 0)) || (dist(pontoDo(x), centro) - dist(pontoDo(y), centro)) || (x.u - y.u));

    if (!unicos.length) {
      // Só as ruas que passam por dentro desta área.
      const daArea = sistema.trechos.filter(t => densificar(t.eixo, 5).some(p => dentroDe(p, ar.contorno)));
      const principal = [...daArea].sort((x, y) => y.largura - x.largura || comprimentoDe(y.eixo) - comprimentoDe(x.eixo))[0];
      if (principal) {
        let melhor = { u: 0, d: Infinity };
        for (const p of densificar(principal.eixo, 1)) { const pr = projetar(a, delta, p); if (pr.d < melhor.d) melhor = pr; }
        unicos.push({ u: melhor.u, largura: limitar(principal.largura, LARGURA_PORTAO_VEICULOS) + 2 * FOLGA_PORTAO, trecho: principal, via: false, distanciaVia: null });
        notas.push(`${prefixo}Nenhuma rua chega à divisa: o portão foi posto no ponto da divisa mais perto da rua principal. Confira a posição.`);
      } else {
        const pts = imp.lotes.filter(l => l.poligono.length && dentroDe(l.poligono[0], ar.contorno)).flatMap(l => l.poligono);
        const meio = pts.length ? esc(pts.reduce((s, p) => soma(s, p), { x: 0, y: 0 }), 1 / pts.length) : centro;
        unicos.push({ u: projetar(a, delta, meio).u, largura: LARGURA_PORTAO_PADRAO + 2 * FOLGA_PORTAO, trecho: null, via: false, distanciaVia: null });
        notas.push(`${prefixo}Não há ruas ${varias ? "nesta área" : "na implantação"}: o portão de ${LARGURA_PORTAO_PADRAO} m foi posto no ponto da divisa mais perto do centro. Confira a posição.`);
      }
    }
    if (unicos.length > 1) notas.push(`${prefixo}${unicos.length} ruas chegam à divisa: a principal virou a portaria e as outras, portões secundários. Tire na lista o portão da rua que não deve sair do condomínio (o muro fecha a rua).`);
    const pre = ar.indice === 0 ? "" : `a${ar.indice + 1}-`;
    unicos.forEach((c, i) => lista.push({ id: `${pre}${i === 0 ? "auto-1" : `acesso-${i + 1}`}`, posicao: r2(paraSalvo(a, c.u)), largura: r2(c.largura), tipo: "veiculos", ...(ar.indice ? { area: ar.indice } : {}) }));
  }
  if (lista.length > 20) notas.push(`Há ${lista.length} ruas na divisa; só cabem 20 portões editados na lista.`);
  return { portoes: lista, candidatos: lista, notas };
}

const comprimentoDe = (pts: Ponto[]) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);
function densificar(pts: Ponto[], passo: number): Ponto[] {
  const out: Ponto[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const n = Math.max(1, Math.ceil(dist(pts[i], pts[i + 1]) / passo));
    for (let k = 0; k < n; k++) out.push(lerp(pts[i], pts[i + 1], k / n));
  }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Portões que valem: os da lista quando a pessoa os editou; senão os automáticos. `principais`: a portaria de cada
 * área (o primeiro portão de veículos da área); os demais são secundários.
 */
export function portoesDoMuro(imp: Implantacao, muro: Muro, sv?: SistemaViario): { portoes: PortaoMuro[]; notas: string[]; principais: Set<string> } {
  const { portoes, notas } = muro.portoesEditados ? { portoes: muro.portoes, notas: [] as string[] } : portoesAutomaticos(imp, muro, sv);
  const principais = new Set<string>(), vistas = new Set<number>();
  for (const p of portoes) if (p.tipo === "veiculos" && !vistas.has(p.area ?? 0)) { vistas.add(p.area ?? 0); principais.add(p.id); }
  return { portoes, notas, principais };
}

// ── Malha ──

type Acumulador = { pos: number[]; nor: number[]; uv: number[]; tom: number[]; idx: number[] };
const acumulador = (): Acumulador => ({ pos: [], nor: [], uv: [], tom: [], idx: [] });
/** Tom do pé da parede (0–1): escurece perto do chão, como a sombra de contato e a sujeira de respingo. */
const TOM_PE = 0.7;
const PE: [number, number, number, number] = [TOM_PE, TOM_PE, 1, 1];
type V3 = [number, number, number];

/** Quadrilátero a-b-c-d com a face voltada para `fora` (vetor 3D aproximado). */
function quad(acc: Acumulador, v: [V3, V3, V3, V3], uv: [number, number][], fora: V3, tons: [number, number, number, number] = [1, 1, 1, 1]) {
  // Normal pelos dois triângulos somados: vale também quando dois cantos coincidem (o quadrilátero vira triângulo).
  const [a, b, c, d] = v;
  const x = (p: V3, q: V3): V3 => { const e1 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], e2 = [q[0] - a[0], q[1] - a[1], q[2] - a[2]]; return [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; };
  const t1 = x(b, c), t2 = x(c, d);
  let n: V3 = [t1[0] + t2[0], t1[1] + t2[1], t1[2] + t2[2]];
  const l = Math.hypot(...n);
  if (l < 1e-10) return;
  n = [n[0] / l, n[1] / l, n[2] / l];
  // Sentido anti-horário visto de fora (face da frente no three.js).
  const virar = n[0] * fora[0] + n[1] * fora[1] + n[2] * fora[2] < 0;
  if (virar) n = [-n[0], -n[1], -n[2]];
  const base = acc.pos.length / 3;
  for (let i = 0; i < 4; i++) { acc.pos.push(...v[i]); acc.nor.push(...n); acc.uv.push(...uv[i]); acc.tom.push(tons[i]); }
  if (virar) acc.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  else acc.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** Caixa (sem o fundo) centrada em `c`, comprida ao longo de `dir`, de h0 a h1. */
function caixa(acc: Acumulador, c: Ponto, dir: Ponto, comp: number, larg: number, h0: number, h1: number, pe = false) {
  const n = { x: -dir.y, y: dir.x }, L = esc(dir, comp / 2), W = esc(n, larg / 2);
  const P = [soma(soma(c, L), W), soma(sub(c, L), W), sub(sub(c, L), W), sub(soma(c, L), W)];
  const v = (p: Ponto, h: number): V3 => [p.x, h, p.y], alt = h1 - h0;
  for (let i = 0; i < 4; i++) {
    const p = P[i], q = P[(i + 1) % 4], meio = esc(soma(p, q), 0.5), fora = sub(meio, c), lado = dist(p, q);
    quad(acc, [v(p, h0), v(q, h0), v(q, h1), v(p, h1)], [[0, 0], [lado, 0], [lado, alt], [0, alt]], [fora.x, 0, fora.y], pe ? PE : undefined);
  }
  quad(acc, [v(P[0], h1), v(P[1], h1), v(P[2], h1), v(P[3], h1)], [[0, 0], [comp, 0], [comp, larg], [0, larg]], [0, 1, 0]);
}

/** Folha do portão (gradil): quadro e barras verticais, numa linha reta de p1 a p2. */
function folha(acc: Acumulador, p1: Ponto, p2: Ponto, h0: number, altura: number) {
  const comp = dist(p1, p2);
  if (comp < 0.5) return;
  const dir = unit(sub(p2, p1)), meio = lerp(p1, p2, 0.5), perfil = 0.06, barra = 0.025;
  caixa(acc, meio, dir, comp, perfil, h0, h0 + perfil);                       // travessa de baixo
  caixa(acc, meio, dir, comp, perfil, h0 + altura - perfil, h0 + altura);     // travessa de cima
  caixa(acc, meio, dir, comp, perfil, h0 + altura / 2 - perfil / 2, h0 + altura / 2 + perfil / 2);
  for (const t of [perfil / 2 / comp, 1 - perfil / 2 / comp]) caixa(acc, lerp(p1, p2, t), dir, perfil, perfil, h0, h0 + altura);
  const n = Math.max(1, Math.floor(comp / 0.13));
  for (let i = 1; i < n; i++) caixa(acc, lerp(p1, p2, i / n), dir, barra, barra, h0 + perfil, h0 + altura - perfil);
}

function fechar(acc: Acumulador): MalhaMuro | undefined {
  if (!acc.pos.length) return undefined;
  return { posicoes: new Float32Array(acc.pos), normais: new Float32Array(acc.nor), uvs: new Float32Array(acc.uv), tons: new Float32Array(acc.tom), indices: new Uint32Array(acc.idx) };
}

/** Índice de faixas horizontais do contorno: ponto-no-polígono (par-ímpar) só com os lados da faixa do ponto. */
function indiceDoContorno(pol: Ponto[]) {
  const n = pol.length;
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pol) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const nf = Math.max(1, Math.min(4096, n)), h = (y1 - y0) / nf || 1;
  const faixa = (y: number) => Math.min(nf - 1, Math.max(0, Math.floor((y - y0) / h)));
  const faixas: number[][] = Array.from({ length: nf }, () => []);
  for (let i = 0; i < n; i++) { const a = pol[i], b = pol[(i + 1) % n]; for (let f = faixa(Math.min(a.y, b.y)); f <= faixa(Math.max(a.y, b.y)); f++) faixas[f].push(i); }
  return {
    dentro(p: Ponto): boolean {
      if (p.y < y0 || p.y > y1) return false;
      let d = false;
      for (const i of faixas[faixa(p.y)]) {
        const a = pol[(i + 1) % n], b = pol[i];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) d = !d;
      }
      return d;
    },
    maisPerto(p: Ponto): Ponto {
      let m = Infinity, q = p;
      for (let i = 0; i < n; i++) {
        const a = pol[i], ab = sub(pol[(i + 1) % n], a), t = Math.max(0, Math.min(1, pe(sub(p, a), ab) / (pe(ab, ab) || 1))), x = soma(a, esc(ab, t)), d = dist(p, x);
        if (d < m) { m = d; q = x; }
      }
      return q;
    },
  };
}

/**
 * Nenhum vértice do muro fora do terreno: em contorno hostil (ponta de agulha, faixa mais estreita que o muro,
 * contorno que encosta nele mesmo, serrilhado) o deslocamento para dentro pode passar do outro lado da divisa. O
 * vértice que sai é trazido para o ponto da divisa mais perto (o muro afina ali, em vez de invadir o vizinho).
 */
function prenderNoContorno(acc: Acumulador, desde: number, contorno: Ponto[]): number {
  const idx = indiceDoContorno(contorno);
  let presos = 0;
  for (let i = desde; i < acc.pos.length / 3; i++) {
    const p = { x: acc.pos[i * 3], y: acc.pos[i * 3 + 2] };
    if (idx.dentro(p)) continue;
    const q = idx.maisPerto(p);
    if (dist(p, q) < 1e-4) continue;
    acc.pos[i * 3] = q.x; acc.pos[i * 3 + 2] = q.y; presos++;
  }
  return presos;
}

/**
 * Parâmetros t ∈ (0, 1) da aresta k (linha deslocada δ) em que ela cruza uma aresta da malha triangulada do terreno
 * (linhas da grade e diagonais, como em alturaNaMalha). Com uma estação em cada cruzamento, o pé do muro, que é
 * reto entre estações, segue a malha sem fresta.
 */
function cruzamentosComAMalha(a: Anel, k: number, delta: number, caixa: CaixaTerreno, lado = LADO_MALHA): number[] {
  const l = linhaDaAresta(a, k, delta), out: number[] = [];
  const fi = (s: number) => ((l.A.x + l.ab.x * s - caixa.x0) / caixa.largura) * lado, fj = (s: number) => ((l.A.y + l.ab.y * s - caixa.z0) / caixa.comprimento) * lado;
  for (const f of [fi, fj, (s: number) => fi(s) + fj(s)]) {
    const f0 = f(0), f1 = f(1);
    if (Math.abs(f1 - f0) < 1e-9) continue;
    const lo = Math.ceil(Math.min(f0, f1)), hi = Math.floor(Math.max(f0, f1));
    for (let m = lo; m <= hi && out.length < 4 * lado; m++) {
      const sLinha = (m - f0) / (f1 - f0), t = (sLinha - l.t0) / (l.t1 - l.t0 || 1);
      if (t > 1e-6 && t < 1 - 1e-6) out.push(t);
    }
  }
  return out;
}

/**
 * Muro inteiro da implantação: um muro em CADA área do terreno (KML com várias áreas separadas), cada um com os
 * seus portões. `altura` (opcional) é a cota do chão em planta; por padrão, a mesma malha do terreno do
 * visualizador. Devolve nulo quando nenhuma área tem contorno que sirva (não se inventa divisa).
 */
export function geometriaDoMuro(imp: Implantacao, muro: Muro, opcoes: { altura?: (x: number, y: number) => number; sistema?: SistemaViario } = {}): GeometriaMuro | null {
  const areas = areasDoMuro(imp);
  if (!areas.length) return null;
  const caixaT = caixaDoTerreno(imp);
  const chao = opcoes.altura ?? ((x: number, y: number) => alturaNaMalha(imp.relevo, caixaT, x, y));
  const H = muro.altura, esp = muro.espessura;
  const dExt = FOLGA_DIVISA + muro.recuo, dInt = dExt + esp, dEixo = deltaEixo(muro);
  const dCapaExt = Math.max(FOLGA_DIVISA, dExt - SOBRA_CAPA), dCapaInt = dInt + SOBRA_CAPA;
  const { portoes, notas, principais } = portoesDoMuro(imp, muro, opcoes.sistema);
  const acc: Record<MaterialMuro, Acumulador> = { muro: acumulador(), capa: acumulador(), portao: acumulador() };
  const v = (p: Ponto, h: number): V3 => [p.x, h, p.y];
  const trechos: Ponto[][] = [], resumoAberturas: AberturaMuro[] = [], porArea: ResumoMuro["areas"] = [];
  let perimetroTotal = 0, comprimentoTotal = 0, presos = 0;
  const existentes = new Set(areas.map(ar => ar.indice));
  for (const p of portoes) if (!existentes.has(p.area ?? 0)) notas.push(`O portão ${p.id} está numa área que não existe mais no contorno: não foi aberto.`);

  for (const ar of areas) {
    const a = ar.anel;
    const inicio = { muro: acc.muro.pos.length / 3, capa: acc.capa.pos.length / 3, portao: acc.portao.pos.length / 3 };
    const daArea = portoes.filter(p => (p.area ?? 0) === ar.indice);
    // Aberturas em `u` (sentido interno), já com a volta pelo vértice 1 tratada e as sobrepostas juntas.
    const brutos: [number, number][] = [];
    for (const p of daArea) {
      const c = paraInterno(a, p.posicao), w = Math.min(p.largura, a.total * 0.9) / 2;
      const i0 = c - w, i1 = c + w;
      if (i0 < 0) { brutos.push([i0 + a.total, a.total], [0, i1]); } else if (i1 > a.total) { brutos.push([i0, a.total], [0, i1 - a.total]); } else brutos.push([i0, i1]);
    }
    brutos.sort((x, y) => x[0] - y[0]);
    const aberturas: [number, number][] = [];
    for (const b of brutos) { const u = aberturas[aberturas.length - 1]; if (u && b[0] <= u[1]) u[1] = Math.max(u[1], b[1]); else aberturas.push([...b]); }
    const aberto = (u: number) => { const uu = modulo(u, a.total); return aberturas.some(([x, y]) => uu > x && uu < y); };

    const trechosDaArea: Ponto[][] = [];
    let atual: Ponto[] | null = null, comprimento = 0;
    const n = a.pts.length;
    type Estacao = { u: number; E: Ponto; I: Ponto; C: Ponto; CE: Ponto; CI: Ponto; gE: number; gI: number; topo: number };
    const estacao = (k: number, t: number, u: number): Estacao => {
      const em = (d: number) => naLinha(a, k, t, d);
      const E = em(dExt), I = em(dInt), C = em(dEixo);
      return { u, E, I, C, CE: em(dCapaExt), CI: em(dCapaInt), gE: chao(E.x, E.y), gI: chao(I.x, I.y), topo: chao(C.x, C.y) + H };
    };
    const tampa = (s: Estacao, fora: Ponto) => {
      const f: V3 = [fora.x, 0, fora.y];
      quad(acc.muro, [v(s.E, s.gE - ENTERRO_MURO), v(s.I, s.gI - ENTERRO_MURO), v(s.I, s.topo), v(s.E, s.topo)], [[0, 0], [esp, 0], [esp, H], [0, H]], f, PE);
      quad(acc.capa, [v(s.CE, s.topo), v(s.CI, s.topo), v(s.CI, s.topo + ALTURA_CAPA), v(s.CE, s.topo + ALTURA_CAPA)], [[0, 0], [1, 0], [1, 0.1], [0, 0.1]], f);
    };

    for (let k = 0; k < n; k++) {
      const u0 = a.u[k], u1 = k === n - 1 ? a.total : a.u[k + 1], L = u1 - u0;
      if (L < 1e-6) continue;
      const dir = unit(sub(a.pts[(k + 1) % n], a.pts[k])), dentro = { x: -dir.y, y: dir.x };
      // Estações: as pontas da aresta, a cada PASSO_MURO, nas bordas dos portões e (com relevo) nos cruzamentos
      // das faces com as arestas da malha do terreno.
      const us = new Set<number>([u0, u1]);
      const passos = Math.ceil(L / PASSO_MURO);
      for (let i = 1; i < passos; i++) us.add(u0 + (L * i) / passos);
      for (const [x, y] of aberturas) for (const b of [x, y]) if (b > u0 + 1e-6 && b < u1 - 1e-6) us.add(b);
      if (imp.relevo) for (const d of [dExt, dInt]) for (const t of cruzamentosComAMalha(a, k, d, caixaT)) us.add(u0 + t * L);
      const lista = Array.from(us).sort((x, y) => x - y);
      let anterior = estacao(k, 0, u0);
      for (let i = 1; i < lista.length; i++) {
        const ub = lista[i];
        if (ub - anterior.u < 1e-6) continue;
        const s0 = anterior, s1 = estacao(k, (ub - u0) / L, ub);
        anterior = s1;
        const meio = (s0.u + s1.u) / 2;
        if (aberto(meio)) { if (atual) { trechosDaArea.push(atual); atual = null; } continue; }
        const fora: V3 = [-dentro.x, 0, -dentro.y], parDentro: V3 = [dentro.x, 0, dentro.y];
        // Faces externa e interna (do pé enterrado ao topo), capa por cima.
        quad(acc.muro, [v(s0.E, s0.gE - ENTERRO_MURO), v(s1.E, s1.gE - ENTERRO_MURO), v(s1.E, s1.topo), v(s0.E, s0.topo)], [[s0.u, s0.gE - ENTERRO_MURO - s0.topo + H], [s1.u, s1.gE - ENTERRO_MURO - s1.topo + H], [s1.u, H], [s0.u, H]], fora, PE);
        quad(acc.muro, [v(s0.I, s0.gI - ENTERRO_MURO), v(s1.I, s1.gI - ENTERRO_MURO), v(s1.I, s1.topo), v(s0.I, s0.topo)], [[s0.u, s0.gI - ENTERRO_MURO - s0.topo + H], [s1.u, s1.gI - ENTERRO_MURO - s1.topo + H], [s1.u, H], [s0.u, H]], parDentro, PE);
        const c0 = s0.topo + ALTURA_CAPA, c1 = s1.topo + ALTURA_CAPA;
        quad(acc.capa, [v(s0.CE, c0), v(s1.CE, c1), v(s1.CI, c1), v(s0.CI, c0)], [[s0.u, 0], [s1.u, 0], [s1.u, esp], [s0.u, esp]], [0, 1, 0]);
        quad(acc.capa, [v(s0.CE, s0.topo), v(s1.CE, s1.topo), v(s1.CE, c1), v(s0.CE, c0)], [[s0.u, 0], [s1.u, 0], [s1.u, 0.06], [s0.u, 0.06]], fora);
        quad(acc.capa, [v(s0.CI, s0.topo), v(s1.CI, s1.topo), v(s1.CI, c1), v(s0.CI, c0)], [[s0.u, 0], [s1.u, 0], [s1.u, 0.06], [s0.u, 0.06]], parDentro);
        if (aberto(s0.u - 1e-4)) tampa(s0, esc(dir, -1));
        if (aberto(s1.u + 1e-4)) tampa(s1, dir);
        comprimento += dist(s0.C, s1.C);
        if (!atual) atual = [s0.C];
        atual.push(s1.C);
      }
    }
    if (atual) trechosDaArea.push(atual);
    // O trecho que passa pelo vértice 1 sai partido em dois: emenda.
    if (trechosDaArea.length > 1 && !aberto(0) && !aberto(a.total - 1e-4) && !aberturas.some(([x, y]) => x <= 1e-6 || y >= a.total - 1e-6)) {
      const ultimo = trechosDaArea.pop()!;
      trechosDaArea[0] = [...ultimo, ...trechosDaArea[0].slice(1)];
    }
    trechos.push(...trechosDaArea);

    // Pilastras na face interna, a cada ESPACO_PILASTRA, longe dos portões.
    const nPil = Math.floor(a.total / ESPACO_PILASTRA);
    for (let i = 0; i < nPil; i++) {
      const u = (i + 0.5) * ESPACO_PILASTRA;
      if (aberturas.some(([x, y]) => u > x - 1 && u < y + 1) || aberto(u)) continue;
      const dir = direcaoEm(a, u), dentro = { x: -dir.y, y: dir.x };
      const c = soma(pontoEm(a, dInt, u), esc(dentro, SALIENCIA_PILASTRA / 2 - 0.01));
      const g = chao(c.x, c.y), topo = chao(pontoEm(a, dEixo, u).x, pontoEm(a, dEixo, u).y) + H;
      caixa(acc.muro, c, dir, LARGURA_PILASTRA, SALIENCIA_PILASTRA + 0.02, g - ENTERRO_MURO, topo, true);
    }

    // Pilares e folhas dos portões.
    const ladoPilar = esp + 0.18;
    for (const p of daArea) {
      const c = paraInterno(a, p.posicao), w = Math.min(p.largura, a.total * 0.9);
      resumoAberturas.push({ id: p.id, tipo: p.tipo, posicao: r2(p.posicao), largura: r2(w), principal: principais.has(p.id), area: ar.indice });
      const pilares = [c - w / 2 - PILAR_PORTAO / 2, c + w / 2 + PILAR_PORTAO / 2];
      for (const u of pilares) {
        // O pilar é mais grosso que o muro só para dentro: a face de fora fica alinhada com a do muro (nunca passa da divisa).
        const cc = pontoEm(a, dExt + ladoPilar / 2, u), dir = direcaoEm(a, u), g = chao(cc.x, cc.y);
        caixa(acc.muro, cc, dir, PILAR_PORTAO, ladoPilar, g - ENTERRO_MURO, g + H + SOBE_PILAR, true);
        caixa(acc.capa, pontoEm(a, dCapaExt + (ladoPilar + 0.06) / 2, u), dir, PILAR_PORTAO + 0.06, ladoPilar + 0.06, g + H + SOBE_PILAR, g + H + SOBE_PILAR + ALTURA_CAPA);
      }
      const alturaFolha = Math.min(H - 0.1, p.tipo === "pedestres" ? 2.1 : 2.4);
      if (p.tipo === "pedestres") {
        // Portão de pedestres fechado, entre os pilares.
        const p1 = pontoEm(a, dEixo, c - w / 2), p2 = pontoEm(a, dEixo, c + w / 2);
        folha(acc.portao, p1, p2, Math.max(chao(p1.x, p1.y), chao(p2.x, p2.y)) + 0.03, alturaFolha);
      } else {
        // Portão de veículos de correr, aberto: estacionado por dentro, junto do muro, para a rua ficar livre.
        const dFolha = dInt + 0.14;
        for (const lado of [1, -1]) {
          const ini = lado === 1 ? c + w / 2 + PILAR_PORTAO : c - w / 2 - PILAR_PORTAO, fimF = ini + lado * w;
          const livre = Array.from({ length: 11 }, (_, i) => ini + ((fimF - ini) * i) / 10).every(u => !aberto(u));
          if (!livre || w > a.total / 3) continue;
          const p1 = pontoEm(a, dFolha, ini), p2 = pontoEm(a, dFolha, fimF);
          folha(acc.portao, p1, p2, Math.max(chao(p1.x, p1.y), chao(p2.x, p2.y)) + 0.03, alturaFolha);
          break;
        }
      }
    }
    // Contorno hostil: nada desta área sai do terreno.
    const limpo = ar.contorno.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    for (const k of Object.keys(acc) as MaterialMuro[]) presos += prenderNoContorno(acc[k], inicio[k], limpo);
    perimetroTotal += a.total; comprimentoTotal += comprimento;
    porArea.push({ indice: ar.indice, perimetro: r2(a.total), comprimento: r2(comprimento) });
  }
  if (presos > 0) notas.push("O contorno do terreno tem trechos mais estreitos que o muro ou pontas muito finas: ali o muro foi afinado para não passar da divisa. Confira o contorno.");

  const malhas: Partial<Record<MaterialMuro, MalhaMuro>> = {};
  let vertices = 0;
  for (const k of Object.keys(acc) as MaterialMuro[]) { const m = fechar(acc[k]); if (m) { malhas[k] = m; vertices += m.posicoes.length / 3; } }
  return {
    malhas, trechos,
    resumo: { perimetro: r2(perimetroTotal), comprimento: r2(comprimentoTotal), areas: porArea, altura: H, espessura: esp, recuo: muro.recuo, aberturas: resumoAberturas, notas, vertices },
  };
}
