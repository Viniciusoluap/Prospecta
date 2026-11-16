// Maquete 3D (EPIC-023, S-G, 15/11/2026) — sistema viário fiel, calculado só a partir da implantação: os leitos de
// rua (polígonos que o estudo de massa guarda em `ruas`) e os eixos lidos do PDF (`vias`). Daqui saem, sem nenhum
// modelo pronto nem sorteio não repetível:
//   • os trechos (eixo, largura total, pista e calçadas), os cruzamentos, as esquinas, as pontas sem saída e os
//     balões de retorno;
//   • a geometria em planta de cada peça (pista com abaulamento, sarjeta, meio-fio, faixa de serviço e calçada,
//     esquinas arredondadas e placas de asfalto dos cruzamentos), para o visualizador só assentar no relevo;
//   • a sinalização horizontal (eixo amarelo, bordos e faixas brancas, faixa de pedestres e linha de retenção);
//   • os elementos (árvores, postes, placas de PARE e semáforos), já na cota do terreno.
// Planta em metros, x para leste e y para sul, como no resto do modelo. Módulo puro: nada de three.js aqui.
import { alturaDoRelevo, areaPoligono, type Implantacao, type Ponto, type Relevo } from "./modelo.js";

// ── Medidas (m) ──

/** Sarjeta de concreto ao pé do meio-fio (faz parte da largura da pista). */
export const LARGURA_SARJETA = 0.45;
/** Altura do meio-fio (espelho) — a calçada fica nessa altura acima da pista. */
export const ALTURA_MEIO_FIO = 0.15;
/** Largura do topo do meio-fio (a pedra), já sobre a calçada. */
export const TOPO_MEIO_FIO = 0.15;
/** Abaulamento: o eixo da pista fica esta altura acima das bordas, para a água correr para a sarjeta. */
export const ABAULAMENTO = 0.035;
/** Toda a via fica alguns centímetros acima da malha do terreno, para nunca "piscar" com ela. */
export const ELEVACAO = 0.05;
/** Tinta da sinalização, acima do asfalto. */
export const ESPESSURA_TINTA = 0.012;
/** Raio do meio-fio nas esquinas (arredondamento). */
export const RAIO_ESQUINA = 4.5;
/** Distância entre árvores na faixa de serviço. */
export const ESPACO_ARVORE = 10;
/** Distância entre postes de iluminação (de um mesmo lado). */
export const ESPACO_POSTE = 30;
/**
 * Critério do semáforo (aceito pelo dono em 15/11/2026): só há semáforo em cruzamento de VIAS PRINCIPAIS — nó com
 * três ou mais braços em que pelo menos dois braços NÃO alinhados (ângulo entre eles de 30° a 150°, ou seja, vias
 * diferentes que se cruzam) têm largura total de pelo menos 14 m. Nos demais cruzamentos de três ou mais braços a via
 * preferencial (o par de braços mais alinhado; empate decidido pela maior largura) segue livre e cada um dos outros
 * braços recebe placa de PARE junto da linha de retenção.
 */
export const LARGURA_VIA_PRINCIPAL = 14;
/** Lado da malha do terreno (divisões por lado) — a mesma do visualizador, para a via acompanhar o chão desenhado. */
export const LADO_MALHA = 96;

const LIMITE_ARVORES = 2500, LIMITE_POSTES = 800;

// ── Tipos ──

export type Trecho = {
  id: string; nome: string;
  /** Eixo (polilinha), já ajustado aos cruzamentos. */
  eixo: Ponto[];
  /** Largura total do leito (de alinhamento a alinhamento dos lotes). */
  largura: number;
  /** Largura da pista (de meio-fio a meio-fio, com as sarjetas). */
  pista: number;
  /** Largura de cada calçada. */
  calcada: number;
  /** Faixa de serviço (árvores e postes) dentro da calçada; 0 quando a calçada é estreita demais. */
  faixaServico: number;
  origem: "rua" | "via";
};
export type Braco = { trecho: string; ponta: "inicio" | "fim"; dir: Ponto; largura: number; meiaPista: number };
export type Controle = "semaforo" | "pare" | "nenhum";
export type No = {
  id: string; p: Ponto; bracos: Braco[];
  /** cruzamento: 3+ braços; esquina: 2 braços em ângulo. */
  tipo: "cruzamento" | "esquina";
  controle: Controle;
  /** Índices (em `bracos`) da via preferencial, quando há. */
  preferencial: number[];
};
export type Balao = { id: string; centro: Ponto; raio: number; raioPista: number; trecho: string | null };
export type PontaSemSaida = { trecho: string; p: Ponto };
export type TipoElemento = "arvore" | "poste" | "pare" | "semaforo";
export type Elemento = {
  tipo: TipoElemento; x: number; y: number;
  /** Cota do pé do elemento (topo da calçada), em metros, já com o relevo. */
  cota: number;
  /** Giro em torno do eixo vertical (rad), no sentido do three.js: o eixo +x local aponta para (cos g, −sen g). */
  giro: number;
  variante: number; escala: number;
  /** Semáforo: luz acesa para quem chega por este braço. */
  estado?: "verde" | "vermelho";
  /** Árvore: tom da copa (0–1). */
  tom?: number;
};
export type MaterialVia = "asfalto" | "sarjeta" | "meioFio" | "servico" | "piso";
/**
 * Faixa varrida: colunas paralelas com o mesmo número de pontos. Entre duas colunas vizinhas há um material (ou nada).
 * `alturas[c][i]` é a altura do ponto acima do terreno (sem a ELEVACAO); duas colunas no mesmo lugar com alturas
 * diferentes formam uma face vertical (o espelho do meio-fio). `u[c][i]`/`v[c][i]`: coordenadas de textura em metros.
 */
export type Varredura = {
  colunas: Ponto[][]; alturas: number[][]; materiais: (MaterialVia | null)[];
  u: number[][]; v: number[][];
  tampas?: { inicio: boolean; fim: boolean };
};
/** Placa de asfalto plana (miolo dos cruzamentos e dos balões). */
export type Placa = { contorno: Ponto[] };
export type Pintura = { cor: "branca" | "amarela"; p: [Ponto, Ponto, Ponto, Ponto]; h: [number, number, number, number] };

export type SistemaViario = {
  trechos: Trecho[]; nos: No[]; baloes: Balao[]; pontas: PontaSemSaida[];
  varreduras: Varredura[]; placas: Placa[]; pinturas: Pintura[]; elementos: Elemento[];
  /** Índices de `imp.ruas` que não viraram via (forma irreconhecível): o terreno continua pintando-os de asfalto. */
  ruasSemGeometria: number[];
  /** Comprimento total dos eixos (m). */
  extensao: number;
};

// ── Vetores ──

const sub = (a: Ponto, b: Ponto): Ponto => ({ x: a.x - b.x, y: a.y - b.y });
const soma = (a: Ponto, b: Ponto): Ponto => ({ x: a.x + b.x, y: a.y + b.y });
const esc = (a: Ponto, k: number): Ponto => ({ x: a.x * k, y: a.y * k });
const pe = (a: Ponto, b: Ponto) => a.x * b.x + a.y * b.y;
const cruz = (a: Ponto, b: Ponto) => a.x * b.y - a.y * b.x;
const dist = (a: Ponto, b: Ponto) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (a: Ponto): Ponto => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };
/** Normal à esquerda no sentido matemático (gira +90°): com y para sul, fica à DIREITA de quem olha a planta. */
const nMais = (d: Ponto): Ponto => ({ x: -d.y, y: d.x });
const nMenos = (d: Ponto): Ponto => ({ x: d.y, y: -d.x });
const ang = (d: Ponto) => Math.atan2(d.y, d.x);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Interseção das retas p + t·d e q + s·e (null se quase paralelas). */
function intersecaoRetas(p: Ponto, d: Ponto, q: Ponto, e: Ponto): Ponto | null {
  const den = cruz(d, e);
  if (Math.abs(den) < 1e-6) return null;
  const t = cruz(sub(q, p), e) / den;
  return soma(p, esc(d, t));
}

/** Gerador pseudoaleatório determinístico (mulberry32) a partir de um texto. */
export function semente(texto: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  let s = h || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Terreno: a mesma malha do visualizador ──

/** Limites de tudo o que a implantação desenha (para a câmera e para a malha do terreno). */
export function limitesDaImplantacao(imp: Implantacao) {
  const pts: Ponto[] = [...imp.terreno, ...imp.lotes.flatMap(l => l.poligono), ...imp.ruas.flat(), ...imp.vias.flatMap(v => v.eixo), ...imp.posicoes.map(p => ({ x: p.x, y: p.y }))];
  if (!pts.length) return { x0: 0, x1: 1, z0: 0, z1: 1 };
  let x0 = 0, x1 = 1, z0 = 0, z1 = 1;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.y); z1 = Math.max(z1, p.y); }
  return { x0, x1, z0, z1 };
}

export type CaixaTerreno = { x0: number; z0: number; largura: number; comprimento: number };

/** Caixa da malha do terreno: o conjunto com folga (ou a própria grade do relevo, quando há). */
export function caixaDoTerreno(imp: Implantacao): CaixaTerreno {
  if (imp.relevo) {
    const r = imp.relevo;
    return { x0: r.x0, z0: r.y0, largura: r.dx * (r.colunas - 1), comprimento: r.dy * (r.linhas - 1) };
  }
  const l = limitesDaImplantacao(imp), folga = Math.max(6, Math.max(l.x1 - l.x0, l.z1 - l.z0) * 0.06);
  return { x0: l.x0 - folga, z0: l.z0 - folga, largura: l.x1 - l.x0 + folga * 2, comprimento: l.z1 - l.z0 + folga * 2 };
}

