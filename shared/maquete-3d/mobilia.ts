// Maquete 3D (EPIC-022, etapa 2) — motor de mobília: decide QUAIS móveis entram em cada cômodo e ONDE, a partir
// da função do ambiente e da geometria lida do projeto. Os móveis são paramétricos (medidas reais, ajustadas ao
// espaço) e desenhados pelo visualizador; aqui só há regra e geometria, sem three.js, para ser testável.
// Regras do prompt: proporções reais; não bloquear portas, janelas nem a circulação.
import { areaPoligono, comprimento, type Abertura, type Comodo, type Pavimento, type Ponto } from "./modelo.js";
import { dentroDoPoligono, pontoInterno, pontoNaParede } from "./geometria3d.js";

export const TIPOS_MOVEL = [
  "sofa", "poltrona", "mesa_centro", "rack_tv", "tapete", "mesa_jantar", "cadeira", "buffet", "aparador",
  "cama", "criado_mudo", "guarda_roupa", "escrivaninha", "cadeira_escritorio", "estante",
  "bancada_cozinha", "armario_aereo", "geladeira", "vaso_sanitario", "lavatorio", "espelho", "box_chuveiro",
  "tanque", "maquina_lavar", "armario_servico", "mesa_externa", "churrasqueira", "prateleira",
  "planta", "luminaria_piso", "quadro", "cortina", "pendente", "plafon", "carro",
  // EPIC-028: balcão americano (base baixa + tampo em balanço), usado pelos itens do JSON-fonte; a mobília
  // automática não o sorteia.
  "balcao",
] as const;
export type TipoMovel = (typeof TIPOS_MOVEL)[number];

/**
 * Um móvel posicionado. Referencial local: largura no eixo X, profundidade no eixo Z, as costas em −Z e a frente
 * em +Z. `rot` gira em torno de Y (radianos) e leva +Z para dentro do cômodo. `x`/`z` são o centro em planta.
 */
export type PecaMobilia = {
  id: string; tipo: TipoMovel; comodoId: string;
  x: number; z: number; rot: number;
  largura: number; profundidade: number; altura: number;
  /** Altura da base acima do piso (quadros, espelhos, armários aéreos, luminárias de teto). */
  elevacao: number;
  /** Parâmetros do desenho (ex.: cama de casal, bancada com pia e cooktop, lugares da mesa). */
  opcoes: Record<string, number | boolean | string>;
};

type Aresta = { a: Ponto; b: Ponto; comp: number; ux: number; uy: number; nx: number; ny: number };
type Caixa = { x: number; z: number; rot: number; w: number; d: number };
type Bloqueio = { de: number; ate: number; peitoril: number; passagem: boolean };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function arestas(c: Comodo): Aresta[] {
  const pts = c.poligono;
  return pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length], comp = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / comp, uy = (b.y - a.y) / comp;
    let nx = -uy, ny = ux;
    const meio = { x: (a.x + b.x) / 2 + nx * 0.12, y: (a.y + b.y) / 2 + ny * 0.12 };
    if (!dentroDoPoligono(meio, pts)) { nx = -nx; ny = -ny; }
    return { a, b, comp, ux, uy, nx, ny };
  });
}

function cantos(c: Caixa): Ponto[] {
  const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
    const lx = (sx * c.w) / 2, lz = (sz * c.d) / 2;
    return { x: c.x + lx * cs + lz * sn, y: c.z - lx * sn + lz * cs };
  });
}

/** Duas caixas giradas se sobrepõem? (teorema do eixo separador) */
export function sobrepoe(p: Caixa, q: Caixa, folga = 0): boolean {
  const A = cantos({ ...p, w: p.w + folga, d: p.d + folga }), B = cantos(q);
  for (const pol of [A, B]) for (let i = 0; i < 4; i++) {
    const a = pol[i], b = pol[(i + 1) % 4], ex = -(b.y - a.y), ey = b.x - a.x;
    const proj = (pts: Ponto[]) => pts.map(v => v.x * ex + v.y * ey);
    const pa = proj(A), pb = proj(B);
    if (Math.max(...pa) <= Math.min(...pb) + 1e-9 || Math.max(...pb) <= Math.min(...pa) + 1e-9) return false;
  }
  return true;
}

