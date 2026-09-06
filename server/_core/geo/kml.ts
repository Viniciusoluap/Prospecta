// Parsing de KML → GeoJSON e métricas do terreno (área, perímetro, centróide).
// Porta direta da lógica do Grupo Santa Fé (server/_core/geo/kml.ts lá),
// mesmas bibliotecas (@tmcw/togeojson + @xmldom/xmldom + @turf/turf) — cálculo
// puro de geometria, sem invenção de regra de negócio.

import { kml as kmlToGeoJSON } from "@tmcw/togeojson";
import { DOMParser } from "@xmldom/xmldom";
import { area, length, centroid, polygon as turfPolygon, lineString } from "@turf/turf";
import type { Feature, Polygon, Position } from "geojson";

export interface TerrenoGeo {
  feature: Feature<Polygon>;
  areaM2: number;
  perimetroM: number;
  centro: [number, number]; // [lng, lat]
}

export function parseKmlTerreno(kmlText: string): TerrenoGeo {
  const doc = new DOMParser().parseFromString(kmlText, "text/xml");
  const geojson = kmlToGeoJSON(doc as unknown as Document);

  const poly = extrairPrimeiroPolygon(geojson);
  if (!poly) {
    throw new Error("Nenhum polígono encontrado no KML. Verifique se o arquivo contém a área do terreno.");
  }

  const areaM2 = Math.round(area(poly));
  const anel = poly.geometry.coordinates[0];
  const perimetroM = Math.round(length(lineString(anel), { units: "kilometers" }) * 1000);
  const c = centroid(poly).geometry.coordinates as [number, number];

  return { feature: poly, areaM2, perimetroM, centro: [c[0], c[1]] };
}

function extrairPrimeiroPolygon(geojson: ReturnType<typeof kmlToGeoJSON>): Feature<Polygon> | null {
  const features = geojson.type === "FeatureCollection" ? geojson.features : [];
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Polygon") {
      return turfPolygon(g.coordinates as Position[][], f.properties ?? {});
    }
    if (g.type === "MultiPolygon" && g.coordinates.length > 0) {
      return turfPolygon(g.coordinates[0] as Position[][], f.properties ?? {});
    }
  }
  return null;
}