/**
 * Altura exata da malha triangulada do terreno no ponto (x, y) — a mesma superfície que o visualizador desenha
 * (grade LADO_MALHA × LADO_MALHA, diagonais do canto (i+1, j) ao (i, j+1)). Assentar a via nela, e não na
 * interpolação bilinear do relevo, evita que o chão "fure" o asfalto entre os vértices.
 */
export function alturaNaMalha(relevo: Relevo | null | undefined, caixa: CaixaTerreno, x: number, y: number, lado = LADO_MALHA): number {
  if (!relevo) return 0;
  const fi = Math.min(lado, Math.max(0, ((x - caixa.x0) / caixa.largura) * lado)), fj = Math.min(lado, Math.max(0, ((y - caixa.z0) / caixa.comprimento) * lado));
  const i = Math.min(lado - 1, Math.floor(fi)), j = Math.min(lado - 1, Math.floor(fj)), u = fi - i, v = fj - j;
  const h = (ii: number, jj: number) => alturaDoRelevo(relevo, caixa.x0 + (caixa.largura * ii) / lado, caixa.z0 + (caixa.comprimento * jj) / lado);
  const hb = h(i + 1, j), hc = h(i, j + 1);
  if (u + v <= 1) { const ha = h(i, j); return ha + u * (hb - ha) + v * (hc - ha); }
  const hd = h(i + 1, j + 1);
  return hd + (1 - u) * (hc - hd) + (1 - v) * (hb - hd);
}

// ── Leitura das formas: polígono de rua → eixo + largura, ou balão ──

/** Divide a largura total em pista e calçadas: a pista no meio do leito, as calçadas nas bordas (nunca nos lotes). */
export function perfilDaVia(largura: number) {
  let calcada = Math.min(4, Math.max(1.2, largura * 0.2));
  if (largura - 2 * calcada < 3) calcada = Math.max(0, (largura - 3) / 2);
  const pista = largura - 2 * calcada;
  const faixaServico = calcada >= 1.8 ? Math.min(1.2, Math.max(0.6, calcada * 0.35)) : 0;
  return { pista, calcada, faixaServico };
}

function limpar(pol: Ponto[]): Ponto[] {
  const out: Ponto[] = [];
  for (const p of pol) if (!out.length || dist(out[out.length - 1], p) > 0.01) out.push(p);
  while (out.length > 2 && dist(out[0], out[out.length - 1]) < 0.01) out.pop();
  return out;
}

function perimetro(pol: Ponto[]) { let s = 0; for (let i = 0; i < pol.length; i++) s += dist(pol[i], pol[(i + 1) % pol.length]); return s; }

function envoltoria(pts: Ponto[]): Ponto[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const baixo: Ponto[] = [], cima: Ponto[] = [];
  for (const q of p) { while (baixo.length >= 2 && cruz(sub(baixo[baixo.length - 1], baixo[baixo.length - 2]), sub(q, baixo[baixo.length - 2])) <= 0) baixo.pop(); baixo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (cima.length >= 2 && cruz(sub(cima[cima.length - 1], cima[cima.length - 2]), sub(q, cima[cima.length - 2])) <= 0) cima.pop(); cima.push(q); }
  return [...baixo.slice(0, -1), ...cima.slice(0, -1)];
}

/** Caixa orientada de menor área (pelas arestas da envoltória convexa). */
export function caixaOrientada(pts: Ponto[]) {
  const h = envoltoria(pts);
  let melhor = { area: Infinity, centro: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, comprimento: 0, largura: 0 };
  for (let i = 0; i < h.length; i++) {
    const d = unit(sub(h[(i + 1) % h.length], h[i])), n = nMais(d);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const q of h) { const a = pe(q, d), b = pe(q, n); a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const area = (a1 - a0) * (b1 - b0);
    if (area < melhor.area - 1e-9) {
      const centro = soma(esc(d, (a0 + a1) / 2), esc(n, (b0 + b1) / 2));
      melhor = a1 - a0 >= b1 - b0
        ? { area, centro, dir: d, comprimento: a1 - a0, largura: b1 - b0 }
        : { area, centro, dir: n, comprimento: b1 - b0, largura: a1 - a0 };
    }
  }
  return melhor;
}

/** Círculo que melhor passa pelos pontos (mínimos quadrados de Kåsa). */
function ajustarCirculo(pts: Ponto[]) {
  const n = pts.length, mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p.x - mx, v = p.y - my;
    suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const b1 = (suuu + suvv) / 2, b2 = (svvv + svuu) / 2;
  const uc = (b1 * svv - b2 * suv) / det, vc = (suu * b2 - suv * b1) / det;
  const centro = { x: mx + uc, y: my + vc }, raio = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  return { centro, raio };
}

function reamostrar(linha: Ponto[], n: number): Ponto[] {
  const acum = [0];
  for (let i = 1; i < linha.length; i++) acum.push(acum[i - 1] + dist(linha[i - 1], linha[i]));
  const total = acum[acum.length - 1], out: Ponto[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = (total * i) / (n - 1);
    while (k < linha.length - 2 && acum[k + 1] < s) k++;
    const t = acum[k + 1] - acum[k] > 1e-9 ? (s - acum[k]) / (acum[k + 1] - acum[k]) : 0;
    out.push(soma(linha[k], esc(sub(linha[k + 1], linha[k]), Math.min(1, Math.max(0, t)))));
  }
  return out;
}

export type FormaDeRua =
  | { tipo: "reta" | "curva"; eixo: Ponto[]; largura: number }
  | { tipo: "balao"; centro: Ponto; raio: number };

/**
 * Reconhece a forma de um polígono de rua:
 * - balão: os vértices ficam (quase todos) num círculo e a área é a de um disco (não de um anel);
 * - reta: o polígono enche a caixa orientada mínima — eixo pelo lado maior, largura = lado menor;
 * - curva: faixa de largura constante que dobra (via que acompanha a divisa) — os quatro cantos mais agudos separam
 *   as duas bordas compridas das duas cabeceiras, e o eixo passa pelo meio das bordas.
 */