class Ambiente {
  readonly lados: Aresta[];
  readonly area: number;
  readonly centro: Ponto;
  readonly pecas: PecaMobilia[] = [];
  private ocupado: Caixa[] = [];
  private bloqueios: Bloqueio[][];
  private n = 0;

  constructor(readonly comodo: Comodo, readonly pv: Pavimento) {
    this.lados = arestas(comodo);
    this.area = areaPoligono(comodo.poligono);
    this.centro = pontoInterno(comodo.poligono);
    this.bloqueios = this.lados.map(l => this.bloqueiosDe(l));
    // Faixa livre em frente a cada passagem (porta, porta-janela, vão): ninguém coloca móvel ali.
    this.lados.forEach((l, i) => this.bloqueios[i].filter(b => b.passagem).forEach(b => {
      const t = (b.de + b.ate) / 2, w = b.ate - b.de;
      this.ocupado.push({ x: l.a.x + l.ux * t + l.nx * 0.55, z: l.a.y + l.uy * t + l.ny * 0.55, rot: Math.atan2(l.nx, l.ny), w, d: 1.1 });
    }));
  }

  /** Aberturas que caem sobre este lado do cômodo, em distância ao longo do lado. */
  private bloqueiosDe(l: Aresta): Bloqueio[] {
    const lista: Bloqueio[] = [];
    for (const a of this.pv.aberturas) {
      const w = this.pv.paredes.find(p => p.id === a.paredeId);
      if (!w || comprimento(w) < 0.05) continue;
      const m = pontoNaParede(w, a.posicao);
      const t = (m.x - l.a.x) * l.ux + (m.y - l.a.y) * l.uy;
      const dist = Math.abs((m.x - l.a.x) * l.nx + (m.y - l.a.y) * l.ny);
      const paralela = Math.abs(((w.b.x - w.a.x) * l.ux + (w.b.y - w.a.y) * l.uy) / comprimento(w)) > 0.9;
      if (!paralela || dist > w.espessura / 2 + 0.25 || t < -0.05 || t > l.comp + 0.05) continue;
      const passagem = a.tipo !== "janela", folga = passagem ? 0.12 : 0.05;
      lista.push({ de: t - a.largura / 2 - folga, ate: t + a.largura / 2 + folga, peitoril: a.peitoril, passagem });
    }
    return lista;
  }

  janelas(): { lado: Aresta; t: number; abertura: Abertura }[] {
    const lista: { lado: Aresta; t: number; abertura: Abertura }[] = [];
    for (const a of this.pv.aberturas.filter(x => x.tipo === "janela" || x.tipo === "porta_janela")) {
      const w = this.pv.paredes.find(p => p.id === a.paredeId);
      if (!w) continue;
      const m = pontoNaParede(w, a.posicao);
      for (const l of this.lados) {
        const t = (m.x - l.a.x) * l.ux + (m.y - l.a.y) * l.uy, dist = Math.abs((m.x - l.a.x) * l.nx + (m.y - l.a.y) * l.ny);
        if (dist <= w.espessura / 2 + 0.25 && t > 0 && t < l.comp) { lista.push({ lado: l, t, abertura: a }); break; }
      }
    }
    return lista;
  }

  temJanela = (i: number) => this.bloqueios[i].some(b => !b.passagem);
  temPorta = (i: number) => this.bloqueios[i].some(b => b.passagem);

  /** Trechos livres do lado `i` para um móvel de altura `altura` (janela alta deixa passar móvel baixo). */
  private livres(i: number, altura: number): [number, number][] {
    const l = this.lados[i], margem = 0.06;
    const barrados = this.bloqueios[i].filter(b => b.passagem || altura > b.peitoril - 0.05).sort((p, q) => p.de - q.de);
    const trechos: [number, number][] = [];
    let cursor = margem;
    for (const b of barrados) { if (b.de - cursor > 0.1) trechos.push([cursor, b.de]); cursor = Math.max(cursor, b.ate); }
    if (l.comp - margem - cursor > 0.1) trechos.push([cursor, l.comp - margem]);
    return trechos;
  }

