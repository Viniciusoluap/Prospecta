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
/** `pontas`: as duas pontas do arco, quando se sabe (a que fica sobre a parede é a folha fechada da porta). */
export type Arco = { cx: number; cy: number; r: number; pontas?: { x: number; y: number }[] };
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
  /** Tipo do desenho pelo título: planta baixa, planta de layout (a mesma planta com móveis) ou sem título reconhecido. */
  vista?: "planta" | "layout" | null;
};
export type Diagnostico = { segmentos: number; arcos: number; textos: number; imagens: number; escalas: number[]; plantas: number; motivo: string | null; tempoMs?: number };

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

// ── Títulos dos desenhos ──

/** O que o título diz que o desenho é. Só "planta" e "layout" viram pavimento; corte, fachada, cobertura e implantação, não. */
export type TipoVista = "planta" | "layout" | "outra";
const VISTA_OUTRA = /\bCORTES?\b|FACHADA|FAHCADA|FRONTAL|ELEVACA|\bVISTA\b|PERSPECTIVA|ISOMETRI|DETALHE|SITUACAO|LOCACAO|IMPLANTACAO|URBANIS|LOTEAMENTO|\bLOTES?\b|\bQUADRAS?\b|DIAGRAMA|ESQUEMA|TABELA|QUADRO DE|LEGENDA/;
const VISTA_TELHADO = /COBERTURA|TELHADO/;
const VISTA_LAYOUT = /LAYOUT|LAY-OUT|MOBILIAD|MOBILIARIO|HUMANIZ|DECORA/;
const VISTA_PLANTA = /PLANTA|PAVIMENTO|PAVTO|TERREO|TERREA|SUPERIOR|INFERIOR|SUBSOLO|ANDAR|MEZANINO/; // "TIPO" sozinho é campo do carimbo ("Tipo:"); "pavimento tipo" já cai em PAVIMENTO
export function tipoDaVista(titulo: string): TipoVista | null {
  const t = semAcento(titulo);
  if (VISTA_OUTRA.test(t)) return "outra";
  // "Planta de cobertura" é o telhado; "pavimento cobertura" (cobertura duplex) é um andar.
  if (VISTA_TELHADO.test(t) && !/BAIXA|PAVIMENTO|TERREO|SUPERIOR|DUPLEX/.test(t)) return "outra";
  if (VISTA_LAYOUT.test(t)) return "layout";
  if (VISTA_PLANTA.test(t)) return "planta";
  return null;
}

type Titulo = { str: string; x: number; y: number; tam: number; tipo: TipoVista | null; ancorado: boolean };

/**
 * Títulos dos desenhos da prancha. O mais confiável é o que tem a escala logo abaixo ("PLANTA BAIXA" / "1 : 50"),
 * como o Revit e os carimbos de CAD fazem; os que só batem pelo texto ("PLANTA BAIXA - TÉRREO") também contam.
 */
function titulosDaPagina(linhas: Linha[]): Titulo[] {
  const escalas = escalasDaPagina(linhas);
  const titulos: Titulo[] = [];
  for (const l of linhas) {
    if (!/[A-Za-zÀ-ú]{3}/.test(l.str) || areaDoTexto(l.str) !== null || funcaoDoNome(l.str)) continue;
    const propria = escalasDaPagina([l]).length > 0;
    const ancorado = propria || escalas.some(e => e.y - l.y > 0 && e.y - l.y <= l.tam * 4 && Math.abs(e.x - l.x) <= l.tam * 15);
    const str = l.str.replace(/\s*-?\s*ESC(?:ALA)?\.?\s*:?\s*1\s*[:/].*$/i, "").replace(/^\s*\d{1,2}\s+(?=[A-Za-zÀ-ú])/, "").trim();
    const tipo = tipoDaVista(str);
    if (str && (ancorado || tipo)) titulos.push({ str, x: l.x, y: l.y, tam: l.tam, tipo, ancorado });
  }
  return titulos;
}

/** Sinais de prancha de urbanismo/implantação (loteamento, quadro de lotes, nomes de rua). */
function pareceUrbanismo(linhas: Linha[]): boolean {
  const t = linhas.map(l => semAcento(l.str));
  return t.some(s => /LOTEAMENTO|URBANIS|IMPLANTACAO|TABELA DE AREAS\s*-?\s*LOTES|QUADRO DE LOTES/.test(s)) || t.filter(s => /^(RUA|AVENIDA|AV\.|TRAVESSA|ALAMEDA|ESTRADA|RODOVIA)\b/.test(s)).length >= 3;
}

// ── Arcos desenhados como polilinha ──

/**
 * O Revit (e vários CADs) exporta o arco da folha da porta como uma polilinha: vários trechos curtos e iguais,
 * encadeados, que viram sempre para o mesmo lado. Aqui eles voltam a ser arco (centro = dobradiça, raio = folha).
 * Só entram arcos de 45° a 120° (folha de porta); círculos e meias-luas de louças e móveis ficam de fora.
 */