export function formaDaRua(bruto: Ponto[]): FormaDeRua | null {
  const pol = limpar(bruto);
  if (pol.length < 3) return null;
  const area = areaPoligono(pol);
  if (area < 8) return null;
  if (pol.length >= 8) {
    const c = ajustarCirculo(pol);
    if (c && c.raio >= 3 && c.raio <= 60) {
      const dentro = pol.filter(p => Math.abs(dist(p, c.centro) - c.raio) < c.raio * 0.06).length;
      if (dentro >= pol.length * 0.6 && area >= Math.PI * c.raio * c.raio * 0.6) return { tipo: "balao", centro: c.centro, raio: c.raio };
    }
  }
  const cx = caixaOrientada(pol);
  if (area / cx.area >= 0.85 || pol.length <= 5) {
    if (cx.largura < 1 || cx.largura > 60) return null;
    // Cabeceira em viés (rua cortada pela divisa num ângulo): a caixa orientada passa do polígono de um dos lados
    // em até largura × tangente do viés. O eixo é encurtado até onde a via cabe com a largura inteira, para o
    // asfalto e a calçada não avançarem sobre o que está além da cabeceira (um lote, no motor de massa novo).
    const n = nMais(cx.dir);
    // Trecho do eixo em que a via cabe inteira, para um centro e uma meia largura dados.
    const aparar = (centro: Ponto, meiaLargura: number): [number, number] => {
      let t0 = -cx.comprimento / 2, t1 = cx.comprimento / 2;
      for (const lado of [-0.94, 0.94]) {
        const origem = soma(centro, esc(n, lado * meiaLargura));
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < pol.length; i++) {
          const p = pol[i], q = pol[(i + 1) % pol.length], e = sub(q, p), den = cruz(cx.dir, e);
          if (Math.abs(den) < 1e-9) continue;
          const u = cruz(sub(p, origem), cx.dir) / den;
          if (u < -1e-9 || u > 1 + 1e-9) continue;
          const t = cruz(sub(p, origem), e) / den;
          min = Math.min(min, t); max = Math.max(max, t);
        }
        if (max > min) { t0 = Math.max(t0, min); t1 = Math.min(t1, max); }
      }
      return [t0, t1];
    };
    let centro = cx.centro, largura = cx.largura, [t0, t1] = aparar(centro, largura / 2);
    // Rua que afunila (a divisa corta o leito ao longo do comprimento, não só na cabeceira): com a largura inteira
    // sobraria só um toco. Usa a faixa que cabe em quase todo o comprimento — mais estreita —, para a rua aparecer
    // como rua (asfalto, meio-fio e pintura) em vez de uma laje lisa; o resto do leito continua pintado no terreno.
    if (t1 - t0 < cx.comprimento * 0.6) {
      let b0 = -Infinity, b1 = Infinity;
      for (let k = 0; k <= 8; k++) {
        const origem = soma(cx.centro, esc(cx.dir, cx.comprimento * (-0.4 + 0.1 * k)));
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < pol.length; i++) {
          const p = pol[i], q = pol[(i + 1) % pol.length], e = sub(q, p), den = cruz(n, e);
          if (Math.abs(den) < 1e-9) continue;
          const u = cruz(sub(p, origem), n) / den;
          if (u < -1e-9 || u > 1 + 1e-9) continue;
          const b = cruz(sub(p, origem), e) / den;
          min = Math.min(min, b); max = Math.max(max, b);
        }
        if (max > min) { b0 = Math.max(b0, min); b1 = Math.min(b1, max); }
      }
      if (b1 - b0 >= 3) {
        const c2 = soma(cx.centro, esc(n, (b0 + b1) / 2)), [u0, u1] = aparar(c2, (b1 - b0) / 2);
        if (u1 - u0 > t1 - t0) { centro = c2; largura = b1 - b0; t0 = u0; t1 = u1; }
      }
    }
    // Cunha (ponta de rua triangular, sobra do recorte pela divisa): não há trecho de largura inteira para erguer.
    // Fica sem geometria 3D e continua pintada como asfalto no terreno.
    if (t1 - t0 < 2) {
      if (area / cx.area < 0.7) return null;
      centro = cx.centro; largura = cx.largura; t0 = -cx.comprimento / 2; t1 = cx.comprimento / 2;
    }
    return { tipo: "reta", eixo: [soma(centro, esc(cx.dir, t0)), soma(centro, esc(cx.dir, t1))], largura };
  }
  // Faixa curva (via que acompanha a divisa): acha as duas cabeceiras — arestas curtas, da ordem da largura da
  // faixa, com canto vivo nas duas pontas — e as duas bordas compridas entre elas.
  const n = pol.length, sentido = Math.sign(pol.reduce((s, p, i) => s + cruz(p, pol[(i + 1) % n]), 0)) || 1;
  const giro = (i: number) => {
    const p = pol[((i % n) + n) % n], a = unit(sub(p, pol[(((i - 1) % n) + n) % n])), b = unit(sub(pol[(i + 1) % n], p));
    return Math.atan2(cruz(a, b), pe(a, b)) * sentido;
  };
  const cadeia = (de: number, ate: number) => { const out: Ponto[] = []; for (let k = de % n; ; k = (k + 1) % n) { out.push(pol[k]); if (k === ate % n) break; } return out; };
  const compr = (c: Ponto[]) => c.reduce((s, p, i) => (i ? s + dist(c[i - 1], p) : 0), 0);
  const P = perimetro(pol), estimada = (P / 2 - Math.sqrt(Math.max(0, (P * P) / 4 - 4 * area))) / 2;
  const vivo = (40 * Math.PI) / 180;
  const cabeceiras: number[] = [];
  for (let i = 0; i < n; i++) {
    const l = dist(pol[i], pol[(i + 1) % n]);
    if (l >= estimada * 0.4 && l <= estimada * 2.2 && giro(i) > vivo && giro(i + 1) > vivo) cabeceiras.push(i);
  }
  let ladoA: Ponto[] | null = null, ladoB: Ponto[] | null = null;
  if (cabeceiras.length >= 2) {
    let melhor = -1;
    for (const i of cabeceiras) for (const j of cabeceiras) {
      if (j <= i) continue;
      const a = cadeia(i + 1, j), b = cadeia(j + 1, i), nota = Math.min(compr(a), compr(b));
      if (nota > melhor) { melhor = nota; ladoA = a; ladoB = [...b].reverse(); }
    }
  }
  if (!ladoA || !ladoB) {
    // Sem cabeceiras claras: os quatro cantos mais vivos.
    const cantos = Array.from({ length: n }, (_, i) => ({ i, g: giro(i) })).sort((a, b) => b.g - a.g).slice(0, 4).filter(c => c.g > Math.PI / 4).map(c => c.i).sort((a, b) => a - b);
    if (cantos.length === 4) {
      const cadeias = [0, 1, 2, 3].map(k => cadeia(cantos[k], cantos[(k + 1) % 4]));
      const comp = cadeias.map(compr);
      const par = comp[0] + comp[2] >= comp[1] + comp[3] ? [0, 2] : [1, 3];
      ladoA = cadeias[par[0]]; ladoB = [...cadeias[par[1]]].reverse();
    }
  }
  if (!ladoA || !ladoB) {
    // Por fim: pontas = par de vértices mais distantes.
    let bi = 0, bj = 0, bd = -1;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const d = dist(pol[i], pol[j]); if (d > bd) { bd = d; bi = i; bj = j; } }
    ladoA = pol.slice(bi, bj + 1); ladoB = [...pol.slice(bj), ...pol.slice(0, bi + 1)].reverse();
  }
  // Eixo: meio entre cada ponto de uma borda e o ponto mais próximo da outra (robusto nas dobras).
  const m = Math.max(2, Math.min(400, Math.round(compr(ladoA) / 2)));
  const lb = linha(ladoB);
  const pares = reamostrar(ladoA, m).map(p => { const q = projetar(lb, p).q; return { meio: esc(soma(p, q), 0.5), larg: dist(p, q) }; });
  const larguras = pares.map(x => x.larg).sort((x, y) => x - y);
  const largura = larguras[Math.floor(larguras.length / 2)];
  if (!(largura >= 1) || largura > 60) return null;
  const eixo = pares.map(x => x.meio).filter((p, i, arr) => i === 0 || dist(p, arr[i - 1]) > 0.3);
  if (eixo.length < 2) return null;
  return { tipo: "curva", eixo: endireitarCantos(douglasPeucker(eixo, 0.3), largura), largura };
}

/** Simplificação de Douglas–Peucker (desvio máximo `tol` m). */
function douglasPeucker(l: Ponto[], tol: number): Ponto[] {
  if (l.length <= 2) return l;
  const a = l[0], b = l[l.length - 1], d = unit(sub(b, a));
  let k = 0, m = -1;
  for (let i = 1; i < l.length - 1; i++) {
    const e = dist(a, b) > 1e-9 ? Math.abs(cruz(d, sub(l[i], a))) : dist(a, l[i]);
    if (e > m) { m = e; k = i; }
  }
  if (m <= tol) return [a, b];
  return [...douglasPeucker(l.slice(0, k + 1), tol).slice(0, -1), ...douglasPeucker(l.slice(k), tol)];
}

/**
 * Numa dobra fechada da faixa, os pontos médios cortam o canto em chanfro (e a calçada de dentro entraria no lote).
 * Uma sequência de segmentos curtos entre dois compridos vira o encontro das retas dos compridos — o eixo de verdade.
 */
function endireitarCantos(pts: Ponto[], largura: number): Ponto[] {
  let out = [...pts];
  for (let volta = 0; volta < 20; volta++) {
    const comp = out.slice(1).map((p, i) => dist(out[i], p));
    let mudou = false;
    for (let i = 1; i < comp.length - 1 && !mudou; i++) {
      if (comp[i] >= largura || comp[i - 1] < largura) continue;
      let j = i;
      while (j + 1 < comp.length && comp[j + 1] < largura) j++;
      if (j + 1 >= comp.length) break;
      // Segmentos curtos i..j entre o comprido i−1 (out[i−1]→out[i]) e o comprido j+1 (out[j+1]→out[j+2]).
      const da = unit(sub(out[i], out[i - 1])), db = unit(sub(out[j + 2], out[j + 1]));
      // Só dobra de verdade (mais de 30°); curva suave fica como está.
      if (pe(da, db) > Math.cos((30 * Math.PI) / 180)) continue;
      const x = intersecaoRetas(out[i], da, out[j + 1], db);
      const meio = esc(soma(out[i], out[j + 1]), 0.5);
      if (!x || dist(x, meio) > 2 * largura) continue;
      out = [...out.slice(0, i), x, ...out.slice(j + 2)];
      mudou = true;
    }
    if (!mudou) break;
  }
  return out;
}


// ── Polilinhas ──

type Linha = { pts: Ponto[]; acum: number[]; total: number };
function linha(pts: Ponto[]): Linha {
  const acum = [0];
  for (let i = 1; i < pts.length; i++) acum.push(acum[i - 1] + dist(pts[i - 1], pts[i]));
  return { pts, acum, total: acum[acum.length - 1] };
}
function pontoEm(l: Linha, s: number): Ponto {
  const ss = Math.min(l.total, Math.max(0, s));
  let k = 0;
  while (k < l.pts.length - 2 && l.acum[k + 1] < ss) k++;
  const seg = l.acum[k + 1] - l.acum[k];
  return soma(l.pts[k], esc(sub(l.pts[k + 1], l.pts[k]), seg > 1e-9 ? (ss - l.acum[k]) / seg : 0));
}
/** Tangente suavizada (diferença central de ±1 m): normais iguais para todas as colunas na mesma estação. */
function tangenteEm(l: Linha, s: number): Ponto {
  const a = pontoEm(l, s - 1), b = pontoEm(l, s + 1);
  const d = sub(b, a);
  return Math.hypot(d.x, d.y) > 1e-6 ? unit(d) : unit(sub(l.pts[l.pts.length - 1], l.pts[0]));
}
/** Ponto mais próximo na polilinha: distância, posição ao longo (s) e lado (lateral com sinal, + = nMais da tangente). */
function projetar(l: Linha, p: Ponto) {
  let melhor = { d: Infinity, s: 0, lateral: 0, q: l.pts[0] };
  for (let i = 0; i < l.pts.length - 1; i++) {
    const a = l.pts[i], b = l.pts[i + 1], ab = sub(b, a), len2 = pe(ab, ab) || 1;
    const t = Math.max(0, Math.min(1, pe(sub(p, a), ab) / len2)), q = soma(a, esc(ab, t)), d = dist(p, q);
    if (d < melhor.d) melhor = { d, s: l.acum[i] + t * Math.sqrt(len2), lateral: pe(sub(p, q), nMais(unit(ab))), q };
  }
  return melhor;
}
/**
 * Ponto a `lat` metros do eixo (+ = lado nMais), na posição `s`. Nos vértices usa a esquadria (miter); do lado de
 * dentro de uma dobra, os pontos que passariam do canto ficam presos nele — a faixa não se dobra sobre si mesma.
 */