  private cabe(caixa: Caixa, folga: number): boolean {
    if (!cantos(caixa).every(p => dentroDoPoligono(p, this.comodo.poligono))) return false;
    return !this.ocupado.some(o => sobrepoe(caixa, o, folga));
  }

  private registrar(tipo: TipoMovel, caixa: Caixa, altura: number, elevacao: number, opcoes: PecaMobilia["opcoes"], ocupa: boolean): PecaMobilia {
    const peca: PecaMobilia = {
      id: `${this.comodo.id}-m${++this.n}`, tipo, comodoId: this.comodo.id, x: r3(caixa.x), z: r3(caixa.z), rot: r3(caixa.rot),
      largura: r3(caixa.w), profundidade: r3(caixa.d), altura: r3(altura), elevacao: r3(elevacao), opcoes,
    };
    this.pecas.push(peca);
    if (ocupa) this.ocupado.push(caixa);
    return peca;
  }

  /**
   * Encosta um móvel numa parede. `lados` é a ordem de preferência (índices); em cada lado tenta o maior trecho
   * livre. `ancora`: centralizado no trecho, ou colado no início/fim dele. Devolve a peça ou null se não couber.
   */
  encostar(tipo: TipoMovel, m: { largura: number; profundidade: number; altura: number; minimo?: number }, o: {
    lados?: number[]; ancora?: "centro" | "inicio" | "fim"; elevacao?: number; folga?: number; ocupa?: boolean; opcoes?: PecaMobilia["opcoes"];
    /** Estica a largura até ocupar o trecho livre (armários e bancadas), limitado a `ate`. */
    esticarAte?: number;
  } = {}): PecaMobilia | null {
    const ordem = o.lados ?? this.ladosPorTamanho();
    const elevacao = o.elevacao ?? 0, ocupa = o.ocupa ?? elevacao === 0;
    for (const i of ordem) {
      const l = this.lados[i];
      const trechos = this.livres(i, elevacao > 0 ? elevacao + m.altura : m.altura).sort((p, q) => q[1] - q[0] - (p[1] - p[0]));
      for (const [de, ate] of trechos) {
        let largura = o.esticarAte ? Math.min(o.esticarAte, ate - de) : m.largura;
        if (ate - de < largura) { if (m.minimo && ate - de >= m.minimo) largura = ate - de; else continue; }
        if (largura < (m.minimo ?? m.largura) - 1e-6) continue;
        const t = o.ancora === "inicio" ? de + largura / 2 : o.ancora === "fim" ? ate - largura / 2 : (de + ate) / 2;
        const recuo = m.profundidade / 2 + 0.02;
        const caixa: Caixa = { x: l.a.x + l.ux * t + l.nx * recuo, z: l.a.y + l.uy * t + l.ny * recuo, rot: Math.atan2(l.nx, l.ny), w: largura, d: m.profundidade };
        if (ocupa && !this.cabe(caixa, o.folga ?? 0.04)) continue;
        // `sentido`: +1 se o eixo X local do móvel corre no sentido do lado (a→b), −1 se corre ao contrário.
        const sentido = Math.cos(caixa.rot) * l.ux - Math.sin(caixa.rot) * l.uy >= 0 ? 1 : -1;
        return this.registrar(tipo, caixa, m.altura, elevacao, { ...o.opcoes, lado: i, sentido }, ocupa);
      }
    }
    return null;
  }

  /** Coloca um móvel solto no piso, em (x, z), se couber. */
  soltar(tipo: TipoMovel, x: number, z: number, rot: number, m: { largura: number; profundidade: number; altura: number }, o: { ocupa?: boolean; folga?: number; elevacao?: number; opcoes?: PecaMobilia["opcoes"] } = {}): PecaMobilia | null {
    const caixa: Caixa = { x, z, rot, w: m.largura, d: m.profundidade }, ocupa = o.ocupa ?? true;
    if (ocupa ? !this.cabe(caixa, o.folga ?? 0.3) : !cantos(caixa).every(p => dentroDoPoligono(p, this.comodo.poligono))) return null;
    return this.registrar(tipo, caixa, m.altura, o.elevacao ?? 0, o.opcoes ?? {}, ocupa);
  }

