// Maquete 3D (EPIC-023, S-D — pedido do dono de 15/11/2026): leitor GEOMÉTRICO da planta, sem IA e sem custo.
// Trabalha sobre o que um PDF vetorial (exportado do CAD) guarda de verdade: linhas, arcos e textos.
//   escala  → texto "ESC. 1:50" (conferida pelas áreas escritas nos cômodos, quando existem);
//   paredes → pares de linhas paralelas com a distância de uma parede;
//   portas  → vão na parede com o arco da folha; janelas → vão com as linhas do caixilho; vão livre → só as ombreiras;
//   cômodos → regiões fechadas pelas paredes, com o nome e a área do texto que está dentro;
//   escadas → sequência regular de degraus.
// Regra do dono: nada é inventado. O que a prancha não traz sai como "estimado" ou vira pendência, e a pessoa
// confere na revisão. PDF escaneado (imagem) não tem linhas para ler: o motor avisa em vez de adivinhar.
import { FUNCOES_COMODO, type FuncaoComodo } from "../../shared/maquete-3d/modelo.js";

export type Segmento = { x1: number; y1: number; x2: number; y2: number };
export type Arco = { cx: number; cy: number; r: number };
export type Texto = { str: string; x: number; y: number; tam: number; largura: number };
/** Tudo em pontos do PDF (1/72 pol), com y para baixo, como a página é vista. */
export type Primitivas = { largura: number; altura: number; segmentos: Segmento[]; arcos: Arco[]; textos: Texto[]; imagens: number };

type Ponto = { x: number; y: number };
export type PlantaLida = {
  titulo: string; escala: number; escalaOrigem: "texto" | "areas" | "suposta";
  /** Canto da planta na página (pt) e metros por ponto: serve para alinhar a prancha ao fundo na revisão. */
  origemPt: Ponto; metrosPorPonto: number; larguraDaPaginaM: number; largura: number; comprimento: number;
  paredes: { id: string; ax: number; ay: number; bx: number; by: number; espessura: number; externa: boolean; confirmada: boolean }[];
  aberturas: { id: string; paredeId: string; tipo: "porta" | "janela" | "vao"; posicao: number; largura: number; altura: number; peitoril: number; entradaPrincipal: boolean; confirmada: boolean }[];
  comodos: { id: string; nome: string; funcao: FuncaoComodo; pontos: Ponto[]; areaInformada: number | null; confirmada: boolean }[];
  escadas: { id: string; tipo: "reta" | "em_u"; pontos: Ponto[]; inicio: Ponto; fim: Ponto; percurso: Ponto[]; largura: number; degraus: number; sobePara: string; confirmada: boolean }[];
  pendencias: string[];
  /** Quantos cômodos têm nome reconhecido e quão perto a área desenhada ficou da área escrita (1 = igual). */
  nomeados: number; razaoAreas: number | null;
};
export type Diagnostico = { segmentos: number; arcos: number; textos: number; imagens: number; escalas: number[]; plantas: number; motivo: string | null };

const PT_MM = 25.4 / 72;
export const metrosPorPonto = (escala: number) => (PT_MM * escala) / 1000;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

// ── Textos ──

export type Linha = { str: string; x: number; y: number; tam: number };

