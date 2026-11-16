// Estudo de Massa — S-I (EPIC-023): APP com o contorno real. A APP calculada no mapa do Terreno sai da área loteável
// pelo contorno: nenhum lote nem via dentro dela, a peça aparece no desenho na posição real com o destino escolhido,
// sem contar duas vezes no quadro de áreas, e o quadro continua fechando em 100% da gleba.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { featureCollection, intersect, multiPolygon, polygon } from "@turf/turf";
import type { Position } from "geojson";
import { describe, expect, it } from "vitest";
import {
  assinaturaEntradas, criarProjecao, gerarEstudoMassa, type CenarioMassa, type EntradaGleba, type ParametrosMassa, type RestricaoGeometrica,
} from "../shared/incorporacao/massa";
import { montarModeloPlanta, renderizarPlantaSvg, vistaInicial } from "../shared/incorporacao/planta-tecnica";
import { contornoAppParaGravar } from "../shared/geo/camadas-terreno";
import { implantacaoDoEstudo } from "../shared/maquete-3d/implantacao";

const CENTRO: [number, number] = [-47.49, -5.52];
const proj = criarProjecao(CENTRO);
const geo = (pts: [number, number][]): Position[] => { const a = pts.map((p) => proj.paraGeo(p)); a.push(a[0]); return a; };
const ret = (x0: number, y0: number, x1: number, y1: number) => geo([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);

const PARAMS: ParametrosMassa = {
  larguraViaM: 12, testadaLoteM: 10, profundidadeLoteM: 25, loteMinimoM2: 250, comprimentoMaxQuadraM: 120,
  percentInstitucional: 0.05, percentAreaVerde: 0.1, precoM2Lote: 500,
  // valor em m² "velho" no campo: com o contorno, o m² da APP vem do contorno, nunca deste número
  appM2: 31_000,
};

// gleba 400 × 240 m; APP na ponta oeste (80 m dentro da gleba, o contorno passa da divisa e é recortado)
const GLEBA = ret(-200, -120, 200, 120);
const APP_OESTE: RestricaoGeometrica = { tipo: "app", poligonos: [[ret(-260, -160, -120, 160)]] };
const APP_OESTE_M2 = 80 * 240;
// APP no meio, de divisa a divisa: corta a gleba em duas partes
const APP_MEIO: RestricaoGeometrica = { tipo: "app", poligonos: [[ret(-30, -150, 30, 150)]] };
const APP_MEIO_M2 = 60 * 240;

const m = (anel: Position[]) => anel.map((p) => proj.paraMetros(p));
function areaInter(a: Position[], r: RestricaoGeometrica): number {
  const x = intersect(featureCollection([polygon([m(a)]), multiPolygon(r.poligonos.map((poli) => poli.map(m)))]));
  if (!x) return 0;
  const ps = x.geometry.type === "Polygon" ? [x.geometry.coordinates] : x.geometry.coordinates;
  let s = 0;
  for (const p of ps) p.forEach((anel, k) => {
    let t = 0;
    for (let i = 0; i < anel.length - 1; i++) t += anel[i][0] * anel[i + 1][1] - anel[i + 1][0] * anel[i][1];
    s += (k === 0 ? 1 : -1) * Math.abs(t / 2);
  });
  return s;
}

/** Sobreposição (m²) de lotes vendáveis e de vias com a APP. */
function sobreposicao(c: CenarioMassa, r: RestricaoGeometrica) {
  const lotes = c.lotes.filter((l) => l.tipo === "vendavel").reduce((s, l) => s + areaInter(l.anel, r), 0);
  const vias = [...(c.ruas ?? []), ...(c.vias ?? [])].reduce((s, a) => s + areaInter(a, r), 0);
  return { lotes, vias };
}

function conferir(c: CenarioMassa, r: RestricaoGeometrica, appM2: number) {
  const s = sobreposicao(c, r);
  expect(s.lotes).toBeLessThan(1);
  expect(s.vias).toBeLessThan(1);
  const app = c.lotes.filter((l) => l.restricao === "app");
  expect(app.length).toBeGreaterThan(0);
  expect(app.reduce((t, l) => t + l.areaM2, 0)).toBeCloseTo(appM2, 0);
  expect(c.quadroAreas?.appM2).toBeCloseTo(appM2, 0);
  expect(Math.abs(c.fechoAreas!.diferencaM2)).toBeLessThanOrEqual(0.05);
  expect(c.kpis.lotesVendaveis).toBeGreaterThan(0);
}

describe("S-I — APP com o contorno real no motor do Estudo de Massa", () => {
  for (const tipologia of ["grid", "cul_de_sac"] as const) {
    it(`${tipologia}: nenhum lote nem via na APP, peça da APP na posição real e quadro fechando`, () => {
      const r = gerarEstudoMassa(GLEBA, CENTRO, { ...PARAMS, tipologia }, { nCenarios: 1, restricoes: [APP_OESTE] });
      const c = r.cenarios[0];
      conferir(c, APP_OESTE, APP_OESTE_M2);
      // destino padrão: conta como área verde, e a verde exigida (10% da parcelável) já é coberta pela APP
      const app = c.lotes.filter((l) => l.restricao === "app");
      expect(app.every((l) => l.tipo === "area_publica" && l.uso === "verde")).toBe(true);
      expect(c.quadroAreas?.areaVerdeEmRestricaoM2).toBeCloseTo(APP_OESTE_M2, 0);
      expect(c.quadroAreas?.areaVerdeExigidaM2).toBeCloseTo(0.1 * (96_000 - APP_OESTE_M2), 0);
      expect(c.limitacoes?.some((n) => n.startsWith("APP desenhada pelo contorno real") && n.includes("31.000"))).toBe(true);
      // a APP fica do lado oeste: todos os vértices dela estão a oeste de x = −120 m
      for (const l of app) for (const p of m(l.anel)) expect(p[0]).toBeLessThanOrEqual(-120 + 1e-6);
    });
  }

  it("sem o contorno, a APP informada em m² continua como hoje (desenhada fora da posição real)", () => {
    const sem = gerarEstudoMassa(GLEBA, CENTRO, { ...PARAMS, appM2: APP_OESTE_M2 }, { nCenarios: 1 });
    const vazio = gerarEstudoMassa(GLEBA, CENTRO, { ...PARAMS, appM2: APP_OESTE_M2 }, { nCenarios: 1, restricoes: [] });
    expect(vazio).toEqual(sem);
    expect(sem.cenarios[0].lotes.some((l) => l.restricao)).toBe(false);
    expect(sem.cenarios[0].quadroAreas?.appM2).toBe(APP_OESTE_M2);
    // assinatura sem restrição igual à de antes (cache dos estudos já gerados continua valendo)
    expect(assinaturaEntradas(GLEBA, PARAMS, null, [])).toBe(assinaturaEntradas(GLEBA, PARAMS, null));
    expect(assinaturaEntradas(GLEBA, PARAMS, null, [APP_OESTE])).not.toBe(assinaturaEntradas(GLEBA, PARAMS, null));
  });

  it("os três destinos da APP: área verde, institucional ou só não parcelável — sem contar duas vezes", () => {
    const rodar = (destinoApp: "verde" | "institucional" | "nenhum") =>
      gerarEstudoMassa(GLEBA, CENTRO, { ...PARAMS, destinoApp }, { nCenarios: 1, restricoes: [APP_OESTE] }).cenarios[0];
    const verde = rodar("verde"), inst = rodar("institucional"), nenhum = rodar("nenhum");
    for (const c of [verde, inst, nenhum]) conferir(c, APP_OESTE, APP_OESTE_M2);
    const app = (c: CenarioMassa) => c.lotes.filter((l) => l.restricao === "app");
    expect(app(inst).every((l) => l.tipo === "area_publica" && l.uso === "institucional")).toBe(true);
    expect(app(nenhum).every((l) => l.tipo === "nao_parcelavel" && !l.uso)).toBe(true);
    expect(inst.quadroAreas?.areaInstitucionalEmRestricaoM2).toBeCloseTo(APP_OESTE_M2, 0);
    expect(nenhum.quadroAreas?.areaVerdeEmRestricaoM2 ?? 0).toBe(0);
    expect(nenhum.quadroAreas?.economiaPorAproveitamentoM2).toBe(0);
    // a APP "só não parcelável" não cobre a verde exigida: a verde desenhada fora da APP é ao menos a exigida
    const verdeFora = (c: CenarioMassa) => c.lotes.filter((l) => !l.restricao && l.tipo === "area_publica" && l.uso === "verde").reduce((s, l) => s + l.areaM2, 0);
    expect(verdeFora(nenhum)).toBeGreaterThanOrEqual(0.1 * (96_000 - APP_OESTE_M2) - 1);
    // não há dupla contagem: a parcelável do quadro é a gleba menos a APP do contorno, nos três casos
    for (const c of [verde, inst, nenhum]) expect(c.quadroAreas?.areaParcelavelM2).toBeCloseTo(96_000 - APP_OESTE_M2, 0);
  });

  it("APP que corta a gleba em duas: cada parte vira uma área contínua com a própria malha", () => {
    for (const tipologia of ["grid", "cul_de_sac"] as const) {
      const r = gerarEstudoMassa(GLEBA, CENTRO, { ...PARAMS, tipologia }, { nCenarios: 1, restricoes: [APP_MEIO] });
      expect(r.areas).toBe(2);
      const c = r.cenarios[0];
      conferir(c, APP_MEIO, APP_MEIO_M2);
      expect(c.limitacoes?.some((n) => n.includes("dividem a gleba em 2 partes"))).toBe(true);
      // lotes dos dois lados da APP
      const xs = c.lotes.filter((l) => l.tipo === "vendavel").map((l) => m(l.anel)[0][0]);
      expect(xs.some((x) => x < -30)).toBe(true);
      expect(xs.some((x) => x > 30)).toBe(true);
    }
  });

  it("KML com várias áreas e furo: a APP numa delas sai só dali", () => {
    const furo = ret(140, -20, 170, 20).reverse();
    const entrada: EntradaGleba = [[ret(-200, -120, 0, 120)], [ret(60, -120, 260, 120), furo]];
    const appM2 = 60 * 240; // x ∈ [−200, −140] dentro da área 1
    const app: RestricaoGeometrica = { tipo: "app", poligonos: [[ret(-240, -200, -140, 200)]] };
    const r = gerarEstudoMassa(entrada, CENTRO, PARAMS, { nCenarios: 1, restricoes: [app] });
    const c = r.cenarios[0];
    conferir(c, app, appM2);
    expect(c.fechoAreas?.areaGlebaM2).toBeCloseTo(2 * 200 * 240 - 30 * 40, 0);
    // nada sobre o furo
    const noFuro: RestricaoGeometrica = { tipo: "app", poligonos: [[ret(140, -20, 170, 20)]] };
    expect(sobreposicao(c, noFuro).lotes).toBeLessThan(1);
  });

  it("determinístico: mesma entrada, mesmo resultado", () => {
    const a = gerarEstudoMassa(GLEBA, CENTRO, PARAMS, { nCenarios: 2, restricoes: [APP_MEIO] });
    const b = gerarEstudoMassa(GLEBA, CENTRO, PARAMS, { nCenarios: 2, restricoes: [APP_MEIO] });
    expect(b).toEqual(a);
  });

  it("contorno fora da gleba: APP zero (o m² dos parâmetros não volta)", () => {
    const fora: RestricaoGeometrica = { tipo: "app", poligonos: [[ret(400, 400, 500, 500)]] };
    const c = gerarEstudoMassa(GLEBA, CENTRO, PARAMS, { nCenarios: 1, restricoes: [fora] }).cenarios[0];
    expect(c.quadroAreas?.appM2).toBe(0);
    expect(c.lotes.some((l) => l.restricao)).toBe(false);
  });

  it("planta técnica identifica a APP (rótulo e legenda) e a maquete 3D recebe a APP como área verde", () => {
    const c = gerarEstudoMassa(GLEBA, CENTRO, { ...PARAMS, destinoApp: "nenhum" }, { nCenarios: 1, restricoes: [APP_OESTE] }).cenarios[0];
    const modelo = montarModeloPlanta(GLEBA, c, CENTRO);
    expect(modelo.restricoes).toEqual([expect.objectContaining({ tipo: "app", rotulo: "APP", destino: "só não parcelável" })]);
    const svg = renderizarPlantaSvg(modelo, vistaInicial(modelo, 1200, 800));
    expect(svg).toContain(">APP</tspan>");
    expect(svg).toContain("APP (contorno real)");
    const terreno = JSON.stringify({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [GLEBA] } });
    const imp = implantacaoDoEstudo(terreno, CENTRO, c)!;
    const app = imp.implantacao.lotes.filter((l) => l.nome === "APP");
    expect(app.length).toBeGreaterThan(0);
    expect(app.every((l) => l.uso === "verde")).toBe(true);
  });
});