  /** À frente de uma peça já colocada, a `dist` metros da frente dela. */
  aFrente(p: PecaMobilia, dist: number): { x: number; z: number } {
    const d = p.profundidade / 2 + dist;
    return { x: p.x + Math.sin(p.rot) * d, z: p.z + Math.cos(p.rot) * d };
  }

  ladosPorTamanho(filtro: (i: number) => boolean = () => true): number[] {
    return this.lados.map((_, i) => i).filter(filtro).sort((p, q) => this.lados[q].comp - this.lados[p].comp);
  }

  /** Lado mais ou menos oposto ao lado `i` (normal contrária), o mais comprido primeiro. */
  opostos(i: number): number[] {
    const l = this.lados[i];
    // Sem lado de referência (a peça de apoio não coube no cômodo): qualquer lado serve.
    if (!l) return this.ladosPorTamanho();
    return this.ladosPorTamanho(j => j !== i && this.lados[j].nx * l.nx + this.lados[j].ny * l.ny < -0.7);
  }

  outros = (i: number) => this.ladosPorTamanho(j => j !== i);

  /** Um canto livre do cômodo (para planta ou luminária de piso). */
  noCanto(tipo: TipoMovel, lado: number, m: { largura: number; profundidade: number; altura: number }, opcoes: PecaMobilia["opcoes"] = {}): PecaMobilia | null {
    return this.encostar(tipo, m, { ancora: "inicio", lados: [lado, ...this.outros(lado)], opcoes })
      ?? this.encostar(tipo, m, { ancora: "fim", lados: this.ladosPorTamanho(), opcoes });
  }
}

const lado = (p: PecaMobilia | null) => (p ? Number(p.opcoes.lado) : -1);

/** Quadro na parede, centrado sobre um móvel já encostado. */
function quadroSobre(a: Ambiente, p: PecaMobilia | null, largura = 1.1) {
  if (!p) return;
  a.encostar("quadro", { largura: Math.min(largura, p.largura * 0.7), profundidade: 0.04, altura: 0.7 }, { lados: [lado(p)], elevacao: Math.max(1.35, p.altura + 0.35), ocupa: false });
}

function luzDeTeto(a: Ambiente, tipo: "pendente" | "plafon", sobre?: { x: number; z: number }) {
  const h = tipo === "pendente" ? 0.9 : 0.12, p = sobre ?? { x: a.centro.x, z: a.centro.y };
  a.soltar(tipo, p.x, p.z, 0, { largura: 0.45, profundidade: 0.45, altura: h }, { ocupa: false, elevacao: a.pv.peDireito - h });
}

function cortinas(a: Ambiente) {
  for (const j of a.janelas()) {
    const larg = j.abertura.largura + 0.5, l = j.lado;
    a.soltar("cortina", l.a.x + l.ux * j.t + l.nx * 0.1, l.a.y + l.uy * j.t + l.ny * 0.1, Math.atan2(l.nx, l.ny),
      { largura: Math.min(larg, l.comp - 0.1), profundidade: 0.12, altura: a.pv.peDireito - 0.08 }, { ocupa: false, opcoes: { vao: j.abertura.largura } });
  }
}

function mesaComCadeiras(a: Ambiente, x: number, z: number, rot: number, lugares: number, tipo: "mesa_jantar" | "mesa_externa" = "mesa_jantar"): PecaMobilia | null {
  const larg = lugares >= 6 ? 1.8 : lugares >= 4 ? 1.3 : 0.8, prof = lugares >= 4 ? 0.85 : 0.8;
  // A mesa reserva o espaço das cadeiras em volta (folga), e as cadeiras entram por dentro dessa reserva.
  const mesa = a.soltar(tipo, x, z, rot, { largura: larg, profundidade: prof, altura: 0.76 }, { folga: 1.15, opcoes: { lugares } });
  if (!mesa) return null;
  const cs = Math.cos(rot), sn = Math.sin(rot), porLado = Math.max(1, Math.floor(lugares / 2));
  for (let i = 0; i < porLado; i++) for (const s of [1, -1]) {
    const lx = porLado === 1 ? 0 : -larg / 2 + (larg / porLado) * (i + 0.5), lz = s * (prof / 2 + 0.2);
    a.soltar("cadeira", x + lx * cs + lz * sn, z - lx * sn + lz * cs, rot + (s === 1 ? Math.PI : 0), { largura: 0.45, profundidade: 0.48, altura: 0.88 }, { ocupa: false });
  }
  return mesa;
}