/** Junta os pedaços de texto da mesma linha (o PDF costuma quebrar "ESC." e "1:50" em itens separados). */
export function linhasDeTexto(textos: Texto[]): Linha[] {
  const itens = textos.filter(t => t.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const linhas: { itens: Texto[] }[] = [];
  for (const t of itens) {
    const l = linhas.find(c => { const u = c.itens[c.itens.length - 1]; return Math.abs(u.y - t.y) < Math.max(u.tam, t.tam) * 0.45 && t.x - (u.x + u.largura) < Math.max(u.tam, t.tam) * 1.6 && t.x >= u.x - 1; });
    if (l) l.itens.push(t); else linhas.push({ itens: [t] });
  }
  return linhas.map(({ itens: is }) => {
    const x0 = is[0].x, x1 = Math.max(...is.map(i => i.x + i.largura));
    return { str: is.map(i => i.str).join(" ").replace(/\s+/g, " ").trim(), x: (x0 + x1) / 2, y: is[0].y - is[0].tam * 0.35, tam: Math.max(...is.map(i => i.tam)) };
  });
}

/** Escalas escritas na prancha ("ESC. 1:50", "ESCALA 1/100", "1:75"). */
export function escalasDaPagina(linhas: Linha[]): { n: number; x: number; y: number }[] {
  const achadas: { n: number; x: number; y: number }[] = [];
  for (const l of linhas) {
    const m = /(?:ESC(?:ALA)?\.?\s*:?\s*)1\s*[:/]\s*(\d{1,4})\b/i.exec(l.str) ?? /^\s*1\s*[:/]\s*(\d{2,4})\s*$/.exec(l.str);
    const n = m ? Number(m[1]) : 0;
    if (n >= 10 && n <= 2000) achadas.push({ n, x: l.x, y: l.y });
  }
  return achadas;
}

const NOMES: [RegExp, FuncaoComodo][] = [
  [/\bSUITE|\bSUÍTE/, "suite"], [/\bQUARTO|\bDORM|\bQTO\b/, "quarto"], [/\bCLOSET/, "closet"],
  [/\bLAVABO/, "lavabo"], [/\bBANH|\bBWC|\bB\.?W\.?C|\bWC\b|\bW\.C|\bSANIT/, "banheiro"],
  [/JANTAR|\bCOPA\b/, "sala_jantar"], [/\bCOZINHA|\bCOZ\b/, "cozinha"], [/\bSALA|\bESTAR|\bLIVING|\bTV\b/, "sala"],
  [/SERVICO|\bLAVANDERIA|\bA\.?\s?S\.?\b/, "area_servico"], [/\bGARAGEM|\bABRIGO|\bVAGA/, "garagem"],
  [/\bVARANDA|\bSACADA|\bTERRACO|\bALPENDRE/, "varanda"], [/GOURMET|CHURRASQ/, "area_gourmet"],
  [/\bCIRCULA|\bCORREDOR|\bCIRC\b/, "circulacao"], [/\bHALL/, "hall"], [/\bESCRIT|\bHOME ?OFFICE|\bESTUDO/, "escritorio"],
  [/\bDESPENSA/, "despensa"], [/\bDEPOSITO|\bDEP\b/, "deposito"], [/\bLOJA|\bCOMERCIAL|\bSALAO/, "comercial"],
  [/\bJARDIM|\bQUINTAL|\bRECUO|\bPATIO/, "area_externa"],
];
export function funcaoDoNome(nome: string): FuncaoComodo | null {
  const n = semAcento(nome);
  for (const [re, f] of NOMES) if (re.test(n)) return FUNCOES_COMODO.includes(f) ? f : null;
  return null;
}
const areaDoTexto = (t: string): number | null => {
  const m = /(\d{1,4}(?:[.,]\d{1,2})?)\s*m\s*[²2]/i.exec(t);
  return m ? Number(m[1].replace(",", ".")) : null;
};

// ── Paredes ──

type Reta = { ang: number; rho: number; t0: number; t1: number; comp: number };
type Peca = { ang: number; rho: number; t0: number; t1: number; esp: number };
const BALDES = 180;

function emReta(s: Segmento): Reta {
  let dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  if (dx < 0 || (Math.abs(dx) < 1e-9 && dy < 0)) { dx = -dx; dy = -dy; }
  let graus = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (graus >= 179.5) graus -= 180;
  const balde = ((Math.round(graus) % BALDES) + BALDES) % BALDES, a = (balde * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  const t1 = s.x1 * c + s.y1 * sn, t2 = s.x2 * c + s.y2 * sn;
  return { ang: balde, rho: (-(s.x1 + s.x2) / 2) * sn + ((s.y1 + s.y2) / 2) * c, t0: Math.min(t1, t2), t1: Math.max(t1, t2), comp: Math.abs(t2 - t1) };
}
const ponto = (ang: number, rho: number, t: number): Ponto => { const a = (ang * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return { x: t * c - rho * s, y: t * s + rho * c }; };

/** Famílias de linhas paralelas iguais e igualmente espaçadas: degraus de escada (ou hachura). Saem da busca de paredes. */
function familias(retas: Reta[]): { membros: Set<Reta>; escadas: { ang: number; rhos: number[]; t0: number; t1: number }[] } {
  const membros = new Set<Reta>(), escadas: { ang: number; rhos: number[]; t0: number; t1: number }[] = [];
  const grupos = new Map<string, Reta[]>();
  for (const r of retas) {
    if (r.comp < 0.55 || r.comp > 3.2) continue;
    const k = `${r.ang}:${Math.round(r.t0 * 8)}:${Math.round(r.t1 * 8)}`;
    grupos.set(k, [...(grupos.get(k) ?? []), r]);
  }
  grupos.forEach(g => {
    if (g.length < 5) return;
    g.sort((a, b) => a.rho - b.rho);
    let ini = 0;
    for (let i = 1; i <= g.length; i++) {
      const passo = i < g.length ? g[i].rho - g[i - 1].rho : Infinity;
      const base = i - ini >= 2 ? g[ini + 1].rho - g[ini].rho : passo;
      if (i < g.length && passo >= 0.14 && passo <= 0.42 && Math.abs(passo - base) < 0.035) continue;
      if (i - ini >= 5) {
        const fam = g.slice(ini, i);
        fam.forEach(r => membros.add(r));
        escadas.push({ ang: fam[0].ang, rhos: fam.map(r => r.rho), t0: fam[0].t0, t1: fam[0].t1 });
      }
      ini = i;
    }
  });
  return { membros, escadas };
}

/** Pares de linhas paralelas com distância de parede → peças (eixo e espessura). */
function pecasDeParede(retas: Reta[]): Peca[] {
  const porAngulo = new Map<number, Reta[]>();
  for (const r of retas) if (r.comp >= 0.25) porAngulo.set(r.ang, [...(porAngulo.get(r.ang) ?? []), r]);
  const candidatas: Peca[] = [];
  porAngulo.forEach((lista, ang) => {
    lista.sort((a, b) => a.rho - b.rho);
    for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++) {
      const d = lista[j].rho - lista[i].rho;
      if (d > 0.36) break;
      if (d < 0.07) continue;
      const t0 = Math.max(lista[i].t0, lista[j].t0), t1 = Math.min(lista[i].t1, lista[j].t1);
      if (t1 - t0 >= 0.25) candidatas.push({ ang, rho: (lista[i].rho + lista[j].rho) / 2, t0, t1, esp: d });
    }
  });
  if (!candidatas.length) return [];
  // Espessuras dominantes (até duas: parede externa e interna), pelo comprimento somado em cada centímetro.
  const hist = new Map<number, number>();
  for (const c of candidatas) { const k = Math.round(c.esp * 100); hist.set(k, (hist.get(k) ?? 0) + (c.t1 - c.t0)); }
  const ordenado = Array.from(hist.entries()).sort((a, b) => b[1] - a[1]);
  const picos = [ordenado[0][0]];
  const segundo = ordenado.find(([k, peso]) => Math.abs(k - picos[0]) >= 4 && peso >= ordenado[0][1] * 0.2);
  if (segundo) picos.push(segundo[0]);
  return candidatas.filter(c => picos.some(p => Math.abs(c.esp * 100 - p) <= 2.5));
}

/** Une peças na mesma reta que se tocam; devolve os grupos colineares (já ordenados ao longo da reta). */
function colineares(pecas: Peca[]): Peca[][] {
  const grupos: Peca[][] = [];
  const ordenadas = [...pecas].sort((a, b) => a.ang - b.ang || a.rho - b.rho);
  for (const p of ordenadas) {
    const g = grupos.find(q => q[0].ang === p.ang && Math.abs(q[0].rho - p.rho) <= 0.05);
    if (g) g.push(p); else grupos.push([p]);
  }
  return grupos.map(g => {
    g.sort((a, b) => a.t0 - b.t0);
    const unidas: Peca[] = [];
    for (const p of g) {
      const u = unidas[unidas.length - 1];
      if (u && p.t0 <= u.t1 + 0.06) { u.t1 = Math.max(u.t1, p.t1); u.esp = Math.max(u.esp, p.esp); } else unidas.push({ ...p, rho: g[0].rho });
    }
    return unidas;
  });
}

type Parede = { a: Ponto; b: Ponto; esp: number; ang: number; rho: number; t0: number; t1: number; vaos: { t: number; largura: number; tipo: "porta" | "janela" | "vao" }[] };

/** Vãos entre peças da mesma reta: com arco é porta; com linhas de caixilho é janela; com ombreiras é vão livre. */
function paredesComVaos(grupos: Peca[][], retas: Reta[], curtas: Reta[], arcos: Arco[]): Parede[] {
  const paredes: Parede[] = [];
  for (const g of grupos) {
    let atual: Parede | null = null;
    const fechar = () => { if (atual && atual.t1 - atual.t0 >= 0.3) paredes.push(atual); atual = null; };
    for (const p of g) {
      if (!atual) { atual = { a: ponto(p.ang, p.rho, p.t0), b: ponto(p.ang, p.rho, p.t1), esp: p.esp, ang: p.ang, rho: p.rho, t0: p.t0, t1: p.t1, vaos: [] }; continue; }
      const anterior: Parede = atual;
      const vao = p.t0 - anterior.t1, meio = (anterior.t1 + p.t0) / 2, esp = Math.max(anterior.esp, p.esp);
      let tipo: "porta" | "janela" | "vao" | null = null;
      if (vao >= 0.5 && vao <= 4) {
        const pontas = [ponto(p.ang, p.rho, anterior.t1), ponto(p.ang, p.rho, p.t0)];
        const temArco = arcos.some(a => Math.abs(a.r - vao) <= Math.max(0.12, vao * 0.22) && pontas.some(q => Math.hypot(q.x - a.cx, q.y - a.cy) <= esp / 2 + 0.2));
        const caixilho = retas.filter(r => r.ang === p.ang && Math.abs(r.rho - p.rho) <= esp / 2 + 0.01 && Math.min(r.t1, p.t0) - Math.max(r.t0, anterior.t1) >= vao * 0.7).length;
        const perp = (p.ang + 90) % BALDES;
        const ombreiras = [anterior.t1, p.t0].filter(t => { const q = ponto(p.ang, p.rho, t); return curtas.some(r => r.ang === perp && Math.abs(r.comp - esp) <= esp * 0.5 && Math.abs(r.rho - (-q.x * Math.sin((perp * Math.PI) / 180) + q.y * Math.cos((perp * Math.PI) / 180))) <= 0.06 && Math.abs((r.t0 + r.t1) / 2 - (q.x * Math.cos((perp * Math.PI) / 180) + q.y * Math.sin((perp * Math.PI) / 180))) <= esp); }).length;
        tipo = temArco && vao <= 1.6 ? "porta" : caixilho >= 1 ? "janela" : ombreiras === 2 && vao <= 3 ? "vao" : temArco ? "porta" : null;
      }
      if (tipo) {
        anterior.vaos.push({ t: meio, largura: vao, tipo });
        anterior.t1 = p.t1; anterior.b = ponto(p.ang, p.rho, p.t1); anterior.esp = esp;
      } else { fechar(); atual = { a: ponto(p.ang, p.rho, p.t0), b: ponto(p.ang, p.rho, p.t1), esp: p.esp, ang: p.ang, rho: p.rho, t0: p.t0, t1: p.t1, vaos: [] }; }
    }
    fechar();
  }
  return paredes;
}

/** Leva cada ponta de parede até o eixo da parede que ela encontra (os cantos passam a fechar no eixo). */
function fecharCantos(paredes: Parede[]) {
  for (const w of paredes) for (const ponta of ["a", "b"] as const) {
    const e = w[ponta], outro = ponta === "a" ? w.b : w.a, comp = Math.hypot(e.x - outro.x, e.y - outro.y) || 1;
    const dx = (e.x - outro.x) / comp, dy = (e.y - outro.y) / comp;
    let melhor: { d: number; p: Ponto } | null = null;
    for (const v of paredes) {
      if (v === w || v.ang === w.ang) continue;
      const vx = v.b.x - v.a.x, vy = v.b.y - v.a.y, den = dx * vy - dy * vx;
      if (Math.abs(den) < 1e-6) continue;
      const s = ((v.a.x - e.x) * vy - (v.a.y - e.y) * vx) / den, u = ((v.a.x - e.x) * dy - (v.a.y - e.y) * dx) / den;
      const folga = (w.esp + v.esp) / 2 + 0.12, compV = Math.hypot(vx, vy);
      if (Math.abs(s) <= folga && u >= -folga / compV && u <= 1 + folga / compV && (!melhor || Math.abs(s) < Math.abs(melhor.d))) melhor = { d: s, p: { x: e.x + dx * s, y: e.y + dy * s } };
    }
    if (melhor) { e.x = melhor.p.x; e.y = melhor.p.y; }
  }
  for (const w of paredes) { // os vãos passam a ser medidos a partir da ponta `a` já ajustada
    const comp = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1, ux = (w.b.x - w.a.x) / comp, uy = (w.b.y - w.a.y) / comp;
    for (const v of w.vaos) { const q = ponto(w.ang, w.rho, v.t); v.t = (q.x - w.a.x) * ux + (q.y - w.a.y) * uy; }
  }
}

/** Agrupa as paredes que estão perto umas das outras: cada grupo é um desenho (uma planta, um corte...). */
function agrupar(paredes: Parede[]): Parede[][] {
  const pai = paredes.map((_, i) => i);
  const raiz = (i: number): number => (pai[i] === i ? i : (pai[i] = raiz(pai[i])));
  const caixa = (w: Parede, f: number) => ({ x0: Math.min(w.a.x, w.b.x) - f, x1: Math.max(w.a.x, w.b.x) + f, y0: Math.min(w.a.y, w.b.y) - f, y1: Math.max(w.a.y, w.b.y) + f });
  const caixas = paredes.map(w => caixa(w, 0.6));
  for (let i = 0; i < paredes.length; i++) for (let j = i + 1; j < paredes.length; j++) {
    const p = caixas[i], q = caixas[j];
    if (p.x0 <= q.x1 && q.x0 <= p.x1 && p.y0 <= q.y1 && q.y0 <= p.y1) pai[raiz(i)] = raiz(j);
  }
  const grupos = new Map<number, Parede[]>();
  paredes.forEach((w, i) => grupos.set(raiz(i), [...(grupos.get(raiz(i)) ?? []), w]));
  return Array.from(grupos.values());
}

// ── Cômodos (regiões fechadas pelas paredes) ──

const CELULA = 0.025;

function comodosDaPlanta(paredes: Parede[], linhas: Linha[], x0: number, y0: number, largura: number, comprimento: number) {
  const margem = 1, nx = Math.ceil((largura + margem * 2) / CELULA), ny = Math.ceil((comprimento + margem * 2) / CELULA);
  const grade = new Uint8Array(nx * ny); // 0 livre, 1 parede, 2 fora, 3+ região
  const cel = (x: number, y: number) => [Math.floor((x - x0 + margem) / CELULA), Math.floor((y - y0 + margem) / CELULA)] as const;
  for (const w of paredes) {
    const comp = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), ux = (w.b.x - w.a.x) / comp, uy = (w.b.y - w.a.y) / comp, meia = Math.max(w.esp / 2, CELULA * 0.8);
    for (let t = -meia; t <= comp + meia; t += CELULA / 2) for (let d = -meia; d <= meia + 1e-9; d += CELULA / 2) {
      const [i, j] = cel(w.a.x + ux * t - uy * d, w.a.y + uy * t + ux * d);
      if (i >= 0 && j >= 0 && i < nx && j < ny) grade[j * nx + i] = 1;
    }
  }
  const inundar = (i0: number, j0: number, marca: number): number => {
    if (grade[j0 * nx + i0] !== 0) return 0;
    const pilha = [j0 * nx + i0];
    grade[j0 * nx + i0] = marca;
    let n = 0;
    while (pilha.length) {
      const k = pilha.pop()!, i = k % nx, j = (k - i) / nx;
      n++;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= ny || grade[b * nx + a] !== 0) continue;
        grade[b * nx + a] = marca;
        pilha.push(b * nx + a);
      }
    }
    return n;
  };
  inundar(0, 0, 2);
  const regioes: { marca: number; celulas: number }[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (grade[j * nx + i] === 0 && regioes.length < 250) {
    const marca = regioes.length + 3, celulas = inundar(i, j, marca);
    regioes.push({ marca, celulas });
  }
  // Cada região avança parede adentro até o eixo: entre dois cômodos elas se encontram no meio da parede;
  // na parede externa, param na metade da espessura. Assim os contornos fecham no eixo, como no modelo.
  const dono = new Int32Array(nx * ny);
  let frente: number[] = [];
  for (let k = 0; k < grade.length; k++) if (grade[k] >= 3) { dono[k] = grade[k]; frente.push(k); }
  const passos = Math.ceil(Math.max(...paredes.map(w => w.esp)) / 2 / CELULA) + 1; // +1: a parede desenhada na grade ocupa até uma célula a mais
  for (let passo = 0; passo < passos && frente.length; passo++) {
    const nova: number[] = [];
    for (const k of frente) {
      const i = k % nx;
      for (const v of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) {
        if (v < 0 || v >= grade.length || grade[v] !== 1 || dono[v]) continue;
        dono[v] = dono[k];
        nova.push(v);
      }
    }
    frente = nova;
  }
  // Nós da planta: pontas e cruzamentos dos eixos das paredes. Os cantos dos cômodos são levados até eles.
  const nos: Ponto[] = [];
  for (let i = 0; i < paredes.length; i++) {
    const w = paredes[i];
    nos.push({ x: w.a.x - x0, y: w.a.y - y0 }, { x: w.b.x - x0, y: w.b.y - y0 });
    for (let j = i + 1; j < paredes.length; j++) {
      const v = paredes[j], d1x = w.b.x - w.a.x, d1y = w.b.y - w.a.y, d2x = v.b.x - v.a.x, d2y = v.b.y - v.a.y, den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((v.a.x - w.a.x) * d2y - (v.a.y - w.a.y) * d2x) / den, u = ((v.a.x - w.a.x) * d1y - (v.a.y - w.a.y) * d1x) / den;
      const f1 = 0.3 / Math.hypot(d1x, d1y), f2 = 0.3 / Math.hypot(d2x, d2y);
      if (t >= -f1 && t <= 1 + f1 && u >= -f2 && u <= 1 + f2) nos.push({ x: w.a.x + d1x * t - x0, y: w.a.y + d1y * t - y0 });
    }
  }
  const comodos: { nome: string; funcao: FuncaoComodo; pontos: Ponto[]; areaInformada: number | null; areaLida: number; nomeado: boolean }[] = [];
  for (const r of regioes) {
    const areaLida = r.celulas * CELULA * CELULA;
    if (areaLida < 0.8) continue;
    const dentro = linhas.filter(l => { const [i, j] = cel(l.x, l.y); return i >= 0 && j >= 0 && i < nx && j < ny && grade[j * nx + i] === r.marca; });
    const comNome = dentro.filter(l => funcaoDoNome(l.str)).sort((a, b) => b.tam - a.tam)[0];
    const outro = dentro.filter(l => /[A-Za-zÀ-ú]{3}/.test(l.str) && areaDoTexto(l.str) === null && !/^\s*[\d.,]+\s*$/.test(l.str)).sort((a, b) => b.tam - a.tam)[0];
    const areaInformada = dentro.map(l => areaDoTexto(l.str)).find(a => a !== null) ?? null;
    const rotulo = (comNome ?? outro)?.str.replace(/\s*\d{1,4}(?:[.,]\d{1,2})?\s*m\s*[²2].*$/i, "").trim();
    const pontos = encaixar(contorno(dono, nx, ny, r.marca).map(p => ({ x: p.x * CELULA - margem, y: p.y * CELULA - margem })), nos);
    if (pontos.length < 3) continue;
    comodos.push({
      nome: rotulo ? rotulo.charAt(0).toUpperCase() + rotulo.slice(1).toLowerCase() : `Ambiente ${comodos.length + 1}`,
      funcao: (rotulo && funcaoDoNome(rotulo)) || "outro", pontos, areaInformada, areaLida, nomeado: !!comNome,
    });
  }
  /** O ponto (em metros, na página) está fora da construção? Serve para saber quais paredes são externas. */
  const fora = (x: number, y: number) => { const [i, j] = cel(x, y); return i < 0 || j < 0 || i >= nx || j >= ny || grade[j * nx + i] === 2; };
  return { comodos, fora };
}

