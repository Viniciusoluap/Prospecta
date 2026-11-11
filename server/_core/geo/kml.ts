import { kml as kmlToGeoJSON } from "@tmcw/togeojson";
import { DOMParser } from "@xmldom/xmldom";
import { area, centerOfMass, centroid, flattenEach, length, lineString, multiPolygon, polygon } from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import { poligonosDoTerreno, uniaoDoTerreno, type GeometriaTerreno } from "../../../shared/geo/terreno.js";

export interface TerrenoGeo {
  feature: GeometriaTerreno;
  areaM2: number;
  perimetroM: number;
  centro: [number, number]; // [lng, lat]
}

export function parseKmlTerreno(kmlText: string): TerrenoGeo {
  const doc = new DOMParser().parseFromString(kmlText, "text/xml");
  const geojson = kmlToGeoJSON(doc as unknown as Document);
  const partes: Feature<Polygon>[] = [];
  for (const { geometry, properties } of geojson.features) {
    if (!geometry) continue;
    flattenEach(geometry, ({ geometry: parte }) => {
      if (parte?.type === "Polygon") partes.push(polygon(parte.coordinates, properties ?? {}));
    });
  }
  if (partes.length === 0) {
    throw new Error("Nenhum polígono encontrado no KML. Verifique se o arquivo contém a área do terreno.");
  }

  const feature = partes.length === 1 ? partes[0] : multiPolygon(partes.map(p => p.geometry.coordinates));
  const contorno = uniaoDoTerreno(feature);
  const poligonos = poligonosDoTerreno(contorno);
  const perimetroKm = poligonos.reduce((total, [anel]) => total + length(lineString(anel)), 0);

  const centro = partes.length === 1
    ? centroid(feature).geometry.coordinates as [number, number]
    : centroPonderado(poligonos);

  return {
    feature,
    areaM2: Math.round(area(contorno)),
    perimetroM: Math.round(perimetroKm * 1000),
    centro,
  };
}

function centroPonderado(poligonos: ReturnType<typeof poligonosDoTerreno>): [number, number] {
  let areaTotal = 0;
  let lngTotal = 0;
  let latTotal = 0;
  for (const aneis of poligonos) {
    for (let i = 0; i < aneis.length; i++) {
      const parte = polygon([aneis[i]]);
      const areaParte = (i === 0 ? 1 : -1) * area(parte);
      const [lng, lat] = centerOfMass(parte).geometry.coordinates;
      areaTotal += areaParte;
      lngTotal += lng * areaParte;
      latTotal += lat * areaParte;
    }
  }
  if (areaTotal <= 0) throw new Error("O KML não contém polígonos com área válida.");
  return [lngTotal / areaTotal, latTotal / areaTotal];
}