// ── Receitas por função do cômodo ──

function sala(a: Ambiente, comJantar: boolean) {
  const grande = a.area >= 16;
  const sofa = a.encostar("sofa", { largura: grande ? 2.3 : 1.8, profundidade: 0.92, altura: 0.82, minimo: 1.5 },
    { lados: a.ladosPorTamanho(i => !a.temPorta(i)).concat(a.ladosPorTamanho()), opcoes: { lugares: grande ? 3 : 2 } });
  if (sofa) {
    const rack = a.encostar("rack_tv", { largura: Math.min(2, sofa.largura), profundidade: 0.42, altura: 0.5, minimo: 1.2 }, { lados: a.opostos(lado(sofa)), opcoes: { tv: true } });
    const frente = a.aFrente(sofa, 0.75);
    a.soltar("tapete", frente.x, frente.z, sofa.rot, { largura: Math.min(sofa.largura + 0.4, 2.6), profundidade: 1.7, altura: 0.015 }, { ocupa: false });
    a.soltar("mesa_centro", frente.x, frente.z, sofa.rot, { largura: 1.0, profundidade: 0.55, altura: 0.4 }, { folga: 0.25 });
    quadroSobre(a, sofa, 1.4);
    if (grande) a.encostar("poltrona", { largura: 0.85, profundidade: 0.85, altura: 0.85 }, { lados: a.outros(lado(sofa)).filter(i => i !== lado(rack)), ancora: "inicio", folga: 0.3 });
    a.noCanto("luminaria_piso", lado(sofa), { largura: 0.35, profundidade: 0.35, altura: 1.6 });
  }
  a.noCanto("planta", a.ladosPorTamanho()[1] ?? 0, { largura: 0.5, profundidade: 0.5, altura: 1.5 }, { porte: "grande" });
  if (comJantar && a.area >= 20) {
    // Mesa de jantar no lado do cômodo mais distante do sofá.
    const alvo = sofa ? { x: a.centro.x * 2 - sofa.x, z: a.centro.y * 2 - sofa.z } : { x: a.centro.x, z: a.centro.y };
    const meio = { x: (alvo.x + a.centro.x) / 2, z: (alvo.z + a.centro.y) / 2 };
    const mesa = mesaComCadeiras(a, meio.x, meio.z, sofa?.rot ?? 0, 4) ?? mesaComCadeiras(a, alvo.x, alvo.z, sofa?.rot ?? 0, 4);
    if (mesa) luzDeTeto(a, "pendente", mesa);
  }
  cortinas(a);
  luzDeTeto(a, "plafon");
}

function jantar(a: Ambiente) {
  const mesa = mesaComCadeiras(a, a.centro.x, a.centro.y, Math.atan2(a.lados[a.ladosPorTamanho()[0]].ux, a.lados[a.ladosPorTamanho()[0]].uy) + Math.PI / 2, a.area >= 12 ? 6 : 4);
  quadroSobre(a, a.encostar("buffet", { largura: 1.6, profundidade: 0.45, altura: 0.85, minimo: 1.1 }, { folga: 0.1 }));
  cortinas(a);
  luzDeTeto(a, "pendente", mesa ?? undefined);
}

