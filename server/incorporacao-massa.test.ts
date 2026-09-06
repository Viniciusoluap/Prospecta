import { describe, it, expect } from "vitest";
import { criarRng, areaPlanar, criarProjecao, gerarCenariosMassa, type ParametrosMassa } from "../shared/incorporacao/massa";
import type { Position } from "geojson";

describe("criarRng", () => {
  it("é determinístico para a mesma seed", () => {
    const a = criarRng(42);
    const b = criarRng(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produz valores no intervalo [0, 1)", () => {
    const rnd = criarRng(7);
    for (let i = 0; i < 20; i++) {
      const v = rnd();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("areaPlanar", () => {
  it("calcula a área de um quadrado em metros (shoelace)", () => {
    const quadrado: Position[] = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]];
    expect(areaPlanar(quadrado)).toBeCloseTo(10_000, 1);
  });
});

describe("criarProjecao", () => {
  it("é aproximadamente inversível (ida e volta preserva o ponto)", () => {
    const centro: [number, number] = [-47.5, -5.5];
    const proj = criarProjecao(centro);
    const original: Position = [-47.501, -5.501];
    const metros = proj.paraMetros(original);
    const volta = proj.paraGeo(metros);
    expect(volta[0]).toBeCloseTo(original[0], 6);
    expect(volta[1]).toBeCloseTo(original[1], 6);
  });
});

// Terreno quadrado de ~300m de lado perto do equador (facilita a conversão grau/metro).
function terrenoQuadrado(): { anel: Position[]; centro: [number, number] } {
  const lado = 0.003; // ~330m no equador
  const anel: Position[] = [
    [-47.5, -5.5],
    [-47.5 + lado, -5.5],
    [-47.5 + lado, -5.5 + lado],
    [-47.5, -5.5 + lado],
    [-47.5, -5.5],
  ];
  return { anel, centro: [-47.5 + lado / 2, -5.5 + lado / 2] };
}

const PARAMS: ParametrosMassa = {
  larguraViaM: 10,
  testadaLoteM: 10,
  profundidadeLoteM: 20,
  loteMinimoM2: 150,
  comprimentoMaxQuadraM: 80,
  percentInstitucional: 0.05,
  percentAreaVerde: 0.1,
  precoM2Lote: 500,
};

describe("gerarCenariosMassa", () => {
  it("gera cenários com lotes e KPIs consistentes", () => {
    const { anel, centro } = terrenoQuadrado();
    const cenarios = gerarCenariosMassa(anel, centro, PARAMS, { populacao: 8, geracoes: 4, seed: 1, nCenarios: 2 });

    expect(cenarios.length).toBeGreaterThan(0);
    for (const c of cenarios) {
      const somaVendavel = c.lotes.filter((l) => l.tipo === "vendavel").reduce((s, l) => s + l.areaM2, 0);
      expect(somaVendavel).toBe(c.kpis.areaVendavelM2);
      expect(c.kpis.vgv).toBe(Math.round(c.kpis.areaVendavelM2 * PARAMS.precoM2Lote));
      expect(c.kpis.lotesVendaveis).toBe(c.lotes.filter((l) => l.tipo === "vendavel").length);
    }
  });

  it("é determinístico para a mesma seed", () => {
    const { anel, centro } = terrenoQuadrado();
    const opts = { populacao: 8, geracoes: 4, seed: 99, nCenarios: 2 };
    const c1 = gerarCenariosMassa(anel, centro, PARAMS, opts);
    const c2 = gerarCenariosMassa(anel, centro, PARAMS, opts);
    expect(c1.map((c) => c.kpis.vgv)).toEqual(c2.map((c) => c.kpis.vgv));
    expect(c1.map((c) => c.anguloVia)).toEqual(c2.map((c) => c.anguloVia));
  });
});