function deslocar(l: Linha, s: number, lat: number): Ponto {
  const ss = Math.min(l.total, Math.max(0, s)), n = l.pts.length;
  for (let k = 1; k < n - 1; k++) {
    const d1 = unit(sub(l.pts[k], l.pts[k - 1])), d2 = unit(sub(l.pts[k + 1], l.pts[k])), giro = Math.atan2(cruz(d1, d2), pe(d1, d2));
    if (Math.abs(giro) < 1e-4) continue;
    const meio = Math.abs(giro) / 2, alcance = Math.abs(lat) * Math.tan(meio);
    const dentro = Math.sign(lat) === Math.sign(giro);
    if (Math.abs(ss - l.acum[k]) < 1e-6 || (dentro && Math.abs(ss - l.acum[k]) < alcance)) {
      const m = unit(soma(nMais(d1), nMais(d2)));
      return soma(l.pts[k], esc(m, lat / Math.cos(meio)));
    }
  }
  let k = 0;
  while (k < n - 2 && l.acum[k + 1] < ss) k++;
  const d = unit(sub(l.pts[k + 1], l.pts[k]));
  return soma(pontoEm(l, ss), esc(nMais(d), lat));
}

function trechoDe(l: Linha, s0: number, s1: number): Ponto[] {
  const out = [pontoEm(l, s0)];
  for (let i = 1; i < l.pts.length - 1; i++) if (l.acum[i] > s0 + 0.01 && l.acum[i] < s1 - 0.01) out.push(l.pts[i]);
  out.push(pontoEm(l, s1));
  return out;
}

// ── Montagem do grafo ──

type Base = { id: string; nome: string; pts: Ponto[]; largura: number; origem: "rua" | "via" };
type Ligacao = { base: number; s: number };
type Aresta = { id: string; nome: string; pts: Ponto[]; largura: number; origem: "rua" | "via"; noIni: number | null; noFim: number | null; balaoIni: number | null; balaoFim: number | null };

/**
 * Descreve o sistema viário inteiro. Determinístico: a mesma implantação dá sempre o mesmo resultado
 * (os "sorteios" de porte e cor das árvores vêm de sementes tiradas dos próprios identificadores).
 */