function cozinha(a: Ambiente) {
  // Bancada no maior lado livre; geladeira numa ponta; aéreos sobre a bancada, onde não houver janela.
  const lados = a.ladosPorTamanho(i => !a.temPorta(i)).concat(a.ladosPorTamanho());
  const geladeira = a.encostar("geladeira", { largura: 0.72, profundidade: 0.72, altura: 1.8 }, { lados, ancora: "inicio", folga: 0 });
  const bancada = a.encostar("bancada_cozinha", { largura: 1.8, profundidade: 0.6, altura: 0.9, minimo: 1.2 },
    { lados: geladeira ? [lado(geladeira), ...lados] : lados, esticarAte: 3.6, folga: 0, opcoes: { pia: true, cooktop: true } });
  if (bancada) a.encostar("armario_aereo", { largura: bancada.largura, profundidade: 0.35, altura: 0.7, minimo: 0.8 }, { lados: [lado(bancada)], elevacao: 1.5, esticarAte: bancada.largura, ocupa: false });
  if (a.area >= 9) {
    const segunda = a.encostar("bancada_cozinha", { largura: 1.6, profundidade: 0.6, altura: 0.9, minimo: 1.0 }, { lados: a.opostos(lado(bancada)), esticarAte: 2.4, folga: 0.9, opcoes: { pia: false, cooktop: false } });
    if (!segunda && a.area >= 12) mesaComCadeiras(a, a.centro.x, a.centro.y, bancada?.rot ?? 0, 2);
  }
  luzDeTeto(a, "plafon");
}

function quarto(a: Ambiente, suite: boolean) {
  const casal = suite || a.area >= 9.5;
  const semJanela = a.ladosPorTamanho(i => !a.temJanela(i) && !a.temPorta(i));
  const cama = a.encostar("cama", { largura: casal ? 1.6 : 0.95, profundidade: 2.05, altura: 0.55 }, { lados: semJanela.concat(a.ladosPorTamanho()), folga: 0.45, opcoes: { casal } });
  if (cama) {
    const cs = Math.cos(cama.rot), sn = Math.sin(cama.rot);
    for (const s of casal ? [1, -1] : [1]) {
      const lx = s * (cama.largura / 2 + 0.28), lz = -cama.profundidade / 2 + 0.22;
      a.soltar("criado_mudo", cama.x + lx * cs + lz * sn, cama.z - lx * sn + lz * cs, cama.rot, { largura: 0.45, profundidade: 0.4, altura: 0.5 }, { folga: 0.02, opcoes: { abajur: true } });
    }
    const pe = a.aFrente(cama, -cama.profundidade * 0.25);
    a.soltar("tapete", pe.x, pe.z, cama.rot, { largura: cama.largura + 1.1, profundidade: 1.6, altura: 0.015 }, { ocupa: false });
    quadroSobre(a, cama, 1.2);
  }
  const roupeiro = a.encostar("guarda_roupa", { largura: 1.8, profundidade: 0.6, altura: 2.3, minimo: 1.0 },
    { lados: a.opostos(lado(cama)).concat(a.outros(lado(cama))), esticarAte: casal ? 2.6 : 1.8, folga: 0.5, opcoes: { portas: "correr" } });
  if (a.area >= 11) {
    const mesa = a.encostar("escrivaninha", { largura: 1.1, profundidade: 0.5, altura: 0.76 }, { lados: a.outros(lado(cama)).filter(i => i !== lado(roupeiro)), folga: 0.35 });
    if (mesa) { const f = a.aFrente(mesa, 0.25); a.soltar("cadeira_escritorio", f.x, f.z, mesa.rot + Math.PI, { largura: 0.55, profundidade: 0.55, altura: 0.95 }, { ocupa: false }); }
  }
  cortinas(a);
  luzDeTeto(a, "plafon");
}