/** Contorno externo de uma região da grade (já levada até o eixo das paredes), simplificado. Coordenadas em células. */
function contorno(dono: Int32Array, nx: number, ny: number, marca: number): Ponto[] {
  const m = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && dono[j * nx + i] === marca;
  // Arestas da borda, orientadas com a região à direita, encadeadas em laços.
  const proximo = new Map<string, [number, number][]>();
  const aresta = (x1: number, y1: number, x2: number, y2: number) => { const k = `${x1},${y1}`; proximo.set(k, [...(proximo.get(k) ?? []), [x2, y2]]); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!m(i, j)) continue;
    if (!m(i, j - 1)) aresta(i, j, i + 1, j);
    if (!m(i + 1, j)) aresta(i + 1, j, i + 1, j + 1);
    if (!m(i, j + 1)) aresta(i + 1, j + 1, i, j + 1);
    if (!m(i - 1, j)) aresta(i, j + 1, i, j);
  }
  let melhor: Ponto[] = [];
  const usados = new Set<string>();
  proximo.forEach((_, inicio) => {
    if (usados.has(inicio)) return;
    const laco: Ponto[] = [];
    let k = inicio, anterior: [number, number] | null = null;
    for (let guarda = 0; guarda < 400000; guarda++) {
      const [x, y] = k.split(",").map(Number);
      laco.push({ x, y });
      usados.add(k);
      const saidas: [number, number][] = proximo.get(k) ?? [];
      if (!saidas.length) break;
      // Em vértice com duas saídas (regiões que se tocam na quina), segue virando à direita.
      const escolhida: [number, number] = saidas.length === 1 || !anterior ? saidas[0] : saidas.find(s => (x - anterior![0]) * (s[1] - y) - (y - anterior![1]) * (s[0] - x) > 0) ?? saidas[0];
      proximo.set(k, saidas.filter(s => s !== escolhida));
      anterior = [x, y];
      k = `${escolhida[0]},${escolhida[1]}`;
      if (k === inicio) break;
    }
    if (laco.length > melhor.length) melhor = laco;
  });
  return simplificar(melhor, 2.2).slice(0, 200);
}

