// Maquete 3D (EPIC-022) — forma real das escadas. Uma escada reta é um lance; em L são dois lances em ângulo com
// um patamar na quina; em U são dois lances paralelos ligados por um patamar no fundo; a caracol gira em torno de
// um eixo. Tudo parte do mesmo dado: o EIXO do caminho (da partida à chegada) e a largura. Dele saem os degraus
// desenhados, a altura de quem sobe andando e o trajeto do tour.
import { centroide, type Escada, type Ponto } from "./modelo.js";
import { dentroDoPoligono } from "./geometria3d.js";

const dist = (a: Ponto, b: Ponto) => Math.hypot(b.x - a.x, b.y - a.y);

/** Direção do maior lado do contorno (o "comprimento" da caixa da escada), como vetor unitário. */
function eixoDoContorno(s: Escada): Ponto {
  let melhor = { x: s.fim.x - s.inicio.x, y: s.fim.y - s.inicio.y }, maior = 0;
  for (let i = 0; i < s.poligono.length; i++) {
    const a = s.poligono[i], b = s.poligono[(i + 1) % s.poligono.length], d = dist(a, b);
    if (d > maior) { maior = d; melhor = { x: b.x - a.x, y: b.y - a.y }; }
  }
  const n = Math.hypot(melhor.x, melhor.y) || 1;
  return { x: melhor.x / n, y: melhor.y / n };
}

/**
 * Eixo do caminho da escada, da partida à chegada. Usa o `percurso` informado; se não houver, calcula pelo tipo:
 * reta/rampa: um trecho; em L: uma quina; em U: ida, patamar no fundo e volta; caracol: arco em torno do centro.
 */
