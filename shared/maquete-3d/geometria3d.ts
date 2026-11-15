// Maquete 3D (EPIC-022, etapa 2) — geometria pura que o visualizador usa: paredes recortadas pelas aberturas,
// colisão, altura do piso (escadas e rampas), em que cômodo se está, cobertura e o roteiro do tour.
// Convenção 3D: X = x da planta, Z = y da planta, Y = altura. Tudo em metros. Sem dependência de three.js,
// para poder ser testado no servidor.
import { fracaoDaSubida, trechosDaEscada } from "./escadas.js";
import {
  areaPoligono, centroide, comprimento, limites, type Abertura, type Comodo, type Edificacao, type Escada, type Parede,
  type Pavimento, type Ponto,
} from "./modelo.js";

export type Seg = { a: Ponto; b: Ponto };

/** Bloco reto de parede: um trecho ao longo do eixo, de `base` até `base + altura`. */
export type BlocoParede = { a: Ponto; b: Ponto; base: number; altura: number; espessura: number; externa: boolean };

const EPS = 1e-6;

export function pontoNaParede(w: Parede, distancia: number): Ponto {
  const c = comprimento(w) || 1;
  return { x: w.a.x + ((w.b.x - w.a.x) * distancia) / c, y: w.a.y + ((w.b.y - w.a.y) * distancia) / c };
}

/** Aberturas de uma parede, ordenadas e limitadas ao comprimento dela. */
export function vaosDaParede(w: Parede, aberturas: Abertura[]) {
  const c = comprimento(w);
  return aberturas.filter(a => a.paredeId === w.id)
    .map(a => ({ abertura: a, de: Math.max(0, a.posicao - a.largura / 2), ate: Math.min(c, a.posicao + a.largura / 2) }))
    .filter(v => v.ate - v.de > 0.05)
    .sort((p, q) => p.de - q.de);
}

/** Parede em blocos: cheia entre as aberturas; peitoril embaixo e verga em cima de cada abertura. */
export function blocosDaParede(w: Parede, aberturas: Abertura[], peDireito: number): BlocoParede[] {
  const c = comprimento(w);
  if (c < 0.05) return [];
  const blocos: BlocoParede[] = [];
  const bloco = (de: number, ate: number, base: number, altura: number) => {
    if (ate - de > 0.01 && altura > 0.01) blocos.push({ a: pontoNaParede(w, de), b: pontoNaParede(w, ate), base, altura, espessura: w.espessura, externa: w.externa });
  };
  let cursor = 0;
  for (const v of vaosDaParede(w, aberturas)) {
    const de = Math.max(v.de, cursor);
    bloco(cursor, de, 0, peDireito);
    const topo = Math.min(peDireito, v.abertura.peitoril + v.abertura.altura);
    bloco(de, v.ate, 0, Math.min(v.abertura.peitoril, peDireito));
    bloco(de, v.ate, topo, peDireito - topo);
    cursor = Math.max(cursor, v.ate);
  }
  bloco(cursor, c, 0, peDireito);
  return blocos;
}

/** Por onde se passa andando: portas, portas-janela e vãos. Janela não. */
export const passavel = (a: Abertura) => a.tipo !== "janela";

/** Trechos de parede que barram a caminhada (a parede menos as passagens). */
export function segmentosDeColisao(pv: Pavimento): Seg[] {
  const segs: Seg[] = [];
  for (const w of pv.paredes) {
    const c = comprimento(w);
    if (c < 0.05) continue;
    let cursor = 0;
    for (const v of vaosDaParede(w, pv.aberturas.filter(passavel))) {
      if (v.de - cursor > 0.02) segs.push({ a: pontoNaParede(w, cursor), b: pontoNaParede(w, v.de) });
      cursor = Math.max(cursor, v.ate);
    }
    if (c - cursor > 0.02) segs.push({ a: pontoNaParede(w, cursor), b: pontoNaParede(w, c) });
  }
  return segs;
}

function maisProximoNoSegmento(p: Ponto, s: Seg): Ponto {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, l2 = dx * dx + dy * dy;
  const t = l2 < EPS ? 0 : Math.min(1, Math.max(0, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / l2));
  return { x: s.a.x + dx * t, y: s.a.y + dy * t };
}