/** Leva cada vértice ao nó de parede mais próximo (até 25 cm) e tira os repetidos e os alinhados. */
function encaixar(pts: Ponto[], nos: Ponto[]): Ponto[] {
  const presos = pts.map(p => {
    let melhor: Ponto | null = null, d = 0.25;
    for (const n of nos) { const q = Math.hypot(n.x - p.x, n.y - p.y); if (q < d) { d = q; melhor = n; } }
    return melhor ? { x: melhor.x, y: melhor.y } : p;
  });
  const semRepetir = presos.filter((p, i) => { const a = presos[(i + presos.length - 1) % presos.length]; return Math.hypot(p.x - a.x, p.y - a.y) > 0.03; });
  const limpos = semRepetir.filter((p, i) => {
    const a = semRepetir[(i + semRepetir.length - 1) % semRepetir.length], b = semRepetir[(i + 1) % semRepetir.length];
    const comp = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / comp > 0.04;
  });
  return limpos.length >= 3 ? limpos : semRepetir;
}

/** Tira os pontos alinhados e os dentes menores que `tol` células (Douglas-Peucker em laço fechado). */
function simplificar(pts: Ponto[], tol: number): Ponto[] {
  if (pts.length < 4) return pts;
  let longe = 0, maior = -1;
  pts.forEach((p, i) => { const d = Math.hypot(p.x - pts[0].x, p.y - pts[0].y); if (d > maior) { maior = d; longe = i; } });
  const dp = (lista: Ponto[]): Ponto[] => {
    if (lista.length < 3) return lista;
    const a = lista[0], b = lista[lista.length - 1], comp = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let idx = 0, dist = 0;
    for (let i = 1; i < lista.length - 1; i++) { const d = Math.abs((b.x - a.x) * (a.y - lista[i].y) - (a.x - lista[i].x) * (b.y - a.y)) / comp; if (d > dist) { dist = d; idx = i; } }
    return dist <= tol ? [a, b] : [...dp(lista.slice(0, idx + 1)).slice(0, -1), ...dp(lista.slice(idx))];
  };
  return [...dp(pts.slice(0, longe + 1)).slice(0, -1), ...dp([...pts.slice(longe), pts[0]]).slice(0, -1)];
}