function banheiro(a: Ambiente, completo: boolean) {
  const livres = a.ladosPorTamanho(i => !a.temPorta(i)).concat(a.ladosPorTamanho());
  // Box no fundo (lado mais curto sem porta), ocupando a largura do banheiro.
  if (completo) {
    const curtos = [...livres].sort((p, q) => a.lados[p].comp - a.lados[q].comp);
    const box = a.encostar("box_chuveiro", { largura: 0.9, profundidade: 0.9, altura: 2.0, minimo: 0.8 }, { lados: curtos, ancora: "inicio", esticarAte: 1.2, folga: 0 });
    // O box fica colado no início do lado (o canto): o vidro lateral vai do lado aberto, o oposto ao canto.
    if (box) box.opcoes.lateral = box.opcoes.sentido === 1 ? "direita" : "esquerda";
  }
  const pia = a.encostar("lavatorio", { largura: completo ? 0.9 : 0.6, profundidade: 0.48, altura: 0.86, minimo: 0.5 }, { lados: livres, ancora: "inicio", folga: 0.05, opcoes: { cuba: true } });
  if (pia) a.encostar("espelho", { largura: pia.largura, profundidade: 0.03, altura: 0.8 }, { lados: [lado(pia)], elevacao: 1.1, ocupa: false });
  const vaso = { largura: 0.4, profundidade: 0.68, altura: 0.78 }, ladosVaso = pia ? [lado(pia), ...livres] : livres;
  for (const ancora of ["fim", "centro", "inicio"] as const) for (const folga of [0.18, 0.06]) {
    if (a.pecas.some(p => p.tipo === "vaso_sanitario")) break;
    a.encostar("vaso_sanitario", vaso, { lados: ladosVaso, ancora, folga });
  }
  luzDeTeto(a, "plafon");
}

function servico(a: Ambiente) {
  const tanque = a.encostar("tanque", { largura: 0.6, profundidade: 0.55, altura: 0.9 }, { ancora: "inicio", folga: 0.03 });
  a.encostar("maquina_lavar", { largura: 0.62, profundidade: 0.65, altura: 0.9 }, { lados: tanque ? [lado(tanque), ...a.ladosPorTamanho()] : undefined, ancora: "inicio", folga: 0.03 });
  a.encostar("armario_servico", { largura: 0.8, profundidade: 0.4, altura: 2.0, minimo: 0.6 }, { lados: a.outros(lado(tanque)), folga: 0.3 });
  luzDeTeto(a, "plafon");
}

function escritorio(a: Ambiente) {
  const mesa = a.encostar("escrivaninha", { largura: 1.4, profundidade: 0.6, altura: 0.76, minimo: 1.0 }, { folga: 0.3 });
  if (mesa) { const f = a.aFrente(mesa, 0.3); a.soltar("cadeira_escritorio", f.x, f.z, mesa.rot + Math.PI, { largura: 0.6, profundidade: 0.6, altura: 1.0 }, { ocupa: false }); }
  a.encostar("estante", { largura: 1.2, profundidade: 0.35, altura: 2.0, minimo: 0.8 }, { lados: a.outros(lado(mesa)), folga: 0.3 });
  a.noCanto("planta", a.ladosPorTamanho().at(-1) ?? 0, { largura: 0.4, profundidade: 0.4, altura: 1.1 }, { porte: "medio" });
  cortinas(a);
  luzDeTeto(a, "plafon");
}

function externo(a: Ambiente, gourmet: boolean) {
  if (gourmet) a.encostar("churrasqueira", { largura: 1.6, profundidade: 0.65, altura: 2.2, minimo: 1.0 }, { folga: 0.1 });
  if (a.area >= 6) mesaComCadeiras(a, a.centro.x, a.centro.y, 0, a.area >= 12 ? 6 : 4, "mesa_externa");
  else a.encostar("poltrona", { largura: 0.75, profundidade: 0.75, altura: 0.8 }, { folga: 0.2, opcoes: { externa: true } });
  a.noCanto("planta", 0, { largura: 0.5, profundidade: 0.5, altura: 1.4 }, { porte: "grande" });
  a.noCanto("planta", a.lados.length > 2 ? 2 : 0, { largura: 0.4, profundidade: 0.4, altura: 0.9 }, { porte: "medio" });
  luzDeTeto(a, "plafon");
}

function passagem(a: Ambiente) {
  // Só mobília se sobrar corredor de pelo menos 90 cm.
  const menor = Math.min(...a.lados.map(l => l.comp));
  if (menor >= 1.5) quadroSobre(a, a.encostar("aparador", { largura: 1.1, profundidade: 0.35, altura: 0.8, minimo: 0.8 }, { lados: a.ladosPorTamanho(i => !a.temPorta(i)), folga: 0.9 }));
  luzDeTeto(a, "plafon");
}