export function arcosDePolilinhas(segs: Segmento[]): Arco[] {
  const arcos: Arco[] = [];
  const dir = (s: Segmento) => Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
  const comp = (s: Segmento) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  const giro = (a: Segmento, b: Segmento) => { let d = dir(b) - dir(a); while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  const fechar = (ini: number, fim: number) => { // trechos ini..fim (inclusive)
    const n = fim - ini + 1;
    if (n < 4) return;
    let total = 0;
    for (let i = ini + 1; i <= fim; i++) total += giro(segs[i - 1], segs[i]);
    const varrido = Math.abs(total) * (n / (n - 1)); // cada trecho cobre um passo de giro
    if (varrido < (45 * Math.PI) / 180 || varrido > (120 * Math.PI) / 180) return;
    const p0 = { x: segs[ini].x1, y: segs[ini].y1 }, pm = { x: segs[ini + (n >> 1)].x1, y: segs[ini + (n >> 1)].y1 }, p1 = { x: segs[fim].x2, y: segs[fim].y2 };
    const d = 2 * (p0.x * (pm.y - p1.y) + pm.x * (p1.y - p0.y) + p1.x * (p0.y - pm.y));
    if (Math.abs(d) < 1e-9) return;
    const q = (p: Ponto) => p.x * p.x + p.y * p.y;
    const cx = (q(p0) * (pm.y - p1.y) + q(pm) * (p1.y - p0.y) + q(p1) * (p0.y - pm.y)) / d;
    const cy = (q(p0) * (p1.x - pm.x) + q(pm) * (p0.x - p1.x) + q(p1) * (pm.x - p0.x)) / d;
    const r = Math.hypot(p0.x - cx, p0.y - cy);
    for (let i = ini; i <= fim; i++) if (Math.abs(Math.hypot(segs[i].x2 - cx, segs[i].y2 - cy) - r) > r * 0.04) return;
    if (arcos.length < 20000) arcos.push({ cx, cy, r, pontas: [p0, p1] });
  };
  let ini = 0, passo = 0;
  for (let i = 1; i <= segs.length; i++) {
    const a = segs[i - 1], b = segs[i];
    let segue = false;
    if (b && Math.hypot(b.x1 - a.x2, b.y1 - a.y2) < 0.05) {
      const ca = comp(segs[ini]), cb = comp(b), g = giro(a, b);
      const grau = Math.PI / 180;
      segue = ca > 0.2 && Math.abs(cb - ca) <= ca * 0.2 && Math.abs(g) >= 2 * grau && Math.abs(g) <= 30 * grau && (i - 1 === ini || (Math.sign(g) === Math.sign(passo) && Math.abs(g - passo) <= Math.abs(passo) * 0.35 + 0.5 * grau));
      if (segue && i - 1 === ini) passo = g;
    }
    if (!segue) { fechar(ini, i - 1); ini = i; passo = 0; }
  }
  return arcos;
}

// ── Paredes ──

type Reta = { ang: number; rho: number; t0: number; t1: number; comp: number };
type Peca = { ang: number; rho: number; t0: number; t1: number; esp: number };
const BALDES = 180;
const PECA_MIN = 0.12;
const MAX_CANDIDATAS = 400_000;

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
  // Pedaços a partir de 12 cm: os montantes entre uma porta e uma janela (ou junto de um canto) costumam ser curtos.
  for (const r of retas) if (r.comp >= PECA_MIN) porAngulo.set(r.ang, [...(porAngulo.get(r.ang) ?? []), r]);
  const candidatas: Peca[] = [];
  porAngulo.forEach((lista, ang) => {
    lista.sort((a, b) => a.rho - b.rho);
    for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++) {
      const d = lista[j].rho - lista[i].rho;
      if (d > 0.36) break;
      if (d < 0.07) continue;
      const t0 = Math.max(lista[i].t0, lista[j].t0), t1 = Math.min(lista[i].t1, lista[j].t1);
      if (t1 - t0 >= PECA_MIN) candidatas.push({ ang, rho: (lista[i].rho + lista[j].rho) / 2, t0, t1, esp: d });
      if (candidatas.length > MAX_CANDIDATAS) return;
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

type Vao = { t: number; largura: number; tipo: "porta" | "janela" | "vao" };
type Parede = { a: Ponto; b: Ponto; esp: number; ang: number; rho: number; t0: number; t1: number; vaos: Vao[] };
type Contexto = { retas: Reta[]; curtas: Reta[]; arcos: Arco[] };

/** Portas que os arcos de folha marcam dentro do trecho [tA, tB] da reta da parede (uma por arco; duas folhas que se encontram viram uma porta). */
function portasPelosArcos(ang: number, rho: number, esp: number, tA: number, tB: number, arcos: Arco[]): [number, number][] {
  const a = (ang * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const tDe = (p: Ponto) => p.x * c + p.y * s, rhoDe = (p: Ponto) => -p.x * s + p.y * c;
  const faixas: [number, number][] = [];
  for (const arco of arcos) {
    if (arco.r < 0.5 || arco.r > 1.25 || Math.abs(rhoDe({ x: arco.cx, y: arco.cy }) - rho) > esp / 2 + 0.2) continue;
    const tc = tDe({ x: arco.cx, y: arco.cy });
    if (tc < tA - 0.3 || tc > tB + 0.3) continue;
    let lados: number[] = [1, -1];
    if (arco.pontas?.length) {
      // A ponta que fica sobre a parede é a folha fechada: diz para que lado da dobradiça a porta abre.
      const fechada = [...arco.pontas].sort((p, q) => Math.abs(rhoDe(p) - rho) - Math.abs(rhoDe(q) - rho))[0];
      if (Math.abs(rhoDe(fechada) - rho) > esp / 2 + 0.25) continue;
      lados = [Math.sign(tDe(fechada) - tc) || 1];
    }
    const opcoes = lados.map(l => [Math.min(tc, tc + l * arco.r), Math.max(tc, tc + l * arco.r)] as [number, number])
      .map(f => ({ f, dentro: Math.min(f[1], tB) - Math.max(f[0], tA) })).sort((p, q) => q.dentro - p.dentro);
    if (opcoes[0].dentro >= arco.r * 0.6) faixas.push([Math.max(tA, opcoes[0].f[0]), Math.min(tB, opcoes[0].f[1])]);
  }
  faixas.sort((p, q) => p[0] - q[0]);
  const unidas: [number, number][] = [];
  for (const f of faixas) { const u = unidas[unidas.length - 1]; if (u && f[0] <= u[1] + 0.1) u[1] = Math.max(u[1], f[1]); else unidas.push([...f]); }
  return unidas;
}

/**
 * O que é o vão [tA, tB] na reta da parede: com arco é porta; com linhas de caixilho é janela; com ombreiras é vão livre.
 * Um vão com mais de uma porta (portas vizinhas cujo montante entre elas não aparece) é repartido pelos arcos.
 * `naPonta`: vão entre a ponta da parede e uma parede perpendicular — ali não há ombreira do outro lado, então vão livre não conta.
 */
function classificarVao(ang: number, rho: number, esp: number, tA: number, tB: number, ctx: Contexto, naPonta: boolean): Vao[] | null {
  const vao = tB - tA;
  if (vao < 0.4 || vao > 4) return null;
  const pontas = [ponto(ang, rho, tA), ponto(ang, rho, tB)];
  const temArco = ctx.arcos.some(a => Math.abs(a.r - vao) <= Math.max(0.12, vao * 0.22) && pontas.some(q => Math.hypot(q.x - a.cx, q.y - a.cy) <= esp / 2 + 0.2));
  if (temArco && vao <= 1.6 && vao >= 0.5) return [{ t: (tA + tB) / 2, largura: vao, tipo: "porta" }];
  // Caixilho: pelo menos duas linhas ao longo do vão, dentro da espessura (uma linha só pode ser a junta do piso).
  const caixilhoEm = (u0: number, u1: number) => new Set(ctx.retas.filter(r => r.ang === ang && Math.abs(r.rho - rho) <= esp / 2 + 0.01 && Math.min(r.t1, u1) - Math.max(r.t0, u0) >= (u1 - u0) * 0.7).map(r => Math.round(r.rho * 200))).size >= 2;
  const portas = portasPelosArcos(ang, rho, esp, tA, tB, ctx.arcos);
  if (portas.length) {
    const vaos: Vao[] = [];
    let ini = tA;
    portas.forEach(([p0, p1], i) => {
      const fim = i + 1 < portas.length ? portas[i + 1][0] : tB;
      // Montante de menos de 20 cm entre a folha e a ombreira é batente: entra na largura da porta.
      if (p0 - ini < 0.2) p0 = ini;
      if (fim - p1 < 0.2) p1 = fim;
      if (p0 - ini >= 0.4 && caixilhoEm(ini, p0)) vaos.push({ t: (ini + p0) / 2, largura: p0 - ini, tipo: "janela" });
      vaos.push({ t: (p0 + p1) / 2, largura: p1 - p0, tipo: "porta" });
      ini = p1;
    });
    if (tB - ini >= 0.4 && caixilhoEm(ini, tB)) vaos.push({ t: (ini + tB) / 2, largura: tB - ini, tipo: "janela" });
    return vaos;
  }
  if (vao < 0.5) return null;
  if (caixilhoEm(tA, tB)) return [{ t: (tA + tB) / 2, largura: vao, tipo: "janela" }];
  if (!naPonta && vao <= 3) {
    const perp = (ang + 90) % BALDES, pr = (perp * Math.PI) / 180;
    const ombreiras = [tA, tB].filter(t => { const q = ponto(ang, rho, t); return ctx.curtas.some(r => r.ang === perp && Math.abs(r.comp - esp) <= esp * 0.5 && Math.abs(r.rho - (-q.x * Math.sin(pr) + q.y * Math.cos(pr))) <= 0.06 && Math.abs((r.t0 + r.t1) / 2 - (q.x * Math.cos(pr) + q.y * Math.sin(pr))) <= esp); }).length;
    if (ombreiras === 2) return [{ t: (tA + tB) / 2, largura: vao, tipo: "vao" }];
  }
  return temArco && vao >= 0.5 ? [{ t: (tA + tB) / 2, largura: vao, tipo: "porta" }] : null;
}

/** Vãos entre peças da mesma reta (ver `classificarVao`): a parede continua através deles. */
function paredesComVaos(grupos: Peca[][], ctx: Contexto): Parede[] {
  const paredes: Parede[] = [];
  for (const g of grupos) {
    let atual: Parede | null = null;
    const fechar = () => { if (atual && atual.t1 - atual.t0 >= 0.3) paredes.push(atual); atual = null; };
    for (const p of g) {
      if (!atual) { atual = { a: ponto(p.ang, p.rho, p.t0), b: ponto(p.ang, p.rho, p.t1), esp: p.esp, ang: p.ang, rho: p.rho, t0: p.t0, t1: p.t1, vaos: [] }; continue; }
      const anterior: Parede = atual, esp = Math.max(anterior.esp, p.esp);
      const vaos = classificarVao(p.ang, p.rho, esp, anterior.t1, p.t0, ctx, false);
      if (vaos) {
        anterior.vaos.push(...vaos);
        anterior.t1 = p.t1; anterior.b = ponto(p.ang, p.rho, p.t1); anterior.esp = esp;
      } else { fechar(); atual = { a: ponto(p.ang, p.rho, p.t0), b: ponto(p.ang, p.rho, p.t1), esp: p.esp, ang: p.ang, rho: p.rho, t0: p.t0, t1: p.t1, vaos: [] }; }
    }
    fechar();
  }
  vaosNasPontas(paredes, ctx);
  return paredes;
}

/**
 * Porta ou janela junto de um canto: a parede para na ombreira e o vão vai até a face da parede perpendicular, sem
 * outra peça da mesma reta do outro lado. Quando o arco (ou o caixilho) mostra a abertura, a parede é levada até a
 * perpendicular com o vão dentro; sem esse sinal, a ponta fica como está (pode ser só uma passagem aberta).
 */
function vaosNasPontas(paredes: Parede[], ctx: Contexto) {
  for (const w of paredes) for (const lado of [1, -1] as const) {
    const a = (w.ang * Math.PI) / 180, ux = Math.cos(a) * lado, uy = Math.sin(a) * lado;
    const e = lado === 1 ? w.b : w.a;
    let melhor: { d: number; esp: number } | null = null;
    for (const v of paredes) {
      if (v === w || v.ang === w.ang) continue;
      const vx = v.b.x - v.a.x, vy = v.b.y - v.a.y, den = ux * vy - uy * vx;
      if (Math.abs(den) < 1e-6) continue;
      const d = ((v.a.x - e.x) * vy - (v.a.y - e.y) * vx) / den, u = ((v.a.x - e.x) * uy - (v.a.y - e.y) * ux) / den, folga = v.esp / Math.hypot(vx, vy);
      if (d > v.esp / 2 + 0.35 && d <= 2.6 + v.esp / 2 && u >= -folga && u <= 1 + folga && (!melhor || d < melhor.d)) melhor = { d, esp: v.esp };
    }
    if (!melhor) continue;
    const alvo = (lado === 1 ? w.t1 : w.t0) + lado * melhor.d, face = alvo - (lado * melhor.esp) / 2;
    const r0 = lado === 1 ? w.t1 : alvo, r1 = lado === 1 ? alvo : w.t0;
    const ocupado = paredes.some(v => v !== w && v.ang === w.ang && Math.abs(v.rho - w.rho) <= 0.05 && Math.min(v.t1, r1) - Math.max(v.t0, r0) > 0.05);
    if (ocupado) continue;
    const vaos = lado === 1 ? classificarVao(w.ang, w.rho, w.esp, w.t1, face, ctx, true) : classificarVao(w.ang, w.rho, w.esp, face, w.t0, ctx, true);
    if (!vaos) continue;
    w.vaos.push(...vaos);
    if (lado === 1) { w.t1 = alvo; w.b = ponto(w.ang, w.rho, alvo); } else { w.t0 = alvo; w.a = ponto(w.ang, w.rho, alvo); }
  }
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
/** Grade maior que isto (≈ 75 × 75 m em células de 2,5 cm) não é planta de casa/prédio: é implantação. */
const MAX_CELULAS = 9_000_000;

/** Rótulo de cômodo: o nome ("QUARTO 01") com a área escrita logo abaixo ("A= 9,00 m²"), ou só a área. */
type Rotulo = { nome: string | null; area: number | null; x: number; y: number; tam: number };
function rotulosDosComodos(linhas: Linha[]): Rotulo[] {
  const rotulos: Rotulo[] = linhas.filter(l => funcaoDoNome(l.str)).map(l => ({ nome: l.str, area: areaDoTexto(l.str), x: l.x, y: l.y, tam: l.tam }));
  for (const l of linhas) {
    const area = areaDoTexto(l.str);
    if (area === null || funcaoDoNome(l.str)) continue;
    const dono = rotulos.filter(r => r.nome && r.area === null && l.y - r.y > -r.tam * 0.5 && l.y - r.y <= r.tam * 3.5 && Math.abs(l.x - r.x) <= Math.max(1.2, r.tam * 8))
      .sort((p, q) => Math.hypot(p.x - l.x, p.y - l.y) - Math.hypot(q.x - l.x, q.y - l.y))[0];
    if (dono) dono.area = area; else rotulos.push({ nome: null, area, x: l.x, y: l.y, tam: l.tam });
  }
  return rotulos;
}

function comodosDaPlanta(paredes: Parede[], linhas: Linha[], retas: Reta[], x0: number, y0: number, largura: number, comprimento: number) {
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
  const marcarRegioes = () => {
    const rs: { marca: number; celulas: number }[] = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (grade[j * nx + i] === 0 && rs.length < 250) {
      const marca = rs.length + 3, celulas = inundar(i, j, marca);
      rs.push({ marca, celulas });
    }
    return rs;
  };
  let regioes = marcarRegioes();
  /** Célula da região onde está o rótulo; texto que caiu em cima de uma linha (louça, móvel) procura a região a até 30 cm. */
  const celulaDe = (x: number, y: number): number => {
    const [i0, j0] = cel(x, y);
    if (i0 < 0 || j0 < 0 || i0 >= nx || j0 >= ny || grade[j0 * nx + i0] === 2) return -1;
    for (let raio = 0; raio <= Math.round(0.3 / CELULA); raio++) {
      let melhor = -1, dm = Infinity;
      for (let dj = -raio; dj <= raio; dj++) for (let di = -raio; di <= raio; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== raio) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny || grade[j * nx + i] < 3) continue;
        if (di * di + dj * dj < dm) { dm = di * di + dj * dj; melhor = j * nx + i; }
      }
      if (melhor >= 0) return melhor;
    }
    return -1;
  };
  const rotulos = rotulosDosComodos(linhas.filter(l => l.x >= x0 && l.x <= x0 + largura && l.y >= y0 && l.y <= y0 + comprimento)).map(r => ({ r, k: celulaDe(r.x, r.y) }));
  const divisoes = dividirAmbientes();
  if (divisoes.length) { for (let k = 0; k < grade.length; k++) if (grade[k] >= 3) grade[k] = 0; regioes = marcarRegioes(); }

  /**
   * Ambientes abertos entre si (cozinha integrada à sala, área de serviço aberta para o quintal) saem do flood fill
   * como uma região só. Quando uma região tem dois ou mais rótulos — ou um rótulo só, com área escrita muito menor que
   * a desenhada — ela é dividida por linhas que já estão no desenho: primeiro o prolongamento de um toco de parede até
   * a parede em frente; depois uma linha desenhada de parede a parede (troca de piso, soleira). Fica a divisão que
   * separa os rótulos e deixa a área de cada parte mais perto da escrita. Nada é dividido sem essa evidência.
   */
  function dividirAmbientes(): Ponto[][] {
    const n = grade.length, selo = new Int32Array(n), parte = new Int32Array(n), bloq = new Int32Array(n);
    let rodada = 0;
    const porMarca = new Map<number, number[]>();
    for (let k = 0; k < n; k++) if (grade[k] >= 3) { const l = porMarca.get(grade[k]); if (l) l.push(k); else porMarca.set(grade[k], [k]); }
    const avaliar = (m: number, extra: number[], rots: { r: Rotulo; k: number }[]): number => {
      rodada++;
      for (const k of extra) bloq[k] = rodada;
      if (rots.some(x => bloq[x.k] === rodada)) return Infinity; // divisão passando em cima do rótulo
      const tamanhos: number[] = [];
      for (const k0 of porMarca.get(m) ?? []) {
        if (grade[k0] !== m || bloq[k0] === rodada || selo[k0] === rodada) continue;
        const id = tamanhos.length, pilha = [k0];
        let cont = 0;
        selo[k0] = rodada; parte[k0] = id;
        while (pilha.length) {
          const k = pilha.pop()!, i = k % nx;
          cont++;
          for (const v of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) {
            if (v < 0 || v >= n || grade[v] !== m || bloq[v] === rodada || selo[v] === rodada) continue;
            selo[v] = rodada; parte[v] = id; pilha.push(v);
          }
        }
        tamanhos.push(cont);
      }
      const porParte = new Map<number, Rotulo[]>();
      for (const x of rots) porParte.set(parte[x.k], [...(porParte.get(parte[x.k]) ?? []), x.r]);
      let nota = 0;
      porParte.forEach((rs, p) => {
        const area = tamanhos[p] * CELULA * CELULA;
        if (area < 0.5) nota += 2;
        if (rs.length > 1) nota += rs.length - 1;
        if (rs.every(r => r.area)) nota += Math.abs(Math.log(area / rs.reduce((t, r) => t + r.area!, 0)));
      });
      return nota;
    };
    const celulaEm = (x: number, y: number) => { const [i, j] = cel(x, y); return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i; };
    /** Prolongamento de cada ponta de parede, através da região `m`, até bater em outra parede (no máximo 3 m). */
    const raios = (m: number): number[][] => {
      const lista: number[][] = [];
      for (const w of paredes) {
        const comp = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1, ux = (w.b.x - w.a.x) / comp, uy = (w.b.y - w.a.y) / comp;
        for (const [e, dx, dy] of [[w.b, ux, uy], [w.a, -ux, -uy]] as const) {
          const cels: number[] = [];
          let livre = false, bateu = false;
          for (let t = 0; t <= 3.2; t += CELULA / 2) {
            const k = celulaEm(e.x + dx * t, e.y + dy * t);
            if (k < 0) break;
            const g = grade[k];
            if (!livre) { if (g === 1) { if (t > 0.4) break; continue; } if (g !== m) break; livre = true; }
            if (g === 1) { bateu = true; break; }
            if (g !== m) break;
            if (cels[cels.length - 1] !== k) cels.push(k);
          }
          if (bateu && cels.length * CELULA >= 0.15) lista.push(cels);
        }
      }
      return lista;
    };
    // Linhas desenhadas (não parede) com 60 cm ou mais, sem repetir as sobrepostas.
    const vistas = new Set<string>();
    const soltas = retas.filter(r => r.comp >= 0.6).sort((a, b) => b.comp - a.comp).filter(r => {
      const p = ponto(r.ang, r.rho, (r.t0 + r.t1) / 2), k = celulaEm(p.x, p.y);
      if (k < 0 || grade[k] < 3) return false;
      const chave = `${r.ang}:${Math.round(r.rho / 0.02)}:${Math.round(r.t0 / 0.1)}:${Math.round(r.t1 / 0.1)}`;
      if (vistas.has(chave)) return false;
      vistas.add(chave);
      return true;
    });
    /** Linha que vai de parede a parede dentro da região `m` (pode faltar até 30 cm em cada ponta até a parede). */
    const linhasDeDivisa = (m: number): number[][] => {
      const lista: number[][] = [];
      for (const r of soltas) {
        const meio = (r.t0 + r.t1) / 2, k0 = celulaEm(ponto(r.ang, r.rho, meio).x, ponto(r.ang, r.rho, meio).y);
        if (grade[k0] !== m) continue;
        const cels: number[] = [k0];
        let ok = true;
        for (const sentido of [-1, 1]) {
          const limite = (sentido < 0 ? meio - r.t0 : r.t1 - meio) + 0.3;
          let bateu = false;
          for (let d = CELULA / 2; d <= limite; d += CELULA / 2) {
            const q = ponto(r.ang, r.rho, meio + sentido * d), k = celulaEm(q.x, q.y);
            if (k < 0) break;
            // Só vale se a parede está na ponta da linha (a linha não atravessa parede no meio: aí seria de outro cômodo).
            if (grade[k] === 1) { bateu = d >= limite - 0.3 - 0.1; break; }
            if (grade[k] !== m) break;
            if (!cels.includes(k)) cels.push(k);
          }
          if (!bateu) { ok = false; break; }
        }
        if (ok && cels.length * CELULA >= 0.5) lista.push(cels);
        if (lista.length >= 80) break;
      }
      return lista;
    };
    const feitas: Ponto[][] = [];
    for (const reg of regioes) {
      const m = reg.marca, rots = rotulos.filter(x => x.k >= 0 && grade[x.k] === m);
      const sobra = rots.length === 1 && rots[0].r.area ? (reg.celulas * CELULA * CELULA) / rots[0].r.area : 0;
      if (rots.length < 2 && sobra < 1.4) continue;
      let atual = avaliar(m, [], rots);
      for (let volta = 0; volta < 6 && atual > 0.05; volta++) {
        let melhor: { nota: number; cels: number[] } | null = null;
        for (const candidatas of [raios(m), linhasDeDivisa(m)]) {
          for (const c of candidatas) {
            const nota = avaliar(m, c, rots);
            if (nota < atual - (rots.length > 1 ? 0.08 : 0.15) && (!melhor || nota < melhor.nota)) melhor = { nota, cels: c };
          }
          if (melhor) break;
        }
        if (!melhor) break;
        for (const k of melhor.cels) grade[k] = 1;
        const pt = (k: number) => ({ x: ((k % nx) + 0.5) * CELULA - margem, y: (Math.floor(k / nx) + 0.5) * CELULA - margem });
        feitas.push([pt(melhor.cels[0]), pt(melhor.cels[melhor.cels.length - 1])]);
        atual = melhor.nota;
      }
    }
    return feitas;
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
  for (const d of divisoes) nos.push(...d);
  const comodos: { nome: string; funcao: FuncaoComodo; pontos: Ponto[]; areaInformada: number | null; areaLida: number; nomeado: boolean; marca: number }[] = [];
  const usados = new Set<Rotulo>(), juntos: string[][] = [];
  for (const r of regioes) {
    const areaLida = r.celulas * CELULA * CELULA;
    if (areaLida < 0.8) continue;
    const dentro = linhas.filter(l => { const [i, j] = cel(l.x, l.y); return i >= 0 && j >= 0 && i < nx && j < ny && grade[j * nx + i] === r.marca; });
    const rots = rotulos.filter(x => x.k >= 0 && grade[x.k] === r.marca).map(x => x.r);
    const comNome = rots.filter(x => x.nome).sort((a, b) => b.tam - a.tam)[0];
    const outro = dentro.filter(l => /[A-Za-zÀ-ú]{3}/.test(l.str) && areaDoTexto(l.str) === null && !/^\s*[\d.,]+\s*$/.test(l.str)).sort((a, b) => b.tam - a.tam)[0];
    const areaInformada = comNome?.area ?? rots.find(x => x.area !== null)?.area ?? null;
    const rotulo = (comNome?.nome ?? outro?.str)?.replace(/\s*(?:A\s*=\s*)?\d{1,4}(?:[.,]\d{1,2})?\s*m\s*[²2].*$/i, "").trim();
    const pontos = encaixar(contorno(dono, nx, ny, r.marca).map(p => ({ x: p.x * CELULA - margem, y: p.y * CELULA - margem })), nos);
    if (pontos.length < 3) continue;
    rots.forEach(x => usados.add(x));
    const outrosNomes = rots.filter(x => x.nome && x !== comNome && semAcento(x.nome) !== semAcento(comNome!.nome!)).map(x => x.nome!);
    if (comNome && outrosNomes.length) juntos.push([comNome.nome!, ...outrosNomes]);
    comodos.push({
      nome: rotulo ? rotulo.charAt(0).toUpperCase() + rotulo.slice(1).toLowerCase() : `Ambiente ${comodos.length + 1}`,
      funcao: (rotulo && funcaoDoNome(rotulo)) || "outro", pontos, areaInformada, areaLida, nomeado: !!comNome, marca: r.marca,
    });
  }
  /** Rótulos com nome que não ficaram dentro de nenhum ambiente fechado pelas paredes. */
  const soltos = rotulos.filter(x => x.r.nome && !usados.has(x.r)).map(x => x.r);
  /** O que há no ponto (em metros, na página): 1 parede, 2 fora da construção, 3+ a marca da região. */
  const regiao = (x: number, y: number) => { const [i, j] = cel(x, y); return i < 0 || j < 0 || i >= nx || j >= ny ? 2 : grade[j * nx + i]; };
  return { comodos, regiao, soltos, juntos };
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

/** Escala a partir da qual o desenho é implantação/urbanismo (lotes, quadras), não planta de pavimento. */
const ESCALA_DE_IMPLANTACAO = 200;
/** Tempo máximo de leitura de uma página: a função do servidor tem limite, e uma prancha confusa não pode travar o passo. */
const PRAZO_MS = 3500;

type Pagina = { prim: Primitivas; linhas: Linha[]; titulos: Titulo[]; arcos: Arco[]; prazo: number; estourou: boolean };
type Caixa = { x0: number; y0: number; x1: number; y1: number };

/** Corta a parede (eixo) na caixa; as aberturas que ficam fora saem. Devolve falso se sobrar menos de 30 cm. */
function recortar(w: Parede, c: Caixa): boolean {
  const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
  let u0 = 0, u1 = 1;
  for (const [p, q] of [[-dx, w.a.x - c.x0], [dx, c.x1 - w.a.x], [-dy, w.a.y - c.y0], [dy, c.y1 - w.a.y]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > u1) return false; if (r > u0) u0 = r; } else { if (r < u0) return false; if (r < u1) u1 = r; }
  }
  const comp = Math.hypot(dx, dy), desloc = u0 * comp, novo = (u1 - u0) * comp;
  if (novo < 0.3) return false;
  w.vaos = w.vaos.map(v => ({ ...v, t: v.t - desloc })).filter(v => v.t - v.largura / 2 >= -0.05 && v.t + v.largura / 2 <= novo + 0.05);
  const a = { x: w.a.x + dx * u0, y: w.a.y + dy * u0 }, b = { x: w.a.x + dx * u1, y: w.a.y + dy * u1 };
  w.a = a; w.b = b;
  return true;
}

const lista = (nomes: string[]) => (nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}` : nomes[0] ?? "");

function plantasNaEscala(pg: Pagina, escala: number, origem: PlantaLida["escalaOrigem"]): PlantaLida[] {
  const { prim } = pg, k = metrosPorPonto(escala);
  const todas = prim.segmentos.map(s => emReta({ x1: s.x1 * k, y1: s.y1 * k, x2: s.x2 * k, y2: s.y2 * k }));
  const { membros, escadas: degraus } = familias(todas);
  const retas = todas.filter(r => !membros.has(r)), curtas = retas.filter(r => r.comp >= 0.06 && r.comp <= 0.45);
  const arcos = pg.arcos.map(a => ({ cx: a.cx * k, cy: a.cy * k, r: a.r * k, pontas: a.pontas?.map(p => ({ x: p.x * k, y: p.y * k })) })).filter(a => a.r >= 0.5 && a.r <= 1.6);
  const paredes = paredesComVaos(colineares(pecasDeParede(retas)), { retas, curtas, arcos });
  const linhas = pg.linhas.map(l => ({ ...l, x: l.x * k, y: l.y * k, tam: l.tam * k }));
  const titulos = pg.titulos.map(t => ({ ...t, x: t.x * k, y: t.y * k, tam: t.tam * k }));

  type Grupo = { paredes: Parede[]; total: number; caixa: Caixa; titulo: (typeof titulos)[number] | null };
  const grupos: Grupo[] = [];
  for (const g of agrupar(paredes)) {
    const total = g.reduce((s, w) => s + Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), 0);
    if (g.length < 4 || total < 10 || new Set(g.map(w => w.ang)).size < 2) continue;
    fecharCantos(g);
    const xs = g.flatMap(w => [w.a.x, w.b.x]), ys = g.flatMap(w => [w.a.y, w.b.y]);
    grupos.push({ paredes: g, total, caixa: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }, titulo: null });
  }
  // Título de cada desenho: o mais perto da caixa dele, dando preferência ao que tem a escala logo abaixo. Um título
  // serve a um desenho só (o maior entre os que o têm como mais próximo); os outros ficam sem título.
  const distancia = (t: { x: number; y: number }, c: Caixa) => Math.hypot(Math.max(c.x0 - t.x, 0, t.x - c.x1), Math.max(c.y0 - t.y, 0, t.y - c.y1));
  for (const g of grupos) {
    const limite = Math.max(2, 0.5 * Math.max(g.caixa.x1 - g.caixa.x0, g.caixa.y1 - g.caixa.y0));
    const perto = titulos.map(t => ({ t, d: distancia(t, g.caixa) })).filter(x => x.d <= limite).sort((a, b) => a.d - b.d);
    g.titulo = (perto.find(x => x.t.ancorado) ?? perto[0])?.t ?? null;
  }
  for (const g of grupos) if (g.titulo && grupos.some(h => h !== g && h.titulo === g.titulo && h.total > g.total)) g.titulo = null;

  const plantas: PlantaLida[] = [];
  for (const { paredes: grupo, caixa, titulo: tit } of grupos) {
    if (Date.now() > pg.prazo) { pg.estourou = true; break; }
    const vista = tit?.tipo ?? null;
    if (vista === "outra") continue; // corte, fachada, cobertura, implantação, tabela…
    let x0 = caixa.x0, y0 = caixa.y0, largura = caixa.x1 - caixa.x0, comprimento = caixa.y1 - caixa.y0;
    if (largura < 2.5 || comprimento < 2.5 || largura > 150 || comprimento > 150) continue;
    if (((largura + 2) / CELULA) * ((comprimento + 2) / CELULA) > MAX_CELULAS) continue;
    const lidos = comodosDaPlanta(grupo, linhas, retas, x0, y0, largura, comprimento);
    let comodos = lidos.comodos;
    const nomeadosAntes = comodos.filter(c => c.nomeado).length;
    // Com título de planta, basta um cômodo com nome (ou três ambientes fechados). Sem título reconhecido, o desenho
    // só conta como planta com pelo menos dois cômodos com nome: um corte ou um quadro também tem "caixas" fechadas.
    if (vista ? !nomeadosAntes && comodos.length < 3 : nomeadosAntes < 2) continue;
    const titulo = tit?.str ?? "";
    const pendencias: string[] = [];

    // A construção é onde estão os cômodos com nome. Muros do lote, garagem descoberta, quintal e calçada desenhados
    // em volta ficam de fora do pavimento (com aviso), para não inflar a casa.
    const descartadas = new Set<number>();
    let recorte: Caixa | null = null;
    const nomeadosC = comodos.filter(c => c.nomeado);
    if (nomeadosC.length >= 2) {
      const pts = nomeadosC.flatMap(c => c.pontos.map(p => ({ x: p.x + x0, y: p.y + y0 })));
      const folga = Math.max(...grupo.map(w => w.esp)) / 2 + 0.15;
      const c: Caixa = { x0: Math.min(...pts.map(p => p.x)) - folga, y0: Math.min(...pts.map(p => p.y)) - folga, x1: Math.max(...pts.map(p => p.x)) + folga, y1: Math.max(...pts.map(p => p.y)) + folga };
      const centro = (cm: (typeof comodos)[number]) => ({ x: x0 + cm.pontos.reduce((s, p) => s + p.x, 0) / cm.pontos.length, y: y0 + cm.pontos.reduce((s, p) => s + p.y, 0) / cm.pontos.length });
      for (const cm of comodos) { const q = centro(cm); if (!cm.nomeado && (q.x < c.x0 || q.x > c.x1 || q.y < c.y0 || q.y > c.y1)) descartadas.add(cm.marca); }
      const antes = grupo.reduce((s, w) => s + Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), 0);
      const ficam = grupo.map(w => ({ ...w, a: { ...w.a }, b: { ...w.b }, vaos: w.vaos.map(v => ({ ...v })) })).filter(w => recortar(w, c));
      const depois = ficam.reduce((s, w) => s + Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), 0);
      if (antes - depois > 1 || descartadas.size) {
        recorte = c;
        grupo.splice(0, grupo.length, ...ficam);
        comodos = comodos.filter(cm => !descartadas.has(cm.marca));
        const xs = grupo.flatMap(w => [w.a.x, w.b.x]), ys = grupo.flatMap(w => [w.a.y, w.b.y]);
        const nx0 = Math.min(...xs), ny0 = Math.min(...ys);
        comodos = comodos.map(cm => ({ ...cm, pontos: cm.pontos.map(p => ({ x: p.x + x0 - nx0, y: p.y + y0 - ny0 })) }));
        x0 = nx0; y0 = ny0; largura = Math.max(...xs) - x0; comprimento = Math.max(...ys) - y0;
        pendencias.push(`O desenho tem paredes e áreas sem nome em volta dos cômodos (muro do lote, garagem descoberta, quintal ou calçada: ${r2(antes - depois)} m de paredes e ${descartadas.size} área${descartadas.size === 1 ? "" : "s"}). O pavimento ficou só com a parte dos cômodos com nome (${r2(largura)} × ${r2(comprimento)} m); confira na revisão se a construção é só isso.`);
      }
    }
    if (lidos.soltos.length) pendencias.push(`Cômodo${lidos.soltos.length > 1 ? "s" : ""} escrito${lidos.soltos.length > 1 ? "s" : ""} na planta sem paredes que o${lidos.soltos.length > 1 ? "s" : ""} fechem: ${lista(lidos.soltos.map(r => `${r.nome}${r.area ? ` (${r.area} m²)` : ""}`))}. Desenhe na revisão.`);
    for (const j of lidos.juntos) pendencias.push(`${lista(j)} ficaram num ambiente só (não há parede nem linha que os separe no desenho): divida na revisão.`);
    /** Fora da construção: fora da grade, numa área descartada ou fora do recorte. */
    const fora = (x: number, y: number) => { const v = lidos.regiao(x, y); return v === 2 || descartadas.has(v) || (!!recorte && (x < recorte.x0 || x > recorte.x1 || y < recorte.y0 || y > recorte.y1)); };

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
    // (andar de cima não tem entrada: só o térreo, ou a planta sem andar no título, recebe o aviso)
    else if (aberturas.length && (nomeDoPavimento(titulo, 0).andar ?? 0) <= 0) pendencias.push("Nenhuma porta de abrir em parede externa: a entrada principal não foi marcada (porta de correr aparece na planta igual a uma janela). Marque a entrada na revisão.");

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
    if (escadas.length) pendencias.unshift("Escada lida pelos degraus: confira na revisão de que lado ela começa a subir.");

    const nomeados = comodos.filter(c => c.nomeado).length;
    const comAreas = comodos.filter(c => c.areaInformada && c.areaLida > 0.5).map(c => c.areaLida / c.areaInformada!).sort((a, b) => a - b);
    const razaoAreas = comAreas.length ? comAreas[Math.floor(comAreas.length / 2)] : null;
    plantas.push({
      titulo, escala, escalaOrigem: origem, origemPt: { x: r2(x0 / k), y: r2(y0 / k) }, metrosPorPonto: k, larguraDaPaginaM: r2(prim.largura * k), largura: r2(largura), comprimento: r2(comprimento),
      paredes: paredesLidas, aberturas,
      comodos: comodos.map((c, i) => ({ id: `c${i + 1}`, nome: c.nome.slice(0, 80), funcao: c.funcao, pontos: c.pontos.map(p => ({ x: r2(p.x), y: r2(p.y) })), areaInformada: c.areaInformada, confirmada: origem !== "suposta" && c.nomeado })),
      escadas, pendencias, nomeados, razaoAreas, vista,
    });
  }
  return plantas;
}

const ESCALAS_COMUNS = [50, 100, 75, 25, 20, 125];
const nota = (ps: PlantaLida[]) => ps.reduce((s, p) => s + p.nomeados * 3 + p.comodos.length + (p.razaoAreas !== null && Math.abs(Math.log(p.razaoAreas)) < 0.12 ? 10 : 0), 0);

/**
 * Lê as plantas baixas de uma página. A escala vem do texto da prancha; se as áreas escritas nos cômodos
 * mostrarem que ela está errada (ou se não houver escala escrita), é corrigida/achada pelas áreas.
 * Cortes, fachadas, cobertura, implantação e a planta de layout repetida não viram pavimento.
 */
export function lerPagina(prim: Primitivas): { plantas: PlantaLida[]; diagnostico: Diagnostico } {
  const inicio = Date.now();
  const linhas = linhasDeTexto(prim.textos), escritas = Array.from(new Set(escalasDaPagina(linhas).map(e => e.n)));
  const diagnostico: Diagnostico = { segmentos: prim.segmentos.length, arcos: prim.arcos.length, textos: prim.textos.length, imagens: prim.imagens, escalas: escritas, plantas: 0, motivo: null };
  const fim = (plantas: PlantaLida[]) => { diagnostico.plantas = plantas.length; diagnostico.tempoMs = Date.now() - inicio; return { plantas, diagnostico }; };
  if (prim.segmentos.length < 40) {
    diagnostico.motivo = prim.imagens > 0 ? "A prancha é uma imagem (PDF escaneado ou fotografado): não há linhas para ler. Use o PDF exportado do programa de desenho (CAD/Revit), ou desenhe a planta na revisão." : "A página não tem desenho vetorial suficiente para uma planta.";
    return fim([]);
  }
  const titulos = titulosDaPagina(linhas);
  const temPlanta = titulos.some(t => t.tipo === "planta" || t.tipo === "layout");
  const escalasDePlanta = escritas.filter(n => n < ESCALA_DE_IMPLANTACAO);
  // Prancha de urbanismo/implantação (escalas de 1:200 para cima, quadro de lotes, nomes de rua) e sem título de
  // planta baixa: não há pavimento para ler. Sai logo, sem gastar o tempo do passo procurando paredes nos lotes.
  if (!temPlanta && !escalasDePlanta.length && (escritas.length || pareceUrbanismo(linhas))) {
    diagnostico.motivo = `Esta prancha é de implantação ou urbanismo${escritas.length ? ` (escala ${escritas.map(e => `1:${e}`).join(", ")})` : ""}, não planta baixa de pavimento: nada foi lido dela. Para a maquete da construção, envie a prancha de arquitetura com as plantas baixas (1:50 ou 1:100).`;
    return fim([]);
  }
  const arcos = [...prim.arcos, ...arcosDePolilinhas(prim.segmentos)];
  diagnostico.arcos = arcos.length;
  const pg: Pagina = { prim, linhas, titulos, arcos, prazo: inicio + PRAZO_MS, estourou: false };
  let melhor: PlantaLida[] = [];
  const tentar = (escala: number, origem: PlantaLida["escalaOrigem"]) => {
    if (pg.estourou) return;
    let ps = plantasNaEscala(pg, escala, origem);
    // As áreas escritas mandam: se a planta desenhada dá, de forma consistente, outra área, a escala é ajustada.
    const razoes = ps.map(p => p.razaoAreas).filter((r): r is number => r !== null);
    if (!process.env.TMP_SEM_CORRECAO && !pg.estourou && razoes.length && razoes.every(r => Math.abs(Math.log(r / razoes[0])) < 0.1) && Math.abs(Math.log(razoes[0])) > 0.18) {
      const corrigida = Math.round(escala / Math.sqrt(razoes[0]));
      const alvo = ESCALAS_COMUNS.concat(escalasDePlanta).sort((a, b) => Math.abs(a - corrigida) - Math.abs(b - corrigida))[0];
      const refeitas = plantasNaEscala(pg, Math.abs(alvo - corrigida) / corrigida < 0.08 ? alvo : corrigida, "areas");
      if (nota(refeitas) > nota(ps)) ps = refeitas;
    }
    if (nota(ps) > nota(melhor)) melhor = ps;
  };
  if (escalasDePlanta.length) for (const e of escalasDePlanta) tentar(e, "texto");
  else for (const e of ESCALAS_COMUNS) tentar(e, "suposta");
  // A planta de layout (a mesma planta com móveis) só fica quando a prancha não tem a planta baixa simples.
  if (melhor.some(p => p.vista === "planta")) melhor = melhor.filter(p => p.vista !== "layout");
  for (const p of melhor) {
    if (p.escalaOrigem === "suposta") p.pendencias.push(`Escala não encontrada na prancha: foi usada 1:${p.escala}${p.razaoAreas !== null ? ", que confere com as áreas escritas" : ""}. Confira uma medida conhecida.`);
    if (p.escalaOrigem === "areas") p.pendencias.push(`A escala escrita não conferia com as áreas dos cômodos: foi usada 1:${p.escala}. Confira uma medida conhecida.`);
    if (p.razaoAreas !== null && Math.abs(Math.log(p.razaoAreas)) < 0.12 && p.escalaOrigem === "suposta") p.escalaOrigem = "areas";
    if (pg.estourou) p.pendencias.push("A leitura desta prancha passou do tempo e parou antes do fim: pode faltar algum desenho. Confira na revisão.");
  }
  if (!melhor.length) {
    const outras = Array.from(new Set(titulos.filter(t => t.tipo === "outra" && t.ancorado).map(t => t.str)));
    diagnostico.motivo = pg.estourou ? "A prancha é carregada demais para ler no tempo do passo (nenhuma planta baixa terminou de ser lida). Envie as plantas baixas em pranchas separadas, ou desenhe na revisão."
      : outras.length && !temPlanta ? `Nenhuma planta baixa nesta página: os desenhos dela são ${lista(outras.slice(0, 6))}, que não viram pavimento.`
        : "Nenhuma planta baixa reconhecida nesta página (sem paredes em linha dupla formando ambientes fechados com nome).";
  }
  return fim(melhor);
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