// ── Montagem de uma planta ──

const TITULO = /PLANTA|PAVIMENTO|PAVTO|TERREO|SUPERIOR|INFERIOR|SUBSOLO|ANDAR|MEZANINO|COBERTURA|LAYOUT|TIPO/;
const NAO_E_PLANTA = /COBERTURA|TELHADO|SITUACAO|LOCACAO|IMPLANTACAO|CORTE|FACHADA|ELEVACAO|URBANISM|LOTEAMENTO/;

function plantasNaEscala(prim: Primitivas, linhasPt: Linha[], escala: number, origem: PlantaLida["escalaOrigem"]): PlantaLida[] {
  const k = metrosPorPonto(escala);
  const todas = prim.segmentos.map(s => emReta({ x1: s.x1 * k, y1: s.y1 * k, x2: s.x2 * k, y2: s.y2 * k }));
  const { membros, escadas: degraus } = familias(todas);
  const retas = todas.filter(r => !membros.has(r)), curtas = retas.filter(r => r.comp >= 0.06 && r.comp <= 0.45);
  const arcos = prim.arcos.map(a => ({ cx: a.cx * k, cy: a.cy * k, r: a.r * k })).filter(a => a.r >= 0.5 && a.r <= 1.6);
  const paredes = paredesComVaos(colineares(pecasDeParede(retas)), retas, curtas, arcos);
  const linhas = linhasPt.map(l => ({ ...l, x: l.x * k, y: l.y * k, tam: l.tam * k }));
  const plantas: PlantaLida[] = [];
  for (const grupo of agrupar(paredes)) {
    const total = grupo.reduce((s, w) => s + Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), 0);
    if (grupo.length < 4 || total < 10 || new Set(grupo.map(w => w.ang)).size < 2) continue;
    fecharCantos(grupo);
    const xs = grupo.flatMap(w => [w.a.x, w.b.x]), ys = grupo.flatMap(w => [w.a.y, w.b.y]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), largura = Math.max(...xs) - x0, comprimento = Math.max(...ys) - y0;
    if (largura < 2.5 || comprimento < 2.5 || largura > 150 || comprimento > 150) continue;
    const { comodos, fora } = comodosDaPlanta(grupo, linhas, x0, y0, largura, comprimento);
    const nomeados = comodos.filter(c => c.nomeado).length;
    if (!nomeados && comodos.length < 3) continue; // corte, fachada ou detalhe: não tem ambientes fechados com nome
    // Título: a linha com "PLANTA"/"PAVIMENTO" mais próxima do desenho (normalmente logo abaixo).
    const cx = x0 + largura / 2, base = y0 + comprimento;
    const titulos = linhas.filter(l => TITULO.test(semAcento(l.str)) && !funcaoDoNome(l.str))
      .map(l => ({ l, d: Math.hypot(l.x - cx, (l.y - base) * (l.y >= y0 ? 1 : 2)) })).sort((a, b) => a.d - b.d);
    const titulo = titulos[0] && titulos[0].d < Math.max(largura, comprimento) * 1.2 ? titulos[0].l.str.replace(/\s*-?\s*ESC(?:ALA)?\.?.*$/i, "").trim() : "";
    if (titulo && NAO_E_PLANTA.test(semAcento(titulo)) && !/BAIXA|PAVIMENTO|TERREO|SUPERIOR/.test(semAcento(titulo))) continue;

    const pendencias: string[] = [];
    const paredesLidas: PlantaLida["paredes"] = [], aberturas: PlantaLida["aberturas"] = [];
    grupo.forEach((w, i) => {
      const comp = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), ux = (w.b.x - w.a.x) / comp, uy = (w.b.y - w.a.y) / comp, lado = w.esp / 2 + 0.12;
      let externas = 0, amostras = 0;
      for (let t = 0.15; t < comp; t += 0.4) { amostras++; const px = w.a.x + ux * t, py = w.a.y + uy * t; if (fora(px - uy * lado, py + ux * lado) || fora(px + uy * lado, py - ux * lado)) externas++; }
      const externa = amostras > 0 && externas / amostras >= 0.5;
      const id = `w${i + 1}`;
      paredesLidas.push({ id, ax: r3(w.a.x - x0), ay: r3(w.a.y - y0), bx: r3(w.b.x - x0), by: r3(w.b.y - y0), espessura: r2(w.esp), externa, confirmada: origem !== "suposta" });
      for (const v of w.vaos) {
        const porta = v.tipo !== "janela";
        aberturas.push({ id: `a${aberturas.length + 1}`, paredeId: id, tipo: v.tipo, posicao: r3(Math.min(comp - v.largura / 2, Math.max(v.largura / 2, v.t))), largura: r2(v.largura),
          altura: porta ? 2.1 : 1.1, peitoril: porta ? 0 : 1, entradaPrincipal: false, confirmada: origem !== "suposta" });
      }
    });
    // Entrada principal: a porta mais larga em parede externa (no empate, a mais embaixo na prancha).
    const externas = new Map(paredesLidas.filter(w => w.externa).map(w => [w.id, w]));
    const candidata = aberturas.filter(a => a.tipo === "porta" && externas.has(a.paredeId))
      .sort((a, b) => b.largura - a.largura || Math.max(externas.get(b.paredeId)!.ay, externas.get(b.paredeId)!.by) - Math.max(externas.get(a.paredeId)!.ay, externas.get(a.paredeId)!.by))[0];
    if (candidata) candidata.entradaPrincipal = true;

    const escadas: PlantaLida["escadas"] = [];
    for (const d of degraus) {
      const a = ponto(d.ang, d.rhos[0], (d.t0 + d.t1) / 2), b = ponto(d.ang, d.rhos[d.rhos.length - 1], (d.t0 + d.t1) / 2);
      if (a.x < x0 - 0.5 || a.x > x0 + largura + 0.5 || a.y < y0 - 0.5 || a.y > y0 + comprimento + 0.5) continue;
      const q = [ponto(d.ang, d.rhos[0], d.t0), ponto(d.ang, d.rhos[0], d.t1), ponto(d.ang, d.rhos[d.rhos.length - 1], d.t1), ponto(d.ang, d.rhos[d.rhos.length - 1], d.t0)];
      const rel = (p: Ponto) => ({ x: r2(p.x - x0), y: r2(p.y - y0) });
      escadas.push({ id: `e${escadas.length + 1}`, tipo: "reta", pontos: q.map(rel), inicio: rel(a), fim: rel(b), percurso: [], largura: r2(Math.max(0.6, Math.min(3, d.t1 - d.t0))), degraus: d.rhos.length, sobePara: "", confirmada: false });
    }
    // Dois lances lado a lado formam uma escada em U.
    for (let i = 0; i < escadas.length; i++) for (let j = i + 1; j < escadas.length; j++) {
      const p = escadas[i], q = escadas[j];
      const lx = (e: typeof p) => [Math.min(...e.pontos.map(v => v.x)), Math.max(...e.pontos.map(v => v.x)), Math.min(...e.pontos.map(v => v.y)), Math.max(...e.pontos.map(v => v.y))];
      const [a0, a1, b0, b1] = lx(p), [c0, c1, d0, d1] = lx(q);
      const encostadas = (Math.abs(a1 - c0) < 0.35 || Math.abs(c1 - a0) < 0.35) && Math.min(b1, d1) - Math.max(b0, d0) > 0.5 || (Math.abs(b1 - d0) < 0.35 || Math.abs(d1 - b0) < 0.35) && Math.min(a1, c1) - Math.max(a0, c0) > 0.5;
      if (!encostadas) continue;
      const x = [Math.min(a0, c0), Math.max(a1, c1)], y = [Math.min(b0, d0), Math.max(b1, d1)];
      // Partida e chegada ficam na mesma ponta: a de cada lance que está mais perto da outra ponta do par.
      const pontaPerto = (e: typeof p, alvo: Ponto) => (Math.hypot(e.inicio.x - alvo.x, e.inicio.y - alvo.y) < Math.hypot(e.fim.x - alvo.x, e.fim.y - alvo.y) ? e.inicio : e.fim);
      const ini = pontaPerto(p, q.inicio), fim = pontaPerto(q, ini);
      escadas.splice(j, 1);
      escadas[i] = { ...p, tipo: "em_u", pontos: [{ x: x[0], y: y[0] }, { x: x[1], y: y[0] }, { x: x[1], y: y[1] }, { x: x[0], y: y[1] }], inicio: ini, fim, degraus: p.degraus + q.degraus };
      break;
    }
    if (escadas.length) pendencias.push("Escada lida pelos degraus: confira na revisão de que lado ela começa a subir.");

    const comAreas = comodos.filter(c => c.areaInformada && c.areaLida > 0.5).map(c => c.areaLida / c.areaInformada!).sort((a, b) => a - b);
    const razaoAreas = comAreas.length ? comAreas[Math.floor(comAreas.length / 2)] : null;
    plantas.push({
      titulo, escala, escalaOrigem: origem, origemPt: { x: r2(x0 / k), y: r2(y0 / k) }, metrosPorPonto: k, larguraDaPaginaM: r2(prim.largura * k), largura: r2(largura), comprimento: r2(comprimento),
      paredes: paredesLidas, aberturas,
      comodos: comodos.map((c, i) => ({ id: `c${i + 1}`, nome: c.nome.slice(0, 80), funcao: c.funcao, pontos: c.pontos.map(p => ({ x: r2(p.x), y: r2(p.y) })), areaInformada: c.areaInformada, confirmada: origem !== "suposta" && c.nomeado })),
      escadas, pendencias, nomeados, razaoAreas,
    });
  }
  return plantas;
}

