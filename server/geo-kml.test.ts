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

describe("parseKmlTerreno", () => {
  it("extrai polígono, área, perímetro e centro de um KML válido", () => {
    const resultado = parseKmlTerreno(KML_QUADRADO);
    expect(resultado.feature.geometry.type).toBe("Polygon");
    expect(resultado.areaM2).toBeGreaterThan(0);
    expect(resultado.perimetroM).toBeGreaterThan(0);
    expect(resultado.centro[0]).toBeCloseTo(-47.4995, 2);
    expect(resultado.centro[1]).toBeCloseTo(-5.5195, 2);
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
