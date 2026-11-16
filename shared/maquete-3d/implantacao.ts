// Maquete 3D (EPIC-022, etapa 4) — implantação a partir do que o estudo de Incorporação JÁ guarda: a divisa do
// terreno (GeoJSON em longitude/latitude) e o cenário escolhido do estudo de massa (lotes e ruas com geometria).
// Nada é lido de PDF nem inventado: é a mesma geometria do parcelamento, convertida para metros.
// Planta: x para leste, y para SUL (o norte fica "para cima" na tela, como no mapa).
import type { MultiPolygon, Polygon, Position } from "geojson";
import { bboxPolygon, featureCollection, intersect, polygon as turfPolygon } from "@turf/turf";
import { criarProjecao, ROTULO_RESTRICAO_GEO, type CenarioMassa } from "../incorporacao/massa.js";
import { poligonosDoTerreno, type GeometriaTerreno } from "../geo/terreno.js";
import { implantacaoSchema, type Implantacao, type Ponto, type Relevo } from "./modelo.js";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Código da unidade no inventário comercial (mesma regra de shared/incorporacao/unidades.ts). */
export const codigoDaUnidade = (quadra: string, lote: string) => `Q${quadra} / L${lote}`;

/**
 * Monta a implantação da maquete. `centro` é [longitude, latitude] do estudo. Devolve também quantos lotes
 * foram descartados por geometria inválida (para avisar em vez de sumir em silêncio).
 */
/** Grade de elevação que o estudo guarda (server/_core/geo/elevacao.ts): linha 0 = norte, coluna 0 = oeste, em graus. */
export type GradeElevacao = { ncols: number; nrows: number; cellsizeX: number; cellsizeY: number; west: number; south: number; z: number[][] };

const LADO_RELEVO = 48; // pontos por lado da grade da maquete

type Anel = [number, number][];

/**
 * S-I: o lote da maquete não tem furo. Uma peça com furo (APP que cerca uma parte loteável) cobriria a ilha; ela é
 * cortada por verticais que passam pelos furos até não sobrar nenhum, e cada pedaço vira um lote. Anéis sem o ponto
 * de fechamento.
 */
export function pecasSemFuros(externo: Anel, furos: Anel[], profundidade = 0): Anel[] {
  if (furos.length === 0 || profundidade > 12) return [externo];
  const fechar = (a: Anel): Anel => [...a, a[0]];
  const xs = furos[0].map((p) => p[0]), cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const ex = externo.map((p) => p[0]), ey = externo.map((p) => p[1]);
  const [x0, y0, x1, y1] = [Math.min(...ex) - 1, Math.min(...ey) - 1, Math.max(...ex) + 1, Math.max(...ey) + 1];
  let poli;
  try { poli = turfPolygon([fechar(externo), ...furos.map(fechar)]); } catch { return [externo]; }
  const out: Anel[] = [];
  for (const caixa of [bboxPolygon([x0, y0, cx, y1]), bboxPolygon([cx, y0, x1, y1])]) {
    let x;
    try { x = intersect(featureCollection([poli, caixa])); } catch { x = null; }
    if (!x) continue;
    const g = x.geometry as Polygon | MultiPolygon;
    for (const p of g.type === "Polygon" ? [g.coordinates] : g.coordinates) {
      const aneis = p.map((a) => a.slice(0, -1).map((q) => [q[0], q[1]] as [number, number]));
      out.push(...pecasSemFuros(aneis[0], aneis.slice(1), profundidade + 1));
    }
  }
  return out.length > 0 ? out : [externo];
}