const ESCALAS_COMUNS = [50, 100, 75, 25, 20, 125, 200];
const nota = (ps: PlantaLida[]) => ps.reduce((s, p) => s + p.nomeados * 3 + p.comodos.length + (p.razaoAreas !== null && Math.abs(Math.log(p.razaoAreas)) < 0.12 ? 10 : 0), 0);

/**
 * Lê as plantas baixas de uma página. A escala vem do texto da prancha; se as áreas escritas nos cômodos
 * mostrarem que ela está errada (ou se não houver escala escrita), é corrigida/achada pelas áreas.
 */
export function lerPagina(prim: Primitivas): { plantas: PlantaLida[]; diagnostico: Diagnostico } {
  const linhas = linhasDeTexto(prim.textos), escritas = Array.from(new Set(escalasDaPagina(linhas).map(e => e.n)));
  const diagnostico: Diagnostico = { segmentos: prim.segmentos.length, arcos: prim.arcos.length, textos: prim.textos.length, imagens: prim.imagens, escalas: escritas, plantas: 0, motivo: null };
  if (prim.segmentos.length < 40) {
    diagnostico.motivo = prim.imagens > 0 ? "A prancha é uma imagem (PDF escaneado ou fotografado): não há linhas para ler. Use o PDF exportado do programa de desenho (CAD/Revit), ou desenhe a planta na revisão." : "A página não tem desenho vetorial suficiente para uma planta.";
    return { plantas: [], diagnostico };
  }
  let melhor: PlantaLida[] = [];
  const tentar = (escala: number, origem: PlantaLida["escalaOrigem"]) => {
    let ps = plantasNaEscala(prim, linhas, escala, origem);
    // As áreas escritas mandam: se a planta desenhada dá, de forma consistente, outra área, a escala é ajustada.
    const razoes = ps.map(p => p.razaoAreas).filter((r): r is number => r !== null);
    if (razoes.length && razoes.every(r => Math.abs(Math.log(r / razoes[0])) < 0.1) && Math.abs(Math.log(razoes[0])) > 0.18) {
      const corrigida = Math.round(escala / Math.sqrt(razoes[0]));
      const alvo = ESCALAS_COMUNS.concat(escritas).sort((a, b) => Math.abs(a - corrigida) - Math.abs(b - corrigida))[0];
      const refeitas = plantasNaEscala(prim, linhas, Math.abs(alvo - corrigida) / corrigida < 0.08 ? alvo : corrigida, "areas");
      if (nota(refeitas) > nota(ps)) ps = refeitas;
    }
    if (nota(ps) > nota(melhor)) melhor = ps;
  };
  if (escritas.length) for (const e of escritas) tentar(e, "texto");
  else for (const e of ESCALAS_COMUNS) tentar(e, "suposta");
  for (const p of melhor) {
    if (p.escalaOrigem === "suposta") p.pendencias.push(`Escala não encontrada na prancha: foi usada 1:${p.escala}${p.razaoAreas !== null ? ", que confere com as áreas escritas" : ""}. Confira uma medida conhecida.`);
    if (p.escalaOrigem === "areas") p.pendencias.push(`A escala escrita não conferia com as áreas dos cômodos: foi usada 1:${p.escala}. Confira uma medida conhecida.`);
    if (p.razaoAreas !== null && Math.abs(Math.log(p.razaoAreas)) < 0.12 && p.escalaOrigem === "suposta") p.escalaOrigem = "areas";
  }
  diagnostico.plantas = melhor.length;
  if (!melhor.length) diagnostico.motivo = "Nenhuma planta baixa reconhecida nesta página (sem paredes em linha dupla formando ambientes fechados com nome).";
  return { plantas: melhor, diagnostico };
}

/** Nome do pavimento a partir do título da planta. */
export function nomeDoPavimento(titulo: string, ordem: number): { nome: string; andar: number | null } {
  const t = semAcento(titulo);
  if (/SUBSOLO/.test(t)) return { nome: "Subsolo", andar: -1 };
  if (/TERREO|TERREA/.test(t)) return { nome: "Térreo", andar: 0 };
  if (/SUPERIOR|2\s*[ºO°]?\s*PAV|SEGUNDO/.test(t)) return { nome: "Pavimento superior", andar: 1 };
  if (/MEZANINO/.test(t)) return { nome: "Mezanino", andar: 1 };
  const m = /(\d+)\s*[ºO°]?\s*(?:PAV|ANDAR)/.exec(t);
  if (m) return { nome: `${m[1]}º pavimento`, andar: Number(m[1]) - 1 };
  if (/TIPO/.test(t)) return { nome: "Pavimento-tipo", andar: 1 };
  return { nome: ordem === 0 ? "Térreo" : `Pavimento ${ordem + 1}`, andar: null };
}
