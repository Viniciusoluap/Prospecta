// Maquete 3D (EPIC-022, etapa 4) — implantação a partir do que o estudo de Incorporação JÁ guarda: a divisa do
// terreno (GeoJSON em longitude/latitude) e o cenário escolhido do estudo de massa (lotes e ruas com geometria).
// Nada é lido de PDF nem inventado: é a mesma geometria do parcelamento, convertida para metros.
// Planta: x para leste, y para SUL (o norte fica "para cima" na tela, como no mapa).
import type { Position } from "geojson";
import { criarProjecao, type CenarioMassa } from "../incorporacao/massa.js";
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

  let descartados = 0;
  const maior = aneisTerreno.map(local).sort((a, b) => b.length - a.length)[0] ?? [];
  const lotes = (cenario?.lotes ?? []).flatMap((l, i) => {
    const poligono = local(l.anel);
    if (poligono.length < 3) { descartados++; return []; }
    const quadra = String(l.quadra ?? ""), nome = String(l.numero ?? "");
    return [{
      id: `l${i + 1}`, nome: nome.slice(0, 40), quadra: quadra.slice(0, 40), poligono, areaInformada: l.areaM2 > 0 ? r2(l.areaM2) : null, tipo: l.tipo,
      unidade: l.tipo === "vendavel" && quadra && nome ? codigoDaUnidade(quadra, nome) : null,
    }];
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
  return { implantacao: implantacaoSchema.parse({ terreno: maior, ruas, lotes, relevo }), descartados };
}