export function percursoDaEscada(s: Escada): Ponto[] {
  if (s.percurso.length >= 1) {
    const p = [...s.percurso];
    if (dist(p[0], s.inicio) > 0.05) p.unshift(s.inicio);
    if (dist(p[p.length - 1], s.fim) > 0.05) p.push(s.fim);
    return p;
  }
  if (dist(s.inicio, s.fim) < 0.05) return [s.inicio, s.fim];
  if (s.tipo === "em_l" || s.tipo === "em_u") {
    // Trabalha no referencial do contorno: v ao longo do maior lado, u atravessado.
    const v = eixoDoContorno(s), u = { x: -v.y, y: v.x };
    const em = (p: Ponto) => ({ u: p.x * u.x + p.y * u.y, v: p.x * v.x + p.y * v.y });
    const de = (c: { u: number; v: number }): Ponto => ({ x: c.u * u.x + c.v * v.x, y: c.u * u.y + c.v * v.y });
    const i = em(s.inicio), f = em(s.fim);
    if (s.tipo === "em_l") {
      const q1 = de({ u: i.u, v: f.v }), q2 = de({ u: f.u, v: i.v });
      const dentro1 = s.poligono.length >= 3 && dentroDoPoligono(q1, s.poligono), dentro2 = s.poligono.length >= 3 && dentroDoPoligono(q2, s.poligono);
      // A quina fica dentro do contorno; no empate, o primeiro lance é o mais comprido.
      const q = dentro1 !== dentro2 ? (dentro1 ? q1 : q2) : Math.abs(f.v - i.v) >= Math.abs(f.u - i.u) ? q1 : q2;
      return dist(q, s.inicio) < 0.05 || dist(q, s.fim) < 0.05 ? [s.inicio, s.fim] : [s.inicio, q, s.fim];
    }
    // Em U: os dois lances correm ao longo de v; o patamar fica na ponta oposta à partida.
    const vs = s.poligono.map(p => em(p).v), vMin = Math.min(...vs, i.v, f.v), vMax = Math.max(...vs, i.v, f.v);
    const meio = (vMin + vMax) / 2, recuo = Math.min(s.largura / 2, (vMax - vMin) / 4);
    const fundo = (i.v + f.v) / 2 <= meio ? vMax - recuo : vMin + recuo;
    if (Math.abs(f.u - i.u) < 0.2) return [s.inicio, s.fim]; // partida e chegada alinhadas: não há como ser U
    return [s.inicio, de({ u: i.u, v: fundo }), de({ u: f.u, v: fundo }), s.fim];
  }
  if (s.tipo === "caracol") {
    const c = s.poligono.length >= 3 ? centroide(s.poligono) : { x: (s.inicio.x + s.fim.x) / 2, y: (s.inicio.y + s.fim.y) / 2 };
    const r0 = dist(c, s.inicio), r1 = dist(c, s.fim);
    if (r0 < 0.1 || r1 < 0.1) return [s.inicio, s.fim];
    const a0 = Math.atan2(s.inicio.y - c.y, s.inicio.x - c.x);
    let giro = Math.atan2(s.fim.y - c.y, s.fim.x - c.x) - a0;
    while (giro <= 0) giro += Math.PI * 2;
    if (giro < Math.PI * 0.75) giro += Math.PI * 2; // menos de 3/4 de volta não vence um andar: dá a volta inteira
    const n = Math.max(6, Math.round(giro / (Math.PI / 9))); // um ponto a cada 20°
    return Array.from({ length: n + 1 }, (_, k) => {
      const t = k / n, a = a0 + giro * t, r = r0 + (r1 - r0) * t;
      return k === 0 ? s.inicio : k === n ? s.fim : { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
    });
  }
  return [s.inicio, s.fim];
}

/** Trecho do caminho com a fração da subida no começo e no fim (0 = piso de baixo, 1 = piso de cima). */
export type TrechoEscada = { a: Ponto; b: Ponto; de: number; ate: number; patamar: boolean };

/**
 * Divide o caminho em lances e patamares. Em L e em U, a quina vira patamar plano (meia largura para cada lado);
 * a subida é repartida só entre os lances. Caracol e rampa sobem o tempo todo.
 */
export function trechosDaEscada(s: Escada): TrechoEscada[] {
  const pts = percursoDaEscada(s);
  const comPatamar = s.tipo === "em_l" || s.tipo === "em_u";
  type Bruto = { a: Ponto; b: Ponto; patamar: boolean };
  const brutos: Bruto[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], comp = dist(a, b);
    if (comp < 0.01) continue;
    const corte = comPatamar ? Math.min(s.largura / 2, comp / 2 - 0.05) : 0;
    const antes = comPatamar && i > 1 && corte > 0.05 ? corte : 0, depois = comPatamar && i < pts.length - 1 && corte > 0.05 ? corte : 0;
    // Trecho curto entre duas quinas (o fundo da escada em U) é patamar inteiro.
    if (comPatamar && i > 1 && i < pts.length - 1 && comp <= s.largura * 1.6) { brutos.push({ a, b, patamar: true }); continue; }
    const em = (d: number): Ponto => ({ x: a.x + ((b.x - a.x) * d) / comp, y: a.y + ((b.y - a.y) * d) / comp });
    if (antes) brutos.push({ a, b: em(antes), patamar: true });
    brutos.push({ a: em(antes), b: em(comp - depois), patamar: false });
    if (depois) brutos.push({ a: em(comp - depois), b, patamar: true });
  }
  const sobe = brutos.filter(t => !t.patamar).reduce((soma, t) => soma + dist(t.a, t.b), 0) || 1;
  let acumulado = 0;
  return brutos.map(t => {
    const de = acumulado / sobe;
    if (!t.patamar) acumulado += dist(t.a, t.b);
    return { ...t, de, ate: acumulado / sobe };
  });
}

/** Fração da subida (0 a 1) no ponto do caminho mais próximo de `p`. */
export function fracaoDaSubida(s: Escada, p: Ponto): number {
  let melhor = 0, menor = Infinity;
  for (const t of trechosDaEscada(s)) {
    const dx = t.b.x - t.a.x, dy = t.b.y - t.a.y, l2 = dx * dx + dy * dy;
    const k = l2 < 1e-9 ? 0 : Math.min(1, Math.max(0, ((p.x - t.a.x) * dx + (p.y - t.a.y) * dy) / l2));
    const d = Math.hypot(p.x - (t.a.x + dx * k), p.y - (t.a.y + dy * k));
    if (d < menor) { menor = d; melhor = t.de + (t.ate - t.de) * k; }
  }
  return melhor;
}

/** Centro da escada caracol (onde fica o mastro), ou null se não for caracol. */
export const eixoDaCaracol = (s: Escada): Ponto | null => (s.tipo === "caracol" && s.poligono.length >= 3 ? centroide(s.poligono) : null);