/** Mobília de um cômodo, conforme a função dele. */
export function mobiliarComodo(c: Comodo, pv: Pavimento): PecaMobilia[] {
  if (c.poligono.length < 3 || areaPoligono(c.poligono) < 1.2) return [];
  const a = new Ambiente(c, pv);
  switch (c.funcao) {
    case "sala": sala(a, !pv.comodos.some(x => x.funcao === "sala_jantar")); break;
    case "sala_jantar": jantar(a); break;
    case "cozinha": cozinha(a); break;
    case "quarto": quarto(a, false); break;
    case "suite": quarto(a, true); break;
    case "banheiro": banheiro(a, true); break;
    case "lavabo": banheiro(a, false); break;
    case "area_servico": servico(a); break;
    case "escritorio": escritorio(a); break;
    case "varanda": externo(a, false); break;
    case "area_gourmet": externo(a, true); break;
    case "closet":
      a.encostar("guarda_roupa", { largura: 1.6, profundidade: 0.55, altura: 2.3, minimo: 0.9 }, { esticarAte: 3, folga: 0.6, opcoes: { portas: "aberto" } });
      luzDeTeto(a, "plafon"); break;
    case "despensa": case "deposito":
      a.encostar("prateleira", { largura: 1.2, profundidade: 0.4, altura: 1.9, minimo: 0.7 }, { esticarAte: 2.4, folga: 0.5 });
      luzDeTeto(a, "plafon"); break;
    case "garagem": {
      // Carro no sentido do maior lado da garagem; uma vaga a cada 2,6 m de largura livre (no máximo duas).
      const maior = a.lados[a.ladosPorTamanho()[0]], rot = Math.atan2(maior.ux, maior.uy);
      const menor = Math.min(...a.lados.map(l => l.comp)), vagas = menor >= 5.4 ? 2 : 1;
      const atravessado = { x: Math.cos(rot), z: -Math.sin(rot) }, aoLongo = { x: Math.sin(rot), z: Math.cos(rot) };
      for (let v = 0; v < vagas; v++) {
        const base = vagas === 2 ? (v === 0 ? -1.35 : 1.35) : 0;
        // Se a vaga centrada esbarra numa passagem, tenta deslocar o carro para os lados e para o fundo.
        const tentativas = [[0, 0], [0.5, 0], [-0.5, 0], [0.9, 0], [-0.9, 0], [0, 0.4], [0, -0.4], [0.5, 0.4], [-0.5, 0.4], [0.5, -0.4], [-0.5, -0.4]];
        for (const [dl, df] of tentativas) {
          const x = a.centro.x + atravessado.x * (base + dl) + aoLongo.x * df, z = a.centro.y + atravessado.z * (base + dl) + aoLongo.z * df;
          if (a.soltar("carro", x, z, rot, { largura: 1.8, profundidade: 4.3, altura: 1.48 }, { folga: 0.3, opcoes: { cor: v === 0 ? "prata" : "grafite" } })) break;
        }
      }
      a.encostar("prateleira", { largura: 1.2, profundidade: 0.4, altura: 1.9, minimo: 0.8 }, { lados: a.ladosPorTamanho().reverse(), folga: 0.2 });
      luzDeTeto(a, "plafon"); break;
    }
    case "hall": case "circulacao": passagem(a); break;
    case "area_externa": break;
    default: luzDeTeto(a, "plafon");
  }
  return a.pecas;
}

export const mobiliarPavimento = (pv: Pavimento): PecaMobilia[] => pv.comodos.flatMap(c => mobiliarComodo(c, pv));

/**
 * EPIC-028: peças de um pavimento — os itens gravados da maquete (ex.: os `itens` do JSON-fonte) SUBSTITUEM a
 * mobília automática; sem itens, vale a mobília automática de sempre.
 */
export function pecasDoPavimento<T extends PecaMobilia>(pv: Pavimento, itens?: T[] | null): (T | PecaMobilia)[] {
  return itens && itens.length ? itens : mobiliarPavimento(pv);
}