export function implantacaoDoEstudo(geojson: string | null, centro: [number, number] | null, cenario: CenarioMassa | null, elevacao: GradeElevacao | null = null): { implantacao: Implantacao; descartados: number } | null {
  let terreno: GeometriaTerreno | null = null;
  try { terreno = geojson ? (JSON.parse(geojson) as GeometriaTerreno) : null; } catch { terreno = null; }
  const aneisTerreno = terreno ? poligonosDoTerreno(terreno).map(p => p[0]).filter(a => a && a.length >= 4) : [];
  const todos: Position[] = [...aneisTerreno.flat(), ...(cenario?.lotes.flatMap(l => l.anel) ?? [])];
  if (!todos.length) return null;
  const origem: [number, number] = centro ?? [todos.reduce((s, p) => s + p[0], 0) / todos.length, todos.reduce((s, p) => s + p[1], 0) / todos.length];
  const proj = criarProjecao(origem);
  const bruto = (anel: Position[]): [number, number][] => {
    const pts = anel.map(p => proj.paraMetros(p));
    const [a, b] = [pts[0], pts[pts.length - 1]];
    if (pts.length > 1 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01) pts.pop(); // anel fechado: tira o ponto repetido
    return pts;
  };
  // Origem da planta no canto noroeste do conjunto, para as coordenadas ficarem positivas e pequenas.
  const metros = todos.map(p => proj.paraMetros(p));
  const oeste = Math.min(...metros.map(m => m[0])), norte = Math.max(...metros.map(m => m[1]));
  const local = (anel: Position[]): Ponto[] => bruto(anel).map(([x, y]) => ({ x: r2(x - oeste), y: r2(norte - y) }));

  // o contorno da maquete aceita até 4000 pontos (a APP pelo contorno real pode ter mais): reduz por amostragem
  const reduzir = (pts: Ponto[]): Ponto[] => (pts.length <= 4000 ? pts : pts.filter((_, k) => k % Math.ceil(pts.length / 4000) === 0));
  let descartados = 0;
  // Com várias áreas separadas (KML com MultiPolygon), a de maior ÁREA (não a de mais vértices) fica em `terreno` e
  // as outras em `terrenosExtras` (S-04: o muro do condomínio cerca todas). Lotes e ruas de todas continuam aqui.
  const areaLocal = (pts: Ponto[]) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2);
  const porArea = aneisTerreno.map(local).map(reduzir).map((pts) => ({ pts, area: areaLocal(pts) })).filter(a => a.pts.length >= 3).sort((a, b) => b.area - a.area);
  const maior = porArea[0]?.pts ?? [];
  const extras = porArea.slice(1, 50).map(a => a.pts);
  const lotes = (cenario?.lotes ?? []).flatMap((l, i) => {
    const inteiro = local(l.anel);
    if (inteiro.length < 3) { descartados++; return []; }
    // peça com furo (ex.: APP em volta de uma parte loteável): vira pedaços sem furo, para não cobrir o que há dentro
    const furos = (l.furos ?? []).map(local).filter((f) => f.length >= 3);
    const pedacos = furos.length === 0 ? [inteiro]
      : pecasSemFuros(inteiro.map((p) => [p.x, p.y] as [number, number]), furos.map((f) => f.map((p) => [p.x, p.y] as [number, number])))
        .map((a) => a.map(([x, y]) => ({ x: r2(x), y: r2(y) })));
    return pedacos.flatMap((pedaco, k) => {
    const poligono = reduzir(pedaco);
    if (poligono.length < 3) return [];
    const quadra = String(l.quadra ?? ""), nome = String(l.numero ?? "");
    // S-I: APP desenhada pelo contorno real é vegetação na maquete, qualquer que seja o destino dela nas doações
    const restricao = l.restricao ? ROTULO_RESTRICAO_GEO[l.restricao] : null;
    const verdeNatural = l.restricao === "app" || l.restricao === "supressao_vegetal";
    return [{
      id: pedacos.length > 1 ? `l${i + 1}-${k + 1}` : `l${i + 1}`, nome: (restricao ?? nome).slice(0, 40), quadra: quadra.slice(0, 40), poligono,
      areaInformada: pedacos.length > 1 ? r2(areaLocal(poligono)) : l.areaM2 > 0 ? r2(l.areaM2) : null, tipo: l.tipo,
      uso: verdeNatural ? "verde" as const : l.tipo === "area_publica" ? ((l as { uso?: string }).uso === "institucional" ? "institucional" as const : "verde" as const) : null,
      unidade: l.tipo === "vendavel" && quadra && nome ? codigoDaUnidade(quadra, nome) : null,
    }];
    });
  });
  const ruas = [...(cenario?.ruas ?? []), ...(cenario?.vias ?? [])].map(local).filter(r => r.length >= 3);

  // Relevo: a grade do estudo (em graus) é reamostrada numa grade regular em metros, cobrindo o conjunto com folga.
  let relevo: Relevo | null = null;
  const g = elevacao;
  if (g && g.ncols >= 2 && g.nrows >= 2 && g.z?.length >= g.nrows && g.cellsizeX > 0 && g.cellsizeY > 0) {
    const leste = Math.max(...metros.map(m => m[0])), sul = Math.min(...metros.map(m => m[1]));
    const folga = Math.max(8, Math.max(leste - oeste, norte - sul) * 0.08);
    const largura = leste - oeste + folga * 2, altura = norte - sul + folga * 2;
    const nortGrade = g.south + (g.nrows - 1) * g.cellsizeY;
    const amostra = (lng: number, lat: number) => {
      const fc = Math.min(g.ncols - 1, Math.max(0, (lng - g.west) / g.cellsizeX)), fl = Math.min(g.nrows - 1, Math.max(0, (nortGrade - lat) / g.cellsizeY));
      const c = Math.min(g.ncols - 2, Math.floor(fc)), l = Math.min(g.nrows - 2, Math.floor(fl)), tc = fc - c, tl = fl - l;
      const h = (ll: number, cc: number) => Number(g.z[ll]?.[cc]) || 0;
      return (h(l, c) * (1 - tc) + h(l, c + 1) * tc) * (1 - tl) + (h(l + 1, c) * (1 - tc) + h(l + 1, c + 1) * tc) * tl;
    };
    const dx = largura / (LADO_RELEVO - 1), dy = altura / (LADO_RELEVO - 1), alturas: number[] = [];
    for (let l = 0; l < LADO_RELEVO; l++) for (let c = 0; c < LADO_RELEVO; c++) {
      const [lng, lat] = proj.paraGeo([oeste - folga + c * dx, norte + folga - l * dy]);
      alturas.push(amostra(lng, lat));
    }
    const minimo = Math.min(...alturas);
    if (Math.max(...alturas) - minimo > 0.05) {
      relevo = { x0: r2(-folga), y0: r2(-folga), dx, dy, colunas: LADO_RELEVO, linhas: LADO_RELEVO, alturas: alturas.map(h => r2(h - minimo)), altitudeBase: r2(minimo) };
    }
  }
  // S-04: acessos da malha na divisa (onde a rua sai do terreno) — é onde o muro do condomínio ganha o portão.
  // Valem os da divisa de qualquer área do terreno.
  const naDivisa = (p: Ponto) => [maior, ...extras].some(area => area.length >= 3 && area.some((a, i) => {
    const b = area[(i + 1) % area.length], ab = { x: b.x - a.x, y: b.y - a.y }, l2 = ab.x * ab.x + ab.y * ab.y || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2));
    return Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t)) < 3;
  }));
  const acessos = (cenario?.acessos ?? []).map(ac => {
    const [p] = local([ac.ponto, ac.ponto]);
    return { x: p.x, y: p.y, viaExistente: !!ac.viaExistente, distancia: typeof ac.distanciaM === "number" ? r2(ac.distanciaM) : null };
  }).filter(naDivisa).slice(0, 60);
  return { implantacao: implantacaoSchema.parse({ terreno: maior, ...(extras.length ? { terrenosExtras: extras } : {}), ruas, lotes, relevo, acessos }), descartados };
}
