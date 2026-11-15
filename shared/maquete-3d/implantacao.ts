// Maquete 3D (EPIC-022, etapa 4) — implantação a partir do que o estudo de Incorporação JÁ guarda: a divisa do
// terreno (GeoJSON em longitude/latitude) e o cenário escolhido do estudo de massa (lotes e ruas com geometria).
// Nada é lido de PDF nem inventado: é a mesma geometria do parcelamento, convertida para metros.
// Planta: x para leste, y para SUL (o norte fica "para cima" na tela, como no mapa).
import type { Position } from "geojson";
import { criarProjecao, type CenarioMassa } from "../incorporacao/massa.js";
import { poligonosDoTerreno, type GeometriaTerreno } from "../geo/terreno.js";
import { implantacaoSchema, type Implantacao, type Ponto } from "./modelo.js";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Código da unidade no inventário comercial (mesma regra de shared/incorporacao/unidades.ts). */
export const codigoDaUnidade = (quadra: string, lote: string) => `Q${quadra} / L${lote}`;

/**
 * Monta a implantação da maquete. `centro` é [longitude, latitude] do estudo. Devolve também quantos lotes
 * foram descartados por geometria inválida (para avisar em vez de sumir em silêncio).
 */
export function implantacaoDoEstudo(geojson: string | null, centro: [number, number] | null, cenario: CenarioMassa | null): { implantacao: Implantacao; descartados: number } | null {
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
  return { implantacao: implantacaoSchema.parse({ terreno: maior, ruas, lotes }), descartados };
}