export function sistemaViario(imp: Implantacao, opcoes: { relevo?: Relevo | null; caixa?: CaixaTerreno } = {}): SistemaViario {
  const relevo = opcoes.relevo === undefined ? imp.relevo : opcoes.relevo;
  const caixa = opcoes.caixa ?? caixaDoTerreno(imp);
  const cota = (p: Ponto) => alturaNaMalha(relevo, caixa, p.x, p.y);

  // 1. Formas → trechos-base e balões.
  const bases: Base[] = [], baloes: Balao[] = [], ruasSemGeometria: number[] = [];
  const viasEixo = imp.vias.filter(v => v.eixo.length >= 2).map(v => ({ ...v, l: linha(limpar(v.eixo).length >= 2 ? limpar(v.eixo) : v.eixo) }));
  imp.ruas.forEach((r, i) => {
    const f = formaDaRua(r);
    if (!f) { ruasSemGeometria.push(i); return; }
    if (f.tipo === "balao") {
      // O estudo de massa pode trazer o mesmo balão duas vezes (nas ruas e nos balões): fica um só.
      if (!baloes.some(b => dist(b.centro, f.centro) < 0.5 && Math.abs(b.raio - f.raio) < 0.5)) baloes.push({ id: `b${baloes.length + 1}`, centro: f.centro, raio: f.raio, raioPista: 0, trecho: null });
      return;
    }
    // Polígono que já é o leito de um eixo lido (vias): fica só o eixo.
    const meio = pontoEm(linha(f.eixo), linha(f.eixo).total / 2);
    if (viasEixo.some(v => projetar(v.l, meio).d < Math.max(f.largura, v.largura) / 2)) return;
    bases.push({ id: `r${i + 1}`, nome: "", pts: f.eixo, largura: f.largura, origem: "rua" });
  });
  for (const v of viasEixo) bases.push({ id: `v-${v.id}`, nome: v.nome, pts: v.l.pts, largura: v.largura, origem: "via" });

  // 2. Pontas que encostam em outro trecho viram entroncamento (T) ou esquina: a ponta vai até o eixo do outro.
  const cand: { p: Ponto; lig: Ligacao[] }[] = [];
  const novas = bases.map(b => [...b.pts]);
  const caixas = bases.map(b => { const xs = b.pts.map(p => p.x), ys = b.pts.map(p => p.y); return { x0: Math.min(...xs) - b.largura, x1: Math.max(...xs) + b.largura, y0: Math.min(...ys) - b.largura, y1: Math.max(...ys) + b.largura }; });
  const linhas = bases.map(b => linha(b.pts));
  bases.forEach((a, ia) => {
    for (const ponta of ["inicio", "fim"] as const) {
      const e = ponta === "inicio" ? a.pts[0] : a.pts[a.pts.length - 1];
      const viz = ponta === "inicio" ? a.pts[1] : a.pts[a.pts.length - 2];
      // Ponta dentro de um balão: termina nele (passo 6), não emenda em nada.
      if (baloes.some(b => dist(e, b.centro) < b.raio + 0.5 && b.raio > a.largura / 2 + 1)) continue;
      const dirE = unit(sub(e, viz));
      let melhor: { ib: number; d: number; q: Ponto; s: number } | null = null;
      let emendaReta: { ib: number; d: number; q: Ponto; s: number } | null = null;
      bases.forEach((b, ib) => {
        if (ib === ia) return;
        const c = caixas[ib];
        if (e.x < c.x0 || e.x > c.x1 || e.y < c.y0 || e.y > c.y1) return;
        const pr = projetar(linhas[ib], e);
        if (pr.d > b.largura / 2 + 1.0) return;
        // Trecho quase paralelo (o leito continua em frente): só vale como emenda ponta com ponta, e só se não
        // houver uma via cruzando ali — a ponta que avança sobre a continuação vai até o eixo da transversal.
        if (Math.abs(cruz(dirE, tangenteEm(linhas[ib], pr.s))) < Math.sin((20 * Math.PI) / 180)) {
          const pts = b.pts;
          for (const [q, s] of [[pts[0], 0], [pts[pts.length - 1], linhas[ib].total]] as const) {
            const d = dist(q, e);
            if (d <= Math.max(a.largura, b.largura) / 2 + 1 && (!emendaReta || d < emendaReta.d)) emendaReta = { ib, d, q: esc(soma(q, e), 0.5), s };
          }
          return;
        }
        if (!melhor || pr.d < melhor.d) melhor = { ib, d: pr.d, q: pr.q, s: pr.s };
      });
      if (!melhor && emendaReta) {
        const m = emendaReta as { ib: number; d: number; q: Ponto; s: number };
        if (ponta === "inicio") novas[ia][0] = m.q; else novas[ia][novas[ia].length - 1] = m.q;
        cand.push({ p: m.q, lig: [{ base: ia, s: ponta === "inicio" ? 0 : Infinity }, { base: m.ib, s: m.s === 0 ? 0 : Infinity }] });
        continue;
      }
      if (!melhor) continue;
      const m = melhor as { ib: number; d: number; q: Ponto; s: number };
      const lb = linhas[m.ib], tb = tangenteEm(lb, m.s);
      let n = m.q;
      {
        const x = intersecaoRetas(viz, dirE, m.q, tb);
        if (x && dist(x, e) <= bases[m.ib].largura / 2 + 3) n = x;
      }
      const ns = projetar(lb, n).s;
      if (ponta === "inicio") novas[ia][0] = n; else novas[ia][novas[ia].length - 1] = n;
      cand.push({ p: n, lig: [{ base: ia, s: ponta === "inicio" ? 0 : Infinity }, { base: m.ib, s: ns }] });
    }
  });
  const linhas2 = novas.map(p => linha(p));
  // As ligações com s = Infinity apontam para o fim (o comprimento mudou com o ajuste).
  for (const c of cand) for (const l of c.lig) if (l.s === Infinity) l.s = linhas2[l.base].total;
  // Ligações nos outros trechos foram medidas antes do ajuste das pontas deles: reprojeta.
  for (const c of cand) for (const l of c.lig) if (l.s !== 0 && l.s !== linhas2[l.base].total) l.s = projetar(linhas2[l.base], c.p).s;

  // 3. Cruzamentos (X): segmentos que se cortam no meio dos dois trechos.
  for (let ia = 0; ia < novas.length; ia++) for (let ib = ia + 1; ib < novas.length; ib++) {
    const ca = caixas[ia], cb = caixas[ib];
    if (ca.x1 < cb.x0 || cb.x1 < ca.x0 || ca.y1 < cb.y0 || cb.y1 < ca.y0) continue;
    const A = novas[ia], B = novas[ib];
    for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < B.length - 1; j++) {
      const p = A[i], d = sub(A[i + 1], A[i]), q = B[j], e = sub(B[j + 1], B[j]);
      const den = cruz(d, e);
      if (Math.abs(den) < 1e-9) continue;
      const t = cruz(sub(q, p), e) / den, u = cruz(sub(q, p), d) / den;
      if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) continue;
      // Ponta encostando em ponta não é cruzamento (o passo 2 já decidiu: emenda, esquina ou balão).
      const pontaA = (i === 0 && t < 1e-3) || (i === A.length - 2 && t > 1 - 1e-3), pontaB = (j === 0 && u < 1e-3) || (j === B.length - 2 && u > 1 - 1e-3);
      if (pontaA && pontaB) continue;
      const x = soma(p, esc(d, t));
      cand.push({ p: x, lig: [{ base: ia, s: linhas2[ia].acum[i] + t * Math.hypot(d.x, d.y) }, { base: ib, s: linhas2[ib].acum[j] + u * Math.hypot(e.x, e.y) }] });
    }
  }

  // 4. Agrupa candidatos próximos num nó só.
  const pai = cand.map((_, i) => i);
  const raiz = (i: number): number => (pai[i] === i ? i : (pai[i] = raiz(pai[i])));
  for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) if (dist(cand[i].p, cand[j].p) < 2) pai[raiz(j)] = raiz(i);
  const grupos = new Map<number, number[]>();
  cand.forEach((_, i) => { const r = raiz(i); grupos.set(r, [...(grupos.get(r) ?? []), i]); });
  const nosP: Ponto[] = [];
  const corte: { base: number; s: number; no: number }[] = [];
  for (const membros of Array.from(grupos.values())) {
    const k = nosP.length;
    nosP.push(esc(membros.reduce((s, i) => soma(s, cand[i].p), { x: 0, y: 0 }), 1 / membros.length));
    for (const i of membros) for (const l of cand[i].lig) corte.push({ ...l, no: k });
  }

  // 5. Arestas: cada trecho-base é partido nos nós; sobras curtas além de um nó (o leito que passa do eixo) somem.
  let arestas: Aresta[] = [];
  novas.forEach((_, ib) => {
    const l = linhas2[ib], b = bases[ib];
    const meus = corte.filter(c => c.base === ib).sort((x, y) => x.s - y.s);
    const marcas: { s: number; no: number | null }[] = [];
    for (const c of meus) {
      const s = Math.min(l.total, Math.max(0, c.s));
      const ult = marcas[marcas.length - 1];
      if (ult && (Math.abs(ult.s - s) < 1.5 || ult.no === c.no)) continue;
      marcas.push({ s, no: c.no });
    }
    if (!marcas.length || marcas[0].s > 0.01) marcas.unshift({ s: 0, no: null });
    if (marcas[marcas.length - 1].s < l.total - 0.01) marcas.push({ s: l.total, no: null });
    for (let k = 0; k < marcas.length - 1; k++) {
      const a = marcas[k], z = marcas[k + 1], comp = z.s - a.s;
      if (comp < 0.5) continue;
      const noA = a.no, noZ = z.no;
      if ((noA === null) !== (noZ === null)) {
        // Sobra além do nó: some se for menor que meia largura das vias do nó + folga.
        if (comp < b.largura / 2 + 2.5 && (k === 0 || k === marcas.length - 2)) continue;
      }
      arestas.push({ id: `${b.id}.${k + 1}`, nome: b.nome, pts: trechoDe(l, a.s, z.s), largura: b.largura, origem: b.origem, noIni: noA, noFim: noZ, balaoIni: null, balaoFim: null });
    }
  });

  // 6. Balões: ponta solta dentro (ou junto) de um balão termina no centro dele.
  for (const a of arestas) for (const ponta of ["inicio", "fim"] as const) {
    if ((ponta === "inicio" ? a.noIni : a.noFim) !== null) continue;
    const e = ponta === "inicio" ? a.pts[0] : a.pts[a.pts.length - 1];
    const viz = ponta === "inicio" ? a.pts[1] : a.pts[a.pts.length - 2];
    const d = unit(sub(e, viz));
    // O balão da ponta é o que fica do lado de dentro dela (o centro não passa da ponta) e no alinhamento do eixo.
    let bi = -1, melhorD = Infinity;
    baloes.forEach((b, k) => {
      if (b.trecho !== null || b.raio <= a.largura / 2 + 1) return;
      const de = dist(e, b.centro), alem = pe(sub(b.centro, e), d), lateral = Math.abs(cruz(d, sub(b.centro, e)));
      if (de > b.raio + 2 || alem > 0.5 || lateral > b.raio * 0.5) return;
      if (de < melhorD) { melhorD = de; bi = k; }
    });
    if (bi < 0) continue;
    const b = baloes[bi];
    const q = soma(viz, esc(d, pe(sub(b.centro, viz), d)));
    if (ponta === "inicio") { a.pts[0] = q; a.balaoIni = bi; } else { a.pts[a.pts.length - 1] = q; a.balaoFim = bi; }
    b.trecho = a.id;
  }

  // 7. Junta trechos que só continuam em frente (nó de 2 braços quase alinhados).
  const bracosDo = (k: number) => arestas.flatMap((a, ia) => [...(a.noIni === k ? [{ ia, ponta: "inicio" as const }] : []), ...(a.noFim === k ? [{ ia, ponta: "fim" as const }] : [])]);
  const dirNoNo = (a: Aresta, ponta: "inicio" | "fim") => { const l = linha(a.pts); return ponta === "inicio" ? unit(sub(pontoEm(l, Math.min(4, l.total / 2)), a.pts[0])) : unit(sub(pontoEm(l, l.total - Math.min(4, l.total / 2)), a.pts[a.pts.length - 1])); };
  for (let k = 0; k < nosP.length; k++) {
    const bs = bracosDo(k);
    if (bs.length !== 2 || bs[0].ia === bs[1].ia) continue;
    const [x, y] = bs, ax = arestas[x.ia], ay = arestas[y.ia];
    if (Math.abs(ax.largura - ay.largura) > 0.5) continue;
    const dx = dirNoNo(ax, x.ponta), dy = dirNoNo(ay, y.ponta);
    if (pe(dx, dy) > -Math.cos((25 * Math.PI) / 180)) continue;
    // ax termina no nó e ay começa nele (invertendo quando preciso).
    const ptsX = x.ponta === "fim" ? ax.pts : [...ax.pts].reverse();
    const ptsY = y.ponta === "inicio" ? ay.pts : [...ay.pts].reverse();
    const ini = x.ponta === "fim" ? { no: ax.noIni, b: ax.balaoIni } : { no: ax.noFim, b: ax.balaoFim };
    const fim = y.ponta === "inicio" ? { no: ay.noFim, b: ay.balaoFim } : { no: ay.noIni, b: ay.balaoIni };
    const junta: Aresta = { ...ax, pts: [...ptsX, ...ptsY.slice(1)], noIni: ini.no, balaoIni: ini.b, noFim: fim.no, balaoFim: fim.b };
    arestas = arestas.filter((_, i) => i !== x.ia && i !== y.ia);
    arestas.push(junta);
  }
  arestas.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  arestas.forEach(a => { a.pts = limpar(a.pts); });
  arestas = arestas.filter(a => a.pts.length >= 2 && linha(a.pts).total >= 1);
  for (const b of baloes) b.trecho = null;
  arestas.forEach(a => { if (a.balaoIni !== null) baloes[a.balaoIni].trecho = a.id; if (a.balaoFim !== null) baloes[a.balaoFim].trecho = a.id; });

  // 8. Nós com braços ordenados pelo ângulo.
  type BracoInt = Braco & { ia: number };
  const nos: (No & { bracosInt: BracoInt[] })[] = [];
  const idNo = new Map<number, number>();
  for (let k = 0; k < nosP.length; k++) {
    const bs = bracosDo(k);
    if (bs.length < 2) {
      // Nó que ficou com um braço só: vira ponta solta.
      for (const b of bs) { const a = arestas[b.ia]; if (b.ponta === "inicio") a.noIni = null; else a.noFim = null; }
      continue;
    }
    const bracosInt: BracoInt[] = bs.map(b => {
      const a = arestas[b.ia], perfil = perfilDaVia(a.largura);
      return { trecho: a.id, ponta: b.ponta, dir: dirNoNo(a, b.ponta), largura: a.largura, meiaPista: perfil.pista / 2, ia: b.ia };
    }).sort((p, q) => ang(p.dir) - ang(q.dir));
    idNo.set(k, nos.length);
    nos.push({ id: `n${nos.length + 1}`, p: nosP[k], bracos: bracosInt.map(({ ia: _ia, ...b }) => b), bracosInt, tipo: bracosInt.length >= 3 ? "cruzamento" : "esquina", controle: "nenhum", preferencial: [] });
  }
  for (const a of arestas) {
    a.noIni = a.noIni === null ? null : idNo.get(a.noIni) ?? null;
    a.noFim = a.noFim === null ? null : idNo.get(a.noFim) ?? null;
  }

  // 9. Controle de cada cruzamento (critério documentado em LARGURA_VIA_PRINCIPAL).
  for (const no of nos) {
    if (no.tipo !== "cruzamento") continue;
    const bs = no.bracos;
    let principal = false;
    for (let i = 0; i < bs.length && !principal; i++) for (let j = i + 1; j < bs.length; j++) {
      const a = (Math.acos(Math.max(-1, Math.min(1, pe(bs[i].dir, bs[j].dir)))) * 180) / Math.PI;
      if (a >= 30 && a <= 150 && bs[i].largura >= LARGURA_VIA_PRINCIPAL && bs[j].largura >= LARGURA_VIA_PRINCIPAL) { principal = true; break; }
    }
    let par: number[] = [], nota = -Infinity;
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const alinh = -pe(bs[i].dir, bs[j].dir);
      if (alinh < Math.cos((30 * Math.PI) / 180)) continue;
      const v = bs[i].largura + bs[j].largura + alinh * 0.01;
      if (v > nota + 1e-9) { nota = v; par = [i, j]; }
    }
    if (!par.length) { const maior = bs.reduce((m, b, i) => (b.largura > bs[m].largura ? i : m), 0); par = [maior]; }
    no.preferencial = par;
    no.controle = principal ? "semaforo" : "pare";
  }

  // 10. Esquinas: centro do arredondamento, pontos de tangência (cortes) e contornos de cada canto.
  const varreduras: Varredura[] = [], placas: Placa[] = [];
  /** Corte (distância do nó ao fim do trecho) de cada lado de cada braço: [lado nMais, lado nMenos]. */
  const cortes = nos.map(no => no.bracosInt.map(() => [NaN, NaN] as [number, number]));
  type Canto = { tipo: "arco"; centro: Ponto; raio: number; t0: Ponto; t1: Ponto; ext: Ponto | null } | { tipo: "reto" } | { tipo: "reflexo" };
  const cantos: Canto[][] = nos.map(() => []);
  nos.forEach((no, kn) => {
    const bs = no.bracosInt, nb = bs.length;
    for (let k = 0; k < nb; k++) {
      const a = bs[k], b = bs[(k + 1) % nb];
      let phi = ang(b.dir) - ang(a.dir);
      while (phi <= 1e-6) phi += 2 * Math.PI;
      if (phi < (165 * Math.PI) / 180) {
        const la = arestas[a.ia], lb = arestas[b.ia];
        const compA = linha(la.pts).total, compB = linha(lb.pts).total;
        let raio = RAIO_ESQUINA, centro: Ponto | null = null;
        for (let tent = 0; tent < 4; tent++) {
          const c = intersecaoRetas(soma(no.p, esc(nMais(a.dir), a.meiaPista + raio)), a.dir, soma(no.p, esc(nMenos(b.dir), b.meiaPista + raio)), b.dir);
          if (!c) break;
          const ca = pe(sub(c, no.p), a.dir), cb = pe(sub(c, no.p), b.dir);
          centro = c;
          if (ca <= compA * 0.45 && cb <= compB * 0.45) break;
          raio *= 0.5; centro = null;
        }
        if (!centro) { cantos[kn].push({ tipo: "reto" }); continue; }
        const ca = pe(sub(centro, no.p), a.dir), cb = pe(sub(centro, no.p), b.dir);
        cortes[kn][k][0] = Math.max(0.2, ca);
        cortes[kn][(k + 1) % nb][1] = Math.max(0.2, cb);
        const calA = perfilDaVia(a.largura).calcada, calB = perfilDaVia(b.largura).calcada;
        const ext = intersecaoRetas(soma(no.p, esc(nMais(a.dir), a.meiaPista + calA)), a.dir, soma(no.p, esc(nMenos(b.dir), b.meiaPista + calB)), b.dir);
        cantos[kn].push({
          tipo: "arco", centro, raio,
          t0: soma(soma(no.p, esc(a.dir, ca)), esc(nMais(a.dir), a.meiaPista)),
          t1: soma(soma(no.p, esc(b.dir, cb)), esc(nMenos(b.dir), b.meiaPista)),
          ext: ext && dist(ext, no.p) < Math.max(a.largura, b.largura) * 3 ? ext : null,
        });
      } else if (phi <= (195 * Math.PI) / 180) cantos[kn].push({ tipo: "reto" });
      else cantos[kn].push({ tipo: "reflexo" });
    }
    // Lados sem arredondamento herdam o corte do outro lado do mesmo braço (fim reto).
    const padrao = Math.max(1, ...bs.map(b => b.meiaPista)) + 1;
    for (let k = 0; k < nb; k++) {
      const c = cortes[kn][k];
      if (Number.isNaN(c[0]) && Number.isNaN(c[1])) { c[0] = c[1] = padrao; }
      else if (Number.isNaN(c[0])) c[0] = c[1];
      else if (Number.isNaN(c[1])) c[1] = c[0];
    }
  });

  // 11. Geometria: perfil de um lado da via (do asfalto para fora).
  const colunasLado = (h: number, cal: number, fs: number) => {
    const lat = [h - LARGURA_SARJETA, h, h, h + TOPO_MEIO_FIO];
    const alt = [0, -0.01, ALTURA_MEIO_FIO, ALTURA_MEIO_FIO];
    const mat: (MaterialVia | null)[] = ["sarjeta", "meioFio", "meioFio"];
    if (fs > 0) { lat.push(h + TOPO_MEIO_FIO + fs); alt.push(ALTURA_MEIO_FIO); mat.push("servico"); }
    lat.push(h + cal, h + cal); alt.push(ALTURA_MEIO_FIO, -0.08); mat.push("piso", "meioFio");
    return { lat, alt, mat };
  };

  // Esquinas: varre o perfil ao longo do canto (arco, reta ou quina).
  nos.forEach((no, kn) => {
    const bs = no.bracosInt, nb = bs.length, contorno: Ponto[] = [];
    for (let k = 0; k < nb; k++) {
      const a = bs[k], b = bs[(k + 1) % nb], canto = cantos[kn][k];
      const pa = perfilDaVia(a.largura), pb = perfilDaVia(b.largura);
      const ca = cortes[kn][k][0], cb = cortes[kn][(k + 1) % nb][1];
      const fs = Math.min(pa.faixaServico, pb.faixaServico), cal = Math.min(pa.calcada, pb.calcada);
      const { lat, alt, mat } = colunasLado(0, cal, fs);
      // Linha do meio-fio e direção "para a calçada" em cada ponto.
      let meioFio: Ponto[], normais: Ponto[], externa: Ponto[] | null = null;
      const tA = soma(soma(no.p, esc(a.dir, ca)), esc(nMais(a.dir), a.meiaPista));
      const tB = soma(soma(no.p, esc(b.dir, cb)), esc(nMenos(b.dir), b.meiaPista));
      if (canto.tipo === "arco") {
        const a0 = ang(sub(canto.t0, canto.centro)), a1raw = ang(sub(canto.t1, canto.centro));
        // O arco vai pelo lado de dentro (voltado para o nó): o menor giro entre as tangências.
        let da = a1raw - a0;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        const n = Math.max(4, Math.ceil((Math.abs(da) * canto.raio) / 0.6));
        meioFio = []; normais = [];
        for (let i = 0; i <= n; i++) {
          const t = a0 + (da * i) / n, rad = { x: Math.cos(t), y: Math.sin(t) };
          meioFio.push(soma(canto.centro, esc(rad, canto.raio)));
          normais.push(esc(rad, -1)); // a calçada fica do lado do centro
        }
        const extA = soma(soma(no.p, esc(a.dir, ca)), esc(nMais(a.dir), a.meiaPista + pa.calcada));
        const extB = soma(soma(no.p, esc(b.dir, cb)), esc(nMenos(b.dir), b.meiaPista + pb.calcada));
        externa = reamostrar(canto.ext ? [extA, canto.ext, extB] : [extA, extB], n + 1);
      } else if (canto.tipo === "reto") {
        const n = Math.max(1, Math.ceil(dist(tA, tB) / 2));
        meioFio = reamostrar([tA, tB], n + 1);
        normais = meioFio.map(() => nMais(a.dir));
      } else {
        const q = intersecaoRetas(tA, a.dir, tB, b.dir) ?? esc(soma(tA, tB), 0.5);
        meioFio = [tA, q, tB];
        const nq = unit(soma(nMais(a.dir), nMenos(b.dir)));
        const cosm = Math.max(0.3, pe(nq, nMais(a.dir)));
        normais = [nMais(a.dir), esc(nq, 1 / cosm), nMenos(b.dir)];
      }
      const colunas = lat.map((l, c) => (c >= lat.length - 2 && externa) ? externa : meioFio.map((p, i) => soma(p, esc(normais[i], l))));
      // A calçada de fora vai até a largura da calçada de cada braço (podem ser diferentes).
      if (!externa && canto.tipo !== "arco") {
        for (const c of [lat.length - 2, lat.length - 1]) {
          const ext = colunas[c];
          ext[0] = soma(soma(no.p, esc(a.dir, ca)), esc(nMais(a.dir), a.meiaPista + pa.calcada));
          ext[ext.length - 1] = soma(soma(no.p, esc(b.dir, cb)), esc(nMenos(b.dir), b.meiaPista + pb.calcada));
          if (canto.tipo === "reflexo") ext[1] = intersecaoRetas(ext[0], a.dir, ext[2], b.dir) ?? ext[1];
        }
      }
      varreduras.push(montarVarredura(colunas, colunas.map((_, c) => colunas[c].map(() => alt[c])), mat));
      contorno.push(...colunas[0]);
    }
    if (contorno.length >= 3) placas.push({ contorno: limpar(contorno) });
  });

  // 12. Trechos: pista, lados, pintura e elementos.
  const trechos: Trecho[] = [], pinturas: Pintura[] = [], elementos: Elemento[] = [], pontas: PontaSemSaida[] = [];
  const lotesL = imp.lotes.filter(l => l.poligono.length >= 3);
  const postes: Elemento[] = [], arvores: Elemento[] = [];
  for (const a of arestas) {
    const l = linha(a.pts), perfil = perfilDaVia(a.largura), h = perfil.pista / 2, cal = perfil.calcada, fs = perfil.faixaServico;
    trechos.push({ id: a.id, nome: a.nome, eixo: a.pts.map(p => ({ x: r3(p.x), y: r3(p.y) })), largura: r3(a.largura), pista: r3(perfil.pista), calcada: r3(cal), faixaServico: r3(fs), origem: a.origem });
    // Corte de cada lado (lateral + e −) nas duas pontas; ponta solta = 0; balão = onde a coluna encontra o anel.
    type Ponta = { lado: (lat: number) => number; tipo: "no" | "balao" | "solta"; cruzamento: boolean; no?: number; braco?: number };
    const pontaDe = (qual: "inicio" | "fim"): Ponta => {
      const kn = qual === "inicio" ? a.noIni : a.noFim, bi = qual === "inicio" ? a.balaoIni : a.balaoFim;
      if (kn !== null) {
        const no = nos[kn], kb = no.bracosInt.findIndex(b => b.ia === arestas.indexOf(a) && b.ponta === qual);
        const [cMais, cMenos] = cortes[kn][kb];
        // No início, nMais do braço = lateral +; no fim, nMais = lateral −.
        const cPos = qual === "inicio" ? cMais : cMenos, cNeg = qual === "inicio" ? cMenos : cMais;
        // Fora do asfalto o fim é reto em cada lado; no asfalto, a reta que liga os dois lados (a boca da placa).
        const ha = Math.max(0.1, h - LARGURA_SARJETA);
        return { tipo: "no", cruzamento: no.tipo === "cruzamento", no: kn, braco: kb, lado: lat => (lat >= ha ? cPos : lat <= -ha ? cNeg : cNeg + ((cPos - cNeg) * (lat + ha)) / (2 * ha)) };
      }
      if (bi !== null) {
        const b = baloes[bi], rp = b.raio - cal;
        b.raioPista = r3(rp);
        // Raio do anel correspondente a cada lateral do perfil: anel e trecho se encontram exatamente.
        // No asfalto, a corda da boca do balão (a placa do balão fecha com essa mesma reta).
        const ha = h - LARGURA_SARJETA;
        return { tipo: "balao", cruzamento: false, lado: lat => { const al = Math.max(ha, Math.abs(lat)), rho = al - h + rp; return Math.sqrt(Math.max(0, rho * rho - al * al)); } };
      }
      return { tipo: "solta", cruzamento: false, lado: () => 0 };
    };
    const pi = pontaDe("inicio"), pf = pontaDe("fim");
    if (pi.tipo === "solta") pontas.push({ trecho: a.id, p: a.pts[0] });
    if (pf.tipo === "solta") pontas.push({ trecho: a.id, p: a.pts[a.pts.length - 1] });
    const s0 = (lat: number) => pi.lado(lat), s1 = (lat: number) => l.total - pf.lado(lat);
    const corteMax = (p: Ponta) => Math.max(p.lado(h), p.lado(-h), p.lado(h + cal), p.lado(-h - cal));
    const ini = corteMax(pi), fim = l.total - corteMax(pf);
    if (fim - ini < 0.3) continue;
    // Zona da faixa de pedestres (e rebaixo do meio-fio) em cada ponta de cruzamento.
    const FAIXA = 3, RECUO = 0.8, RETENCAO = 1.0;
    const zonas: [number, number][] = [];
    if (pi.cruzamento) zonas.push([ini + RECUO, ini + RECUO + FAIXA]);
    if (pf.cruzamento) zonas.push([fim - RECUO - FAIXA, fim - RECUO]);
    const rebaixo = (s: number) => {
      let f = 0;
      for (const [z0, z1] of zonas) f = Math.max(f, s >= z0 && s <= z1 ? 1 : s < z0 ? Math.max(0, 1 - (z0 - s) / 0.6) : Math.max(0, 1 - (s - z1) / 0.6));
      return f;
    };
    // Estações: no máximo meia célula da malha do terreno (para acompanhar o relevo sem atravessá-lo); no plano,
    // espaçadas; em trecho curvo, a cada 2 m. Mais as bordas das rampas do rebaixo.
    const ha0 = h - LARGURA_SARJETA;
    const passo = Math.min(a.pts.length > 2 ? 2 : 8, relevo ? Math.max(1, Math.min(3, Math.min(caixa.largura, caixa.comprimento) / LADO_MALHA / 2)) : 8);
    // Estações comuns a todas as colunas (cada coluna fica presa ao próprio início e fim: as pontas inclinadas
    // dos cruzamentos e balões saem certas), mais os vértices do eixo e as bordas das rampas.
    const sMin = Math.min(...[-h - cal, -h, -ha0, 0, ha0, h, h + cal].map(s0)), sMax = Math.max(...[-h - cal, -h, -ha0, 0, ha0, h, h + cal].map(s1));
    const marcos = new Set<number>();
    const n = Math.max(1, Math.ceil((sMax - sMin) / passo));
    for (let i = 0; i <= n; i++) marcos.add(sMin + ((sMax - sMin) * i) / n);
    for (let k = 1; k < l.pts.length - 1; k++) marcos.add(l.acum[k]);
    for (const [z0, z1] of zonas) for (const sz of [z0 - 0.6, z0, z1, z1 + 0.6]) marcos.add(sz);
    for (const lt of [-h - cal, -h - TOPO_MEIO_FIO - fs, -h - TOPO_MEIO_FIO, -h, -ha0, -ha0 / 3, ha0 / 3, ha0, h, h + TOPO_MEIO_FIO, h + TOPO_MEIO_FIO + fs, h + cal]) { marcos.add(s0(lt)); marcos.add(s1(lt)); }
    const estacoes = Array.from(marcos).filter(x => x >= sMin - 1e-9 && x <= sMax + 1e-9).sort((x, y) => x - y).filter((x, i, arr) => i === 0 || x - arr[i - 1] > 1e-4);
    const colunaEm = (lat: number) => estacoes.map(x => Math.min(s1(lat), Math.max(s0(lat), x)));
    const pos = (sx: number, lat: number) => deslocar(l, sx, lat);
    const abaul = (sx: number) => Math.min(1, Math.max(0, (sx - ini) / 4), Math.max(0, (fim - sx) / 4));
    // Pista (asfalto) com abaulamento: 7 colunas de borda a borda.
    const ha = ha0;
    if (ha > 0.2) {
      const lats = [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1].map(f => f * ha);
      const cols = lats.map(colunaEm);
      const colunas = cols.map((ss, c) => ss.map(sx => pos(sx, lats[c])));
      const alturas = cols.map((ss, c) => ss.map(sx => ABAULAMENTO * (1 - (lats[c] / ha) ** 2) * abaul(sx)));
      varreduras.push(montarVarredura(colunas, alturas, lats.slice(1).map(() => "asfalto" as const)));
    }
    // Lados: sarjeta, meio-fio (com rebaixo junto da faixa de pedestres), faixa de serviço e calçada.
    for (const lado of [1, -1]) {
      const { lat, alt, mat } = colunasLado(h, cal, fs);
      const cols = lat.map(lt => colunaEm(lt * lado));
      const colunas = cols.map((ss, c) => ss.map(sx => pos(sx, lat[c] * lado)));
      const alturas = cols.map((ss, c) => ss.map(sx => {
        // Rebaixo: o meio-fio desce a 2 cm e a rampa sobe pela faixa de serviço (ou pela calçada, se não houver).
        if (c === 2 || c === 3) return alt[c] - rebaixo(sx) * (ALTURA_MEIO_FIO - 0.02);
        return alt[c];
      }));
      varreduras.push({ ...montarVarredura(colunas, alturas, mat), tampas: { inicio: pi.tipo === "solta", fim: pf.tipo === "solta" } });
    }

    // Sinalização horizontal.
    const quad = (cor: Pintura["cor"], sa: number, sb: number, la: number, lb: number) => {
      for (let s = sa; s < sb - 1e-6; s += passo) {
        const e = Math.min(sb, s + passo);
        const p: [Ponto, Ponto, Ponto, Ponto] = [pos(s, la), pos(e, la), pos(e, lb), pos(s, lb)];
        const hh = (sx: number, lt: number) => ABAULAMENTO * Math.max(0, 1 - (lt / Math.max(0.2, ha)) ** 2) * abaul(sx) + ESPESSURA_TINTA;
        pinturas.push({ cor, p, h: [hh(s, la), hh(e, la), hh(e, lb), hh(s, lb)] });
      }
    };
    const iniP = ini + (pi.cruzamento ? RECUO + FAIXA + RETENCAO + 0.4 + 0.5 : 1);
    const fimP = fim - (pf.cruzamento ? RECUO + FAIXA + RETENCAO + 0.4 + 0.5 : 1);
    if (ha > 1.2) {
      if (pi.cruzamento) {
        for (let lt = -ha + 0.3; lt + 0.4 <= ha - 0.3 + 1e-6; lt += 0.8) quad("branca", ini + RECUO, ini + RECUO + FAIXA, lt, lt + 0.4);
        // Linha de retenção só na faixa de quem chega (lado nMenos do braço = lateral − no início).
        quad("branca", ini + RECUO + FAIXA + RETENCAO, ini + RECUO + FAIXA + RETENCAO + 0.4, -ha + 0.1, -0.1);
      }
      if (pf.cruzamento) {
        for (let lt = -ha + 0.3; lt + 0.4 <= ha - 0.3 + 1e-6; lt += 0.8) quad("branca", fim - RECUO - FAIXA, fim - RECUO, lt, lt + 0.4);
        quad("branca", fim - RECUO - FAIXA - RETENCAO - 0.4, fim - RECUO - FAIXA - RETENCAO, 0.1, ha - 0.1);
      }
    }
    if (fimP - iniP > 2 && ha > 1.2) {
      // Bordos brancos contínuos.
      quad("branca", iniP, fimP, ha - 0.25, ha - 0.15);
      quad("branca", iniP, fimP, -ha + 0.15, -ha + 0.25);
      if (perfil.pista >= 12) {
        // Avenida: eixo com duas linhas amarelas contínuas e divisão de faixas branca tracejada.
        quad("amarela", iniP, fimP, -0.2, -0.08);
        quad("amarela", iniP, fimP, 0.08, 0.2);
        for (const lt of [-ha / 2, ha / 2]) for (let s = iniP; s + 3 <= fimP; s += 8) quad("branca", s, s + 3, lt - 0.06, lt + 0.06);
      } else if (perfil.pista >= 5.5) {
        // Mão dupla: eixo amarelo tracejado (3 m pintados, 4 m de intervalo).
        for (let s = iniP; s + 3 <= fimP; s += 7) quad("amarela", s, s + 3, -0.06, 0.06);
      }
    }

    // Elementos: postes, árvores, placas e semáforos.
    const elem = (tipo: TipoElemento, s: number, lat: number, dirFrente: Ponto, extra: Partial<Elemento> = {}): Elemento => {
      const p = pos(s, lat);
      return { tipo, x: r3(p.x), y: r3(p.y), cota: r3(cota(p) + ELEVACAO + ALTURA_MEIO_FIO), giro: r3(Math.atan2(-dirFrente.y, dirFrente.x)), variante: 0, escala: 1, ...extra };
    };
    const folgaI = pi.cruzamento ? RECUO + FAIXA + RETENCAO + 3 : pi.tipo === "no" ? 2 : 1.5;
    const folgaF = pf.cruzamento ? RECUO + FAIXA + RETENCAO + 3 : pf.tipo === "no" ? 2 : 1.5;
    const livre0 = ini + folgaI, livre1 = fim - folgaF;
    const latPoste = h + TOPO_MEIO_FIO + 0.3;
    const meusPostes: { s: number; lado: number }[] = [];
    if (livre1 - livre0 > 4) {
      const lados = a.largura >= LARGURA_VIA_PRINCIPAL ? [1, -1] : [1];
      for (const lado of lados) {
        const desl = lado === 1 ? 0 : ESPACO_POSTE / 2;
        const qtd = Math.floor((livre1 - livre0 - desl) / ESPACO_POSTE) + 1;
        const sobra = livre1 - livre0 - desl - (qtd - 1) * ESPACO_POSTE;
        for (let k = 0; k < qtd; k++) {
          const s = livre0 + desl + sobra / 2 + k * ESPACO_POSTE;
          meusPostes.push({ s, lado });
          const t = tangenteEm(l, s), braco = esc(nMais(t), -lado);
          postes.push(elem("poste", s, latPoste * lado, braco, { variante: a.largura >= LARGURA_VIA_PRINCIPAL ? 1 : 0, escala: 1 }));
        }
      }
    }
    if (fs > 0 && livre1 - livre0 > 3) {
      const latArv = h + TOPO_MEIO_FIO + fs / 2;
      for (const lado of [1, -1]) {
        // Divisas dos lotes deste lado: a árvore fica na divisa, longe das entradas das garagens.
        const divisas: number[] = [];
        for (const lt of lotesL) for (const v of lt.poligono) {
          const pr = projetar(l, v);
          if (pr.s < livre0 || pr.s > livre1) continue;
          const lv = pr.lateral * lado;
          if (lv >= a.largura / 2 - 0.8 && lv <= a.largura / 2 + 2) divisas.push(pr.s);
        }
        divisas.sort((x, y) => x - y);
        const escolhidas: number[] = [];
        const longeDePoste = (s: number) => meusPostes.every(p => p.lado !== lado || Math.abs(p.s - s) > 2.5);
        for (const s of divisas) if ((!escolhidas.length || s - escolhidas[escolhidas.length - 1] >= ESPACO_ARVORE * 0.7) && longeDePoste(s)) escolhidas.push(s);
        // Completa os vãos grandes (ou o trecho todo, quando não há lotes) com o espaçamento regular.
        const marcos = [livre0 - ESPACO_ARVORE / 2, ...escolhidas, livre1 + ESPACO_ARVORE / 2];
        const todas = [...escolhidas];
        for (let k = 0; k < marcos.length - 1; k++) {
          const vao = marcos[k + 1] - marcos[k];
          if (vao < ESPACO_ARVORE * 1.8) continue;
          const qtd = Math.floor(vao / ESPACO_ARVORE) - 1;
          for (let j = 1; j <= qtd; j++) {
            const s = marcos[k] + (vao * j) / (qtd + 1);
            if (s >= livre0 && s <= livre1 && longeDePoste(s)) todas.push(s);
          }
        }
        todas.sort((x, y) => x - y).forEach((s, k) => {
          const rnd = semente(`${a.id}|${lado}|${k}`);
          const r1 = rnd(), r2 = rnd(), r3v = rnd(), r4 = rnd();
          arvores.push(elem("arvore", s, latArv * lado, { x: Math.cos(r4 * 6.283), y: Math.sin(r4 * 6.283) }, { variante: Math.floor(r1 * 3), escala: 0.8 + r2 * 0.45, tom: r3v }));
        });
      }
    }
    // Placas e semáforos nas chegadas aos cruzamentos.
    for (const [p, qual] of [[pi, "inicio"], [pf, "fim"]] as const) {
      if (!p.cruzamento || p.no === undefined || p.braco === undefined) continue;
      const no = nos[p.no];
      const preferencial = no.preferencial.includes(p.braco);
      if (no.controle === "pare" && preferencial) continue;
      const sRet = qual === "inicio" ? ini + RECUO + FAIXA + RETENCAO + 0.2 : fim - RECUO - FAIXA - RETENCAO - 0.2;
      // Quem chega anda em direção ao nó; a faixa dele é o lado nMenos do braço (lateral − no início, + no fim).
      const lado = qual === "inicio" ? -1 : 1;
      const dirBraco = no.bracos[p.braco].dir; // do nó para fora: a placa olha para quem vem
      if (no.controle === "semaforo") {
        elementos.push(elem("semaforo", sRet + (qual === "inicio" ? 0.4 : -0.4), (h + TOPO_MEIO_FIO + 0.35) * lado, esc(nMenos(dirBraco), -1), { estado: preferencial ? "verde" : "vermelho" }));
      } else {
        elementos.push(elem("pare", sRet, (h + TOPO_MEIO_FIO + 0.3) * lado, dirBraco));
      }
    }
  }

  // 13. Balões: anel (sarjeta, meio-fio, calçada) e placa de asfalto, com a boca casando com o trecho.
  baloes.forEach(b => {
    const a = arestas.find(x => x.id === b.trecho) ?? null;
    const largura = a?.largura ?? Math.min(12, b.raio);
    const perfil = perfilDaVia(largura), h = perfil.pista / 2, cal = perfil.calcada, fs = perfil.faixaServico;
    const rp = b.raio - cal;
    b.raioPista = r3(rp);
    if (rp <= h + 0.5) return;
    const { lat, alt, mat } = colunasLado(h, cal, fs);
    let th = 0;
    if (a) {
      const ponta = a.balaoIni !== null && baloes[a.balaoIni] === b ? 0 : a.pts.length - 1;
      const viz = ponta === 0 ? a.pts[1] : a.pts[a.pts.length - 2];
      th = ang(sub(viz, b.centro));
    }
    const nAng = 56;
    const colunas = lat.map(lt => {
      const rho = lt - h + rp, a0 = a ? Math.asin(Math.min(0.999, lt / rho)) : 0, a1 = a ? 2 * Math.PI - a0 : 2 * Math.PI;
      const out: Ponto[] = [];
      for (let i = 0; i <= nAng; i++) { const t = th + a0 + ((a1 - a0) * i) / nAng; out.push({ x: b.centro.x + rho * Math.cos(t), y: b.centro.y + rho * Math.sin(t) }); }
      return out;
    });
    varreduras.push(montarVarredura(colunas, colunas.map((c, k) => c.map(() => alt[k])), mat));
    placas.push({ contorno: colunas[0].slice(0, a ? undefined : -1) });
  });

  // 14. Árvores e postes com limite (desempenho), e nunca sobre a pista nem sobre outro elemento.
  const fixos = [...elementos];
  const longe = (e: Elemento, outros: Elemento[], d: number) => outros.every(o => Math.hypot(o.x - e.x, o.y - e.y) > d);
  const postesOk = postes.filter(p => longe(p, fixos, 2)).slice(0, LIMITE_POSTES);
  const arvoresOk = arvores.filter(t => longe(t, fixos, 3) && longe(t, postesOk, 2.5)).slice(0, LIMITE_ARVORES);
  elementos.push(...postesOk, ...arvoresOk);

  const extensao = trechos.reduce((s, t) => s + linha(t.eixo).total, 0);
  const nosOut: No[] = nos.map(({ bracosInt: _b, ...n }) => ({ ...n, p: { x: r3(n.p.x), y: r3(n.p.y) } }));
  return { trechos, nos: nosOut, baloes, pontas, varreduras, placas, pinturas, elementos, ruasSemGeometria, extensao: r3(extensao) };
}