/** Empurra o visitante (círculo de raio `raio`) para fora das paredes. Duas passadas resolvem os cantos. */
export function resolverColisao(pos: Ponto, raio: number, segs: Seg[]): Ponto {
  let p = { ...pos };
  for (let passada = 0; passada < 2; passada++) {
    for (const s of segs) {
      const q = maisProximoNoSegmento(p, s);
      const dx = p.x - q.x, dy = p.y - q.y, d = Math.hypot(dx, dy);
      if (d >= raio) continue;
      if (d < EPS) { // em cima da parede: sai pela normal
        const n = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) || 1;
        p = { x: p.x - ((s.b.y - s.a.y) / n) * raio, y: p.y + ((s.b.x - s.a.x) / n) * raio };
      } else p = { x: q.x + (dx / d) * raio, y: q.y + (dy / d) * raio };
    }
  }
  return p;
}

/** O segmento p→q cruza alguma parede? (usado para não atravessar parede fina em passo largo) */
export function cruzaParede(p: Ponto, q: Ponto, segs: Seg[]): boolean {
  const lado = (a: Ponto, b: Ponto, c: Ponto) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return segs.some(s => lado(p, q, s.a) * lado(p, q, s.b) < 0 && lado(s.a, s.b, p) * lado(s.a, s.b, q) < 0);
}

export function dentroDoPoligono(p: Ponto, pts: Ponto[]): boolean {
  let dentro = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

/** Cômodo em que o ponto está (o menor, se houver sobreposição). */
export function comodoEm(pv: Pavimento, p: Ponto): Comodo | null {
  const dentro = pv.comodos.filter(c => c.poligono.length >= 3 && dentroDoPoligono(p, c.poligono));
  return dentro.sort((a, b) => areaPoligono(a.poligono) - areaPoligono(b.poligono))[0] ?? null;
}

/** Ponto garantidamente dentro do cômodo (o centroide pode cair fora em cômodo em L). */
export function pontoInterno(pts: Ponto[]): Ponto {
  const c = centroide(pts);
  if (dentroDoPoligono(c, pts)) return c;
  const l = limites(pts);
  let melhor = c, melhorD = Infinity;
  for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
    const p = { x: l.minX + (l.largura * i) / 12, y: l.minY + (l.altura * j) / 12 };
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d < melhorD && dentroDoPoligono(p, pts)) { melhor = p; melhorD = d; }
  }
  return melhor;
}

// ── Níveis e escadas ──

export const pavimentosOrdenados = (e: Edificacao) => [...e.pavimentos].sort((a, b) => a.nivel - b.nivel);
/** Altura total ocupada pelo pavimento, contando as repetições do pavimento-tipo. */
export const alturaDoPavimento = (p: Pavimento, laje = ESPESSURA_LAJE) => (p.peDireito + laje) * p.repeticoes;
export const ESPESSURA_LAJE = 0.15;
export const topoDaEdificacao = (e: Edificacao) => Math.max(0, ...e.pavimentos.map(p => p.nivel + alturaDoPavimento(p)));

/** Fração da subida (0 na partida, 1 na chegada) para um ponto em planta, seguindo a forma real da escada. */
export const progressoNaEscada = (s: Escada, p: Ponto): number => fracaoDaSubida(s, p);

export type Apoio = { pavimentoId: string; y: number; naEscada: boolean };

/**
 * Onde o visitante pisa: dado o pavimento em que está e a posição em planta, devolve a altura do piso e o
 * pavimento em que ele passa a estar. Sobe pela escada do pavimento atual e desce pela escada do de baixo.
 */
export function apoio(e: Edificacao, pavimentoId: string, p: Ponto): Apoio {
  const atual = e.pavimentos.find(x => x.id === pavimentoId) ?? pavimentosOrdenados(e)[0];
  if (!atual) return { pavimentoId, y: 0, naEscada: false };
  for (const s of atual.escadas) {
    const destino = e.pavimentos.find(x => x.id === s.destinoPavimentoId);
    if (!destino || s.poligono.length < 3 || !dentroDoPoligono(p, s.poligono)) continue;
    const t = progressoNaEscada(s, p);
    return { pavimentoId: t >= 0.98 ? destino.id : atual.id, y: atual.nivel + (destino.nivel - atual.nivel) * t, naEscada: true };
  }
  for (const abaixo of e.pavimentos) for (const s of abaixo.escadas) {
    if (s.destinoPavimentoId !== atual.id || s.poligono.length < 3 || !dentroDoPoligono(p, s.poligono)) continue;
    const t = progressoNaEscada(s, p);
    return { pavimentoId: t <= 0.02 ? abaixo.id : atual.id, y: abaixo.nivel + (atual.nivel - abaixo.nivel) * t, naEscada: true };
  }
  return { pavimentoId: atual.id, y: atual.nivel, naEscada: false };
}

