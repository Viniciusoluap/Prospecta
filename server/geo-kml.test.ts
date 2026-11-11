import { describe, it, expect } from "vitest";
import { parseKmlTerreno } from "./_core/geo/kml";

const KML_QUADRADO = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Terreno</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              -47.500000,-5.520000,0
              -47.499000,-5.520000,0
              -47.499000,-5.519000,0
              -47.500000,-5.519000,0
              -47.500000,-5.520000,0
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;

function retangulo(oeste: number, leste: number) {
  return `<Polygon><outerBoundaryIs><LinearRing><coordinates>
    ${oeste},-5.52 ${leste},-5.52 ${leste},-5.519 ${oeste},-5.519 ${oeste},-5.52
  </coordinates></LinearRing></outerBoundaryIs></Polygon>`;
}

function documentoKml(conteudo: string) {
  return `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${conteudo}</Document></kml>`;
}

describe("parseKmlTerreno", () => {
  it("extrai polígono, área, perímetro e centro de um KML válido", () => {
    const resultado = parseKmlTerreno(KML_QUADRADO);
    expect(resultado.feature.geometry.type).toBe("Polygon");
    expect(resultado.areaM2).toBeGreaterThan(0);
    expect(resultado.perimetroM).toBeGreaterThan(0);
    expect(resultado.centro[0]).toBeCloseTo(-47.4995, 2);
    expect(resultado.centro[1]).toBeCloseTo(-5.5195, 2);
  });

  it("importa polígonos de pastas e MultiGeometry, incluindo geometrias mistas", () => {
    const primeiro = retangulo(-47.50, -47.499);
    const segundo = retangulo(-47.49, -47.489);
    const terceiro = retangulo(-47.48, -47.479);
    const resultado = parseKmlTerreno(documentoKml(`
      <Folder><Placemark>${primeiro}</Placemark></Folder>
      <Placemark><MultiGeometry>
        ${segundo}${terceiro}<Point><coordinates>-47.47,-5.52</coordinates></Point>
      </MultiGeometry></Placemark>`));
    const unico = parseKmlTerreno(documentoKml(`<Placemark>${primeiro}</Placemark>`));

    expect(resultado.feature.geometry.type).toBe("MultiPolygon");
    expect(resultado.feature.geometry.coordinates).toHaveLength(3);
    expect(Math.abs(resultado.areaM2 - 3 * unico.areaM2)).toBeLessThanOrEqual(2);
    expect(Math.abs(resultado.perimetroM - 3 * unico.perimetroM)).toBeLessThanOrEqual(2);
    expect(resultado.centro[0]).toBeCloseTo(-47.4895, 6);
    expect(resultado.centro[1]).toBeCloseTo(-5.5195, 6);
  });

  it("preserva os desenhos e calcula a área e perímetro sem duplicar a sobreposição", () => {
    const resultado = parseKmlTerreno(documentoKml(`
      <Placemark>${retangulo(-47.50, -47.498)}</Placemark>
      <Placemark>${retangulo(-47.499, -47.497)}</Placemark>`));
    const contorno = parseKmlTerreno(documentoKml(`<Placemark>${retangulo(-47.50, -47.497)}</Placemark>`));

    expect(resultado.feature.geometry.type).toBe("MultiPolygon");
    expect(resultado.feature.geometry.coordinates).toHaveLength(2);
    expect(resultado.areaM2).toBe(contorno.areaM2);
    expect(resultado.perimetroM).toBe(contorno.perimetroM);
    expect(resultado.centro[0]).toBeCloseTo(-47.4985, 6);
  });

  it("lança erro quando o KML não contém nenhum polígono", () => {
    const kmlSemPoligono = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Ponto</name>
      <Point><coordinates>-47.5,-5.52,0</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;
    expect(() => parseKmlTerreno(kmlSemPoligono)).toThrow(/Nenhum polígono/);
  });

  it("lança erro para XML inválido/vazio", () => {
    expect(() => parseKmlTerreno("")).toThrow();
  });
});