/** Coordenadas de textura em metros: u ao longo da primeira coluna, v atravessando as colunas. */
function montarVarredura(colunas: Ponto[][], alturas: number[][], materiais: (MaterialVia | null)[]): Varredura {
  const u = colunas.map(col => { const out = [0]; for (let i = 1; i < col.length; i++) out.push(out[i - 1] + dist(col[i - 1], col[i])); return out; });
  const base = u[0];
  const uu = colunas.map(() => base.slice());
  const v = colunas.map((col, c) => col.map((p, i) => (c > 0 ? dist(colunas[c - 1][i], p) : 0)));
  for (let c = 1; c < v.length; c++) for (let i = 0; i < v[c].length; i++) v[c][i] += v[c - 1][i];
  return { colunas, alturas, materiais, u: uu, v };
}

// ── Conferências usadas pelos testes e pelo visualizador ──

/** Ponto dentro de polígono (par-ímpar). */
export function dentroDe(p: Ponto, pol: Ponto[]): boolean {
  let d = false;
  for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
    const a = pol[i], b = pol[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) d = !d;
  }
  return d;
}

/** Distância de um ponto ao contorno de um polígono. */
export function distanciaAoContorno(p: Ponto, pol: Ponto[]): number {
  let m = Infinity;
  for (let i = 0; i < pol.length; i++) {
    const a = pol[i], b = pol[(i + 1) % pol.length], ab = sub(b, a), t = Math.max(0, Math.min(1, pe(sub(p, a), ab) / (pe(ab, ab) || 1)));
    m = Math.min(m, dist(p, soma(a, esc(ab, t))));
  }
  return m;
}