describe("S-I — contorno da APP gravado no estudo", () => {
  it("contornoAppParaGravar: MultiPolygon com 7 casas e anéis fechados; nulo sem APP", () => {
    expect(contornoAppParaGravar(null)).toBeNull();
    const g = contornoAppParaGravar({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ret(-10, -10, 10, 10)] } })!;
    expect(g.type).toBe("MultiPolygon");
    const anel = g.coordinates[0][0];
    expect(anel[0]).toEqual(anel[anel.length - 1]);
    for (const p of anel) for (const v of p) expect(Math.round(v * 1e7) / 1e7).toBe(v);
  });

  it("migração 0117: aditiva e idempotente (coluna nova, nula)", async () => {
    const pg = new PGlite();
    await pg.exec(`CREATE TABLE incorporation_studies (id serial PRIMARY KEY, name text, app_area_m2 numeric(15,2));
      INSERT INTO incorporation_studies (name, app_area_m2) VALUES ('Gleba', 1234.5);`);
    const sql = readFileSync(new URL("../drizzle/0117_contorno_app_estudo.sql", import.meta.url), "utf8");
    await pg.exec(sql);
    await pg.exec(sql);
    const r = await pg.query<{ name: string; app_area_m2: string; app_geometry_json: string | null }>("SELECT name, app_area_m2, app_geometry_json FROM incorporation_studies");
    expect(r.rows).toEqual([{ name: "Gleba", app_area_m2: "1234.50", app_geometry_json: null }]);
    await pg.close();
  });
});