/** Furos na laje de um pavimento: as escadas que chegam nele vindas de baixo. */
export function furosDaLaje(e: Edificacao, pv: Pavimento): Ponto[][] {
  return e.pavimentos.flatMap(p => p.escadas.filter(s => s.destinoPavimentoId === pv.id && s.poligono.length >= 3).map(s => s.poligono));
}

// ── Contorno e cobertura ──

/** Envoltória convexa (cadeia monótona). Usada para a laje e para o beiral. */
export function envoltoria(pts: Ponto[]): Ponto[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const giro = (o: Ponto, a: Ponto, b: Ponto) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const metade = (lista: Ponto[]) => {
    const h: Ponto[] = [];
    for (const q of lista) { while (h.length >= 2 && giro(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); }
    h.pop();
    return h;
  };
  return [...metade(p), ...metade([...p].reverse())];
}

/** Contorno da construção em um pavimento: pelas paredes externas (ou por tudo, se nenhuma foi marcada). */
export function contornoDoPavimento(pv: Pavimento): Ponto[] {
  const externas = pv.paredes.filter(w => w.externa);
  const pts = (externas.length >= 3 ? externas : pv.paredes).flatMap(w => [w.a, w.b]);
  return envoltoria(pts.length >= 3 ? pts : pv.comodos.flatMap(c => c.poligono));
}

export type Telhado = {
  /** Triângulos (x, y, z) em sequência, já na altura final. */
  triangulos: number[];
  /** Altura da cumeeira acima do topo das paredes. */
  altura: number;
  plano: boolean;
};

/**
 * Cobertura sobre o retângulo que envolve o último pavimento, com beiral. Duas e quatro águas com a cumeeira no
 * sentido do lado maior; uma água caindo no sentido do lado menor; laje e platibanda planas.
 */
export function telhado(e: Edificacao): Telhado | null {
  const ultimo = pavimentosOrdenados(e).at(-1);
  if (!ultimo) return null;
  const l = limites(contornoDoPavimento(ultimo));
  if (l.largura < 0.5 || l.altura < 0.5) return null;
  const y0 = ultimo.nivel + alturaDoPavimento(ultimo);
  const { tipo, inclinacao } = e.cobertura;
  const plano = tipo === "laje" || tipo === "platibanda";
  const b = plano ? 0 : e.cobertura.beiral;
  const x0 = l.minX - b, x1 = l.maxX + b, z0 = l.minY - b, z1 = l.maxY + b;
  const t: number[] = [];
  const tri = (...v: number[]) => t.push(...v);
  const quad = (a: number[], bb: number[], c: number[], d: number[]) => { tri(...a, ...bb, ...c); tri(...a, ...c, ...d); };
  if (plano) {
    quad([x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]);
    return { triangulos: t, altura: 0, plano: true };
  }
  const aoLongoDeX = x1 - x0 >= z1 - z0; // cumeeira no sentido do lado maior
  const vao = aoLongoDeX ? z1 - z0 : x1 - x0;
  const k = inclinacao / 100;
  if (tipo === "uma_agua") {
    const h = vao * k;
    if (aoLongoDeX) quad([x0, y0, z1], [x1, y0, z1], [x1, y0 + h, z0], [x0, y0 + h, z0]);
    else quad([x1, y0, z0], [x1, y0, z1], [x0, y0 + h, z1], [x0, y0 + h, z0]);
    return { triangulos: t, altura: h, plano: false };
  }
  const h = (vao / 2) * k, yc = y0 + h;
  if (aoLongoDeX) {
    const zc = (z0 + z1) / 2, recuo = tipo === "quatro_aguas" ? Math.min((x1 - x0) / 2, vao / 2) : 0;
    const c0 = [x0 + recuo, yc, zc], c1 = [x1 - recuo, yc, zc];
    quad([x0, y0, z1], [x1, y0, z1], c1, c0);
    quad([x1, y0, z0], [x0, y0, z0], c0, c1);
    tri(x0, y0, z0, x0, y0, z1, ...c0);
    tri(x1, y0, z1, x1, y0, z0, ...c1);
  } else {
    const xc = (x0 + x1) / 2, recuo = tipo === "quatro_aguas" ? Math.min((z1 - z0) / 2, vao / 2) : 0;
    const c0 = [xc, yc, z0 + recuo], c1 = [xc, yc, z1 - recuo];
    quad([x0, y0, z0], [x0, y0, z1], c1, c0);
    quad([x1, y0, z1], [x1, y0, z0], c0, c1);
    tri(x1, y0, z0, x0, y0, z0, ...c0);
    tri(x0, y0, z1, x1, y0, z1, ...c1);
  }
  return { triangulos: t, altura: h, plano: false };
}

// ── Entrada e roteiro do tour ──

export type Entrada = { pavimentoId: string; fora: Ponto; dentro: Ponto; abertura: Abertura | null };

/** Dois pontos a `d` metros de cada lado do centro de uma abertura. */
export function ladosDaAbertura(w: Parede, a: Abertura, d: number): [Ponto, Ponto] {
  const c = comprimento(w) || 1, m = pontoNaParede(w, a.posicao);
  const nx = -(w.b.y - w.a.y) / c, ny = (w.b.x - w.a.x) / c;
  return [{ x: m.x + nx * d, y: m.y + ny * d }, { x: m.x - nx * d, y: m.y - ny * d }];
}

/** Porta de entrada: a marcada como principal; senão, a primeira porta em parede externa; senão, o maior cômodo. */
export function entrada(e: Edificacao): Entrada | null {
  const pvs = pavimentosOrdenados(e);
  const candidatas = pvs.flatMap(pv => pv.aberturas.filter(passavel).map(a => ({ pv, a, w: pv.paredes.find(w => w.id === a.paredeId) })))
    .filter((c): c is { pv: Pavimento; a: Abertura; w: Parede } => !!c.w);
  const escolhida = candidatas.find(c => c.a.entradaPrincipal) ?? candidatas.find(c => c.w.externa && c.pv.id === pvs[0]?.id);
  if (escolhida) {
    const [p, q] = ladosDaAbertura(escolhida.w, escolhida.a, 0.9);
    const pDentro = !!comodoEm(escolhida.pv, p), qDentro = !!comodoEm(escolhida.pv, q);
    // Dentro é o lado que cai num cômodo; se os dois (ou nenhum) caem, o mais perto do centro da construção.
    const centro = centroide(contornoDoPavimento(escolhida.pv));
    const pMaisPerto = Math.hypot(p.x - centro.x, p.y - centro.y) <= Math.hypot(q.x - centro.x, q.y - centro.y);
    const dentro = pDentro !== qDentro ? (pDentro ? p : q) : pMaisPerto ? p : q;
    return { pavimentoId: escolhida.pv.id, dentro, fora: dentro === p ? q : p, abertura: escolhida.a };
  }
  const pv = pvs[0];
  const maior = pv?.comodos.filter(c => c.poligono.length >= 3).sort((a, b) => areaPoligono(b.poligono) - areaPoligono(a.poligono))[0];
  if (!pv || !maior) return null;
  const p = pontoInterno(maior.poligono);
  return { pavimentoId: pv.id, dentro: p, fora: p, abertura: null };
}

export type ParadaTour = { pavimentoId: string; comodo: Comodo; ponto: Ponto; area: number };

/**
 * Roteiro do tour: começa no cômodo da entrada e segue pelas portas (busca em largura), pavimento por pavimento,
 * de baixo para cima. Cômodo sem ligação encontrada entra no fim do seu pavimento, para nenhum ficar de fora.
 */
export function roteiroTour(e: Edificacao): ParadaTour[] {
  const paradas: ParadaTour[] = [];
  const ent = entrada(e);
  for (const pv of pavimentosOrdenados(e)) {
    const comodos = pv.comodos.filter(c => c.poligono.length >= 3 && c.funcao !== "area_externa");
    if (!comodos.length) continue;
    const vizinhos = new Map<string, Set<string>>(comodos.map(c => [c.id, new Set<string>()]));
    for (const a of pv.aberturas.filter(passavel)) {
      const w = pv.paredes.find(x => x.id === a.paredeId);
      if (!w) continue;
      const [p, q] = ladosDaAbertura(w, a, Math.max(0.35, w.espessura / 2 + 0.25));
      const c1 = comodoEm(pv, p), c2 = comodoEm(pv, q);
      if (c1 && c2 && c1.id !== c2.id && vizinhos.has(c1.id) && vizinhos.has(c2.id)) { vizinhos.get(c1.id)!.add(c2.id); vizinhos.get(c2.id)!.add(c1.id); }
    }
    // Partida: no pavimento da entrada, o cômodo da porta; nos outros, o cômodo onde a escada chega.
    const chegada = e.pavimentos.flatMap(p => p.escadas).find(s => s.destinoPavimentoId === pv.id);
    const partidaEm = ent?.pavimentoId === pv.id ? ent.dentro : chegada?.fim;
    const partida = (partidaEm && comodoEm(pv, partidaEm)) || comodos[0];
    const ordem: string[] = [], fila = [vizinhos.has(partida.id) ? partida.id : comodos[0].id];
    while (fila.length) {
      const id = fila.shift()!;
      if (ordem.includes(id)) continue;
      ordem.push(id);
      fila.push(...Array.from(vizinhos.get(id) ?? []).filter(v => !ordem.includes(v)));
    }
    for (const c of comodos) if (!ordem.includes(c.id)) ordem.push(c.id);
    for (const id of ordem) {
      const c = comodos.find(x => x.id === id)!;
      paradas.push({ pavimentoId: pv.id, comodo: c, ponto: pontoInterno(c.poligono), area: Math.round(areaPoligono(c.poligono) * 100) / 100 });
    }
  }
  return paradas;
}

// ── Rota a pé (o tour anda pelas portas e escadas, sem atravessar parede) ──

/** `y` vem preenchido nos pontos sobre uma escada (altura real do degrau ou do patamar). */
export type PontoRota = { pavimentoId: string; p: Ponto; y?: number };

/**
 * Caminho entre dois pontos da edificação. Grafo: o ponto interno de cada cômodo, os dois lados de cada passagem
 * e a partida/chegada de cada escada. Devolve os pontos a percorrer (inclui origem e destino); se não houver
 * ligação conhecida, vai em linha reta.
 */
export function rota(e: Edificacao, de: PontoRota, para: PontoRota): PontoRota[] {
  type No = PontoRota & { viz: Map<number, number> };
  const nos: No[] = [];
  const novo = (pavimentoId: string, p: Ponto) => nos.push({ pavimentoId, p, viz: new Map() }) - 1;
  const niveis = new Map(e.pavimentos.map(p => [p.id, p.nivel]));
  const ligar = (i: number, j: number) => {
    const a = nos[i], b = nos[j];
    const d = Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y) + Math.abs((niveis.get(a.pavimentoId) ?? 0) - (niveis.get(b.pavimentoId) ?? 0));
    a.viz.set(j, d); b.viz.set(i, d);
  };
  const noDoComodo = new Map<string, number>();
  const comodoDe = (pv: Pavimento, p: Ponto) => { const c = comodoEm(pv, p); return c ? noDoComodo.get(`${pv.id}:${c.id}`) : undefined; };
  for (const pv of e.pavimentos) for (const c of pv.comodos) if (c.poligono.length >= 3) noDoComodo.set(`${pv.id}:${c.id}`, novo(pv.id, pontoInterno(c.poligono)));
  for (const pv of e.pavimentos) {
    for (const a of pv.aberturas.filter(passavel)) {
      const w = pv.paredes.find(x => x.id === a.paredeId);
      if (!w) continue;
      const [p, q] = ladosDaAbertura(w, a, Math.max(0.45, w.espessura / 2 + 0.3));
      const i = novo(pv.id, p), j = novo(pv.id, q);
      ligar(i, j);
      const ci = comodoDe(pv, p), cj = comodoDe(pv, q);
      if (ci !== undefined) ligar(i, ci);
      if (cj !== undefined) ligar(j, cj);
    }
    for (const s of pv.escadas) {
      const destino = e.pavimentos.find(x => x.id === s.destinoPavimentoId);
      if (!destino) continue;
      const i = novo(pv.id, s.inicio), j = novo(destino.id, s.fim);
      ligar(i, j);
      // Ao pé e no topo da escada, liga ao cômodo mais próximo daquele pavimento.
      for (const [no, andar] of [[i, pv], [j, destino]] as const) {
        const perto = andar.comodos.filter(c => c.poligono.length >= 3)
          .map(c => ({ n: noDoComodo.get(`${andar.id}:${c.id}`)!, d: Math.hypot(pontoInterno(c.poligono).x - nos[no].p.x, pontoInterno(c.poligono).y - nos[no].p.y), dentro: dentroDoPoligono(nos[no].p, c.poligono) }))
          .sort((a, b) => Number(b.dentro) - Number(a.dentro) || a.d - b.d)[0];
        if (perto) ligar(no, perto.n);
      }
    }
  }
  const prender = (r: PontoRota) => {
    const i = novo(r.pavimentoId, r.p), pv = e.pavimentos.find(x => x.id === r.pavimentoId);
    const c = pv && comodoDe(pv, r.p);
    if (c !== undefined) ligar(i, c);
    else { // fora de qualquer cômodo: liga ao nó mais próximo do mesmo pavimento
      const perto = nos.map((n, k) => ({ k, d: Math.hypot(n.p.x - r.p.x, n.p.y - r.p.y) })).filter(x => x.k !== i && nos[x.k].pavimentoId === r.pavimentoId).sort((a, b) => a.d - b.d)[0];
      if (perto) ligar(i, perto.k);
    }
    return i;
  };
  const origem = prender(de), destino = prender(para);
  const dist = nos.map(() => Infinity), anterior = nos.map(() => -1), feito = nos.map(() => false);
  dist[origem] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nos.length; i++) if (!feito[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity || u === destino) break;
    feito[u] = true;
    nos[u].viz.forEach((d, v) => { if (dist[u] + d < dist[v]) { dist[v] = dist[u] + d; anterior[v] = u; } });
  }
  if (dist[destino] === Infinity) return [de, para];
  const direto: PontoRota[] = [];
  for (let i = destino; i >= 0; i = anterior[i]) direto.unshift({ pavimentoId: nos[i].pavimentoId, p: nos[i].p });
  // Onde o caminho troca de pavimento, entra a forma real da escada (lances, patamares, caracol).
  const perto = (a: Ponto, b: Ponto) => Math.hypot(a.x - b.x, a.y - b.y) < 0.02;
  const caminho: PontoRota[] = [];
  direto.forEach((ponto, i) => {
    const antes = direto[i - 1];
    if (antes && antes.pavimentoId !== ponto.pavimentoId) {
      for (const pv of e.pavimentos) for (const s of pv.escadas) {
        const sobe = pv.id === antes.pavimentoId && s.destinoPavimentoId === ponto.pavimentoId && perto(s.inicio, antes.p) && perto(s.fim, ponto.p);
        const desce = pv.id === ponto.pavimentoId && s.destinoPavimentoId === antes.pavimentoId && perto(s.fim, antes.p) && perto(s.inicio, ponto.p);
        if (!sobe && !desce) continue;
        const base = niveis.get(pv.id) ?? 0, topo = niveis.get(s.destinoPavimentoId ?? "") ?? base;
        const meio = trechosDaEscada(s).slice(0, -1).map(t => ({ pavimentoId: antes.pavimentoId, p: t.b, y: base + (topo - base) * t.ate }));
        caminho.push(...(sobe ? meio : meio.reverse()));
      }
    }
    caminho.push(ponto);
  });
  return caminho;
}

/** Característica do cômodo que o projeto comprova (para a legenda do tour). Nada é inventado. */
export function destaqueDoComodo(pv: Pavimento, c: Comodo): string | null {
  let janelas = 0, portasJanela = 0;
  for (const a of pv.aberturas) {
    const w = pv.paredes.find(x => x.id === a.paredeId);
    if (!w) continue;
    const [p, q] = ladosDaAbertura(w, a, Math.max(0.35, w.espessura / 2 + 0.25));
    if (!dentroDoPoligono(p, c.poligono) && !dentroDoPoligono(q, c.poligono)) continue;
    if (a.tipo === "janela") janelas++;
    if (a.tipo === "porta_janela") portasJanela++;
  }
  if (portasJanela) return "Porta-janela para a área externa";
  if (janelas > 1) return `${janelas} janelas: iluminação e ventilação naturais`;
  if (janelas === 1) return "Janela com iluminação natural";
  return null;
}
